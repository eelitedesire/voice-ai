/**
 * Session Analysis Use Case
 *
 * Encapsulates the logic for analysing a completed therapy session.
 * Previously inline in app/api/analyze/route.ts.
 */
import { generateObject } from 'ai';
import { z } from 'zod';
import type { TranscriptEntry, TherapeuticAnalysis } from '@/lib/domain/entities';
import { ExtractMemoriesUseCase } from './ExtractMemoriesUseCase';
import { groqClient, LLM_MODEL } from '@/lib/infrastructure/llm/GroqLLMService';

// ── Schema ────────────────────────────────────────────────────────────

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

// ── Default prompt ────────────────────────────────────────────────────

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

// ── Use Case ──────────────────────────────────────────────────────────

export interface SessionAnalysisInput {
  transcript: TranscriptEntry[];
  systemPrompt?: string;
}

export class SessionAnalysisUseCase {
  constructor(private readonly extractMemories: ExtractMemoriesUseCase) {}

  async execute(input: SessionAnalysisInput): Promise<TherapeuticAnalysis> {
    const { transcript, systemPrompt } = input;

    const formattedTranscript = transcript
      .map(entry => `[${entry.speaker}]: ${entry.text}`)
      .join('\n');

    const { object } = await generateObject({
      model: groqClient(LLM_MODEL),
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

    // Fire-and-forget memory extraction — do not block the response
    const speakerNames = [...new Set(transcript.map(e => e.speaker))];
    this.extractMemories.extractFromTranscript(transcript, speakerNames);

    return analysis;
  }
}
