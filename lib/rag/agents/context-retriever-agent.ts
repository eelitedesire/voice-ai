/**
 * Context Retriever Agent
 *
 * Searches the Relationship Vault for historical patterns relevant to the
 * current conversation. Identifies recurring triggers, similar past conflicts,
 * and emotional trends to give the AI therapist longitudinal awareness.
 *
 * Example: "This looks like the fight they had about money 3 weeks ago."
 */

import { generateObject } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';
import {
  ContextRetrievalResult,
  PastConflictMatch,
  SessionRecord,
  TriggerEntry,
  EmotionalTrend,
  RAGPipelineInput,
} from '../types';
import {
  getVault,
  getRecentSessions,
  getRecurringTriggers,
  getEmotionalTrends,
  searchSessions,
} from '../relationship-vault';

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

// Schema for LLM-assisted pattern matching
const patternAnalysisSchema = z.object({
  currentTopics: z.array(z.string()).describe('Main topics/themes in the current conversation'),
  currentEmotionalState: z.string().describe('The emotional state in the current exchange'),
  searchTerms: z.array(z.string()).describe('Keywords to search for in past sessions'),
  patternSummary: z.string().describe('Summary of how current conversation relates to known patterns'),
  similarityNotes: z.array(
    z.object({
      sessionId: z.string(),
      similarity: z.number().min(0).max(1),
      explanation: z.string(),
      whatHelped: z.string().optional(),
      whatEscalated: z.string().optional(),
    })
  ).describe('Assessments of how similar past sessions are to the current situation'),
});

/**
 * Run the Context Retriever Agent.
 *
 * 1. Pulls recent sessions and recurring triggers from the vault
 * 2. Uses the LLM to identify which past patterns match the current context
 * 3. Returns relevant historical context for the therapist
 */
export async function runContextRetriever(
  input: RAGPipelineInput,
): Promise<ContextRetrievalResult> {
  const { coupleId, currentTranscript, currentMessage, chatHistory } = input;

  // Step 1: Gather vault data
  const recentSessions = getRecentSessions(coupleId, 10);
  const recurringTriggers = getRecurringTriggers(coupleId);
  const emotionalTrends = getEmotionalTrends(coupleId);

  // If the vault is empty, return an empty result
  if (recentSessions.length === 0) {
    return {
      relevantSessions: [],
      recurringTriggers: [],
      emotionalTrends: Object.values(emotionalTrends),
      patternSummary: 'No prior session history available for this couple.',
      similarPastConflicts: [],
    };
  }

  // Step 2: Build current context string
  const currentContext = buildCurrentContext(currentTranscript, currentMessage, chatHistory);

  // Step 3: Build vault summary for LLM analysis
  const vaultSummary = buildVaultSummary(recentSessions, recurringTriggers);

  // Step 4: Use LLM to find patterns
  let patternAnalysis;
  try {
    const { object } = await generateObject({
      model: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
      schema: patternAnalysisSchema,
      system: `You are a clinical pattern recognition specialist. You analyze the current therapy conversation and compare it against past session records to identify:
1. Whether the current conflict resembles any past conflicts
2. What topics/triggers are recurring
3. What interventions helped or escalated in similar past situations

Be precise about similarity scores:
- 0.8-1.0: Very similar conflict (same topic, same dynamics)
- 0.5-0.7: Moderately similar (related topic or similar emotional pattern)
- 0.2-0.4: Loosely related
- 0.0-0.1: Not related

Only include sessions with similarity > 0.3.`,
      prompt: `CURRENT CONVERSATION:
${currentContext}

PAST SESSION RECORDS:
${vaultSummary}

KNOWN RECURRING TRIGGERS:
${recurringTriggers.map(t => `- ${t.description} (${t.category}, seen ${t.frequency}x)`).join('\n') || 'None recorded yet'}

Analyze the current conversation against the historical record. Identify patterns, similarities, and relevant context.`,
    });

    patternAnalysis = object;
  } catch (err) {
    console.error('[ContextRetriever] LLM analysis failed, falling back to keyword search:', err);
    return buildFallbackResult(
      currentContext,
      recentSessions,
      recurringTriggers,
      emotionalTrends,
      coupleId,
    );
  }

  // Step 5: Build similar past conflict matches
  const similarPastConflicts: PastConflictMatch[] = patternAnalysis.similarityNotes
    .filter(note => note.similarity > 0.3)
    .map(note => {
      const session = recentSessions.find(s => s.id === note.sessionId);
      return {
        sessionId: note.sessionId,
        date: session?.date ?? 0,
        similarity: note.similarity,
        summary: note.explanation,
        whatHelped: note.whatHelped,
        whatEscalated: note.whatEscalated,
      };
    })
    .sort((a, b) => b.similarity - a.similarity);

  // Step 6: Also do keyword-based search for terms the LLM identified
  const keywordMatches = new Set<string>();
  for (const term of patternAnalysis.searchTerms) {
    const results = searchSessions(coupleId, term);
    for (const r of results) {
      keywordMatches.add(r.id);
    }
  }

  // Merge LLM-identified and keyword-identified relevant sessions
  const relevantSessionIds = new Set([
    ...similarPastConflicts.map(c => c.sessionId),
    ...keywordMatches,
  ]);

  const relevantSessions = recentSessions.filter(s => relevantSessionIds.has(s.id));

  // Filter triggers relevant to current topics
  const currentTopicsLower = patternAnalysis.currentTopics.map(t => t.toLowerCase());
  const relevantTriggers = recurringTriggers.filter(t =>
    currentTopicsLower.some(topic =>
      t.description.toLowerCase().includes(topic) ||
      t.category.toLowerCase().includes(topic)
    ) || t.frequency >= 3 // Always include highly recurring triggers
  );

  return {
    relevantSessions,
    recurringTriggers: relevantTriggers,
    emotionalTrends: Object.values(emotionalTrends),
    patternSummary: patternAnalysis.patternSummary,
    similarPastConflicts,
  };
}

/**
 * Format the retrieval result into a string for LLM context injection.
 */
export function formatRetrievalContext(result: ContextRetrievalResult): string {
  if (result.relevantSessions.length === 0 && result.recurringTriggers.length === 0) {
    return '';
  }

  const parts: string[] = [];

  if (result.patternSummary) {
    parts.push(`Pattern analysis: ${result.patternSummary}`);
  }

  if (result.similarPastConflicts.length > 0) {
    parts.push('\nSimilar past conflicts:');
    for (const conflict of result.similarPastConflicts.slice(0, 3)) {
      const date = conflict.date ? new Date(conflict.date).toLocaleDateString() : 'unknown';
      parts.push(`  [${date}, ${Math.round(conflict.similarity * 100)}% similar] ${conflict.summary}`);
      if (conflict.whatHelped) parts.push(`    What helped: ${conflict.whatHelped}`);
      if (conflict.whatEscalated) parts.push(`    What escalated: ${conflict.whatEscalated}`);
    }
  }

  if (result.recurringTriggers.length > 0) {
    parts.push('\nActive triggers:');
    for (const t of result.recurringTriggers.slice(0, 5)) {
      parts.push(`  - ${t.description} (${t.category}, seen ${t.frequency}x)`);
    }
  }

  if (result.emotionalTrends.length > 0) {
    parts.push('\nEmotional trends:');
    for (const trend of result.emotionalTrends) {
      const recent = trend.sessions.slice(-3).map(s => s.tone.primary).join(' -> ');
      parts.push(`  ${trend.speakerName}: ${trend.overallTrajectory} (recent: ${recent || 'n/a'})`);
    }
  }

  return parts.join('\n');
}

// ─── Internal Helpers ────────────────────────────────────────────────

function buildCurrentContext(
  transcript: RAGPipelineInput['currentTranscript'],
  currentMessage?: string,
  chatHistory?: RAGPipelineInput['chatHistory'],
): string {
  const parts: string[] = [];

  if (transcript.length > 0) {
    // Only include recent transcript (last 20 utterances for efficiency)
    const recent = transcript.slice(-20);
    parts.push('Recent transcript:');
    parts.push(recent.map(e => `[${e.speaker}]: ${e.text}`).join('\n'));
  }

  if (chatHistory && chatHistory.length > 0) {
    const recentChat = chatHistory.slice(-10);
    parts.push('\nRecent chat:');
    parts.push(recentChat.map(m => `[${m.speaker || m.role}]: ${m.text}`).join('\n'));
  }

  if (currentMessage) {
    parts.push(`\nLatest message: ${currentMessage}`);
  }

  return parts.join('\n');
}

function buildVaultSummary(sessions: SessionRecord[], triggers: TriggerEntry[]): string {
  if (sessions.length === 0) return 'No past sessions recorded.';

  return sessions.map(s => {
    const date = new Date(s.date).toLocaleDateString();
    const lines = [`Session ${s.id} (${date}): ${s.summary}`];
    if (s.conflictPatterns.length > 0) {
      lines.push(`  Conflict patterns: ${s.conflictPatterns.join(', ')}`);
    }
    if (s.breakthroughs.length > 0) {
      lines.push(`  Breakthroughs: ${s.breakthroughs.join(', ')}`);
    }
    lines.push(`  Emotional tone: ${s.emotionalTone.primary} (intensity ${s.emotionalTone.intensity}/10, ${s.emotionalTone.trajectory})`);
    return lines.join('\n');
  }).join('\n\n');
}

function buildFallbackResult(
  currentContext: string,
  sessions: SessionRecord[],
  triggers: TriggerEntry[],
  emotionalTrends: Record<string, EmotionalTrend>,
  coupleId: string,
): ContextRetrievalResult {
  // Simple keyword extraction from current context
  const words = currentContext.toLowerCase().split(/\s+/);
  const keyTopics = ['money', 'sex', 'trust', 'kids', 'children', 'work', 'family',
    'drink', 'alcohol', 'lie', 'lying', 'cheat', 'affair', 'angry', 'scared'];
  const matchedTopics = keyTopics.filter(t => words.some(w => w.includes(t)));

  let relevantSessions: SessionRecord[] = [];
  for (const topic of matchedTopics) {
    relevantSessions.push(...searchSessions(coupleId, topic));
  }
  // Deduplicate
  const seen = new Set<string>();
  relevantSessions = relevantSessions.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  return {
    relevantSessions,
    recurringTriggers: triggers.slice(0, 5),
    emotionalTrends: Object.values(emotionalTrends),
    patternSummary: matchedTopics.length > 0
      ? `Current discussion touches on: ${matchedTopics.join(', ')}. Keyword-based matching used (LLM unavailable).`
      : 'Unable to perform deep pattern analysis. Providing general context.',
    similarPastConflicts: [],
  };
}
