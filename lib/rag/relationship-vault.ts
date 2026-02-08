/**
 * Relationship Vault — Privacy-First Encrypted Session Storage
 *
 * Stores summarized session notes, emotional trends, and recurring triggers
 * for each couple. All data is encrypted at rest using AES-256-GCM.
 *
 * The vault provides the AI with the specific "who" and "what" of the couple
 * while keeping raw transcripts ephemeral (never persisted).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  EncryptedPayload,
  RelationshipVaultData,
  SessionRecord,
  TriggerEntry,
  EmotionalTrend,
  EmotionalTone,
} from './types';

const VAULT_DIR = path.join(process.cwd(), '.vault');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const ENCRYPTION_VERSION = 1;

// ─── Key Management ──────────────────────────────────────────────────

/**
 * Derives an encryption key from the couple ID and an optional secret.
 * In production, the secret should come from an environment variable or KMS.
 */
function deriveKey(coupleId: string): Buffer {
  const secret = process.env.VAULT_SECRET || 'voice-ai-vault-dev-key';
  return crypto.pbkdf2Sync(secret, coupleId, 100_000, KEY_LENGTH, 'sha512');
}

// ─── Encryption / Decryption ─────────────────────────────────────────

function encrypt(data: string, coupleId: string): EncryptedPayload {
  const key = deriveKey(coupleId);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(data, 'utf8', 'base64');
  ciphertext += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  return {
    version: ENCRYPTION_VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext,
    createdAt: Date.now(),
  };
}

function decrypt(payload: EncryptedPayload, coupleId: string): string {
  const key = deriveKey(coupleId);
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(payload.ciphertext, 'base64', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

// ─── File I/O ────────────────────────────────────────────────────────

function vaultPath(coupleId: string): string {
  // Sanitize coupleId for filesystem safety
  const safe = coupleId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(VAULT_DIR, `${safe}.vault.json`);
}

function ensureVaultDir(): void {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
  }
}

function readVault(coupleId: string): RelationshipVaultData {
  const filePath = vaultPath(coupleId);
  if (!fs.existsSync(filePath)) {
    return createEmptyVault(coupleId);
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const payload: EncryptedPayload = JSON.parse(raw);
    const decrypted = decrypt(payload, coupleId);
    return JSON.parse(decrypted) as RelationshipVaultData;
  } catch (err) {
    console.error(`[Vault] Failed to read vault for ${coupleId}:`, err);
    return createEmptyVault(coupleId);
  }
}

function writeVault(coupleId: string, data: RelationshipVaultData): void {
  ensureVaultDir();
  data.updatedAt = Date.now();
  const json = JSON.stringify(data);
  const payload = encrypt(json, coupleId);
  fs.writeFileSync(vaultPath(coupleId), JSON.stringify(payload, null, 2), 'utf-8');
}

function createEmptyVault(coupleId: string): RelationshipVaultData {
  return {
    coupleId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessions: [],
    triggers: [],
    emotionalTrends: {},
  };
}

// ─── Public API ──────────────────────────────────────────────────────

/** Get the full vault data for a couple. */
export function getVault(coupleId: string): RelationshipVaultData {
  return readVault(coupleId);
}

/** Store a new session record in the vault. */
export function addSessionRecord(coupleId: string, session: SessionRecord): void {
  const vault = readVault(coupleId);

  // Prevent duplicate session IDs
  if (vault.sessions.some(s => s.id === session.id)) {
    console.warn(`[Vault] Session ${session.id} already exists, skipping`);
    return;
  }

  vault.sessions.push(session);

  // Merge triggers from this session into global trigger list
  mergeTriggers(vault, session.triggers);

  // Update emotional trends for each speaker
  for (const [speaker, snapshot] of Object.entries(session.speakerDynamics)) {
    updateEmotionalTrend(vault, speaker, session.date, session.emotionalTone);
  }

  writeVault(coupleId, vault);
}

/** Get recent session summaries (most recent first). */
export function getRecentSessions(coupleId: string, limit = 5): SessionRecord[] {
  const vault = readVault(coupleId);
  return vault.sessions
    .sort((a, b) => b.date - a.date)
    .slice(0, limit);
}

/** Get all triggers sorted by frequency (most recurring first). */
export function getRecurringTriggers(coupleId: string): TriggerEntry[] {
  const vault = readVault(coupleId);
  return vault.triggers.sort((a, b) => b.frequency - a.frequency);
}

/** Get emotional trends for all speakers. */
export function getEmotionalTrends(coupleId: string): Record<string, EmotionalTrend> {
  const vault = readVault(coupleId);
  return vault.emotionalTrends;
}

/** Search sessions by keyword in summaries and conflict patterns. */
export function searchSessions(coupleId: string, query: string): SessionRecord[] {
  const vault = readVault(coupleId);
  const lower = query.toLowerCase();

  return vault.sessions.filter(session => {
    const inSummary = session.summary.toLowerCase().includes(lower);
    const inPatterns = session.conflictPatterns.some(p => p.toLowerCase().includes(lower));
    const inTriggers = session.triggers.some(t => t.description.toLowerCase().includes(lower));
    const inBreakthroughs = session.breakthroughs.some(b => b.toLowerCase().includes(lower));
    return inSummary || inPatterns || inTriggers || inBreakthroughs;
  });
}

/** Delete the entire vault for a couple (right to erasure). */
export function deleteVault(coupleId: string): boolean {
  const filePath = vaultPath(coupleId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/** Get session count for a couple. */
export function getSessionCount(coupleId: string): number {
  const vault = readVault(coupleId);
  return vault.sessions.length;
}

/**
 * Format vault context for LLM injection.
 * Returns a condensed summary suitable for the system prompt.
 */
export function formatVaultContext(coupleId: string): string {
  const vault = readVault(coupleId);
  if (vault.sessions.length === 0) {
    return '';
  }

  const parts: string[] = [];
  parts.push(`\n--- Relationship History (${vault.sessions.length} session(s) on record) ---`);

  // Recent sessions
  const recent = vault.sessions.sort((a, b) => b.date - a.date).slice(0, 3);
  if (recent.length > 0) {
    parts.push('\nRecent sessions:');
    for (const session of recent) {
      const date = new Date(session.date).toLocaleDateString();
      parts.push(`  [${date}] ${session.summary}`);
      if (session.conflictPatterns.length > 0) {
        parts.push(`    Patterns: ${session.conflictPatterns.join(', ')}`);
      }
      if (session.breakthroughs.length > 0) {
        parts.push(`    Breakthroughs: ${session.breakthroughs.join(', ')}`);
      }
    }
  }

  // Recurring triggers
  const topTriggers = vault.triggers
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5);
  if (topTriggers.length > 0) {
    parts.push('\nRecurring triggers:');
    for (const t of topTriggers) {
      parts.push(`  - ${t.description} (${t.category}, seen ${t.frequency}x)`);
    }
  }

  // Emotional trends
  const trendEntries = Object.entries(vault.emotionalTrends);
  if (trendEntries.length > 0) {
    parts.push('\nEmotional trends:');
    for (const [speaker, trend] of trendEntries) {
      const recentTones = trend.sessions.slice(-3).map(s => s.tone.primary).join(' -> ');
      parts.push(`  ${speaker}: ${trend.overallTrajectory} (recent: ${recentTones})`);
    }
  }

  parts.push('--- End Relationship History ---\n');
  return parts.join('\n');
}

// ─── Internal Helpers ────────────────────────────────────────────────

function mergeTriggers(vault: RelationshipVaultData, sessionTriggers: TriggerEntry[]): void {
  for (const incoming of sessionTriggers) {
    const existing = vault.triggers.find(
      t => t.description.toLowerCase() === incoming.description.toLowerCase()
        || t.category === incoming.category && similarity(t.description, incoming.description) > 0.7
    );

    if (existing) {
      existing.frequency += 1;
      existing.lastSeen = incoming.lastSeen;
      // Merge associated speakers
      for (const speaker of incoming.associatedSpeakers) {
        if (!existing.associatedSpeakers.includes(speaker)) {
          existing.associatedSpeakers.push(speaker);
        }
      }
    } else {
      vault.triggers.push({ ...incoming, frequency: 1 });
    }
  }
}

function updateEmotionalTrend(
  vault: RelationshipVaultData,
  speaker: string,
  date: number,
  tone: EmotionalTone,
): void {
  if (!vault.emotionalTrends[speaker]) {
    vault.emotionalTrends[speaker] = {
      speakerName: speaker,
      sessions: [],
      overallTrajectory: 'stable',
    };
  }

  const trend = vault.emotionalTrends[speaker];
  trend.sessions.push({ date, tone });

  // Compute trajectory from recent sessions
  const recent = trend.sessions.slice(-5);
  if (recent.length >= 2) {
    const intensities = recent.map(s => s.tone.intensity);
    const avgFirst = intensities.slice(0, Math.ceil(intensities.length / 2))
      .reduce((a, b) => a + b, 0) / Math.ceil(intensities.length / 2);
    const avgSecond = intensities.slice(Math.ceil(intensities.length / 2))
      .reduce((a, b) => a + b, 0) / (intensities.length - Math.ceil(intensities.length / 2));

    const trajectories = recent.map(s => s.tone.trajectory);
    const volatileCount = trajectories.filter(t => t === 'volatile' || t === 'escalating').length;

    if (volatileCount > recent.length / 2) {
      trend.overallTrajectory = 'fluctuating';
    } else if (avgSecond < avgFirst - 1) {
      trend.overallTrajectory = 'improving';
    } else if (avgSecond > avgFirst + 1) {
      trend.overallTrajectory = 'declining';
    } else {
      trend.overallTrajectory = 'stable';
    }
  }
}

/** Simple word-overlap similarity for trigger deduplication. */
function similarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.length / union.size : 0;
}
