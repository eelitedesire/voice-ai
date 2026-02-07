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
  speaker?: string;          // name from dropdown (for role=speaker)
  text: string;
  timestamp: number;
  kind?: 'message' | 'analysis-summary';  // distinguishes regular chat from analysis posts
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
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

// Streaming transcription types

/** Messages sent from server to client over WebSocket */
export type StreamingServerMessage =
  | { type: 'partial'; text: string; timestamp: number }
  | { type: 'final'; text: string; speaker: string; timestamp: number }
  | { type: 'vad'; isSpeaking: boolean; timestamp: number }
  | { type: 'ready' }
  | { type: 'error'; message: string };

/** Messages sent from client to server over WebSocket */
export type StreamingClientMessage =
  | { type: 'config'; sampleRate: number }
  | { type: 'stop' };
