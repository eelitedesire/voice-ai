/**
 * AS-Norm scoring core + background-cohort representation.
 *
 * PURE module — no ONNX, no filesystem. This is the single source of truth for
 * how a test embedding is scored against an enrolled speaker, so the values the
 * calibration tool (Stage 2) measures are byte-for-byte the values the live
 * SpeakerIdentifier (Stage 3) will produce.
 *
 * ── Why AS-Norm ────────────────────────────────────────────────────────────
 * A raw cosine to one speaker can't tell "genuinely this speaker" from "a
 * generic voice that happens to sit moderately close to everyone". Adaptive
 * Symmetric Normalization references an imposter cohort: it rescales the raw
 * score by how the trial compares to the cohort distribution. An out-of-set
 * voice that's moderately close to speaker A is *also* moderately close to the
 * whole cohort, so its normalized score collapses toward zero; a true A voice
 * is close to A but far from the cohort, so its score stays high.
 *
 *   z_test   = (raw − μ(e  vs cohort)) / σ(e  vs cohort)
 *   z_enroll = (raw − μ(A  vs cohort)) / σ(A  vs cohort)   // precomputed at enroll
 *   asnorm   = ½ (z_test + z_enroll)
 *
 * Both sides use the *adaptive* cohort: the top-K most similar cohort elements
 * (the hardest imposters), not the whole set.
 */

// ─── Cohort representation ─────────────────────────────────────────────────

export interface BackgroundCohort {
  /** Version string; stamped into every profile's stats. Never reuse. */
  version: string;
  /** Embedding model this cohort was produced with (must match enrollment). */
  modelVersion: string;
  /** Embedding dimension (all elements must share it). */
  dim: number;
  /** L2-normalized background embeddings — one per background speaker model. */
  embeddings: number[][];
  createdAt: number;
  /** Number of distinct source files/speakers the cohort was built from. */
  sourceCount: number;
}

export interface AsNormConfig {
  /** Prototypes aggregated per speaker for the raw score (top-k mean cosine). */
  protoK: number;
  /** Adaptive cohort size: top-K most similar cohort elements used for stats. */
  cohortK: number;
}

export const DEFAULT_ASNORM_CONFIG: AsNormConfig = { protoK: 3, cohortK: 100 };

const EPS = 1e-6;

// ─── Math primitives ───────────────────────────────────────────────────────

/** Cosine of two ALREADY-normalized vectors (= dot product). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) d += a[i] * b[i];
  return d;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population standard deviation, floored at EPS to avoid div-by-zero. */
export function std(xs: number[], mu = mean(xs)): number {
  if (xs.length < 2) return EPS;
  let s = 0;
  for (const x of xs) s += (x - mu) * (x - mu);
  return Math.max(Math.sqrt(s / xs.length), EPS);
}

/** The `k` largest values (descending). k is clamped to [1, xs.length]. */
export function topKDesc(xs: number[], k: number): number[] {
  const sorted = [...xs].sort((a, b) => b - a);
  const kk = Math.max(1, Math.min(k, sorted.length));
  return sorted.slice(0, kk);
}

// ─── Raw multi-prototype score ─────────────────────────────────────────────

/**
 * Raw score of a test embedding against a speaker's prototype set: the mean of
 * the top-`protoK` cosine similarities. protoK=1 ⇒ plain max (nearest prototype).
 * This is the multi-prototype matching that stops intra-speaker variation from
 * being averaged into one fragile centroid.
 */
export function protoScore(test: ArrayLike<number>, protos: ArrayLike<number>[], protoK: number): number {
  if (protos.length === 0) return 0;
  const sims = protos.map((p) => cosine(test, p));
  return mean(topKDesc(sims, protoK));
}

// ─── Cohort-side similarity vectors ─────────────────────────────────────────

/**
 * Test-side similarities: cosine of the test embedding against each cohort
 * element. `excludeIndex` lets a calibration trial that *uses* a cohort element
 * as the imposter drop that element from its own normalization (no self-leak).
 */
export function testSideSims(
  test: ArrayLike<number>,
  cohort: ArrayLike<number>[],
  excludeIndex = -1,
): number[] {
  const out: number[] = [];
  for (let j = 0; j < cohort.length; j++) {
    if (j === excludeIndex) continue;
    out.push(cosine(test, cohort[j]));
  }
  return out;
}

/**
 * Enrollment-side AS-Norm statistics for a speaker: the mean/std of the
 * adaptive-top-K cohort scores against that speaker's prototype model. Computed
 * once at enrollment (or on cohort-version change) and stored in SpeakerStats.
 */
export function computeEnrollmentSideStats(
  protos: ArrayLike<number>[],
  cohort: ArrayLike<number>[],
  cfg: AsNormConfig = DEFAULT_ASNORM_CONFIG,
): { cohortMean: number; cohortStd: number } {
  const sims = cohort.map((c) => protoScore(c, protos, cfg.protoK));
  const top = topKDesc(sims, cfg.cohortK);
  const mu = mean(top);
  return { cohortMean: mu, cohortStd: std(top, mu) };
}

// ─── AS-Norm score ──────────────────────────────────────────────────────────

/**
 * AS-Norm score using PRECOMPUTED enrollment-side stats (the runtime path).
 * `rawScoreValue` = protoScore(test, targetProtos). `testSims` = testSideSims(...).
 */
export function asNormWithPrecomputed(
  rawScoreValue: number,
  testSims: number[],
  enrollMean: number,
  enrollStd: number,
  cfg: AsNormConfig = DEFAULT_ASNORM_CONFIG,
): number {
  const top = topKDesc(testSims, cfg.cohortK);
  const muE = mean(top);
  const sgE = std(top, muE);
  const zTest = (rawScoreValue - muE) / sgE;
  const zEnroll = (rawScoreValue - enrollMean) / Math.max(enrollStd, EPS);
  return 0.5 * (zTest + zEnroll);
}

/**
 * Full AS-Norm score computed from scratch (the calibration path, where the
 * enrollment-side stats are recomputed per leave-one-out model). Returns both
 * the raw and normalized score for diagnostics.
 */
export function scoreTrial(
  test: ArrayLike<number>,
  targetProtos: ArrayLike<number>[],
  cohort: ArrayLike<number>[],
  cfg: AsNormConfig = DEFAULT_ASNORM_CONFIG,
  excludeCohortIndex = -1,
): { raw: number; asnorm: number } {
  const raw = protoScore(test, targetProtos, cfg.protoK);
  const enroll = computeEnrollmentSideStats(targetProtos, cohort, cfg);
  const tSims = testSideSims(test, cohort, excludeCohortIndex);
  const asnorm = asNormWithPrecomputed(raw, tSims, enroll.cohortMean, enroll.cohortStd, cfg);
  return { raw, asnorm };
}

// ─── Cohort validation ──────────────────────────────────────────────────────

/** Structural checks on a cohort file before it's trusted. */
export function validateCohort(cohort: BackgroundCohort): string[] {
  const problems: string[] = [];
  if (!cohort.version || cohort.version === 'none') {
    problems.push('Cohort has no usable version string.');
  }
  if (!Array.isArray(cohort.embeddings) || cohort.embeddings.length === 0) {
    problems.push('Cohort has no embeddings.');
    return problems;
  }
  for (let i = 0; i < cohort.embeddings.length; i++) {
    const e = cohort.embeddings[i];
    if (e.length !== cohort.dim) {
      problems.push(`Cohort embedding ${i}: length ${e.length} != dim ${cohort.dim}.`);
    }
    let sumSq = 0;
    for (const x of e) {
      if (!Number.isFinite(x)) {
        problems.push(`Cohort embedding ${i}: non-finite value.`);
        break;
      }
      sumSq += x * x;
    }
    const norm = Math.sqrt(sumSq);
    if (norm > 1e-3 && Math.abs(norm - 1) > 1e-3) {
      problems.push(`Cohort embedding ${i}: not L2-normalized (|v|=${norm.toFixed(4)}).`);
    }
  }
  return problems;
}
