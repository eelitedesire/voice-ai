import { NextRequest, NextResponse } from 'next/server';
import { ExtractMemoriesUseCase } from '@/lib/application/use-cases/ExtractMemoriesUseCase';
import { memoryRepository } from '@/lib/infrastructure/persistence/JsonMemoryRepository';
import type { TranscriptEntry } from '@/lib/domain/entities';

const extractMemories = new ExtractMemoriesUseCase(memoryRepository);

export async function POST(request: NextRequest) {
  try {
    const { transcript, text, speakers: speakerHint } = await request.json();

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY not configured' },
        { status: 500 }
      );
    }

    // Determine the set of transcript entries and speaker names to process
    let entries: TranscriptEntry[];
    let speakerNames: string[];

    if (transcript && Array.isArray(transcript) && transcript.length > 0) {
      entries = transcript as TranscriptEntry[];
      speakerNames = speakerHint ?? [...new Set(entries.map((e: TranscriptEntry) => e.speaker))];
    } else if (text && typeof text === 'string') {
      // Wrap free-form text as a single unnamed entry so extractFromTranscript can process it
      entries = [{ speaker: 'Unknown', text, timestamp: Date.now() }];
      speakerNames = speakerHint ?? ['Unknown'];
    } else {
      return NextResponse.json(
        { error: 'Either transcript or text is required' },
        { status: 400 }
      );
    }

    await extractMemories.extractFromTranscript(entries, speakerNames);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Memory extraction error:', error);
    return NextResponse.json(
      { error: 'Memory extraction failed' },
      { status: 500 }
    );
  }
}
