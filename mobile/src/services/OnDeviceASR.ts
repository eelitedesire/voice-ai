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
type AudioLevelCallback = (rms: number, peak: number) => void;

interface SpeakerReference {
  name: string;
  embedding: number[];
}

export class OnDeviceASR {
  private isRunning = false;
  private transcriptionCallbacks: TranscriptionCallback[] = [];
  private vadCallbacks: VADCallback[] = [];
  private audioLevelCallbacks: AudioLevelCallback[] = [];
  private currentText = '';
  private isSpeaking = false;
  private speechStartTime = 0;

  // Speaker identification
  private speakerReferences: SpeakerReference[] = [];
  private currentSpeechSamples: number[] = [];

  // Accumulated transcript
  private transcript: TranscriptEntry[] = [];

  private unsubscribeAudio: (() => void) | null = null;
  private unsubscribeAudioLevel: (() => void) | null = null;
  private unsubscribeVAD: (() => void) | null = null;
  private unsubscribePartial: (() => void) | null = null;
  private unsubscribeFinal: (() => void) | null = null;

  async initialize(documentDir: string): Promise<void> {
    console.log('[OnDeviceASR] Initializing with documentDir:', documentDir);

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
    console.log('[OnDeviceASR] Initializing VAD with config:', vadConfig);
    await vad.init(vadConfig);
    console.log('[OnDeviceASR] VAD initialized successfully');

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
    console.log('[OnDeviceASR] Initializing ASR');
    await sherpaOnnx.initASR(asrConfig);
    console.log('[OnDeviceASR] ASR initialized successfully');

    // Initialize speaker embedding model for speaker identification
    await sherpaOnnx.initSpeakerModel({
      modelPath: `${documentDir}/${MODEL_PATHS.speakerEncoder}`,
      numThreads: 2,
      sampleRate: AUDIO_CONFIG.sampleRate,
    });
    console.log('[OnDeviceASR] Speaker model initialized successfully');

    // Subscribe to ASR events
    this.unsubscribePartial = sherpaOnnx.onPartialResult(({ text }) => {
      if (text.trim()) {
        console.log('[OnDeviceASR] Partial result:', text);
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
        console.log('[OnDeviceASR] Final result:', text);
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
        console.log('[OnDeviceASR] VAD state changed:', isSpeaking ? 'SPEAKING' : 'SILENT');
        this.isSpeaking = isSpeaking;
        if (isSpeaking) {
          this.speechStartTime = Date.now();
          // Clear samples from any previous utterance so each speech segment
          // gets its own clean buffer for speaker identification.
          this.currentSpeechSamples = [];
        } else {
          // Speech ended — tell the recognizer to finalize the current utterance.
          // SFSpeechRecognizer calls endAudio() inside resetASR(), which triggers
          // the recognition task to complete and emit onFinalResult.
          sherpaOnnx.resetASR().catch(() => {});
        }
        for (const cb of this.vadCallbacks) {
          cb(isSpeaking);
        }
      }
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('[OnDeviceASR] Starting audio capture...');
    const hasPermission = await audioCapture.requestPermission();
    if (!hasPermission) {
      throw new Error('Microphone permission denied');
    }

    // Subscribe to audio level updates
    this.unsubscribeAudioLevel = audioCapture.onAudioLevel((event) => {
      for (const cb of this.audioLevelCallbacks) {
        cb(event.rms, event.peak);
      }
    });

    let bufferCount = 0;
    // Subscribe to audio buffers
    this.unsubscribeAudio = audioCapture.onAudioBuffer(
      async (event: AudioBufferEvent) => {
        bufferCount++;
        if (bufferCount % 100 === 0) {
          console.log(`[OnDeviceASR] Processed ${bufferCount} audio buffers`);
        }

        // Feed audio to VAD to track speech/silence state
        const speaking = await vad.process(event.samples);

        // Always feed audio to ASR regardless of VAD state so utterance
        // beginnings are not clipped (SFSpeechRecognizer handles silence itself).
        await sherpaOnnx.feedAudio(event.samples);

        // Accumulate decoded samples for speaker ID during the confirmed
        // speech window. Use the latched isSpeaking state (set by VAD state
        // change event) rather than the per-frame vad.process() return value,
        // which can miss the first ~250ms while VAD confirms speech start.
        if (this.isSpeaking) {
          const binary = globalThis.atob(event.samples);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const floatSamples = new Float32Array(bytes.buffer);
          for (let i = 0; i < floatSamples.length; i++) {
            this.currentSpeechSamples.push(floatSamples[i]);
          }
        }
      },
    );

    await audioCapture.start({
      sampleRate: AUDIO_CONFIG.sampleRate,
      channels: AUDIO_CONFIG.channels,
      bufferSize: AUDIO_CONFIG.bufferSize,
    });

    console.log('[OnDeviceASR] Audio capture started');
    this.isRunning = true;
  }

  async stop(): Promise<TranscriptEntry[]> {
    if (!this.isRunning) return this.transcript;

    await audioCapture.stop();
    this.unsubscribeAudio?.();
    this.unsubscribeAudio = null;
    this.unsubscribeAudioLevel?.();
    this.unsubscribeAudioLevel = null;
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
    await sherpaOnnx.releaseSpeakerModel();
  }

  // --- Speaker identification (on-device) ---

  setSpeakerReferences(refs: SpeakerReference[]): void {
    this.speakerReferences = refs;
  }

  private async identifyCurrentSpeaker(): Promise<string> {
    if (this.speakerReferences.length === 0) {
      // No enrolled speakers — no label
      return '';
    }

    // Extract embedding from accumulated speech samples
    // The native module handles the base64 encoding
    try {
      const sampleBuffer = this.currentSpeechSamples;
      if (sampleBuffer.length < AUDIO_CONFIG.sampleRate * 0.5) {
        // Less than 0.5 seconds — not enough for reliable speaker ID
        return '';
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
      return '';
    }
  }

  private matchSpeaker(embedding: number[]): string {
    let bestMatch = '';
    let bestScore = -Infinity;

    for (const ref of this.speakerReferences) {
      const score = cosineSimilarity(embedding, ref.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = ref.name;
      }
    }

    // Always returns the closest enrolled speaker (speakerReferences.length > 0 guaranteed by caller)
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

  onAudioLevel(callback: AudioLevelCallback): () => void {
    this.audioLevelCallbacks.push(callback);
    return () => {
      this.audioLevelCallbacks = this.audioLevelCallbacks.filter(cb => cb !== callback);
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
