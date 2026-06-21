import {
  l2normalize,
  cosineNormalized,
  centroid,
  trimmedTopMean,
  buildEnrolledSpeakers,
  SpeakerIdentifier,
  DEFAULT_CONFIG,
} from '@/lib/speaker-identification';

// Build a deterministic unit-length embedding pointing mostly along axis `axis`
// with a small perturbation `noise` on the next axis — lets us simulate
// "same speaker, slightly different conditions" and "different speaker".
function emb(dim: number, axis: number, noise = 0): number[] {
  const v = new Array(dim).fill(0);
  v[axis] = 1;
  v[(axis + 1) % dim] = noise;
  return v;
}

const DIM = 16;

describe('math helpers', () => {
  it('l2normalize produces a unit vector', () => {
    const n = l2normalize([3, 4]);
    expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 6);
  });

  it('l2normalize passes zero vectors through without NaN', () => {
    const n = l2normalize([0, 0, 0]);
    expect(Array.from(n)).toEqual([0, 0, 0]);
  });

  it('cosine of identical normalized vectors is 1, orthogonal is 0', () => {
    const a = l2normalize([1, 0, 0]);
    const b = l2normalize([0, 1, 0]);
    expect(cosineNormalized(a, a)).toBeCloseTo(1, 6);
    expect(cosineNormalized(a, b)).toBeCloseTo(0, 6);
  });

  it('centroid of similar vectors stays near them', () => {
    const c = centroid([l2normalize(emb(DIM, 0, 0.1)), l2normalize(emb(DIM, 0, -0.1))]);
    expect(cosineNormalized(c, l2normalize(emb(DIM, 0)))).toBeGreaterThan(0.95);
  });
});

describe('buildEnrolledSpeakers', () => {
  it('supports legacy single voiceprint and new multi-embedding', () => {
    const built = buildEnrolledSpeakers([
      { id: 'a', name: 'A', voiceprint: emb(DIM, 0) },
      { id: 'b', name: 'B', embeddings: [emb(DIM, 1), emb(DIM, 1, 0.1)] },
    ]);
    expect(built).toHaveLength(2);
    expect(built[0].embeddings).toHaveLength(1);
    expect(built[1].embeddings).toHaveLength(2);
  });

  it('skips profiles with no usable embeddings', () => {
    const built = buildEnrolledSpeakers([{ id: 'x', name: 'X', embeddings: [] }]);
    expect(built).toHaveLength(0);
  });
});

describe('SpeakerIdentifier — the false-positive guard', () => {
  const enrolled = buildEnrolledSpeakers([
    { id: 'john', name: 'John', embeddings: [emb(DIM, 0), emb(DIM, 0, 0.05)] },
  ]);

  it('assigns the enrolled speaker when the voice clearly matches', () => {
    const id = new SpeakerIdentifier(enrolled);
    const m = id.identify(emb(DIM, 0, 0.02));
    expect(m.decision).toBe('known');
    expect(m.speaker).toBe('John');
    expect(m.score).toBeGreaterThan(DEFAULT_CONFIG.acceptThreshold);
  });

  it('does NOT assign John to a clearly different (unknown) voice', () => {
    const id = new SpeakerIdentifier(enrolled);
    const m = id.identify(emb(DIM, 8)); // orthogonal → cosine ~0
    expect(m.decision).toBe('unknown');
    expect(m.speaker).not.toBe('John');
    expect(m.bestName).toBe('John'); // closest, but rejected
    expect(m.score).toBeLessThan(DEFAULT_CONFIG.uncertainThreshold);
  });

  it('marks a borderline voice as uncertain (not the enrolled name)', () => {
    // Construct a vector whose cosine to John sits between the thresholds.
    const v = new Array(DIM).fill(0);
    v[0] = 0.45; // ~0.41 cosine after normalize with the off-axis component
    v[5] = 1.0;
    const id = new SpeakerIdentifier(enrolled);
    const m = id.identify(v);
    expect(m.score).toBeGreaterThanOrEqual(DEFAULT_CONFIG.uncertainThreshold);
    expect(m.score).toBeLessThan(DEFAULT_CONFIG.acceptThreshold);
    expect(m.decision).toBe('uncertain');
    expect(m.speaker).not.toBe('John');
  });

  it('with no speakers enrolled, never invents a name', () => {
    const id = new SpeakerIdentifier([]);
    const m = id.identify(emb(DIM, 0));
    expect(m.decision).toBe('unknown');
    expect(m.bestName).toBe('');
  });
});

describe('SpeakerIdentifier — separating multiple enrolled speakers', () => {
  const enrolled = buildEnrolledSpeakers([
    { id: 'john', name: 'John', embeddings: [emb(DIM, 0)] },
    { id: 'mary', name: 'Mary', embeddings: [emb(DIM, 4)] },
  ]);

  it('routes each voice to the correct enrolled speaker', () => {
    const id = new SpeakerIdentifier(enrolled);
    expect(id.identify(emb(DIM, 0, 0.03)).speaker).toBe('John');
    expect(id.identify(emb(DIM, 4, 0.03)).speaker).toBe('Mary');
  });

  it('rejects (uncertain) when two enrolled voices are confusably close', () => {
    // Two near-identical enrolled speakers; an input close to both must fail the
    // margin test rather than gamble on one.
    const confusable = buildEnrolledSpeakers([
      { id: 'a', name: 'Ann', embeddings: [emb(DIM, 0)] },
      { id: 'b', name: 'Abe', embeddings: [emb(DIM, 0, 0.02)] },
    ]);
    const id = new SpeakerIdentifier(confusable, { margin: 0.2 });
    const m = id.identify(emb(DIM, 0, 0.01));
    expect(m.decision).toBe('uncertain');
    expect(m.reason).toMatch(/margin/);
  });
});

describe('trimmedTopMean', () => {
  it('averages the top-m values, ignoring low outliers', () => {
    expect(trimmedTopMean([0.9, 0.85, 0.8, 0.1, 0.05], 3)).toBeCloseTo((0.9 + 0.85 + 0.8) / 3, 6);
  });
  it('handles fewer values than m', () => {
    expect(trimmedTopMean([0.5], 3)).toBeCloseTo(0.5, 6);
    expect(trimmedTopMean([], 3)).toBe(0);
  });
});

describe('SpeakerIdentifier.identifyMany — multi-window aggregation', () => {
  const enrolled = buildEnrolledSpeakers([
    { id: 'john', name: 'John', embeddings: [emb(DIM, 0)] },
  ]);

  it('recognizes the speaker even when some windows are noisy (no false Unknown)', () => {
    const id = new SpeakerIdentifier(enrolled);
    // 5 windows of John, 2 of them degraded toward an orthogonal axis. A single
    // blended embedding could dip below threshold; the top-m aggregation holds.
    const windows = [
      emb(DIM, 0, 0.05),
      emb(DIM, 0, 0.02),
      emb(DIM, 0, 0.08),
      emb(DIM, 7), // noisy window (different direction)
      emb(DIM, 9), // noisy window
    ];
    const m = id.identifyMany(windows);
    expect(m.decision).toBe('known');
    expect(m.speaker).toBe('John');
  });

  it('still rejects an unknown speaker across many windows', () => {
    const id = new SpeakerIdentifier(enrolled);
    const windows = [emb(DIM, 8), emb(DIM, 8, 0.05), emb(DIM, 9), emb(DIM, 10)];
    const m = id.identifyMany(windows);
    expect(m.decision).toBe('unknown');
    expect(m.speaker).not.toBe('John');
  });

  it('falls back to single-embedding behavior for one window', () => {
    const id = new SpeakerIdentifier(enrolled);
    expect(id.identifyMany([emb(DIM, 0, 0.02)]).speaker).toBe('John');
  });
});

describe('SpeakerIdentifier — online clustering of unknown voices', () => {
  const enrolled = buildEnrolledSpeakers([{ id: 'john', name: 'John', embeddings: [emb(DIM, 0)] }]);

  it('labels every unenrolled voice "Unknown Speaker" by default', () => {
    const id = new SpeakerIdentifier(enrolled);
    expect(id.identify(emb(DIM, 8)).speaker).toBe('Unknown Speaker');
    expect(id.identify(emb(DIM, 12)).speaker).toBe('Unknown Speaker');
  });

  it('separates distinct unknown voices into Guest 1 / Guest 2 when clustering is enabled', () => {
    const id = new SpeakerIdentifier(enrolled, { labelUnknownClusters: true });
    const g1a = id.identify(emb(DIM, 8));
    const g1b = id.identify(emb(DIM, 8, 0.05)); // same unknown voice again
    const g2 = id.identify(emb(DIM, 12)); // different unknown voice
    expect(g1a.speaker).toBe('Guest 1');
    expect(g1b.speaker).toBe('Guest 1');
    expect(g2.speaker).toBe('Guest 2');
  });
});
