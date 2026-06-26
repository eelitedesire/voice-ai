import {
  rmsToDbfs,
  dbDifference,
  validateEnergySeparation,
  gateRecording,
  DEFAULT_GATING,
  assessCoverage,
  DEFAULT_TIGHTNESS_BAND,
  tightnessBandFromSamples,
  assessConfusable,
  conditionsPresent,
  meanRmsForCondition,
  computeEnrollmentStatus,
  isUsableForMatching,
  replaceConditionPrototypes,
  capByQuality,
  REQUIRED_CONDITIONS,
  DEFAULT_MIN_SEPARATION_DB,
  type RecordingMetrics,
} from '@/lib/domain/enrollment';
import type { SpeakerPrototype } from '@/lib/domain/entities';

function proto(conditions: string, rms: number, v: number[] = [1, 0, 0]): SpeakerPrototype {
  return {
    v,
    dim: v.length,
    durationSec: 3,
    qualityScore: 0.8,
    rms,
    timestamp: 0,
    modelVersion: 'm',
    conditions,
    source: 'enrolled',
  };
}

function goodMetrics(over: Partial<RecordingMetrics> = {}): RecordingMetrics {
  return { condition: 'normal', voicedSec: 8, snrDb: 25, clippingFraction: 0, rms: 0.05, ...over };
}

// ─── dB helpers ──────────────────────────────────────────────────────────────

describe('dB helpers', () => {
  it('dbDifference is +6 dB for a 2× louder signal', () => {
    expect(dbDifference(0.1, 0.05)).toBeCloseTo(6.02, 1);
  });
  it('dbDifference is -6 dB for a 2× quieter signal', () => {
    expect(dbDifference(0.05, 0.1)).toBeCloseTo(-6.02, 1);
  });
  it('rmsToDbfs of silence is -Infinity', () => {
    expect(rmsToDbfs(0)).toBe(-Infinity);
  });
});

// ─── Energy separation (loud/soft must really differ) ─────────────────────────

describe('validateEnergySeparation', () => {
  it('normal always passes (it is the reference)', () => {
    expect(validateEnergySeparation('normal', 0.05, null).ok).toBe(true);
  });
  it('rejects loud/soft before a normal reference exists', () => {
    expect(validateEnergySeparation('loud', 0.1, null).ok).toBe(false);
  });
  it('accepts a loud sample ≥ 3 dB above normal', () => {
    const r = validateEnergySeparation('loud', 0.08, 0.05); // ~+4.1 dB
    expect(r.ok).toBe(true);
    expect(r.deltaDb!).toBeGreaterThanOrEqual(DEFAULT_MIN_SEPARATION_DB);
  });
  it('rejects a loud sample that is barely louder (AGC-flattened)', () => {
    const r = validateEnergySeparation('loud', 0.055, 0.05); // ~+0.8 dB
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/project more|louder/i);
  });
  it('accepts a soft sample ≥ 3 dB below normal', () => {
    expect(validateEnergySeparation('soft', 0.03, 0.05).ok).toBe(true); // ~-4.4 dB
  });
  it('rejects a soft sample that is not actually softer', () => {
    expect(validateEnergySeparation('soft', 0.048, 0.05).ok).toBe(false);
  });
  it('does not energy-validate unknown/extension conditions', () => {
    expect(validateEnergySeparation('far', 0.05, 0.05).ok).toBe(true);
  });
});

// ─── Per-recording gating ──────────────────────────────────────────────────────

describe('gateRecording', () => {
  it('passes a clean recording', () => {
    expect(gateRecording(goodMetrics()).ok).toBe(true);
  });
  it('rejects too little voiced speech', () => {
    const r = gateRecording(goodMetrics({ voicedSec: 2 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/at least 4 s/);
  });
  it('rejects clipping', () => {
    expect(gateRecording(goodMetrics({ clippingFraction: 0.02 })).ok).toBe(false);
  });
  it('rejects too-quiet audio', () => {
    expect(gateRecording(goodMetrics({ rms: 0.001 })).ok).toBe(false);
  });
  it('rejects low SNR', () => {
    expect(gateRecording(goodMetrics({ snrDb: 5 })).ok).toBe(false);
  });
});

// ─── Inverted tightness / coverage ─────────────────────────────────────────────

describe('assessCoverage (inverted tightness band)', () => {
  const all = ['normal', 'loud', 'soft'];

  it('no warnings for a healthy, complete, spread-out enrollment', () => {
    expect(assessCoverage({ tightness: 0.75, conditionsPresent: all })).toEqual([]);
  });
  it('warns "too-tight" when recordings are nearly identical (single condition repeated)', () => {
    const w = assessCoverage({ tightness: 0.96, conditionsPresent: all });
    expect(w.some((x) => x.code === 'too-tight')).toBe(true);
  });
  it('warns "too-loose" when recordings are suspiciously dissimilar', () => {
    const w = assessCoverage({ tightness: 0.4, conditionsPresent: all });
    expect(w.some((x) => x.code === 'too-loose')).toBe(true);
  });
  it('warns about missing conditions', () => {
    const w = assessCoverage({ tightness: 0.75, conditionsPresent: ['normal', 'loud'] });
    expect(w.some((x) => x.code === 'missing-conditions')).toBe(true);
  });
});

describe('tightnessBandFromSamples', () => {
  it('falls back to the default band without enough samples', () => {
    expect(tightnessBandFromSamples(null)).toEqual(DEFAULT_TIGHTNESS_BAND);
    expect(tightnessBandFromSamples([0.7])).toEqual(DEFAULT_TIGHTNESS_BAND);
  });
  it('derives a clamped band from a genuine same-speaker distribution', () => {
    const samples = [0.6, 0.65, 0.7, 0.72, 0.75, 0.78, 0.8, 0.82, 0.85, 0.88];
    const band = tightnessBandFromSamples(samples);
    expect(band.low).toBeGreaterThanOrEqual(0.3);
    expect(band.high).toBeLessThanOrEqual(0.98);
    expect(band.low).toBeLessThan(band.high);
  });
});

// ─── Confusable pair ───────────────────────────────────────────────────────────

describe('assessConfusable', () => {
  it('warns when two enrolled speakers are embedding-close', () => {
    const w = assessConfusable({
      candidate: { id: 'a', name: 'Ann', centroid: [1, 0, 0] },
      others: [{ id: 'b', name: 'Abe', centroid: [0.98, 0.2, 0] }],
    });
    expect(w.some((x) => x.code === 'confusable')).toBe(true);
  });
  it('is quiet for well-separated speakers', () => {
    const w = assessConfusable({
      candidate: { id: 'a', name: 'Ann', centroid: [1, 0, 0] },
      others: [{ id: 'b', name: 'Bob', centroid: [0, 1, 0] }],
    });
    expect(w).toEqual([]);
  });
});

// ─── Prototype/condition helpers ───────────────────────────────────────────────

describe('condition + rms helpers', () => {
  const protos = [proto('normal', 0.05), proto('normal', 0.05), proto('loud', 0.09), proto('soft', 0.03)];

  it('conditionsPresent returns the distinct set', () => {
    expect(conditionsPresent(protos).sort()).toEqual(['loud', 'normal', 'soft']);
  });
  it('meanRmsForCondition averages per condition', () => {
    expect(meanRmsForCondition(protos, 'normal')).toBeCloseTo(0.05, 6);
    expect(meanRmsForCondition(protos, 'loud')).toBeCloseTo(0.09, 6);
  });
  it('meanRmsForCondition is null for an absent condition', () => {
    expect(meanRmsForCondition(protos, 'far')).toBeNull();
  });
});

// ─── Duplicate-condition prevention (replace + cap) ─────────────────────────────

describe('replaceConditionPrototypes', () => {
  it('replaces prior prototypes for the same condition (no stacking)', () => {
    const existing = [proto('normal', 0.05), proto('normal', 0.05), proto('loud', 0.09)];
    const incoming = [proto('normal', 0.06), proto('normal', 0.06)];
    const merged = replaceConditionPrototypes(existing, incoming, 'normal');
    expect(merged.filter((p) => p.conditions === 'normal')).toHaveLength(2); // not 4
    expect(merged.filter((p) => p.conditions === 'loud')).toHaveLength(1); // untouched
  });

  it('leaves other conditions intact when adding a new one', () => {
    const existing = [proto('normal', 0.05)];
    const incoming = [proto('loud', 0.09)];
    const merged = replaceConditionPrototypes(existing, incoming, 'loud');
    expect(conditionsPresent(merged).sort()).toEqual(['loud', 'normal']);
  });

  it('caps a condition by quality score', () => {
    const incoming = Array.from({ length: 12 }, (_, i) => {
      const p = proto('normal', 0.05);
      p.qualityScore = i / 12; // ascending
      return p;
    });
    const merged = replaceConditionPrototypes([], incoming, 'normal', 8);
    expect(merged).toHaveLength(8);
    // kept the 8 highest-quality
    expect(Math.min(...merged.map((p) => p.qualityScore))).toBeGreaterThanOrEqual(4 / 12);
  });
});

describe('capByQuality', () => {
  it('returns input unchanged when under the cap', () => {
    const xs = [{ qualityScore: 0.5 }, { qualityScore: 0.9 }];
    expect(capByQuality(xs, 8)).toHaveLength(2);
  });
});

// ─── Enrollment status + live-load gate ────────────────────────────────────────

describe('computeEnrollmentStatus', () => {
  it('is incomplete until finalized', () => {
    expect(computeEnrollmentStatus({ conditionsPresent: [...REQUIRED_CONDITIONS], finalized: false })).toBe('incomplete');
  });
  it('is incomplete when a required condition is missing, even if finalized', () => {
    expect(computeEnrollmentStatus({ conditionsPresent: ['normal', 'loud'], finalized: true })).toBe('incomplete');
  });
  it('is complete only when finalized AND all conditions present', () => {
    expect(computeEnrollmentStatus({ conditionsPresent: ['normal', 'loud', 'soft'], finalized: true })).toBe('complete');
  });
});

describe('isUsableForMatching', () => {
  it('excludes an explicitly incomplete profile', () => {
    expect(isUsableForMatching({ enrollmentStatus: 'incomplete' })).toBe(false);
  });
  it('includes a complete profile', () => {
    expect(isUsableForMatching({ enrollmentStatus: 'complete' })).toBe(true);
  });
  it('grandfathers a legacy profile with no status', () => {
    expect(isUsableForMatching({})).toBe(true);
  });
});
