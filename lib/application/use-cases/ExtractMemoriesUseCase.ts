/**
 * Extract Memories Use Case
 *
 * Centralises all LLM-based memory extraction logic that was previously
 * duplicated across app/api/analyze/route.ts and
 * app/api/therapist-chat/route.ts.
 *
 * Two entry points:
 *  - extractFromTranscript: used after a full session analysis
 *  - extractFromMessage:    used after each live chat message
 */
import { generateObject } from 'ai';
import { z } from 'zod';
import type { IMemoryRepository } from '@/lib/domain/repositories/IMemoryRepository';
import type { TranscriptEntry } from '@/lib/domain/entities';
import { groqClient, LLM_MODEL } from '@/lib/infrastructure/llm/GroqLLMService';

// ── Schemas ──────────────────────────────────────────────────────────

const transcriptMemorySchema = z.object({
  speakers: z.array(
    z.object({
      name: z.string().describe('Speaker name exactly as it appears in the transcript'),
      facts: z.array(
        z.object({
          content: z.string().describe('A concise factual statement about this person'),
          category: z.enum([
            'personal',
            'relationship',
            'emotional',
            'goal',
            'preference',
            'history',
            'other',
          ]),
        })
      ),
    })
  ),
});

const chatMemorySchema = z.object({
  facts: z.array(
    z.object({
      speaker: z.string(),
      content: z.string(),
      category: z.enum([
        'personal',
        'relationship',
        'emotional',
        'goal',
        'preference',
        'history',
        'other',
      ]),
    })
  ),
});

// ── Use Case ─────────────────────────────────────────────────────────

export class ExtractMemoriesUseCase {
  constructor(private readonly memoryRepo: IMemoryRepository) {}

  /**
   * Extract and store facts for all speakers from a full session transcript.
   * Fires asynchronously (non-blocking) — callers do not need to await.
   */
  async extractFromTranscript(
    transcript: TranscriptEntry[],
    speakerNames: string[],
  ): Promise<void> {
    try {
      const formattedTranscript = transcript
        .map(e => `[${e.speaker}]: ${e.text}`)
        .join('\n');

      const existingParts: string[] = [];
      for (const name of speakerNames) {
        const mem = this.memoryRepo.getForSpeaker(name);
        if (mem && mem.facts.length > 0) {
          existingParts.push(
            `Already known about ${name}:\n${mem.facts.map(f => `- ${f.content}`).join('\n')}`
          );
        }
      }
      const existingContext = existingParts.length > 0
        ? `\n\nThe following facts are already stored. Do NOT re-extract these:\n${existingParts.join('\n\n')}`
        : '';

      const { object } = await generateObject({
        model: groqClient(LLM_MODEL),
        schema: transcriptMemorySchema,
        system: `You extract important facts about people from therapy transcripts. Extract personal details, relationship dynamics, emotional patterns, goals, preferences, and history. Each fact should be a single concise sentence. Only extract genuinely new or important information.${existingContext}`,
        prompt: `Extract facts about each person from this transcript:\n\n${formattedTranscript}`,
      });

      for (const speaker of object.speakers) {
        if (speaker.facts.length > 0) {
          this.memoryRepo.addFacts(speaker.name, speaker.facts);
        }
      }
      console.log('[Memory] Extracted memories from session transcript');
    } catch (err) {
      console.error('[Memory] Transcript extraction failed (non-blocking):', err);
    }
  }

  /**
   * Extract and store facts from a single live chat message.
   * Fires asynchronously (non-blocking) — callers do not need to await.
   */
  async extractFromMessage(messageText: string, speakerName: string): Promise<void> {
    try {
      const existing = this.memoryRepo.getForSpeaker(speakerName);
      const existingContext = existing && existing.facts.length > 0
        ? `\nAlready known about ${speakerName}:\n${existing.facts.map(f => `- ${f.content}`).join('\n')}\nDo NOT re-extract these.`
        : '';

      const { object } = await generateObject({
        model: groqClient(LLM_MODEL),
        schema: chatMemorySchema,
        system: `Extract important new facts about the person from this therapy chat message. Only extract genuinely valuable information (personal details, relationship info, emotions, goals, preferences, history). Return an empty array if nothing noteworthy. Each fact is one concise sentence.${existingContext}`,
        prompt: `Speaker "${speakerName}" said: ${messageText}`,
      });

      if (object.facts.length > 0) {
        this.memoryRepo.addFacts(
          speakerName,
          object.facts.map((f: { speaker: string; content: string; category: 'personal' | 'relationship' | 'emotional' | 'goal' | 'preference' | 'history' | 'other' }) => ({ content: f.content, category: f.category })),
        );
        console.log(`[Memory] Extracted ${object.facts.length} fact(s) from message by ${speakerName}`);
      }
    } catch (err) {
      console.error('[Memory] Message extraction failed (non-blocking):', err);
    }
  }
}
