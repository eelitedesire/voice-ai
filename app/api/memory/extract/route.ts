import { NextRequest, NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';
import { addFacts, getMemoriesForSpeaker } from '@/lib/memory-store';
import { TranscriptEntry } from '@/types';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

const memoryExtractionSchema = z.object({
  speakers: z.array(
    z.object({
      name: z.string().describe('The speaker name exactly as it appears in the transcript'),
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
          ]).describe('Category of the fact'),
        })
      ).describe('New facts learned about this person from the conversation'),
    })
  ),
});

const EXTRACTION_PROMPT = `You are a memory extraction system for a therapy platform. Your job is to identify and extract important factual information about each person mentioned in the conversation.

Extract facts that would be valuable to remember across therapy sessions, such as:
- Personal details (name, age, occupation, family members, living situation)
- Relationship dynamics (who they are to each other, conflicts, strengths)
- Emotional patterns (recurring feelings, triggers, coping mechanisms)
- Goals (therapy goals, life goals, things they want to change)
- Preferences (communication style, things that help/harm)
- History (past events, trauma, milestones, previous therapy)
- Other relevant information

Guidelines:
- Each fact should be a single, concise sentence
- Only extract genuinely new or important information
- Do not extract trivial small talk
- Do not extract the therapist's own statements as facts about them
- Focus on information that would help a therapist in future sessions`;

export async function POST(request: NextRequest) {
  try {
    const { transcript, text, speakers: speakerHint } = await request.json();

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY not configured' },
        { status: 500 }
      );
    }

    // Build the conversation text to analyze
    let conversationText = '';

    if (transcript && Array.isArray(transcript) && transcript.length > 0) {
      conversationText = transcript
        .map((entry: TranscriptEntry) => `[${entry.speaker}]: ${entry.text}`)
        .join('\n');
    } else if (text && typeof text === 'string') {
      conversationText = text;
    } else {
      return NextResponse.json(
        { error: 'Either transcript or text is required' },
        { status: 400 }
      );
    }

    // Build context about existing memories so the LLM avoids extracting duplicates
    let existingContext = '';
    if (speakerHint && Array.isArray(speakerHint)) {
      const parts: string[] = [];
      for (const name of speakerHint) {
        const mem = getMemoriesForSpeaker(name);
        if (mem && mem.facts.length > 0) {
          const existing = mem.facts.map(f => `- ${f.content}`).join('\n');
          parts.push(`Already known about ${name}:\n${existing}`);
        }
      }
      if (parts.length > 0) {
        existingContext = `\n\nThe following facts are already stored. Do NOT re-extract these — only extract genuinely new information:\n${parts.join('\n\n')}`;
      }
    }

    const { object } = await generateObject({
      model: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
      schema: memoryExtractionSchema,
      system: EXTRACTION_PROMPT + existingContext,
      prompt: `Extract valuable facts about each person from this conversation:\n\n${conversationText}`,
    });

    // Store extracted facts
    let totalAdded = 0;
    const results: Record<string, number> = {};

    for (const speaker of object.speakers) {
      if (speaker.facts.length > 0) {
        const added = addFacts(speaker.name, speaker.facts);
        totalAdded += added.length;
        results[speaker.name] = added.length;
      }
    }

    return NextResponse.json({
      extracted: object.speakers,
      stored: results,
      totalAdded,
    });
  } catch (error) {
    console.error('Memory extraction error:', error);
    return NextResponse.json(
      { error: 'Memory extraction failed' },
      { status: 500 }
    );
  }
}
