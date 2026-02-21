import type { SpeakerDatabase, SpeakerProfile } from '@/lib/domain/entities';

/**
 * Contract for speaker profile storage (voice enrollment database).
 */
export interface ISpeakerRepository {
  getAll(): SpeakerDatabase;
  findById(id: string): SpeakerProfile | undefined;
  save(db: SpeakerDatabase): void;
}
