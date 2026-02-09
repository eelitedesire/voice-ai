/**
 * Tests for the Clinical Knowledge Base (Layer 1)
 */

import { ClinicalKnowledgeBase, getClinicalKnowledgeBase } from '../../lib/rag/clinical-knowledge-base';

describe('ClinicalKnowledgeBase', () => {
  let kb: ClinicalKnowledgeBase;

  beforeAll(() => {
    kb = new ClinicalKnowledgeBase();
    kb.initialize();
  });

  describe('Initialization', () => {
    it('should initialize with protocols', () => {
      expect(kb.isInitialized).toBe(true);
      expect(kb.protocolCount).toBeGreaterThan(0);
    });

    it('should not re-initialize on second call', () => {
      const count = kb.protocolCount;
      kb.initialize(); // second call
      expect(kb.protocolCount).toBe(count);
    });
  });

  describe('Protocol Access', () => {
    it('should retrieve a protocol by ID', () => {
      const protocol = kb.getProtocol('gottman-horseman-contempt');
      expect(protocol).toBeDefined();
      expect(protocol!.name).toContain('Contempt');
      expect(protocol!.framework).toBe('gottman-method');
      expect(protocol!.antidote).toBeDefined();
    });

    it('should return undefined for unknown protocol ID', () => {
      expect(kb.getProtocol('nonexistent')).toBeUndefined();
    });

    it('should list all protocol IDs', () => {
      const ids = kb.getAllProtocolIds();
      expect(ids.length).toBe(kb.protocolCount);
      expect(ids).toContain('gottman-horseman-criticism');
      expect(ids).toContain('eft-negative-cycle');
      expect(ids).toContain('cbt-cognitive-distortions');
    });

    it('should get protocols by framework', () => {
      const gottmanProtocols = kb.getFrameworkProtocols('gottman-method');
      expect(gottmanProtocols.length).toBeGreaterThan(0);
      expect(gottmanProtocols.every(p => p.framework === 'gottman-method')).toBe(true);
    });
  });

  describe('Semantic Search', () => {
    it('should find contempt protocol when searching for contempt', () => {
      const results = kb.search('partner is using contempt sarcasm and eye-rolling', 5);
      expect(results.length).toBeGreaterThan(0);
      // Contempt protocol should be among top results
      const contemptResult = results.find(r => r.protocol.id === 'gottman-horseman-contempt');
      expect(contemptResult).toBeDefined();
    });

    it('should find stonewalling protocol when partner shuts down', () => {
      const results = kb.search('partner goes silent and stops responding', 5);
      expect(results.length).toBeGreaterThan(0);
      const stonewallingResult = results.find(r => r.protocol.id === 'gottman-horseman-stonewalling');
      expect(stonewallingResult).toBeDefined();
    });

    it('should find cognitive distortion protocols for absolute statements', () => {
      const results = kb.search('you always do this you never listen mind reading catastrophizing', 5);
      expect(results.length).toBeGreaterThan(0);
      const cbtResult = results.find(r => r.protocol.framework === 'cbt-couples');
      expect(cbtResult).toBeDefined();
    });

    it('should find EFT protocols for attachment-related language', () => {
      const results = kb.search('attachment injury abandoned rejected partner withdraws pursue withdraw negative cycle emotion', 10);
      expect(results.length).toBeGreaterThan(0);
      const eftResult = results.find(r => r.protocol.framework === 'emotionally-focused-therapy');
      expect(eftResult).toBeDefined();
    });

    it('should find trauma protocols for trauma-related language', () => {
      const results = kb.search('panic attack triggered dissociation trauma response flooding', 5);
      expect(results.length).toBeGreaterThan(0);
      const traumaResult = results.find(r => r.protocol.framework === 'trauma-informed');
      expect(traumaResult).toBeDefined();
    });

    it('should filter by framework', () => {
      const results = kb.search('conflict resolution', 10, 0.0, 'gottman-method');
      expect(results.every(r => r.protocol.framework === 'gottman-method')).toBe(true);
    });

    it('should return relevance scores between 0 and 1', () => {
      const results = kb.search('therapy conflict', 5);
      for (const r of results) {
        expect(r.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(r.relevanceScore).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Red Line Search', () => {
    it('should find red-line protocols for safety concerns', () => {
      const results = kb.searchRedLine('abuse violence danger safety harm');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.protocol.redLine === true)).toBe(true);
    });
  });

  describe('Context Formatting', () => {
    it('should format results for LLM context', () => {
      const results = kb.search('contempt sarcasm', 3);
      const formatted = kb.formatForContext(results);
      expect(formatted).toContain('[');
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('should return empty string for no results', () => {
      expect(kb.formatForContext([])).toBe('');
    });
  });

  describe('Singleton', () => {
    it('should return the same instance', () => {
      const kb1 = getClinicalKnowledgeBase();
      const kb2 = getClinicalKnowledgeBase();
      expect(kb1).toBe(kb2);
    });

    it('should be initialized', () => {
      const kb = getClinicalKnowledgeBase();
      expect(kb.isInitialized).toBe(true);
    });
  });
});
