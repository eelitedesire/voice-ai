export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async initialize(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
        }
      });

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };
    } catch (error) {
      console.error('Failed to initialize audio recorder:', error);
      throw new Error('Microphone access denied or unavailable');
    }
  }

  start(): void {
    if (!this.mediaRecorder) {
      throw new Error('Recorder not initialized');
    }

    this.audioChunks = [];
    this.mediaRecorder.start(100); // Capture in 100ms chunks
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('Recorder not initialized'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        resolve(audioBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  getAudioStream(): MediaStream | null {
    return this.stream;
  }

  cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
  }
}

export function convertBlobToWav(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to ArrayBuffer'));
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

import { SpeakerMatchInfo } from '@/types';
import {
  liveCaptureConstraints,
  verifyConstraints,
  formatReadback,
} from '@/lib/audio-constraints';

export type StreamingAudioEvent =
  | { type: 'transcript_partial'; text: string; timestamp: number }
  | { type: 'transcript_final'; text: string; speaker: string; timestamp: number; speakerInfo?: SpeakerMatchInfo }
  | { type: 'vad'; isSpeaking: boolean }
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'error'; message: string };

/**
 * Streaming audio capture that sends raw PCM to a WebSocket for real-time
 * transcription. Uses AudioWorklet for low-latency capture and downsampling.
 *
 * Flow:
 *   mic → AudioWorklet (downsample to 16kHz) → WebSocket → server ASR
 *   server → WebSocket → partial/final transcript events → callback
 */
export class StreamingAudioCapture {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private ws: WebSocket | null = null;
  private onEvent: ((event: StreamingAudioEvent) => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private isActive = false;
  private isPreInitialized = false;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private isServerReady = false;
  private readyResolve: (() => void) | null = null;

  constructor(onEvent: (event: StreamingAudioEvent) => void) {
    this.onEvent = onEvent;
  }

  /**
   * Pre-initialize audio system (mic + worklet) to eliminate delay.
   * WebSocket connection is deferred until startRecording().
   */
  async preInitialize(): Promise<void> {
    if (this.isPreInitialized) return;

    try {
      this.audioContext = new AudioContext({
        sampleRate: 48000,
        latencyHint: 'interactive',
      });

      const liveConstraints = liveCaptureConstraints();
      const [mediaStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: liveConstraints }),
        this.audioContext.audioWorklet.addModule('/audio-worklet-processor.js'),
        this.audioContext.resume().catch(() => {}),
      ]);

      this.mediaStream = mediaStream;

      const track = mediaStream.getAudioTracks()[0];
      if (track) {
        const readback = verifyConstraints(track, liveConstraints);
        console.log('[LiveCapture] Pre-init readback —', formatReadback(readback));
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');

      this.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio' && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(event.data.samples);
        }
      };

      this.isPreInitialized = true;
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  /**
   * Start recording immediately (assumes preInitialize was called).
   */
  async startRecording(): Promise<void> {
    try {
      if (!this.isPreInitialized) {
        await this.preInitialize();
      }

      await this.connectWebSocket();
      
      // Wait for server to be ready before starting audio
      await this.waitForServerReady();

      if (this.sourceNode && this.workletNode) {
        this.sourceNode.connect(this.workletNode);
      }

      this.isActive = true;
      this.reconnectAttempts = 0;
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  private async waitForServerReady(): Promise<void> {
    if (this.isServerReady) return;
    console.log('[StreamingCapture] Waiting for server ready...');
    const startTime = Date.now();
    return new Promise((resolve) => {
      this.readyResolve = () => {
        const elapsed = Date.now() - startTime;
        console.log(`[StreamingCapture] Server ready in ${elapsed}ms`);
        resolve();
      };
      // Timeout after 5 seconds
      setTimeout(() => {
        if (!this.isServerReady) {
          console.warn('[StreamingCapture] Server ready timeout');
          resolve();
        }
      }, 5000);
    });
  }

  async start(): Promise<void> {
    await this.startRecording();
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/transcribe`;

      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        // Don't send config yet - wait for server ready signal
        this.onEvent?.({ type: 'connected' });
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'ready':
              // Server is ready to accept audio
              this.isServerReady = true;
              if (this.readyResolve) {
                this.readyResolve();
                this.readyResolve = null;
              }
              // Now send config
              if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'config', sampleRate: 16000 }));
              }
              break;
            case 'ready':
              // Server ready during reconnect
              this.isServerReady = true;
              break;
            case 'partial':
              this.onEvent?.({
                type: 'transcript_partial',
                text: msg.text,
                timestamp: msg.timestamp,
              });
              break;
            case 'final':
              this.onEvent?.({
                type: 'transcript_final',
                text: msg.text,
                speaker: msg.speaker,
                timestamp: msg.timestamp,
                speakerInfo: msg.speakerInfo,
              });
              break;
            case 'vad':
              this.onEvent?.({
                type: 'vad',
                isSpeaking: msg.isSpeaking,
              });
              break;
            case 'error':
              this.onEvent?.({ type: 'error', message: msg.message });
              break;
          }
        } catch {
          // ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        this.isServerReady = false;
        this.onEvent?.({ type: 'disconnected' });
        if (this.isActive && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.pow(2, this.reconnectAttempts) * 1000;
          setTimeout(() => {
            if (this.isActive) {
              this.connectWebSocket().catch(() => {});
            }
          }, delay);
        }
      };

      this.ws.onerror = () => {
        this.onEvent?.({ type: 'error', message: 'WebSocket connection failed' });
        reject(new Error('WebSocket connection failed'));
      };
    });
  }

  /**
   * Stop recording and tell server to finalize any pending transcription.
   */
  stopRecording(): void {
    this.isActive = false;

    if (this.sourceNode && this.workletNode) {
      this.sourceNode.disconnect(this.workletNode);
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
      this.ws.close();
    }
    this.ws = null;
  }

  /**
   * Stop streaming and tell server to finalize any pending transcription.
   */
  stop(): void {
    this.stopRecording();
    this.cleanup();
  }

  cleanup(): void {
    this.isActive = false;
    this.isPreInitialized = false;
    this.isServerReady = false;
    this.readyResolve = null;

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}
