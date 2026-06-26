/**
 * Domain Entities
 *
 * Canonical source of all domain types for the AI co-therapist platform.
 * This is the innermost layer of the onion architecture — it has zero
 * external dependencies (no I/O, no framework imports).
 *
 * All other modules should import types from here (or from the
 * re-export shims at @/types and @/lib/rag/types).
 */

// ─── Session ──────────────────────────────────────────────────────────

export interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: number;
  /** Speaker-identification diagnostics for confidence visualisation. */
  speakerInfo?: SpeakerMatchInfo;
}

/** Lightweight, serialisable speaker-match result attached to a transcript line. */
export interface SpeakerMatchInfo {
  decision: 'known' | 'uncertain' | 'unknown';
  /** Cosine similarity (-1..1) to the closest enrolled speaker. */
  score: number;
  /** Closest enrolled speaker (even if not accepted). */
  bestName: string;
  runnerUpName?: string;
  runnerUpScore?: number;
  /** Raw multi-prototype similarity (cosine domain) — separates an embedding
   *  miss (raw low) from a threshold reject (raw ok) in diagnostics. */
  rawScore?: number;
  /** Accept threshold applied to the top speaker. */
  threshold?: number;
  /** True when the temporal tracker's committed label overrode the per-segment
   *  decision (a held identity). */
  trackerOverride?: boolean;
  reason: string;
}

export interface Session {
  id: string;
  transcript: TranscriptEntry[];
  startTime: number;
  endTime?: number;
}

// ─── Analysis ─────────────────────────────────────────────────────────

export interface TherapeuticAnalysis {
  summary: string;
  mood: string;
  keyBreakthroughs: string[];
  homework: string;
  concerns?: string[];
}

// ─── Chat ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'speaker' | 'therapist';
  speaker?: string;          // name from dropdown (for role=speaker)
  text: string;
  timestamp: number;
  kind?: 'message' | 'analysis-summary';  // distinguishes regular chat from analysis posts
}

// ─── Prompts ──────────────────────────────────────────────────────────

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

// ─── Speakers ─────────────────────────────────────────────────────────

/**
 * One enrolled voice prototype: a single L2-normalized embedding plus the
 * metadata needed for quality gating, AS-Norm, and migration auditing.
 *
 * The redesign stores a *set* of these per speaker (multi-prototype) rather
 * than one averaged centroid, so intra-speaker variation is preserved instead
 * of blurred into a fragile mean.
 */
export interface SpeakerPrototype {
  /** L2-normalized embedding (unit length). */
  v: number[];
  /** Embedding dimension, captured from the model at extraction time. */
  dim: number;
  /** Seconds of audio this prototype was computed from (0 = unknown/legacy). */
  durationSec: number;
  /** 0..1 quality (RMS/SNR/length/self-consistency). 0.5 = legacy/unknown. */
  qualityScore: number;
  /** RMS energy of the source window (diagnostic; optional for legacy). */
  rms?: number;
  /** Capture time (ms epoch). */
  timestamp: number;
  /** Embedding-model identifier this prototype was produced with. */
  modelVersion: string;
  /** Optional free-form capture conditions ("close-mic", "phone", …). */
  conditions?: string;
  /** Provenance: fresh capture vs synthesized from a legacy raw embedding. */
  source: 'enrolled' | 'migrated';
}

/**
 * Per-speaker derived statistics. `cohort*` are the ENROLLMENT-SIDE AS-Norm
 * statistics (this speaker's prototypes scored against the imposter cohort),
 * precomputed so runtime only pays the test-side cost. They are valid ONLY for
 * the `cohortVersion` they were computed against — see `isCohortStale`.
 */
export interface SpeakerStats {
  /** Mean pairwise cosine among this speaker's prototypes (−1..1). */
  intraClassTightness: number;
  /** Enrollment-side AS-Norm mean (speaker prototypes vs cohort). */
  cohortMean: number;
  /** Enrollment-side AS-Norm std (speaker prototypes vs cohort). */
  cohortStd: number;
  /** Cohort version these stats were computed against. */
  cohortVersion: string;
  /** Optional per-speaker accept threshold, derived from tightness. */
  perSpeakerThreshold?: number;
}

export interface SpeakerProfile {
  id: string;
  name: string;
  role: string;
  /** Legacy single embedding (RAW). Kept for backward compatibility / rollback;
   *  new enrolments mirror prototypes[0].v here. */
  voiceprint: number[];
  /** Legacy multiple RAW embeddings. Kept for rollback; superseded by
   *  `prototypes` (which are normalized and carry metadata). */
  embeddings?: number[][];
  /** NEW canonical store: normalized embeddings + per-prototype metadata. */
  prototypes?: SpeakerPrototype[];
  /** NEW derived stats (tightness + enrollment-side AS-Norm). */
  stats?: SpeakerStats;
  /** Profile schema version, for migration auditing. */
  schemaVersion?: string;
  /**
   * Guided-enrollment lifecycle. `incomplete` until all required conditions
   * pass and the user finalizes; `complete` after. Absent ⇒ legacy profile,
   * grandfathered as usable. An `incomplete` profile is NEVER loaded for
   * matching (see isUsableForMatching), so a half-finished enrollment can't
   * quietly match.
   */
  enrollmentStatus?: 'incomplete' | 'complete';
}

export interface SpeakerDatabase {
  speakers: SpeakerProfile[];
  modelVersion: string;
  createdAt: number;
  /** Cohort version the DB's enrollment-side stats target (global default). */
  cohortVersion?: string;
  /** Schema version of the database as a whole. */
  schemaVersion?: string;
}

// ─── Memory ───────────────────────────────────────────────────────────

export interface MemoryFact {
  id: string;
  content: string;
  category: 'personal' | 'relationship' | 'emotional' | 'goal' | 'preference' | 'history' | 'other';
  extractedAt: number;
}

export interface SpeakerMemory {
  facts: MemoryFact[];
  updatedAt: number;
}

export interface MemoryDatabase {
  speakers: Record<string, SpeakerMemory>;
}

// ─── Streaming Transcription ──────────────────────────────────────────

/** Messages sent from server to client over WebSocket */
export type StreamingServerMessage =
  | { type: 'partial'; text: string; timestamp: number }
  | { type: 'final'; text: string; speaker: string; timestamp: number; speakerInfo?: SpeakerMatchInfo }
  | { type: 'vad'; isSpeaking: boolean; timestamp: number }
  | { type: 'ready' }
  | { type: 'error'; message: string };

/** Messages sent from client to server over WebSocket */
export type StreamingClientMessage =
  | { type: 'config'; sampleRate: number }
  | { type: 'stop' };

// ─── Relationship Vault ───────────────────────────────────────────────

/** A summarized record of a single therapy session stored in the vault. */
export interface SessionRecord {
  id: string;
  coupleId: string;
  date: number;
  summary: string;
  emotionalTone: EmotionalTone;
  triggers: TriggerEntry[];
  conflictPatterns: string[];
  breakthroughs: string[];
  speakerDynamics: Record<string, SpeakerSessionSnapshot>;
}

/** Emotional tone captured for a session or segment. */
export interface EmotionalTone {
  primary: string;        // e.g. "frustrated", "hopeful", "defensive"
  secondary?: string;
  intensity: number;      // 1-10 scale
  trajectory: 'escalating' | 'de-escalating' | 'stable' | 'volatile';
}

/** A recurring trigger identified across sessions. */
export interface TriggerEntry {
  id: string;
  description: string;
  category: TriggerCategory;
  frequency: number;       // how many sessions this has appeared in
  firstSeen: number;
  lastSeen: number;
  associatedSpeakers: string[];
}

export type TriggerCategory =
  | 'financial'
  | 'intimacy'
  | 'parenting'
  | 'communication'
  | 'trust'
  | 'family-of-origin'
  | 'household'
  | 'career'
  | 'health'
  | 'other';

/** Per-speaker snapshot within a session. */
export interface SpeakerSessionSnapshot {
  emotionalState: string;
  engagementLevel: 'high' | 'moderate' | 'low' | 'withdrawn';
  defensiveness: 'none' | 'mild' | 'moderate' | 'high';
  keyStatements: string[];
}

/** Aggregated emotional trend across sessions. */
export interface EmotionalTrend {
  speakerName: string;
  sessions: { date: number; tone: EmotionalTone }[];
  overallTrajectory: 'improving' | 'declining' | 'stable' | 'fluctuating';
}

/** The full vault for a couple — encrypted at rest. */
export interface RelationshipVaultData {
  coupleId: string;
  createdAt: number;
  updatedAt: number;
  sessions: SessionRecord[];
  triggers: TriggerEntry[];
  emotionalTrends: Record<string, EmotionalTrend>;
}

// ─── Safety Agent ─────────────────────────────────────────────────────

/** Result from the Safety/Refusal Agent. */
export interface SafetyCheckResult {
  safe: boolean;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  flags: SafetyFlag[];
  overrideResponse?: string;  // if critical, this replaces the AI response
  crisisResources?: CrisisResource[];
}

export interface SafetyFlag {
  type: SafetyFlagType;
  matchedContent: string;
  confidence: 'definite' | 'probable' | 'possible';
  context: string;
}

export type SafetyFlagType =
  | 'self-harm'
  | 'suicidal-ideation'
  | 'domestic-violence'
  | 'child-abuse'
  | 'substance-crisis'
  | 'homicidal-ideation'
  | 'severe-dissociation';

export interface CrisisResource {
  name: string;
  phone?: string;
  text?: string;
  url?: string;
  description: string;
}

// ─── Context Retriever Agent ──────────────────────────────────────────

/** Result from the Context Retriever Agent. */
export interface ContextRetrievalResult {
  relevantSessions: SessionRecord[];
  recurringTriggers: TriggerEntry[];
  emotionalTrends: EmotionalTrend[];
  patternSummary: string;
  similarPastConflicts: PastConflictMatch[];
}

export interface PastConflictMatch {
  sessionId: string;
  date: number;
  similarity: number;   // 0-1
  summary: string;
  whatHelped?: string;
  whatEscalated?: string;
}

// ─── Clinical Supervisor Agent ────────────────────────────────────────

/** Result from the Clinical Supervisor Agent. */
export interface ClinicalSupervisionResult {
  selectedFramework: TherapeuticFramework;
  reasoning: string;
  techniques: TherapeuticTechnique[];
  suggestedInterventions: string[];
  deEscalationNeeded: boolean;
  conflictClassification: ConflictClassification;
}

export type TherapeuticFramework =
  | 'de-escalation'
  | 'gottman-method'
  | 'emotionally-focused'
  | 'cbt-couples'
  | 'narrative-therapy'
  | 'solution-focused'
  | 'trauma-informed'
  | 'psychodynamic'
  | 'imago-therapy';

export interface TherapeuticTechnique {
  name: string;
  description: string;
  framework: TherapeuticFramework;
  whenToUse: string;
}

export type ConflictClassification =
  | 'escalation'
  | 'withdrawal'
  | 'criticism'
  | 'contempt'
  | 'stonewalling'
  | 'defensiveness'
  | 'flooding'
  | 'repair-attempt'
  | 'productive-discussion'
  | 'neutral';

// ─── RAG Orchestrator ─────────────────────────────────────────────────

/** Combined result from all RAG agents + dual vector database. */
export interface RAGPipelineResult {
  safety: SafetyCheckResult;
  context: ContextRetrievalResult;
  supervision: ClinicalSupervisionResult;
  /** Dual vector database context (clinical + relationship layers) */
  vectorContext?: DualVectorContext;
  /** Merged context string ready to inject into the therapist LLM prompt. */
  augmentedContext: string;
  /** If true, the safety agent has overridden normal flow. */
  safetyOverride: boolean;
  processingTimeMs: number;
}

/** Result from the dual-stream vector retrieval. */
export interface DualVectorContext {
  /** Formatted context from the Clinical Knowledge Base (Layer 1) */
  clinicalContext: string;
  /** Formatted context from the Relationship Vault Index (Layer 2) */
  relationshipContext: string;
  /** Full merged context string for LLM injection */
  mergedContext: string;
  /** Whether a red-line safety protocol was triggered */
  redLineTriggered: boolean;
  /** Processing time for vector retrieval */
  vectorRetrievalTimeMs: number;
}

/** Input to the RAG pipeline. */
export interface RAGPipelineInput {
  coupleId: string;
  currentTranscript: { speaker: string; text: string; timestamp: number }[];
  currentMessage?: string;
  currentSpeaker?: string;
  chatHistory?: { role: string; speaker?: string; text: string }[];
}

// ─── Encryption ───────────────────────────────────────────────────────

/** Wrapper for encrypted data stored on disk. */
export interface EncryptedPayload {
  version: number;
  algorithm: string;
  iv: string;       // base64
  authTag: string;  // base64
  ciphertext: string; // base64
  createdAt: number;
}
