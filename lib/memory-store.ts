/**
 * Memory Store — backward-compatible facade
 *
 * All function signatures are preserved so existing callers continue
 * to work unchanged. The implementation delegates to JsonMemoryRepository.
 */
import { memoryRepository } from '@/lib/infrastructure/persistence/JsonMemoryRepository';
import type { MemoryDatabase, MemoryFact, SpeakerMemory } from '@/lib/domain/entities';

export function getMemoriesForSpeaker(speakerName: string): SpeakerMemory | null {
  return memoryRepository.getForSpeaker(speakerName);
}

export function getAllMemories(): MemoryDatabase {
  return memoryRepository.getAll();
}

export function addFacts(
  speakerName: string,
  facts: Omit<MemoryFact, 'id' | 'extractedAt'>[],
): MemoryFact[] {
  return memoryRepository.addFacts(speakerName, facts);
}

export function deleteMemory(speakerName: string, factId: string): boolean {
  return memoryRepository.deleteFact(speakerName, factId);
}

export function clearMemoriesForSpeaker(speakerName: string): boolean {
  return memoryRepository.clearSpeaker(speakerName);
}

export function formatMemoriesForContext(speakerName: string): string {
  const memory = memoryRepository.getForSpeaker(speakerName);
  if (!memory || memory.facts.length === 0) return '';
  return memory.facts.map(f => `- ${f.content}`).join('\n');
}

export function formatAllMemoriesForContext(speakerNames: string[]): string {
  return memoryRepository.formatForContext(speakerNames);
}
