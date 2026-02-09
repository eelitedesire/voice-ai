/**
 * Tests for the Vector Store Engine
 */

import {
  VectorStore,
  cosineSimilarity,
  normalizeVector,
  VectorDocument,
} from '../../lib/rag/vector-store';

describe('Vector Math', () => {
  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const v = [1, 2, 3, 4];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
    });

    it('should return 0 for zero vectors', () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('should be symmetric', () => {
      const a = [1, 2, 3];
      const b = [4, 5, 6];
      expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
    });

    it('should be scale invariant', () => {
      const a = [1, 2, 3];
      const b = [2, 4, 6]; // same direction, double magnitude
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });
  });

  describe('normalizeVector', () => {
    it('should produce a unit vector', () => {
      const v = normalizeVector([3, 4]);
      const magnitude = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    it('should handle zero vectors', () => {
      const v = normalizeVector([0, 0, 0]);
      expect(v).toEqual([0, 0, 0]);
    });

    it('should preserve direction', () => {
      const v = [3, 4, 0];
      const norm = normalizeVector(v);
      expect(norm[0] / norm[1]).toBeCloseTo(v[0] / v[1], 5);
    });
  });
});

describe('VectorStore', () => {
  const dims = 4;

  function makeDoc(id: string, embedding: number[], meta: Record<string, unknown> = {}): VectorDocument {
    return { id, embedding, content: `Content for ${id}`, metadata: meta };
  }

  describe('Basic Operations', () => {
    it('should insert and retrieve documents', () => {
      const store = new VectorStore({ dimensions: dims });
      const doc = makeDoc('doc1', [1, 0, 0, 0]);
      store.insert(doc);

      expect(store.size).toBe(1);
      expect(store.has('doc1')).toBe(true);
      expect(store.get('doc1')?.content).toBe('Content for doc1');
    });

    it('should reject duplicate IDs on insert', () => {
      const store = new VectorStore({ dimensions: dims });
      store.insert(makeDoc('doc1', [1, 0, 0, 0]));
      expect(() => store.insert(makeDoc('doc1', [0, 1, 0, 0]))).toThrow('already exists');
    });

    it('should allow upsert of existing IDs', () => {
      const store = new VectorStore({ dimensions: dims });
      store.upsert(makeDoc('doc1', [1, 0, 0, 0]));
      store.upsert(makeDoc('doc1', [0, 1, 0, 0]));
      expect(store.size).toBe(1);
    });

    it('should delete documents', () => {
      const store = new VectorStore({ dimensions: dims });
      store.insert(makeDoc('doc1', [1, 0, 0, 0]));
      expect(store.delete('doc1')).toBe(true);
      expect(store.size).toBe(0);
      expect(store.delete('doc1')).toBe(false);
    });

    it('should validate embedding dimensions', () => {
      const store = new VectorStore({ dimensions: dims });
      expect(() => store.insert(makeDoc('doc1', [1, 0]))).toThrow('dimension mismatch');
    });

    it('should support batch insert', () => {
      const store = new VectorStore({ dimensions: dims });
      store.insertBatch([
        makeDoc('a', [1, 0, 0, 0]),
        makeDoc('b', [0, 1, 0, 0]),
        makeDoc('c', [0, 0, 1, 0]),
      ]);
      expect(store.size).toBe(3);
    });
  });

  describe('Readonly Mode', () => {
    it('should prevent insert on readonly store', () => {
      const store = new VectorStore({ dimensions: dims, readonly: true });
      expect(() => store.insert(makeDoc('doc1', [1, 0, 0, 0]))).toThrow('readonly');
    });

    it('should allow load on readonly store (for initialization)', () => {
      const store = new VectorStore({ dimensions: dims, readonly: true });
      store.load([makeDoc('doc1', [1, 0, 0, 0])]);
      expect(store.size).toBe(1);
    });

    it('should prevent delete on readonly store', () => {
      const store = new VectorStore({ dimensions: dims, readonly: true });
      store.load([makeDoc('doc1', [1, 0, 0, 0])]);
      expect(() => store.delete('doc1')).toThrow('readonly');
    });
  });

  describe('Search', () => {
    it('should find the most similar document', () => {
      const store = new VectorStore({ dimensions: dims });
      store.insertBatch([
        makeDoc('north', [1, 0, 0, 0]),
        makeDoc('east', [0, 1, 0, 0]),
        makeDoc('south', [0, 0, 1, 0]),
        makeDoc('west', [0, 0, 0, 1]),
      ]);

      const results = store.search([1, 0.1, 0, 0], 1);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('north');
      expect(results[0].score).toBeGreaterThan(0.9);
    });

    it('should return results sorted by score descending', () => {
      const store = new VectorStore({ dimensions: dims });
      store.insertBatch([
        makeDoc('close', [1, 0.2, 0, 0]),
        makeDoc('medium', [0.5, 0.5, 0, 0]),
        makeDoc('far', [0, 0, 1, 0]),
      ]);

      const results = store.search([1, 0, 0, 0], 3);
      expect(results.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('should respect topK limit', () => {
      const store = new VectorStore({ dimensions: dims });
      store.insertBatch([
        makeDoc('a', [1, 0, 0, 0]),
        makeDoc('b', [0.9, 0.1, 0, 0]),
        makeDoc('c', [0.8, 0.2, 0, 0]),
        makeDoc('d', [0.7, 0.3, 0, 0]),
      ]);

      const results = store.search([1, 0, 0, 0], 2);
      expect(results).toHaveLength(2);
    });

    it('should respect minScore threshold', () => {
      const store = new VectorStore({ dimensions: dims });
      store.insertBatch([
        makeDoc('close', [1, 0, 0, 0]),
        makeDoc('far', [0, 0, 1, 0]),
      ]);

      const results = store.search([1, 0, 0, 0], 10, 0.5);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('close');
    });

    it('should filter by metadata', () => {
      const store = new VectorStore({ dimensions: dims });
      store.insertBatch([
        makeDoc('a', [1, 0, 0, 0], { type: 'clinical' }),
        makeDoc('b', [0.9, 0.1, 0, 0], { type: 'relationship' }),
        makeDoc('c', [0.8, 0.2, 0, 0], { type: 'clinical' }),
      ]);

      const results = store.search([1, 0, 0, 0], 10, 0, [
        { field: 'type', value: 'clinical' },
      ]);

      expect(results).toHaveLength(2);
      expect(results.every(r => r.metadata.type === 'clinical')).toBe(true);
    });

    it('should support "ne" filter operator', () => {
      const store = new VectorStore({ dimensions: dims });
      store.insertBatch([
        makeDoc('a', [1, 0, 0, 0], { type: 'clinical' }),
        makeDoc('b', [0.9, 0.1, 0, 0], { type: 'relationship' }),
      ]);

      const results = store.search([1, 0, 0, 0], 10, 0, [
        { field: 'type', value: 'clinical', operator: 'ne' },
      ]);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('b');
    });

    it('should support "in" filter operator', () => {
      const store = new VectorStore({ dimensions: dims });
      store.insertBatch([
        makeDoc('a', [1, 0, 0, 0], { type: 'alpha' }),
        makeDoc('b', [0.9, 0.1, 0, 0], { type: 'beta' }),
        makeDoc('c', [0.8, 0.2, 0, 0], { type: 'gamma' }),
      ]);

      const results = store.search([1, 0, 0, 0], 10, 0, [
        { field: 'type', value: ['alpha', 'gamma'], operator: 'in' },
      ]);
      expect(results).toHaveLength(2);
    });
  });

  describe('Export/Load', () => {
    it('should export and load documents', () => {
      const store1 = new VectorStore({ dimensions: dims });
      store1.insertBatch([
        makeDoc('a', [1, 0, 0, 0]),
        makeDoc('b', [0, 1, 0, 0]),
      ]);

      const exported = store1.export();
      const store2 = new VectorStore({ dimensions: dims });
      store2.load(exported);

      expect(store2.size).toBe(2);
      expect(store2.has('a')).toBe(true);
      expect(store2.has('b')).toBe(true);
    });
  });
});
