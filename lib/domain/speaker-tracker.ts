/**
 * Temporal speaker-identity tracker.
 *
 * PURE module — no ONNX, no I/O. It turns a stream of per-hop, per-speaker
 * scores (as produced by SpeakerIdentifier.scoreSpeakers) into a STABLE identity
 * label, so a single noisy embedding can never flip the speaker.
 *
 * It is a sticky tracker with two independent guards against flicker, plus a
 * provisional/finalized split that mirrors the ASR partial/final pattern:
 *
 *   1. Score hysteresis (dual threshold + switch margin):
 *      - A challenger must clear the strict ACCEPT policy (threshold + top-1/
 *        top-2 margin) to be considered at all.
 *      - To switch BETWEEN two named speakers, the challenger must additionally
 *        beat the incumbent's current score by `switchMargin` — a higher bar to
 *        leave the incumbent than to keep it.
 *      - The incumbent is RETAINED through dips while its score stays above a
 *        relaxed hold threshold (`accept − holdMargin`), even if no one is
 *        accepted that hop.
 *   2. Temporal confirmation: a qualifying challenger must win `switchHops`
 *      CONSECUTIVE hops before the committed label flips.
 *
 *   provisional — the committed label, emitted every hop (responsive, sticky).
 *   finalized   — emitted only once the committed label has persisted for
 *                 `lookahead` hops (lags the flip; safe to write to history).
 *
 * On a confirmed flip the caller (the streaming pipeline) should rebuild the new
 * segment's reference from post-boundary frames only — the tracker just reports
 * `changed: true`; it does not blend references.
 */

/** Sentinel for "no enrolled speaker owns this audio". */
export const UNKNOWN_SPEAKER = '__unknown__';

/** Minimal shape consumed per hop — structurally compatible with ScoredSpeaker. */
export interface RankedSpeaker {
  id: string;
  score: number;
}

export interface OpenSetPolicy {
  /** Global accept threshold on the score. */
  accept: number;
  /** Required top-1 vs top-2 margin for a valid (non-unknown) winner. */
  margin: number;
  /** Optional per-speaker accept thresholds (keyed by speaker id). */
  perSpeakerThresholds?: Record<string, number>;
}

export interface SpeakerTrackerConfig extends OpenSetPolicy {
  /** Extra score a challenger must beat the incumbent by to switch (hysteresis). */
  switchMargin: number;
  /** Incumbent is retained while its score ≥ accept − holdMargin. */
  holdMargin: number;
  /** Consecutive qualifying hops required before the committed label flips. */
  switchHops: number;
  /** Hops the committed label must persist before it is finalized. */
  lookahead: number;
}

export const DEFAULT_TRACKER_CONFIG: SpeakerTrackerConfig = {
  accept: 0,
  margin: 0,
  switchMargin: 0.5,
  holdMargin: 1.0,
  switchHops: 3,
  lookahead: 2,
};

export interface TrackerUpdate {
  /** Committed sticky label this hop (a speaker id or UNKNOWN_SPEAKER). */
  provisional: string;
  /** Committed label once it has persisted `lookahead` hops; else null. */
  finalized: string | null;
  /** True only on the hop the committed label flipped. */
  changed: boolean;
}

/**
 * Instantaneous open-set winner for one hop's scores (no temporal state).
 * Exported so the streaming pipeline and tests share the exact accept rule.
 */
export function openSetDecision(
  scored: RankedSpeaker[],
  policy: OpenSetPolicy,
): { id: string; score: number } {
  if (scored.length === 0) {
    return { id: UNKNOWN_SPEAKER, score: Number.NEGATIVE_INFINITY };
  }
  const s = scored.length > 1 ? [...scored].sort((a, b) => b.score - a.score) : scored;
  const top = s[0];
  const runner = s[1];
  const thr = policy.perSpeakerThresholds?.[top.id] ?? policy.accept;
  const marginOk = !runner || top.score - runner.score >= policy.margin;
  if (top.score >= thr && marginOk) return { id: top.id, score: top.score };
  return { id: UNKNOWN_SPEAKER, score: top.score };
}

function scoreOf(scored: RankedSpeaker[], id: string): number {
  for (const s of scored) if (s.id === id) return s.score;
  return Number.NEGATIVE_INFINITY;
}

export class SpeakerTracker {
  private readonly cfg: SpeakerTrackerConfig;

  private initialized = false;
  private currentId: string = UNKNOWN_SPEAKER;
  private challengerId: string | null = null;
  private streak = 0;
  /** Consecutive hops the committed label has been unchanged. */
  private stable = 0;

  constructor(cfg: Partial<SpeakerTrackerConfig> = {}) {
    this.cfg = { ...DEFAULT_TRACKER_CONFIG, ...cfg };
  }

  /** Current committed label (a speaker id or UNKNOWN_SPEAKER). */
  get current(): string {
    return this.currentId;
  }

  /** Clear all temporal state (new session). */
  reset(): void {
    this.initialized = false;
    this.currentId = UNKNOWN_SPEAKER;
    this.challengerId = null;
    this.streak = 0;
    this.stable = 0;
  }

  /**
   * Advance the tracker by one hop of per-speaker scores. Returns the
   * provisional + finalized labels and whether the committed label flipped.
   */
  update(scored: RankedSpeaker[]): TrackerUpdate {
    const inst = openSetDecision(scored, this.cfg);

    // First hop: adopt the instantaneous winner with no flip.
    if (!this.initialized) {
      this.initialized = true;
      this.currentId = inst.id;
      this.challengerId = null;
      this.streak = 0;
      this.stable = 1;
      return this.emit(false);
    }

    const incumbentNamed = this.currentId !== UNKNOWN_SPEAKER;
    const incumbentScore = incumbentNamed ? scoreOf(scored, this.currentId) : Number.NEGATIVE_INFINITY;
    const holdThr = incumbentNamed
      ? (this.cfg.perSpeakerThresholds?.[this.currentId] ?? this.cfg.accept) - this.cfg.holdMargin
      : Number.NEGATIVE_INFINITY;
    const incumbentHolds = incumbentNamed && incumbentScore >= holdThr;

    // Decide whether this hop presents a qualifying challenge to the incumbent.
    let challengeId: string | null = null;

    if (inst.id === this.currentId) {
      // Incumbent reaffirmed as the instantaneous winner.
      challengeId = null;
    } else if (incumbentNamed && inst.id !== UNKNOWN_SPEAKER) {
      // Named → different named: require beating the incumbent by switchMargin.
      challengeId = inst.score >= incumbentScore + this.cfg.switchMargin ? inst.id : null;
    } else if (incumbentNamed && inst.id === UNKNOWN_SPEAKER) {
      // Named → unknown: only a real challenge once the incumbent stops holding.
      challengeId = incumbentHolds ? null : UNKNOWN_SPEAKER;
    } else {
      // Incumbent is UNKNOWN; the challenger is an accepted named speaker.
      challengeId = inst.id;
    }

    let changed = false;
    if (challengeId === null) {
      // No qualifying challenge — incumbent stays; the challenge streak fizzles.
      this.challengerId = null;
      this.streak = 0;
      this.stable += 1;
    } else {
      if (challengeId === this.challengerId) this.streak += 1;
      else {
        this.challengerId = challengeId;
        this.streak = 1;
      }
      if (this.streak >= this.cfg.switchHops) {
        this.currentId = challengeId;
        this.challengerId = null;
        this.streak = 0;
        this.stable = 1;
        changed = true;
      } else {
        // Pending switch; the committed label has not changed yet.
        this.stable += 1;
      }
    }

    return this.emit(changed);
  }

  private emit(changed: boolean): TrackerUpdate {
    const finalized = this.stable >= this.cfg.lookahead ? this.currentId : null;
    return { provisional: this.currentId, finalized, changed };
  }
}
