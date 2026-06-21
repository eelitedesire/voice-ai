# Voice AI — Speech Pipeline Documentation

This document describes how the real‑time speech system works: **audio capture →
transcription → segmentation → speaker enrollment → speaker recognition**. It is
written to be self‑contained so it can be handed to another assistant (e.g.
ChatGPT) as context.

The stack is a **Next.js 15** app with a custom **Node `ws` WebSocket server**
(`server.ts`). All speech models are local **ONNX** models run through
**`sherpa-onnx-node`** (no cloud ASR). Models live in `./models/`:

| Model | File | Purpose |
|---|---|---|
| Streaming ASR | `encoder/decoder/joiner.onnx` (Zipformer, English) | Speech‑to‑text |
| VAD | `silero_vad.onnx` | Voice activity detection |
| Speaker embedding | `speaker-embedding.onnx` (3D‑Speaker ERes2Net, 512‑dim) | Voiceprints |

Sample rate is **16 kHz mono, Float32 PCM** end‑to‑end.

---

## 1. High‑level architecture

```
 BROWSER (client)                          NODE SERVER
 ────────────────                          ───────────
 mic getUserMedia
   │
   ▼
 AudioWorklet (pcm-processor)
   • downsample 48k → 16k
   • emit 512‑sample (~32ms) Float32 chunks
   │  binary frames over WebSocket
   ▼
 WebSocket  ───────────────────────────►  /ws/transcribe
                                              │
                                              ▼
                                          VADSegmentedTranscriber  (one per connection)
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
              ▼                                ▼                                ▼
        Silero VAD                     Streaming ASR (Zipformer)      Speaker embedding + ID
     (speech gating +               (live partial text, never        (per committed paragraph)
      pause detection)               stops, reset in place)
              │                                │                                │
              └────────────► segmentation / commit decision ◄───────────────────┘
                                              │
                                   emits events back over WS:
                                   • partial  (live caption)
                                   • final    (committed paragraph + speaker + confidence)
                                   • vad      (speaking on/off)
                                              │
 BROWSER  ◄───────────────────────────────────┘
   • live partial bubble
   • finalized transcript line with speaker + confidence badge
```

Key design rule: **the four concerns are decoupled so none blocks another** —
speech detection (VAD), text generation (ASR), pause/boundary detection, and
speaker identification each advance independently. The ASR stream never stops.

### Main files

| File | Responsibility |
|---|---|
| `public/audio-worklet-processor.js` | Mic capture, downsample to 16 kHz, chunking |
| `lib/audio-utils.ts` | Client `StreamingAudioCapture`: mic + worklet + WebSocket |
| `server.ts` | HTTP + WebSocket server; one transcriber per connection |
| `lib/model-registry.ts` | Loads/warms shared models once at boot; loads enrolled speakers |
| `lib/streaming-transcription.ts` | `VADSegmentedTranscriber`: the core real‑time pipeline |
| `lib/speaker-identification.ts` | `SpeakerIdentifier`: strict cosine matching + diarization |
| `lib/sherpa-onnx.ts` | `SherpaONNXManager`: batch/file path + enrollment embedding extraction |
| `app/api/enroll/route.ts` | Enrollment HTTP endpoint |
| `app/api/speakers/route.ts` | List / delete enrolled speakers |
| `components/SpeakerEnrollment.tsx` | Enrollment UI |
| `components/SessionRecorder.tsx` | Start/stop session, streams audio |
| `components/LiveTranscriptChat.tsx` | Transcript + confidence badges |
| `speaker_db.json` | Persisted enrolled voiceprints |

---

## 2. Audio capture (client)

`public/audio-worklet-processor.js` runs in the browser audio thread:

1. Receives raw mic audio at the `AudioContext` rate (48 kHz).
2. **Downsamples to 16 kHz** with linear interpolation.
3. Buffers and emits fixed **512‑sample (~32 ms) Float32 chunks** to the main
   thread. 512 matches the VAD window size and keeps latency low (~31 chunks/sec).

`lib/audio-utils.ts` (`StreamingAudioCapture`) starts everything **in parallel**
to minimize "Start Session" latency: `getUserMedia`, worklet module load, and
the WebSocket handshake all run concurrently. Each 512‑sample chunk is sent as a
**binary WebSocket frame**. Control messages (`config`, `stop`) are JSON text
frames.

Mic constraints enable browser `echoCancellation`, `noiseSuppression`, and
`autoGainControl`.

---

## 3. Model registry & warm start

`lib/model-registry.ts` loads the heavy ONNX models **once at server boot**
(`warmUpModels()` called from `server.ts`), not per session. This is what makes
"Start Session" feel instant.

- `getSharedModels()` — idempotent singleton; returns `{ recognizer,
  speakerEmbedding, modelPath, sampleRate }`. The recognizer and embedding
  extractor are **stateless across streams** (per‑utterance state lives in
  per‑call streams), so they are safely shared by all connections.
- The recognizer is "warmed" with a throwaway decode at boot so ONNX Runtime
  does its lazy allocation before the first real word.
- `createVad()` mints a **fresh per‑connection VAD** (the detector is stateful,
  so it cannot be shared).
- `loadEnrolledSpeakers()` reads `speaker_db.json` **fresh per session** (cheap)
  so newly enrolled speakers take effect on the next session without a restart.

---

## 4. Transcription + segmentation (the core)

Implemented in `VADSegmentedTranscriber` (`lib/streaming-transcription.ts`). One
instance per WebSocket connection. Audio is processed in exact **512‑sample VAD
windows** (incoming chunks are re‑windowed; remainders carried over).

### 4.1 The state machine (per 512‑sample window)

```
            ┌──────────── IDLE ────────────┐
            │  feed window to VAD only      │
            │  keep it in a 300ms pre-roll  │
            │  ring buffer (NOT to the ASR) │
            └───────────────┬───────────────┘
                  VAD.isDetected() == true
                            │  (speech onset)
                            ▼
            ┌──────────── SPEAKING ─────────┐
            │  • replay pre-roll into ASR    │  ← recovers the clipped word onset
            │  • feed each window to ASR     │
            │  • decode + emit `partial`     │  ← live caption, never stops
            │  • accumulate raw samples      │  ← for speaker ID at the boundary
            │  • track trailing silence      │
            └───────────────┬───────────────┘
        trailing silence ≥ COMMIT_SILENCE_SEC (0.6s)
        OR recognizer.isEndpoint() fires
                            │  (paragraph boundary)
                            ▼
                    commitParagraph()
                            │
            reset decoder IN PLACE, clear pre-roll,
            back to IDLE — next words stream into a fresh paragraph
```

Why this matters:

- **ASR is only ever fed audio the VAD considers speech.** Pure silence, music,
  keyboard noise, and distant chatter never reach the recognizer — this is the
  core guard against "phantom" hallucinated transcriptions.
- **Pre‑roll ring buffer (~300 ms):** the VAD needs a moment to confirm speech,
  which would clip the first word; the pre‑roll replays that audio so onsets
  aren't lost.
- **Pause = paragraph boundary.** A natural pause (≥0.6 s trailing silence) or
  the ASR's own endpoint rule commits the current text as a finalized paragraph,
  then the recognizer is **reset in place** so the next words immediately stream
  into a new paragraph — no re‑transcription, no freeze.
- The pre‑roll is cleared on commit so already‑committed audio can't be replayed
  into the next paragraph.

### 4.2 Events emitted (server → client over WS)

| Event | Meaning |
|---|---|
| `ready` | Engine initialized |
| `vad` `{isSpeaking}` | Speech started/stopped (UI "Speaking" indicator) |
| `partial` `{text}` | Live, word‑by‑word caption for the current paragraph |
| `final` `{text, speaker, speakerInfo}` | Committed paragraph + speaker label + confidence |
| `error` `{message}` | Failure |

### 4.3 Hallucination / noise filtering (commit gate)

When a paragraph is about to commit, `acceptUtterance()` rejects it unless it
passes all of:

1. **Duration** — ≥ `MIN_UTTERANCE_SEC` (0.3 s); shorter is likely a click.
2. **Energy** — RMS ≥ `MIN_RMS`; quieter is likely hum/background.
3. **Acoustic confidence** — mean per‑token log‑prob (`ys_probs`) ≥
   `MIN_AVG_LOGPROB`; low‑confidence garble is dropped.
4. **Repetition** — looping output ("you you you…") is dropped.
5. **Blocklist** — known hallucination phrases (e.g. "thank you for watching").

Rejected text is logged and **not** emitted. Accuracy is prioritized over always
producing output.

> Note: language identification (rejecting non‑English speech) was prototyped and
> then **reverted**; the current build relies on the acoustic‑confidence and
> noise gates above, not a dedicated LID model.

---

## 5. Speaker enrollment

Goal: build a stable voiceprint for each known person so they can be recognized
later.

### 5.1 Flow

```
UI (SpeakerEnrollment.tsx)                 POST /api/enroll
  • enter name                              (app/api/enroll/route.ts)
  • record ~10s reading a passage   ──────►  • webm → 16k mono wav (ffmpeg)
                                             • SherpaONNXManager.enrollSpeaker()
                                             • save speaker_db.json
```

### 5.2 Multi‑embedding extraction (key quality improvement)

`SherpaONNXManager.extractEnrollmentEmbeddings()` (`lib/sherpa-onnx.ts`) does
**not** store a single voiceprint. It slides a window over the enrollment audio:

- **3 s analysis windows, 1.5 s hop (50% overlap)**, plus the final tail window.
- Each window → one 512‑dim embedding via the ERes2Net extractor.
- Result: **multiple embeddings per recording**, capturing intra‑speaker
  variation (pitch, pacing, mic position).

`enrollSpeaker()` then:

- **Appends** the new embeddings to the speaker if the name already exists
  (re‑recording the same name adds samples for different conditions — it does
  **not** overwrite), or creates a new profile.
- Mirrors the first embedding into the legacy `voiceprint` field for backward
  compatibility.

The UI shows an `N×` badge per speaker (green at ≥3 samples) and encourages
re‑recording for more conditions.

### 5.3 Stored format — `speaker_db.json`

```jsonc
{
  "speakers": [
    {
      "id": "john",              // slug of the name
      "name": "John",
      "role": "John",            // legacy alias of name
      "voiceprint": [/* 512 floats */],   // legacy single embedding (mirror of embeddings[0])
      "embeddings": [             // NEW: multiple 512-dim samples
        [/* 512 floats */],
        [/* 512 floats */]
      ]
    }
  ],
  "modelVersion": "1.0.0",
  "createdAt": 1700000000000
}
```

Both the legacy `voiceprint` and the new `embeddings` arrays are supported on
read.

---

## 6. Speaker recognition (identification)

The decision layer is `SpeakerIdentifier` (`lib/speaker-identification.ts`). It
is **dependency‑free** (no ONNX/IO) so the matching math is unit‑tested in
isolation (`__tests__/speaker-identification.test.ts`, 14 tests).

### 6.1 When it runs

In the live path, when a paragraph commits, the transcriber:

1. Extracts a **512‑dim embedding** from the accumulated speech samples using the
   shared `speaker-embedding.onnx` extractor.
2. Calls `SpeakerIdentifier.identify(embedding)`.
3. Attaches the result to the `final` event as `speakerInfo`.

A new `SpeakerIdentifier` is built per session from the enrolled DB, so
unknown‑voice clustering state is per‑session.

### 6.2 The matching algorithm

All vectors are **L2‑normalized**, so cosine similarity = dot product, range
`[-1, 1]`.

1. Each enrolled speaker is represented by a **centroid** = re‑normalized mean of
   their enrolled embeddings (stable; robust to one noisy sample).
2. The query embedding is scored (cosine) against every speaker's centroid.
3. Speakers are sorted; `best` and `runner‑up` are taken.
4. **Three‑way decision:**

```
 score < UNCERTAIN (0.38)                      → UNKNOWN   (genuinely no match)
 UNCERTAIN ≤ score < ACCEPT (0.50)             → UNCERTAIN (closest shown as a hint, NOT assigned)
 score ≥ ACCEPT  AND  (best − runnerUp) < MARGIN (0.06) → UNCERTAIN (confusable; refuse to guess)
 score ≥ ACCEPT  AND  margin ≥ MARGIN          → KNOWN     (assign the enrolled name)
```

5. **Label:**
   - `known` → the enrolled speaker's name.
   - `uncertain` / `unknown` → **"Unknown Speaker"** (default). Optionally,
     distinct unknown voices can be clustered online into "Guest 1/2/…" by
     enabling `SPEAKER_LABEL_UNKNOWN_CLUSTERS=true`.

This is the fix for the original critical bug: the old code used `threshold:-1`
(cosine ≥ −1 is always true), so **every** voice was force‑matched to the nearest
enrolled name. Now an enrolled name is assigned **only** above a strict threshold
with a winning margin.

### 6.3 Result attached to each transcript line (`SpeakerMatchInfo`)

```ts
{
  decision: 'known' | 'uncertain' | 'unknown',
  score: number,        // cosine to the closest enrolled speaker (-1..1)
  bestName: string,     // closest enrolled name (even if rejected)
  runnerUpName?: string,
  runnerUpScore?: number,
  reason: string        // human-readable explanation
}
```

The UI (`LiveTranscriptChat.tsx`) renders a colored badge per line — green
(known) / amber (uncertain) / gray (unknown) — showing the score percentage,
with the full `reason` (closest match, runner‑up, margin) on hover. The server
also logs `score=` and the reason on every commit, which is how you **calibrate
the thresholds** from real same‑speaker vs different‑speaker values.

### 6.4 Online diarization of unknowns (optional)

When `labelUnknownClusters` is enabled, unmatched voices are clustered with
single‑link online clustering: a new unknown embedding merges into the nearest
existing cluster if cosine ≥ `SPEAKER_UNKNOWN_CLUSTER_THRESHOLD` (updating its
running‑mean centroid), otherwise it opens a new "Guest N". This separates
distinct unknown speakers within one session. **Overlapping/simultaneous speech
is intentionally not handled yet** — the pipeline assumes one speaker at a time.

### 6.5 Batch / file path

`POST /api/transcribe` (file upload) uses `SherpaONNXManager` with offline VAD
segmentation, then identifies each window with the **same strict
`SpeakerIdentifier`** (clustering disabled, so unmatched → "Unknown"). The old
loose `0.1` "best guess" fallback was removed.

---

## 7. Configuration (environment variables)

All optional; defaults are built in. Documented in `.env.local.template`.

### Segmentation / latency
| Var | Default | Meaning |
|---|---|---|
| `COMMIT_SILENCE_SEC` | 0.6 | Trailing silence (s) that commits a paragraph |
| `PREROLL_MS` | 300 | Audio replayed before VAD onset (anti‑clip) |
| `ASR_RULE1/2/3_*` | 1.2 / 0.6 / 20 | ASR endpoint rules |

### VAD
| Var | Default | Meaning |
|---|---|---|
| `VAD_THRESHOLD` | 0.5 | Silero speech probability threshold |
| `VAD_MIN_SILENCE` | 0.1 | Min silence to end a segment (s) |
| `VAD_MIN_SPEECH` | 0.25 | Min speech to start a segment (s) |

### Hallucination / noise
| Var | Default | Meaning |
|---|---|---|
| `MIN_UTTERANCE_SEC` | 0.3 | Drop shorter utterances |
| `MIN_RMS` | 0.006 | Drop quieter (noise) utterances |
| `MIN_AVG_LOGPROB` | -2.5 | Drop low‑confidence decodes |
| `HALLUCINATION_BLOCKLIST` | (list) | Always‑rejected phrases |

### Speaker identification
| Var | Default | Meaning |
|---|---|---|
| `SPEAKER_ACCEPT_THRESHOLD` | 0.50 | Cosine to assign an enrolled speaker (higher = stricter) |
| `SPEAKER_UNCERTAIN_THRESHOLD` | 0.38 | Below this = fully unknown |
| `SPEAKER_MARGIN` | 0.06 | Best must beat runner‑up by this |
| `SPEAKER_UNKNOWN_CLUSTER_THRESHOLD` | 0.50 | Merge unknowns into a cluster |
| `SPEAKER_LABEL_UNKNOWN_CLUSTERS` | false | true → "Guest 1/2/…"; false → "Unknown Speaker" |
| `SPEAKER_UNKNOWN_LABEL` | "Unknown Speaker" | Flat unknown label |

**Calibration tip:** different‑speaker cosine measured ~0.13–0.22 on this model;
same‑speaker typically ~0.4–0.8. The 0.50 accept / 0.38 floor gives clean
separation. Watch the server `score=` logs and adjust if real speakers read as
uncertain (lower accept) or unknowns get names (raise accept).

---

## 8. End‑to‑end example

Speaker (enrolled as "John") says: *"Hello, I want to discuss our project."*
(pause) *"And the improvements we need."*

```
worklet → 512-sample chunks → WS
VAD detects speech → onset → replay pre-roll → ASR streams partials:
   "hello"  → "hello i want"  → "hello i want to discuss our project"   (partial events)
0.6s pause → commit:
   acceptUtterance() passes (duration/energy/confidence/repetition/blocklist)
   extract embedding → SpeakerIdentifier.identify() → score 0.63 ≥ 0.50, margin ok → KNOWN "John"
   → final { text: "Hello, I want to discuss our project.", speaker: "John",
             speakerInfo: { decision:'known', score:0.63, reason:"matched John 0.63 ≥ 0.50..." } }
ASR reset in place; speech continues → new paragraph:
   → final { text: "And the improvements we need.", speaker:"John", ... }
```

An unenrolled person speaking instead would score ~0.15 < 0.38 → `unknown` →
labeled **"Unknown Speaker"**, never "John".

---

## 9. Current limitations / not yet implemented

- **No overlapping‑speech handling** — assumes one speaker at a time. (Planned
  next: overlap detection + multi‑speaker separation.)
- **English‑only ASR** (Zipformer English model). No language identification in
  the current build.
- **Speaker embedding model is 3D‑Speaker ERes2Net (Chinese‑trained)** — works
  cross‑lingually and separates speakers well; could be swapped for a different
  model (requires re‑download + re‑enrollment).
- Thresholds are heuristic defaults; best results come from enrolling **3+
  samples per speaker** and calibrating thresholds from the logged scores.
```
