/**
 * Speaker-profile schema versioning, migration, and validation.
 *
 * PURE module — no ONNX, no filesystem, no framework imports. It only
 * transforms in-memory `SpeakerProfile`/`SpeakerDatabase` values, so the
 * migration logic can be unit-tested in isolation and reused by both the
 * runtime loader (lib/speaker-identification.ts) and the CLI migration script.
 *
 * Responsibilities (Stage 1 of the multi-prototype redesign):
 *   - Convert legacy single-centroid profiles (`voiceprint` / raw `embeddings`)
 *     into the multi-prototype schema (`prototypes` + `stats`), non-destructively
 *     (legacy fields are preserved for rollback).
 *   - L2-normalize every embedding exactly once (idempotent).
 *   - Attach prototype metadata (dim, duration, quality, timestamp, model).
 *   - Compute intra-class tightness.
 *   - Enforce cohort versioning: migrated profiles carry the `COHORT_VERSION_NONE`
 *     sentinel so AS-Norm statistics can NEVER be silently trusted as fresh.
 */

import type {
  SpeakerProfile,
  SpeakerPrototype,
  SpeakerDatabase,
  SpeakerStats,
} from './entities';

// ─── Versioning ──────────────────────────────────────────────────────────

/** Schema version written by the current migration. Bump on schema changes. */
export const CURRENT_PROFILE_SCHEMA_VERSION = '2.0.0-multiproto';

/**
 * Sentinel cohort version meaning "no cohort statistics have been computed".
 * It is intentionally never equal to a real cohort version, so a profile in
 * this state is always treated as stale and AS-Norm must (re)compute its
 * enrollment-side statistics before it can be used.
 */
export const COHORT_VERSION_NONE = 'none';

/** Model identifier used for prototypes whose origin model is unknown. */
export const UNKNOWN_LEGACY_MODEL = 'unknown-legacy';

/** Default quality assigned to migrated prototypes (we have no quality signal). */
export const LEGACY_QUALITY_SCORE = 0.5;

/** Tolerance for "is this vector already L2-normalized?" checks. */
const NORM_TOLERANCE = 1e-3;

// ─── Local math helpers (kept local to preserve domain-layer purity) ───────

function l2normalize(v: ArrayLike<number>): number[] {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
  const norm = Math.sqrt(sumSq);
  const out = new Array<number>(v.length);
  if (norm === 0) {
    for (let i = 0; i < v.length; i++) out[i] = 0;
    return out;
  }
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** Cosine of two ALREADY-normalized vectors (= dot product). */
function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) d += a[i] * b[i];
  return d;
}

function isFiniteVector(v: ArrayLike<number>): boolean {
  for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return false;
  return true;
}

// ─── Tightness ─────────────────────────────────────────────────────────────

/**
 * Mean pairwise cosine among a speaker's (normalized) prototypes — a measure of
 * how internally consistent the enrollment is. 1 prototype → 1 (no spread to
 * measure); 0 prototypes → 0.
 */
export function computeIntraClassTightness(protos: SpeakerPrototype[]): number {
  const vecs = protos.map((p) => p.v);
  if (vecs.length <= 1) return vecs.length === 1 ? 1 : 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      sum += dot(vecs[i], vecs[j]);
      pairs++;
    }
  }
  return pairs === 0 ? 0 : sum / pairs;
}

// ─── Migration ───────────────────────────────────────────────────────────

export interface MigrationOptions {
  /** Model identifier to stamp on synthesized prototypes (default: unknown). */
  modelVersion?: string;
  /** Clock injection for deterministic tests (default: Date.now()). */
  now?: number;
}

export interface MigrationReport {
  totalSpeakers: number;
  migratedSpeakers: number;
  alreadyCurrent: number;
  prototypesCreated: number;
  warnings: string[];
}

/** True if the database (or any speaker) is not yet on the current schema. */
export function needsMigration(db: SpeakerDatabase): boolean {
  if (db.schemaVersion !== CURRENT_PROFILE_SCHEMA_VERSION) return true;
  return db.speakers.some(
    (s) =>
      s.schemaVersion !== CURRENT_PROFILE_SCHEMA_VERSION ||
      !s.prototypes ||
      s.prototypes.length === 0,
  );
}

/**
 * True if a profile's stored AS-Norm statistics are stale relative to the
 * active cohort and therefore must be recomputed before use. Missing stats,
 * the `none` sentinel, or any version mismatch all count as stale.
 */
export function isCohortStale(
  profile: SpeakerProfile,
  activeCohortVersion: string,
): boolean {
  const v = profile.stats?.cohortVersion;
  if (!v || v === COHORT_VERSION_NONE) return true;
  return v !== activeCohortVersion;
}

/**
 * Migrate a single profile to the multi-prototype schema. Idempotent: a profile
 * already on the current schema with prototypes is returned with only its
 * tightness/stats refreshed (no re-normalization, no prototype duplication).
 *
 * Non-destructive: legacy `voiceprint` and `embeddings` are preserved so the
 * change can be rolled back by reverting the schema version.
 */
export function migrateProfile(
  profile: SpeakerProfile,
  opts: MigrationOptions = {},
): { profile: SpeakerProfile; created: number; warnings: string[] } {
  const modelVersion = opts.modelVersion ?? UNKNOWN_LEGACY_MODEL;
  const now = opts.now ?? Date.now();
  const warnings: string[] = [];

  // Already migrated: keep prototypes as-is, just refresh derived stats so a
  // re-run is a no-op on the embeddings themselves.
  const alreadyHasProtos =
    Array.isArray(profile.prototypes) && profile.prototypes.length > 0;

  let prototypes: SpeakerPrototype[];
  let created = 0;

  if (alreadyHasProtos) {
    prototypes = profile.prototypes!;
  } else {
    // Source raw embeddings: prefer the richer `embeddings`, fall back to the
    // single legacy `voiceprint`.
    const rawSets: number[][] =
      Array.isArray(profile.embeddings) && profile.embeddings.length > 0
        ? profile.embeddings.filter((e) => Array.isArray(e) && e.length > 0)
        : Array.isArray(profile.voiceprint) && profile.voiceprint.length > 0
          ? [profile.voiceprint]
          : [];

    if (rawSets.length === 0) {
      warnings.push(`Speaker "${profile.id}" has no usable embeddings; migrated empty.`);
    }

    prototypes = rawSets.map((raw) => {
      const v = l2normalize(raw);
      return {
        v,
        dim: v.length,
        durationSec: 0,
        qualityScore: LEGACY_QUALITY_SCORE,
        timestamp: now,
        modelVersion,
        source: 'migrated' as const,
      };
    });
    created = prototypes.length;
  }

  const intraClassTightness = computeIntraClassTightness(prototypes);

  // Cohort-side stats CANNOT be computed here (no cohort, no model). We stamp
  // the `none` sentinel so AS-Norm is forced to recompute before trusting them.
  const stats: SpeakerStats = {
    intraClassTightness,
    cohortMean: 0,
    cohortStd: 0,
    cohortVersion: COHORT_VERSION_NONE,
  };

  const migrated: SpeakerProfile = {
    ...profile,
    prototypes,
    stats,
    schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
    // Preserve legacy mirror so older readers / rollback still work.
    voiceprint: profile.voiceprint ?? (prototypes[0]?.v ?? []),
  };

  return { profile: migrated, created, warnings };
}

/** Migrate a whole database. Returns the new DB plus an audit report. */
export function migrateDatabase(
  db: SpeakerDatabase,
  opts: MigrationOptions = {},
): { db: SpeakerDatabase; report: MigrationReport } {
  const warnings: string[] = [];
  let migratedSpeakers = 0;
  let alreadyCurrent = 0;
  let prototypesCreated = 0;

  const speakers = db.speakers.map((s) => {
    const wasCurrent =
      s.schemaVersion === CURRENT_PROFILE_SCHEMA_VERSION &&
      Array.isArray(s.prototypes) &&
      s.prototypes.length > 0;
    const { profile, created, warnings: w } = migrateProfile(s, opts);
    warnings.push(...w);
    if (wasCurrent) alreadyCurrent++;
    else migratedSpeakers++;
    prototypesCreated += created;
    return profile;
  });

  const newDb: SpeakerDatabase = {
    ...db,
    speakers,
    schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
    // Global cohort version stays `none` until Stage 2/3 computes real stats.
    cohortVersion: db.cohortVersion ?? COHORT_VERSION_NONE,
  };

  return {
    db: newDb,
    report: {
      totalSpeakers: db.speakers.length,
      migratedSpeakers,
      alreadyCurrent,
      prototypesCreated,
      warnings,
    },
  };
}

// ─── Validation ────────────────────────────────────────────────────────────

/**
 * Structural validation of a migrated profile. Returns a list of problems
 * (empty = valid). Catches the failure modes that would silently corrupt
 * matching: inconsistent dimensions, non-finite values, and un-normalized
 * vectors slipping through.
 */
export function validateProfile(profile: SpeakerProfile): string[] {
  const problems: string[] = [];
  const protos = profile.prototypes ?? [];

  if (protos.length === 0) {
    problems.push(`Speaker "${profile.id}" has no prototypes.`);
    return problems;
  }

  const dim0 = protos[0].dim;
  for (let i = 0; i < protos.length; i++) {
    const p = protos[i];
    if (p.v.length !== p.dim) {
      problems.push(`Speaker "${profile.id}" prototype ${i}: v.length ${p.v.length} != dim ${p.dim}.`);
    }
    if (p.dim !== dim0) {
      problems.push(`Speaker "${profile.id}" prototype ${i}: dim ${p.dim} != ${dim0} (mixed dimensions).`);
    }
    if (!isFiniteVector(p.v)) {
      problems.push(`Speaker "${profile.id}" prototype ${i}: contains non-finite values.`);
    } else {
      let sumSq = 0;
      for (let k = 0; k < p.v.length; k++) sumSq += p.v[k] * p.v[k];
      const norm = Math.sqrt(sumSq);
      // Zero vectors are tolerated (degenerate but not corrupting); otherwise
      // require unit length within tolerance.
      if (norm > NORM_TOLERANCE && Math.abs(norm - 1) > NORM_TOLERANCE) {
        problems.push(`Speaker "${profile.id}" prototype ${i}: not L2-normalized (|v|=${norm.toFixed(4)}).`);
      }
    }
    if (p.qualityScore < 0 || p.qualityScore > 1) {
      problems.push(`Speaker "${profile.id}" prototype ${i}: qualityScore ${p.qualityScore} out of [0,1].`);
    }
  }

  return problems;
}

/** Validate every speaker in a database. Returns a flat list of problems. */
export function validateDatabase(db: SpeakerDatabase): string[] {
  return db.speakers.flatMap((s) => validateProfile(s));
}
