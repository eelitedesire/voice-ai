/**
 * RAG Pipeline Orchestrator
 *
 * Coordinates the three agentic RAG layers in the correct order:
 *
 *   1. Safety Agent   — deterministic scan; if CRITICAL, override everything
 *   2. Context Retriever — fetch historical patterns from the Relationship Vault
 *   3. Clinical Supervisor — decide framework & techniques given (1) + (2)
 *
 * The orchestrator merges all results into a single augmented context string
 * that gets injected into the therapist LLM prompt.
 */

import {
  RAGPipelineInput,
  RAGPipelineResult,
  SafetyCheckResult,
  ContextRetrievalResult,
  ClinicalSupervisionResult,
} from './types';
import { runSafetyCheck } from './agents/safety-agent';
import { runContextRetriever, formatRetrievalContext } from './agents/context-retriever-agent';
import { runClinicalSupervisor, formatSupervisionContext } from './agents/clinical-supervisor-agent';

/**
 * Run the full RAG pipeline.
 *
 * Execution order:
 *   1. Safety check (synchronous, deterministic) — blocks if critical
 *   2. Context retrieval + Clinical supervision (can run in parallel if safety passes)
 *   3. Merge all results into augmented context
 */
export async function runRAGPipeline(input: RAGPipelineInput): Promise<RAGPipelineResult> {
  const startTime = Date.now();

  // ── Step 1: Safety Check (fast, deterministic) ──
  const textsToCheck = collectTextsForSafety(input);
  const safetyResult = runSafetyCheck(textsToCheck);

  // If critical, short-circuit — the override response replaces the AI
  if (safetyResult.severity === 'critical') {
    console.log('[RAG] Critical safety flag — overriding pipeline');
    return {
      safety: safetyResult,
      context: emptyContextResult(),
      supervision: emptySupervisionResult(),
      augmentedContext: safetyResult.overrideResponse || '',
      safetyOverride: true,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // ── Step 2: Context Retrieval & Clinical Supervision ──
  // Run in parallel for speed. The supervisor also receives retrieval results
  // for informed decision-making, so we run retrieval first, then supervision.
  let contextResult: ContextRetrievalResult;
  let supervisionResult: ClinicalSupervisionResult;

  try {
    // Context retrieval first (needs vault data)
    contextResult = await runContextRetriever(input);
  } catch (err) {
    console.error('[RAG] Context retrieval failed:', err);
    contextResult = emptyContextResult();
  }

  try {
    // Clinical supervision (uses retrieval results for better decisions)
    supervisionResult = await runClinicalSupervisor(input, contextResult);
  } catch (err) {
    console.error('[RAG] Clinical supervision failed:', err);
    supervisionResult = emptySupervisionResult();
  }

  // ── Step 3: Merge into augmented context ──
  const augmentedContext = buildAugmentedContext(
    safetyResult,
    contextResult,
    supervisionResult,
  );

  const result: RAGPipelineResult = {
    safety: safetyResult,
    context: contextResult,
    supervision: supervisionResult,
    augmentedContext,
    safetyOverride: false,
    processingTimeMs: Date.now() - startTime,
  };

  console.log(`[RAG] Pipeline completed in ${result.processingTimeMs}ms`);
  console.log(`  Safety: ${safetyResult.severity} (${safetyResult.flags.length} flags)`);
  console.log(`  Context: ${contextResult.relevantSessions.length} relevant sessions, ${contextResult.similarPastConflicts.length} similar conflicts`);
  console.log(`  Supervision: ${supervisionResult.selectedFramework} (${supervisionResult.conflictClassification})`);

  return result;
}

/**
 * Run a lightweight version of the pipeline (safety only + cached context).
 * Use this for high-frequency calls (e.g., per chat message) where full
 * retrieval + supervision would be too slow.
 */
export async function runLightRAGPipeline(input: RAGPipelineInput): Promise<{
  safety: SafetyCheckResult;
  safetyOverride: boolean;
  overrideResponse?: string;
}> {
  const textsToCheck = collectTextsForSafety(input);
  const safetyResult = runSafetyCheck(textsToCheck);

  return {
    safety: safetyResult,
    safetyOverride: safetyResult.severity === 'critical',
    overrideResponse: safetyResult.overrideResponse,
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────

function collectTextsForSafety(input: RAGPipelineInput): string[] {
  const texts: string[] = [];

  // Current message is the highest priority
  if (input.currentMessage) {
    texts.push(input.currentMessage);
  }

  // Recent transcript entries
  if (input.currentTranscript.length > 0) {
    const recent = input.currentTranscript.slice(-10);
    texts.push(...recent.map(e => e.text));
  }

  // Recent chat messages
  if (input.chatHistory) {
    const recentChat = input.chatHistory.slice(-5);
    texts.push(...recentChat.map(m => m.text));
  }

  return texts;
}

function buildAugmentedContext(
  safety: SafetyCheckResult,
  context: ContextRetrievalResult,
  supervision: ClinicalSupervisionResult,
): string {
  const parts: string[] = [];

  parts.push('\n=== RAG Context (Privacy-First Retrieval) ===');

  // Safety warnings (non-critical, since critical short-circuits)
  if (!safety.safe && safety.flags.length > 0) {
    parts.push('\n[SAFETY NOTICE]');
    parts.push(`Severity: ${safety.severity}`);
    parts.push('Detected concerns:');
    for (const flag of safety.flags) {
      parts.push(`  - ${flag.type} (${flag.confidence}): Monitor carefully`);
    }
    if (safety.crisisResources && safety.crisisResources.length > 0) {
      parts.push('Be prepared to share crisis resources if the topic deepens.');
    }
  }

  // Historical context from the vault
  const retrievalContext = formatRetrievalContext(context);
  if (retrievalContext) {
    parts.push('\n[RELATIONSHIP HISTORY]');
    parts.push(retrievalContext);
  }

  // Clinical supervision guidance
  const supervisionContext = formatSupervisionContext(supervision);
  if (supervisionContext) {
    parts.push('\n[CLINICAL SUPERVISION]');
    parts.push(supervisionContext);
  }

  parts.push('\n=== End RAG Context ===\n');

  return parts.join('\n');
}

function emptyContextResult(): ContextRetrievalResult {
  return {
    relevantSessions: [],
    recurringTriggers: [],
    emotionalTrends: [],
    patternSummary: '',
    similarPastConflicts: [],
  };
}

function emptySupervisionResult(): ClinicalSupervisionResult {
  return {
    selectedFramework: 'solution-focused',
    reasoning: 'Default framework (pipeline unavailable)',
    techniques: [],
    suggestedInterventions: [],
    deEscalationNeeded: false,
    conflictClassification: 'neutral',
  };
}
