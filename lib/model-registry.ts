import * as sherpa from 'sherpa-onnx-node';
import * as path from 'path';
import * as fs from 'fs';
import { EnrolledSpeaker, buildEnrolledSpeakers } from './speaker-identification';

/**
 * Shared, process-wide model registry.
 *
 * The heavy ONNX models (the streaming zipformer encoder/decoder/joiner and the
 * speaker-embedding extractor) are expensive to load (hundreds of MB, hundreds
 * of ms). Loading them per WebSocket connection is the main cause of the
 * "Start Session" latency.
 *
 * These models are stateless across recognition streams: the `OnlineRecognizer`
 * holds no per-utterance state — that lives in the `OnlineStream` you create
 * from it — and the speaker manager/extractor are read-only after enrollment is
 * loaded. So we load them exactly once and share them across every connection.
 *
 * The only per-connection stateful object is the VAD, which is cheap to build
 * (silero_vad.onnx is ~640 KB); `createVad()` mints a fresh one per session.
 */

export interface SharedModels {
  recognizer: any;
  /** Embedding extractor — shared; per-call streams make it stateless/safe. */
  speakerEmbedding: any;
  modelPath: string;
  sampleRate: number;
}

const SAMPLE_RATE = 16000;

function modelDir(): string {
  return process.env.MODEL_PATH || path.join(process.cwd(), 'models');
}

function num(env: string | undefined, fallback: number): number {
  const n = env === undefined ? NaN : Number(env);
  return Number.isFinite(n) ? n : fallback;
}

export function buildAsrConfig(modelPath: string) {
  return {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: path.join(modelPath, 'encoder.onnx'),
        decoder: path.join(modelPath, 'decoder.onnx'),
        joiner: path.join(modelPath, 'joiner.onnx'),
      },
      tokens: path.join(modelPath, 'tokens.txt'),
      numThreads: num(process.env.ASR_NUM_THREADS, 2),
      provider: 'cpu',
      debug: 0,
    },
    // Endpoint detection is a *secondary* paragraph-boundary signal (the primary
    // one is VAD silence). rule2 fires after words were decoded + trailing
    // silence; keep it aligned with the VAD commit window.
    enableEndpoint: true,
    rule1MinTrailingSilence: num(process.env.ASR_RULE1_SILENCE, 1.2),
    rule2MinTrailingSilence: num(process.env.ASR_RULE2_SILENCE, 0.6),
    rule3MinUtteranceLength: num(process.env.ASR_RULE3_UTTERANCE, 20),
  };
}

export function buildVadConfig(modelPath: string) {
  return {
    sileroVad: {
      model: path.join(modelPath, 'silero_vad.onnx'),
      // Defaults restored to the original implementation so the VAD finalizes a
      // completed segment (vad.pop()) under the same conditions as before:
      // 0.3s of trailing silence ends a segment, and detection sensitivity is
      // 0.4. These are the values that govern paragraph boundaries now that the
      // trailing-silence timer and ASR endpoint no longer commit. Still
      // env-overridable for tuning.
      minSilenceDuration: num(process.env.VAD_MIN_SILENCE, 0.3),
      minSpeechDuration: num(process.env.VAD_MIN_SPEECH, 0.25),
      threshold: num(process.env.VAD_THRESHOLD, 0.4),
      windowSize: 512,
    },
    sampleRate: SAMPLE_RATE,
    numThreads: 1,
    provider: 'cpu',
    debug: 0,
  };
}

let loadPromise: Promise<SharedModels> | null = null;

/**
 * Load (or return the already-loading/loaded) shared models. Idempotent and
 * safe to call concurrently — every caller awaits the same promise.
 */
export function getSharedModels(): Promise<SharedModels> {
  if (!loadPromise) {
    loadPromise = loadModels().catch((err) => {
      // Reset so a transient failure can be retried on the next connection
      // instead of permanently poisoning the singleton.
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

/**
 * Kick off model loading ahead of any user interaction (call at server boot).
 */
export function warmUpModels(): Promise<SharedModels> {
  return getSharedModels();
}

/**
 * Create a fresh, per-connection VAD instance. The detector is stateful, so it
 * cannot be shared between concurrent sessions.
 */
export function createVad(): any {
  return new sherpa.Vad(buildVadConfig(modelDir()), 60);
}

async function loadModels(): Promise<SharedModels> {
  const t0 = Date.now();
  const modelPath = modelDir();

  const recognizer = new sherpa.OnlineRecognizer(buildAsrConfig(modelPath));

  const speakerEmbedding = new sherpa.SpeakerEmbeddingExtractor({
    model: path.join(modelPath, 'speaker-embedding.onnx'),
    numThreads: 1,
    debug: 0,
    provider: 'cpu',
  });

  const models: SharedModels = {
    recognizer,
    speakerEmbedding,
    modelPath,
    sampleRate: SAMPLE_RATE,
  };

  // Warm the recognizer: run a throwaway decode so ONNX Runtime does its lazy
  // allocation/JIT now, at boot, rather than on the first spoken word.
  warmUpRecognizer(recognizer);

  console.log(`[ModelRegistry] Loaded shared models in ${Date.now() - t0}ms`);
  return models;
}

function warmUpRecognizer(recognizer: any): void {
  try {
    const stream = recognizer.createStream();
    const silence = new Float32Array(SAMPLE_RATE); // 1s of silence
    stream.acceptWaveform({ samples: silence, sampleRate: SAMPLE_RATE });
    stream.inputFinished();
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }
    recognizer.getResult(stream);
  } catch (e) {
    console.warn('[ModelRegistry] Recognizer warm-up skipped:', e);
  }
}

/**
 * Read the enrolment database from disk and build normalised speaker profiles.
 * Loaded fresh per session (cheap) so newly enrolled speakers take effect on the
 * next "Start Session" without restarting the server.
 */
export function loadEnrolledSpeakers(): EnrolledSpeaker[] {
  const dbPath = path.join(process.cwd(), 'speaker_db.json');
  if (!fs.existsSync(dbPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
    return buildEnrolledSpeakers(data.speakers || []);
  } catch (e) {
    console.warn('[ModelRegistry] Failed to load speakers:', e);
    return [];
  }
}
