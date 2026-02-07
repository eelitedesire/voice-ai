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
