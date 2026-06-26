import {
  SpeakerTracker,
  openSetDecision,
  UNKNOWN_SPEAKER,
  type SpeakerTrackerConfig,
  type RankedSpeaker,
} from '@/lib/domain/speaker-tracker';

// Build a hop's ranked-speaker list from a {id: score} map.
function hop(scores: Record<string, number>): RankedSpeaker[] {
  return Object.entries(scores).map(([id, score]) => ({ id, score }));
}

const CFG: Partial<SpeakerTrackerConfig> = {
  accept: 2,
  margin: 0.3,
  switchMargin: 0.5,
  holdMargin: 1.0,
  switchHops: 3,
  lookahead: 2,
};

// ─── openSetDecision ──────────────────────────────────────────────────────────

describe('openSetDecision', () => {
  const policy = { accept: 2, margin: 0.3 };

  it('returns the top speaker when it clears threshold and margin', () => {
    expect(openSetDecision(hop({ a: 5, b: 1 }), policy).id).toBe('a');
  });
  it('returns unknown below the accept threshold', () => {
    expect(openSetDecision(hop({ a: 1.5, b: 0 }), policy).id).toBe(UNKNOWN_SPEAKER);
  });
  it('returns unknown when the top-1/top-2 margin is too small', () => {
    expect(openSetDecision(hop({ a: 5.0, b: 4.9 }), policy).id).toBe(UNKNOWN_SPEAKER);
  });
  it('honors per-speaker thresholds', () => {
    const p = { accept: 2, margin: 0.3, perSpeakerThresholds: { a: 10 } };
    expect(openSetDecision(hop({ a: 5, b: 1 }), p).id).toBe(UNKNOWN_SPEAKER);
  });
  it('handles an empty hop as unknown', () => {
    expect(openSetDecision([], policy).id).toBe(UNKNOWN_SPEAKER);
  });
});

// ─── Initialization ───────────────────────────────────────────────────────────

describe('SpeakerTracker — init', () => {
  it('adopts the first hop winner without reporting a change', () => {
    const t = new SpeakerTracker(CFG);
    const u = t.update(hop({ a: 5, b: 1 }));
    expect(u.provisional).toBe('a');
    expect(u.changed).toBe(false);
  });

  it('finalizes only after lookahead hops of stability', () => {
    const t = new SpeakerTracker(CFG);
    expect(t.update(hop({ a: 5, b: 1 })).finalized).toBeNull(); // stable=1 < 2
    expect(t.update(hop({ a: 5, b: 1 })).finalized).toBe('a'); // stable=2
  });
});

// ─── A single noisy hop must NOT change identity ──────────────────────────────

describe('SpeakerTracker — single noisy hop is ignored', () => {
  it('does not switch on one spurious hop', () => {
    const t = new SpeakerTracker(CFG);
    t.update(hop({ a: 5, b: 1 }));
    t.update(hop({ a: 5, b: 1 }));
    const noisy = t.update(hop({ b: 5, a: 1 })); // one bad hop
    expect(noisy.provisional).toBe('a');
    expect(noisy.changed).toBe(false);
    const back = t.update(hop({ a: 5, b: 1 }));
    expect(back.provisional).toBe('a');
  });
});

// ─── A sustained challenger DOES switch after N hops ──────────────────────────

describe('SpeakerTracker — sustained challenger switches', () => {
  it('flips to B after switchHops consecutive qualifying hops', () => {
    const t = new SpeakerTracker(CFG);
    t.update(hop({ a: 5, b: 1 }));
    t.update(hop({ a: 5, b: 1 }));
    expect(t.update(hop({ b: 5, a: 1 })).changed).toBe(false); // streak 1
    expect(t.update(hop({ b: 5, a: 1 })).changed).toBe(false); // streak 2
    const flip = t.update(hop({ b: 5, a: 1 })); // streak 3 → flip
    expect(flip.changed).toBe(true);
    expect(flip.provisional).toBe('b');
    expect(flip.finalized).toBeNull(); // resets stability
    expect(t.update(hop({ b: 5, a: 1 })).finalized).toBe('b'); // lags by lookahead
  });

  it('reports changed=true on exactly one hop', () => {
    const t = new SpeakerTracker(CFG);
    const changes: boolean[] = [];
    for (const h of [
      { a: 5, b: 1 },
      { b: 5, a: 1 },
      { b: 5, a: 1 },
      { b: 5, a: 1 },
      { b: 5, a: 1 },
    ]) {
      changes.push(t.update(hop(h)).changed);
    }
    expect(changes.filter(Boolean)).toHaveLength(1);
  });
});

// ─── Score hysteresis (switchMargin) ──────────────────────────────────────────

describe('SpeakerTracker — score hysteresis blocks marginal challengers', () => {
  it('does NOT switch when the challenger fails to beat the incumbent by switchMargin', () => {
    const t = new SpeakerTracker(CFG);
    t.update(hop({ a: 5.0, b: 1 }));
    // b passes accept + margin, but only beats a (5.0) by 0.4 < switchMargin 0.5.
    for (let i = 0; i < 5; i++) {
      const u = t.update(hop({ b: 5.4, a: 5.0 }));
      expect(u.provisional).toBe('a');
      expect(u.changed).toBe(false);
    }
  });

  it('DOES switch once the challenger clears the switchMargin, sustained', () => {
    const t = new SpeakerTracker(CFG);
    t.update(hop({ a: 5.0, b: 1 }));
    let flips = 0;
    for (let i = 0; i < 3; i++) {
      if (t.update(hop({ b: 5.6, a: 5.0 })).changed) flips++; // 5.6 ≥ 5.0 + 0.5
    }
    expect(flips).toBe(1);
    expect(t.current).toBe('b');
  });
});

// ─── Relaxed retention (holdMargin) — named → unknown ─────────────────────────

describe('SpeakerTracker — incumbent is retained through dips', () => {
  it('keeps the incumbent while its score stays above the hold threshold', () => {
    const t = new SpeakerTracker(CFG); // hold threshold = accept(2) − holdMargin(1) = 1
    t.update(hop({ a: 5, b: 0 }));
    // a dips to 1.5: below accept(2) so nobody is "accepted", but above hold(1).
    for (let i = 0; i < 5; i++) {
      const u = t.update(hop({ a: 1.5, b: 0 }));
      expect(u.provisional).toBe('a'); // retained
    }
  });

  it('drops to unknown once the incumbent falls below hold, sustained', () => {
    const t = new SpeakerTracker(CFG);
    t.update(hop({ a: 5, b: 0 }));
    t.update(hop({ a: 0.5, b: 0 })); // below hold(1) → unknown challenge, streak 1
    t.update(hop({ a: 0.5, b: 0 })); // streak 2
    const u = t.update(hop({ a: 0.5, b: 0 })); // streak 3 → flip to unknown
    expect(u.changed).toBe(true);
    expect(u.provisional).toBe(UNKNOWN_SPEAKER);
  });
});

// ─── Unknown → named adoption ─────────────────────────────────────────────────

describe('SpeakerTracker — adopts a named speaker out of unknown', () => {
  it('switches from unknown to an accepted speaker after switchHops', () => {
    const t = new SpeakerTracker(CFG);
    expect(t.update(hop({ a: 1, b: 0 })).provisional).toBe(UNKNOWN_SPEAKER); // a below accept
    t.update(hop({ a: 5, b: 0 })); // streak 1
    t.update(hop({ a: 5, b: 0 })); // streak 2
    const u = t.update(hop({ a: 5, b: 0 })); // streak 3 → adopt a
    expect(u.changed).toBe(true);
    expect(u.provisional).toBe('a');
  });
});

// ─── Reset ────────────────────────────────────────────────────────────────────

describe('SpeakerTracker — reset', () => {
  it('reinitializes on the next hop after reset', () => {
    const t = new SpeakerTracker(CFG);
    t.update(hop({ a: 5, b: 1 }));
    t.reset();
    expect(t.current).toBe(UNKNOWN_SPEAKER);
    const u = t.update(hop({ b: 5, a: 1 }));
    expect(u.provisional).toBe('b'); // fresh adoption, no flip needed
    expect(u.changed).toBe(false);
  });
});
