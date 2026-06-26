import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadAsNormContext, buildTrackerConfig } from '@/lib/asnorm-context';

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}

function tmpModelDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'asnorm-'));
}

function writeCohort(dir: string, overrides: Record<string, unknown> = {}) {
  const cohort = {
    version: 'cohort-test-1',
    modelVersion: 'eres2net',
    dim: 3,
    embeddings: [normalize([1, 0, 0]), normalize([0, 1, 0]), normalize([0, 0, 1])],
    createdAt: 1,
    sourceCount: 3,
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, 'cohort.json'), JSON.stringify(cohort));
}

function writeCalib(dir: string, overrides: Record<string, unknown> = {}) {
  const calib = {
    cohortVersion: 'cohort-test-1',
    modelVersion: 'eres2net',
    threshold: 1.75,
    perSpeakerThresholds: { a: 2.0 },
    asnorm: { protoK: 3, cohortK: 80 },
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, 'calibration.json'), JSON.stringify(calib));
}

describe('loadAsNormContext', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('builds a context from matching cohort + calibration', () => {
    const dir = tmpModelDir();
    writeCohort(dir);
    writeCalib(dir);
    const ctx = loadAsNormContext(dir);
    expect(ctx).not.toBeNull();
    expect(ctx!.cohortVersion).toBe('cohort-test-1');
    expect(ctx!.cohort).toHaveLength(3);
    expect(ctx!.threshold).toBe(1.75);
    expect(ctx!.protoK).toBe(3);
    expect(ctx!.cohortK).toBe(80);
    expect(ctx!.perSpeakerThresholds).toEqual({ a: 2.0 });
  });

  it('returns null (degraded) when files are missing', () => {
    const dir = tmpModelDir();
    expect(loadAsNormContext(dir)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('returns null on a cohort/calibration version mismatch', () => {
    const dir = tmpModelDir();
    writeCohort(dir, { version: 'cohort-NEW' });
    writeCalib(dir, { cohortVersion: 'cohort-OLD' });
    expect(loadAsNormContext(dir)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale calibration'));
  });

  it('returns null on an invalid cohort', () => {
    const dir = tmpModelDir();
    writeCohort(dir, { embeddings: [[1, 0]] }); // dim mismatch (says 3)
    writeCalib(dir);
    expect(loadAsNormContext(dir)).toBeNull();
  });

  it('falls back to default asnorm config when calibration omits it', () => {
    const dir = tmpModelDir();
    writeCohort(dir);
    writeCalib(dir, { asnorm: undefined });
    const ctx = loadAsNormContext(dir);
    expect(ctx!.protoK).toBe(3); // DEFAULT_ASNORM_CONFIG
    expect(ctx!.cohortK).toBe(100);
  });
});

describe('buildTrackerConfig', () => {
  it('uses AS-Norm threshold/margin when a context is present', () => {
    const ctx = {
      cohort: [[1, 0, 0]],
      cohortVersion: 'v1',
      modelVersion: 'm',
      protoK: 3,
      cohortK: 50,
      threshold: 1.75,
      margin: 0.3,
      perSpeakerThresholds: { a: 2 },
    };
    const cfg = buildTrackerConfig(ctx, 0.5, 0.06);
    expect(cfg.accept).toBe(1.75);
    expect(cfg.margin).toBe(0.3);
    expect(cfg.perSpeakerThresholds).toEqual({ a: 2 });
    expect(cfg.switchHops).toBeGreaterThanOrEqual(1);
  });

  it('uses degraded cosine thresholds with no context', () => {
    const cfg = buildTrackerConfig(null, 0.5, 0.06);
    expect(cfg.accept).toBe(0.5);
    expect(cfg.margin).toBe(0.06);
    // cosine-unit hysteresis should be much tighter than z-score units
    expect(cfg.switchMargin).toBeLessThan(0.5);
  });
});
