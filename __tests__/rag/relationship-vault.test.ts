/**
 * Tests for the Relationship Vault
 *
 * Tests encrypted storage, retrieval, trigger merging, and emotional trends.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getVault,
  addSessionRecord,
  getRecentSessions,
  getRecurringTriggers,
  getEmotionalTrends,
  searchSessions,
  deleteVault,
  getSessionCount,
  formatVaultContext,
} from '../../lib/rag/relationship-vault';
import { SessionRecord, TriggerEntry, EmotionalTone } from '../../lib/rag/types';

const TEST_COUPLE_ID = '__test_couple_vault__';
const VAULT_DIR = path.join(process.cwd(), '.vault');
const VAULT_FILE = path.join(VAULT_DIR, `${TEST_COUPLE_ID}.vault.json`);

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    coupleId: TEST_COUPLE_ID,
    date: Date.now(),
    summary: 'Test session about communication issues',
    emotionalTone: {
      primary: 'frustrated',
      intensity: 6,
      trajectory: 'de-escalating',
    },
    triggers: [],
    conflictPatterns: ['blame-deflect cycle'],
    breakthroughs: ['acknowledged own role'],
    speakerDynamics: {
      Alice: {
        emotionalState: 'upset',
        engagementLevel: 'high',
        defensiveness: 'moderate',
        keyStatements: ['I feel unheard'],
      },
      Bob: {
        emotionalState: 'withdrawn',
        engagementLevel: 'low',
        defensiveness: 'high',
        keyStatements: ['Fine, whatever'],
      },
    },
    ...overrides,
  };
}

function makeTrigger(overrides: Partial<TriggerEntry> = {}): TriggerEntry {
  return {
    id: `trigger-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: 'Money arguments',
    category: 'financial',
    frequency: 1,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    associatedSpeakers: ['Alice'],
    ...overrides,
  };
}

describe('Relationship Vault', () => {
  afterEach(() => {
    // Clean up test vault
    deleteVault(TEST_COUPLE_ID);
  });

  describe('getVault', () => {
    it('should return empty vault for new couple', () => {
      const vault = getVault(TEST_COUPLE_ID);
      expect(vault.coupleId).toBe(TEST_COUPLE_ID);
      expect(vault.sessions).toHaveLength(0);
      expect(vault.triggers).toHaveLength(0);
    });
  });

  describe('addSessionRecord', () => {
    it('should store and encrypt a session record', () => {
      const session = makeSession();
      addSessionRecord(TEST_COUPLE_ID, session);

      // Verify the file exists and is encrypted
      expect(fs.existsSync(VAULT_FILE)).toBe(true);
      const fileContent = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8'));
      expect(fileContent.algorithm).toBe('aes-256-gcm');
      expect(fileContent.ciphertext).toBeDefined();
      expect(fileContent.iv).toBeDefined();
      expect(fileContent.authTag).toBeDefined();

      // Verify we can decrypt and read back
      const vault = getVault(TEST_COUPLE_ID);
      expect(vault.sessions).toHaveLength(1);
      expect(vault.sessions[0].summary).toBe(session.summary);
    });

    it('should prevent duplicate session IDs', () => {
      const session = makeSession({ id: 'unique-id' });
      addSessionRecord(TEST_COUPLE_ID, session);
      addSessionRecord(TEST_COUPLE_ID, session); // Same ID

      const vault = getVault(TEST_COUPLE_ID);
      expect(vault.sessions).toHaveLength(1);
    });

    it('should merge triggers across sessions', () => {
      const trigger = makeTrigger({ description: 'Spending habits' });

      const session1 = makeSession({ triggers: [trigger] });
      addSessionRecord(TEST_COUPLE_ID, session1);

      const trigger2 = makeTrigger({ description: 'Spending habits' });
      const session2 = makeSession({ triggers: [trigger2] });
      addSessionRecord(TEST_COUPLE_ID, session2);

      const triggers = getRecurringTriggers(TEST_COUPLE_ID);
      // Should be merged into one trigger with frequency 2
      const spending = triggers.find(t => t.description === 'Spending habits');
      expect(spending).toBeDefined();
      expect(spending!.frequency).toBe(2);
    });

    it('should update emotional trends', () => {
      const session1 = makeSession({
        speakerDynamics: {
          Alice: {
            emotionalState: 'angry',
            engagementLevel: 'high',
            defensiveness: 'high',
            keyStatements: [],
          },
        },
        emotionalTone: { primary: 'angry', intensity: 8, trajectory: 'escalating' },
      });
      addSessionRecord(TEST_COUPLE_ID, session1);

      const trends = getEmotionalTrends(TEST_COUPLE_ID);
      expect(trends['Alice']).toBeDefined();
      expect(trends['Alice'].sessions).toHaveLength(1);
    });
  });

  describe('getRecentSessions', () => {
    it('should return sessions sorted by date (most recent first)', () => {
      const old = makeSession({ date: Date.now() - 100000 });
      const recent = makeSession({ date: Date.now() });

      addSessionRecord(TEST_COUPLE_ID, old);
      addSessionRecord(TEST_COUPLE_ID, recent);

      const sessions = getRecentSessions(TEST_COUPLE_ID, 2);
      expect(sessions).toHaveLength(2);
      expect(sessions[0].date).toBeGreaterThan(sessions[1].date);
    });

    it('should respect the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        addSessionRecord(TEST_COUPLE_ID, makeSession());
      }

      const sessions = getRecentSessions(TEST_COUPLE_ID, 3);
      expect(sessions).toHaveLength(3);
    });
  });

  describe('searchSessions', () => {
    it('should find sessions by keyword in summary', () => {
      addSessionRecord(TEST_COUPLE_ID, makeSession({
        summary: 'Discussion about financial stress and budgeting',
      }));
      addSessionRecord(TEST_COUPLE_ID, makeSession({
        summary: 'Talked about parenting disagreements',
      }));

      const results = searchSessions(TEST_COUPLE_ID, 'financial');
      expect(results).toHaveLength(1);
      expect(results[0].summary).toContain('financial');
    });

    it('should find sessions by conflict patterns', () => {
      addSessionRecord(TEST_COUPLE_ID, makeSession({
        conflictPatterns: ['stonewalling', 'criticism'],
      }));

      const results = searchSessions(TEST_COUPLE_ID, 'stonewalling');
      expect(results).toHaveLength(1);
    });
  });

  describe('deleteVault', () => {
    it('should delete the vault file', () => {
      addSessionRecord(TEST_COUPLE_ID, makeSession());
      expect(fs.existsSync(VAULT_FILE)).toBe(true);

      const deleted = deleteVault(TEST_COUPLE_ID);
      expect(deleted).toBe(true);
      expect(fs.existsSync(VAULT_FILE)).toBe(false);
    });

    it('should return false for non-existent vault', () => {
      const deleted = deleteVault('nonexistent-couple');
      expect(deleted).toBe(false);
    });
  });

  describe('formatVaultContext', () => {
    it('should return empty string for empty vault', () => {
      const context = formatVaultContext(TEST_COUPLE_ID);
      expect(context).toBe('');
    });

    it('should return formatted summary for populated vault', () => {
      addSessionRecord(TEST_COUPLE_ID, makeSession({
        summary: 'Discussed household chores division',
        triggers: [makeTrigger({ description: 'Chore imbalance' })],
      }));

      const context = formatVaultContext(TEST_COUPLE_ID);
      expect(context).toContain('Relationship History');
      expect(context).toContain('Discussed household chores division');
      expect(context).toContain('Chore imbalance');
    });
  });

  describe('getSessionCount', () => {
    it('should return 0 for new couple', () => {
      expect(getSessionCount(TEST_COUPLE_ID)).toBe(0);
    });

    it('should return correct count', () => {
      addSessionRecord(TEST_COUPLE_ID, makeSession());
      addSessionRecord(TEST_COUPLE_ID, makeSession());
      expect(getSessionCount(TEST_COUPLE_ID)).toBe(2);
    });
  });

  describe('encryption', () => {
    it('should not store plaintext data in the vault file', () => {
      addSessionRecord(TEST_COUPLE_ID, makeSession({
        summary: 'SENSITIVE_THERAPY_DATA_12345',
      }));

      const rawFile = fs.readFileSync(VAULT_FILE, 'utf-8');
      // The plaintext summary should NOT appear in the encrypted file
      expect(rawFile).not.toContain('SENSITIVE_THERAPY_DATA_12345');
    });
  });
});
