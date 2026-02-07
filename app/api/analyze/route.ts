import { NextRequest, NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';
import { TranscriptEntry, TherapeuticAnalysis } from '@/types';
import { addFacts, getMemoriesForSpeaker } from '@/lib/memory-store';

// Initialize Groq provider
const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

// Define the analysis schema
const analysisSchema = z.object({
  summary: z.string().describe('A concise summary of the therapeutic session'),
  mood: z.string().describe('The overall mood or emotional state of the client'),
  keyBreakthroughs: z
    .array(z.string())
    .describe('Key emotional breakthroughs or insights from the session'),
  homework: z
    .string()
    .describe('A specific homework assignment for the client to work on before the next session'),
  concerns: z
    .array(z.string())
    .optional()
    .describe('Any areas of concern that require follow-up or immediate attention'),
});

// Schema for memory extraction (runs asynchronously after analysis)
const memorySchema = z.object({
  speakers: z.array(
    z.object({
      name: z.string(),
      facts: z.array(
        z.object({
          content: z.string(),
          category: z.enum(['personal', 'relationship', 'emotional', 'goal', 'preference', 'history', 'other']),
        })
      ),
    })
  ),
});

async function extractAndStoreMemories(formattedTranscript: string, speakerNames: string[]) {
  try {
    // Build existing-facts context so the LLM skips duplicates
    const existingParts: string[] = [];
    for (const name of speakerNames) {
      const mem = getMemoriesForSpeaker(name);
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
      model: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
      schema: memorySchema,
      system: `You extract important facts about people from therapy transcripts. Extract personal details, relationship dynamics, emotional patterns, goals, preferences, and history. Each fact should be a single concise sentence. Only extract genuinely new or important information.${existingContext}`,
      prompt: `Extract facts about each person from this transcript:\n\n${formattedTranscript}`,
    });

    for (const speaker of object.speakers) {
      if (speaker.facts.length > 0) {
        addFacts(speaker.name, speaker.facts);
      }
    }
    console.log('[Memory] Extracted memories from session analysis');
  } catch (err) {
    console.error('[Memory] Extraction failed (non-blocking):', err);
  }
}

const DEFAULT_CLINICAL_SUPERVISOR_PROMPT = `You are a clinical supervisor analyzing a therapeutic session between a Therapist and a Client.

Your role is to:
1. Identify key emotional breakthroughs and patterns
2. Assess the client's emotional state and mood
3. Suggest actionable homework assignments that build on session insights
4. Flag any concerns that require immediate attention (e.g., safety issues, crisis indicators)

Guidelines:
- Be compassionate yet objective
- Focus on evidence from the transcript
- Provide specific, actionable recommendations
- Use trauma-informed language
- Consider cultural sensitivity

Analyze the following transcript and provide a structured clinical assessment.`;

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

    // Format transcript for analysis
    const formattedTranscript = transcript
      .map((entry: TranscriptEntry) => `[${entry.speaker}]: ${entry.text}`)
      .join('\n');

    // Generate structured analysis using Groq
    const { object } = await generateObject({
      model: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
      schema: analysisSchema,
      system: (typeof systemPrompt === 'string' && systemPrompt.trim())
        ? systemPrompt.trim()
        : DEFAULT_CLINICAL_SUPERVISOR_PROMPT,
      prompt: `Analyze this therapeutic session transcript:\n\n${formattedTranscript}`,
    });

    const analysis: TherapeuticAnalysis = {
      summary: object.summary,
      mood: object.mood,
      keyBreakthroughs: object.keyBreakthroughs,
      homework: object.homework,
      concerns: object.concerns,
    };

    // Fire-and-forget: extract memories from this session asynchronously
    const speakerNames = [...new Set(transcript.map((e: TranscriptEntry) => e.speaker))];
    extractAndStoreMemories(formattedTranscript, speakerNames);

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
