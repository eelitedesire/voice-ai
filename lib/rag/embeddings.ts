/**
 * Embedding Service — Text-to-Vector Conversion
 *
 * Provides a local TF-IDF-based embedding engine that operates without
 * external API calls. This enables fast, privacy-preserving semantic search
 * for both the Clinical Knowledge Base and the Relationship Vault.
 *
 * The TF-IDF approach works well for our domain-specific vocabulary
 * (therapeutic terms, emotional language) since the corpus is focused
 * and well-structured.
 *
 * Architecture:
 * - TFIDFEmbedder: Local, deterministic embeddings (no API needed)
 * - EmbeddingService: Facade that manages embedders for each store layer
 */

// ─── Text Processing ────────────────────────────────────────────────

/** Tokenize and normalize text for embedding */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1)
    .filter(token => !STOP_WORDS.has(token));
}

/** Generate n-grams from tokens */
function ngrams(tokens: string[], n: number): string[] {
  const result: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    result.push(tokens.slice(i, i + n).join('_'));
  }
  return result;
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'of', 'to', 'in', 'for', 'on', 'at',
  'by', 'or', 'as', 'be', 'do', 'if', 'so', 'up', 'no', 'am', 'we',
  'us', 'he', 'me', 'my', 'was', 'are', 'has', 'had', 'did', 'not',
  'but', 'its', 'his', 'her', 'she', 'him', 'our', 'who', 'how',
  'can', 'may', 'all', 'any', 'own', 'too', 'get', 'got', 'let',
  'say', 'see', 'new', 'now', 'way', 'use', 'two', 'than', 'them',
  'then', 'this', 'that', 'with', 'from', 'been', 'have', 'here',
  'just', 'like', 'also', 'will', 'more', 'very', 'what', 'when',
  'each', 'make', 'some', 'does', 'into', 'over', 'such', 'take',
  'only', 'come', 'made', 'after', 'their', 'these', 'would', 'about',
  'could', 'other', 'which', 'there', 'those', 'being', 'should',
]);

// ─── TF-IDF Embedder ───────────────────────────────────────────────

export interface TFIDFConfig {
  /** Number of dimensions for output vectors */
  dimensions: number;
  /** Include bigrams in the vocabulary */
  useBigrams?: boolean;
  /** Include trigrams in the vocabulary */
  useTrigrams?: boolean;
}

/**
 * TF-IDF based text embedder.
 *
 * Builds a vocabulary from training documents, then converts any text
 * to a fixed-dimension vector via TF-IDF weighting + dimensionality
 * reduction using feature hashing.
 */
export class TFIDFEmbedder {
  private vocabulary: Map<string, number> = new Map(); // term -> IDF weight
  private documentFrequency: Map<string, number> = new Map();
  private totalDocuments: number = 0;
  private readonly dimensions: number;
  private readonly useBigrams: boolean;
  private readonly useTrigrams: boolean;
  private built: boolean = false;

  constructor(config: TFIDFConfig) {
    this.dimensions = config.dimensions;
    this.useBigrams = config.useBigrams ?? true;
    this.useTrigrams = config.useTrigrams ?? false;
  }

  /** Train the embedder on a corpus of documents */
  fit(documents: string[]): void {
    this.documentFrequency.clear();
    this.vocabulary.clear();
    this.totalDocuments = documents.length;

    // Count document frequency for each term
    for (const doc of documents) {
      const terms = this.extractTerms(doc);
      const uniqueTerms = new Set(terms);
      for (const term of uniqueTerms) {
        this.documentFrequency.set(
          term,
          (this.documentFrequency.get(term) ?? 0) + 1
        );
      }
    }

    // Compute IDF for each term
    for (const [term, df] of this.documentFrequency.entries()) {
      const idf = Math.log((this.totalDocuments + 1) / (df + 1)) + 1;
      this.vocabulary.set(term, idf);
    }

    this.built = true;
  }

  /** Convert text to a fixed-dimension embedding vector */
  embed(text: string): number[] {
    if (!this.built) {
      throw new Error('Embedder has not been fitted. Call fit() first.');
    }

    const terms = this.extractTerms(text);
    const termCounts = new Map<string, number>();

    for (const term of terms) {
      termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
    }

    // Build sparse TF-IDF vector, then project to fixed dimensions via hashing
    const vector = new Array(this.dimensions).fill(0);
    const totalTerms = terms.length || 1;

    for (const [term, count] of termCounts.entries()) {
      const tf = count / totalTerms;
      const idf = this.vocabulary.get(term) ?? Math.log(this.totalDocuments + 1);
      const tfidf = tf * idf;

      // Feature hashing: map term to dimension index using a hash
      const hash = this.hashTerm(term);
      const idx = Math.abs(hash) % this.dimensions;
      // Use sign of secondary hash for sign randomization (reduces collision impact)
      const sign = this.hashTerm(term + '_sign') % 2 === 0 ? 1 : -1;
      vector[idx] += tfidf * sign;
    }

    // L2 normalize
    const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    if (mag > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= mag;
      }
    }

    return vector;
  }

  /** Embed multiple texts at once */
  embedBatch(texts: string[]): number[][] {
    return texts.map(t => this.embed(t));
  }

  /** Get the vocabulary size */
  get vocabSize(): number {
    return this.vocabulary.size;
  }

  /** Export the embedder state for serialization */
  exportState(): {
    vocabulary: [string, number][];
    documentFrequency: [string, number][];
    totalDocuments: number;
    dimensions: number;
    useBigrams: boolean;
    useTrigrams: boolean;
  } {
    return {
      vocabulary: Array.from(this.vocabulary.entries()),
      documentFrequency: Array.from(this.documentFrequency.entries()),
      totalDocuments: this.totalDocuments,
      dimensions: this.dimensions,
      useBigrams: this.useBigrams,
      useTrigrams: this.useTrigrams,
    };
  }

  /** Load the embedder from serialized state */
  loadState(state: ReturnType<TFIDFEmbedder['exportState']>): void {
    this.vocabulary = new Map(state.vocabulary);
    this.documentFrequency = new Map(state.documentFrequency);
    this.totalDocuments = state.totalDocuments;
    this.built = true;
  }

  // ── Internal ──────────────────────────────────────────────────────

  private extractTerms(text: string): string[] {
    const tokens = tokenize(text);
    const terms = [...tokens];
    if (this.useBigrams) {
      terms.push(...ngrams(tokens, 2));
    }
    if (this.useTrigrams) {
      terms.push(...ngrams(tokens, 3));
    }
    return terms;
  }

  /** Simple string hash (djb2) */
  private hashTerm(term: string): number {
    let hash = 5381;
    for (let i = 0; i < term.length; i++) {
      hash = ((hash << 5) + hash + term.charCodeAt(i)) | 0;
    }
    return hash;
  }
}

// ─── Embedding Service ──────────────────────────────────────────────

const EMBEDDING_DIMENSIONS = 256;

/**
 * Embedding Service facade.
 *
 * Manages separate TF-IDF embedders for clinical and relationship contexts.
 * The clinical embedder is trained once on therapeutic protocol text.
 * The relationship embedder adapts to each couple's vocabulary over time.
 */
export class EmbeddingService {
  private clinicalEmbedder: TFIDFEmbedder;
  private relationshipEmbedder: TFIDFEmbedder;
  private initialized: boolean = false;

  constructor() {
    this.clinicalEmbedder = new TFIDFEmbedder({
      dimensions: EMBEDDING_DIMENSIONS,
      useBigrams: true,
      useTrigrams: true,
    });
    this.relationshipEmbedder = new TFIDFEmbedder({
      dimensions: EMBEDDING_DIMENSIONS,
      useBigrams: true,
    });
  }

  /** Get the dimensionality of output vectors */
  get dimensions(): number {
    return EMBEDDING_DIMENSIONS;
  }

  /** Initialize the clinical embedder with training corpus */
  fitClinical(documents: string[]): void {
    this.clinicalEmbedder.fit(documents);
    this.initialized = true;
  }

  /** Initialize the relationship embedder with a couple's history */
  fitRelationship(documents: string[]): void {
    this.relationshipEmbedder.fit(documents);
  }

  /** Embed text using the clinical vocabulary */
  embedClinical(text: string): number[] {
    if (!this.initialized) {
      throw new Error('Clinical embedder not initialized. Call fitClinical() first.');
    }
    return this.clinicalEmbedder.embed(text);
  }

  /** Embed text using the relationship vocabulary */
  embedRelationship(text: string): number[] {
    return this.relationshipEmbedder.embed(text);
  }

  /** Embed text for clinical search (batch) */
  embedClinicalBatch(texts: string[]): number[][] {
    return this.clinicalEmbedder.embedBatch(texts);
  }

  /** Embed text for relationship search (batch) */
  embedRelationshipBatch(texts: string[]): number[][] {
    return this.relationshipEmbedder.embedBatch(texts);
  }

  /** Export state for persistence */
  exportState(): {
    clinical: ReturnType<TFIDFEmbedder['exportState']>;
    relationship: ReturnType<TFIDFEmbedder['exportState']>;
  } {
    return {
      clinical: this.clinicalEmbedder.exportState(),
      relationship: this.relationshipEmbedder.exportState(),
    };
  }

  /** Load state from persistence */
  loadState(state: ReturnType<EmbeddingService['exportState']>): void {
    this.clinicalEmbedder.loadState(state.clinical);
    this.relationshipEmbedder.loadState(state.relationship);
    this.initialized = true;
  }
}

/** Singleton instance for the application */
let embeddingServiceInstance: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!embeddingServiceInstance) {
    embeddingServiceInstance = new EmbeddingService();
  }
  return embeddingServiceInstance;
}
