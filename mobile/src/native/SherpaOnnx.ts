/**
 * SherpaOnnx — Native module bridge for on-device speech recognition
 * and speaker embedding extraction using sherpa-onnx C API.
 *
 * Runs entirely on-device. No audio data leaves the phone.
 *
 * iOS:  Links against sherpa-onnx.xcframework (ARM64 + simulator)
 * Android: Links against sherpa-onnx .so (arm64-v8a, armeabi-v7a, x86_64)
 *
 * Provides:
 *   - Streaming ASR (transducer model: Zipformer encoder)
 *   - Speaker embedding extraction (WeSpeaker ResNet34)
 */

import { NativeModules, NativeEventEmitter } from 'react-native';

const { SherpaOnnxModule } = NativeModules;

export interface ASRConfig {
  encoderPath: string;
  decoderPath: string;
  joinerPath: string;
  tokensPath: string;
  sampleRate: number;       // 16000
  numThreads: number;       // recommended: 2 for mobile
  enableEndpoint: boolean;  // auto-detect end of utterance
  rule1MinTrailingSilence: number; // seconds, e.g. 2.4
  rule2MinTrailingSilence: number; // seconds, e.g. 1.2
  rule3MinUtteranceLength: number; // seconds, e.g. 20
}

export interface SpeakerModelConfig {
  modelPath: string;
  numThreads: number;
  sampleRate: number;
}

export interface PartialResultEvent {
  text: string;
  timestamp: number;
}

export interface FinalResultEvent {
  text: string;
  timestamp: number;
  isEndpoint: boolean;
}

class SherpaOnnxManager {
  private emitter: NativeEventEmitter;
  private partialSub: ReturnType<NativeEventEmitter['addListener']> | null = null;
  private finalSub: ReturnType<NativeEventEmitter['addListener']> | null = null;

  constructor() {
    this.emitter = new NativeEventEmitter(SherpaOnnxModule);
  }

  // --- ASR ---

  async initASR(config: ASRConfig): Promise<void> {
    return SherpaOnnxModule.initASR(config);
  }

  async releaseASR(): Promise<void> {
    this.partialSub?.remove();
    this.finalSub?.remove();
    return SherpaOnnxModule.releaseASR();
  }

  /**
   * Feed raw PCM Float32 samples to the recognizer.
   * @param base64Samples Base64-encoded Float32Array
   */
  async feedAudio(base64Samples: string): Promise<void> {
    return SherpaOnnxModule.feedAudio(base64Samples);
  }

  /** Get current partial (non-final) recognition result */
  async getPartialResult(): Promise<string> {
    return SherpaOnnxModule.getPartialResult();
  }

  /** Check if the recognizer detected an endpoint */
  async isEndpoint(): Promise<boolean> {
    return SherpaOnnxModule.isEndpoint();
  }

  /** Reset the recognizer for the next utterance */
  async resetASR(): Promise<void> {
    return SherpaOnnxModule.resetASR();
  }

  onPartialResult(callback: (event: PartialResultEvent) => void): () => void {
    this.partialSub = this.emitter.addListener('onPartialResult', callback);
    return () => this.partialSub?.remove();
  }

  onFinalResult(callback: (event: FinalResultEvent) => void): () => void {
    this.finalSub = this.emitter.addListener('onFinalResult', callback);
    return () => this.finalSub?.remove();
  }

  // --- Speaker embedding ---

  async initSpeakerModel(config: SpeakerModelConfig): Promise<void> {
    return SherpaOnnxModule.initSpeakerModel(config);
  }

  async releaseSpeakerModel(): Promise<void> {
    return SherpaOnnxModule.releaseSpeakerModel();
  }

  /**
   * Extract a speaker embedding vector from audio samples.
   * @param base64Samples Base64-encoded Float32Array of audio
   * @returns Embedding vector as number[]
   */
  async extractEmbedding(base64Samples: string): Promise<number[]> {
    return SherpaOnnxModule.extractEmbedding(base64Samples);
  }

  // --- Model management ---

  /** Check if model files exist at the given paths */
  async modelsExist(paths: string[]): Promise<boolean> {
    return SherpaOnnxModule.modelsExist(paths);
  }
}

export const sherpaOnnx = new SherpaOnnxManager();
