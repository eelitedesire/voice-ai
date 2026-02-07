import { NextRequest, NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';
import { TranscriptEntry, TherapeuticAnalysis } from '@/types';

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

const CLINICAL_SUPERVISOR_PROMPT = `You are a clinical supervisor analyzing a therapeutic session between a Therapist and a Client.

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
    const { transcript } = await request.json();

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
      system: CLINICAL_SUPERVISOR_PROMPT,
      prompt: `Analyze this therapeutic session transcript:\n\n${formattedTranscript}`,
    });

    const analysis: TherapeuticAnalysis = {
      summary: object.summary,
      mood: object.mood,
      keyBreakthroughs: object.keyBreakthroughs,
      homework: object.homework,
      concerns: object.concerns,
    };

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
