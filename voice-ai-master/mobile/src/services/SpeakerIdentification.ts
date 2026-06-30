/**
 * SpeakerIdentification — On-device speaker matching service.
 *
 * Compares extracted voice embeddings against enrolled speaker profiles
 * using cosine similarity. All math runs in JS — no native bridge needed
 * since the vectors are small (~256 floats).
 *
 * Speaker enrollment audio is processed through SherpaOnnx.extractEmbedding()
 * and stored locally via StorageService.
 */

import { sherpaOnnx } from '../native/SherpaOnnx';
import { getSpeakerProfiles, addSpeakerProfile } from './StorageService';
import { SpeakerProfile } from '../types';
import { MODEL_PATHS, AUDIO_CONFIG } from '../config/api';

const SIMILARITY_THRESHOLD = 0.35;
const MIN_ENROLLMENT_SECONDS = 5;
const MAX_ENROLLMENT_SECONDS = 15;

export class SpeakerIdentificationService {
  private initialized = false;
  private profiles: SpeakerProfile[] = [];

  async initialize(documentDir: string): Promise<void> {
    await sherpaOnnx.initSpeakerModel({
      modelPath: `${documentDir}/${MODEL_PATHS.speakerEncoder}`,
      numThreads: 2,
      sampleRate: AUDIO_CONFIG.sampleRate,
    });

    this.profiles = getSpeakerProfiles();
    this.initialized = true;
  }

  async release(): Promise<void> {
    if (this.initialized) {
      await sherpaOnnx.releaseSpeakerModel();
      this.initialized = false;
    }
  }

  /**
   * Enroll a new speaker from recorded audio samples.
   * @param name Speaker's display name
   * @param role Speaker's role (e.g. 'client', 'therapist')
   * @param audioBase64 Base64-encoded Float32 PCM audio (5-15 seconds)
   */
  async enrollSpeaker(
    name: string,
    role: string,
    audioBase64: string,
  ): Promise<SpeakerProfile> {
    if (!this.initialized) {
      throw new Error('Speaker model not initialized');
    }

    const embedding = await sherpaOnnx.extractEmbedding(audioBase64);

    const profile: SpeakerProfile = {
      id: `speaker_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      role,
      voiceprint: embedding,
    };

    addSpeakerProfile(profile);
    this.profiles.push(profile);

    return profile;
  }

  /**
   * Identify a speaker from an audio segment.
   * @param audioBase64 Base64-encoded Float32 PCM audio
   * @returns Speaker name or 'Unknown'
   */
  async identifySpeaker(audioBase64: string): Promise<string> {
    if (!this.initialized || this.profiles.length === 0) {
      return 'Unknown';
    }

    const embedding = await sherpaOnnx.extractEmbedding(audioBase64);
    return this.matchEmbedding(embedding);
  }

  /**
   * Match an embedding vector against enrolled profiles.
   */
  matchEmbedding(embedding: number[]): string {
    let bestMatch = 'Unknown';
    let bestScore = -1;

    for (const profile of this.profiles) {
      const score = cosineSimilarity(embedding, profile.voiceprint);
      if (score > SIMILARITY_THRESHOLD && score > bestScore) {
        bestScore = score;
        bestMatch = profile.name;
      }
    }

    return bestMatch;
  }

  getProfiles(): SpeakerProfile[] {
    return [...this.profiles];
  }

  refreshProfiles(): void {
    this.profiles = getSpeakerProfiles();
  }

  getMinEnrollmentDuration(): number {
    return MIN_ENROLLMENT_SECONDS;
  }

  getMaxEnrollmentDuration(): number {
    return MAX_ENROLLMENT_SECONDS;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
