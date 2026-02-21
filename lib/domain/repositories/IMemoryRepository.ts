import type { MemoryDatabase, MemoryFact, SpeakerMemory } from '@/lib/domain/entities';

/**
 * Contract for speaker fact storage.
 * Implementations must not leak persistence details into callers.
 */
export interface IMemoryRepository {
  getForSpeaker(name: string): SpeakerMemory | null;
  getAll(): MemoryDatabase;
  addFacts(name: string, facts: Omit<MemoryFact, 'id' | 'extractedAt'>[]): MemoryFact[];
  deleteFact(name: string, factId: string): boolean;
  clearSpeaker(name: string): boolean;
  /** Format stored facts for a set of speakers as an LLM-ready context string. */
  formatForContext(names: string[]): string;
}
