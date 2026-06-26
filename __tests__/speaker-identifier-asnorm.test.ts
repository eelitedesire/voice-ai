import {
  buildEnrolledSpeakers,
  SpeakerIdentifier,
  type AsNormContext,
} from '@/lib/speaker-identification';
import { scoreTrial, protoScore } from '@/lib/domain/cohort';

// ─── Deterministic synthetic embeddings ───────────────────────────────────────

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
// A diverse background voice — a random unit vector spanning the space (so the
// cohort actually surrounds the enrolled speakers, as a real cohort does;
// an axis-clustered cohort would leave speakers artificially isolated).
function genericVoice(rand: () => number): number[] {
  const v = new Array(DIM).fill(0);
  for (let i = 0; i < DIM; i++) v[i] = rand() - 0.5;
  return normalize(v);
}

const rand = mulberry32(2024);
const protosA = [nearAxis(1, 0.05, rand), nearAxis(1, 0.05, rand), nearAxis(1, 0.05, rand)];
const protosB = [nearAxis(5, 0.05, rand), nearAxis(5, 0.05, rand), nearAxis(5, 0.05, rand)];
const cohort = Array.from({ length: 60 }, () => genericVoice(rand));

function enrolled() {
  return buildEnrolledSpeakers([
    { id: 'a', name: 'Alice', prototypes: protosA.map((v) => ({ v })) },
    { id: 'b', name: 'Bob', prototypes: protosB.map((v) => ({ v })) },
  ]);
}

function ctx(threshold: number, margin = 0.2, extra: Partial<AsNormContext> = {}): AsNormContext {
  return {
    cohort,
    cohortVersion: 'cohort-test-v1',
    modelVersion: 'eres2net',
    protoK: 3,
    cohortK: 50,
    threshold,
    margin,
    ...extra,
  };
}

// Genuine utterances and an out-of-set "globally close" imposter.
const genuineAlice = nearAxis(1, 0.05, rand);
const genuineBob = nearAxis(5, 0.05, rand);
const imposter = normalize([0.6, 0.6, ...new Array(DIM - 2).fill(0)]);

// Self-calibrate a global threshold BELOW both speakers' genuine scores but
// ABOVE the imposter, so it can't drift with the fixtures.
const ASN = { protoK: 3, cohortK: 50 };
const gScore = scoreTrial(genuineAlice, protosA, cohort, ASN).asnorm;
const gScoreB = scoreTrial(genuineBob, protosB, cohort, ASN).asnorm;
const iScore = scoreTrial(imposter, protosA, cohort, ASN).asnorm;
const MID = (Math.min(gScore, gScoreB) + iScore) / 2;

// ─── Mode wiring ──────────────────────────────────────────────────────────────

describe('AS-Norm mode activation', () => {
  it('is active when a non-empty cohort is supplied', () => {
    const id = new SpeakerIdentifier(enrolled(), {}, ctx(MID));
    expect(id.asnormActive()).toBe(true);
  });
  it('falls back to degraded mode with no cohort', () => {
    const id = new SpeakerIdentifier(enrolled());
    expect(id.asnormActive()).toBe(false);
  });
  it('falls back to degraded mode with an empty cohort', () => {
    const id = new SpeakerIdentifier(enrolled(), {}, ctx(MID, 0.2, { cohort: [] }));
    expect(id.asnormActive()).toBe(false);
  });
});

// ─── Correct acceptance ───────────────────────────────────────────────────────

describe('AS-Norm — genuine speaker is accepted', () => {
  it('assigns Alice to a genuine Alice utterance', () => {
    const id = new SpeakerIdentifier(enrolled(), {}, ctx(MID));
    const m = id.identify(genuineAlice);
    expect(m.decision).toBe('known');
    expect(m.speaker).toBe('Alice');
    expect(m.reason).toMatch(/AS-Norm/);
  });

  it('routes Alice and Bob to their own profiles', () => {
    const id = new SpeakerIdentifier(enrolled(), {}, ctx(MID));
    expect(id.identify(nearAxis(1, 0.04, rand)).speaker).toBe('Alice');
    expect(id.identify(nearAxis(5, 0.04, rand)).speaker).toBe('Bob');
  });
});

// ─── FIX 1: unknown speaker -> falsely known ──────────────────────────────────

describe('AS-Norm fixes "unknown -> known"', () => {
  it('the imposter would pass a naive raw cosine threshold', () => {
    expect(protoScore(imposter, protosA, 3)).toBeGreaterThan(0.5);
  });

  it('but AS-Norm rejects it as not Alice', () => {
    const id = new SpeakerIdentifier(enrolled(), {}, ctx(MID));
    const m = id.identify(imposter);
    expect(m.decision).not.toBe('known');
    expect(m.speaker).not.toBe('Alice');
  });
});

// ─── FIX 2: known speaker -> falsely unknown ──────────────────────────────────

describe('AS-Norm + multi-prototype fixes "known -> unknown"', () => {
  it('keeps Alice known across a mix of clean and noisy windows', () => {
    const id = new SpeakerIdentifier(enrolled(), {}, ctx(MID));
    const windows = [
      nearAxis(1, 0.05, rand),
      nearAxis(1, 0.03, rand),
      nearAxis(1, 0.08, rand),
      nearAxis(20, 0.0, rand), // a noisy off-direction window
      nearAxis(25, 0.0, rand), // another
    ];
    const m = id.identifyMany(windows);
    expect(m.decision).toBe('known');
    expect(m.speaker).toBe('Alice');
  });
});

// ─── Margin (top-1 vs top-2) ──────────────────────────────────────────────────

describe('AS-Norm margin check rejects confusable pairs', () => {
  const rand2 = mulberry32(99);
  // Two near-identical enrolled speakers along the same axis.
  const pAnn = [nearAxis(3, 0.02, rand2), nearAxis(3, 0.02, rand2)];
  const pAbe = [nearAxis(3, 0.02, rand2), nearAxis(3, 0.02, rand2)];
  const confusable = buildEnrolledSpeakers([
    { id: 'ann', name: 'Ann', prototypes: pAnn.map((v) => ({ v })) },
    { id: 'abe', name: 'Abe', prototypes: pAbe.map((v) => ({ v })) },
  ]);

  it('returns uncertain (not a name) when two voices are too close', () => {
    const id = new SpeakerIdentifier(confusable, {}, ctx(-100, 0.5)); // low thr, big margin
    const m = id.identify(nearAxis(3, 0.01, rand2));
    expect(m.decision).toBe('uncertain');
    expect(m.reason).toMatch(/margin/);
  });
});

// ─── Per-speaker thresholds ───────────────────────────────────────────────────

describe('AS-Norm per-speaker thresholds', () => {
  it('an elevated per-speaker threshold rejects an otherwise-accepted voice', () => {
    const id = new SpeakerIdentifier(
      enrolled(),
      {},
      ctx(MID, 0.2, { perSpeakerThresholds: { a: gScore + 100 } }),
    );
    const m = id.identify(genuineAlice);
    expect(m.decision).not.toBe('known');
  });
});

// ─── Cohort versioning: never use stale stats silently ────────────────────────

describe('cohort versioning enforcement', () => {
  it('recomputes (and warns) when stored enrollment stats are stale, staying correct', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // Profile carries DELIBERATELY WRONG stats stamped with an OLD cohort version.
    // Unique ids + cohort version so the one-time recompute warning is observable.
    const speakers = buildEnrolledSpeakers([
      {
        id: 'astale',
        name: 'Alice',
        prototypes: protosA.map((v) => ({ v })),
        stats: { intraClassTightness: 0.9, cohortMean: 999, cohortStd: 999, cohortVersion: 'OLD' },
      },
      { id: 'bstale', name: 'Bob', prototypes: protosB.map((v) => ({ v })) },
    ]);
    const id = new SpeakerIdentifier(speakers, {}, ctx(MID, 0.2, { cohortVersion: 'cohort-stale-v1' }));
    const m = id.identify(genuineAlice);

    // If the absurd stale stats had been used, this would NOT be known.
    expect(m.decision).toBe('known');
    expect(m.speaker).toBe('Alice');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Recomputed AS-Norm stats'));
    warn.mockRestore();
  });
});

// ─── scoreSpeakers primitive (for the Stage 4 tracker) ────────────────────────

describe('scoreSpeakers', () => {
  it('returns per-speaker scores sorted best-first with ids', () => {
    const id = new SpeakerIdentifier(enrolled(), {}, ctx(MID));
    const scored = id.scoreSpeakers([genuineAlice].map((v) => Float32Array.from(v)));
    expect(scored[0].id).toBe('a');
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });
});
