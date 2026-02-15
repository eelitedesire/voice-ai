/**
 * StorageService — Fast on-device storage using MMKV.
 *
 * MMKV is a key-value store backed by memory-mapped files.
 * It's ~30x faster than AsyncStorage and works synchronously,
 * making it suitable for real-time audio pipeline state.
 *
 * Used for:
 *   - App settings
 *   - Enrolled speaker voiceprints (cached locally)
 *   - Session history
 *   - Offline transcript queue
 */

import { MMKV } from 'react-native-mmkv';
import {
  AppSettings,
  SpeakerProfile,
  TranscriptEntry,
  Session,
  TherapeuticAnalysis,
  ProcessingMode,
} from '../types';
import { DEFAULT_SERVER_URL } from '../config/api';

const storage = new MMKV();

// --- Keys ---
const KEYS = {
  settings: 'app_settings',
  speakers: 'speaker_profiles',
  sessions: 'session_history',
  offlineQueue: 'offline_queue',
  modelStatus: 'model_status',
} as const;

// --- Settings ---

const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: DEFAULT_SERVER_URL,
  processingMode: 'hybrid',
  sampleRate: 16000,
  enableVAD: true,
  vadSensitivity: 0.5,
  enableSpeakerIdentification: true,
  keepScreenAwake: true,
  hapticFeedback: true,
};

export function getSettings(): AppSettings {
  const raw = storage.getString(KEYS.settings);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Partial<AppSettings>): void {
  const current = getSettings();
  storage.set(KEYS.settings, JSON.stringify({ ...current, ...settings }));
}

// --- Speaker profiles (local cache) ---

export function getSpeakerProfiles(): SpeakerProfile[] {
  const raw = storage.getString(KEYS.speakers);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveSpeakerProfiles(profiles: SpeakerProfile[]): void {
  storage.set(KEYS.speakers, JSON.stringify(profiles));
}

export function addSpeakerProfile(profile: SpeakerProfile): void {
  const profiles = getSpeakerProfiles();
  const existing = profiles.findIndex(p => p.id === profile.id);
  if (existing >= 0) {
    profiles[existing] = profile;
  } else {
    profiles.push(profile);
  }
  saveSpeakerProfiles(profiles);
}

// --- Session history ---

export interface StoredSession {
  session: Session;
  analysis?: TherapeuticAnalysis;
  savedAt: number;
}

export function getSessionHistory(): StoredSession[] {
  const raw = storage.getString(KEYS.sessions);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveSession(
  session: Session,
  analysis?: TherapeuticAnalysis,
): void {
  const history = getSessionHistory();
  history.unshift({
    session,
    analysis,
    savedAt: Date.now(),
  });
  // Keep last 100 sessions
  if (history.length > 100) {
    history.length = 100;
  }
  storage.set(KEYS.sessions, JSON.stringify(history));
}

export function deleteSession(sessionId: string): void {
  const history = getSessionHistory().filter(
    s => s.session.id !== sessionId,
  );
  storage.set(KEYS.sessions, JSON.stringify(history));
}

// --- Offline queue (transcripts waiting to be analyzed) ---

export interface OfflineItem {
  id: string;
  transcript: TranscriptEntry[];
  createdAt: number;
}

export function getOfflineQueue(): OfflineItem[] {
  const raw = storage.getString(KEYS.offlineQueue);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function addToOfflineQueue(transcript: TranscriptEntry[]): string {
  const queue = getOfflineQueue();
  const id = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  queue.push({ id, transcript, createdAt: Date.now() });
  storage.set(KEYS.offlineQueue, JSON.stringify(queue));
  return id;
}

export function removeFromOfflineQueue(id: string): void {
  const queue = getOfflineQueue().filter(item => item.id !== id);
  storage.set(KEYS.offlineQueue, JSON.stringify(queue));
}

export function clearOfflineQueue(): void {
  storage.delete(KEYS.offlineQueue);
}

// --- Utility ---

export function clearAllData(): void {
  storage.clearAll();
}
