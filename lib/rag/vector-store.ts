/**
 * Vector Store — In-Memory Vector Database Engine
 *
 * Provides efficient cosine similarity search over dense vector embeddings.
 * Used by both the Clinical Knowledge Base (static) and the Relationship
 * Vault index (dynamic) layers.
 *
 * Features:
 * - Cosine similarity search with configurable top-K
 * - Metadata filtering
 * - Batch insert/upsert
 * - Serialization for persistence
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface VectorDocument {
  id: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  content: string;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  content: string;
  metadata: Record<string, unknown>;
}

export interface VectorStoreOptions {
  dimensions: number;
  /** If true, the store is read-only after initialization (e.g., clinical knowledge) */
  readonly?: boolean;
}

export interface MetadataFilter {
  field: string;
  value: unknown;
  operator?: 'eq' | 'ne' | 'in' | 'contains';
}

// ─── Vector Math ────────────────────────────────────────────────────

/** Compute dot product of two vectors */
function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/** Compute L2 (Euclidean) magnitude of a vector */
function magnitude(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

/**
 * Cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 means identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct(a, b) / (magA * magB);
}

/** Normalize a vector to unit length */
export function normalizeVector(v: number[]): number[] {
  const mag = magnitude(v);
  if (mag === 0) return v;
  return v.map(x => x / mag);
}

// ─── Vector Store ───────────────────────────────────────────────────

export class VectorStore {
  private documents: Map<string, VectorDocument> = new Map();
  private readonly dimensions: number;
  private readonly isReadonly: boolean;

  constructor(options: VectorStoreOptions) {
    this.dimensions = options.dimensions;
    this.isReadonly = options.readonly ?? false;
  }

  /** Number of documents in the store */
  get size(): number {
    return this.documents.size;
  }

  /** Insert a single document. Throws if readonly or duplicate ID. */
  insert(doc: VectorDocument): void {
    if (this.isReadonly) {
      throw new Error('Cannot insert into a readonly vector store');
    }
    this.validateEmbedding(doc.embedding);
    if (this.documents.has(doc.id)) {
      throw new Error(`Document with ID "${doc.id}" already exists`);
    }
    this.documents.set(doc.id, {
      ...doc,
      embedding: normalizeVector(doc.embedding),
    });
  }

  /** Insert or update a document */
  upsert(doc: VectorDocument): void {
    if (this.isReadonly) {
      throw new Error('Cannot upsert into a readonly vector store');
    }
    this.validateEmbedding(doc.embedding);
    this.documents.set(doc.id, {
      ...doc,
      embedding: normalizeVector(doc.embedding),
    });
  }

  /** Insert multiple documents at once */
  insertBatch(docs: VectorDocument[]): void {
    for (const doc of docs) {
      this.upsert(doc);
    }
  }

  /** Delete a document by ID */
  delete(id: string): boolean {
    if (this.isReadonly) {
      throw new Error('Cannot delete from a readonly vector store');
    }
    return this.documents.delete(id);
  }

  /** Check if a document exists */
  has(id: string): boolean {
    return this.documents.has(id);
  }

  /** Get a document by ID */
  get(id: string): VectorDocument | undefined {
    return this.documents.get(id);
  }

  /**
   * Search for the top-K most similar documents to the query embedding.
   *
   * @param queryEmbedding - The query vector
   * @param topK - Maximum number of results to return
   * @param minScore - Minimum similarity score threshold (0-1)
   * @param filters - Optional metadata filters
   */
  search(
    queryEmbedding: number[],
    topK: number = 5,
    minScore: number = 0.0,
    filters?: MetadataFilter[],
  ): VectorSearchResult[] {
    this.validateEmbedding(queryEmbedding);
    const normalizedQuery = normalizeVector(queryEmbedding);

    const results: VectorSearchResult[] = [];

    for (const doc of this.documents.values()) {
      // Apply metadata filters
      if (filters && !this.matchesFilters(doc, filters)) {
        continue;
      }

      const score = cosineSimilarity(normalizedQuery, doc.embedding);
      if (score >= minScore) {
        results.push({
          id: doc.id,
          score,
          content: doc.content,
          metadata: doc.metadata,
        });
      }
    }

    // Sort by score descending, return top-K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** Clear all documents (not allowed on readonly stores) */
  clear(): void {
    if (this.isReadonly) {
      throw new Error('Cannot clear a readonly vector store');
    }
    this.documents.clear();
  }

  /** Export all documents for serialization */
  export(): VectorDocument[] {
    return Array.from(this.documents.values());
  }

  /** Load documents from serialized data (bypasses readonly for initialization) */
  load(docs: VectorDocument[]): void {
    this.documents.clear();
    for (const doc of docs) {
      this.validateEmbedding(doc.embedding);
      this.documents.set(doc.id, {
        ...doc,
        embedding: normalizeVector(doc.embedding),
      });
    }
  }

  /** Get all document IDs */
  ids(): string[] {
    return Array.from(this.documents.keys());
  }

  // ── Internal ──────────────────────────────────────────────────────

  private validateEmbedding(embedding: number[]): void {
    if (embedding.length !== this.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`
      );
    }
  }

  private matchesFilters(doc: VectorDocument, filters: MetadataFilter[]): boolean {
    for (const filter of filters) {
      const value = doc.metadata[filter.field];
      const op = filter.operator ?? 'eq';

      switch (op) {
        case 'eq':
          if (value !== filter.value) return false;
          break;
        case 'ne':
          if (value === filter.value) return false;
          break;
        case 'in':
          if (!Array.isArray(filter.value) || !filter.value.includes(value)) return false;
          break;
        case 'contains':
          if (typeof value !== 'string' || !value.includes(String(filter.value))) return false;
          break;
      }
    }
    return true;
  }
}
