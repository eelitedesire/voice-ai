/**
 * Guided multi-condition enrollment — pure decision logic.
 *
 * PURE module — no ONNX, no filesystem. Holds every accept/reject and
 * warning decision for the guided enrollment flow so it can be unit-tested in
 * isolation and reused by the impure write-path (lib/sherpa-onnx.ts) and the
 * enroll route. The impure side only *measures* (VAD, embeddings, RMS); this
 * module *decides*.
 *
 * Design intent: the deliverable of enrollment is COVERAGE ACROSS CONDITIONS,
 * not more embeddings from one condition. The loud/soft samples are validated
 * against each other for a real energy difference, or the coverage is fake.
 */

import type { SpeakerPrototype } from './entities';

// ─── Conditions ──────────────────────────────────────────────────────────────

/** Conditions a complete enrollment must cover. `far` is reserved for v2 — the
 *  `conditions` field is a free string so adding it later needs no schema change. */
export const REQUIRED_CONDITIONS = ['normal', 'loud', 'soft'] as const;
export type RequiredCondition = (typeof REQUIRED_CONDITIONS)[number];
/** Any captured condition tag (required set today, extensible tomorrow). */
export type EnrollmentCondition = RequiredCondition | string;

export type EnrollmentStatus = 'incomplete' | 'complete';

// ─── Energy / dB ───────────────────────────────────────────────────────────────

/** RMS → dBFS (0 dBFS = full scale). Silence → -Infinity. */
export function rmsToDbfs(rms: number): number {
  return rms <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(rms);
}

/** Level of `a` relative to `b` in dB: 20·log10(a/b). +ve = a is louder. */
export function dbDifference(a: number, b: number): number {
  if (a <= 0) return Number.NEGATIVE_INFINITY;
  if (b <= 0) return Number.POSITIVE_INFINITY;
  return 20 * Math.log10(a / b);
}

/**
 * Minimum separation between adjacent conditions. 3 dB ≈ 1.41× amplitude — the
 * classic just-noticeable / half-power step: below it the "difference" is within
 * natural variation and AGC jitter and isn't reliable coverage; at/above it the
 * contrast is real and survives even if a browser ignored autoGainControl:false.
 */
export const DEFAULT_MIN_SEPARATION_DB = 3;

export interface EnergyValidationResult {
  ok: boolean;
  reason?: string;
  deltaDb?: number;
}

/**
 * Validate a recording's energy against the reference `normal` RMS. This is the
 * backstop that catches AGC-flattened (fake) loud/soft recordings: it measures
 * the RECORDED rms, so a flattened pair lands < minDb apart and is rejected.
 */
export function validateEnergySeparation(
  condition: EnrollmentCondition,
  conditionRms: number,
  normalRms: number | null,
  minDb = DEFAULT_MIN_SEPARATION_DB,
): EnergyValidationResult {
  if (condition === 'normal') return { ok: true };
  if (normalRms == null) {
    return { ok: false, reason: 'Record the "normal" sample first — it is the reference for loud/soft.' };
  }
  const delta = dbDifference(conditionRms, normalRms);
  if (condition === 'loud') {
    return delta >= minDb
      ? { ok: true, deltaDb: delta }
      : { ok: false, deltaDb: delta, reason: `The loud sample is only ${delta.toFixed(1)} dB above normal; project more (need ≥ ${minDb} dB louder).` };
  }
  if (condition === 'soft') {
    return delta <= -minDb
      ? { ok: true, deltaDb: delta }
      : { ok: false, deltaDb: delta, reason: `The soft sample is only ${Math.abs(delta).toFixed(1)} dB below normal; speak more quietly (need ≥ ${minDb} dB softer).` };
  }
  // Unknown/extension conditions (e.g. future 'far') are not energy-validated.
  return { ok: true };
}

// ─── Per-recording quality gating ───────────────────────────────────────────────

export interface RecordingMetrics {
  condition: EnrollmentCondition;
  /** Seconds of VOICED audio (post-VAD), not wall-clock recording length. */
  voicedSec: number;
  /** Voiced-vs-noise-floor SNR in dB. */
  snrDb: number;
  /** Fraction of samples at/near full scale (0..1). */
  clippingFraction: number;
  /** Representative RMS of the voiced audio (used for cross-condition dB). */
  rms: number;
}

export interface GatingConfig {
  minVoicedSec: number;
  minSnrDb: number;
  maxClippingFraction: number;
  /** Absolute floor — even the "soft" sample must be audible enough to embed. */
  minRms: number;
}

export const DEFAULT_GATING: GatingConfig = {
  minVoicedSec: 4,
  minSnrDb: 10,
  maxClippingFraction: 0.005,
  minRms: 0.004,
};

export interface GateResult {
  ok: boolean;
  reason?: string;
}

/** Accept/reject one recording on its own merits (before cross-condition checks). */
export function gateRecording(m: RecordingMetrics, cfg: GatingConfig = DEFAULT_GATING): GateResult {
  if (m.voicedSec < cfg.minVoicedSec) {
    return { ok: false, reason: `Only ${m.voicedSec.toFixed(1)} s of speech detected; record at least ${cfg.minVoicedSec} s of continuous talking.` };
  }
  if (m.clippingFraction > cfg.maxClippingFraction) {
    return { ok: false, reason: `Audio is clipping (${(m.clippingFraction * 100).toFixed(1)}% of samples maxed out); move back from the mic or lower input gain, then redo this sample.` };
  }
  if (m.rms < cfg.minRms) {
    return { ok: false, reason: 'Too quiet to capture a reliable voiceprint; speak up a little and redo this sample.' };
  }
  if (m.snrDb < cfg.minSnrDb) {
    return { ok: false, reason: `Too much background noise (SNR ${m.snrDb.toFixed(0)} dB); find a quieter spot and redo this sample.` };
  }
  return { ok: true };
}

// ─── Tightness / coverage ────────────────────────────────────────────────────

export interface TightnessBand {
  low: number;
  high: number;
}

/**
 * Provisional default band on mean-pairwise-cosine tightness.
 *
 * For these L2-normalized speaker embeddings, same-speaker / different-utterance
 * cosine typically sits ~0.6–0.85 and different-speaker ~0.2–0.45 (the target vs
 * non-target regimes Stage 2 calibration measures). A genuine MULTI-condition set
 * should live in the same-speaker regime but SPREAD OUT:
 *   - mean pairwise > ~0.92 ⇒ no spread → one condition repeated (coverage fake).
 *   - mean pairwise < ~0.50 ⇒ approaching different-speaker territory → a
 *     recording may be a different person / crosstalk.
 * These are warning triggers, NOT gates.
 */
export const DEFAULT_TIGHTNESS_BAND: TightnessBand = { low: 0.5, high: 0.92 };

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Derive a band from observed genuine same-speaker pairwise cosines (e.g. fed
 * from calibration data). Uses robust quantiles, clamped to sane ranges. Falls
 * back to DEFAULT_TIGHTNESS_BAND when no samples are available.
 */
export function tightnessBandFromSamples(sameSpeakerPairCosines?: number[] | null): TightnessBand {
  if (!sameSpeakerPairCosines || sameSpeakerPairCosines.length < 4) {
    return DEFAULT_TIGHTNESS_BAND;
  }
  const sorted = [...sameSpeakerPairCosines].sort((a, b) => a - b);
  return {
    low: clamp(quantile(sorted, 0.05), 0.3, 0.7),
    high: clamp(quantile(sorted, 0.95), 0.8, 0.98),
  };
}

export type CoverageWarningCode =
  | 'missing-conditions'
  | 'too-tight'
  | 'too-loose'
  | 'confusable';

export interface CoverageWarning {
  code: CoverageWarningCode;
  message: string;
}

/** Inverted-tightness coverage assessment (warnings, never gates). */
export function assessCoverage(args: {
  tightness: number;
  conditionsPresent: string[];
  required?: readonly string[];
  band?: TightnessBand;
}): CoverageWarning[] {
  const band = args.band ?? DEFAULT_TIGHTNESS_BAND;
  const required = args.required ?? REQUIRED_CONDITIONS;
  const warnings: CoverageWarning[] = [];

  const missing = required.filter((c) => !args.conditionsPresent.includes(c));
  if (missing.length > 0) {
    warnings.push({ code: 'missing-conditions', message: `Missing condition(s): ${missing.join(', ')}.` });
  }
  if (args.tightness > band.high) {
    warnings.push({
      code: 'too-tight',
      message: `Recordings are very similar (tightness ${args.tightness.toFixed(2)} > ${band.high}); coverage may be narrow — re-record with more contrast between the loud and soft samples.`,
    });
  }
  if (args.tightness < band.low) {
    warnings.push({
      code: 'too-loose',
      message: `Recordings are unusually dissimilar (tightness ${args.tightness.toFixed(2)} < ${band.low}); one recording may contain a different speaker or crosstalk — review them.`,
    });
  }
  return warnings;
}

// ─── Confusable-pair check ────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Confusable threshold on centroid cosine between two ENROLLED speakers.
 * Different speakers normally sit < ~0.45; > ~0.6 means they're embedding-close
 * enough to risk being confused at match time. Default 0.6; overridable / can be
 * tied to the cohort non-target distribution later.
 */
export const DEFAULT_CONFUSABLE_THRESHOLD = 0.6;

export function assessConfusable(args: {
  candidate: { id: string; name: string; centroid: number[] };
  others: { id: string; name: string; centroid: number[] }[];
  threshold?: number;
}): CoverageWarning[] {
  const thr = args.threshold ?? DEFAULT_CONFUSABLE_THRESHOLD;
  const warnings: CoverageWarning[] = [];
  for (const other of args.others) {
    if (other.id === args.candidate.id) continue;
    const sim = cosine(args.candidate.centroid, other.centroid);
    if (sim >= thr) {
      warnings.push({
        code: 'confusable',
        message: `"${args.candidate.name}" is acoustically close to enrolled "${other.name}" (cosine ${sim.toFixed(2)} ≥ ${thr}); they may be confused — consider re-recording with more distinct samples.`,
      });
    }
  }
  return warnings;
}

// ─── Status & prototype helpers ─────────────────────────────────────────────────

/** Distinct condition tags present across a prototype set. */
export function conditionsPresent(protos: Array<{ conditions?: string }>): string[] {
  const set = new Set<string>();
  for (const p of protos) if (p.conditions) set.add(p.conditions);
  return [...set];
}

/** Max prototypes kept per condition (a 10 s clip yields ~5–6 windows; 8 leaves
 *  headroom while preventing pathological inflation on re-recording). */
export const DEFAULT_PROTOTYPES_PER_CONDITION = 8;

/** Keep the top-`cap` prototypes by quality score. */
export function capByQuality<T extends { qualityScore: number }>(protos: T[], cap: number): T[] {
  if (protos.length <= cap) return protos;
  return [...protos].sort((a, b) => b.qualityScore - a.qualityScore).slice(0, cap);
}

/**
 * Merge a freshly recorded condition into an existing prototype set, REPLACING
 * any prior prototypes tagged with that same condition (so re-recording, e.g.,
 * "normal" overwrites rather than stacks), and capping the condition by quality.
 * Other conditions are untouched.
 */
export function replaceConditionPrototypes<
  T extends { conditions?: string; qualityScore: number },
>(
  existing: T[],
  incoming: T[],
  condition: string,
  capPerCondition = DEFAULT_PROTOTYPES_PER_CONDITION,
): T[] {
  const kept = existing.filter((p) => p.conditions !== condition);
  return [...kept, ...capByQuality(incoming, capPerCondition)];
}

/** Mean RMS of the prototypes captured for a given condition (or null if none). */
export function meanRmsForCondition(
  protos: SpeakerPrototype[],
  condition: EnrollmentCondition,
): number | null {
  const rmsValues = protos.filter((p) => p.conditions === condition && typeof p.rms === 'number').map((p) => p.rms as number);
  if (rmsValues.length === 0) return null;
  return rmsValues.reduce((s, x) => s + x, 0) / rmsValues.length;
}

/**
 * A profile is `complete` only when explicitly finalized AND every required
 * condition is present; otherwise `incomplete`.
 */
export function computeEnrollmentStatus(args: {
  conditionsPresent: string[];
  finalized: boolean;
  required?: readonly string[];
}): EnrollmentStatus {
  const required = args.required ?? REQUIRED_CONDITIONS;
  const hasAll = required.every((c) => args.conditionsPresent.includes(c));
  return args.finalized && hasAll ? 'complete' : 'incomplete';
}

/**
 * Should a profile be loaded into the live match set?
 * Legacy profiles (no status field) are grandfathered as usable; only an
 * explicit `incomplete` (a half-finished guided enrollment) is excluded — never
 * loaded, so a partial profile can't quietly match.
 */
export function isUsableForMatching(profile: { enrollmentStatus?: EnrollmentStatus }): boolean {
  return profile.enrollmentStatus !== 'incomplete';
}
