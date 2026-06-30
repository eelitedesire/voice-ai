import * as sherpa from 'sherpa-onnx-node';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { SharedModels, getSharedModels, createVad, loadEnrolledSpeakers } from './model-registry';
import {
  SpeakerIdentifier,
  configFromEnv,
  l2normalize,
  cosineNormalized,
} from './speaker-identification';
import { SpeakerTracker, UNKNOWN_SPEAKER } from './domain/speaker-tracker';
import { loadAsNormContext, buildTrackerConfig } from './asnorm-context';
import type { AsNormContext } from './speaker-identification';
import { SpeakerMatchInfo } from './domain/entities';

export interface StreamingEvent {
  type: 'partial' | 'final' | 'vad' | 'ready' | 'error';
  text?: string;
  speaker?: string;
  speakerInfo?: SpeakerMatchInfo;
  isSpeaking?: boolean;
  timestamp?: number;
  message?: string;
}

/**
 * Streaming transcription engine that processes audio in real-time.
 *
 * Pipeline:
 *   PCM chunks → VAD (speech detection) → OnlineRecognizer (streaming ASR)
 *                                        → Speaker ID (on segment boundaries)
 *
 * Emits events:
 *   'partial'  – interim transcription while user is speaking
 *   'final'    – completed utterance with speaker label
 *   'vad'      – speech activity status change
 *   'ready'    – engine initialized
 *   'error'    – something went wrong
 */
export class StreamingTranscriber extends EventEmitter {
  private recognizer: any = null;
  private asrStream: any = null;
  private vad: any = null;
  private speakerEmbedding: any = null;
  private speakerManager: any = null;

  private modelPath: string;
  private sampleRate = 16000;
  private initialized = false;

  // VAD state
  private isSpeaking = false;

  // Accumulate speech audio for speaker ID
  private speechSamplesBuffer: number[] = [];
  private lastPartialText = '';

  // Decode throttle: avoid calling decode too frequently
  private pendingSamples = 0;
  private readonly DECODE_EVERY_N_SAMPLES = 1600; // decode every 100ms of audio

  constructor(modelPath?: string) {
    super();
    this.modelPath = modelPath || path.join(process.cwd(), 'models');
  }

  async initialize(): Promise<void> {
    try {
      // Initialize ASR (OnlineRecognizer - streaming)
      const asrConfig = {
        featConfig: {
          sampleRate: this.sampleRate,
          featureDim: 80,
        },
        modelConfig: {
          transducer: {
            encoder: path.join(this.modelPath, 'encoder.onnx'),
            decoder: path.join(this.modelPath, 'decoder.onnx'),
            joiner: path.join(this.modelPath, 'joiner.onnx'),
          },
          tokens: path.join(this.modelPath, 'tokens.txt'),
          numThreads: 2,
          provider: 'cpu',
          debug: 0,
        },
        enableEndpoint: true,
        rule1MinTrailingSilence: 2.4,
        rule2MinTrailingSilence: 1.2,
        rule3MinUtteranceLength: 20,
      };

      this.recognizer = new sherpa.OnlineRecognizer(asrConfig);

      // Initialize VAD
      const vadConfig = {
        sileroVad: {
          model: path.join(this.modelPath, 'silero_vad.onnx'),
          minSilenceDuration: 0.25,
          minSpeechDuration: 0.25,
          threshold: 0.4,
          windowSize: 512,
        },
        sampleRate: this.sampleRate,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      };

      this.vad = new sherpa.Vad(vadConfig, 60);

      // Initialize speaker embedding
      const speakerConfig = {
        model: path.join(this.modelPath, 'speaker-embedding.onnx'),
        numThreads: 1,
        debug: 0,
        provider: 'cpu',
      };

      this.speakerEmbedding = new sherpa.SpeakerEmbeddingExtractor(speakerConfig);
      this.speakerManager = new sherpa.SpeakerEmbeddingManager(this.speakerEmbedding.dim);

      // Load speaker database
      await this.loadSpeakers();

      // Create initial ASR stream
      this.asrStream = this.recognizer.createStream();

      this.initialized = true;
      this.emit('event', { type: 'ready' } as StreamingEvent);
      console.log('[StreamingTranscriber] Initialized successfully');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[StreamingTranscriber] Init failed:', msg);
      this.emit('event', { type: 'error', message: msg } as StreamingEvent);
      throw error;
    }
  }

  private async loadSpeakers(): Promise<void> {
    const dbPath = path.join(process.cwd(), 'speaker_db.json');
    if (!fs.existsSync(dbPath)) {
      console.log('[StreamingTranscriber] No speaker database found');
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      for (const speaker of data.speakers) {
        const voiceprint = new Float32Array(speaker.voiceprint);
        const name = speaker.name || speaker.role;
        this.speakerManager.addMulti({ name, v: [voiceprint] });
        console.log(`[StreamingTranscriber] Loaded speaker: ${name}`);
      }
      console.log(`[StreamingTranscriber] ${this.speakerManager.getNumSpeakers()} speakers loaded`);
    } catch (e) {
      console.warn('[StreamingTranscriber] Failed to load speakers:', e);
    }
  }

  /**
   * Process incoming PCM audio chunk (Float32Array, 16kHz mono).
   * This is the main entry point called for each audio chunk from WebSocket.
   */
  processAudio(samples: Float32Array): void {
    if (!this.initialized) return;

    // Feed VAD
    this.processVAD(samples);

    // Feed ASR if speaking
    if (this.isSpeaking) {
      // Accumulate samples for speaker ID
      for (let i = 0; i < samples.length; i++) {
        this.speechSamplesBuffer.push(samples[i]);
      }

      // Feed to ASR stream
      this.asrStream.acceptWaveform({ samples, sampleRate: this.sampleRate });
      this.pendingSamples += samples.length;

      // Decode periodically
      if (this.pendingSamples >= this.DECODE_EVERY_N_SAMPLES) {
        this.pendingSamples = 0;
        while (this.recognizer.isReady(this.asrStream)) {
          this.recognizer.decode(this.asrStream);
        }

        // Get partial result
        const result = this.recognizer.getResult(this.asrStream);
        const text = (result.text || '').trim();
        if (text && text !== this.lastPartialText) {
          this.lastPartialText = text;
          this.emit('event', {
            type: 'partial',
            text,
            timestamp: Date.now(),
          } as StreamingEvent);
        }
      }
    }
  }

  /**
   * Process audio through VAD to detect speech boundaries.
   * When speech ends, finalize the utterance and identify speaker.
   */
  private processVAD(samples: Float32Array): void {
    const windowSize = 512;

    for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
      const chunk = samples.subarray(i, i + windowSize);
      this.vad.acceptWaveform(chunk);

      // Check for completed speech segments
      while (!this.vad.isEmpty()) {
        const segment = this.vad.front();
        this.vad.pop();

        // A segment completed means speech ended
        if (this.isSpeaking) {
          this.onSpeechEnd();
        }
      }
    }

    // Check if VAD is currently detecting speech
    // We infer speaking state from whether we're accumulating audio
    // and no segment has been popped recently
    const wasSpeaking = this.isSpeaking;

    // Heuristic: if we have accumulated speech samples and no segment was
    // just popped, we're likely in speech. The VAD pops segments when speech
    // ends, so if nothing was popped and we're feeding audio, speech may be
    // ongoing. We use the VAD's internal state indirectly.
    //
    // Simpler approach: use the accumulated buffer size as a proxy.
    // If we've been collecting samples, we're speaking.
    // When a segment is popped, we finalize.
    //
    // Actually, the best approach: always feed to ASR. Use VAD segments
    // to determine when to finalize + do speaker ID.
    if (!this.isSpeaking && this.speechSamplesBuffer.length === 0) {
      // Start speaking detection based on VAD signal
      // We'll set isSpeaking = true once we start accumulating
    }
  }

  /**
   * Called when VAD detects end of a speech segment.
   * Finalizes the ASR result and identifies the speaker.
   */
  private onSpeechEnd(): void {
    // Flush remaining decoding
    while (this.recognizer.isReady(this.asrStream)) {
      this.recognizer.decode(this.asrStream);
    }

    const result = this.recognizer.getResult(this.asrStream);
    const text = (result.text || '').trim();

    // Identify speaker from accumulated speech
    let speaker = '';
    if (this.speechSamplesBuffer.length >= this.sampleRate * 0.5) {
      speaker = this.identifySpeakerSync(new Float32Array(this.speechSamplesBuffer));
    }

    if (text) {
      this.emit('event', {
        type: 'final',
        text,
        speaker,
        timestamp: Date.now(),
      } as StreamingEvent);
    }

    // Reset for next utterance
    this.resetStream();

    this.emit('event', {
      type: 'vad',
      isSpeaking: false,
      timestamp: Date.now(),
    } as StreamingEvent);
  }

  /**
   * Identify speaker from audio samples synchronously.
   */
  private identifySpeakerSync(samples: Float32Array): string {
    if (!this.speakerEmbedding || this.speakerManager.getNumSpeakers() === 0) {
      return '';
    }

    try {
      const stream = this.speakerEmbedding.createStream();
      stream.acceptWaveform({ sampleRate: this.sampleRate, samples });
      stream.inputFinished();

      if (!this.speakerEmbedding.isReady(stream)) return '';

      const embedding = this.speakerEmbedding.compute(stream);
      if (!embedding || embedding.length === 0) return '';

      // Always pick the closest enrolled speaker (threshold -1 accepts any cosine similarity)
      const name = this.speakerManager.search({
        v: new Float32Array(embedding),
        threshold: -1,
      });

      return name || '';
    } catch {
      return '';
    }
  }

  /**
   * Reset ASR stream for next utterance.
   */
  private resetStream(): void {
    this.asrStream = this.recognizer.createStream();
    this.speechSamplesBuffer = [];
    this.lastPartialText = '';
    this.pendingSamples = 0;
    this.isSpeaking = false;
  }

  /**
   * Signal that audio input has ended.
   * Finalizes any in-progress transcription.
   */
  finalize(): void {
    if (!this.initialized) return;

    if (this.speechSamplesBuffer.length > 0) {
      // Feed remaining silence to trigger VAD flush
      const silence = new Float32Array(this.sampleRate * 0.5);
      this.asrStream.acceptWaveform({ samples: silence, sampleRate: this.sampleRate });

      // Flush VAD
      this.vad.flush();
      while (!this.vad.isEmpty()) {
        this.vad.pop();
      }

      // Get final result
      this.asrStream.inputFinished();
      while (this.recognizer.isReady(this.asrStream)) {
        this.recognizer.decode(this.asrStream);
      }

      const result = this.recognizer.getResult(this.asrStream);
      const text = (result.text || '').trim();

      if (text) {
        let speaker = '';
        if (this.speechSamplesBuffer.length >= this.sampleRate * 0.5) {
          speaker = this.identifySpeakerSync(new Float32Array(this.speechSamplesBuffer));
        }

        this.emit('event', {
          type: 'final',
          text,
          speaker,
          timestamp: Date.now(),
        } as StreamingEvent);
      }
    }

    this.resetStream();
  }

  cleanup(): void {
    this.asrStream = null;
    this.recognizer = null;
    this.vad = null;
    this.speakerEmbedding = null;
    this.speakerManager = null;
    this.initialized = false;
    this.removeAllListeners();
  }
}

// ---------------------------------------------------------------------------
// VAD-gated streaming transcriber
// ---------------------------------------------------------------------------

interface TranscriberConfig {
  sampleRate: number;
  /** Audio (ms) prepended from before VAD fired, so word onsets aren't clipped. */
  prerollMs: number;
  /** Reject utterances shorter than this (s) — likely a click/noise blip. */
  minUtteranceSec: number;
  /** Reject utterances whose RMS energy is below this — likely noise/hum. */
  minRms: number;
  /** Reject utterances whose mean per-token acoustic log-prob is below this. */
  minAvgLogProb: number;
  /** Lower-cased phrases that are always rejected (known hallucinations). */
  blocklist: string[];
  /** Online speaker-change detection (diarization) parameters. */
  diar: DiarConfig;
}

interface DiarConfig {
  /**
   * Live (mid-speech) speaker-change detection. OFF by default: when on, a full
   * speaker-embedding ONNX inference runs every `hopSec` *inside* the audio hot
   * path, blocking the event loop so the recognizer falls behind and VAD
   * mis-segments — which itself drops words at segment starts. Enable only after
   * confirming ASR latency (RTF) is comfortably below 1. Env: LIVE_DIARIZATION.
   */
  enabled: boolean;
  /** Rolling embedding window (s) — needs enough voiced audio to be stable. */
  windowSec: number;
  /** How often (s of new audio) to extract a rolling embedding / re-check. */
  hopSec: number;
  /** Cosine to the segment centroid below which a change is declared instantly. */
  changeHard: number;
  /** Cosine below which a change is a *candidate*, confirmed after `debounce`. */
  changeSoft: number;
  /** Consecutive candidate windows required to confirm a soft change. */
  debounce: number;
  /** Don't run change detection until the segment has this much voiced audio (s). */
  minSegmentSec: number;
}

function readConfig(sampleRate: number): TranscriberConfig {
  const num = (v: string | undefined, d: number) => {
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const blocklist = (process.env.HALLUCINATION_BLOCKLIST ??
    'thank you for watching,thanks for watching,please subscribe,thank you for listening')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    sampleRate,
    // Pre-roll must cover the VAD's own detection latency (minSpeechDuration
    // 0.25s + the threshold ramp on soft onsets ≈ 250-350ms) or the first
    // word(s) of every segment are clipped. 300ms left almost no margin; 500ms
    // gives ~250ms of headroom so onsets after a pause aren't swallowed.
    prerollMs: num(process.env.PREROLL_MS, 500),
    minUtteranceSec: num(process.env.MIN_UTTERANCE_SEC, 0.3),
    minRms: num(process.env.MIN_RMS, 0.006),
    minAvgLogProb: num(process.env.MIN_AVG_LOGPROB, -2.5),
    blocklist,
    diar: {
      enabled: /^(1|true|yes|on)$/i.test(process.env.LIVE_DIARIZATION ?? ''),
      windowSec: num(process.env.DIAR_WINDOW_SEC, 1.5),
      hopSec: num(process.env.DIAR_HOP_SEC, 0.5),
      changeHard: num(process.env.DIAR_CHANGE_HARD, 0.4),
      changeSoft: num(process.env.DIAR_CHANGE_SOFT, 0.55),
      debounce: num(process.env.DIAR_DEBOUNCE, 2),
      minSegmentSec: num(process.env.DIAR_MIN_SEGMENT_SEC, 1.5),
    },
  };
}

/**
 * Real-time transcriber built like a professional live-captioning pipeline.
 *
 * The four concerns are decoupled so none of them can stall another:
 *
 *   audio ─┬─► VAD (speech detection)          ── gates the ASR
 *          └─► ring buffer (pre-roll)          ── recovers clipped onsets
 *                       │ (speech only)
 *                       ▼
 *               streaming ASR  ── emits live `partial`s every chunk, never stops
 *                       │
 *      VAD emits a completed segment  (or a speaker change, if diarization on)
 *                       ▼
 *           hallucination filters ── energy / duration / confidence / repetition
 *                       ▼
 *               commit `final` paragraph + speaker ID, reset in place
 *
 * Crucially the ASR is only ever fed audio the VAD considers speech. Pure
 * noise, silence, far-off chatter and music never reach the recognizer, which
 * is what prevents "phantom" transcriptions ("thank you for watching…") from
 * appearing out of background sound.
 */
export class VADSegmentedTranscriber extends EventEmitter {
  private recognizer: any = null;
  private speakerEmbedding: any = null;
  private speakerId: SpeakerIdentifier | null = null;
  private vad: any = null;

  // Temporal identity tracker (stabilises the label across segments) + the
  // map from enrolled speaker id → display name, and the active AS-Norm context.
  private tracker: SpeakerTracker | null = null;
  private enrolledById = new Map<string, string>();
  private asnorm: AsNormContext | null = null;

  private readonly injectedModels?: SharedModels;
  private modelPath: string;
  private sampleRate = 16000;
  private initialized = false;
  private cfg: TranscriberConfig;

  // Streaming ASR state (the stream itself NEVER stops; we reset it in place).
  private asrStream: any = null;
  private ongoingSamples: number[] = []; // speech audio of current paragraph (speaker ID)
  private lastPartialText = '';

  // VAD state machine.
  private readonly VAD_WINDOW = 512;
  private leftover: Float32Array = new Float32Array(0); // sub-window remainder
  private isSpeechActive = false;

  // Pre-roll ring buffer of recent audio (prior windows), to recover the word
  // onset that the VAD's min-speech-duration would otherwise swallow.
  private preroll: number[] = [];
  private prerollCap = 0;

  // ── Online diarization / speaker-change state (per current segment) ──
  // Rolling speaker embeddings sampled every `hopSec` over the last `windowSec`
  // of voiced audio. Used both for (a) multi-window speaker ID at commit and
  // (b) detecting a speaker change mid-speech (no silence required).
  private segEmbeddings: Float32Array[] = []; // embeddings belonging to the CURRENT speaker
  private segCentroid: Float32Array | null = null; // running mean of segEmbeddings (change ref)
  private segCentroidCount = 0;
  private lastDiarSample = 0;          // ongoingSamples length at last embedding extraction
  private changeCandidates = 0;        // consecutive soft-change windows
  private candidateStartSample = 0;    // ongoingSamples length when the streak began
  private pendingChangeEmbeddings: Float32Array[] = []; // candidate windows (belong to the NEW speaker)
  private diarWindowSamples = 0;
  private diarHopSamples = 0;
  private diarMinSegmentSamples = 0;

  constructor(opts?: { models?: SharedModels; modelPath?: string }) {
    super();
    this.injectedModels = opts?.models;
    this.modelPath =
      opts?.modelPath || opts?.models?.modelPath || path.join(process.cwd(), 'models');
    this.cfg = readConfig(this.sampleRate);
  }

  async initialize(): Promise<void> {
    try {
      // Use shared, pre-warmed models when available (near-zero startup), else
      // fall back to loading our own (e.g. in tests or standalone usage).
      const models = this.injectedModels ?? (await getSharedModels());
      this.recognizer = models.recognizer;
      this.speakerEmbedding = models.speakerEmbedding;
      this.sampleRate = models.sampleRate;
      this.modelPath = models.modelPath;
      this.cfg = readConfig(this.sampleRate);

      // Build the speaker identifier fresh from the enrolment DB so newly
      // enrolled speakers are picked up on the next session. Unknown-voice
      // clustering state lives in this per-connection instance.
      const enrolled = loadEnrolledSpeakers();
      const idCfg = configFromEnv();
      // Load AS-Norm context (cohort + calibration); null ⇒ degraded mode (logged).
      this.asnorm = loadAsNormContext(this.modelPath);
      this.speakerId = new SpeakerIdentifier(enrolled, idCfg, this.asnorm);
      this.enrolledById = new Map(enrolled.map((s) => [s.id, s.name]));
      // One sticky tracker per connection, clocked at segment-commit granularity.
      this.tracker = new SpeakerTracker(
        buildTrackerConfig(this.asnorm, idCfg.acceptThreshold, idCfg.margin),
      );
      console.log(
        `[VADSegmentedTranscriber] ${enrolled.length} enrolled speaker(s) loaded; ` +
          `${this.asnorm ? 'AS-Norm' : 'degraded'} mode`,
      );

      this.prerollCap = Math.round((this.cfg.prerollMs / 1000) * this.sampleRate);
      this.diarWindowSamples = Math.round(this.cfg.diar.windowSec * this.sampleRate);
      this.diarHopSamples = Math.round(this.cfg.diar.hopSec * this.sampleRate);
      this.diarMinSegmentSamples = Math.round(this.cfg.diar.minSegmentSec * this.sampleRate);

      // Per-connection VAD (stateful — cannot be shared).
      this.vad = createVad();

      // Per-connection ASR stream.
      this.asrStream = this.recognizer.createStream();

      this.initialized = true;
      this.emit('event', { type: 'ready' } as StreamingEvent);
      console.log('[VADSegmentedTranscriber] Ready');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[VADSegmentedTranscriber] Init failed:', msg);
      this.emit('event', { type: 'error', message: msg } as StreamingEvent);
      throw error;
    }
  }

  /**
   * Main entry point — called for every PCM chunk from the WebSocket.
   * Processes the audio in fixed VAD windows so speech detection, ASR feeding
   * and pause detection all advance together without ever blocking.
   */
  processAudio(samples: Float32Array): void {
    if (!this.initialized) return;

    // Re-window the incoming chunk into exact VAD_WINDOW frames, carrying any
    // remainder over to the next call (chunks from the client need not align).
    let buf: Float32Array;
    if (this.leftover.length > 0) {
      buf = new Float32Array(this.leftover.length + samples.length);
      buf.set(this.leftover, 0);
      buf.set(samples, this.leftover.length);
    } else {
      buf = samples;
    }

    let i = 0;
    for (; i + this.VAD_WINDOW <= buf.length; i += this.VAD_WINDOW) {
      this.processWindow(buf.subarray(i, i + this.VAD_WINDOW));
    }
    this.leftover = buf.subarray(i).slice();
  }

  /** Process exactly one VAD_WINDOW-sized frame. */
  private processWindow(win: Float32Array): void {
    this.vad.acceptWaveform(win);
    const detected = this.vad.isDetected();

    if (!this.isSpeechActive) {
      if (detected) {
        // Speech onset: open a paragraph, replay the pre-roll so the first
        // word isn't clipped, then fall through to feed this window too.
        this.isSpeechActive = true;
        if (this.preroll.length > 0) {
          const pre = new Float32Array(this.preroll);
          this.asrStream.acceptWaveform({ samples: pre, sampleRate: this.sampleRate });
          for (let k = 0; k < pre.length; k++) this.ongoingSamples.push(pre[k]);
        }
        this.emit('event', { type: 'vad', isSpeaking: true, timestamp: Date.now() } as StreamingEvent);
      } else {
        // Idle: keep the audio only in the pre-roll ring buffer; never feed
        // silence/noise to the ASR (this is the core hallucination guard).
        // Drain any stray VAD segment so its boundary can't leak into the
        // next paragraph (nothing is being decoded while idle).
        if (!this.vad.isEmpty()) this.vad.pop();
        this.pushPreroll(win);
        return;
      }
    }

    // --- Speaking ---
    this.asrStream.acceptWaveform({ samples: win, sampleRate: this.sampleRate });
    for (let k = 0; k < win.length; k++) this.ongoingSamples.push(win[k]);

    while (this.recognizer.isReady(this.asrStream)) {
      this.recognizer.decode(this.asrStream);
    }

    const text = (this.recognizer.getResult(this.asrStream).text || '').trim();
    if (text && text !== this.lastPartialText) {
      this.lastPartialText = text;
      this.emit('event', { type: 'partial', text, timestamp: Date.now() } as StreamingEvent);
    }

    // Online speaker-change detection: every `hopSec` of new voiced audio,
    // sample a rolling embedding and check whether the voice has diverged from
    // the current segment. If so, commit the segment AT the change boundary so
    // back-to-back speakers never share a segment — no silence required.
    if (this.cfg.diar.enabled && detected && this.maybeDetectSpeakerChange()) {
      this.pushPreroll(win);
      return; // segment was split; a fresh one is already streaming
    }

    // Paragraph boundary: the VAD has emitted a completed speech segment (its
    // own endpoint, governed by VAD_MIN_SILENCE) — equivalent to the original
    // vad.front()/pop() segmentation. This, plus a detected speaker change
    // handled above, are the ONLY paragraph boundaries. A trailing-silence
    // timer and the ASR endpoint/punctuation no longer commit paragraphs.
    if (!this.vad.isEmpty()) {
      this.vad.pop();
      this.commitSegment({ reason: 'pause' });
    }

    this.pushPreroll(win);
  }

  /**
   * Sample a rolling speaker embedding (over the last `windowSec` of audio) at
   * `hopSec` cadence, accumulate it for multi-window speaker ID, and test it
   * against the current segment's centroid for a speaker change.
   *
   * Returns true if a change was confirmed and the segment was split here.
   */
  private maybeDetectSpeakerChange(): boolean {
    const n = this.ongoingSamples.length;
    if (n < this.diarWindowSamples) return false;            // not enough audio yet
    if (n - this.lastDiarSample < this.diarHopSamples) return false; // hop not elapsed
    this.lastDiarSample = n;

    const window = new Float32Array(this.ongoingSamples.slice(n - this.diarWindowSamples, n));
    const emb = this.embed(window);
    if (!emb) return false;

    // Seed the segment centroid with the first window.
    if (!this.segCentroid) {
      this.segCentroid = emb;
      this.segCentroidCount = 1;
      this.segEmbeddings.push(emb);
      return false;
    }

    // Don't judge changes until the segment has some committed audio.
    if (n < this.diarMinSegmentSamples) {
      this.extendSegment(emb);
      return false;
    }

    const simSeg = cosineNormalized(emb, this.segCentroid);

    if (simSeg < this.cfg.diar.changeHard) {
      // Strong, immediate divergence → the new speaker owns ~the last window.
      return this.commitSegment({
        reason: 'speaker-change',
        boundarySample: Math.max(0, n - Math.floor(this.diarWindowSamples / 2)),
        newSpeakerEmbeddings: [emb],
      });
    }

    if (simSeg < this.cfg.diar.changeSoft) {
      // Candidate change — confirm only if sustained (debounce), to avoid
      // splitting on a single noisy window.
      if (this.changeCandidates === 0) {
        this.candidateStartSample = Math.max(0, n - this.diarWindowSamples);
      }
      this.changeCandidates += 1;
      this.pendingChangeEmbeddings.push(emb);

      if (this.changeCandidates >= this.cfg.diar.debounce) {
        return this.commitSegment({
          reason: 'speaker-change',
          boundarySample: this.candidateStartSample,
          newSpeakerEmbeddings: this.pendingChangeEmbeddings.slice(),
        });
      }
      return false;
    }

    // Same speaker — extend the segment and drop any pending candidate streak.
    this.extendSegment(emb);
    this.changeCandidates = 0;
    this.pendingChangeEmbeddings = [];
    return false;
  }

  /** Add a window embedding to the current speaker's running centroid. */
  private extendSegment(emb: Float32Array): void {
    this.segEmbeddings.push(emb);
    if (!this.segCentroid) {
      this.segCentroid = emb;
      this.segCentroidCount = 1;
      return;
    }
    const c = this.segCentroid;
    const merged = new Float32Array(c.length);
    for (let i = 0; i < merged.length; i++) {
      merged[i] = (c[i] * this.segCentroidCount + emb[i]) / (this.segCentroidCount + 1);
    }
    this.segCentroid = l2normalize(merged);
    this.segCentroidCount += 1;
  }

  /** Extract a normalised speaker embedding from a mono 16 kHz window. */
  private embed(samples: Float32Array): Float32Array | null {
    if (!this.speakerEmbedding) return null;
    try {
      const stream = this.speakerEmbedding.createStream();
      stream.acceptWaveform({ sampleRate: this.sampleRate, samples });
      stream.inputFinished();
      if (!this.speakerEmbedding.isReady(stream)) return null;
      const e = this.speakerEmbedding.compute(stream);
      if (!e || e.length === 0) return null;
      return l2normalize(e);
    } catch {
      return null;
    }
  }

  private pushPreroll(win: Float32Array): void {
    for (let k = 0; k < win.length; k++) this.preroll.push(win[k]);
    const overflow = this.preroll.length - this.prerollCap;
    if (overflow > 0) this.preroll.splice(0, overflow);
  }

  /**
   * Commit the current segment as a finalized paragraph, then reset the
   * recognizer in place so streaming continues with no gap.
   *
   * `reason`:
   *   - `pause`/`final`  — a normal boundary (silence/endpoint/stop). The whole
   *     decoded text + audio belong to one speaker; afterwards we go idle.
   *   - `speaker-change` — a voice change detected mid-speech. The text is SPLIT
   *     at `boundarySample` using ASR token timestamps: words before the
   *     boundary are committed for the closing speaker; the remaining audio is
   *     carried into a fresh segment so the new speaker is never merged in.
   *
   * Returns true (the segment was handled).
   */
  private commitSegment(opts: {
    reason: 'pause' | 'final' | 'speaker-change';
    boundarySample?: number;
    newSpeakerEmbeddings?: Float32Array[];
  }): boolean {
    const result = this.recognizer.getResult(this.asrStream);
    const fullText = (result.text || '').trim();
    const tokens: string[] = Array.isArray(result.tokens) ? result.tokens : [];
    const timestamps: number[] = Array.isArray(result.timestamps) ? result.timestamps : [];

    const isChange = opts.reason === 'speaker-change' && opts.boundarySample !== undefined;

    // What text + audio belong to the CLOSING segment?
    let segText = fullText;
    let boundary = this.ongoingSamples.length;
    if (isChange) {
      boundary = Math.min(opts.boundarySample!, this.ongoingSamples.length);
      const boundarySec = boundary / this.sampleRate;
      const splitTok = countTokensBefore(timestamps, boundarySec);
      segText = tokensToText(tokens.slice(0, splitTok));
    }
    const segSamples = this.ongoingSamples.slice(0, boundary);
    const tailSamples = isChange ? this.ongoingSamples.slice(boundary) : [];

    // Decide independently: (a) is this real speech worth surfacing, and
    // (b) who said it. These are SEPARATE questions — failing to attribute a
    // speaker must never silently discard genuine words. Only the hallucination
    // guard (a) may drop text; when (b) can't run we still emit, as "unknown".
    const rejectReason = this.rejectUtterance(segText, segSamples, result);
    if (rejectReason) {
      if (segText) {
        console.log(
          `[VADSegmentedTranscriber] Rejected (hallucination guard: ${rejectReason}): "${segText}"`,
        );
      }
    } else {
      // Speaker ID from the per-window embeddings of THIS segment (multi-window),
      // falling back to a single embedding when the segment was too short to have
      // produced any rolling windows.
      const match = this.identifySegmentSpeaker(this.segEmbeddings, segSamples);
      if (match) {
        console.log(
          `[VADSegmentedTranscriber] (${opts.reason}) Speaker → ${match.speaker} ` +
            `(${match.info.decision}, score=${match.info.score.toFixed(2)}; ${match.info.reason})`,
        );
        this.emit('event', {
          type: 'final',
          text: segText,
          speaker: match.speaker,
          speakerInfo: match.info,
          timestamp: Date.now(),
        } as StreamingEvent);
      } else {
        // Real speech the diarizer was too short to attribute. Surface the words
        // rather than dropping them. Prefer the speaker the tracker is currently
        // holding (a short interjection inside one person's turn stays attributed
        // to them); fall back to the unknown label only when no one is held.
        const heldId = this.tracker?.current;
        const heldName = heldId ? this.enrolledById.get(heldId) : undefined;
        const speaker = heldName ?? this.speakerId?.unknownLabel ?? 'Unknown Speaker';
        console.log(
          `[VADSegmentedTranscriber] (${opts.reason}) Speaker → ${speaker} ` +
            `(${heldName ? 'held' : 'unknown'}; segment too short for speaker id): "${segText}"`,
        );
        this.emit('event', {
          type: 'final',
          text: segText,
          speaker,
          speakerInfo: {
            decision: 'unknown',
            score: 0,
            bestName: '',
            reason: 'segment too short for speaker id',
          },
          timestamp: Date.now(),
        } as StreamingEvent);
      }
    }

    // Reset decoder + per-segment diarization state.
    this.recognizer.reset(this.asrStream);
    this.lastPartialText = '';
    this.segEmbeddings = [];
    this.segCentroid = null;
    this.segCentroidCount = 0;
    this.changeCandidates = 0;
    this.pendingChangeEmbeddings = [];

    if (isChange) {
      // Speech continues with the NEW speaker. Carry their audio into a fresh
      // segment and re-feed it so their words decode into the new paragraph.
      this.ongoingSamples = tailSamples;
      this.lastDiarSample = tailSamples.length;
      if (tailSamples.length > 0) {
        this.asrStream.acceptWaveform({
          samples: new Float32Array(tailSamples),
          sampleRate: this.sampleRate,
        });
        while (this.recognizer.isReady(this.asrStream)) this.recognizer.decode(this.asrStream);
      }
      // Seed the new segment's centroid with the new speaker's windows.
      for (const e of opts.newSpeakerEmbeddings ?? []) this.extendSegment(e);
      // Stay SPEAKING — do not go idle or clear the pre-roll.
      return true;
    }

    // Normal boundary: go idle.
    this.ongoingSamples = [];
    this.lastDiarSample = 0;
    this.isSpeechActive = false;
    this.preroll = [];
    this.emit('event', { type: 'vad', isSpeaking: false, timestamp: Date.now() } as StreamingEvent);
    return true;
  }

  /**
   * Identify the segment speaker from its rolling-window embeddings (preferred:
   * robust multi-window aggregation), falling back to a single embedding over
   * the whole segment when it was too short to have produced rolling windows.
   */
  private identifySegmentSpeaker(
    windows: Float32Array[],
    fallbackSamples: number[],
  ): { speaker: string; info: SpeakerMatchInfo } | null {
    if (!this.speakerId) return null;

    // Collect the embeddings representing this segment. Prefer the rolling
    // windows; for a segment too short to have produced any, embed it once.
    let segWindows = windows;
    if (segWindows.length === 0) {
      if (fallbackSamples.length < this.sampleRate * 0.5) return null;
      const e = this.embed(new Float32Array(fallbackSamples));
      if (!e) return null;
      segWindows = [e];
    }

    // Per-segment open-set decision (also drives unknown-voice clustering and
    // provides the diagnostic score/reason).
    const m = this.speakerId.identifyMany(segWindows);

    // Advance the sticky tracker by one segment and let it OWN the final label.
    // The tracker smooths across segments (score hysteresis + hold), so a single
    // segment whose score dips can't flip a stable speaker, and a confusable
    // segment can't steal the label — this is the flicker fix. The tracker is
    // clocked per committed segment (not per hop) so the closing segment at a
    // change boundary is always scored on its OWN audio, never the next speaker's.
    let label = m.speaker;
    let decision = m.decision;
    let reason = m.reason;
    let trackerOverride = false;
    if (this.tracker) {
      const scored = this.speakerId.scoreSpeakers(segWindows);
      const upd = this.tracker.update(scored);
      if (upd.provisional !== UNKNOWN_SPEAKER) {
        const name = this.enrolledById.get(upd.provisional);
        if (name) {
          const smoothed = !(m.decision === 'known' && m.speaker === name);
          label = name;
          decision = 'known';
          reason = smoothed ? `tracker:${name} (smoothed; segment→${m.speaker})` : `tracker:${name}; ${m.reason}`;
          trackerOverride = smoothed;
        }
      }
      // Tracker committed UNKNOWN → keep m's (clustered) unknown/guest label.
    }

    return {
      speaker: label,
      info: {
        decision,
        score: m.score,
        bestName: m.bestName,
        runnerUpName: m.runnerUpName,
        runnerUpScore: m.runnerUpScore,
        rawScore: m.rawScore,
        threshold: m.threshold,
        trackerOverride,
        reason,
      },
    };
  }

  /**
   * Hallucination / noise gate. Returns `null` when the transcription is
   * trustworthy enough to surface, otherwise a short reason for the drop (used
   * for diagnosable logging). Accuracy is prioritised over output: when in doubt
   * we drop the text rather than show something that was never said.
   */
  private rejectUtterance(text: string, samples: number[], result: any): string | null {
    if (!text) return 'empty';

    // The signal gates (duration/energy) exist to catch VAD latching onto a
    // click/hum that produced garbage. But a Zipformer transducer does not
    // decode a noise blip into multiple coherent words — so once we have real
    // lexical content (≥2 alphabetic words) we trust the ASR over the raw signal
    // and skip those gates. Short single-token output stays guarded. The
    // repetition + blocklist guards below always run; they exist precisely to
    // catch coherent-looking hallucinations.
    const wordCount = (text.match(/[a-z]+/gi) ?? []).length;
    const hasLexicalContent = wordCount >= 2;

    if (!hasLexicalContent) {
      // 1. Duration — too short to be a real utterance.
      if (samples.length < this.cfg.minUtteranceSec * this.sampleRate) return 'too short';

      // 2. Energy — VAD can latch onto loud noise; require real signal level.
      if (rms(samples) < this.cfg.minRms) return 'low energy';
    }

    // 3. Acoustic confidence — non-English / garbled audio decodes with low
    //    per-token probability against this English model.
    const probs: number[] | undefined = result?.ys_probs;
    if (Array.isArray(probs) && probs.length > 0) {
      const avg = probs.reduce((a, b) => a + b, 0) / probs.length;
      if (avg < this.cfg.minAvgLogProb) return 'low acoustic confidence';
    }

    // 4. Repetition — classic looping hallucination ("you you you …").
    if (isRepetitive(text)) return 'repetition';

    // 5. Known hallucination phrases.
    const lower = text.toLowerCase();
    if (this.cfg.blocklist.some((p) => lower === p || lower.includes(p))) return 'blocklisted phrase';

    return null;
  }

  /**
   * Finalize: flush words still being decoded and commit them as a last
   * paragraph. Called when the speaker stops the session.
   */
  finalize(): void {
    if (!this.initialized) return;
    if (this.isSpeechActive) {
      this.asrStream.inputFinished();
      while (this.recognizer.isReady(this.asrStream)) {
        this.recognizer.decode(this.asrStream);
      }
      this.commitSegment({ reason: 'final' });
    }
    // Fresh stream so the transcriber can be reused for another session.
    this.asrStream = this.recognizer.createStream();
    this.leftover = new Float32Array(0);
    this.preroll = [];
    this.resetSegmentState();
    // New session ⇒ fresh identity tracking (no carry-over of a prior speaker).
    this.tracker?.reset();
  }

  /** Clear all per-segment diarization state (used on finalize). */
  private resetSegmentState(): void {
    this.segEmbeddings = [];
    this.segCentroid = null;
    this.segCentroidCount = 0;
    this.lastDiarSample = 0;
    this.changeCandidates = 0;
    this.pendingChangeEmbeddings = [];
    this.ongoingSamples = [];
  }

  cleanup(): void {
    this.asrStream = null;
    this.recognizer = null;
    this.speakerEmbedding = null;
    this.speakerId = null;
    this.vad = null;
    this.tracker = null;
    this.asnorm = null;
    this.enrolledById.clear();
    this.initialized = false;
    this.removeAllListeners();
  }
}

// --- Hallucination-filter helpers ------------------------------------------

function rms(samples: number[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * Number of ASR tokens whose timestamp falls at or before `boundarySec`. ASR
 * `timestamps` are seconds relative to the last recognizer reset, which is the
 * start of the current segment — the same origin as our sample counter — so a
 * boundary in samples maps directly to a token index for splitting the text.
 */
function countTokensBefore(timestamps: number[], boundarySec: number): number {
  let k = 0;
  while (k < timestamps.length && timestamps[k] <= boundarySec) k++;
  return k;
}

/**
 * Reconstruct text from a slice of Zipformer BPE tokens. Word boundaries are
 * marked with '▁' (U+2581); joining the pieces and turning that marker into a
 * space yields readable text for the partial (pre-boundary) segment.
 */
function tokensToText(tokens: string[]): string {
  return tokens.join('').replace(/▁/g, ' ').trim();
}

/**
 * Detect the looping/repetition pattern typical of ASR hallucinations on
 * noise or out-of-domain audio (e.g. "you you you you" or a phrase echoed
 * many times). Real speech has far higher lexical variety.
 */
function isRepetitive(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;

  const uniqueRatio = new Set(words).size / words.length;
  if (uniqueRatio <= 0.35) return true;

  let run = 1;
  let maxRun = 1;
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1;
    if (run > maxRun) maxRun = run;
  }
  return maxRun >= 4;
}
