import * as sherpa from 'sherpa-onnx-node';
import { SpeakerDatabase, SpeakerProfile } from '@/types';
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
          minSilenceDuration: 0.2,
          minSpeechDuration: 0.8,
          threshold: 0.1,
          windowSize: 512,
        },
        sampleRate: 16000,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      };

      // Second parameter is buffer size in seconds
      this.vad = new sherpa.Vad(config, 60);  // Increased buffer to 60s for longer recordings

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

      // Feed all audio to VAD
      this.vad.acceptWaveform(samples);
      this.vad.flush();

      // Collect all detected speech segments
      const segments: Array<[number, number]> = [];

      while (!this.vad.isEmpty()) {
        const segment = this.vad.front();
        this.vad.pop();

        // Debug: log segment structure
        console.log('VAD segment:', {
          start: segment.start,
          samplesLength: segment.samples?.length,
          sampleRate: sampleRate,
        });

        // segment.start and segment.samples are provided by VAD
        // Convert to time in seconds
        const startTime = segment.start / sampleRate;
        const duration = segment.samples.length / sampleRate;
        const endTime = startTime + duration;

        console.log(`VAD segment time: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s`);

        segments.push([startTime, endTime]);
      }

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

      console.log(`Loading speaker database: ${this.speakerDatabase.speakers.length} speakers`);

      // Only load into manager if requested (for recognition, not enrollment)
      if (loadToManager && this.speakerManager) {
        // Add each speaker to the SpeakerEmbeddingManager using addMulti()
        for (const speaker of this.speakerDatabase.speakers) {
          // Convert single voiceprint to array for addMulti()
          // This provides better speaker recognition than single sample
          // const voiceprints = Array.isArray(speaker.voiceprint)
          //   ? speaker.voiceprint
          //   : [speaker.voiceprint];
          const voiceprint = new Float32Array(speaker.voiceprint);

          const success = this.speakerManager.addMulti({
            name: speaker.role, // Use role as name (e.g., "Client 1", "Client 2")
            v: [voiceprint], // Array of voiceprints (even if just one for now)
          });

          if (success) {
            console.log(`  ✅ Loaded ${speaker.role} (${speaker.id})`);
          } else {
            console.warn(`  ❌ Failed to load ${speaker.role}`);
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

  async enrollSpeaker(
    speakerId: string,
    role: 'Client 1' | 'Client 2',
    audioPath: string
  ): Promise<void> {
    if (!this.speakerDatabase) {
      throw new Error('Speaker database not loaded');
    }

    const voiceprint = await this.extractVoiceprint(audioPath);

    const profile: SpeakerProfile = {
      id: speakerId,
      role,
      voiceprint,
    };

    // Remove existing speaker with same ID
    this.speakerDatabase.speakers = this.speakerDatabase.speakers.filter(
      s => s.id !== speakerId
    );

    this.speakerDatabase.speakers.push(profile);
  }

  async identifySpeaker(voiceprint: number[]): Promise<string | null> {
    if (!this.speakerManager || this.speakerManager.getNumSpeakers() === 0) {
      console.log('No speakers enrolled for identification');
      return null;
    }

    console.log(`Searching through ${this.speakerManager.getNumSpeakers()} speakers...`);

    // Use SpeakerEmbeddingManager's search method
    const threshold = 0.35; // Similarity threshold
    const typedVoiceprint = new Float32Array(voiceprint);
    const speakerName = this.speakerManager.search({
      v: typedVoiceprint,
      threshold: threshold,
    });

    if (speakerName && speakerName !== '') {
      console.log(`✅ Identified speaker: ${speakerName} (threshold: ${threshold})`);
      return speakerName;
    }

    const bestGuess = this.speakerManager.search({
      v: typedVoiceprint,
      threshold: 0.1, // Very loose
    });

    if (bestGuess) {
      console.log(`⚠️ Low confidence match: ${bestGuess}. Using as best guess.`);
      return bestGuess;
    }
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
