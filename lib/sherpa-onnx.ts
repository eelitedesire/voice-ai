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

      this.vad = new sherpa.Vad(config);

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

      // Process audio in chunks
      const chunkSize = 16000; // 1 second chunks at 16kHz
      let hasSpeech = false;

      for (let i = 0; i < wave.samples.length; i += chunkSize) {
        const chunk = wave.samples.slice(i, Math.min(i + chunkSize, wave.samples.length));
        this.vad.acceptWaveform({ sampleRate: wave.sampleRate, samples: chunk });

        if (this.vad.isSpeech()) {
          hasSpeech = true;
          break;
        }
      }

      this.vad.flush();
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

      const segments: Array<[number, number]> = [];
      let speechStart: number | null = null;
      const sampleRate = wave.sampleRate;

      // Process audio in chunks
      const chunkSize = 512; // Window size
      for (let i = 0; i < wave.samples.length; i += chunkSize) {
        const chunk = wave.samples.slice(i, Math.min(i + chunkSize, wave.samples.length));
        this.vad.acceptWaveform({ sampleRate, samples: chunk });

        const isSpeech = this.vad.isSpeech();

        if (isSpeech && speechStart === null) {
          // Speech started
          speechStart = i / sampleRate;
        } else if (!isSpeech && speechStart !== null) {
          // Speech ended
          segments.push([speechStart, i / sampleRate]);
          speechStart = null;
        }
      }

      // Handle case where speech continues to end
      if (speechStart !== null) {
        segments.push([speechStart, wave.samples.length / sampleRate]);
      }

      this.vad.flush();
      return segments;
    } catch (error) {
      console.error('Failed to get speech segments:', error);
      return [];
    }
  }

  cleanup(): void {
    if (this.vad) {
      this.vad.free();
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
      // Initialize speech recognition (ASR) using OnlineRecognizer
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

      this.recognizer = new sherpa.OnlineRecognizer(config);
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

      // Free the stream
      stream.free();

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
      // Create a stream for recognition
      const stream = this.recognizer.createStream();

      // Accept waveform
      stream.acceptWaveform({
        sampleRate: 16000,
        samples: audioBuffer,
      });

      // Add tail padding for better recognition
      const tailPadding = new Float32Array(16000 * 0.4); // 0.4 seconds
      stream.acceptWaveform({
        samples: tailPadding,
        sampleRate: 16000,
      });

      // Decode
      while (this.recognizer.isReady(stream)) {
        this.recognizer.decode(stream);
      }

      const result = this.recognizer.getResult(stream);

      // Free the stream
      stream.free();

      return result.text || '';
    } catch (error) {
      console.error('Failed to transcribe audio:', error);
      return '';
    }
  }

  cleanup(): void {
    if (this.recognizer) {
      this.recognizer.free();
      this.recognizer = null;
    }
    if (this.speakerEmbedding) {
      this.speakerEmbedding.free();
      this.speakerEmbedding = null;
    }
  }
}
