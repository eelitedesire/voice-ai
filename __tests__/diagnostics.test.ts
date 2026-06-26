import {
  isMiss,
  categorizeMiss,
  countFlickers,
  buildCategoryReport,
  DEFAULT_DIAG_CONFIG,
  type SegmentDiag,
} from '@/lib/domain/diagnostics';

function seg(over: Partial<SegmentDiag>): SegmentDiag {
  return { speaker: 'A', decision: 'known', rawScore: 0.7, score: 5, threshold: 2, ...over };
}

describe('isMiss', () => {
  it('a known segment is not a miss', () => {
    expect(isMiss(seg({ decision: 'known' }))).toBe(false);
  });
  it('unknown / uncertain are misses', () => {
    expect(isMiss(seg({ decision: 'unknown' }))).toBe(true);
    expect(isMiss(seg({ decision: 'uncertain' }))).toBe(true);
  });
});

describe('categorizeMiss', () => {
  it('low raw similarity → embedding failure (model-level)', () => {
    expect(categorizeMiss(seg({ decision: 'unknown', rawScore: 0.2 }))).toBe('embedding');
  });
  it('raw ok but rejected → threshold failure (scoring-level)', () => {
    expect(categorizeMiss(seg({ decision: 'unknown', rawScore: 0.6 }))).toBe('threshold');
  });
  it('missing rawScore defaults to threshold (conservative)', () => {
    expect(categorizeMiss(seg({ decision: 'unknown', rawScore: undefined }))).toBe('threshold');
  });
  it('respects a custom embedding floor', () => {
    expect(categorizeMiss(seg({ decision: 'unknown', rawScore: 0.5 }), { ...DEFAULT_DIAG_CONFIG, embeddingFloor: 0.55 })).toBe('embedding');
  });
});

describe('countFlickers', () => {
  it('counts an A→B→A revert as one flicker', () => {
    expect(countFlickers(['A', 'B', 'A'])).toBe(1);
  });
  it('does not count a genuine sustained change', () => {
    expect(countFlickers(['A', 'A', 'B', 'B', 'B'])).toBe(0);
  });
  it('counts multiple flickers', () => {
    expect(countFlickers(['A', 'B', 'A', 'C', 'A'])).toBe(2); // B→revert, C→revert
  });
  it('respects the look-ahead window', () => {
    // revert is 3 segments later; window 2 should miss it
    expect(countFlickers(['A', 'B', 'B', 'B', 'A'], 2)).toBe(0);
  });
});

describe('buildCategoryReport', () => {
  it('separates the three failure layers and picks the dominant one', () => {
    const segments: SegmentDiag[] = [
      seg({ speaker: 'A', decision: 'known' }),
      seg({ speaker: 'A', decision: 'unknown', rawScore: 0.15 }), // embedding
      seg({ speaker: 'A', decision: 'unknown', rawScore: 0.18 }), // embedding
      seg({ speaker: 'A', decision: 'unknown', rawScore: 0.6 }), // threshold
      seg({ speaker: 'B', decision: 'known', trackerOverride: true }), // hold (success)
    ];
    const r = buildCategoryReport(segments);
    expect(r.embeddingFailures).toBe(2);
    expect(r.thresholdFailures).toBe(1);
    expect(r.trackerHolds).toBe(1);
    expect(r.dominant).toBe('embedding');
  });

  it('reports dominant=tracker when flickers lead', () => {
    const segments: SegmentDiag[] = [
      seg({ speaker: 'A', decision: 'known' }),
      seg({ speaker: 'B', decision: 'known' }),
      seg({ speaker: 'A', decision: 'known' }),
      seg({ speaker: 'B', decision: 'known' }),
      seg({ speaker: 'A', decision: 'known' }),
    ];
    const r = buildCategoryReport(segments);
    expect(r.misses).toBe(0);
    expect(r.flickers).toBeGreaterThan(0);
    expect(r.dominant).toBe('tracker');
  });

  it('dominant=none for a clean session', () => {
    const r = buildCategoryReport([seg({ decision: 'known' }), seg({ decision: 'known' })]);
    expect(r.dominant).toBe('none');
  });
});
