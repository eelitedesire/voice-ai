/**
 * AudioCapture — Native module bridge for low-latency audio recording.
 *
 * Records 16 kHz mono Float32 PCM via platform-native APIs:
 *   iOS:  AVAudioEngine with an input tap
 *   Android: AudioRecord (ENCODING_PCM_FLOAT, low-latency mode)
 *
 * Emits audio buffers as events so they can be routed to either
 * on-device processing or the server WebSocket with zero extra copies.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { AudioCaptureModule } = NativeModules;

export interface AudioCaptureConfig {
  sampleRate: number;   // 16000
  channels: number;     // 1
  bufferSize: number;   // samples per callback (e.g. 4096)
}

export interface AudioBufferEvent {
  /** Base64-encoded Float32 PCM samples */
  samples: string;
  /** Number of Float32 samples in this buffer */
  sampleCount: number;
  /** Monotonic timestamp (ms) when buffer was captured */
  timestampMs: number;
}

export interface AudioLevelEvent {
  rms: number;
  peak: number;
}

type AudioCaptureListener = (event: AudioBufferEvent) => void;
type AudioLevelListener = (event: AudioLevelEvent) => void;

class AudioCaptureManager {
  private emitter: NativeEventEmitter | null;
  private bufferListeners: AudioCaptureListener[] = [];
  private levelListeners: AudioLevelListener[] = [];
  private subscription: ReturnType<NativeEventEmitter['addListener']> | null = null;
  private levelSubscription: ReturnType<NativeEventEmitter['addListener']> | null = null;

  constructor() {
    this.emitter = AudioCaptureModule ? new NativeEventEmitter(AudioCaptureModule) : null;
  }

  async requestPermission(): Promise<boolean> {
    return AudioCaptureModule.requestPermission();
  }

  async start(config: AudioCaptureConfig): Promise<void> {
    console.log('[AudioCapture] start() called, current listeners:', {
      bufferListeners: this.bufferListeners.length,
      levelListeners: this.levelListeners.length,
      hasSubscription: !!this.subscription,
    });

    // Clean up any existing subscriptions first
    if (this.subscription) {
      console.log('[AudioCapture] Cleaning up existing subscription');
      this.subscription.remove();
      this.subscription = null;
    }
    if (this.levelSubscription) {
      console.log('[AudioCapture] Cleaning up existing level subscription');
      this.levelSubscription.remove();
      this.levelSubscription = null;
    }

    this.subscription = this.emitter?.addListener(
      'onAudioBuffer',
      (event: AudioBufferEvent) => {
        console.log(`[AudioCapture] Native event received, dispatching to ${this.bufferListeners.length} listeners`);
        for (const listener of this.bufferListeners) {
          listener(event);
        }
      },
    ) ?? null;

    this.levelSubscription = this.emitter?.addListener(
      'onAudioLevel',
      (event: AudioLevelEvent) => {
        for (const listener of this.levelListeners) {
          listener(event);
        }
      },
    ) ?? null;

    await AudioCaptureModule.start(config);
    console.log('[AudioCapture] Native module started successfully');
  }

  async stop(): Promise<void> {
    await AudioCaptureModule.stop();
    this.subscription?.remove();
    this.levelSubscription?.remove();
    this.subscription = null;
    this.levelSubscription = null;
  }

  onAudioBuffer(listener: AudioCaptureListener): () => void {
    this.bufferListeners.push(listener);
    return () => {
      this.bufferListeners = this.bufferListeners.filter(l => l !== listener);
    };
  }

  onAudioLevel(listener: AudioLevelListener): () => void {
    this.levelListeners.push(listener);
    return () => {
      this.levelListeners = this.levelListeners.filter(l => l !== listener);
    };
  }

  /** Decode base64 audio buffer into Float32Array */
  static decodeBuffer(base64: string): Float32Array {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Float32Array(bytes.buffer);
  }
}

export const audioCapture = new AudioCaptureManager();
