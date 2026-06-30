/**
 * Relationship Vector Index — Layer 2: The "Identity" Layer
 *
 * A dynamic, write-heavy vector database that acts as the AI's "long-term
 * memory" for a specific couple. Unlike the Clinical Knowledge Base (static),
 * this layer grows with each session.
 *
 * Data indexed:
 * - Session summaries (episodic memory)
 * - Trigger patterns with metadata tags [Theme: X], [Emotion: Y], [Speaker: Z]
 * - Breakthroughs and what worked
 * - Conflict patterns and what escalated
 * - Love Language map for each partner
 * - Emotional trajectories over time
 *
 * Usage:
 *   When the current fight is about "doing the dishes," the index retrieves
 *   that dishes are actually a proxy for "feeling unappreciated" — a theme
 *   identified in Session 3.
 */

import { VectorStore, VectorDocument, VectorSearchResult } from './vector-store';
import { TFIDFEmbedder } from './embeddings';
import {
  RelationshipVaultData,
  SessionRecord,
  TriggerEntry,
  EmotionalTrend,
} from './types';
import { getVault } from './relationship-vault';

// ─── Types ──────────────────────────────────────────────────────────

export type VaultDocumentType =
  | 'session-summary'
  | 'trigger'
  | 'breakthrough'
  | 'conflict-pattern'
  | 'speaker-dynamic'
  | 'emotional-trend';

export interface RelationshipSearchResult {
  type: VaultDocumentType;
  content: string;
  score: number;
  sessionId?: string;
  sessionDate?: number;
  speaker?: string;
  metadata: Record<string, unknown>;
}

export interface LoveLanguageEntry {
  speaker: string;
  primary: string;
  secondary?: string;
  evidence: string[];
}

export interface ConflictTimelineEntry {
  sessionId: string;
  date: number;
  topic: string;
  outcome: 'breakthrough' | 'escalation' | 'stalemate' | 'partial-resolution';
  whatWorked?: string;
  whatFailed?: string;
}

// ─── Relationship Vector Index ──────────────────────────────────────

const RELATIONSHIP_EMBEDDING_DIMS = 256;

export class RelationshipVectorIndex {
  private vectorStore: VectorStore;
  private embedder: TFIDFEmbedder;
  private coupleId: string;
  private initialized: boolean = false;
  private conflictTimeline: ConflictTimelineEntry[] = [];
  private loveLanguages: Map<string, LoveLanguageEntry> = new Map();

  constructor(coupleId: string) {
    this.coupleId = coupleId;
    this.vectorStore = new VectorStore({
      dimensions: RELATIONSHIP_EMBEDDING_DIMS,
    });
    this.embedder = new TFIDFEmbedder({
      dimensions: RELATIONSHIP_EMBEDDING_DIMS,
      useBigrams: true,
    });
  }

  /** Build the index from the existing vault data */
  buildFromVault(): void {
    const vault = getVault(this.coupleId);
    this.buildFromVaultData(vault);
  }

  /** Build the index from provided vault data (for testing or when vault is already loaded) */
  buildFromVaultData(vault: RelationshipVaultData): void {
    if (vault.sessions.length === 0) {
      this.initialized = true;
      return;
    }

    // Build training corpus from all vault text
    const corpus = this.buildCorpus(vault);
    this.embedder.fit(corpus);

    // Index all documents
    const docs: VectorDocument[] = [];
    docs.push(...this.indexSessions(vault.sessions));
    docs.push(...this.indexTriggers(vault.triggers));
    docs.push(...this.indexEmotionalTrends(vault.emotionalTrends));

    this.vectorStore.insertBatch(docs);

    // Build the conflict timeline
    this.buildConflictTimeline(vault.sessions);

    this.initialized = true;
    console.log(`[RelIndex] Built index for couple "${this.coupleId}": ${this.vectorStore.size} documents`);
  }

  /** Add a new session to the index (incremental update) */
  addSession(session: SessionRecord): void {
    this.ensureInitialized();

    // Re-fit the embedder with the new content
    const sessionText = this.sessionToText(session);
    const existingDocs = this.vectorStore.export();
    const allTexts = [...existingDocs.map(d => d.content), sessionText];
    this.embedder.fit(allTexts);

    // Re-embed all existing documents with updated vocabulary
    const reindexed = existingDocs.map(doc => ({
      ...doc,
      embedding: this.embedder.embed(doc.content),
    }));
    this.vectorStore.load(reindexed);

    // Add new session documents
    const newDocs = this.indexSessions([session]);
    for (const doc of newDocs) {
      this.vectorStore.upsert(doc);
    }

    // Update conflict timeline
    this.addToConflictTimeline(session);
  }

  /**
   * Search the relationship history.
   *
   * @param query - What to search for (e.g., "feeling unappreciated about household chores")
   * @param topK - Maximum results
   * @param minScore - Minimum relevance threshold
   * @param type - Optional filter by document type
   */
  search(
    query: string,
    topK: number = 10,
    minScore: number = 0.1,
    type?: VaultDocumentType,
  ): RelationshipSearchResult[] {
    this.ensureInitialized();

    if (this.vectorStore.size === 0) {
      return [];
    }

    const queryEmbedding = this.embedder.embed(query);
    const filters = type
      ? [{ field: 'type', value: type }]
      : undefined;

    const results = this.vectorStore.search(queryEmbedding, topK, minScore, filters);

    return results.map(r => ({
      type: r.metadata.type as VaultDocumentType,
      content: r.content,
      score: r.score,
      sessionId: r.metadata.sessionId as string | undefined,
      sessionDate: r.metadata.sessionDate as number | undefined,
      speaker: r.metadata.speaker as string | undefined,
      metadata: r.metadata,
    }));
  }

  /** Search specifically for past conflicts similar to the current situation */
  searchSimilarConflicts(currentConflictDescription: string, topK: number = 5): RelationshipSearchResult[] {
    return this.search(currentConflictDescription, topK, 0.15, 'conflict-pattern');
  }

  /** Search for breakthroughs that might be relevant */
  searchBreakthroughs(topic: string, topK: number = 5): RelationshipSearchResult[] {
    return this.search(topic, topK, 0.1, 'breakthrough');
  }

  /** Search triggers by theme */
  searchTriggers(theme: string, topK: number = 5): RelationshipSearchResult[] {
    return this.search(theme, topK, 0.1, 'trigger');
  }

  /** Get the conflict timeline */
  getConflictTimeline(): ConflictTimelineEntry[] {
    return [...this.conflictTimeline].sort((a, b) => b.date - a.date);
  }

  /** Get love language mapping for all speakers */
  getLoveLanguages(): LoveLanguageEntry[] {
    return Array.from(this.loveLanguages.values());
  }

  /** Update a speaker's love language entry */
  updateLoveLanguage(entry: LoveLanguageEntry): void {
    this.loveLanguages.set(entry.speaker, entry);
  }

  /** Format search results for LLM context injection */
  formatForContext(results: RelationshipSearchResult[], maxResults: number = 5): string {
    if (results.length === 0) return '';

    const parts: string[] = [];
    const topResults = results.slice(0, maxResults);

    for (const result of topResults) {
      const dateStr = result.sessionDate
        ? new Date(result.sessionDate).toLocaleDateString()
        : '';
      const prefix = dateStr ? `[${dateStr}]` : '';
      const typeLabel = result.type.replace(/-/g, ' ');
      const score = Math.round(result.score * 100);

      parts.push(`${prefix} (${typeLabel}, ${score}% relevant) ${result.content}`);
    }

    return parts.join('\n');
  }

  /** Format conflict timeline for LLM context */
  formatTimelineForContext(maxEntries: number = 5): string {
    const timeline = this.getConflictTimeline().slice(0, maxEntries);
    if (timeline.length === 0) return '';

    const parts: string[] = ['Conflict timeline:'];
    for (const entry of timeline) {
      const date = new Date(entry.date).toLocaleDateString();
      parts.push(`  [${date}] ${entry.topic} → ${entry.outcome}`);
      if (entry.whatWorked) parts.push(`    Helped: ${entry.whatWorked}`);
      if (entry.whatFailed) parts.push(`    Escalated: ${entry.whatFailed}`);
    }

    return parts.join('\n');
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  get documentCount(): number {
    return this.vectorStore.size;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.buildFromVault();
    }
  }

  // ── Internal: Corpus Building ─────────────────────────────────

  private buildCorpus(vault: RelationshipVaultData): string[] {
    const corpus: string[] = [];

    for (const session of vault.sessions) {
      corpus.push(this.sessionToText(session));

      for (const breakthrough of session.breakthroughs) {
        corpus.push(breakthrough);
      }
      for (const pattern of session.conflictPatterns) {
        corpus.push(pattern);
      }
    }

    for (const trigger of vault.triggers) {
      corpus.push(`${trigger.description} ${trigger.category}`);
    }

    for (const trend of Object.values(vault.emotionalTrends)) {
      const tones = trend.sessions.map(s => s.tone.primary).join(' ');
      corpus.push(`${trend.speakerName} emotional trend ${trend.overallTrajectory} ${tones}`);
    }

    return corpus;
  }

  private sessionToText(session: SessionRecord): string {
    const parts = [
      session.summary,
      ...session.conflictPatterns,
      ...session.breakthroughs,
      ...session.triggers.map(t => `${t.description} ${t.category}`),
    ];

    for (const [speaker, dynamics] of Object.entries(session.speakerDynamics)) {
      parts.push(`${speaker}: ${dynamics.emotionalState} ${dynamics.engagementLevel} ${dynamics.keyStatements.join(' ')}`);
    }

    return parts.join(' ');
  }

  // ── Internal: Indexing ────────────────────────────────────────

  private indexSessions(sessions: SessionRecord[]): VectorDocument[] {
    const docs: VectorDocument[] = [];

    for (const session of sessions) {
      // Index the session summary
      const summaryText = session.summary;
      docs.push({
        id: `session-${session.id}`,
        embedding: this.embedder.embed(summaryText),
        content: summaryText,
        metadata: {
          type: 'session-summary' as VaultDocumentType,
          sessionId: session.id,
          sessionDate: session.date,
          emotionalIntensity: session.emotionalTone.intensity,
          trajectory: session.emotionalTone.trajectory,
        },
      });

      // Index each breakthrough separately
      for (let i = 0; i < session.breakthroughs.length; i++) {
        const text = session.breakthroughs[i];
        docs.push({
          id: `breakthrough-${session.id}-${i}`,
          embedding: this.embedder.embed(text),
          content: text,
          metadata: {
            type: 'breakthrough' as VaultDocumentType,
            sessionId: session.id,
            sessionDate: session.date,
          },
        });
      }

      // Index each conflict pattern separately
      for (let i = 0; i < session.conflictPatterns.length; i++) {
        const text = session.conflictPatterns[i];
        docs.push({
          id: `conflict-${session.id}-${i}`,
          embedding: this.embedder.embed(text),
          content: text,
          metadata: {
            type: 'conflict-pattern' as VaultDocumentType,
            sessionId: session.id,
            sessionDate: session.date,
          },
        });
      }

      // Index speaker dynamics
      for (const [speaker, dynamics] of Object.entries(session.speakerDynamics)) {
        const text = `${speaker}: ${dynamics.emotionalState}. Engagement: ${dynamics.engagementLevel}. Defensiveness: ${dynamics.defensiveness}. ${dynamics.keyStatements.join(' ')}`;
        docs.push({
          id: `speaker-${session.id}-${speaker}`,
          embedding: this.embedder.embed(text),
          content: text,
          metadata: {
            type: 'speaker-dynamic' as VaultDocumentType,
            sessionId: session.id,
            sessionDate: session.date,
            speaker,
            engagementLevel: dynamics.engagementLevel,
            defensiveness: dynamics.defensiveness,
          },
        });
      }
    }

    return docs;
  }

  private indexTriggers(triggers: TriggerEntry[]): VectorDocument[] {
    return triggers.map(trigger => {
      const text = `Trigger: ${trigger.description}. Category: ${trigger.category}. Seen ${trigger.frequency} times. Speakers: ${trigger.associatedSpeakers.join(', ')}`;
      return {
        id: `trigger-${trigger.id}`,
        embedding: this.embedder.embed(text),
        content: text,
        metadata: {
          type: 'trigger' as VaultDocumentType,
          triggerId: trigger.id,
          category: trigger.category,
          frequency: trigger.frequency,
          speakers: trigger.associatedSpeakers,
        },
      };
    });
  }

  private indexEmotionalTrends(trends: Record<string, EmotionalTrend>): VectorDocument[] {
    const docs: VectorDocument[] = [];

    for (const [speaker, trend] of Object.entries(trends)) {
      const recentTones = trend.sessions.slice(-5).map(s => s.tone.primary);
      const text = `${speaker} emotional trajectory: ${trend.overallTrajectory}. Recent emotions: ${recentTones.join(', ')}`;
      docs.push({
        id: `trend-${speaker}`,
        embedding: this.embedder.embed(text),
        content: text,
        metadata: {
          type: 'emotional-trend' as VaultDocumentType,
          speaker,
          trajectory: trend.overallTrajectory,
        },
      });
    }

    return docs;
  }

  // ── Internal: Conflict Timeline ───────────────────────────────

  private buildConflictTimeline(sessions: SessionRecord[]): void {
    this.conflictTimeline = [];
    for (const session of sessions) {
      this.addToConflictTimeline(session);
    }
  }

  private addToConflictTimeline(session: SessionRecord): void {
    if (session.conflictPatterns.length === 0 && session.breakthroughs.length === 0) {
      return;
    }

    const outcome: ConflictTimelineEntry['outcome'] =
      session.breakthroughs.length > 0 && session.emotionalTone.trajectory === 'de-escalating'
        ? 'breakthrough'
        : session.emotionalTone.trajectory === 'escalating'
          ? 'escalation'
          : session.breakthroughs.length > 0
            ? 'partial-resolution'
            : 'stalemate';

    this.conflictTimeline.push({
      sessionId: session.id,
      date: session.date,
      topic: session.conflictPatterns[0] || session.summary.slice(0, 100),
      outcome,
      whatWorked: session.breakthroughs.length > 0 ? session.breakthroughs[0] : undefined,
      whatFailed: session.emotionalTone.trajectory === 'escalating'
        ? session.conflictPatterns[0]
        : undefined,
    });
  }
}

// ─── Index Cache ────────────────────────────────────────────────────

const indexCache = new Map<string, RelationshipVectorIndex>();

/** Get or create a relationship vector index for a couple */
export function getRelationshipIndex(coupleId: string): RelationshipVectorIndex {
  let index = indexCache.get(coupleId);
  if (!index) {
    index = new RelationshipVectorIndex(coupleId);
    index.buildFromVault();
    indexCache.set(coupleId, index);
  }
  return index;
}

/** Invalidate the cached index for a couple (call after vault updates) */
export function invalidateRelationshipIndex(coupleId: string): void {
  indexCache.delete(coupleId);
}

/** Clear all cached indexes */
export function clearIndexCache(): void {
  indexCache.clear();
}
