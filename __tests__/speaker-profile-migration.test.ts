import {
  migrateProfile,
  migrateDatabase,
  needsMigration,
  isCohortStale,
  validateProfile,
  validateDatabase,
  computeIntraClassTightness,
  CURRENT_PROFILE_SCHEMA_VERSION,
  COHORT_VERSION_NONE,
  UNKNOWN_LEGACY_MODEL,
  LEGACY_QUALITY_SCORE,
} from '@/lib/domain/speaker-profile';
import type {
  SpeakerProfile,
  SpeakerDatabase,
  SpeakerPrototype,
} from '@/lib/domain/entities';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Raw (un-normalized) embedding pointing along `axis` with magnitude `mag`. */
function rawVec(dim: number, axis: number, mag = 3): number[] {
  const v = new Array(dim).fill(0);
  v[axis] = mag;
  return v;
}

function norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function legacySingle(id: string, axis: number): SpeakerProfile {
  return {
    id,
    name: id,
    role: id,
    voiceprint: rawVec(8, axis), // RAW, magnitude 3
  };
}

function legacyMulti(id: string, axes: number[]): SpeakerProfile {
  return {
    id,
    name: id,
    role: id,
    voiceprint: rawVec(8, axes[0]),
    embeddings: axes.map((a) => rawVec(8, a)),
  };
}

const NOW = 1_700_000_000_000;

// ─── Tightness ───────────────────────────────────────────────────────────────

describe('computeIntraClassTightness', () => {
  const proto = (v: number[]): SpeakerPrototype => ({
    v,
    dim: v.length,
    durationSec: 0,
    qualityScore: 0.5,
    timestamp: NOW,
    modelVersion: 'm',
    source: 'enrolled',
  });

  it('returns 1 for a single prototype', () => {
    expect(computeIntraClassTightness([proto([1, 0])])).toBe(1);
  });

  it('returns 0 for no prototypes', () => {
    expect(computeIntraClassTightness([])).toBe(0);
  });

  it('returns 1 for identical normalized prototypes', () => {
    expect(computeIntraClassTightness([proto([1, 0]), proto([1, 0])])).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal prototypes', () => {
    expect(computeIntraClassTightness([proto([1, 0]), proto([0, 1])])).toBeCloseTo(0, 6);
  });
});

// ─── Migration: legacy single voiceprint ─────────────────────────────────────

describe('migrateProfile — legacy single voiceprint', () => {
  it('creates exactly one normalized prototype from a raw voiceprint', () => {
    const { profile, created } = migrateProfile(legacySingle('sarah', 0), {
      modelVersion: 'eres2net',
      now: NOW,
    });
    expect(created).toBe(1);
    expect(profile.prototypes).toHaveLength(1);
    const p = profile.prototypes![0];
    expect(norm(p.v)).toBeCloseTo(1, 6); // normalized
    expect(p.dim).toBe(8);
    expect(p.source).toBe('migrated');
    expect(p.qualityScore).toBe(LEGACY_QUALITY_SCORE);
    expect(p.modelVersion).toBe('eres2net');
    expect(p.timestamp).toBe(NOW);
    expect(p.durationSec).toBe(0);
  });

  it('preserves the legacy voiceprint field (non-destructive / rollback)', () => {
    const original = legacySingle('sarah', 0);
    const { profile } = migrateProfile(original, { now: NOW });
    expect(profile.voiceprint).toEqual(original.voiceprint); // untouched raw
  });

  it('defaults model to unknown-legacy when not provided', () => {
    const { profile } = migrateProfile(legacySingle('s', 0), { now: NOW });
    expect(profile.prototypes![0].modelVersion).toBe(UNKNOWN_LEGACY_MODEL);
  });

  it('stamps the current schema version', () => {
    const { profile } = migrateProfile(legacySingle('s', 0), { now: NOW });
    expect(profile.schemaVersion).toBe(CURRENT_PROFILE_SCHEMA_VERSION);
  });
});

// ─── Migration: legacy multi embeddings ──────────────────────────────────────

describe('migrateProfile — legacy multi embeddings', () => {
  it('creates one normalized prototype per raw embedding', () => {
    const { profile, created } = migrateProfile(legacyMulti('alex', [0, 1, 2]), {
      now: NOW,
    });
    expect(created).toBe(3);
    expect(profile.prototypes).toHaveLength(3);
    for (const p of profile.prototypes!) expect(norm(p.v)).toBeCloseTo(1, 6);
  });

  it('records tightness in stats (orthogonal embeddings → ~0)', () => {
    const { profile } = migrateProfile(legacyMulti('alex', [0, 1, 2]), { now: NOW });
    expect(profile.stats!.intraClassTightness).toBeCloseTo(0, 6);
  });

  it('records tightness ~1 for repeated embeddings', () => {
    const { profile } = migrateProfile(legacyMulti('alex', [3, 3, 3]), { now: NOW });
    expect(profile.stats!.intraClassTightness).toBeCloseTo(1, 6);
  });

  it('preserves legacy raw embeddings array', () => {
    const original = legacyMulti('alex', [0, 1]);
    const { profile } = migrateProfile(original, { now: NOW });
    expect(profile.embeddings).toEqual(original.embeddings);
  });
});

// ─── Cohort versioning (hard requirement) ────────────────────────────────────

describe('cohort versioning', () => {
  it('migrated profiles carry the none sentinel', () => {
    const { profile } = migrateProfile(legacySingle('s', 0), { now: NOW });
    expect(profile.stats!.cohortVersion).toBe(COHORT_VERSION_NONE);
  });

  it('isCohortStale is true for the none sentinel against any real version', () => {
    const { profile } = migrateProfile(legacySingle('s', 0), { now: NOW });
    expect(isCohortStale(profile, 'cohort-2026-06')).toBe(true);
  });

  it('isCohortStale is true when stats are missing entirely', () => {
    expect(isCohortStale(legacySingle('s', 0), 'cohort-2026-06')).toBe(true);
  });

  it('isCohortStale is false only on an exact version match', () => {
    const p = migrateProfile(legacySingle('s', 0), { now: NOW }).profile;
    p.stats!.cohortVersion = 'cohort-2026-06';
    expect(isCohortStale(p, 'cohort-2026-06')).toBe(false);
    expect(isCohortStale(p, 'cohort-2026-07')).toBe(true);
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('migration idempotency', () => {
  it('migrating an already-migrated profile does not re-normalize or duplicate', () => {
    const once = migrateProfile(legacyMulti('alex', [0, 1, 2]), { now: NOW }).profile;
    const twice = migrateProfile(once, { now: NOW + 5000 }).profile;
    expect(twice.prototypes).toHaveLength(3);
    expect(twice.prototypes).toEqual(once.prototypes); // vectors untouched
  });

  it('needsMigration flips false after migration', () => {
    const db: SpeakerDatabase = {
      speakers: [legacySingle('a', 0), legacyMulti('b', [1, 2])],
      modelVersion: '1.0.0',
      createdAt: NOW,
    };
    expect(needsMigration(db)).toBe(true);
    const { db: migrated } = migrateDatabase(db, { now: NOW });
    expect(needsMigration(migrated)).toBe(false);
  });
});

// ─── Database-level migration + backward compatibility ───────────────────────

describe('migrateDatabase', () => {
  it('migrates a mixed legacy database and reports counts', () => {
    const db: SpeakerDatabase = {
      speakers: [legacySingle('a', 0), legacyMulti('b', [1, 2, 3])],
      modelVersion: '1.0.0',
      createdAt: NOW,
    };
    const { db: migrated, report } = migrateDatabase(db, { now: NOW });

    expect(report.totalSpeakers).toBe(2);
    expect(report.migratedSpeakers).toBe(2);
    expect(report.alreadyCurrent).toBe(0);
    expect(report.prototypesCreated).toBe(4); // 1 + 3
    expect(migrated.schemaVersion).toBe(CURRENT_PROFILE_SCHEMA_VERSION);
    expect(migrated.cohortVersion).toBe(COHORT_VERSION_NONE);
  });

  it('a second pass reports everything already current', () => {
    const db: SpeakerDatabase = {
      speakers: [legacySingle('a', 0)],
      modelVersion: '1.0.0',
      createdAt: NOW,
    };
    const { db: once } = migrateDatabase(db, { now: NOW });
    const { report } = migrateDatabase(once, { now: NOW });
    expect(report.alreadyCurrent).toBe(1);
    expect(report.migratedSpeakers).toBe(0);
  });

  it('handles an empty database without throwing', () => {
    const db: SpeakerDatabase = { speakers: [], modelVersion: '1.0.0', createdAt: NOW };
    const { db: migrated, report } = migrateDatabase(db, { now: NOW });
    expect(report.totalSpeakers).toBe(0);
    expect(migrated.schemaVersion).toBe(CURRENT_PROFILE_SCHEMA_VERSION);
  });

  it('warns about a speaker with no usable embeddings', () => {
    const db: SpeakerDatabase = {
      speakers: [{ id: 'empty', name: 'E', role: 'E', voiceprint: [] }],
      modelVersion: '1.0.0',
      createdAt: NOW,
    };
    const { report } = migrateDatabase(db, { now: NOW });
    expect(report.warnings.some((w) => w.includes('empty'))).toBe(true);
  });
});

// ─── Validation ──────────────────────────────────────────────────────────────

describe('validateProfile', () => {
  it('passes a freshly migrated profile', () => {
    const { profile } = migrateProfile(legacyMulti('a', [0, 1, 2]), { now: NOW });
    expect(validateProfile(profile)).toEqual([]);
  });

  it('flags a profile with no prototypes', () => {
    expect(validateProfile(legacySingle('a', 0))).toContain('Speaker "a" has no prototypes.');
  });

  it('flags mixed dimensions', () => {
    const { profile } = migrateProfile(legacyMulti('a', [0, 1]), { now: NOW });
    profile.prototypes![1] = { ...profile.prototypes![1], v: [1, 0, 0, 0], dim: 4 };
    const problems = validateProfile(profile);
    expect(problems.some((p) => p.includes('mixed dimensions'))).toBe(true);
  });

  it('flags a non-normalized vector', () => {
    const { profile } = migrateProfile(legacySingle('a', 0), { now: NOW });
    profile.prototypes![0] = { ...profile.prototypes![0], v: [3, 0, 0, 0, 0, 0, 0, 0] };
    const problems = validateProfile(profile);
    expect(problems.some((p) => p.includes('not L2-normalized'))).toBe(true);
  });

  it('flags non-finite values', () => {
    const { profile } = migrateProfile(legacySingle('a', 0), { now: NOW });
    profile.prototypes![0] = {
      ...profile.prototypes![0],
      v: [NaN, 0, 0, 0, 0, 0, 0, 0],
    };
    expect(validateProfile(profile).some((p) => p.includes('non-finite'))).toBe(true);
  });

  it('validateDatabase aggregates across speakers', () => {
    const db: SpeakerDatabase = {
      speakers: [{ id: 'x', name: 'x', role: 'x', voiceprint: [] }],
      modelVersion: '1.0.0',
      createdAt: NOW,
    };
    const { db: migrated } = migrateDatabase(db, { now: NOW });
    expect(validateDatabase(migrated).length).toBeGreaterThan(0);
  });
});
