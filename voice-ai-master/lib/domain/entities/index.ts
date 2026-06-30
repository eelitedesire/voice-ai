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

export interface SpeakerProfile {
  id: string;
  name: string;
  role: string;
  voiceprint: number[];
}

export interface SpeakerDatabase {
  speakers: SpeakerProfile[];
  modelVersion: string;
  createdAt: number;
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
  | { type: 'final'; text: string; speaker: string; timestamp: number }
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
