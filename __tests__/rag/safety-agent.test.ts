/**
 * Tests for the Safety/Refusal Agent
 *
 * The safety agent is deterministic (no LLM calls) so these tests
 * are reliable and fast.
 */

import { runSafetyCheck, hasCriticalSafetyFlags } from '../../lib/rag/agents/safety-agent';

describe('Safety Agent', () => {
  describe('runSafetyCheck', () => {
    it('should return safe for normal conversation', () => {
      const result = runSafetyCheck([
        'I feel frustrated when you leave dishes in the sink.',
        'I understand, I will try to do better.',
        'Thank you, that means a lot to me.',
      ]);

      expect(result.safe).toBe(true);
      expect(result.severity).toBe('none');
      expect(result.flags).toHaveLength(0);
    });

    it('should detect suicidal ideation with definite confidence', () => {
      const result = runSafetyCheck([
        'I want to kill myself.',
      ]);

      expect(result.safe).toBe(false);
      expect(result.severity).toBe('critical');
      expect(result.flags.length).toBeGreaterThan(0);
      expect(result.flags[0].type).toBe('suicidal-ideation');
      expect(result.flags[0].confidence).toBe('definite');
      expect(result.overrideResponse).toBeDefined();
      expect(result.crisisResources).toBeDefined();
      expect(result.crisisResources!.length).toBeGreaterThan(0);
    });

    it('should detect passive suicidal ideation', () => {
      const result = runSafetyCheck([
        "I don't want to be alive anymore.",
      ]);

      expect(result.safe).toBe(false);
      expect(result.flags.some(f => f.type === 'suicidal-ideation')).toBe(true);
    });

    it('should detect domestic violence', () => {
      const result = runSafetyCheck([
        "He hit me again last night.",
      ]);

      expect(result.safe).toBe(false);
      expect(result.flags.some(f => f.type === 'domestic-violence')).toBe(true);
      expect(result.severity).toBe('critical');
    });

    it('should detect self-harm', () => {
      const result = runSafetyCheck([
        "I've been cutting myself to cope.",
      ]);

      expect(result.safe).toBe(false);
      expect(result.flags.some(f => f.type === 'self-harm')).toBe(true);
    });

    it('should detect child abuse concerns', () => {
      const result = runSafetyCheck([
        "She hits the kids when she's angry.",
      ]);

      expect(result.safe).toBe(false);
      expect(result.flags.some(f => f.type === 'child-abuse')).toBe(true);
    });

    it('should detect homicidal ideation', () => {
      const result = runSafetyCheck([
        "I want to kill him.",
      ]);

      expect(result.safe).toBe(false);
      expect(result.flags.some(f => f.type === 'homicidal-ideation')).toBe(true);
      expect(result.severity).toBe('critical');
    });

    it('should detect substance crisis', () => {
      const result = runSafetyCheck([
        "I took too many pills last night.",
      ]);

      expect(result.safe).toBe(false);
      expect(result.flags.some(f => f.type === 'substance-crisis')).toBe(true);
    });

    it('should provide override response for critical severity', () => {
      const result = runSafetyCheck([
        "I'm planning to end it all tonight.",
      ]);

      expect(result.severity).toBe('critical');
      expect(result.overrideResponse).toBeDefined();
      expect(result.overrideResponse).toContain('988');
      expect(result.overrideResponse).toContain('safety');
    });

    it('should not flag figurative/casual language as critical', () => {
      const result = runSafetyCheck([
        "This traffic is killing me.",
        "I could die for a piece of cake right now.",
        "You're killing the mood.",
      ]);

      // These should either be safe or low severity
      if (!result.safe) {
        expect(['low', 'medium']).toContain(result.severity);
      }
    });

    it('should detect threats of violence toward partner', () => {
      const result = runSafetyCheck([
        "He threatens to hurt me if I leave.",
      ]);

      expect(result.safe).toBe(false);
      expect(result.flags.some(f => f.type === 'domestic-violence')).toBe(true);
    });

    it('should detect controlling behavior patterns', () => {
      const result = runSafetyCheck([
        "He won't let me see my friends or family.",
      ]);

      expect(result.safe).toBe(false);
      expect(result.flags.some(f => f.type === 'domestic-violence')).toBe(true);
    });

    it('should handle multiple flags in a single check', () => {
      const result = runSafetyCheck([
        "He beats me and I want to end my life.",
      ]);

      expect(result.safe).toBe(false);
      expect(result.severity).toBe('critical');
      expect(result.flags.length).toBeGreaterThanOrEqual(2);

      const types = result.flags.map(f => f.type);
      expect(types).toContain('domestic-violence');
      expect(types).toContain('suicidal-ideation');
    });

    it('should include context around matched content', () => {
      const result = runSafetyCheck([
        "After the argument about money, I don't want to be alive anymore and I feel so hopeless.",
      ]);

      expect(result.flags[0].context.length).toBeGreaterThan(0);
    });

    it('should include crisis resources for all flagged types', () => {
      const result = runSafetyCheck([
        "I want to kill myself.",
      ]);

      expect(result.crisisResources).toBeDefined();
      const resourceNames = result.crisisResources!.map(r => r.name);
      expect(resourceNames).toContain('988 Suicide & Crisis Lifeline');
    });
  });

  describe('hasCriticalSafetyFlags', () => {
    it('should return true for critical content', () => {
      expect(hasCriticalSafetyFlags(['I want to kill myself.'])).toBe(true);
    });

    it('should return false for safe content', () => {
      expect(hasCriticalSafetyFlags(['I feel sad today.'])).toBe(false);
    });

    it('should return false for empty input', () => {
      expect(hasCriticalSafetyFlags([])).toBe(false);
    });
  });
});
