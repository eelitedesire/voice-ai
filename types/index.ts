export interface TranscriptEntry {
  speaker: 'Therapist' | 'Client';
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
  role: 'Therapist' | 'Client';
  voiceprint: number[];
}

export interface SpeakerDatabase {
  speakers: SpeakerProfile[];
  modelVersion: string;
  createdAt: number;
}
