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

  constructor(onEvent: (event: StreamingAudioEvent) => void) {
    this.onEvent = onEvent;
  }

  async start(): Promise<void> {
    try {
      // Kick off everything that can run concurrently. The mic permission/open,
      // the AudioContext + worklet module load, and the WebSocket handshake are
      // independent — running them in parallel removes most of the perceived
      // "Start Session" delay (otherwise they stack up serially).
      this.audioContext = new AudioContext({
        sampleRate: 48000,
        latencyHint: 'interactive',
      });

      const micPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const workletPromise = this.audioContext.audioWorklet.addModule(
        '/audio-worklet-processor.js',
      );
      const wsPromise = this.connectWebSocket();
      // Resume in case the context starts suspended (autoplay policy).
      const resumePromise = this.audioContext.resume().catch(() => {});

      const [mediaStream] = await Promise.all([
        micPromise,
        workletPromise,
        wsPromise,
        resumePromise,
      ]);
      this.mediaStream = mediaStream;

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');

      // Forward PCM chunks from worklet to WebSocket as soon as they're ready.
      this.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio' && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(event.data.samples);
        }
      };

      // Wire up audio graph (don't connect to destination — no playback).
      source.connect(this.workletNode);

      this.isActive = true;
      this.reconnectAttempts = 0;
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/transcribe`;

      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        // Send config
        this.ws!.send(JSON.stringify({ type: 'config', sampleRate: 16000 }));
        this.onEvent?.({ type: 'connected' });
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
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
            case 'ready':
              // Engine ready, nothing to do
              break;
          }
        } catch {
          // ignore malformed messages
        }
      };

      this.ws.onclose = () => {
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
   * Stop streaming and tell server to finalize any pending transcription.
   */
  stop(): void {
    this.isActive = false;

    // Tell server to finalize
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
    }

    this.cleanup();
  }

  private cleanup(): void {
    this.isActive = false;

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
      this.ws.close();
      this.ws = null;
    }
  }
}
