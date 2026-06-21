/**
 * Speaker identification & lightweight online diarization.
 *
 * This module is the decision layer that sits on top of raw speaker embeddings.
 * It is deliberately dependency-free (no ONNX, no I/O) so the matching logic can
 * be unit-tested in isolation and reused by both the live streaming path and the
 * batch/file path.
 *
 * Design goals (see the product requirements):
 *   1. NEVER assign an enrolled speaker unless similarity clears a strict
 *      threshold. Unknown voices stay "Unknown Speaker".
 *   2. Multiple embeddings per enrolled speaker (different conditions), compared
 *      via a stable centroid plus a best-sample fallback.
 *   3. A margin test so two enrolled speakers with similar voices aren't
 *      confused — the best match must beat the runner-up by a margin.
 *   4. Three-way decision: known / uncertain / unknown, each with a score and a
 *      human-readable reason for confidence visualisation.
 *   5. Online clustering of unknown voices into stable "Guest N" labels within a
 *      session, so distinct unknown speakers are separated (no overlap handling).
 */

// ─── Math helpers (exported for tests) ─────────────────────────────────────

/** L2-normalise a vector. Returns a new Float32Array; zero vectors pass through. */
export function l2normalize(v: ArrayLike<number>): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
  const norm = Math.sqrt(sumSq);
  const out = new Float32Array(v.length);
  if (norm === 0) return out;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** Cosine similarity of two ALREADY-normalised vectors (= dot product), in [-1, 1]. */
export function cosineNormalized(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/** Mean of normalised vectors, re-normalised — a robust centroid for a speaker. */
export function centroid(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) return new Float32Array(0);
  const dim = vectors[0].length;
  const acc = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) acc[i] += v[i];
  }
  for (let i = 0; i < dim; i++) acc[i] /= vectors.length;
  return l2normalize(acc);
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EnrolledSpeaker {
  id: string;
  name: string;
  /** All enrolled samples, L2-normalised. */
  embeddings: Float32Array[];
  /** Re-normalised mean of `embeddings` — the primary comparison vector. */
  centroid: Float32Array;
}

export type SpeakerDecision = 'known' | 'uncertain' | 'unknown';

export interface SpeakerMatch {
  /** Final label to display: enrolled name, "Guest N", or "Unknown Speaker". */
  speaker: string;
  decision: SpeakerDecision;
  /** Cosine similarity (-1..1) to the closest enrolled speaker. */
  score: number;
  /** Closest enrolled speaker name (regardless of whether it was accepted). */
  bestName: string;
  /** Runner-up enrolled speaker, for the margin/confusion check. */
  runnerUpName?: string;
  runnerUpScore?: number;
  /** Human-readable explanation for confidence visualisation. */
  reason: string;
}

export interface SpeakerIdentifierConfig {
  /** similarity ≥ this AND margin satisfied → accept as the enrolled speaker. */
  acceptThreshold: number;
  /** similarity in [uncertainThreshold, acceptThreshold) → uncertain (not assigned). */
  uncertainThreshold: number;
  /** best must beat runner-up by at least this, else it's a confusable/uncertain match. */
  margin: number;
  /** cosine to merge an unknown voice into an existing session-local cluster. */
  unknownClusterThreshold: number;
  /** Label distinct unknown voices as "Guest 1/2/…"; false → always "Unknown Speaker". */
  labelUnknownClusters: boolean;
  /** Label used for unmatched voices when clustering is disabled. */
  unknownLabel: string;
}

export const DEFAULT_CONFIG: SpeakerIdentifierConfig = {
  acceptThreshold: 0.5,
  uncertainThreshold: 0.38,
  margin: 0.06,
  unknownClusterThreshold: 0.5,
  // Default: label every unenrolled voice "Unknown Speaker". Set to true (via
  // SPEAKER_LABEL_UNKNOWN_CLUSTERS) to instead separate distinct unknown voices
  // into "Guest 1/2/…".
  labelUnknownClusters: false,
  unknownLabel: 'Unknown Speaker',
};

/** Build a config from env vars, falling back to DEFAULT_CONFIG. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SpeakerIdentifierConfig {
  const num = (v: string | undefined, d: number) => {
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    acceptThreshold: num(env.SPEAKER_ACCEPT_THRESHOLD, DEFAULT_CONFIG.acceptThreshold),
    uncertainThreshold: num(env.SPEAKER_UNCERTAIN_THRESHOLD, DEFAULT_CONFIG.uncertainThreshold),
    margin: num(env.SPEAKER_MARGIN, DEFAULT_CONFIG.margin),
    unknownClusterThreshold: num(env.SPEAKER_UNKNOWN_CLUSTER_THRESHOLD, DEFAULT_CONFIG.unknownClusterThreshold),
    labelUnknownClusters:
      (env.SPEAKER_LABEL_UNKNOWN_CLUSTERS ?? 'false').toLowerCase() === 'true',
    unknownLabel: env.SPEAKER_UNKNOWN_LABEL || DEFAULT_CONFIG.unknownLabel,
  };
}

/**
 * Normalise raw enrolled profiles (number[][] embeddings, or a legacy single
 * `voiceprint`) into `EnrolledSpeaker`s with centroids. Profiles whose
 * embeddings have the wrong dimension or are empty are skipped.
 */
export function buildEnrolledSpeakers(
  profiles: Array<{ id: string; name?: string; role?: string; voiceprint?: number[]; embeddings?: number[][] }>,
): EnrolledSpeaker[] {
  const out: EnrolledSpeaker[] = [];
  for (const p of profiles) {
    const raw: number[][] = [];
    if (Array.isArray(p.embeddings) && p.embeddings.length > 0) {
      for (const e of p.embeddings) if (Array.isArray(e) && e.length) raw.push(e);
    } else if (Array.isArray(p.voiceprint) && p.voiceprint.length) {
      raw.push(p.voiceprint);
    }
    if (raw.length === 0) continue;
    const embeddings = raw.map((e) => l2normalize(e));
    out.push({
      id: p.id,
      name: p.name || p.role || p.id,
      embeddings,
      centroid: centroid(embeddings),
    });
  }
  return out;
}

interface UnknownCluster {
  label: string;
  centroid: Float32Array;
  count: number;
}

/**
 * Stateful identifier. Enrolled speakers are fixed for the lifetime of the
 * instance; unknown-voice clusters accumulate per session, so create one
 * instance per session/connection.
 */
export class SpeakerIdentifier {
  private readonly speakers: EnrolledSpeaker[];
  private readonly cfg: SpeakerIdentifierConfig;
  private readonly unknownClusters: UnknownCluster[] = [];
  private unknownCount = 0;

  constructor(speakers: EnrolledSpeaker[], cfg: Partial<SpeakerIdentifierConfig> = {}) {
    this.speakers = speakers;
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  get enrolledCount(): number {
    return this.speakers.length;
  }

  /**
   * Identify a single raw (un-normalised) embedding. Pure w.r.t. enrolled
   * speakers; mutates only the session-local unknown clusters.
   */
  identify(rawEmbedding: ArrayLike<number>): SpeakerMatch {
    const emb = l2normalize(rawEmbedding);

    if (this.speakers.length === 0) {
      // No enrolment → everything is an (optionally clustered) unknown voice.
      return this.asUnknown(emb, 0, '', 'no speakers enrolled');
    }

    // Score every enrolled speaker by centroid similarity (stable), keeping the
    // best per-sample similarity as a secondary signal.
    const scored = this.speakers
      .map((s) => ({
        name: s.name,
        score: cosineNormalized(emb, s.centroid),
        best: maxCosine(emb, s.embeddings),
      }))
      .sort((a, b) => b.score - a.score);

    return this.decide(scored, emb);
  }

  /**
   * Identify a speaker from MANY embeddings sampled across one segment (the
   * rolling 1.5s windows). Aggregating per-window similarities is far more
   * robust than embedding the whole segment once: a 5s turn yields ~8 windows,
   * so a couple of noisy windows (onset, breath, room noise) no longer drag the
   * score below threshold and cause a false "Unknown". For each enrolled speaker
   * we take the trimmed mean of its top-`m` window similarities.
   */
  identifyMany(rawEmbeddings: ArrayLike<number>[]): SpeakerMatch {
    const embs = rawEmbeddings.map((e) => l2normalize(e)).filter((e) => e.length > 0);
    if (embs.length === 0) {
      return { speaker: this.cfg.unknownLabel, decision: 'unknown', score: 0, bestName: '', reason: 'no audio for speaker id' };
    }
    if (embs.length === 1) return this.identify(rawEmbeddings[0]);

    const meanEmb = centroid(embs); // representative vector for unknown clustering

    if (this.speakers.length === 0) {
      return this.asUnknown(meanEmb, 0, '', 'no speakers enrolled');
    }

    const TOP_M = 3;
    const scored = this.speakers
      .map((s) => {
        const centroidSims = embs.map((e) => cosineNormalized(e, s.centroid));
        const bestSims = embs.map((e) => maxCosine(e, s.embeddings));
        return {
          name: s.name,
          score: trimmedTopMean(centroidSims, TOP_M),
          best: trimmedTopMean(bestSims, TOP_M),
        };
      })
      .sort((a, b) => b.score - a.score);

    return this.decide(scored, meanEmb, embs.length);
  }

  /**
   * Apply the strict accept / uncertain / unknown decision to a ranked list of
   * enrolled-speaker scores. `embForCluster` seeds unknown clustering; `nWindows`
   * (if >1) is noted in the reason for diagnostics.
   */
  private decide(
    scored: { name: string; score: number; best: number }[],
    embForCluster: Float32Array,
    nWindows = 1,
  ): SpeakerMatch {
    const top = scored[0];
    const runner = scored[1];
    const score = top.score;
    const margin = runner ? top.score - runner.score : Infinity;
    const suffix = nWindows > 1 ? ` over ${nWindows} windows` : '';

    const base = {
      score,
      bestName: top.name,
      runnerUpName: runner?.name,
      runnerUpScore: runner?.score,
    };

    // Below the uncertain floor → genuinely unknown.
    if (score < this.cfg.uncertainThreshold) {
      return this.asUnknown(
        embForCluster,
        score,
        top.name,
        `closest ${top.name} ${fmt(score)} < unknown floor ${fmt(this.cfg.uncertainThreshold)}${suffix}`,
        base,
      );
    }

    // In the uncertain band, or failing the margin test against a similar
    // enrolled voice → do NOT assign the name (avoid false positives).
    if (score < this.cfg.acceptThreshold) {
      return this.asUnknown(
        embForCluster,
        score,
        top.name,
        `closest ${top.name} ${fmt(score)} below accept ${fmt(this.cfg.acceptThreshold)} (uncertain)${suffix}`,
        base,
        'uncertain',
      );
    }
    if (margin < this.cfg.margin) {
      return this.asUnknown(
        embForCluster,
        score,
        top.name,
        `${top.name} ${fmt(score)} vs ${runner?.name} ${fmt(runner?.score ?? 0)} — margin ${fmt(margin)} < ${fmt(this.cfg.margin)} (confusable)`,
        base,
        'uncertain',
      );
    }

    // Confident, unambiguous match.
    return {
      speaker: top.name,
      decision: 'known',
      reason:
        `matched ${top.name} ${fmt(score)} ≥ ${fmt(this.cfg.acceptThreshold)}${suffix}` +
        (runner ? `, margin ${fmt(margin)} over ${runner.name}` : ''),
      ...base,
    };
  }

  /** Assign an unmatched voice to an unknown cluster (or a flat unknown label). */
  private asUnknown(
    emb: Float32Array,
    score: number,
    bestName: string,
    reason: string,
    base: Partial<SpeakerMatch> = {},
    decision: SpeakerDecision = 'unknown',
  ): SpeakerMatch {
    const label = this.cfg.labelUnknownClusters
      ? this.assignUnknownCluster(emb)
      : this.cfg.unknownLabel;
    return {
      speaker: label,
      decision,
      score,
      bestName,
      reason,
      ...base,
    };
  }

  /**
   * Online single-link clustering of unknown voices: merge into the nearest
   * existing cluster if close enough (updating its running-mean centroid),
   * otherwise open a new "Guest N" cluster.
   */
  private assignUnknownCluster(emb: Float32Array): string {
    let bestIdx = -1;
    let bestSim = -Infinity;
    for (let i = 0; i < this.unknownClusters.length; i++) {
      const sim = cosineNormalized(emb, this.unknownClusters[i].centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestSim >= this.cfg.unknownClusterThreshold) {
      const c = this.unknownClusters[bestIdx];
      // Running mean of normalised vectors, then re-normalise.
      const merged = new Float32Array(c.centroid.length);
      for (let i = 0; i < merged.length; i++) {
        merged[i] = (c.centroid[i] * c.count + emb[i]) / (c.count + 1);
      }
      c.centroid = l2normalize(merged);
      c.count += 1;
      return c.label;
    }

    this.unknownCount += 1;
    const label = `Guest ${this.unknownCount}`;
    this.unknownClusters.push({ label, centroid: emb, count: 1 });
    return label;
  }
}

function maxCosine(emb: Float32Array, embeddings: Float32Array[]): number {
  let m = -Infinity;
  for (const e of embeddings) {
    const s = cosineNormalized(emb, e);
    if (s > m) m = s;
  }
  return m === -Infinity ? 0 : m;
}

/**
 * Mean of the top-`m` values — the segment's most speaker-representative
 * windows. Robust to a few low (noisy/overlap-onset) windows without being
 * fooled by a single lucky one the way a plain `max` would be.
 */
export function trimmedTopMean(values: number[], m: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  const k = Math.max(1, Math.min(m, sorted.length));
  let sum = 0;
  for (let i = 0; i < k; i++) sum += sorted[i];
  return sum / k;
}

function fmt(n: number): string {
  return n.toFixed(2);
}
