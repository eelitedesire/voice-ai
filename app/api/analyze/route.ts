import { NextRequest, NextResponse } from 'next/server';
import { SessionAnalysisUseCase } from '@/lib/application/use-cases/SessionAnalysisUseCase';
import { ExtractMemoriesUseCase } from '@/lib/application/use-cases/ExtractMemoriesUseCase';
import { memoryRepository } from '@/lib/infrastructure/persistence/JsonMemoryRepository';
import type { TranscriptEntry } from '@/lib/domain/entities';

const extractMemories = new ExtractMemoriesUseCase(memoryRepository);
const analyzeSession = new SessionAnalysisUseCase(extractMemories);

export async function POST(request: NextRequest) {
  try {
    const { transcript, systemPrompt } = await request.json();

    if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or empty transcript' },
        { status: 400 }
      );
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY not configured' },
        { status: 500 }
      );
    }

    const analysis = await analyzeSession.execute({
      transcript: transcript as TranscriptEntry[],
      systemPrompt,
    });

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error('Analysis error:', error);

    if (error instanceof Error && error.message.includes('API key')) {
      return NextResponse.json(
        { error: 'Invalid or missing Groq API key' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: 'Analysis failed. Please try again.' },
      { status: 500 }
    );
  }
}
