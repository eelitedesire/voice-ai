/**
 * APIService — REST client for the voice-ai server.
 *
 * Handles all non-streaming communication: analysis, chat, enrollment,
 * memory management, and RAG queries.
 */

import { API_ENDPOINTS } from '../config/api';
import {
  TherapeuticAnalysis,
  ChatMessage,
  TranscriptEntry,
  SpeakerProfile,
  SpeakerDatabase,
  MemoryFact,
  MemoryDatabase,
} from '../types';

export class APIService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  // --- Session analysis ---

  async analyzeSession(
    transcript: TranscriptEntry[],
    coupleId?: string,
  ): Promise<TherapeuticAnalysis> {
    const res = await this.post(API_ENDPOINTS.analyze, { transcript, coupleId });
    return res as TherapeuticAnalysis;
  }

  // --- RAG pipeline ---

  async runRAGPipeline(
    transcript: TranscriptEntry[],
    coupleId: string,
  ): Promise<unknown> {
    return this.post(API_ENDPOINTS.rag, { transcript, coupleId });
  }

  // --- Therapist chat ---

  async sendChatMessage(
    message: string,
    transcript: TranscriptEntry[],
    chatHistory: ChatMessage[],
    speakerName?: string,
    coupleId?: string,
  ): Promise<string> {
    const res = await this.post(API_ENDPOINTS.therapistChat, {
      message,
      transcript,
      chatHistory,
      speakerName,
      coupleId,
    });
    return (res as { response: string }).response;
  }

  // --- Speaker management ---

  async getSpeakers(): Promise<SpeakerProfile[]> {
    const res = await this.get(API_ENDPOINTS.speakers);
    return (res as SpeakerDatabase).speakers || [];
  }

  async enrollSpeaker(
    name: string,
    role: string,
    audioBase64: string,
  ): Promise<SpeakerProfile> {
    const res = await this.post(API_ENDPOINTS.enroll, {
      name,
      role,
      audio: audioBase64,
    });
    return res as SpeakerProfile;
  }

  // --- Memory ---

  async getMemories(speakerId: string): Promise<MemoryFact[]> {
    const res = await this.get(`${API_ENDPOINTS.memory}?speakerId=${speakerId}`);
    return (res as { facts: MemoryFact[] }).facts || [];
  }

  async extractMemories(
    transcript: TranscriptEntry[],
  ): Promise<MemoryFact[]> {
    const res = await this.post(API_ENDPOINTS.memoryExtract, { transcript });
    return (res as { facts: MemoryFact[] }).facts || [];
  }

  // --- Clinical KB ---

  async searchClinicalKB(query: string): Promise<unknown> {
    return this.get(`${API_ENDPOINTS.clinicalKb}?q=${encodeURIComponent(query)}`);
  }

  // --- Batch transcription (fallback when on-device unavailable) ---

  async transcribeAudio(audioBase64: string): Promise<TranscriptEntry[]> {
    const res = await this.post(API_ENDPOINTS.transcribe, {
      audio: audioBase64,
    });
    return (res as { transcript: TranscriptEntry[] }).transcript || [];
  }

  // --- HTTP helpers ---

  private async get(endpoint: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  private async post(endpoint: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }
}
