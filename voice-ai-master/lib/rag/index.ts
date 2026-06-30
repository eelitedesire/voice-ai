/**
 * Privacy-First RAG — Public API
 *
 * Re-exports the core RAG modules for clean imports:
 *
 *   import { runRAGPipeline, addSessionRecord } from '@/lib/rag';
 */

// Orchestrator
export { runRAGPipeline, runLightRAGPipeline } from './orchestrator';

// Relationship Vault
export {
  getVault,
  addSessionRecord,
  getRecentSessions,
  getRecurringTriggers,
  getEmotionalTrends,
  searchSessions,
  deleteVault,
  getSessionCount,
  formatVaultContext,
} from './relationship-vault';

// Agents (for direct use or testing)
export { runSafetyCheck, hasCriticalSafetyFlags } from './agents/safety-agent';
export { runContextRetriever, formatRetrievalContext } from './agents/context-retriever-agent';
export { runClinicalSupervisor, formatSupervisionContext } from './agents/clinical-supervisor-agent';

// Types
export type {
  RAGPipelineInput,
  RAGPipelineResult,
  SafetyCheckResult,
  SafetyFlag,
  CrisisResource,
  ContextRetrievalResult,
  PastConflictMatch,
  ClinicalSupervisionResult,
  TherapeuticFramework,
  TherapeuticTechnique,
  ConflictClassification,
  SessionRecord,
  TriggerEntry,
  EmotionalTone,
  EmotionalTrend,
  RelationshipVaultData,
  EncryptedPayload,
} from './types';
