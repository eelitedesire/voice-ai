/**
 * Therapist Chat Use Case
 *
 * Encapsulates the logic for generating a live therapist response during
 * a session, including RAG pipeline integration and safety overrides.
 * Previously inline in app/api/therapist-chat/route.ts.
 */
import { generateText } from 'ai';
import type { ChatMessage, TranscriptEntry } from '@/lib/domain/entities';
import type { IMemoryRepository } from '@/lib/domain/repositories/IMemoryRepository';
import { runRAGPipeline, runLightRAGPipeline } from '@/lib/rag/orchestrator';
import type { RAGPipelineInput } from '@/lib/domain/entities';
import { ExtractMemoriesUseCase } from './ExtractMemoriesUseCase';
import { groqClient, LLM_MODEL } from '@/lib/infrastructure/llm/GroqLLMService';

// ── Constants ─────────────────────────────────────────────────────────

const THERAPIST_SYSTEM_PROMPT = `You are an experienced couples therapist participating in a live therapy session. You are observing a conversation between partners and can interject with therapeutic guidance.

Your role:
- Provide empathetic, professional therapeutic responses
- Ask clarifying or reflective questions to individuals or the couple
- Offer suggestions, reframes, or observations when helpful
- Address messages to a specific person by name, or to the couple together
- Keep responses concise and conversational (2-4 sentences typically)
- Use trauma-informed, culturally sensitive language

You can see the full session transcript and the live chat history. Respond naturally as a therapist would in session.

IMPORTANT formatting rules:
- When addressing a specific person, start with their name followed by a comma (e.g. "Sarah, I notice that...")
- When addressing the couple, you can start directly (e.g. "I'd like both of you to consider...")
- Be warm but professional`;

// ── Types ─────────────────────────────────────────────────────────────

export interface TherapistChatInput {
  message: string;
  chatHistory?: ChatMessage[];
  transcript?: TranscriptEntry[];
  systemPrompt?: string;
  coupleId?: string;
}

export interface TherapistChatResult {
  reply: string;
  safetyOverride?: boolean;
}

// ── Use Case ──────────────────────────────────────────────────────────

export class TherapistChatUseCase {
  constructor(
    private readonly memoryRepo: IMemoryRepository,
    private readonly extractMemories: ExtractMemoriesUseCase,
  ) {}

  async execute(input: TherapistChatInput): Promise<TherapistChatResult> {
    const { message, chatHistory, transcript, systemPrompt, coupleId } = input;

    // ── RAG / Safety pipeline ─────────────────────────────────────────
    let ragContext = '';
    let ragSafetyOverride: string | undefined;

    if (coupleId) {
      const speakerMatch = message.match(/^\[([^\]]+)\]:\s*(.+)$/s);
      const currentSpeaker = speakerMatch ? speakerMatch[1] : undefined;
      const messageBody = speakerMatch ? speakerMatch[2] : message;

      const ragInput: RAGPipelineInput = {
        coupleId,
        currentTranscript: (transcript || []).map(e => ({
          speaker: e.speaker,
          text: e.text,
          timestamp: e.timestamp,
        })),
        currentMessage: messageBody,
        currentSpeaker,
        chatHistory: (chatHistory || []).map(m => ({
          role: m.role,
          speaker: m.speaker,
          text: m.text,
        })),
      };

      try {
        const ragResult = await runRAGPipeline(ragInput);
        if (ragResult.safetyOverride) {
          ragSafetyOverride = ragResult.augmentedContext;
        } else {
          ragContext = ragResult.augmentedContext;
        }
      } catch (ragErr) {
        console.error('[TherapistChat] RAG pipeline failed (non-blocking):', ragErr);
      }
    } else {
      // Lightweight safety check even without coupleId
      const speakerMatch = message.match(/^\[([^\]]+)\]:\s*(.+)$/s);
      const messageBody = speakerMatch ? speakerMatch[2] : message;

      try {
        const safetyResult = await runLightRAGPipeline({
          coupleId: '__anonymous__',
          currentTranscript: [],
          currentMessage: messageBody,
        });
        if (safetyResult.safetyOverride && safetyResult.overrideResponse) {
          ragSafetyOverride = safetyResult.overrideResponse;
        }
      } catch {
        // Safety check failure is non-blocking
      }
    }

    if (ragSafetyOverride) {
      return { reply: ragSafetyOverride, safetyOverride: true };
    }

    // ── Context assembly ──────────────────────────────────────────────
    let context = '';

    if (transcript && transcript.length > 0) {
      context += 'Session transcript so far:\n';
      context += transcript.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
      context += '\n\n';
    }

    if (chatHistory && chatHistory.length > 0) {
      context += 'Live chat history:\n';
      context += chatHistory
        .map(msg =>
          msg.role === 'therapist'
            ? `[Therapist]: ${msg.text}`
            : `[${msg.speaker || 'Unknown'}]: ${msg.text}`
        )
        .join('\n');
      context += '\n\n';
    }

    // Inject stored memories about known speakers
    const speakerNames: string[] = [];
    for (const entry of transcript ?? []) {
      if (!speakerNames.includes(entry.speaker)) speakerNames.push(entry.speaker);
    }
    for (const msg of chatHistory ?? []) {
      if (msg.speaker && !speakerNames.includes(msg.speaker)) speakerNames.push(msg.speaker);
    }
    const memoryContext = this.memoryRepo.formatForContext(speakerNames);
    if (memoryContext) context += memoryContext + '\n';

    if (ragContext) context += ragContext + '\n';

    // ── LLM call ──────────────────────────────────────────────────────
    const { text } = await generateText({
      model: groqClient(LLM_MODEL),
      system: (typeof systemPrompt === 'string' && systemPrompt.trim())
        ? systemPrompt.trim()
        : THERAPIST_SYSTEM_PROMPT,
      prompt: `${context}The following message was just sent in the live chat. Respond as the therapist.\n\nMessage: ${message}`,
    });

    // Fire-and-forget memory extraction from this message
    const speakerMatch = message.match(/^\[([^\]]+)\]:\s*(.+)$/s);
    if (speakerMatch) {
      const [, speakerName, messageBody] = speakerMatch;
      this.extractMemories.extractFromMessage(messageBody, speakerName);
    }

    return { reply: text };
  }
}
