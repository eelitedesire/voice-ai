import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { ChatMessage, TranscriptEntry } from '@/types';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

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
    const { message, chatHistory, transcript, systemPrompt } = await request.json();

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

    const { text } = await generateText({
      model: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
      system: (typeof systemPrompt === 'string' && systemPrompt.trim())
        ? systemPrompt.trim()
        : THERAPIST_SYSTEM_PROMPT,
      prompt: `${context}The following message was just sent in the live chat. Respond as the therapist.\n\nMessage: ${message}`,
    });

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
