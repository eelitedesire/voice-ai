import {
  cosine,
  mean,
  std,
  topKDesc,
  protoScore,
  testSideSims,
  computeEnrollmentSideStats,
  asNormWithPrecomputed,
  scoreTrial,
  validateCohort,
  DEFAULT_ASNORM_CONFIG,
  type BackgroundCohort,
} from '@/lib/domain/cohort';

// ─── Deterministic synthetic embedding generator ─────────────────────────────

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v : v.map((x) => x / n);
}

const DIM = 32;
const E0 = 0; // shared "generic voice" component
const A_AXIS = 1; // speaker A's identity direction

/** A near-axis embedding with small random jitter (same-speaker variation). */
function nearAxis(axis: number, jitter: number, rand: () => number): number[] {
  const v = new Array(DIM).fill(0);
  v[axis] = 1;
  for (let i = 0; i < DIM; i++) v[i] += (rand() - 0.5) * 2 * jitter;
  return normalize(v);
}

/** A generic cohort voice: dominated by the shared E0 component plus spread. */
function genericVoice(rand: () => number): number[] {
  const v = new Array(DIM).fill(0);
  v[E0] = 0.9;
  for (let i = 2; i < DIM; i++) v[i] = (rand() - 0.5) * 0.3;
  return normalize(v);
}

// ─── Math primitives ──────────────────────────────────────────────────────────

describe('math primitives', () => {
  it('cosine of identical normalized vectors is 1', () => {
    const v = normalize([1, 2, 3]);
    expect(cosine(v, v)).toBeCloseTo(1, 6);
  });
  it('cosine of orthogonal vectors is 0', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('topKDesc returns the k largest, descending', () => {
    expect(topKDesc([0.1, 0.9, 0.5, 0.3], 2)).toEqual([0.9, 0.5]);
  });
  it('topKDesc clamps k to [1, len]', () => {
    expect(topKDesc([0.2], 5)).toEqual([0.2]);
    expect(topKDesc([0.2, 0.4], 0)).toEqual([0.4]);
  });
  it('std is floored above zero for degenerate input', () => {
    expect(std([0.5, 0.5, 0.5])).toBeGreaterThan(0);
    expect(std([0.5])).toBeGreaterThan(0);
  });
  it('mean of empty is 0', () => {
    expect(mean([])).toBe(0);
  });
});

// ─── protoScore (multi-prototype matching) ────────────────────────────────────

describe('protoScore', () => {
  const protos = [normalize([1, 0, 0]), normalize([0, 1, 0]), normalize([0, 0, 1])];

  it('with protoK=1 returns the nearest-prototype cosine (max)', () => {
    const test = normalize([0.9, 0.1, 0]);
    const expected = Math.max(...protos.map((p) => cosine(test, p)));
    expect(protoScore(test, protos, 1)).toBeCloseTo(expected, 6);
  });

  it('with protoK>1 averages the top-k cosines', () => {
    const test = normalize([1, 1, 0]);
    const sims = protos.map((p) => cosine(test, p)).sort((a, b) => b - a);
    expect(protoScore(test, protos, 2)).toBeCloseTo((sims[0] + sims[1]) / 2, 6);
  });

  it('returns 0 for an empty prototype set', () => {
    expect(protoScore([1, 0], [], 3)).toBe(0);
  });
});

// ─── AS-Norm internal consistency ─────────────────────────────────────────────

describe('AS-Norm consistency', () => {
  const rand = mulberry32(42);
  const protos = [nearAxis(A_AXIS, 0.05, rand), nearAxis(A_AXIS, 0.05, rand)];
  const cohort = Array.from({ length: 40 }, () => genericVoice(rand));

  it('scoreTrial equals the precomputed path with the same enroll stats', () => {
    const test = nearAxis(A_AXIS, 0.05, rand);
    const enroll = computeEnrollmentSideStats(protos, cohort);
    const raw = protoScore(test, protos, DEFAULT_ASNORM_CONFIG.protoK);
    const tSims = testSideSims(test, cohort);
    const viaPrecomputed = asNormWithPrecomputed(raw, tSims, enroll.cohortMean, enroll.cohortStd);
    const viaTrial = scoreTrial(test, protos, cohort);
    expect(viaTrial.raw).toBeCloseTo(raw, 6);
    expect(viaTrial.asnorm).toBeCloseTo(viaPrecomputed, 6);
  });
});

// ─── The core property: imposter collapse ─────────────────────────────────────

describe('AS-Norm fixes "unknown speaker -> known"', () => {
  const rand = mulberry32(7);
  const protosA = [
    nearAxis(A_AXIS, 0.05, rand),
    nearAxis(A_AXIS, 0.05, rand),
    nearAxis(A_AXIS, 0.05, rand),
  ];
  const cohort = Array.from({ length: 60 }, () => genericVoice(rand));

  // A genuine A utterance.
  const genuine = nearAxis(A_AXIS, 0.05, rand);
  // An out-of-set voice that sits moderately close to A AND to the generic
  // cohort (mixes the shared E0 component with A's direction).
  const imposter = normalize([0.6, 0.6, ...new Array(DIM - 2).fill(0)]);

  const g = scoreTrial(genuine, protosA, cohort);
  const im = scoreTrial(imposter, protosA, cohort);

  it('the imposter has a high RAW score that a naive cosine threshold would accept', () => {
    expect(im.raw).toBeGreaterThan(0.5); // would pass a raw threshold of ~0.4-0.5
  });

  it('AS-Norm pushes the imposter far below the genuine speaker', () => {
    expect(g.asnorm).toBeGreaterThan(im.asnorm);
    // There exists an operating threshold that accepts genuine, rejects imposter.
    const mid = (g.asnorm + im.asnorm) / 2;
    expect(g.asnorm).toBeGreaterThan(mid);
    expect(im.asnorm).toBeLessThan(mid);
  });

  it('the genuine/imposter AS-Norm gap is larger than the raw-score gap', () => {
    // Normalization amplifies the separation the raw score under-expresses.
    const rawGap = g.raw - im.raw;
    const normGap = g.asnorm - im.asnorm;
    expect(normGap).toBeGreaterThan(rawGap);
  });
});

// ─── Cohort validation ────────────────────────────────────────────────────────

describe('validateCohort', () => {
  const good: BackgroundCohort = {
    version: 'cohort-test-1',
    modelVersion: 'eres2net',
    dim: 3,
    embeddings: [normalize([1, 0, 0]), normalize([0, 1, 0])],
    createdAt: 1,
    sourceCount: 2,
  };

  it('passes a well-formed cohort', () => {
    expect(validateCohort(good)).toEqual([]);
  });
  it('rejects the none/empty version', () => {
    expect(validateCohort({ ...good, version: 'none' }).length).toBeGreaterThan(0);
  });
  it('flags a dim mismatch', () => {
    const bad = { ...good, embeddings: [[1, 0], normalize([0, 1, 0])] };
    expect(validateCohort(bad).some((p) => p.includes('!= dim'))).toBe(true);
  });
  it('flags a non-normalized embedding', () => {
    const bad = { ...good, embeddings: [[3, 0, 0]] };
    expect(validateCohort(bad).some((p) => p.includes('not L2-normalized'))).toBe(true);
  });
});
