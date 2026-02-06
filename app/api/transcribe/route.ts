import { NextRequest, NextResponse } from 'next/server';
import { SherpaONNXManager, VADManager } from '@/lib/sherpa-onnx';
import { TranscriptEntry } from '@/types';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as sherpa from 'sherpa-onnx-node';

const execAsync = promisify(exec);

let sherpaManager: SherpaONNXManager | null = null;
let vadManager: VADManager | null = null;

async function initializeSherpa() {
  if (!sherpaManager) {
    // Use absolute path from project root for Next.js API routes
    const modelsPath = path.join(process.cwd(), 'models');
    sherpaManager = new SherpaONNXManager(modelsPath);
    await sherpaManager.initializeRecognizer();
    await sherpaManager.initializeSpeakerEmbedding();

    const dbPath = path.join(process.cwd(), 'speaker_db.json');
    console.log('Looking for speaker database at:', dbPath);
    if (fs.existsSync(dbPath)) {
      await sherpaManager.loadSpeakerDatabase(dbPath);
      console.log('✅ Speaker database loaded successfully');
    } else {
      console.warn('❌ Speaker database not found at:', dbPath);
      console.warn('Speaker identification will not work. Run: npm run enroll');
    }
  }
  return sherpaManager;
}

async function initializeVAD() {
  if (!vadManager) {
    const modelsPath = path.join(process.cwd(), 'models');
    vadManager = new VADManager(modelsPath);
    await vadManager.initialize();
  }
  return vadManager;
}

/**
 * Convert WebM audio file to WAV format at 16kHz mono
 * Required format for Sherpa-ONNX processing
 */
async function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  try {
    // Use ffmpeg to convert WebM to WAV (16kHz, mono, 16-bit PCM)
    await execAsync(
      `ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -sample_fmt s16 "${outputPath}" -y`
    );
  } catch (error) {
    console.error('Failed to convert audio:', error);
    throw new Error('Audio conversion failed. Ensure ffmpeg is installed.');
  }
}

/**
 * Extract audio segment from samples array
 */
function extractSegment(samples: Float32Array, startSample: number, endSample: number): Float32Array {
  return samples.slice(
    Math.max(0, startSample),
    Math.min(endSample, samples.length)
  );
}

interface SpeakerWindow {
  speaker: string;
  startTime: number;
  endTime: number;
}

interface SpeakerTurn {
  speaker: string;
  startTime: number;
  endTime: number;
  startSample: number;
  endSample: number;
}

/**
 * Perform windowed speaker diarization on speech regions.
 * Splits speech into small overlapping windows, identifies the speaker
 * for each window, then merges consecutive same-speaker windows into turns.
 */
async function diarizeSpeech(
  speechSegments: Array<[number, number]>,
  samples: Float32Array,
  sampleRate: number,
  manager: SherpaONNXManager,
): Promise<SpeakerTurn[]> {
  const WINDOW_DURATION = 3.0; // seconds per window for speaker ID
  const WINDOW_STEP = 1.5;     // step between windows (50% overlap)
  const MIN_AUDIO_FOR_ID = 0.5; // minimum seconds for speaker identification

  const speakerWindows: SpeakerWindow[] = [];

  for (const [segStart, segEnd] of speechSegments) {
    const segStartSample = Math.floor(segStart * sampleRate);
    const segEndSample = Math.min(Math.floor(segEnd * sampleRate), samples.length);
    const segDuration = segEnd - segStart;

    if (segDuration < MIN_AUDIO_FOR_ID) continue;

    if (segDuration <= WINDOW_DURATION + 0.5) {
      // Short segment: identify as one unit
      const segSamples = samples.subarray(segStartSample, segEndSample);
      try {
        const voiceprint = await manager.extractVoiceprintFromSamples(segSamples, sampleRate);
        const speaker = await manager.identifySpeaker(voiceprint) || 'Client 1';
        speakerWindows.push({ speaker, startTime: segStart, endTime: segEnd });
      } catch (e) {
        console.warn(`Speaker ID failed for segment ${segStart.toFixed(2)}-${segEnd.toFixed(2)}:`, e);
        speakerWindows.push({ speaker: 'Client 1', startTime: segStart, endTime: segEnd });
      }
    } else {
      // Long segment: split into overlapping windows
      const windowSamples = Math.floor(WINDOW_DURATION * sampleRate);
      const stepSamples = Math.floor(WINDOW_STEP * sampleRate);

      let lastWindowEnd = segStartSample;
      for (let offset = segStartSample; offset + windowSamples <= segEndSample; offset += stepSamples) {
        const windowAudio = samples.subarray(offset, offset + windowSamples);
        try {
          const voiceprint = await manager.extractVoiceprintFromSamples(windowAudio, sampleRate);
          const speaker = await manager.identifySpeaker(voiceprint) || 'Client 1';
          speakerWindows.push({
            speaker,
            startTime: offset / sampleRate,
            endTime: (offset + windowSamples) / sampleRate,
          });
          lastWindowEnd = offset + windowSamples;
        } catch (e) {
          console.warn(`Speaker ID failed for window at ${(offset / sampleRate).toFixed(2)}s`);
        }
      }

      // Handle remaining audio at end of segment
      if (segEndSample - lastWindowEnd > MIN_AUDIO_FOR_ID * sampleRate) {
        const tailStart = Math.max(lastWindowEnd, segEndSample - windowSamples);
        const tailAudio = samples.subarray(tailStart, segEndSample);
        if (tailAudio.length >= MIN_AUDIO_FOR_ID * sampleRate) {
          try {
            const voiceprint = await manager.extractVoiceprintFromSamples(tailAudio, sampleRate);
            const speaker = await manager.identifySpeaker(voiceprint) || 'Client 1';
            speakerWindows.push({
              speaker,
              startTime: tailStart / sampleRate,
              endTime: segEnd,
            });
          } catch (e) {
            // ignore
          }
        }
      }
    }
  }

  console.log(`Speaker identification: ${speakerWindows.length} windows analyzed`);

  // Merge consecutive same-speaker windows into turns
  const rawTurns: SpeakerTurn[] = [];
  for (const w of speakerWindows) {
    if (rawTurns.length > 0 && rawTurns[rawTurns.length - 1].speaker === w.speaker) {
      // Extend existing turn
      const turn = rawTurns[rawTurns.length - 1];
      turn.endTime = Math.max(turn.endTime, w.endTime);
      turn.endSample = Math.min(Math.floor(turn.endTime * sampleRate), samples.length);
    } else {
      rawTurns.push({
        speaker: w.speaker,
        startTime: w.startTime,
        endTime: w.endTime,
        startSample: Math.floor(w.startTime * sampleRate),
        endSample: Math.min(Math.floor(w.endTime * sampleRate), samples.length),
      });
    }
  }

  // Smooth out very short turns (likely misidentifications)
  // If a turn is < 2s and its neighbors are the same speaker, absorb it
  const MIN_TURN_DURATION = 2.0;
  const turns: SpeakerTurn[] = [];
  for (let i = 0; i < rawTurns.length; i++) {
    const turn = rawTurns[i];
    const duration = turn.endTime - turn.startTime;

    if (
      duration < MIN_TURN_DURATION &&
      turns.length > 0 &&
      i < rawTurns.length - 1 &&
      turns[turns.length - 1].speaker === rawTurns[i + 1].speaker
    ) {
      // Absorb short turn into previous (same-speaker neighbor)
      turns[turns.length - 1].endTime = turn.endTime;
      turns[turns.length - 1].endSample = turn.endSample;
      console.log(`  Smoothed: absorbed short turn at ${turn.startTime.toFixed(2)}s-${turn.endTime.toFixed(2)}s into [${turns[turns.length - 1].speaker}]`);
      continue;
    }

    // Merge with previous if same speaker (after smoothing above)
    if (turns.length > 0 && turns[turns.length - 1].speaker === turn.speaker) {
      turns[turns.length - 1].endTime = turn.endTime;
      turns[turns.length - 1].endSample = turn.endSample;
    } else {
      turns.push({ ...turn });
    }
  }

  console.log(`Diarization: ${rawTurns.length} raw turns → ${turns.length} final turns`);
  return turns;
}

export async function POST(request: NextRequest) {
  const tempWebmPath = path.join(tmpdir(), `audio-${Date.now()}.webm`);
  const tempWavPath = path.join(tmpdir(), `audio-${Date.now()}.wav`);

  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    // Save WebM audio to temporary file
    const audioBuffer = await audioFile.arrayBuffer();
    await fs.promises.writeFile(tempWebmPath, Buffer.from(audioBuffer));

    // Convert WebM to WAV format (16kHz, mono)
    await convertToWav(tempWebmPath, tempWavPath);

    // Initialize Sherpa-ONNX and VAD
    const sherpaManager = await initializeSherpa();

    // Create a fresh VAD instance for each request to avoid state accumulation
    const modelsPath = path.join(process.cwd(), 'models');
    const vad = new VADManager(modelsPath);
    await vad.initialize();

    // Read the WAV file
    const wave = sherpa.readWave(tempWavPath);
    if (!wave || !wave.samples) {
      throw new Error('Failed to read converted WAV file');
    }

    const samples = wave.samples instanceof Float32Array
      ? wave.samples
      : new Float32Array(wave.samples);
    const sampleRate = wave.sampleRate;

    console.log(`Audio: ${samples.length} samples, ${(samples.length / sampleRate).toFixed(2)}s, ${sampleRate}Hz`);

    // Step 1: Get speech segments using VAD (chunked processing)
    const speechSegments = await vad.getSpeechSegments(tempWavPath);
    vad.cleanup();

    if (speechSegments.length === 0) {
      console.warn('No speech detected in audio');
      return NextResponse.json({ transcript: [] });
    }

    console.log(`VAD detected ${speechSegments.length} speech segments`);

    // Step 2: Speaker diarization - identify speakers using overlapping windows
    const turns = await diarizeSpeech(speechSegments, samples, sampleRate, sherpaManager);

    if (turns.length === 0) {
      console.warn('No speaker turns detected');
      return NextResponse.json({ transcript: [] });
    }

    // Step 3: Transcribe each speaker turn independently
    const transcript: TranscriptEntry[] = [];
    const recordingStartTime = Date.now();

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const turnSamples = extractSegment(samples, turn.startSample, turn.endSample);

      // Skip very short turns
      if (turnSamples.length < sampleRate * 0.3) {
        console.log(`Skipping turn ${i + 1} (too short: ${(turnSamples.length / sampleRate).toFixed(2)}s)`);
        continue;
      }

      console.log(`Transcribing turn ${i + 1}/${turns.length}: [${turn.speaker}] ${turn.startTime.toFixed(2)}s - ${turn.endTime.toFixed(2)}s (${(turnSamples.length / sampleRate).toFixed(2)}s)`);

      try {
        const text = await sherpaManager.transcribeAudio(turnSamples);

        if (text && text.trim().length > 0) {
          transcript.push({
            speaker: (turn.speaker === 'Client 1' || turn.speaker === 'Client 2')
              ? turn.speaker
              : 'Client 1',
            text: text.trim(),
            timestamp: recordingStartTime + Math.floor(turn.startTime * 1000),
          });

          const preview = text.trim().length > 80 ? text.trim().substring(0, 80) + '...' : text.trim();
          console.log(`Turn ${i + 1}: [${turn.speaker}] "${preview}"`);
        } else {
          console.log(`Turn ${i + 1}: No text transcribed`);
        }
      } catch (error) {
        console.error(`Error transcribing turn ${i + 1}:`, error);
      }
    }

    console.log(`Transcription complete: ${transcript.length} entries from ${turns.length} speaker turns`);

    return NextResponse.json({ transcript });

  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      {
        error: 'Transcription failed',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  } finally {
    // Clean up temporary files
    for (const filePath of [tempWebmPath, tempWavPath]) {
      try {
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
      } catch (err) {
        console.error(`Failed to delete temp file ${filePath}:`, err);
      }
    }
  }
}

// Cleanup on process exit
process.on('exit', () => {
  if (sherpaManager) {
    sherpaManager.cleanup();
  }
  if (vadManager) {
    vadManager.cleanup();
  }
});
