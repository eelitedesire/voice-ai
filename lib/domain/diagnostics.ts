/**
 * Failure categorization for the speaker-ID baseline.
 *
 * PURE module — no I/O. Given the per-segment diagnostics the pipeline now emits
 * (decision, raw similarity, normalized score, threshold, tracker override), it
 * attributes a problem segment to ONE layer, so the report tells you whether the
 * next improvement is model-, scoring-, or tracking-level:
 *
 *   - 'embedding'  — the embedding itself landed far from any enrolled speaker
 *                    (raw similarity below the floor). The model couldn't place
 *                    this utterance (e.g. laughter / very soft speech). → model-level.
 *   - 'threshold'  — the embedding WAS near a speaker (raw ok) but the calibrated
 *                    AS-Norm score / margin rejected it. → scoring/calibration-level.
 *   - 'tracker'    — identity instability the tracker should have absorbed: a
 *                    short-lived flip that reverts (flicker). → tracking-level.
 *
 * IMPORTANT: this is heuristic. Without ground-truth labels we cannot KNOW a
 * segment is wrong; we classify the *likely-problem* segments by signal. A
 * tracker `hold` (override that suppressed a dip) is reported separately as a
 * SUCCESS, not a failure.
 */

export type MissCategory = 'embedding' | 'threshold';

export interface SegmentDiag {
  speaker: string;
  decision: 'known' | 'uncertain' | 'unknown';
  rawScore?: number;
  score?: number;
  threshold?: number;
  trackerOverride?: boolean;
}

export interface DiagConfig {
  /**
   * Raw similarity below which we attribute a miss to the embedding rather than
   * the threshold. For these L2-normalized embeddings, same-speaker raw cosine is
   * typically ~0.5–0.85; below ~0.45 the embedding simply isn't near the speaker,
   * so no threshold could have rescued it. Tune against the verify-enroll output.
   */
  embeddingFloor: number;
  /** Look-ahead (in segments) for detecting a revert flicker A→B→A. */
  flickerWindow: number;
}

export const DEFAULT_DIAG_CONFIG: DiagConfig = { embeddingFloor: 0.45, flickerWindow: 2 };

/** Is this segment a "miss" (no confident enrolled-speaker assignment)? */
export function isMiss(d: SegmentDiag): boolean {
  return d.decision !== 'known';
}

/** Attribute a miss to embedding (raw too low) vs threshold (raw ok, rejected). */
export function categorizeMiss(d: SegmentDiag, cfg: DiagConfig = DEFAULT_DIAG_CONFIG): MissCategory {
  if (typeof d.rawScore === 'number' && d.rawScore < cfg.embeddingFloor) return 'embedding';
  return 'threshold';
}

/**
 * Count flicker events: a label change at i that REVERTS to the prior label
 * within `flickerWindow` segments (A→B→A). These are the tracking-level failures
 * (the tracker should have held). Tracker holds (overrides) are excluded — they
 * are the tracker doing its job.
 */
export function countFlickers(labels: string[], window = DEFAULT_DIAG_CONFIG.flickerWindow): number {
  let n = 0;
  for (let i = 1; i < labels.length; i++) {
    if (labels[i] === labels[i - 1]) continue;
    for (let j = i + 1; j <= Math.min(labels.length - 1, i + window); j++) {
      if (labels[j] === labels[i - 1]) {
        n++;
        break;
      }
    }
  }
  return n;
}

export interface CategoryReport {
  segments: number;
  misses: number;
  embeddingFailures: number;
  thresholdFailures: number;
  trackerHolds: number;
  flickers: number;
  /** Where the dominant problem is — the next improvement's level. */
  dominant: 'embedding' | 'threshold' | 'tracker' | 'none';
}

/** Aggregate a session's segments into the three-way failure breakdown. */
export function buildCategoryReport(
  segments: SegmentDiag[],
  cfg: DiagConfig = DEFAULT_DIAG_CONFIG,
): CategoryReport {
  let embeddingFailures = 0;
  let thresholdFailures = 0;
  let trackerHolds = 0;
  for (const d of segments) {
    if (d.trackerOverride) trackerHolds++;
    if (isMiss(d)) {
      if (categorizeMiss(d, cfg) === 'embedding') embeddingFailures++;
      else thresholdFailures++;
    }
  }
  const flickers = countFlickers(segments.map((s) => s.speaker), cfg.flickerWindow);
  const misses = embeddingFailures + thresholdFailures;

  const ranked: Array<['embedding' | 'threshold' | 'tracker', number]> = [
    ['embedding', embeddingFailures],
    ['threshold', thresholdFailures],
    ['tracker', flickers],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const dominant = ranked[0][1] === 0 ? 'none' : ranked[0][0];

  return {
    segments: segments.length,
    misses,
    embeddingFailures,
    thresholdFailures,
    trackerHolds,
    flickers,
    dominant,
  };
}
