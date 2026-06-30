import { NextRequest, NextResponse } from 'next/server';
import { TherapistChatUseCase } from '@/lib/application/use-cases/TherapistChatUseCase';
import { ExtractMemoriesUseCase } from '@/lib/application/use-cases/ExtractMemoriesUseCase';
import { memoryRepository } from '@/lib/infrastructure/persistence/JsonMemoryRepository';
import type { ChatMessage, TranscriptEntry } from '@/lib/domain/entities';

const extractMemories = new ExtractMemoriesUseCase(memoryRepository);
const therapistChat = new TherapistChatUseCase(memoryRepository, extractMemories);

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

    const result = await therapistChat.execute({
      message,
      chatHistory: chatHistory as ChatMessage[] | undefined,
      transcript: transcript as TranscriptEntry[] | undefined,
      systemPrompt,
      coupleId,
    });

    return NextResponse.json(result);
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
