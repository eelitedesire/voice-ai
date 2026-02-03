import * as sherpa from 'sherpa-onnx-node';
import { SpeakerDatabase, SpeakerProfile } from '@/types';
import * as fs from 'fs';
import * as path from 'path';

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
      // Initialize speech recognition (ASR)
      const config = {
        modelConfig: {
          transducer: {
            encoder: path.join(this.modelPath, 'encoder.onnx'),
            decoder: path.join(this.modelPath, 'decoder.onnx'),
            joiner: path.join(this.modelPath, 'joiner.onnx'),
          },
          tokens: path.join(this.modelPath, 'tokens.txt'),
          sampleRate: 16000,
        },
      };

      // Note: Actual Sherpa-ONNX initialization
      // This is a simplified version - adjust based on actual sherpa-onnx-node API
      this.recognizer = sherpa.createRecognizer(config);
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
        sampleRate: 16000,
      };

      this.speakerEmbedding = sherpa.createSpeakerEmbedding(config);
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
      // Read audio file
      const audioData = await fs.promises.readFile(audioPath);

      // Extract embedding (voiceprint)
      // Note: Simplified - actual implementation depends on sherpa-onnx-node API
      const embedding = this.speakerEmbedding.compute(audioData);

      return Array.from(embedding);
    } catch (error) {
      console.error('Failed to extract voiceprint:', error);
      throw error;
    }
  }

  async enrollSpeaker(
    speakerId: string,
    role: 'Therapist' | 'Client',
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
      // Process audio buffer with Sherpa-ONNX
      // Note: Simplified - actual implementation depends on sherpa-onnx-node API
      const result = this.recognizer.acceptWaveform(audioBuffer);
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
