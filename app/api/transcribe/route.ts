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
    if (fs.existsSync(dbPath)) {
      await sherpaManager.loadSpeakerDatabase(dbPath);
    } else {
      console.warn('Speaker database not found. Speaker identification will not work.');
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
 * Extract audio segment from WAV file
 */
function extractSegment(samples: Float32Array, startSample: number, endSample: number): Float32Array {
  return samples.slice(startSample, endSample);
}

export async function POST(request: NextRequest) {
  const tempWebmPath = path.join(tmpdir(), `audio-${Date.now()}.webm`);
  const tempWavPath = path.join(tmpdir(), `audio-${Date.now()}.wav`);
  const tempSegmentPaths: string[] = [];

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

    // Get speech segments using VAD
    const speechSegments = await vad.getSpeechSegments(tempWavPath);

    if (speechSegments.length === 0) {
      console.warn('No speech detected in audio');
      return NextResponse.json({ transcript: [] });
    }

    console.log(`Detected ${speechSegments.length} speech segments`);
    console.log(`Audio file info: ${samples.length} samples, ${(samples.length / sampleRate).toFixed(2)}s duration, ${sampleRate}Hz`);

    // Process each speech segment
    const transcript: TranscriptEntry[] = [];
    const recordingStartTime = Date.now();

    for (let i = 0; i < speechSegments.length; i++) {
      const [segmentStart, segmentEnd] = speechSegments[i];
      const startSample = Math.floor(segmentStart * sampleRate);
      const endSample = Math.floor(segmentEnd * sampleRate);

      console.log(`Processing segment ${i + 1}/${speechSegments.length}: ${segmentStart.toFixed(2)}s - ${segmentEnd.toFixed(2)}s (samples: ${startSample} - ${endSample})`);

      // Validate segment bounds
      if (startSample >= samples.length || endSample > samples.length) {
        console.log(`Skipping segment ${i + 1} (out of bounds: audio has ${samples.length} samples)`);
        continue;
      }

      // Extract audio segment
      const segmentSamples = extractSegment(samples, startSample, endSample);

      console.log(`Segment ${i + 1} extracted: ${segmentSamples.length} samples (${(segmentSamples.length / sampleRate).toFixed(2)}s)`);

      // Skip segments that are too short to contain meaningful speech (less than 0.2 seconds)
      if (segmentSamples.length < sampleRate * 0.2) {
        console.log(`Skipping segment ${i + 1} (too short: ${(segmentSamples.length / sampleRate).toFixed(2)}s < 0.2s)`);
        continue;
      }

      // OnlineRecognizer can handle variable-length segments, no padding needed
      const processedSamples = segmentSamples;

      // Save segment to temporary WAV file for speaker identification
      const segmentPath = path.join(tmpdir(), `segment-${Date.now()}-${i}.wav`);
      tempSegmentPaths.push(segmentPath);

      // Write segment as WAV file using sherpa's writeWave
      sherpa.writeWave(segmentPath, {
        samples: processedSamples,
        sampleRate: sampleRate,
      });

      try {
        // Extract voiceprint and identify speaker
        const voiceprint = await sherpaManager.extractVoiceprint(segmentPath);
        const speakerRole = await sherpaManager.identifySpeaker(voiceprint);

        // For better transcription, include context from surrounding audio
        // Use 2 seconds before and 1 second after the segment
        const contextBefore = 2.0; // seconds
        const contextAfter = 1.0;  // seconds

        const contextStartSample = Math.max(0, startSample - Math.floor(contextBefore * sampleRate));
        const contextEndSample = Math.min(samples.length, endSample + Math.floor(contextAfter * sampleRate));

        const contextSamples = extractSegment(samples, contextStartSample, contextEndSample);

        console.log(`Transcribing with context: segment=${(segmentSamples.length / sampleRate).toFixed(2)}s, with context=${(contextSamples.length / sampleRate).toFixed(2)}s`);

        // Transcribe the segment with surrounding context
        const text = await sherpaManager.transcribeAudio(contextSamples);

        if (text && text.trim().length > 0) {
          transcript.push({
            speaker: speakerRole || 'Client 1', // Default to Client 1 if no match
            text: text.trim(),
            timestamp: recordingStartTime + Math.floor(segmentStart * 1000), // Convert segment time to absolute timestamp
          });

          console.log(`Segment ${i + 1}: [${speakerRole || 'Unknown'}] "${text.trim()}"`);
        } else {
          console.log(`Segment ${i + 1}: No text transcribed`);
        }
      } catch (error) {
        console.error(`Error processing segment ${i + 1}:`, error);
        // Continue with next segment
      }
    }

    console.log(`Transcription complete: ${transcript.length} entries`);

    // Cleanup VAD instance
    if (vad) {
      vad.cleanup();
    }

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
    // Clean up all temporary files
    const filesToClean = [tempWebmPath, tempWavPath, ...tempSegmentPaths];

    for (const filePath of filesToClean) {
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
