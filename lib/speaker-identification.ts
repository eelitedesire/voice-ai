/**
 * Speaker identification & lightweight online diarization.
 *
 * This module is the decision layer that sits on top of raw speaker embeddings.
 * It is deliberately dependency-free (no ONNX, no I/O) so the matching logic can
 * be unit-tested in isolation and reused by both the live streaming path and the
 * batch/file path.
 *
 * Design goals (see the product requirements):
 *   1. NEVER assign an enrolled speaker unless similarity clears a strict
 *      threshold. Unknown voices stay "Unknown Speaker".
 *   2. Multiple embeddings per enrolled speaker (different conditions), compared
 *      via a stable centroid plus a best-sample fallback.
 *   3. A margin test so two enrolled speakers with similar voices aren't
 *      confused — the best match must beat the runner-up by a margin.
 *   4. Three-way decision: known / uncertain / unknown, each with a score and a
 *      human-readable reason for confidence visualisation.
 *   5. Online clustering of unknown voices into stable "Guest N" labels within a
 *      session, so distinct unknown speakers are separated (no overlap handling).
 *
 * As of the multi-prototype redesign this module operates in TWO modes:
 *   - AS-Norm mode  (a fresh background cohort + calibration is supplied):
 *       multi-prototype scoring + Adaptive Symmetric Normalization + calibrated
 *       open-set threshold + top-1/top-2 margin. This is the production path.
 *   - Degraded mode (no cohort): multi-prototype raw-cosine with the
 *       conservative built-in thresholds — the historical behaviour, kept so the
 *       system still runs (loudly logged) before a cohort exists. Stale or absent
 *       enrollment-side stats are NEVER used silently: they are recomputed.
 */

import {
  protoScore,
  testSideSims,
  asNormWithPrecomputed,
  computeEnrollmentSideStats,
  type AsNormConfig,
} from './domain/cohort';

// ─── Math helpers (exported for tests) ─────────────────────────────────────

/** L2-normalise a vector. Returns a new Float32Array; zero vectors pass through. */
export function l2normalize(v: ArrayLike<number>): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
  const norm = Math.sqrt(sumSq);
  const out = new Float32Array(v.length);
  if (norm === 0) return out;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** Cosine similarity of two ALREADY-normalised vectors (= dot product), in [-1, 1]. */
export function cosineNormalized(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/** Mean of normalised vectors, re-normalised — a robust centroid for a speaker. */
export function centroid(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) return new Float32Array(0);
  const dim = vectors[0].length;
  const acc = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) acc[i] += v[i];
  }
  for (let i = 0; i < dim; i++) acc[i] /= vectors.length;
  return l2normalize(acc);
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EnrolledSpeaker {
  id: string;
  name: string;
  /** All enrolled prototypes, L2-normalised. The multi-prototype match set. */
  embeddings: Float32Array[];
  /** Re-normalised mean of `embeddings` — kept for the degraded-mode fallback. */
  centroid: Float32Array;
  /** Mean pairwise cosine among prototypes (from SpeakerStats), if known. */
  tightness?: number;
  /** Precomputed enrollment-side AS-Norm stats; recomputed if stale/absent. */
  enrollStats?: { cohortMean: number; cohortStd: number; cohortVersion: string };
}

/**
 * Everything the identifier needs to run AS-Norm. Assembled (in Stage 5) from
 * models/cohort.json + models/calibration.json. Passing this switches the
 * identifier from degraded cosine into calibrated open-set AS-Norm.
 */
export interface AsNormContext {
  /** L2-normalised background imposter embeddings. */
  cohort: number[][];
  cohortVersion: string;
  modelVersion: string;
  protoK: number;
  cohortK: number;
  /** Global accept threshold on the AS-Norm score (calibrated at a low FAR). */
  threshold: number;
  /** Required top-1 vs top-2 AS-Norm margin. */
  margin: number;
  /** Optional per-speaker thresholds (keyed by speaker id). */
  perSpeakerThresholds?: Record<string, number>;
}

export type SpeakerDecision = 'known' | 'uncertain' | 'unknown';

export interface SpeakerMatch {
  /** Final label to display: enrolled name, "Guest N", or "Unknown Speaker". */
  speaker: string;
  decision: SpeakerDecision;
  /** Cosine similarity (-1..1) to the closest enrolled speaker. */
  score: number;
  /** Closest enrolled speaker name (regardless of whether it was accepted). */
  bestName: string;
  /** Runner-up enrolled speaker, for the margin/confusion check. */
  runnerUpName?: string;
  runnerUpScore?: number;
  /** Raw multi-prototype similarity to the best speaker (cosine domain). */
  rawScore?: number;
  /** Accept threshold applied to the top speaker (per-speaker or global). */
  threshold?: number;
  /** Human-readable explanation for confidence visualisation. */
  reason: string;
}

export interface SpeakerIdentifierConfig {
  /** similarity ≥ this AND margin satisfied → accept as the enrolled speaker. */
  acceptThreshold: number;
  /** similarity in [uncertainThreshold, acceptThreshold) → uncertain (not assigned). */
  uncertainThreshold: number;
  /** best must beat runner-up by at least this, else it's a confusable/uncertain match. */
  margin: number;
  /** cosine to merge an unknown voice into an existing session-local cluster. */
  unknownClusterThreshold: number;
  /** Label distinct unknown voices as "Guest 1/2/…"; false → always "Unknown Speaker". */
  labelUnknownClusters: boolean;
  /** Label used for unmatched voices when clustering is disabled. */
  unknownLabel: string;
}

export const DEFAULT_CONFIG: SpeakerIdentifierConfig = {
  acceptThreshold: 0.5,
  uncertainThreshold: 0.38,
  margin: 0.06,
  unknownClusterThreshold: 0.5,
  // Default: label every unenrolled voice "Unknown Speaker". Set to true (via
  // SPEAKER_LABEL_UNKNOWN_CLUSTERS) to instead separate distinct unknown voices
  // into "Guest 1/2/…".
  labelUnknownClusters: false,
  unknownLabel: 'Unknown Speaker',
};

/** Build a config from env vars, falling back to DEFAULT_CONFIG. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SpeakerIdentifierConfig {
  const num = (v: string | undefined, d: number) => {
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    acceptThreshold: num(env.SPEAKER_ACCEPT_THRESHOLD, DEFAULT_CONFIG.acceptThreshold),
    uncertainThreshold: num(env.SPEAKER_UNCERTAIN_THRESHOLD, DEFAULT_CONFIG.uncertainThreshold),
    margin: num(env.SPEAKER_MARGIN, DEFAULT_CONFIG.margin),
    unknownClusterThreshold: num(env.SPEAKER_UNKNOWN_CLUSTER_THRESHOLD, DEFAULT_CONFIG.unknownClusterThreshold),
    labelUnknownClusters:
      (env.SPEAKER_LABEL_UNKNOWN_CLUSTERS ?? 'false').toLowerCase() === 'true',
    unknownLabel: env.SPEAKER_UNKNOWN_LABEL || DEFAULT_CONFIG.unknownLabel,
  };
}

/**
 * Normalise raw enrolled profiles (number[][] embeddings, or a legacy single
 * `voiceprint`) into `EnrolledSpeaker`s with centroids. Profiles whose
 * embeddings have the wrong dimension or are empty are skipped.
 */
export function buildEnrolledSpeakers(
  profiles: Array<{
    id: string;
    name?: string;
    role?: string;
    voiceprint?: number[];
    embeddings?: number[][];
    prototypes?: Array<{ v: number[] }>;
    stats?: {
      intraClassTightness?: number;
      cohortMean?: number;
      cohortStd?: number;
      cohortVersion?: string;
    };
    enrollmentStatus?: 'incomplete' | 'complete';
  }>,
): EnrolledSpeaker[] {
  const out: EnrolledSpeaker[] = [];
  for (const p of profiles) {
    // Never load a half-finished guided enrollment into the live match set.
    // Legacy profiles (no status) are grandfathered as usable.
    if (p.enrollmentStatus === 'incomplete') continue;

    let embeddings: Float32Array[];
    let tightness: number | undefined;
    let enrollStats: EnrolledSpeaker['enrollStats'];

    if (Array.isArray(p.prototypes) && p.prototypes.length > 0) {
      // New multi-prototype schema (prototypes are already normalised, but we
      // re-normalise defensively so a hand-edited DB can't corrupt scoring).
      embeddings = p.prototypes
        .filter((pr) => Array.isArray(pr.v) && pr.v.length)
        .map((pr) => l2normalize(pr.v));
      if (p.stats) {
        tightness = p.stats.intraClassTightness;
        // Only carry enrollment-side stats that are real and version-stamped;
        // the `none` sentinel (or a missing version) stays undefined so AS-Norm
        // recomputes rather than trusting stale numbers.
        if (
          p.stats.cohortVersion &&
          p.stats.cohortVersion !== 'none' &&
          Number.isFinite(p.stats.cohortStd) &&
          (p.stats.cohortStd ?? 0) > 0
        ) {
          enrollStats = {
            cohortMean: p.stats.cohortMean ?? 0,
            cohortStd: p.stats.cohortStd as number,
            cohortVersion: p.stats.cohortVersion,
          };
        }
      }
    } else {
      // Legacy: raw `embeddings` or single `voiceprint`.
      const raw: number[][] = [];
      if (Array.isArray(p.embeddings) && p.embeddings.length > 0) {
        for (const e of p.embeddings) if (Array.isArray(e) && e.length) raw.push(e);
      } else if (Array.isArray(p.voiceprint) && p.voiceprint.length) {
        raw.push(p.voiceprint);
      }
      if (raw.length === 0) continue;
      embeddings = raw.map((e) => l2normalize(e));
    }

    if (embeddings.length === 0) continue;
    out.push({
      id: p.id,
      name: p.name || p.role || p.id,
      embeddings,
      centroid: centroid(embeddings),
      tightness,
      enrollStats,
    });
  }
  return out;
}

/** Per-speaker score row produced by the scoring primitive. */
export interface ScoredSpeaker {
  id: string;
  name: string;
  /** Decision score: AS-Norm normalized in AS-Norm mode, raw cosine in degraded. */
  score: number;
  /** Underlying raw multi-prototype similarity (cosine domain), for diagnostics. */
  raw?: number;
}

/** Windows aggregated by the trimmed mean of the top-M most speaker-like ones. */
const TOP_M = 3;
/** Prototypes aggregated per window in degraded (no-cohort) mode. */
const DEGRADED_PROTO_K = 3;

const _warnedKeys = new Set<string>();
function warnOnce(key: string, msg: string): void {
  if (_warnedKeys.has(key)) return;
  _warnedKeys.add(key);
  console.warn(msg);
}

interface UnknownCluster {
  label: string;
  centroid: Float32Array;
  count: number;
}

/**
 * Stateful identifier. Enrolled speakers are fixed for the lifetime of the
 * instance; unknown-voice clusters accumulate per session, so create one
 * instance per session/connection.
 */
export class SpeakerIdentifier {
  private readonly speakers: EnrolledSpeaker[];
  private readonly cfg: SpeakerIdentifierConfig;
  private readonly ctx: AsNormContext | null;
  private readonly asnormCfg: AsNormConfig;
  private readonly unknownClusters: UnknownCluster[] = [];
  private unknownCount = 0;

  constructor(
    speakers: EnrolledSpeaker[],
    cfg: Partial<SpeakerIdentifierConfig> = {},
    asnorm: AsNormContext | null = null,
  ) {
    this.speakers = speakers;
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.ctx = asnorm;
    this.asnormCfg = asnorm
      ? { protoK: asnorm.protoK, cohortK: asnorm.cohortK }
      : { protoK: DEGRADED_PROTO_K, cohortK: 100 };

    if (this.ctx && this.ctx.cohort.length > 0) {
      // Guarantee every speaker has FRESH enrollment-side stats for THIS cohort.
      // Absent or version-mismatched stats are recomputed (and logged) — they are
      // never trusted silently. This is the cohort-versioning hard requirement.
      for (const s of this.speakers) {
        const fresh =
          s.enrollStats &&
          s.enrollStats.cohortVersion === this.ctx.cohortVersion &&
          s.enrollStats.cohortStd > 0;
        if (!fresh) {
          const { cohortMean, cohortStd } = computeEnrollmentSideStats(
            s.embeddings,
            this.ctx.cohort,
            this.asnormCfg,
          );
          s.enrollStats = { cohortMean, cohortStd, cohortVersion: this.ctx.cohortVersion };
          warnOnce(
            `asnorm-recompute:${s.id}:${this.ctx.cohortVersion}`,
            `[SpeakerIdentifier] Recomputed AS-Norm stats for "${s.name}" ` +
              `(profile stats absent or stale vs cohort ${this.ctx.cohortVersion}).`,
          );
        }
      }
    } else if (!this.ctx) {
      warnOnce(
        'asnorm-degraded',
        '[SpeakerIdentifier] No AS-Norm cohort supplied — running in degraded ' +
          'multi-prototype cosine mode (calibrated open-set disabled).',
      );
    }
  }

  get enrolledCount(): number {
    return this.speakers.length;
  }

  /** True when calibrated AS-Norm scoring is active. */
  asnormActive(): boolean {
    return !!this.ctx && this.ctx.cohort.length > 0 && this.speakers.length > 0;
  }

  /**
   * Identify a single raw (un-normalised) embedding — the one-window case of
   * `identifyMany`, kept as a stable public entry point.
   */
  identify(rawEmbedding: ArrayLike<number>): SpeakerMatch {
    return this.identifyMany([rawEmbedding]);
  }

  /**
   * Identify a speaker from one or many embeddings sampled across a segment (the
   * rolling windows). This is the single scoring primitive. Aggregating per-window
   * scores is robust to a few noisy windows (onset, breath, room noise) that would
   * otherwise drag a single blended embedding below threshold. In AS-Norm mode each
   * window is fully normalised before aggregation; in degraded mode windows are
   * scored by multi-prototype cosine.
   */
  identifyMany(rawEmbeddings: ArrayLike<number>[]): SpeakerMatch {
    const embs = rawEmbeddings.map((e) => l2normalize(e)).filter((e) => e.length > 0);
    if (embs.length === 0) {
      return { speaker: this.cfg.unknownLabel, decision: 'unknown', score: 0, bestName: '', reason: 'no audio for speaker id' };
    }

    const meanEmb = centroid(embs); // representative vector for unknown clustering
    if (this.speakers.length === 0) {
      return this.asUnknown(meanEmb, 0, '', 'no speakers enrolled');
    }

    const scored = this.scoreSpeakers(embs);
    return this.asnormActive()
      ? this.decideOpenSet(scored, meanEmb, embs.length)
      : this.decide(scored, meanEmb, embs.length);
  }

  /**
   * Per-speaker scores for the given windows, sorted best-first, in the active
   * mode. Exposed so the temporal tracker (Stage 4) can score one rolling
   * embedding per hop and smooth the result over time.
   */
  scoreSpeakers(embs: Float32Array[]): ScoredSpeaker[] {
    const list = this.speakers.map((s) => {
      if (this.asnormActive()) {
        const { asnorm, raw } = this.asnormSpeakerScore(s, embs);
        return { id: s.id, name: s.name, score: asnorm, raw };
      }
      // Degraded mode: the score IS the raw multi-prototype cosine.
      const raw = trimmedTopMean(
        embs.map((w) => protoScore(w, s.embeddings, this.asnormCfg.protoK)),
        TOP_M,
      );
      return { id: s.id, name: s.name, score: raw, raw };
    });
    return list.sort((a, b) => b.score - a.score);
  }

  /**
   * AS-Norm score for one speaker over a set of windows (trimmed top-m). Returns
   * both the normalized score AND the underlying raw similarity, so diagnostics
   * can separate an embedding miss (raw low) from a threshold reject (raw ok).
   */
  private asnormSpeakerScore(s: EnrolledSpeaker, embs: Float32Array[]): { asnorm: number; raw: number } {
    const cohort = this.ctx!.cohort;
    const m = s.enrollStats!;
    const rawPer = embs.map((w) => protoScore(w, s.embeddings, this.asnormCfg.protoK));
    const perWindow = embs.map((w, i) =>
      asNormWithPrecomputed(rawPer[i], testSideSims(w, cohort), m.cohortMean, m.cohortStd, this.asnormCfg),
    );
    return { asnorm: trimmedTopMean(perWindow, TOP_M), raw: trimmedTopMean(rawPer, TOP_M) };
  }

  /**
   * Calibrated open-set decision (AS-Norm mode). Accept the top speaker only if
   * its normalised score clears the (per-speaker) threshold AND beats the
   * runner-up by the required margin; otherwise the voice is unknown.
   */
  private decideOpenSet(
    scored: ScoredSpeaker[],
    embForCluster: Float32Array,
    nWindows: number,
  ): SpeakerMatch {
    const top = scored[0];
    const runner = scored[1];
    const thr = this.ctx!.perSpeakerThresholds?.[top.id] ?? this.ctx!.threshold;
    const margin = runner ? top.score - runner.score : Infinity;
    const suffix = nWindows > 1 ? ` over ${nWindows} windows` : '';
    const base = {
      score: top.score,
      bestName: top.name,
      runnerUpName: runner?.name,
      runnerUpScore: runner?.score,
      rawScore: top.raw,
      threshold: thr,
    };

    if (top.score < thr) {
      return this.asUnknown(
        embForCluster,
        top.score,
        top.name,
        `AS-Norm ${fmt(top.score)} < threshold ${fmt(thr)} for ${top.name}${suffix}`,
        base,
      );
    }
    if (margin < this.ctx!.margin) {
      return this.asUnknown(
        embForCluster,
        top.score,
        top.name,
        `AS-Norm margin ${fmt(margin)} < ${fmt(this.ctx!.margin)} ` +
          `(${top.name} vs ${runner?.name}) — confusable${suffix}`,
        base,
        'uncertain',
      );
    }
    return {
      speaker: top.name,
      decision: 'known',
      reason: `AS-Norm accept ${fmt(top.score)} ≥ ${fmt(thr)}, margin ${fmt(margin)}${suffix}`,
      ...base,
    };
  }

  /**
   * Degraded-mode decision: multi-prototype raw cosine against the built-in
   * conservative thresholds. Identical policy to the historical implementation,
   * used whenever no AS-Norm cohort is available.
   */
  private decide(
    scored: ScoredSpeaker[],
    embForCluster: Float32Array,
    nWindows = 1,
  ): SpeakerMatch {
    const top = scored[0];
    const runner = scored[1];
    const score = top.score;
    const margin = runner ? top.score - runner.score : Infinity;
    const suffix = nWindows > 1 ? ` over ${nWindows} windows` : '';

    const base = {
      score,
      bestName: top.name,
      runnerUpName: runner?.name,
      runnerUpScore: runner?.score,
      rawScore: top.raw ?? score,
      threshold: this.cfg.acceptThreshold,
    };

    // Below the uncertain floor → genuinely unknown.
    if (score < this.cfg.uncertainThreshold) {
      return this.asUnknown(
        embForCluster,
        score,
        top.name,
        `closest ${top.name} ${fmt(score)} < unknown floor ${fmt(this.cfg.uncertainThreshold)}${suffix}`,
        base,
      );
    }

    // In the uncertain band, or failing the margin test against a similar
    // enrolled voice → do NOT assign the name (avoid false positives).
    if (score < this.cfg.acceptThreshold) {
      return this.asUnknown(
        embForCluster,
        score,
        top.name,
        `closest ${top.name} ${fmt(score)} below accept ${fmt(this.cfg.acceptThreshold)} (uncertain)${suffix}`,
        base,
        'uncertain',
      );
    }
    if (margin < this.cfg.margin) {
      return this.asUnknown(
        embForCluster,
        score,
        top.name,
        `${top.name} ${fmt(score)} vs ${runner?.name} ${fmt(runner?.score ?? 0)} — margin ${fmt(margin)} < ${fmt(this.cfg.margin)} (confusable)`,
        base,
        'uncertain',
      );
    }

    // Confident, unambiguous match.
    return {
      speaker: top.name,
      decision: 'known',
      reason:
        `matched ${top.name} ${fmt(score)} ≥ ${fmt(this.cfg.acceptThreshold)}${suffix}` +
        (runner ? `, margin ${fmt(margin)} over ${runner.name}` : ''),
      ...base,
    };
  }

  /** Assign an unmatched voice to an unknown cluster (or a flat unknown label). */
  private asUnknown(
    emb: Float32Array,
    score: number,
    bestName: string,
    reason: string,
    base: Partial<SpeakerMatch> = {},
    decision: SpeakerDecision = 'unknown',
  ): SpeakerMatch {
    const label = this.cfg.labelUnknownClusters
      ? this.assignUnknownCluster(emb)
      : this.cfg.unknownLabel;
    return {
      speaker: label,
      decision,
      score,
      bestName,
      reason,
      ...base,
    };
  }

  /**
   * Online single-link clustering of unknown voices: merge into the nearest
   * existing cluster if close enough (updating its running-mean centroid),
   * otherwise open a new "Guest N" cluster.
   */
  private assignUnknownCluster(emb: Float32Array): string {
    let bestIdx = -1;
    let bestSim = -Infinity;
    for (let i = 0; i < this.unknownClusters.length; i++) {
      const sim = cosineNormalized(emb, this.unknownClusters[i].centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestSim >= this.cfg.unknownClusterThreshold) {
      const c = this.unknownClusters[bestIdx];
      // Running mean of normalised vectors, then re-normalise.
      const merged = new Float32Array(c.centroid.length);
      for (let i = 0; i < merged.length; i++) {
        merged[i] = (c.centroid[i] * c.count + emb[i]) / (c.count + 1);
      }
      c.centroid = l2normalize(merged);
      c.count += 1;
      return c.label;
    }

    this.unknownCount += 1;
    const label = `Guest ${this.unknownCount}`;
    this.unknownClusters.push({ label, centroid: emb, count: 1 });
    return label;
  }
}

/**
 * Mean of the top-`m` values — the segment's most speaker-representative
 * windows. Robust to a few low (noisy/overlap-onset) windows without being
 * fooled by a single lucky one the way a plain `max` would be.
 */
export function trimmedTopMean(values: number[], m: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  const k = Math.max(1, Math.min(m, sorted.length));
  let sum = 0;
  for (let i = 0; i < k; i++) sum += sorted[i];
  return sum / k;
}

function fmt(n: number): string {
  return n.toFixed(2);
}
