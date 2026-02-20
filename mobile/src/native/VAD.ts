/**
 * VAD — Native module bridge for on-device Voice Activity Detection.
 *
 * Uses Silero VAD v5 ONNX model via ONNX Runtime Mobile.
 * Runs at ~0.5ms per 30ms audio frame on modern phones — negligible overhead.
 *
 * The VAD runs on a dedicated native thread to avoid blocking the JS thread.
 */

import { NativeModules, NativeEventEmitter } from 'react-native';

const { VADModule } = NativeModules;

export interface VADConfig {
  modelPath: string;
  sampleRate: number;       // 16000
  frameSizeMs: number;      // 30 or 60 ms
  threshold: number;        // speech probability threshold, e.g. 0.5
  minSilenceDurationMs: number;  // min silence to end speech, e.g. 300
  minSpeechDurationMs: number;   // min speech to start, e.g. 250
  speechPadMs: number;           // padding around speech segments, e.g. 100
}

export interface VADEvent {
  isSpeaking: boolean;
  probability: number;
  timestamp: number;
}

class VADManager {
  private emitter: NativeEventEmitter | null;
  private subscription: ReturnType<NativeEventEmitter['addListener']> | null = null;

  constructor() {
    this.emitter = VADModule ? new NativeEventEmitter(VADModule) : null;
  }

  async init(config: VADConfig): Promise<void> {
    return VADModule.initVAD(config);
  }

  async release(): Promise<void> {
    this.subscription?.remove();
    this.subscription = null;
    return VADModule.release();
  }

  /**
   * Process a chunk of audio through the VAD.
   * @param base64Samples Base64-encoded Float32Array
   * @returns Whether speech is detected in this chunk
   */
  async process(base64Samples: string): Promise<boolean> {
    return VADModule.process(base64Samples);
  }

  /** Reset the VAD state (call between utterances) */
  async reset(): Promise<void> {
    return VADModule.reset();
  }

  onVADStateChange(callback: (event: VADEvent) => void): () => void {
    this.subscription = this.emitter?.addListener('onVADStateChange', callback) ?? null;
    return () => this.subscription?.remove();
  }
}

export const vad = new VADManager();
