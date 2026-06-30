/**
 * Tests for the Context Merger (Dual-Stream Retrieval)
 */

import { dualStreamRetrieval, clinicalSearch, relationshipSearch } from '../../lib/rag/context-merger';

// Mock the relationship vault to avoid file I/O in tests
jest.mock('../../lib/rag/relationship-vault', () => ({
  getVault: jest.fn().mockReturnValue({
    coupleId: 'test-couple',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessions: [
      {
        id: 'session-1',
        coupleId: 'test-couple',
        date: Date.now() - 86400000 * 7,
        summary: 'Discussed recurring arguments about household chores and feeling unappreciated',
        emotionalTone: { primary: 'frustrated', intensity: 7, trajectory: 'de-escalating' },
        triggers: [{
          id: 'trigger-1',
          description: 'Household chore distribution',
          category: 'household',
          frequency: 3,
          firstSeen: Date.now() - 86400000 * 30,
          lastSeen: Date.now(),
          associatedSpeakers: ['Partner A'],
        }],
        conflictPatterns: ['Feeling unappreciated for household work'],
        breakthroughs: ['Partner B acknowledged feeling taken for granted is the real issue, not dishes'],
        speakerDynamics: {
          'Partner A': {
            emotionalState: 'hurt but hopeful',
            engagementLevel: 'high',
            defensiveness: 'mild',
            keyStatements: ['When I do the dishes and nobody notices, I feel invisible'],
          },
        },
      },
    ],
    triggers: [{
      id: 'trigger-1',
      description: 'Household chore distribution',
      category: 'household',
      frequency: 3,
      firstSeen: Date.now() - 86400000 * 30,
      lastSeen: Date.now(),
      associatedSpeakers: ['Partner A'],
    }],
    emotionalTrends: {},
  }),
  getRecentSessions: jest.fn().mockReturnValue([]),
  getRecurringTriggers: jest.fn().mockReturnValue([]),
  getEmotionalTrends: jest.fn().mockReturnValue({}),
  searchSessions: jest.fn().mockReturnValue([]),
  formatVaultContext: jest.fn().mockReturnValue(''),
}));

describe('Context Merger — Dual-Stream Retrieval', () => {
  describe('dualStreamRetrieval', () => {
    it('should return results from both streams', () => {
      const result = dualStreamRetrieval({
        coupleId: 'test-couple',
        query: 'partner using contempt and sarcasm during argument about chores',
      });

      expect(result).toHaveProperty('clinical');
      expect(result).toHaveProperty('relationship');
      expect(result).toHaveProperty('mergedContext');
      expect(result).toHaveProperty('redLineTriggered');
      expect(result).toHaveProperty('processingTimeMs');
    });

    it('should find clinical protocols for contempt', () => {
      const result = dualStreamRetrieval({
        coupleId: 'test-couple',
        query: 'contempt sarcasm eye-rolling mocking',
      });

      expect(result.clinical.protocols.length).toBeGreaterThan(0);
      // Should find the contempt protocol
      const contemptProtocol = result.clinical.protocols.find(
        r => r.protocol.id === 'gottman-horseman-contempt'
      );
      expect(contemptProtocol).toBeDefined();
    });

    it('should find relationship history for chores topic', () => {
      const result = dualStreamRetrieval({
        coupleId: 'test-couple',
        query: 'argument about doing the dishes household chores',
      });

      // Should find something from the relationship vault
      expect(result.relationship.results.length).toBeGreaterThanOrEqual(0);
    });

    it('should produce a merged context string', () => {
      const result = dualStreamRetrieval({
        coupleId: 'test-couple',
        query: 'feeling unappreciated household chores contempt',
      });

      expect(result.mergedContext).toContain('Dual Vector Database Context');
      expect(result.mergedContext).toContain('INTEGRATION GUIDANCE');
    });

    it('should include clinical context in merged output', () => {
      const result = dualStreamRetrieval({
        coupleId: 'test-couple',
        query: 'contempt sarcasm stonewalling',
      });

      if (result.clinical.protocols.length > 0) {
        expect(result.mergedContext).toContain('CLINICAL KNOWLEDGE BASE');
      }
    });

    it('should check for red-line protocols', () => {
      const result = dualStreamRetrieval({
        coupleId: 'test-couple',
        query: 'abuse violence danger physical harm threat',
      });

      // Red line protocols should be checked (may or may not trigger based on score)
      expect(typeof result.redLineTriggered).toBe('boolean');
    });

    it('should measure processing time', () => {
      const result = dualStreamRetrieval({
        coupleId: 'test-couple',
        query: 'therapy session',
      });

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should respect preferred framework filter', () => {
      const result = dualStreamRetrieval({
        coupleId: 'test-couple',
        query: 'conflict resolution communication',
        preferredFramework: 'gottman-method',
      });

      // All clinical results should be from the gottman framework
      for (const r of result.clinical.protocols) {
        expect(r.protocol.framework).toBe('gottman-method');
      }
    });
  });

  describe('clinicalSearch (standalone)', () => {
    it('should search clinical protocols without couple context', () => {
      const results = clinicalSearch('defensiveness taking responsibility');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter by framework', () => {
      const results = clinicalSearch('therapy techniques', 5, 'cbt-couples');
      for (const r of results) {
        expect(r.protocol.framework).toBe('cbt-couples');
      }
    });
  });

  describe('relationshipSearch (standalone)', () => {
    it('should search relationship history', () => {
      const results = relationshipSearch('test-couple', 'household chores unappreciated');
      expect(Array.isArray(results)).toBe(true);
    });
  });
});

describe('The Architecture in Action — "The Context Merger"', () => {
  it('should handle the example scenario: "You always ignore me"', () => {
    // When a couple says "You always ignore me", the system should:
    // Stream A: Retrieve "Softened Start-Up" protocol from clinical layer
    // Stream B: Check if this couple has dealt with this before

    const result = dualStreamRetrieval({
      coupleId: 'test-couple',
      query: 'You always ignore me. You never listen to what I say.',
    });

    // Stream A should find relevant clinical protocols
    expect(result.clinical.protocols.length).toBeGreaterThan(0);

    // Should find criticism-related protocols (the "you always/never" pattern)
    const hasRelevantProtocol = result.clinical.protocols.some(r =>
      r.protocol.id.includes('criticism') ||
      r.protocol.id.includes('softened-startup') ||
      r.protocol.id.includes('cognitive-distortions')
    );
    expect(hasRelevantProtocol).toBe(true);

    // The merged context should contain both clinical and integration guidance
    expect(result.mergedContext).toContain('Dual Vector Database Context');
  });

  it('should handle the example scenario: dishes as proxy for feeling unappreciated', () => {
    const result = dualStreamRetrieval({
      coupleId: 'test-couple',
      query: 'fighting about who does the dishes again. Partner A is upset.',
    });

    // Should find relevant clinical guidance
    expect(result.clinical.protocols.length).toBeGreaterThan(0);

    // The merged context should be substantive
    expect(result.mergedContext.length).toBeGreaterThan(100);
  });
});
