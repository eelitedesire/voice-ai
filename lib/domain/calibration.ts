/**
 * Threshold calibration for AS-Norm open-set speaker ID.
 *
 * PURE module — no I/O. Builds same-speaker (target) and different-speaker
 * (non-target) AS-Norm score distributions from enrollment data + the cohort,
 * then derives an operating threshold. The operating point is chosen at a FIXED
 * LOW FALSE-ACCEPT RATE rather than EER: this is a clinical product, so a
 * confident wrong name is worse than an honest "unknown".
 *
 * Trials:
 *   target     — leave-one-prototype-out within a speaker (genuine).
 *   non-target — every other speaker's prototypes scored against this speaker's
 *                model, plus background-cohort embeddings as imposters (each
 *                excluded from its own normalization to avoid self-leakage).
 */

import {
  AsNormConfig,
  DEFAULT_ASNORM_CONFIG,
  scoreTrial,
} from './cohort';

export interface CalibrationSpeaker {
  id: string;
  /** L2-normalized prototypes. */
  protos: number[][];
  /** Mean pairwise cosine among prototypes (from SpeakerStats). */
  tightness: number;
}

export interface TrialDistributions {
  targets: number[];
  nontargets: number[];
  /** Per-speaker non-target scores, for per-speaker threshold derivation. */
  perSpeakerNontargets: Record<string, number[]>;
  perSpeakerTargets: Record<string, number[]>;
}

export interface CalibrationResult {
  /** Global accept threshold on the AS-Norm score, at `targetFAR`. */
  threshold: number;
  targetFAR: number;
  achievedFAR: number;
  achievedFRR: number;
  eer: number;
  eerThreshold: number;
  perSpeakerThresholds: Record<string, number>;
  numTargetTrials: number;
  numNontargetTrials: number;
  /** Quick distribution summary for eyeballing separation. */
  summary: {
    targetMean: number;
    targetMin: number;
    nontargetMean: number;
    nontargetMax: number;
  };
  warnings: string[];
}

export interface CalibrationOptions {
  asnorm?: AsNormConfig;
  /** Target false-accept rate for the operating point (default 0.01 = 1%). */
  targetFAR?: number;
  /** Include cohort embeddings as extra imposter trials (default true). */
  useCohortAsImposters?: boolean;
  /** Slope for per-speaker threshold adjustment from tightness (default 0.5). */
  perSpeakerSlope?: number;
  /** Max absolute per-speaker deviation from the global threshold (default 1.0). */
  perSpeakerCap?: number;
}

// ─── Trial construction ──────────────────────────────────────────────────────

export function buildTrials(
  speakers: CalibrationSpeaker[],
  cohort: number[][],
  opts: CalibrationOptions = {},
): TrialDistributions {
  const cfg = opts.asnorm ?? DEFAULT_ASNORM_CONFIG;
  const useCohort = opts.useCohortAsImposters ?? true;

  const targets: number[] = [];
  const nontargets: number[] = [];
  const perSpeakerNontargets: Record<string, number[]> = {};
  const perSpeakerTargets: Record<string, number[]> = {};

  for (const s of speakers) {
    perSpeakerNontargets[s.id] = [];
    perSpeakerTargets[s.id] = [];
  }

  for (const s of speakers) {
    // Target trials: leave-one-prototype-out (needs >= 2 prototypes).
    if (s.protos.length >= 2) {
      for (let i = 0; i < s.protos.length; i++) {
        const heldOut = s.protos[i];
        const model = s.protos.filter((_, j) => j !== i);
        const { asnorm } = scoreTrial(heldOut, model, cohort, cfg);
        targets.push(asnorm);
        perSpeakerTargets[s.id].push(asnorm);
      }
    }

    // Non-target trials: other speakers' prototypes against THIS speaker's model.
    for (const other of speakers) {
      if (other.id === s.id) continue;
      for (const e of other.protos) {
        const { asnorm } = scoreTrial(e, s.protos, cohort, cfg);
        nontargets.push(asnorm);
        perSpeakerNontargets[s.id].push(asnorm);
      }
    }

    // Background cohort as imposters (each excluded from its own normalization).
    if (useCohort) {
      for (let j = 0; j < cohort.length; j++) {
        const { asnorm } = scoreTrial(cohort[j], s.protos, cohort, cfg, j);
        nontargets.push(asnorm);
        perSpeakerNontargets[s.id].push(asnorm);
      }
    }
  }

  return { targets, nontargets, perSpeakerNontargets, perSpeakerTargets };
}

// ─── FAR / FRR ────────────────────────────────────────────────────────────────

/** Fraction of non-target trials accepted (score >= threshold). */
export function farAt(nontargets: number[], threshold: number): number {
  if (nontargets.length === 0) return 0;
  let n = 0;
  for (const x of nontargets) if (x >= threshold) n++;
  return n / nontargets.length;
}

/** Fraction of target trials rejected (score < threshold). */
export function frrAt(targets: number[], threshold: number): number {
  if (targets.length === 0) return 0;
  let n = 0;
  for (const x of targets) if (x < threshold) n++;
  return n / targets.length;
}

/**
 * Smallest threshold whose FAR <= targetFAR. Chosen between adjacent non-target
 * scores so the boundary imposter is excluded (conservative).
 */
export function thresholdAtFAR(nontargets: number[], targetFAR: number): number {
  if (nontargets.length === 0) return 0;
  const desc = [...nontargets].sort((a, b) => b - a);
  const m = desc.length;
  const k = Math.floor(targetFAR * m); // number of imposters allowed through
  if (k <= 0) return desc[0] + 1e-6; // accept none
  if (k >= m) return desc[m - 1] - 1e-6; // accept all
  // Place the threshold between the k-th and (k+1)-th largest imposter scores.
  return (desc[k - 1] + desc[k]) / 2;
}

/** Equal-error rate (FAR == FRR), swept over candidate thresholds. */
export function computeEER(
  targets: number[],
  nontargets: number[],
): { eer: number; threshold: number } {
  const candidates = Array.from(new Set([...targets, ...nontargets])).sort((a, b) => a - b);
  let best = { eer: 1, threshold: 0, gap: Infinity };
  for (const t of candidates) {
    const far = farAt(nontargets, t);
    const frr = frrAt(targets, t);
    const gap = Math.abs(far - frr);
    if (gap < best.gap) best = { eer: (far + frr) / 2, threshold: t, gap };
  }
  return { eer: best.eer, threshold: best.threshold };
}

// ─── Per-speaker thresholds from tightness ────────────────────────────────────

/**
 * Derive per-speaker thresholds from intra-class tightness. A LOOSE enrollment
 * (low tightness) gets a STRICTER (higher) threshold — its scores are noisier,
 * so we demand more before assigning a name (bias toward "unknown"). A very
 * tight, consistent speaker may safely use a slightly lower bar.
 */
export function derivePerSpeakerThresholds(
  globalThreshold: number,
  speakers: CalibrationSpeaker[],
  slope: number,
  cap: number,
): Record<string, number> {
  const meanTightness =
    speakers.reduce((s, sp) => s + sp.tightness, 0) / Math.max(1, speakers.length);
  const out: Record<string, number> = {};
  for (const s of speakers) {
    const adj = slope * (meanTightness - s.tightness); // looser → positive → stricter
    const clamped = Math.max(-cap, Math.min(cap, adj));
    out[s.id] = globalThreshold + clamped;
  }
  return out;
}

// ─── Top-level calibration ────────────────────────────────────────────────────

export function calibrate(
  speakers: CalibrationSpeaker[],
  cohort: number[][],
  opts: CalibrationOptions = {},
): CalibrationResult {
  const targetFAR = opts.targetFAR ?? 0.01;
  const slope = opts.perSpeakerSlope ?? 0.5;
  const cap = opts.perSpeakerCap ?? 1.0;
  const warnings: string[] = [];

  const dist = buildTrials(speakers, cohort, opts);

  if (dist.targets.length === 0) {
    warnings.push('No target trials — every speaker has < 2 prototypes. Re-enroll with more utterances.');
  }
  if (dist.nontargets.length === 0) {
    warnings.push('No non-target trials — need >= 2 speakers or a non-empty cohort.');
  }

  const threshold = thresholdAtFAR(dist.nontargets, targetFAR);
  const { eer, threshold: eerThreshold } = computeEER(dist.targets, dist.nontargets);
  const perSpeakerThresholds = derivePerSpeakerThresholds(threshold, speakers, slope, cap);

  const tMean = dist.targets.length ? dist.targets.reduce((a, b) => a + b, 0) / dist.targets.length : 0;
  const ntMean = dist.nontargets.length
    ? dist.nontargets.reduce((a, b) => a + b, 0) / dist.nontargets.length
    : 0;

  return {
    threshold,
    targetFAR,
    achievedFAR: farAt(dist.nontargets, threshold),
    achievedFRR: frrAt(dist.targets, threshold),
    eer,
    eerThreshold,
    perSpeakerThresholds,
    numTargetTrials: dist.targets.length,
    numNontargetTrials: dist.nontargets.length,
    summary: {
      targetMean: tMean,
      targetMin: dist.targets.length ? Math.min(...dist.targets) : 0,
      nontargetMean: ntMean,
      nontargetMax: dist.nontargets.length ? Math.max(...dist.nontargets) : 0,
    },
    warnings,
  };
}
