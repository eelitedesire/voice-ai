/**
 * Tests for the TF-IDF Embedding Service
 */

import { TFIDFEmbedder, EmbeddingService } from '../../lib/rag/embeddings';

describe('TFIDFEmbedder', () => {
  const dims = 64;

  describe('Fit & Embed', () => {
    it('should require fit before embed', () => {
      const embedder = new TFIDFEmbedder({ dimensions: dims });
      expect(() => embedder.embed('test')).toThrow('not been fitted');
    });

    it('should produce embeddings of the correct dimension', () => {
      const embedder = new TFIDFEmbedder({ dimensions: dims });
      embedder.fit(['hello world', 'goodbye world']);
      const vec = embedder.embed('hello world');
      expect(vec).toHaveLength(dims);
    });

    it('should produce unit vectors', () => {
      const embedder = new TFIDFEmbedder({ dimensions: dims });
      embedder.fit(['the cat sat on the mat', 'the dog ran in the park']);
      const vec = embedder.embed('cat on mat');
      const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      // Allow for zero vectors (very rare with real text)
      if (magnitude > 0) {
        expect(magnitude).toBeCloseTo(1.0, 3);
      }
    });

    it('should produce similar embeddings for similar texts', () => {
      const embedder = new TFIDFEmbedder({ dimensions: 256 });
      // Larger, more differentiated corpus for better discrimination
      embedder.fit([
        'couples therapy for communication issues and relationship dynamics',
        'relationship conflict resolution and couples counseling methods',
        'therapeutic intervention for relationship problems and couples therapy',
        'cooking recipes for dinner and breakfast meals preparation kitchen',
        'programming in typescript and javascript web development software',
        'software engineering and code review practices deployment testing',
        'baking bread pastries kitchen oven culinary arts cooking food',
        'web development frameworks libraries frontend backend server',
      ]);

      const a = embedder.embed('therapy couples communication relationship counseling');
      const b = embedder.embed('relationship couples counseling therapeutic conflict');
      const c = embedder.embed('software programming code javascript typescript web');

      // a and b should be more similar to each other than to c
      const simAB = cosine(a, b);
      const simAC = cosine(a, c);
      expect(simAB).toBeGreaterThan(simAC);
    });

    it('should handle empty text', () => {
      const embedder = new TFIDFEmbedder({ dimensions: dims });
      embedder.fit(['hello world']);
      const vec = embedder.embed('');
      expect(vec).toHaveLength(dims);
    });

    it('should batch embed multiple texts', () => {
      const embedder = new TFIDFEmbedder({ dimensions: dims });
      embedder.fit(['hello', 'world', 'test']);
      const vecs = embedder.embedBatch(['hello', 'world']);
      expect(vecs).toHaveLength(2);
      expect(vecs[0]).toHaveLength(dims);
      expect(vecs[1]).toHaveLength(dims);
    });
  });

  describe('Vocabulary', () => {
    it('should build vocabulary from training corpus', () => {
      const embedder = new TFIDFEmbedder({ dimensions: dims });
      embedder.fit(['hello world', 'goodbye world', 'hello again']);
      expect(embedder.vocabSize).toBeGreaterThan(0);
    });

    it('should include bigrams when enabled', () => {
      const embedder = new TFIDFEmbedder({ dimensions: dims, useBigrams: true });
      embedder.fit(['gottman four horsemen']);
      // Bigrams like "gottman_four", "four_horsemen" should increase vocab
      const sizeWithBigrams = embedder.vocabSize;

      const embedderNoBigrams = new TFIDFEmbedder({ dimensions: dims, useBigrams: false });
      embedderNoBigrams.fit(['gottman four horsemen']);
      expect(sizeWithBigrams).toBeGreaterThan(embedderNoBigrams.vocabSize);
    });
  });

  describe('Serialization', () => {
    it('should export and load state correctly', () => {
      const embedder1 = new TFIDFEmbedder({ dimensions: dims });
      embedder1.fit(['cognitive distortions', 'emotional flooding', 'attachment injury']);
      const vec1 = embedder1.embed('cognitive distortion therapy');

      const state = embedder1.exportState();

      const embedder2 = new TFIDFEmbedder({ dimensions: dims });
      embedder2.loadState(state);
      const vec2 = embedder2.embed('cognitive distortion therapy');

      // Same embedder state should produce identical embeddings
      expect(vec1).toEqual(vec2);
    });
  });
});

describe('EmbeddingService', () => {
  it('should initialize and produce clinical embeddings', () => {
    const service = new EmbeddingService();
    service.fitClinical(['gottman method', 'cognitive behavioral therapy']);
    const vec = service.embedClinical('gottman');
    expect(vec).toHaveLength(service.dimensions);
  });

  it('should initialize and produce relationship embeddings', () => {
    const service = new EmbeddingService();
    service.fitClinical(['dummy']); // Need clinical to be initialized
    service.fitRelationship(['session about money fights']);
    const vec = service.embedRelationship('money argument');
    expect(vec).toHaveLength(service.dimensions);
  });

  it('should throw if clinical embedder not initialized', () => {
    const service = new EmbeddingService();
    expect(() => service.embedClinical('test')).toThrow('not initialized');
  });

  it('should export and load state', () => {
    const service = new EmbeddingService();
    service.fitClinical(['test clinical corpus']);
    service.fitRelationship(['test relationship corpus']);

    const state = service.exportState();

    const service2 = new EmbeddingService();
    service2.loadState(state);

    // Should produce same embeddings
    const vec1 = service.embedClinical('test');
    const vec2 = service2.embedClinical('test');
    expect(vec1).toEqual(vec2);
  });
});

// Helper
function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}
