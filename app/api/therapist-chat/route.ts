import { NextRequest, NextResponse } from 'next/server';
import { generateText, generateObject } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';
import { ChatMessage, TranscriptEntry } from '@/types';
import { addFacts, formatAllMemoriesForContext, getMemoriesForSpeaker } from '@/lib/memory-store';
import { runRAGPipeline, runLightRAGPipeline } from '@/lib/rag/orchestrator';
import type { RAGPipelineInput } from '@/lib/rag/types';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

// Schema for extracting facts from a single chat exchange
const chatMemorySchema = z.object({
  facts: z.array(
    z.object({
      speaker: z.string(),
      content: z.string(),
      category: z.enum(['personal', 'relationship', 'emotional', 'goal', 'preference', 'history', 'other']),
    })
  ),
});

async function extractMemoriesFromMessage(
  groqClient: ReturnType<typeof createGroq>,
  messageText: string,
  speakerName: string,
) {
  try {
    const existing = getMemoriesForSpeaker(speakerName);
    const existingContext = existing && existing.facts.length > 0
      ? `\nAlready known about ${speakerName}:\n${existing.facts.map(f => `- ${f.content}`).join('\n')}\nDo NOT re-extract these.`
      : '';

    const { object } = await generateObject({
      model: groqClient('meta-llama/llama-4-scout-17b-16e-instruct'),
      schema: chatMemorySchema,
      system: `Extract important new facts about the person from this therapy chat message. Only extract genuinely valuable information (personal details, relationship info, emotions, goals, preferences, history). Return an empty array if nothing noteworthy. Each fact is one concise sentence.${existingContext}`,
      prompt: `Speaker "${speakerName}" said: ${messageText}`,
    });

    if (object.facts.length > 0) {
      addFacts(speakerName, object.facts.map((f: { content: string; category: 'personal' | 'relationship' | 'emotional' | 'goal' | 'preference' | 'history' | 'other' }) => ({ content: f.content, category: f.category })));
      console.log(`[Memory] Extracted ${object.facts.length} fact(s) from chat message by ${speakerName}`);
    }
  } catch (err) {
    console.error('[Memory] Chat extraction failed (non-blocking):', err);
  }
}

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

export async function POST(request: NextRequest) {
  try {
    const { message, chatHistory, transcript, systemPrompt, coupleId } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY not configured' },
        { status: 500 }
      );
    }

    // ── RAG Pipeline Integration ──
    // If a coupleId is provided, run the full RAG pipeline to augment context
    let ragContext = '';
    let ragSafetyOverride: string | undefined;

    if (coupleId) {
      // Parse speaker from message
      const speakerMatch = message.match(/^\[([^\]]+)\]:\s*(.+)$/s);
      const currentSpeaker = speakerMatch ? speakerMatch[1] : undefined;
      const messageBody = speakerMatch ? speakerMatch[2] : message;

      const ragInput: RAGPipelineInput = {
        coupleId,
        currentTranscript: (transcript || []).map((e: TranscriptEntry) => ({
          speaker: e.speaker,
          text: e.text,
          timestamp: e.timestamp,
        })),
        currentMessage: messageBody,
        currentSpeaker,
        chatHistory: (chatHistory || []).map((m: ChatMessage) => ({
          role: m.role,
          speaker: m.speaker,
          text: m.text,
        })),
      };

      try {
        const ragResult = await runRAGPipeline(ragInput);

        if (ragResult.safetyOverride) {
          // Safety agent has overridden — return crisis response directly
          ragSafetyOverride = ragResult.augmentedContext;
        } else {
          ragContext = ragResult.augmentedContext;
        }
      } catch (ragErr) {
        console.error('[TherapistChat] RAG pipeline failed (non-blocking):', ragErr);
        // Fall through to standard processing
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

    // If safety override triggered, return crisis response immediately
    if (ragSafetyOverride) {
      return NextResponse.json({
        reply: ragSafetyOverride,
        safetyOverride: true,
      });
    }

    // Build context from transcript
    let context = '';
    if (transcript && Array.isArray(transcript) && transcript.length > 0) {
      context += 'Session transcript so far:\n';
      context += transcript
        .map((entry: TranscriptEntry) => `[${entry.speaker}]: ${entry.text}`)
        .join('\n');
      context += '\n\n';
    }

    // Build context from chat history
    if (chatHistory && Array.isArray(chatHistory) && chatHistory.length > 0) {
      context += 'Live chat history:\n';
      context += chatHistory
        .map((msg: ChatMessage) => {
          if (msg.role === 'therapist') {
            return `[Therapist]: ${msg.text}`;
          }
          return `[${msg.speaker || 'Unknown'}]: ${msg.text}`;
        })
        .join('\n');
      context += '\n\n';
    }

    // Inject stored memories about known speakers
    const speakerNames: string[] = [];
    if (transcript && Array.isArray(transcript)) {
      for (const entry of transcript as TranscriptEntry[]) {
        if (!speakerNames.includes(entry.speaker)) {
          speakerNames.push(entry.speaker);
        }
      }
    }
    if (chatHistory && Array.isArray(chatHistory)) {
      for (const msg of chatHistory as ChatMessage[]) {
        if (msg.speaker && !speakerNames.includes(msg.speaker)) {
          speakerNames.push(msg.speaker);
        }
      }
    }
    const memoryContext = formatAllMemoriesForContext(speakerNames);
    if (memoryContext) {
      context += memoryContext + '\n';
    }

    // Inject RAG-augmented context (relationship history, clinical supervision)
    if (ragContext) {
      context += ragContext + '\n';
    }

    const { text } = await generateText({
      model: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
      system: (typeof systemPrompt === 'string' && systemPrompt.trim())
        ? systemPrompt.trim()
        : THERAPIST_SYSTEM_PROMPT,
      prompt: `${context}The following message was just sent in the live chat. Respond as the therapist.\n\nMessage: ${message}`,
    });

    // Fire-and-forget: extract memories from this message asynchronously
    // Parse the speaker name from the message format "[Speaker]: text"
    const speakerMatch = message.match(/^\[([^\]]+)\]:\s*(.+)$/s);
    if (speakerMatch) {
      const [, speakerName, messageBody] = speakerMatch;
      extractMemoriesFromMessage(groq, messageBody, speakerName);
    }

    return NextResponse.json({ reply: text });
  } catch (error) {
    console.error('Therapist chat error:', error);

    if (error instanceof Error && error.message.includes('API key')) {
      return NextResponse.json(
        { error: 'Invalid or missing Groq API key' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to get therapist response. Please try again.' },
      { status: 500 }
    );
  }
}
