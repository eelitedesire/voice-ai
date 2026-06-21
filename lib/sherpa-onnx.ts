import * as sherpa from 'sherpa-onnx-node';
import { SpeakerDatabase, SpeakerProfile } from '@/types';
import { SpeakerIdentifier, buildEnrolledSpeakers, configFromEnv } from './speaker-identification';
import * as fs from 'fs';
import * as path from 'path';

export class VADManager {
  private vad: any = null;
  private modelPath: string;

  constructor(modelPath: string = './models') {
    this.modelPath = modelPath;
  }

  async initialize(): Promise<void> {
    try {
      const config = {
        sileroVad: {
          model: path.join(this.modelPath, 'silero_vad.onnx'),
          minSilenceDuration: 0.15,
          minSpeechDuration: 0.25,
          threshold: 0.35,
          windowSize: 512,
        },
        sampleRate: 16000,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      };

      // Second parameter is buffer size in seconds
      this.vad = new sherpa.Vad(config, 200);

      if (!this.vad) {
        throw new Error('Failed to create VAD instance');
      }

      console.log('VAD initialized successfully');
    } catch (error) {
      console.error('Failed to initialize VAD:', error);
      throw error;
    }
  }

  /**
   * Check if audio file contains speech
   */
  async hasSpeech(audioPath: string): Promise<boolean> {
    if (!this.vad) {
      throw new Error('VAD not initialized');
    }

    try {
      const wave = sherpa.readWave(audioPath);

      if (!wave || !wave.samples) {
        throw new Error(`Failed to read audio file: ${audioPath}`);
      }

      // Ensure samples is Float32Array
      const samples = wave.samples instanceof Float32Array
        ? wave.samples
        : new Float32Array(wave.samples);

      // Process all audio samples
      this.vad.acceptWaveform(samples);
      this.vad.flush();

      // Check if any speech segments were detected
      const hasSpeech = !this.vad.isEmpty();

      // Clear the VAD buffer
      while (!this.vad.isEmpty()) {
        this.vad.pop();
      }

      return hasSpeech;
    } catch (error) {
      console.error('Failed to detect speech:', error);
      return false;
    }
  }

  /**
   * Get speech segments from audio file
   * Returns array of [start_time, end_time] in seconds
   *
   * Uses chunked processing: feeds audio in windowSize chunks and pops
   * completed segments as they become available. This avoids circular
   * buffer corruption that occurs when feeding all samples at once.
   */
  async getSpeechSegments(audioPath: string): Promise<Array<[number, number]>> {
    if (!this.vad) {
      throw new Error('VAD not initialized');
    }

    try {
      const wave = sherpa.readWave(audioPath);

      if (!wave || !wave.samples) {
        throw new Error(`Failed to read audio file: ${audioPath}`);
      }

      // Ensure samples is Float32Array
      const samples = wave.samples instanceof Float32Array
        ? wave.samples
        : new Float32Array(wave.samples);

      const sampleRate = wave.sampleRate;
      const windowSize = 512; // Must match config
      const segments: Array<[number, number]> = [];

      const popSegments = () => {
        while (!this.vad.isEmpty()) {
          const segment = this.vad.front();
          this.vad.pop();

          const startTime = segment.start / sampleRate;
          const duration = segment.samples.length / sampleRate;
          const endTime = startTime + duration;

          console.log(`VAD segment: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s (${duration.toFixed(2)}s)`);
          segments.push([startTime, endTime]);
        }
      };

      // Feed audio in windowSize chunks (canonical sherpa-onnx pattern)
      for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
        const chunk = samples.subarray(i, i + windowSize);
        this.vad.acceptWaveform(chunk);
        // Pop completed segments as they become available
        popSegments();
      }

      // Flush remaining audio and pop final segments
      this.vad.flush();
      popSegments();

      console.log(`VAD total: ${segments.length} speech segments detected`);
      return segments;
    } catch (error) {
      console.error('Failed to get speech segments:', error);
      return [];
    }
  }

  cleanup(): void {
    if (this.vad) {
      // VAD cleanup - no free() method needed, just set to null
      this.vad = null;
    }
  }
}

export class SherpaONNXManager {
  private recognizer: any = null;
  private speakerEmbedding: any = null;
  private speakerManager: any = null; // Use SpeakerEmbeddingManager for recognition
  private speakerDatabase: SpeakerDatabase | null = null; // Keep for enrollment script compatibility
  private speakerIdentifier: SpeakerIdentifier | null = null; // strict cosine identifier (recognition)
  private modelPath: string;

  constructor(modelPath: string = './models') {
    this.modelPath = modelPath;
  }

  async initializeRecognizer(): Promise<void> {
    try {
      // Initialize speech recognition (ASR) using OnlineRecognizer
      // The downloaded models are streaming zipformer models for OnlineRecognizer
      const config = {
        featConfig: {
          sampleRate: 16000,
          featureDim: 80,
        },
        modelConfig: {
          transducer: {
            encoder: path.join(this.modelPath, 'encoder.onnx'),
            decoder: path.join(this.modelPath, 'decoder.onnx'),
            joiner: path.join(this.modelPath, 'joiner.onnx'),
          },
          tokens: path.join(this.modelPath, 'tokens.txt'),
          numThreads: 1,
          provider: 'cpu',
          debug: 1,  // Enable debug for troubleshooting
        },
      };

      this.recognizer = new sherpa.OnlineRecognizer(config);
      console.log('OnlineRecognizer initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Sherpa-ONNX recognizer:', error);
      throw error;
    }
  }

  async initializeSpeakerEmbedding(): Promise<void> {
    try {
      // Initialize speaker embedding model for speaker ID
      const config = {
        model: path.join(this.modelPath, 'speaker-embedding.onnx'),
        numThreads: 1,
        debug: 0,
        provider: 'cpu',
      };

      this.speakerEmbedding = new sherpa.SpeakerEmbeddingExtractor(config);

      if (!this.speakerEmbedding) {
        throw new Error('Failed to create speaker embedding extractor');
      }

      // Create SpeakerEmbeddingManager with the extractor's dimension
      this.speakerManager = new sherpa.SpeakerEmbeddingManager(this.speakerEmbedding.dim);

      console.log(`Speaker embedding extractor created. Dimension: ${this.speakerEmbedding.dim}`);
      console.log(`Speaker embedding manager initialized`);
    } catch (error) {
      console.error('Failed to initialize speaker embedding:', error);
      throw error;
    }
  }

  async loadSpeakerDatabase(dbPath: string, loadToManager: boolean = true): Promise<void> {
    try {
      const data = await fs.promises.readFile(dbPath, 'utf-8');
      this.speakerDatabase = JSON.parse(data);
      this.speakerIdentifier = null; // rebuild lazily from the freshly loaded DB

      console.log(`Loading speaker database: ${this.speakerDatabase!.speakers.length} speakers`);

      // Only load into manager if requested (for recognition, not enrollment)
      if (loadToManager && this.speakerManager) {
        // Add each speaker to the SpeakerEmbeddingManager using addMulti()
        for (const speaker of this.speakerDatabase!.speakers) {
          const voiceprint = new Float32Array(speaker.voiceprint);
          // Use name field if available, fall back to role for backward compat
          const displayName = speaker.name || speaker.role;

          const success = this.speakerManager.addMulti({
            name: displayName,
            v: [voiceprint],
          });

          if (success) {
            console.log(`  ✅ Loaded ${displayName} (${speaker.id})`);
          } else {
            console.warn(`  ❌ Failed to load ${displayName}`);
          }
        }

        console.log(`Speaker manager now has ${this.speakerManager.getNumSpeakers()} speakers`);
      } else {
        console.log('Database loaded to memory only (not to manager)');
      }
    } catch (error) {
      console.log(error);
      console.warn('Speaker database not found or failed to load');
      this.speakerDatabase = {
        speakers: [],
        modelVersion: '1.0.0',
        createdAt: Date.now(),
      };
      console.log('Speaker database initialized as empty');
    }
  }

  async saveSpeakerDatabase(dbPath: string): Promise<void> {
    if (!this.speakerDatabase) {
      throw new Error('No speaker database to save');
    }

    await fs.promises.writeFile(
      dbPath,
      JSON.stringify(this.speakerDatabase, null, 2),
      'utf-8'
    );
  }

  async extractVoiceprintFromSamples(samples: Float32Array, sampleRate: number = 16000): Promise<number[]> {
    if (!this.speakerEmbedding) {
      throw new Error('Speaker embedding model not initialized');
    }

    const stream = this.speakerEmbedding.createStream();
    if (!stream) {
      throw new Error('Failed to create speaker embedding stream');
    }

    stream.acceptWaveform({ sampleRate, samples });
    stream.inputFinished();

    if (!this.speakerEmbedding.isReady(stream)) {
      throw new Error('Speaker embedding stream is not ready - audio too short');
    }

    const embedding = this.speakerEmbedding.compute(stream);
    if (!embedding || embedding.length === 0) {
      throw new Error('Failed to compute speaker embedding');
    }

    return Array.from(embedding);
  }

  async extractVoiceprint(audioPath: string): Promise<number[]> {
    if (!this.speakerEmbedding) {
      throw new Error('Speaker embedding model not initialized');
    }

    try {
      // Read audio file using sherpa-onnx's readWave function
      const wave = sherpa.readWave(audioPath);

      if (!wave || !wave.samples) {
        throw new Error(`Failed to read audio file: ${audioPath}`);
      }

      // Create a stream for the speaker embedding
      const stream = this.speakerEmbedding.createStream();

      if (!stream) {
        throw new Error('Failed to create speaker embedding stream');
      }

      // Accept waveform
      stream.acceptWaveform({
        sampleRate: wave.sampleRate,
        samples: wave.samples,
      });

      // Input is finished
      stream.inputFinished();

      // Check if stream is ready
      if (!this.speakerEmbedding.isReady(stream)) {
        throw new Error('Speaker embedding stream is not ready');
      }

      // Compute embedding
      const embedding = this.speakerEmbedding.compute(stream);

      if (!embedding || embedding.length === 0) {
        throw new Error('Failed to compute speaker embedding');
      }

      // Stream cleanup - no free() method needed, will be garbage collected

      return Array.from(embedding);
    } catch (error) {
      console.error('Failed to extract voiceprint:', error);
      throw error;
    }
  }

  /**
   * Extract MULTIPLE speaker embeddings from one enrolment recording by sliding
   * a window across it. Capturing several embeddings (rather than one) makes the
   * enrolled profile robust to intra-speaker variation (pitch, pacing, position).
   */
  async extractEnrollmentEmbeddings(audioPath: string): Promise<number[][]> {
    const wave = sherpa.readWave(audioPath);
    if (!wave || !wave.samples) {
      throw new Error(`Failed to read audio file: ${audioPath}`);
    }
    const samples: Float32Array =
      wave.samples instanceof Float32Array ? wave.samples : new Float32Array(wave.samples);
    const sr = wave.sampleRate;

    const win = Math.floor(3.0 * sr); // 3s analysis windows
    const hop = Math.floor(1.5 * sr); // 50% overlap

    const embeddings: number[][] = [];
    if (samples.length <= win) {
      embeddings.push(await this.extractVoiceprintFromSamples(samples, sr));
    } else {
      for (let off = 0; off + win <= samples.length; off += hop) {
        try {
          embeddings.push(
            await this.extractVoiceprintFromSamples(samples.subarray(off, off + win), sr),
          );
        } catch {
          // skip a bad window; others still contribute
        }
      }
      // Always include the final window so the tail isn't lost.
      const tail = samples.subarray(Math.max(0, samples.length - win));
      try {
        embeddings.push(await this.extractVoiceprintFromSamples(tail, sr));
      } catch {
        // ignore
      }
    }

    if (embeddings.length === 0) {
      // Fallback: whole clip as a single embedding.
      embeddings.push(await this.extractVoiceprintFromSamples(samples, sr));
    }
    console.log(`Enrolment: extracted ${embeddings.length} embedding(s) from ${audioPath}`);
    return embeddings;
  }

  async enrollSpeaker(
    speakerId: string,
    name: string,
    audioPath: string
  ): Promise<void> {
    if (!this.speakerDatabase) {
      throw new Error('Speaker database not loaded');
    }

    const newEmbeddings = await this.extractEnrollmentEmbeddings(audioPath);

    const existing = this.speakerDatabase.speakers.find((s) => s.id === speakerId);
    if (existing) {
      // Re-enrolment APPENDS samples (capture different conditions over time)
      // rather than overwriting the profile.
      const prior = existing.embeddings
        ?? (existing.voiceprint?.length ? [existing.voiceprint] : []);
      existing.embeddings = [...prior, ...newEmbeddings];
      existing.voiceprint = existing.embeddings[0]; // legacy mirror
      existing.name = name;
      existing.role = name;
    } else {
      const profile: SpeakerProfile = {
        id: speakerId,
        name,
        role: name,
        voiceprint: newEmbeddings[0],
        embeddings: newEmbeddings,
      };
      this.speakerDatabase.speakers.push(profile);
    }
  }

  /**
   * Strict speaker identification via the shared SpeakerIdentifier (cosine +
   * margin + calibrated thresholds). Returns the enrolled name ONLY when the
   * match is confident enough; otherwise null so the caller labels it Unknown.
   * No "best guess" fallback — that was the source of false positives.
   */
  async identifySpeaker(voiceprint: number[]): Promise<string | null> {
    if (!this.speakerDatabase || this.speakerDatabase.speakers.length === 0) {
      return null;
    }
    if (!this.speakerIdentifier) {
      const enrolled = buildEnrolledSpeakers(this.speakerDatabase.speakers);
      // Batch path identifies windows independently, so disable cross-window
      // unknown clustering (it can't carry state reliably here).
      this.speakerIdentifier = new SpeakerIdentifier(enrolled, {
        ...configFromEnv(),
        labelUnknownClusters: false,
      });
    }

    const m = this.speakerIdentifier.identify(voiceprint);
    if (m.decision === 'known') {
      console.log(`✅ Identified ${m.speaker} (score=${m.score.toFixed(2)}; ${m.reason})`);
      return m.speaker;
    }
    console.log(`↪︎ Unknown (${m.reason})`);
    return null;
  }

  async transcribeAudio(audioBuffer: Float32Array): Promise<string> {
    if (!this.recognizer) {
      throw new Error('Recognizer not initialized');
    }

    try {
      // Create a stream for OnlineRecognizer
      const stream = this.recognizer.createStream();

      // Add leading silence for left context (model needs ~128 frames of context)
      // At 10ms frame shift, 128 frames = 1.28s
      const leadingSilence = new Float32Array(16000 * 1.5); // 1.5s of silence

      // Add trailing silence to ensure complete decoding
      const trailingSilence = new Float32Array(16000 * 0.5); // 0.5s of silence

      // Combine: leading silence + audio + trailing silence
      const paddedBuffer = new Float32Array(
        leadingSilence.length + audioBuffer.length + trailingSilence.length
      );
      paddedBuffer.set(leadingSilence, 0);
      paddedBuffer.set(audioBuffer, leadingSilence.length);
      paddedBuffer.set(trailingSilence, leadingSilence.length + audioBuffer.length);

      console.log(`Transcription input: ${audioBuffer.length} samples + ${leadingSilence.length + trailingSilence.length} padding = ${paddedBuffer.length} total`);

      // Accept waveform (feed all audio at once for a complete segment)
      stream.acceptWaveform({
        samples: paddedBuffer,
        sampleRate: 16000,
      });

      // Signal that input is finished
      stream.inputFinished();

      // Decode in a loop while the recognizer is ready
      while (this.recognizer.isReady(stream)) {
        this.recognizer.decode(stream);
      }

      // Get the final result
      const result = this.recognizer.getResult(stream);

      console.log('Transcription result:', result.text || '(empty)');

      // Stream cleanup - no free() method needed, will be garbage collected

      return result.text || '';
    } catch (error) {
      console.error('Failed to transcribe audio:', error);
      return '';
    }
  }

  cleanup(): void {
    if (this.recognizer) {
      // Cleanup recognizer - no free() method needed, just set to null
      this.recognizer = null;
    }
    if (this.speakerEmbedding) {
      // Cleanup speaker embedding - no free() method needed, just set to null
      this.speakerEmbedding = null;
    }
  }

  /**
   * Generates a similarity report for a given voiceprint against the database.
   */
  async generateSimilarityReport(voiceprint: number[]): Promise<Array<{ name: string, score: number }>> {
    if (!this.speakerDatabase) return [];
    
    const results = [];
    const v1 = new Float32Array(voiceprint);

    for (const speaker of this.speakerDatabase.speakers) {
      const v2 = new Float32Array(speaker.voiceprint);
      
      // Manual Cosine Similarity
      let dotProduct = 0, normA = 0, normB = 0;
      for (let i = 0; i < v1.length; i++) {
        dotProduct += v1[i] * v2[i];
        normA += v1[i] * v1[i];
        normB += v2[i] * v2[i];
      }
      const score = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      results.push({ name: speaker.role, score });
    }

    return results.sort((a, b) => b.score - a.score);
  }
}
