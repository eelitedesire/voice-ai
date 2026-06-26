/**
 * Runtime assembly of the AS-Norm context + tracker config from disk.
 *
 * Reads models/cohort.json (BackgroundCohort) and models/calibration.json
 * (written by scripts/calibrate-thresholds.ts) and builds the AsNormContext the
 * SpeakerIdentifier needs. If either file is missing, invalid, or version-
 * mismatched, it returns null and the caller runs in degraded mode — LOUDLY
 * logged, never silently stale (the cohort-versioning hard requirement).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { AsNormContext } from './speaker-identification';
import type { SpeakerTrackerConfig } from './domain/speaker-tracker';
import { validateCohort, DEFAULT_ASNORM_CONFIG, type BackgroundCohort } from './domain/cohort';

interface CalibrationFile {
  cohortVersion: string;
  modelVersion: string;
  threshold: number;
  perSpeakerThresholds?: Record<string, number>;
  asnorm?: { protoK: number; cohortK: number };
}

function num(env: string | undefined, fallback: number): number {
  const n = env === undefined ? NaN : Number(env);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Load + validate the AS-Norm context. Returns null (degraded mode) on any of:
 * missing cohort/calibration, invalid cohort, or cohort/calibration version
 * mismatch. Every failure path logs why.
 */
export function loadAsNormContext(modelPath: string): AsNormContext | null {
  const cohortPath = path.join(modelPath, 'cohort.json');
  const calibPath = path.join(modelPath, 'calibration.json');

  if (!fs.existsSync(cohortPath) || !fs.existsSync(calibPath)) {
    console.warn(
      '[AsNorm] cohort.json or calibration.json missing — degraded mode. ' +
        'Run: npm run generate-cohort && npm run calibrate',
    );
    return null;
  }

  let cohort: BackgroundCohort;
  let calib: CalibrationFile;
  try {
    cohort = JSON.parse(fs.readFileSync(cohortPath, 'utf-8'));
    calib = JSON.parse(fs.readFileSync(calibPath, 'utf-8'));
  } catch (e) {
    console.warn('[AsNorm] Failed to parse cohort/calibration — degraded mode:', e);
    return null;
  }

  const problems = validateCohort(cohort);
  if (problems.length > 0) {
    console.warn('[AsNorm] Invalid cohort — degraded mode:', problems.join('; '));
    return null;
  }

  // Hard version gate: calibration must target THIS cohort.
  if (calib.cohortVersion !== cohort.version) {
    console.warn(
      `[AsNorm] calibration cohortVersion "${calib.cohortVersion}" != cohort "${cohort.version}" ` +
        '— stale calibration, degraded mode. Re-run: npm run calibrate',
    );
    return null;
  }

  const protoK = calib.asnorm?.protoK ?? DEFAULT_ASNORM_CONFIG.protoK;
  const cohortK = calib.asnorm?.cohortK ?? DEFAULT_ASNORM_CONFIG.cohortK;

  console.log(
    `[AsNorm] Active — cohort ${cohort.version} (${cohort.embeddings.length} imposters), ` +
      `threshold ${calib.threshold.toFixed(3)}`,
  );

  return {
    cohort: cohort.embeddings,
    cohortVersion: cohort.version,
    modelVersion: cohort.modelVersion,
    protoK,
    cohortK,
    threshold: calib.threshold,
    // The AS-Norm decision margin is a tuning knob (z-score units); env-override.
    margin: num(process.env.SPEAKER_ASNORM_MARGIN, 0.3),
    perSpeakerThresholds: calib.perSpeakerThresholds,
  };
}

/**
 * Tracker tuning for the active mode. Units follow the score the identifier
 * emits: AS-Norm z-scores when a context is present, raw cosine in degraded mode.
 * All knobs are env-overridable; defaults are conservative starting points that
 * should be tuned on a real recorded session.
 */
export function buildTrackerConfig(
  ctx: AsNormContext | null,
  degradedAccept: number,
  degradedMargin: number,
): SpeakerTrackerConfig {
  if (ctx) {
    return {
      accept: ctx.threshold,
      margin: ctx.margin,
      perSpeakerThresholds: ctx.perSpeakerThresholds,
      switchMargin: num(process.env.TRACKER_SWITCH_MARGIN, 0.75),
      holdMargin: num(process.env.TRACKER_HOLD_MARGIN, 1.5),
      switchHops: num(process.env.TRACKER_SWITCH_HOPS, 1),
      lookahead: num(process.env.TRACKER_LOOKAHEAD, 2),
    };
  }
  // Degraded (cosine) units — much tighter margins.
  return {
    accept: degradedAccept,
    margin: degradedMargin,
    switchMargin: num(process.env.TRACKER_SWITCH_MARGIN_COS, 0.05),
    holdMargin: num(process.env.TRACKER_HOLD_MARGIN_COS, 0.12),
    switchHops: num(process.env.TRACKER_SWITCH_HOPS, 1),
    lookahead: num(process.env.TRACKER_LOOKAHEAD, 2),
  };
}
