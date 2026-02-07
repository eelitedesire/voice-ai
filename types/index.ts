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
