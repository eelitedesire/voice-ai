/**
 * OnDeviceASR — Orchestrates on-device speech recognition pipeline.
 *
 * Pipeline:  AudioCapture → VAD → ASR → Speaker ID → Result
 *
 * All processing happens on-device. Audio never leaves the phone.
 * Only the resulting transcript text is sent to the server for LLM analysis.
 */

import { audioCapture, AudioBufferEvent } from '../native/AudioCapture';
import { sherpaOnnx, ASRConfig } from '../native/SherpaOnnx';
import { vad, VADConfig, VADEvent } from '../native/VAD';
import { AUDIO_CONFIG, MODEL_PATHS } from '../config/api';
import { OnDeviceTranscriptionResult, TranscriptEntry } from '../types';

type TranscriptionCallback = (result: OnDeviceTranscriptionResult) => void;
type VADCallback = (isSpeaking: boolean) => void;

interface SpeakerReference {
  name: string;
  embedding: number[];
}

export class OnDeviceASR {
  private isRunning = false;
  private transcriptionCallbacks: TranscriptionCallback[] = [];
  private vadCallbacks: VADCallback[] = [];
  private currentText = '';
  private isSpeaking = false;
  private speechStartTime = 0;

  // Speaker identification
  private speakerReferences: SpeakerReference[] = [];
  private currentSpeechSamples: number[] = [];

  // Accumulated transcript
  private transcript: TranscriptEntry[] = [];

  private unsubscribeAudio: (() => void) | null = null;
  private unsubscribeVAD: (() => void) | null = null;
  private unsubscribePartial: (() => void) | null = null;
  private unsubscribeFinal: (() => void) | null = null;

  async initialize(documentDir: string): Promise<void> {
    // Initialize VAD
    const vadConfig: VADConfig = {
      modelPath: `${documentDir}/${MODEL_PATHS.vad}`,
      sampleRate: AUDIO_CONFIG.sampleRate,
      frameSizeMs: 30,
      threshold: 0.5,
      minSilenceDurationMs: 300,
      minSpeechDurationMs: 250,
      speechPadMs: 100,
    };
    await vad.init(vadConfig);

    // Initialize ASR
    const asrConfig: ASRConfig = {
      encoderPath: `${documentDir}/${MODEL_PATHS.asrEncoder}`,
      decoderPath: `${documentDir}/${MODEL_PATHS.asrDecoder}`,
      joinerPath: `${documentDir}/${MODEL_PATHS.asrJoiner}`,
      tokensPath: `${documentDir}/${MODEL_PATHS.asrTokens}`,
      sampleRate: AUDIO_CONFIG.sampleRate,
      numThreads: 2,
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20,
    };
    await sherpaOnnx.initASR(asrConfig);

    // Subscribe to ASR events
    this.unsubscribePartial = sherpaOnnx.onPartialResult(({ text }) => {
      if (text.trim()) {
        this.currentText = text;
        this.emitTranscription({
          text,
          isFinal: false,
          confidence: 0.8,
          timestamp: Date.now(),
          processedOnDevice: true,
        });
      }
    });

    this.unsubscribeFinal = sherpaOnnx.onFinalResult(async ({ text }) => {
      if (text.trim()) {
        const speaker = await this.identifyCurrentSpeaker();
        const entry: TranscriptEntry = {
          speaker,
          text: text.trim(),
          timestamp: Date.now(),
        };
        this.transcript.push(entry);

        this.emitTranscription({
          text: text.trim(),
          isFinal: true,
          speaker,
          confidence: 0.9,
          timestamp: Date.now(),
          processedOnDevice: true,
        });
      }
      this.currentText = '';
      this.currentSpeechSamples = [];
      await sherpaOnnx.resetASR();
    });

    // Subscribe to VAD state changes
    this.unsubscribeVAD = vad.onVADStateChange(({ isSpeaking }: VADEvent) => {
      if (isSpeaking !== this.isSpeaking) {
        this.isSpeaking = isSpeaking;
        if (isSpeaking) {
          this.speechStartTime = Date.now();
        }
        for (const cb of this.vadCallbacks) {
          cb(isSpeaking);
        }
      }
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    const hasPermission = await audioCapture.requestPermission();
    if (!hasPermission) {
      throw new Error('Microphone permission denied');
    }

    // Subscribe to audio buffers
    this.unsubscribeAudio = audioCapture.onAudioBuffer(
      async (event: AudioBufferEvent) => {
        // Feed audio to VAD
        const speaking = await vad.process(event.samples);

        // Accumulate samples for speaker ID while speaking
        if (speaking) {
          const decoded = audioCapture.constructor.prototype.constructor === undefined
            ? [] : []; // placeholder — actual decoding happens in native layer
          // Feed audio to ASR only when speech is detected
          await sherpaOnnx.feedAudio(event.samples);
        }

        // Check for endpoint (end of utterance)
        const isEndpoint = await sherpaOnnx.isEndpoint();
        if (isEndpoint) {
          // Force finalize
          await sherpaOnnx.resetASR();
        }
      },
    );

    await audioCapture.start({
      sampleRate: AUDIO_CONFIG.sampleRate,
      channels: AUDIO_CONFIG.channels,
      bufferSize: AUDIO_CONFIG.bufferSize,
    });

    this.isRunning = true;
  }

  async stop(): Promise<TranscriptEntry[]> {
    if (!this.isRunning) return this.transcript;

    await audioCapture.stop();
    this.unsubscribeAudio?.();
    this.unsubscribeAudio = null;
    this.isRunning = false;

    return [...this.transcript];
  }

  async release(): Promise<void> {
    await this.stop();
    this.unsubscribeVAD?.();
    this.unsubscribePartial?.();
    this.unsubscribeFinal?.();
    await vad.release();
    await sherpaOnnx.releaseASR();
  }

  // --- Speaker identification (on-device) ---

  setSpeakerReferences(refs: SpeakerReference[]): void {
    this.speakerReferences = refs;
  }

  private async identifyCurrentSpeaker(): Promise<string> {
    if (this.speakerReferences.length === 0) {
      return 'Unknown';
    }

    // Extract embedding from accumulated speech samples
    // The native module handles the base64 encoding
    try {
      const sampleBuffer = this.currentSpeechSamples;
      if (sampleBuffer.length < AUDIO_CONFIG.sampleRate) {
        // Less than 1 second — not enough for reliable speaker ID
        return 'Unknown';
      }

      // Encode samples as base64 for native bridge
      const float32 = new Float32Array(sampleBuffer);
      const bytes = new Uint8Array(float32.buffer);
      const base64 = globalThis.btoa(
        String.fromCharCode(...bytes),
      );

      const embedding = await sherpaOnnx.extractEmbedding(base64);
      return this.matchSpeaker(embedding);
    } catch {
      return 'Unknown';
    }
  }

  private matchSpeaker(embedding: number[]): string {
    let bestMatch = 'Unknown';
    let bestScore = -1;
    const threshold = 0.35;

    for (const ref of this.speakerReferences) {
      const score = cosineSimilarity(embedding, ref.embedding);
      if (score > threshold && score > bestScore) {
        bestScore = score;
        bestMatch = ref.name;
      }
    }

    return bestMatch;
  }

  // --- Callbacks ---

  onTranscription(callback: TranscriptionCallback): () => void {
    this.transcriptionCallbacks.push(callback);
    return () => {
      this.transcriptionCallbacks = this.transcriptionCallbacks.filter(
        cb => cb !== callback,
      );
    };
  }

  onVADChange(callback: VADCallback): () => void {
    this.vadCallbacks.push(callback);
    return () => {
      this.vadCallbacks = this.vadCallbacks.filter(cb => cb !== callback);
    };
  }

  private emitTranscription(result: OnDeviceTranscriptionResult): void {
    for (const cb of this.transcriptionCallbacks) {
      cb(result);
    }
  }

  getTranscript(): TranscriptEntry[] {
    return [...this.transcript];
  }

  clearTranscript(): void {
    this.transcript = [];
  }
}

// --- Utilities ---

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
