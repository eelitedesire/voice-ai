/**
 * Context Merger — Dual-Stream Retrieval System
 *
 * When the user sends a message, the system performs a Dual-Stream Retrieval:
 *
 *   Stream A (Clinical): "What is the best psychological way to handle Contempt?"
 *   Stream B (Relationship): "Has this couple dealt with Contempt before? What worked?"
 *
 * The Context Merger combines both streams into a unified prompt:
 *   "You are a therapist. The clinical best practice for Contempt is X.
 *    This couple previously found success using Y.
 *    Based on their history of Z, suggest a path forward."
 *
 * Benefits:
 * - Prevents Hallucination: AI follows retrieved Gottman/EFT instructions
 * - Continuity: Couple doesn't repeat themselves; AI "knows" their history
 * - Safety: Red Line protocols from Layer 1 trigger immediate crisis referral
 */

import { getClinicalKnowledgeBase, ClinicalSearchResult } from './clinical-knowledge-base';
import {
  getRelationshipIndex,
  RelationshipSearchResult,
} from './relationship-vector-index';

// ─── Types ──────────────────────────────────────────────────────────

export interface DualStreamQuery {
  /** The couple's identifier */
  coupleId: string;
  /** The current message or situation to analyze */
  query: string;
  /** Optional: specific therapeutic framework to bias toward */
  preferredFramework?: string;
  /** Maximum clinical results */
  clinicalTopK?: number;
  /** Maximum relationship results */
  relationshipTopK?: number;
}

export interface DualStreamResult {
  /** Results from the Clinical Knowledge Base (Layer 1) */
  clinical: {
    protocols: ClinicalSearchResult[];
    redLineProtocols: ClinicalSearchResult[];
    formattedContext: string;
  };
  /** Results from the Relationship Vault Index (Layer 2) */
  relationship: {
    results: RelationshipSearchResult[];
    breakthroughs: RelationshipSearchResult[];
    triggers: RelationshipSearchResult[];
    conflictTimeline: string;
    formattedContext: string;
  };
  /** The merged context string ready for LLM prompt injection */
  mergedContext: string;
  /** Whether any red-line safety protocols were triggered */
  redLineTriggered: boolean;
  /** Processing time in ms */
  processingTimeMs: number;
}

// ─── Context Merger ─────────────────────────────────────────────────

/**
 * Perform dual-stream retrieval from both the Clinical Knowledge Base
 * and the Relationship Vault Index.
 */
export function dualStreamRetrieval(query: DualStreamQuery): DualStreamResult {
  const startTime = Date.now();

  const clinicalTopK = query.clinicalTopK ?? 5;
  const relationshipTopK = query.relationshipTopK ?? 10;

  // ── Stream A: Clinical Knowledge Base (The "Wisdom" Layer) ──
  const clinicalKB = getClinicalKnowledgeBase();

  const clinicalProtocols = clinicalKB.search(
    query.query,
    clinicalTopK,
    0.1,
    query.preferredFramework,
  );

  const redLineProtocols = clinicalKB.searchRedLine(query.query);
  const redLineTriggered = redLineProtocols.length > 0 &&
    redLineProtocols.some(r => r.relevanceScore > 0.3);

  const clinicalContext = clinicalKB.formatForContext(clinicalProtocols);

  // ── Stream B: Relationship Vault Index (The "Identity" Layer) ──
  const relIndex = getRelationshipIndex(query.coupleId);

  const relationshipResults = relIndex.search(query.query, relationshipTopK);
  const breakthroughs = relIndex.searchBreakthroughs(query.query, 3);
  const triggers = relIndex.searchTriggers(query.query, 3);
  const conflictTimeline = relIndex.formatTimelineForContext(5);

  const relationshipContext = relIndex.formatForContext(relationshipResults);

  // ── Merge Both Streams ──
  const mergedContext = buildMergedContext({
    clinicalContext,
    relationshipContext,
    conflictTimeline,
    redLineTriggered,
    redLineProtocols: redLineProtocols.length > 0
      ? clinicalKB.formatForContext(redLineProtocols)
      : '',
    breakthroughs: breakthroughs.length > 0
      ? relIndex.formatForContext(breakthroughs, 3)
      : '',
    triggers: triggers.length > 0
      ? relIndex.formatForContext(triggers, 3)
      : '',
  });

  return {
    clinical: {
      protocols: clinicalProtocols,
      redLineProtocols,
      formattedContext: clinicalContext,
    },
    relationship: {
      results: relationshipResults,
      breakthroughs,
      triggers,
      conflictTimeline,
      formattedContext: relationshipContext,
    },
    mergedContext,
    redLineTriggered,
    processingTimeMs: Date.now() - startTime,
  };
}

// ─── Prompt Construction ────────────────────────────────────────────

interface MergeInput {
  clinicalContext: string;
  relationshipContext: string;
  conflictTimeline: string;
  redLineTriggered: boolean;
  redLineProtocols: string;
  breakthroughs: string;
  triggers: string;
}

function buildMergedContext(input: MergeInput): string {
  const parts: string[] = [];

  parts.push('\n=== Dual Vector Database Context ===');

  // Red Line check (highest priority)
  if (input.redLineTriggered) {
    parts.push('\n[RED LINE — SAFETY PROTOCOL ACTIVATED]');
    parts.push('Crisis indicators detected. Review the following safety protocols:');
    parts.push(input.redLineProtocols);
    parts.push('IMPORTANT: Prioritize safety over therapeutic technique. Consider referral to crisis resources.\n');
  }

  // Stream A: Clinical guidance
  if (input.clinicalContext) {
    parts.push('\n[CLINICAL KNOWLEDGE BASE — Best Practice Guidance]');
    parts.push('The following therapeutic protocols are relevant to the current situation:');
    parts.push(input.clinicalContext);
  }

  // Stream B: Relationship history
  if (input.relationshipContext) {
    parts.push('\n[RELATIONSHIP VAULT — Couple-Specific History]');
    parts.push('Relevant episodes from this couple\'s history:');
    parts.push(input.relationshipContext);
  }

  // Breakthroughs (what has worked before)
  if (input.breakthroughs) {
    parts.push('\n[PAST BREAKTHROUGHS — What Has Worked]');
    parts.push(input.breakthroughs);
  }

  // Active triggers
  if (input.triggers) {
    parts.push('\n[KNOWN TRIGGERS]');
    parts.push(input.triggers);
  }

  // Conflict timeline
  if (input.conflictTimeline) {
    parts.push('\n[CONFLICT TIMELINE]');
    parts.push(input.conflictTimeline);
  }

  // Instruction for the LLM
  parts.push('\n[INTEGRATION GUIDANCE]');
  parts.push('Use the clinical protocols as your therapeutic foundation.');
  parts.push('Adapt your approach based on what has worked (and not worked) for this specific couple.');
  parts.push('Reference their history naturally — they should feel heard and remembered.');
  parts.push('If safety protocols are triggered, prioritize safety over all other considerations.');

  parts.push('\n=== End Dual Vector Database Context ===\n');

  return parts.join('\n');
}

/**
 * Quick search for clinical protocols only (no relationship context).
 * Useful for general therapeutic guidance without couple-specific data.
 */
export function clinicalSearch(
  query: string,
  topK: number = 5,
  framework?: string,
): ClinicalSearchResult[] {
  const clinicalKB = getClinicalKnowledgeBase();
  return clinicalKB.search(query, topK, 0.1, framework);
}

/**
 * Quick search for relationship history only.
 * Useful when you only need couple-specific context.
 */
export function relationshipSearch(
  coupleId: string,
  query: string,
  topK: number = 10,
): RelationshipSearchResult[] {
  const relIndex = getRelationshipIndex(coupleId);
  return relIndex.search(query, topK);
}
