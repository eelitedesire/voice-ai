// Shared types — aligned with the web app's types/index.ts

export interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: number;
}

export interface Session {
  id: string;
  transcript: TranscriptEntry[];
  startTime: number;
  endTime?: number;
  coupleId?: string;
}

export interface TherapeuticAnalysis {
  summary: string;
  mood: string;
  keyBreakthroughs: string[];
  homework: string;
  concerns?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'speaker' | 'therapist';
  speaker?: string;
  text: string;
  timestamp: number;
  kind?: 'message' | 'analysis-summary';
}

export interface SpeakerProfile {
  id: string;
  name: string;
  role: string;
  voiceprint: number[];
}

export interface SpeakerDatabase {
  speakers: SpeakerProfile[];
  modelVersion: string;
  createdAt: number;
}

export interface MemoryFact {
  id: string;
  content: string;
  category:
    | 'personal'
    | 'relationship'
    | 'emotional'
    | 'goal'
    | 'preference'
    | 'history'
    | 'other';
  extractedAt: number;
}

export interface SpeakerMemory {
  facts: MemoryFact[];
  updatedAt: number;
}

export interface MemoryDatabase {
  speakers: Record<string, SpeakerMemory>;
}

// Streaming protocol — matches server WebSocket messages

export type StreamingServerMessage =
  | { type: 'partial'; text: string; timestamp: number }
  | { type: 'final'; text: string; speaker: string; timestamp: number }
  | { type: 'vad'; isSpeaking: boolean; timestamp: number }
  | { type: 'ready' }
  | { type: 'error'; message: string };

export type StreamingClientMessage =
  | { type: 'config'; sampleRate: number }
  | { type: 'stop' };

// Mobile-specific types

export type ProcessingMode = 'on-device' | 'server' | 'hybrid';

export interface AppSettings {
  serverUrl: string;
  processingMode: ProcessingMode;
  sampleRate: number;
  enableVAD: boolean;
  vadSensitivity: number; // 0.0 - 1.0
  enableSpeakerIdentification: boolean;
  keepScreenAwake: boolean;
  hapticFeedback: boolean;
}

export interface ModelStatus {
  asr: 'not-downloaded' | 'downloading' | 'ready' | 'error';
  vad: 'not-downloaded' | 'downloading' | 'ready' | 'error';
  speaker: 'not-downloaded' | 'downloading' | 'ready' | 'error';
}

export interface AudioLevel {
  rms: number;
  peak: number;
  isSpeaking: boolean;
}

export interface OnDeviceTranscriptionResult {
  text: string;
  isFinal: boolean;
  speaker?: string;
  confidence: number;
  timestamp: number;
  processedOnDevice: boolean;
}
