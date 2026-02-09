/**
 * StreamingService — WebSocket client for server-side transcription.
 *
 * Used in 'server' or 'hybrid' processing modes when on-device models
 * aren't available or when the user wants server-side processing.
 *
 * Protocol matches the web app: binary Float32 PCM over WebSocket.
 */

import { audioCapture, AudioBufferEvent } from '../native/AudioCapture';
import { AUDIO_CONFIG, WS_ENDPOINTS } from '../config/api';
import {
  StreamingServerMessage,
  TranscriptEntry,
  OnDeviceTranscriptionResult,
} from '../types';

type MessageCallback = (msg: StreamingServerMessage) => void;
type StatusCallback = (status: ConnectionStatus) => void;

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export class StreamingService {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private messageCallbacks: MessageCallback[] = [];
  private statusCallbacks: StatusCallback[] = [];
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private unsubscribeAudio: (() => void) | null = null;
  private transcript: TranscriptEntry[] = [];

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.setStatus('connecting');

    return new Promise((resolve, reject) => {
      const wsUrl = `${this.serverUrl}${WS_ENDPOINTS.streamingTranscribe}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.setStatus('connected');
        this.reconnectAttempts = 0;

        // Send config
        this.ws!.send(
          JSON.stringify({
            type: 'config',
            sampleRate: AUDIO_CONFIG.sampleRate,
          }),
        );

        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: StreamingServerMessage = JSON.parse(event.data as string);
          this.handleMessage(msg);
        } catch {
          // Binary response or malformed JSON — ignore
        }
      };

      this.ws.onerror = () => {
        this.setStatus('error');
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        this.setStatus('disconnected');
        this.attemptReconnect();
      };
    });
  }

  async startStreaming(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const hasPermission = await audioCapture.requestPermission();
    if (!hasPermission) {
      throw new Error('Microphone permission denied');
    }

    // Forward audio buffers to server
    this.unsubscribeAudio = audioCapture.onAudioBuffer(
      (event: AudioBufferEvent) => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          // Decode base64 to binary and send
          const samples = audioCapture.constructor.prototype.constructor
            ? event.samples
            : event.samples;
          const binary = globalThis.atob(samples);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          this.ws.send(bytes.buffer);
        }
      },
    );

    await audioCapture.start({
      sampleRate: AUDIO_CONFIG.sampleRate,
      channels: AUDIO_CONFIG.channels,
      bufferSize: AUDIO_CONFIG.bufferSize,
    });
  }

  async stopStreaming(): Promise<TranscriptEntry[]> {
    // Stop audio capture
    await audioCapture.stop();
    this.unsubscribeAudio?.();
    this.unsubscribeAudio = null;

    // Tell server we're done
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
    }

    return [...this.transcript];
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
  }

  private handleMessage(msg: StreamingServerMessage): void {
    if (msg.type === 'final') {
      this.transcript.push({
        speaker: msg.speaker,
        text: msg.text,
        timestamp: msg.timestamp,
      });
    }

    for (const cb of this.messageCallbacks) {
      cb(msg);
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16000);

    setTimeout(() => {
      if (this.status === 'disconnected') {
        this.connect().catch(() => {});
      }
    }, delay);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const cb of this.statusCallbacks) {
      cb(status);
    }
  }

  onMessage(callback: MessageCallback): () => void {
    this.messageCallbacks.push(callback);
    return () => {
      this.messageCallbacks = this.messageCallbacks.filter(cb => cb !== callback);
    };
  }

  onStatusChange(callback: StatusCallback): () => void {
    this.statusCallbacks.push(callback);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter(cb => cb !== callback);
    };
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getTranscript(): TranscriptEntry[] {
    return [...this.transcript];
  }

  clearTranscript(): void {
    this.transcript = [];
  }
}
