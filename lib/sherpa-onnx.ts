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
          minSilenceDuration: 0.5,  // 0.5 seconds of silence to split
          minSpeechDuration: 0.25,  // 0.25 seconds minimum speech
          threshold: 0.5,            // Detection threshold
          windowSize: 512,
        },
        sampleRate: 16000,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      };

      // Second parameter is buffer size in seconds
      this.vad = new sherpa.Vad(config, 30);

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
  private speakerDatabase: SpeakerDatabase | null = null;
  private modelPath: string;

  constructor(modelPath: string = './models') {
    this.modelPath = modelPath;
  }

  async initializeRecognizer(): Promise<void> {
    try {
      // Initialize speech recognition (ASR) using OfflineRecognizer
      // OfflineRecognizer is designed for processing complete audio segments
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
          numThreads: 2,
          provider: 'cpu',
          debug: 0,
        },
      };

      this.recognizer = new sherpa.OfflineRecognizer(config);
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

      console.log(`Speaker embedding extractor created. Dimension: ${this.speakerEmbedding.dim}`);
    } catch (error) {
      console.error('Failed to initialize speaker embedding:', error);
      throw error;
    }
  }

  async loadSpeakerDatabase(dbPath: string): Promise<void> {
    try {
      const data = await fs.promises.readFile(dbPath, 'utf-8');
      this.speakerDatabase = JSON.parse(data);
    } catch (error) {
      console.warn('Speaker database not found, starting fresh');
      this.speakerDatabase = {
        speakers: [],
        modelVersion: '1.0.0',
        createdAt: Date.now(),
      };
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
    if (!this.speakerDatabase || this.speakerDatabase.speakers.length === 0) {
      return null;
    }

    // Calculate cosine similarity
    const cosineSimilarity = (a: number[], b: number[]): number => {
      if (a.length !== b.length) return 0;

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }

      return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    };

    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const speaker of this.speakerDatabase.speakers) {
      const score = cosineSimilarity(voiceprint, speaker.voiceprint);
      if (score > bestScore && score > 0.6) { // Threshold of 0.6
        bestScore = score;
        bestMatch = speaker.role;
      }
    }

    return bestMatch;
  }

  async transcribeAudio(audioBuffer: Float32Array): Promise<string> {
    if (!this.recognizer) {
      throw new Error('Recognizer not initialized');
    }

    try {
      // Create a stream for OfflineRecognizer
      const stream = this.recognizer.createStream();

      // Accept waveform (OfflineRecognizer processes complete segments)
      stream.acceptWaveform({
        samples: audioBuffer,
        sampleRate: 16000,
      });

      // Decode once (OfflineRecognizer doesn't need a loop)
      this.recognizer.decode(stream);

      // Get the result
      const result = this.recognizer.getResult(stream);

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
}
