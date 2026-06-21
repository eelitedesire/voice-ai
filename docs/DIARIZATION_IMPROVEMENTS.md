# Production-Grade Real-Time Diarization — Improvement Proposal

This document analyzes the current pipeline (see `SPEECH_PIPELINE.md`) and proposes
concrete, **local-only (ONNX)** improvements for:

- (A) enrolled-speaker recognition accuracy,
- (B) speaker-change detection without silence,
- (C) a real-time online diarization architecture,
- (D) implementation details: algorithms, thresholds, pseudocode, diagrams, and
  the exact changes to `VADSegmentedTranscriber`.

Guiding constraint from the requester: **accuracy > latency**. That permits a
1–2 s analysis buffer and multiple embedding extractions per segment.

---

## 0. Root-cause analysis of the three reported problems

| Problem | Root cause in current code | Fix category |
|---|---|---|
| 1. Enrolled speaker not recognized (false "Unknown") | One embedding extracted from the **whole committed paragraph**; if the paragraph is short, noisy, or contains silence, the embedding is degraded. Single enrollment centroid. Raw cosine threshold (0.5) is not score-normalized, so it drifts with conditions. | A: multi-window embeddings, AS-norm, calibration |
| 2. Back-to-back speakers merged into one segment | Segmentation depends on **silence (0.6 s) or ASR endpoint**. A→B with no gap → no boundary → one segment. | B: speaker-change detection forces a boundary |
| 3. Speaker ID runs only **after** commit | ID is a single post-hoc step on the full segment, which may already mix two speakers → the embedding is a blend that matches neither (worsens #1). | B + C: continuous (rolling) embedding track + per-window labels |

The three problems are coupled: fixing #2/#3 (don't let two speakers share a
segment) directly improves #1 (the embedding is now from one speaker only).

---

## A. Speaker recognition accuracy

### A.1 Extract embeddings from longer windows — and several of them

**Yes to both.** ERes2Net embeddings are only stable with enough voiced audio.

- **Minimum window: ~1.5–2.0 s of voiced speech.** Below ~1 s, embeddings are
  noisy and similarity drops, causing false "Unknown". Reject ID on shorter audio
  (return `uncertain`, keep the previous label).
- **Multiple embeddings per segment** (sliding windows) instead of one over the
  whole paragraph. Aggregate per-window similarities rather than embedding one
  blended vector.

Aggregation recommendation (per enrolled speaker `k`):

```
score_k = trimmed_mean_top_m( cosine(window_i, centroid_k) for voiced windows i )
```

Use the **top-m most confident windows** (e.g. m = 3) and a trimmed mean — robust
to one bad window (noise, overlap onset) without being fooled by a single lucky
window (which `max` would be).

### A.2 Is centroid matching alone sufficient? No.

Combine three signals per enrolled speaker:

1. **Centroid cosine** — stable central tendency.
2. **Best-sample cosine** — `max_j cosine(window, embedding_kj)`; helps when the
   speaker's current condition matches one enrolled sample but not the mean.
3. **Score normalization (AS-norm)** — the single biggest accuracy lever for a
   fixed threshold (below).

Final per-speaker score: `0.6 * centroid + 0.4 * best_sample`, then AS-normalized.

### A.3 Adaptive Score Normalization (AS-norm) — calibrate against a cohort

Raw cosine drifts with microphone, loudness, and the speaker's own variability,
so a global threshold (0.5) is fragile. AS-norm rescales each score by how the
test and enrolled vectors score against an **impostor cohort**, making one
threshold valid across speakers/conditions.

```
cohort C = { all OTHER enrolled speakers' embeddings } ∪ { background impostor set }
           ∪ { session unknown-cluster centroids }

s          = combined_cosine(test_emb, speaker_k)         # raw
topE       = top_N cosines of test_emb vs C               # N ≈ 100 (or all if fewer)
topC       = top_N cosines of centroid_k vs C
s_norm     = 0.5 * ( (s - mean(topE)) / std(topE)
                   + (s - mean(topC)) / std(topC) )

decision: known if s_norm ≥ T_norm AND margin over runner-up ≥ M_norm
```

- Ship a small **background impostor set** (e.g. 50–200 ERes2Net embeddings from
  public speech, stored once in `models/`) so the cohort is well-formed even with
  1–2 enrolled speakers. Without it, use the other enrolled speakers + unknown
  clusters (weaker but still helps).
- `T_norm ≈ 0` to `0.5` is typical for AS-norm; **calibrate to EER** (below).

### A.4 Per-speaker / EER calibration

At enrollment, compute each speaker's **self-similarity distribution** (cosine of
each enrolled window vs the speaker centroid) and their **impostor distribution**
(vs cohort). Store `mean/std` per speaker. Then:

- Set the per-speaker accept threshold at the **Equal-Error-Rate** point, or a
  fixed false-accept target (e.g. FA = 1%).
- This directly fixes "enrolled speaker not recognized": a speaker whose voice is
  naturally lower-similarity gets a lower personal threshold instead of being
  rejected by a global 0.5.

Store calibration in `speaker_db.json`:

```jsonc
{
  "id": "john",
  "embeddings": [[...], [...], [...]],
  "calibration": { "selfMean": 0.71, "selfStd": 0.06, "threshold": 0.42 }
}
```

### A.5 Enrollment quality requirements

- **≥ 3 samples, ≥ 5 s each**, captured in the conditions they'll be recognized in
  (same mic/room, normal and quiet speech). The UI already supports appending
  samples; make 3 the recommended minimum (badge already does this).
- Run a **quality gate** on enrollment windows (VAD voiced-ratio > 0.7, RMS above
  floor) so silence/noise doesn't pollute the centroid.

---

## B. Speaker-change detection (no silence required)

The core upgrade: a **rolling speaker-embedding track** during active speech that
forces a segment boundary on a likely speaker change, independent of silence.

### B.1 Rolling embeddings

During `SPEAKING`, in parallel with ASR, maintain an audio ring buffer and every
`HOP` seconds extract an embedding over the last `WINDOW` seconds:

```
WINDOW = 1.5 s     # enough voiced audio for a stable embedding
HOP    = 0.5 s     # decision cadence (≈ change-detection latency)
```

### B.2 Change score with hysteresis + debounce

Maintain a **running centroid of the current segment** (`segCentroid`) and the
previous window embedding (`prevEmb`). For each new window embedding `e`:

```
sim_to_segment = cosine(e, segCentroid)     # has the voice drifted from the segment?
sim_to_prev    = cosine(e, prevEmb)         # local discontinuity?

changeScore = 1 - min(sim_to_segment, sim_to_prev)
```

A speaker change is declared with **debounce + hysteresis** to avoid flicker:

```
if sim_to_segment < CHANGE_HARD (0.40):        # strong, immediate change
    boundary = now - WINDOW/2                   # change happened ~mid-window
elif sim_to_segment < CHANGE_SOFT (0.55):       # candidate
    candidateCount += 1
    if candidateCount >= 2:                      # ~1.0 s sustained → confirm
        boundary = first candidate window start
else:
    candidateCount = 0                           # reset (same speaker)
```

Within-speaker window-to-window cosine for ERes2Net is typically **> 0.65–0.75**;
cross-speaker drops **below ~0.4–0.5**. The hard/soft thresholds (0.40 / 0.55)
sit in that gap with margin. Because **accuracy > latency**, a 2-window (~1 s)
confirmation is acceptable and greatly reduces false splits.

> Optional rigor: replace the cosine test with a **symmetric-KL / BIC-style**
> criterion over the two windows; in practice the debounced cosine test is
> simpler and works well at this granularity.

### B.3 Split the transcript at the boundary using ASR timestamps

The streaming ASR result exposes **per-token `timestamps` (seconds, relative to
the last recognizer reset)** alongside `tokens`. When a change boundary at
absolute time `t_b` is detected:

1. Map `t_b` to a token index using `timestamps` (+ the segment's absolute start).
2. **Commit the text up to that token** as Speaker-1's segment.
3. The remaining tokens belong to Speaker-2's new segment.
4. Reset the recognizer **in place** and continue (next words stream into the new
   segment). Optionally re-feed the audio from `t_b` so word boundaries are clean.

This is what prevents two speakers being merged: the boundary is created by the
**voice change**, not by silence.

### B.4 Per-window labels → segment label (temporal smoothing)

Each rolling window is labeled (enrolled match via §A, else local cluster). Smooth
labels with a **median filter / majority vote over a 3-window sliding window** so a
single noisy window doesn't flip the speaker. The committed segment's speaker =
majority label of its windows (weighted by window quality).

---

## C. Real-time online diarization architecture

### C.1 Recommended: hybrid "online tracker + periodic refinement"

```
            ┌──────────────────────── PRIMARY (real-time) ───────────────────────┐
audio ──► VAD ──► ASR (text + token timestamps)                                   │
                   └─► rolling embedding track (WINDOW=1.5s, HOP=0.5s)            │
                          ├─► enrolled match (A: multi-window + AS-norm)          │
                          ├─► speaker-change detector (B: debounced cosine)       │
                          └─► online cluster assignment (unknown voices)          │
                                  │                                                │
                  emit PROVISIONAL speaker label per window (low latency)         │
                                  │                                                │
            ┌──────────────── REFINEMENT (every ~3–5 s, accuracy) ───────────────┐
            │ run sherpa OfflineSpeakerDiarization on the recent buffer:          │
            │   pyannote segmentation ⊕ ERes2Net embeddings ⊕ FastClustering      │
            │ → corrected {start,end,speaker} boundaries for the buffer           │
            │ → reconcile with provisional labels; FINALIZE committed segments    │
            └─────────────────────────────────────────────────────────────────────┘
```

- The **primary track** gives immediate, good-enough labels and the change
  boundaries that split back-to-back speakers.
- The **refinement pass** uses sherpa's `OfflineSpeakerDiarization`
  (`node_modules/sherpa-onnx-node/non-streaming-speaker-diarization.js`) — which
  is exactly pyannote-style (local segmentation → embeddings → clustering) — on a
  short rolling buffer (e.g. the last 8–10 s) to correct boundaries and merge/split
  decisions before a segment is finalized. Since accuracy > latency, finalizing a
  segment 1–3 s after it ends is acceptable.

### C.2 Can pyannote concepts be adapted? Yes — they already are, in sherpa.

pyannote's pipeline = (1) **local segmentation** model producing per-frame
speaker-activity (handles overlap), (2) **embedding** per active region, (3)
**agglomerative clustering**. sherpa's `OfflineSpeakerDiarization` wraps a pyannote
**segmentation-3.0 ONNX** model + the ERes2Net extractor + `FastClustering`
(`{numClusters}` if known, else `{threshold}`), returning `{start, end, speaker}[]`.

To adapt it **online**: run it on a **sliding buffer** (overlapping windows, e.g.
10 s buffer advanced every 3 s) and stitch the outputs (align cluster ids across
overlapping regions by embedding similarity). This is the standard "block-online"
diarization trick. It needs the pyannote segmentation model downloaded into
`models/` (one extra ONNX).

### C.3 If you want the simplest robust win first

The **primary track alone** (rolling embeddings + change detection + §A accuracy
upgrades), **without** the pyannote refinement, already fixes problems #1–#3 and is
a small, self-contained extension of `VADSegmentedTranscriber`. Add the pyannote
refinement later for overlap handling and boundary precision.

### C.4 Latency strategy (accuracy-first)

- Provisional labels at `HOP` cadence (~0.5 s).
- Hold a segment "open" for up to `MAX_PROVISIONAL` (~1.5 s) before finalizing, so
  the change detector and (optionally) the refinement pass can correct it.
- Emit `final` with a `provisional: true` flag, then a `revise` event if the
  refinement changes the label. (UI shows the provisional label immediately, then
  settles — same pattern already used for partial→final text.)

---

## D. Implementation details

### D.1 New component: `DiarizationTracker`

A per-connection, dependency-light class (mirrors `SpeakerIdentifier`'s testable
style). It owns the rolling-embedding logic and change detection; it calls the
existing `SpeakerIdentifier` for enrolled matching.

```ts
interface DiarWindow { tStart: number; tEnd: number; emb: Float32Array; quality: number; }
interface DiarLabel  { speaker: string; decision: 'known'|'uncertain'|'unknown'; score: number; }
interface ChangeResult { changed: boolean; boundaryTime?: number; }

class DiarizationTracker {
  constructor(identifier: SpeakerIdentifier, cfg: DiarConfig) {...}

  // Called every HOP seconds with the last WINDOW seconds of voiced audio.
  pushWindow(samples: Float32Array, tStart: number, tEnd: number): {
    label: DiarLabel;
    change: ChangeResult;
  }

  // Aggregate label for the segment that just closed (majority over its windows).
  segmentLabel(): DiarLabel;

  // Start a fresh segment after a commit/boundary.
  resetSegment(): void;
}
```

### D.2 Modified `VADSegmentedTranscriber` flow

```
processWindow(win):                         # existing 512-sample VAD frame
    feed VAD; detected = vad.isDetected()
    ... existing IDLE/onset/pre-roll logic ...

    if SPEAKING:
        feed win to ASR; decode; emit partial            # unchanged
        push win into diarRingBuffer
        accumulate absolute time

        # NEW: rolling diarization at HOP cadence
        if (now - lastDiarAt) >= HOP and voicedSeconds >= WINDOW:
            wEmb = embed(lastWindow(WINDOW))             # ERes2Net on 1.5s
            { label, change } = diar.pushWindow(wEmb, t0, t1)
            lastDiarAt = now

            if change.changed:
                commitSegment(boundaryTime = change.boundaryTime)   # SPLIT by timestamp
                # start a new segment; keep streaming (no silence needed)

        # existing pause/endpoint commit still applies (whole-segment close)
        if trailingSilence >= COMMIT_SILENCE or recognizer.isEndpoint():
            commitSegment(boundaryTime = now)

commitSegment(boundaryTime):
    tokens, times = recognizer.getResult()               # token timestamps
    splitIdx = indexOfTokenAtTime(times, boundaryTime - segStartAbs)
    text     = join(tokens[0:splitIdx])                  # words before the boundary
    speaker  = diar.segmentLabel().speaker               # majority of window labels
    emit final { text, speaker, speakerInfo }
    # carry the remaining tokens/audio into the next segment
    recognizer.reset(); diar.resetSegment(); re-feed audio after boundaryTime
```

Key change vs today: **ID is computed continuously from clean 1.5 s windows of a
single speaker**, and **boundaries can be created by voice change**, not only
silence. The post-commit single-embedding ID is replaced by the aggregated
per-window labels.

### D.3 Speaker-change detection pseudocode (debounced)

```
pushWindow(emb, t0, t1):
    quality = voicedRatio(window) * normRms(window)
    if quality < Q_MIN:                      # too quiet/short → don't trust it
        return { label: lastLabel, change: {changed:false} }

    simSeg  = segCentroid ? cosine(emb, segCentroid) : 1
    simPrev = prevEmb     ? cosine(emb, prevEmb)     : 1

    changed = false; boundary = undefined
    if simSeg < CHANGE_HARD:                  # 0.40
        changed = true; boundary = t0
        candidateCount = 0
    elif simSeg < CHANGE_SOFT:                # 0.55
        candidateCount += 1
        if candidateCount >= DEBOUNCE:        # 2 windows ≈ 1.0s
            changed = true; boundary = firstCandidateStart
            candidateCount = 0
    else:
        candidateCount = 0
        segCentroid = runningMean(segCentroid, emb)   # only extend when same speaker

    label = identifier.identify(emb)          # §A multi-window handled by caller aggregation
    pushSmoothing(label)                      # median over last 3
    prevEmb = emb
    if changed: segCentroid = emb             # seed new segment
    return { label: smoothedLabel(), change: { changed, boundaryTime: boundary } }
```

### D.4 Recommended thresholds (ERes2Net, 16 kHz)

| Name | Value | Notes |
|---|---|---|
| `EMBED_WINDOW` | 1.5 s | min voiced audio per embedding (accuracy: try 2.0 s) |
| `EMBED_HOP` | 0.5 s | change-detection cadence/latency |
| `MIN_ID_SECONDS` | 1.0 s | below this → `uncertain`, keep previous label |
| `CHANGE_SOFT` | 0.55 | candidate speaker change (cosine to seg centroid) |
| `CHANGE_HARD` | 0.40 | immediate speaker change |
| `CHANGE_DEBOUNCE` | 2 windows | ≈ 1.0 s sustained to confirm a soft change |
| `LABEL_SMOOTH` | 3 windows | median filter on per-window labels |
| `SPEAKER_ACCEPT` (raw cosine) | 0.50 | keep as fallback when AS-norm unavailable |
| `T_norm` (AS-norm) | ~0.0–0.5 | calibrate to EER; replaces raw threshold |
| `SPEAKER_MARGIN` | 0.06–0.10 | best − runner-up |
| `Q_MIN` (window quality) | tune | voicedRatio·normRms gate |
| Refinement buffer | 8–10 s | for periodic pyannote pass |
| Refinement cadence | 3 s | block-online advance |

All should be env-configurable (extend `configFromEnv`), with the server already
logging `score=`/reasons for calibration.

### D.5 Phased rollout (lowest risk → highest value)

1. **Phase 1 — accuracy (A), no architecture change.** At commit, extract sliding
   1.5 s windows over the segment, aggregate top-m similarities, add `MIN_ID_SECONDS`
   gate. Fixes most false-Unknowns. Small, isolated change to `identifySpeaker`.
2. **Phase 2 — AS-norm + per-speaker calibration (A).** Add background cohort +
   store calibration at enrollment. Stabilizes the threshold.
3. **Phase 3 — rolling change detection (B).** Add `DiarizationTracker`, split
   segments on voice change using token timestamps. Fixes back-to-back speakers.
4. **Phase 4 — pyannote refinement (C).** Download segmentation model; run
   `OfflineSpeakerDiarization` block-online to correct boundaries + handle overlap.

Phases 1–3 are pure local logic on top of the current models. Phase 4 adds one ONNX
download and is where overlap handling eventually lands.

### D.6 Updated architecture diagram

```
 mic → worklet(16k,512) → WS → VADSegmentedTranscriber
                                   │
        ┌──────────────┬──────────┴───────────┬─────────────────────────┐
        ▼              ▼                      ▼                         ▼
     Silero VAD   Streaming ASR        DiarizationTracker        (Phase 4)
   speech gate   text + token TS    rolling 1.5s embeddings   pyannote refine
                                     • enrolled match (AS-norm)  on 8-10s buffer
                                     • change detect (debounced) → correct labels
                                     • per-window label smoothing
                                   │
                 commitSegment(boundary = silence | endpoint | VOICE CHANGE)
                   split tokens by timestamp → one speaker per segment
                                   │
                  final { text, speaker (majority), speakerInfo, provisional? }
```

---

## Summary of recommendations

- **A:** multi-window embeddings (1.5–2 s, top-m trimmed mean), centroid **+**
  best-sample, **AS-norm with a background cohort**, per-speaker EER calibration,
  enrollment quality gating. Centroid alone is **not** sufficient.
- **B:** rolling embeddings (1.5 s/0.5 s) + **debounced cosine change detection**
  against the running segment centroid; split the transcript at the boundary using
  **ASR token timestamps** so back-to-back speakers never share a segment.
- **C:** hybrid **online tracker + periodic block-online pyannote refinement**
  using sherpa's local `OfflineSpeakerDiarization`; provisional-then-finalize for
  low latency with accuracy-first correction.
- **D:** new `DiarizationTracker`, `commitSegment(boundaryTime)` with timestamp
  splitting, thresholds above, phased rollout (1→4). All local ONNX, no cloud.
```
