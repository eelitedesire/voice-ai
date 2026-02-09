/**
 * RAG Pipeline Orchestrator
 *
 * Coordinates the agentic RAG layers + Dual Vector Database in order:
 *
 *   1. Safety Agent   — deterministic scan; if CRITICAL, override everything
 *   2. Dual Vector DB — fast semantic retrieval from both knowledge layers:
 *      a. Clinical Knowledge Base (Layer 1 — "Wisdom")
 *      b. Relationship Vault Index (Layer 2 — "Identity")
 *   3. Context Retriever — fetch historical patterns from the Relationship Vault
 *   4. Clinical Supervisor — decide framework & techniques given (1) + (2) + (3)
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
  DualVectorContext,
} from './types';
import { runSafetyCheck } from './agents/safety-agent';
import { runContextRetriever, formatRetrievalContext } from './agents/context-retriever-agent';
import { runClinicalSupervisor, formatSupervisionContext } from './agents/clinical-supervisor-agent';
import { dualStreamRetrieval } from './context-merger';

/**
 * Run the full RAG pipeline.
 *
 * Execution order:
 *   1. Safety check (synchronous, deterministic) — blocks if critical
 *   2. Dual vector DB retrieval (fast, local, no LLM calls)
 *   3. Context retrieval + Clinical supervision (LLM-assisted)
 *   4. Merge all results into augmented context
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

  // ── Step 2: Dual Vector Database Retrieval (fast, no LLM) ──
  let vectorContext: DualVectorContext | undefined;
  try {
    const queryText = buildVectorQuery(input);
    const vectorResult = dualStreamRetrieval({
      coupleId: input.coupleId,
      query: queryText,
    });

    vectorContext = {
      clinicalContext: vectorResult.clinical.formattedContext,
      relationshipContext: vectorResult.relationship.formattedContext,
      mergedContext: vectorResult.mergedContext,
      redLineTriggered: vectorResult.redLineTriggered,
      vectorRetrievalTimeMs: vectorResult.processingTimeMs,
    };

    console.log(`[RAG] Vector retrieval completed in ${vectorResult.processingTimeMs}ms`);
    console.log(`  Clinical: ${vectorResult.clinical.protocols.length} protocols found`);
    console.log(`  Relationship: ${vectorResult.relationship.results.length} history items found`);
    if (vectorResult.redLineTriggered) {
      console.log('  ** RED LINE protocols triggered **');
    }
  } catch (err) {
    console.error('[RAG] Dual vector retrieval failed (non-blocking):', err);
  }

  // ── Step 3: Context Retrieval & Clinical Supervision (LLM-assisted) ──
  let contextResult: ContextRetrievalResult;
  let supervisionResult: ClinicalSupervisionResult;

  try {
    contextResult = await runContextRetriever(input);
  } catch (err) {
    console.error('[RAG] Context retrieval failed:', err);
    contextResult = emptyContextResult();
  }

  try {
    supervisionResult = await runClinicalSupervisor(input, contextResult);
  } catch (err) {
    console.error('[RAG] Clinical supervision failed:', err);
    supervisionResult = emptySupervisionResult();
  }

  // ── Step 4: Merge into augmented context ──
  const augmentedContext = buildAugmentedContext(
    safetyResult,
    contextResult,
    supervisionResult,
    vectorContext,
  );

  const result: RAGPipelineResult = {
    safety: safetyResult,
    context: contextResult,
    supervision: supervisionResult,
    vectorContext,
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

/**
 * Run only the dual vector retrieval (no LLM calls).
 * Useful for fast, local-only augmentation.
 */
export function runVectorRetrieval(input: RAGPipelineInput): DualVectorContext | null {
  try {
    const queryText = buildVectorQuery(input);
    const result = dualStreamRetrieval({
      coupleId: input.coupleId,
      query: queryText,
    });

    return {
      clinicalContext: result.clinical.formattedContext,
      relationshipContext: result.relationship.formattedContext,
      mergedContext: result.mergedContext,
      redLineTriggered: result.redLineTriggered,
      vectorRetrievalTimeMs: result.processingTimeMs,
    };
  } catch (err) {
    console.error('[RAG] Vector retrieval failed:', err);
    return null;
  }
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

/** Build a query string for vector search from the pipeline input */
function buildVectorQuery(input: RAGPipelineInput): string {
  const parts: string[] = [];

  if (input.currentMessage) {
    parts.push(input.currentMessage);
  }

  // Include recent transcript for richer context
  if (input.currentTranscript.length > 0) {
    const recent = input.currentTranscript.slice(-5);
    parts.push(recent.map(e => e.text).join(' '));
  }

  // Include recent chat messages
  if (input.chatHistory) {
    const recentChat = input.chatHistory.slice(-3);
    parts.push(recentChat.map(m => m.text).join(' '));
  }

  return parts.join(' ');
}

function buildAugmentedContext(
  safety: SafetyCheckResult,
  context: ContextRetrievalResult,
  supervision: ClinicalSupervisionResult,
  vectorContext?: DualVectorContext,
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

  // Dual Vector Database context (clinical + relationship)
  if (vectorContext?.mergedContext) {
    parts.push(vectorContext.mergedContext);
  }

  // Historical context from the vault (LLM-assisted retrieval)
  const retrievalContext = formatRetrievalContext(context);
  if (retrievalContext) {
    parts.push('\n[RELATIONSHIP HISTORY — LLM Pattern Analysis]');
    parts.push(retrievalContext);
  }

  // Clinical supervision guidance (LLM-selected framework)
  const supervisionContext = formatSupervisionContext(supervision);
  if (supervisionContext) {
    parts.push('\n[CLINICAL SUPERVISION — Framework Selection]');
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
