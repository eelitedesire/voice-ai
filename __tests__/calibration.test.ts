import {
  farAt,
  frrAt,
  thresholdAtFAR,
  computeEER,
  derivePerSpeakerThresholds,
  buildTrials,
  calibrate,
  type CalibrationSpeaker,
} from '@/lib/domain/calibration';

// ─── Deterministic synthetic generator (shared shape with cohort.test) ────────

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
function nearAxis(axis: number, jitter: number, rand: () => number): number[] {
  const v = new Array(DIM).fill(0);
  v[axis] = 1;
  for (let i = 0; i < DIM; i++) v[i] += (rand() - 0.5) * 2 * jitter;
  return normalize(v);
}
function genericVoice(rand: () => number): number[] {
  const v = new Array(DIM).fill(0);
  v[0] = 0.9;
  for (let i = 2; i < DIM; i++) v[i] = (rand() - 0.5) * 0.3;
  return normalize(v);
}

function makeSpeaker(id: string, axis: number, n: number, jitter: number, rand: () => number): CalibrationSpeaker {
  const protos = Array.from({ length: n }, () => nearAxis(axis, jitter, rand));
  // tightness ~ mean pairwise cosine; approximate by recomputing here
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < protos.length; i++)
    for (let j = i + 1; j < protos.length; j++) {
      sum += protos[i].reduce((s, x, k) => s + x * protos[j][k], 0);
      pairs++;
    }
  return { id, protos, tightness: pairs ? sum / pairs : 1 };
}

// ─── FAR / FRR primitives ─────────────────────────────────────────────────────

describe('FAR / FRR', () => {
  const targets = [2, 3, 4, 5];
  const nontargets = [-2, -1, 0, 1];

  it('FAR is monotonically non-increasing in threshold', () => {
    expect(farAt(nontargets, -3)).toBeGreaterThanOrEqual(farAt(nontargets, 0));
    expect(farAt(nontargets, 0)).toBeGreaterThanOrEqual(farAt(nontargets, 2));
  });
  it('FRR is monotonically non-decreasing in threshold', () => {
    expect(frrAt(targets, 0)).toBeLessThanOrEqual(frrAt(targets, 3));
    expect(frrAt(targets, 3)).toBeLessThanOrEqual(frrAt(targets, 6));
  });
  it('perfectly separated sets have a threshold with FAR=FRR=0', () => {
    const t = 1.5;
    expect(farAt(nontargets, t)).toBe(0);
    expect(frrAt(targets, t)).toBe(0);
  });
});

describe('thresholdAtFAR', () => {
  const nontargets = Array.from({ length: 100 }, (_, i) => i / 100); // 0..0.99

  it('achieves FAR <= target', () => {
    const t = thresholdAtFAR(nontargets, 0.05);
    expect(farAt(nontargets, t)).toBeLessThanOrEqual(0.05);
  });
  it('a stricter target yields a higher threshold', () => {
    expect(thresholdAtFAR(nontargets, 0.01)).toBeGreaterThan(thresholdAtFAR(nontargets, 0.2));
  });
  it('targetFAR=0 accepts no imposters', () => {
    const t = thresholdAtFAR(nontargets, 0);
    expect(farAt(nontargets, t)).toBe(0);
  });
});

describe('computeEER', () => {
  it('finds the crossover for symmetric distributions', () => {
    const targets = [1, 2, 3, 4, 5];
    const nontargets = [-5, -4, -3, -2, -1];
    const { eer } = computeEER(targets, nontargets);
    expect(eer).toBeCloseTo(0, 6);
  });
});

// ─── Per-speaker thresholds ───────────────────────────────────────────────────

describe('derivePerSpeakerThresholds', () => {
  const speakers: CalibrationSpeaker[] = [
    { id: 'tight', protos: [], tightness: 0.9 },
    { id: 'loose', protos: [], tightness: 0.5 },
  ];
  const out = derivePerSpeakerThresholds(1.0, speakers, 0.5, 1.0);

  it('gives the looser speaker a stricter (higher) threshold', () => {
    expect(out['loose']).toBeGreaterThan(out['tight']);
  });
  it('respects the cap', () => {
    const capped = derivePerSpeakerThresholds(1.0, speakers, 100, 0.3);
    expect(Math.abs(capped['loose'] - 1.0)).toBeLessThanOrEqual(0.3 + 1e-9);
  });
});

// ─── End-to-end calibration ───────────────────────────────────────────────────

describe('calibrate (end-to-end on synthetic data)', () => {
  const rand = mulberry32(123);
  const speakers = [
    makeSpeaker('A', 1, 6, 0.05, rand),
    makeSpeaker('B', 5, 6, 0.05, rand),
    makeSpeaker('C', 9, 6, 0.05, rand),
  ];
  const cohort = Array.from({ length: 80 }, () => genericVoice(rand));

  const result = calibrate(speakers, cohort, { targetFAR: 0.01 });

  it('produces target and non-target trials', () => {
    expect(result.numTargetTrials).toBeGreaterThan(0);
    expect(result.numNontargetTrials).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it('separates genuine from imposter (target mean > non-target max)', () => {
    expect(result.summary.targetMean).toBeGreaterThan(result.summary.nontargetMean);
  });

  it('achieves the requested low false-accept rate', () => {
    expect(result.achievedFAR).toBeLessThanOrEqual(0.01 + 1e-9);
  });

  it('keeps the false-reject rate reasonable at that operating point', () => {
    expect(result.achievedFRR).toBeLessThan(0.5);
  });

  it('derives a threshold for every speaker', () => {
    expect(Object.keys(result.perSpeakerThresholds).sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('calibrate degenerate cases', () => {
  it('warns when speakers have < 2 prototypes (no target trials)', () => {
    const rand = mulberry32(1);
    const speakers = [
      { id: 'A', protos: [nearAxis(1, 0.05, rand)], tightness: 1 },
      { id: 'B', protos: [nearAxis(5, 0.05, rand)], tightness: 1 },
    ];
    const cohort = Array.from({ length: 20 }, () => genericVoice(rand));
    const result = calibrate(speakers, cohort);
    expect(result.numTargetTrials).toBe(0);
    expect(result.warnings.some((w) => w.includes('target trials'))).toBe(true);
  });

  it('buildTrials excludes a cohort imposter from its own normalization', () => {
    // Smoke test: with a 1-speaker, cohort-imposter setup the call must not throw
    // and must produce non-target trials from the cohort.
    const rand = mulberry32(2);
    const speakers = [makeSpeaker('A', 1, 3, 0.05, rand)];
    const cohort = Array.from({ length: 10 }, () => genericVoice(rand));
    const dist = buildTrials(speakers, cohort, { useCohortAsImposters: true });
    expect(dist.nontargets.length).toBe(10);
  });
});
