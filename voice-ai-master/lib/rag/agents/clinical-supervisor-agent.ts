/**
 * Clinical Supervisor Agent
 *
 * Decides which therapeutic framework best fits the current conflict dynamics.
 * Analyzes the conversation in real-time to classify the conflict type and
 * select appropriate intervention techniques.
 *
 * Example: "The couple is yelling; let's pull 'De-escalation' techniques."
 */

import { generateObject } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';
import {
  ClinicalSupervisionResult,
  TherapeuticFramework,
  TherapeuticTechnique,
  ConflictClassification,
  ContextRetrievalResult,
  RAGPipelineInput,
} from '../types';

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

// ─── Therapeutic Framework Library ───────────────────────────────────

const TECHNIQUE_LIBRARY: Record<TherapeuticFramework, TherapeuticTechnique[]> = {
  'de-escalation': [
    {
      name: 'Time-Out Protocol',
      description: 'Structured break when emotional flooding is detected. Each partner takes 20-30 minutes apart with self-soothing.',
      framework: 'de-escalation',
      whenToUse: 'When voices are raised, personal attacks begin, or one partner shows signs of flooding',
    },
    {
      name: 'Speaker-Listener Technique',
      description: 'One person speaks while the other paraphrases back. Switch roles. No rebuttals until both feel heard.',
      framework: 'de-escalation',
      whenToUse: 'When both partners are talking over each other or neither feels heard',
    },
    {
      name: 'Softened Start-Up',
      description: 'Reframe complaints as "I feel X when Y happens" rather than accusations.',
      framework: 'de-escalation',
      whenToUse: 'When a partner opens with criticism or blame',
    },
  ],
  'gottman-method': [
    {
      name: 'Four Horsemen Identification',
      description: 'Identify and name criticism, contempt, defensiveness, or stonewalling when observed.',
      framework: 'gottman-method',
      whenToUse: 'When destructive communication patterns are visible',
    },
    {
      name: 'Repair Attempt Recognition',
      description: 'Highlight when a partner tries to break negative cycles (humor, apology, softening tone).',
      framework: 'gottman-method',
      whenToUse: 'When one partner makes a bid to reconnect during conflict',
    },
    {
      name: 'Dreams Within Conflict',
      description: 'Explore the deeper needs, hopes, or life dreams underlying the surface-level fight.',
      framework: 'gottman-method',
      whenToUse: 'When a couple has the same recurring fight about a perpetual problem',
    },
    {
      name: 'Love Maps Check-In',
      description: 'Ask questions that reveal how well partners know each other\'s inner world.',
      framework: 'gottman-method',
      whenToUse: 'When partners seem disconnected or make assumptions about each other',
    },
  ],
  'emotionally-focused': [
    {
      name: 'Attachment Injury Exploration',
      description: 'Identify the attachment need underneath the anger or withdrawal (need for safety, reassurance, closeness).',
      framework: 'emotionally-focused',
      whenToUse: 'When a partner expresses feeling abandoned, rejected, or not important enough',
    },
    {
      name: 'Emotion Reflection',
      description: 'Name the primary emotion beneath secondary reactions (anger often masks fear or sadness).',
      framework: 'emotionally-focused',
      whenToUse: 'When a partner shows reactive emotions that may be masking deeper feelings',
    },
    {
      name: 'Negative Cycle Mapping',
      description: 'Help the couple see the pursue-withdraw or attack-defend cycle they are trapped in.',
      framework: 'emotionally-focused',
      whenToUse: 'When partners are locked in a repeating interaction pattern',
    },
  ],
  'cbt-couples': [
    {
      name: 'Cognitive Distortion Check',
      description: 'Identify and gently challenge mind-reading, catastrophizing, or black-and-white thinking.',
      framework: 'cbt-couples',
      whenToUse: 'When a partner makes absolute statements or attributes malicious intent',
    },
    {
      name: 'Behavioral Exchange',
      description: 'Have each partner identify one small positive action they can do for the other this week.',
      framework: 'cbt-couples',
      whenToUse: 'When the couple is stuck in mutual negativity',
    },
    {
      name: 'Thought Record for Couples',
      description: 'Identify the triggering event, automatic thought, emotion, and evidence for/against.',
      framework: 'cbt-couples',
      whenToUse: 'When a partner has a strong negative reaction based on interpretation rather than evidence',
    },
  ],
  'narrative-therapy': [
    {
      name: 'Externalization',
      description: 'Separate the problem from the person: "The anger took over" instead of "You are angry."',
      framework: 'narrative-therapy',
      whenToUse: 'When partners are identifying each other with the problem',
    },
    {
      name: 'Unique Outcomes',
      description: 'Identify times when the problem didn\'t dominate — moments of connection, humor, or coping.',
      framework: 'narrative-therapy',
      whenToUse: 'When the couple feels hopeless or defines their relationship solely by problems',
    },
  ],
  'solution-focused': [
    {
      name: 'Miracle Question',
      description: 'Ask what would be different if the problem magically resolved overnight.',
      framework: 'solution-focused',
      whenToUse: 'When the couple is stuck in problem talk with no vision of what better looks like',
    },
    {
      name: 'Scaling Question',
      description: 'On a 1-10 scale, where is the relationship today? What would move it up one point?',
      framework: 'solution-focused',
      whenToUse: 'When measuring progress or setting concrete micro-goals',
    },
    {
      name: 'Exception Finding',
      description: 'When was the last time this problem didn\'t happen? What was different?',
      framework: 'solution-focused',
      whenToUse: 'When partners believe the problem is constant and unbreakable',
    },
  ],
  'trauma-informed': [
    {
      name: 'Window of Tolerance Assessment',
      description: 'Check if each partner is within their window of tolerance or in hyper/hypo-arousal.',
      framework: 'trauma-informed',
      whenToUse: 'When a partner shows signs of dissociation, panic, or emotional shutdown',
    },
    {
      name: 'Grounding Exercise',
      description: '5-4-3-2-1 sensory grounding or box breathing to return to present moment.',
      framework: 'trauma-informed',
      whenToUse: 'When a partner is flooded or triggered by past trauma',
    },
    {
      name: 'Safety Assessment',
      description: 'Evaluate emotional and physical safety of both partners in the current moment.',
      framework: 'trauma-informed',
      whenToUse: 'When trauma responses are triggered or discussion touches on past abuse',
    },
  ],
  'psychodynamic': [
    {
      name: 'Pattern Interpretation',
      description: 'Connect current relationship dynamics to earlier relational experiences or family-of-origin patterns.',
      framework: 'psychodynamic',
      whenToUse: 'When current conflicts echo childhood or past relationship dynamics',
    },
    {
      name: 'Defense Mechanism Naming',
      description: 'Gently name when projection, displacement, or intellectualization is occurring.',
      framework: 'psychodynamic',
      whenToUse: 'When a partner attributes their own feelings to the other or avoids emotion through logic',
    },
  ],
  'imago-therapy': [
    {
      name: 'Imago Dialogue',
      description: 'Structured mirroring, validation, and empathy: "What I hear you saying is... Is there more?"',
      framework: 'imago-therapy',
      whenToUse: 'When partners need a safe structure to truly hear each other',
    },
    {
      name: 'Childhood Wound Exploration',
      description: 'Explore how current frustrations connect to unmet childhood needs.',
      framework: 'imago-therapy',
      whenToUse: 'When a partner has an outsized reaction suggesting a deeper, older wound',
    },
  ],
};

// ─── LLM Schema ──────────────────────────────────────────────────────

const supervisionSchema = z.object({
  conflictClassification: z.enum([
    'escalation', 'withdrawal', 'criticism', 'contempt',
    'stonewalling', 'defensiveness', 'flooding', 'repair-attempt',
    'productive-discussion', 'neutral',
  ]).describe('Classification of the current interaction dynamic'),
  selectedFramework: z.enum([
    'de-escalation', 'gottman-method', 'emotionally-focused', 'cbt-couples',
    'narrative-therapy', 'solution-focused', 'trauma-informed', 'psychodynamic',
    'imago-therapy',
  ]).describe('The therapeutic framework best suited for this moment'),
  reasoning: z.string().describe('Brief clinical reasoning for the framework selection'),
  deEscalationNeeded: z.boolean().describe('Whether the therapist should prioritize de-escalation right now'),
  suggestedInterventions: z.array(z.string()).describe('Specific interventions or responses the therapist should consider (2-4 items)'),
});

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Run the Clinical Supervisor Agent.
 *
 * Analyzes the current conversation, classifies the conflict type, and
 * selects the most appropriate therapeutic framework and techniques.
 */
export async function runClinicalSupervisor(
  input: RAGPipelineInput,
  retrievedContext?: ContextRetrievalResult,
): Promise<ClinicalSupervisionResult> {
  const { currentTranscript, currentMessage, chatHistory, currentSpeaker } = input;

  // Build the current context
  const currentContext = buildCurrentContext(currentTranscript, currentMessage, currentSpeaker, chatHistory);

  // Build historical context if available
  const historyContext = retrievedContext
    ? buildHistoryContext(retrievedContext)
    : '';

  try {
    const { object } = await generateObject({
      model: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
      schema: supervisionSchema,
      system: `You are an expert clinical supervisor for couples therapy. You are observing a live therapy session and must make a real-time decision about which therapeutic approach to use.

Your job:
1. Classify the current interaction (escalation, withdrawal, criticism, etc.)
2. Select the therapeutic framework best suited for THIS MOMENT
3. Recommend specific interventions

Decision guidelines:
- If voices are raised or personal attacks: de-escalation FIRST
- If one partner is shutting down: emotionally-focused or trauma-informed
- If cognitive distortions are present: cbt-couples
- If recurring perpetual problem: gottman-method (Dreams Within Conflict)
- If trauma response visible: trauma-informed
- If couple is functional and problem-solving: solution-focused
- If family-of-origin patterns emerge: psychodynamic or imago-therapy
- If couple can't hear each other: imago-therapy (Imago Dialogue)

Be decisive. Pick ONE primary framework. Be specific in interventions.`,
      prompt: `CURRENT SESSION:
${currentContext}
${historyContext ? `\nHISTORICAL CONTEXT:\n${historyContext}` : ''}

Based on the current dynamics, select the therapeutic framework and interventions.`,
    });

    // Look up techniques from the library for the selected framework
    const techniques = TECHNIQUE_LIBRARY[object.selectedFramework] || [];

    return {
      selectedFramework: object.selectedFramework,
      reasoning: object.reasoning,
      techniques,
      suggestedInterventions: object.suggestedInterventions,
      deEscalationNeeded: object.deEscalationNeeded,
      conflictClassification: object.conflictClassification,
    };
  } catch (err) {
    console.error('[ClinicalSupervisor] LLM analysis failed, using fallback:', err);
    return buildFallbackResult(currentTranscript);
  }
}

/**
 * Format supervision result for injection into the therapist prompt.
 */
export function formatSupervisionContext(result: ClinicalSupervisionResult): string {
  const parts: string[] = [];

  parts.push(`\nClinical supervision guidance:`);
  parts.push(`  Framework: ${result.selectedFramework}`);
  parts.push(`  Conflict type: ${result.conflictClassification}`);
  parts.push(`  Reasoning: ${result.reasoning}`);

  if (result.deEscalationNeeded) {
    parts.push(`  ** DE-ESCALATION NEEDED ** — Prioritize calming the interaction before proceeding.`);
  }

  if (result.suggestedInterventions.length > 0) {
    parts.push(`  Suggested interventions:`);
    for (const intervention of result.suggestedInterventions) {
      parts.push(`    - ${intervention}`);
    }
  }

  if (result.techniques.length > 0) {
    parts.push(`  Available techniques for ${result.selectedFramework}:`);
    for (const tech of result.techniques) {
      parts.push(`    - ${tech.name}: ${tech.description}`);
      parts.push(`      When to use: ${tech.whenToUse}`);
    }
  }

  return parts.join('\n');
}

// ─── Internal Helpers ────────────────────────────────────────────────

function buildCurrentContext(
  transcript: RAGPipelineInput['currentTranscript'],
  currentMessage?: string,
  currentSpeaker?: string,
  chatHistory?: RAGPipelineInput['chatHistory'],
): string {
  const parts: string[] = [];

  if (transcript.length > 0) {
    const recent = transcript.slice(-15);
    parts.push(recent.map(e => `[${e.speaker}]: ${e.text}`).join('\n'));
  }

  if (chatHistory && chatHistory.length > 0) {
    const recentChat = chatHistory.slice(-8);
    parts.push('\nChat:');
    parts.push(recentChat.map(m => `[${m.speaker || m.role}]: ${m.text}`).join('\n'));
  }

  if (currentMessage) {
    const speaker = currentSpeaker || 'Unknown';
    parts.push(`\n[${speaker}] (just now): ${currentMessage}`);
  }

  return parts.join('\n');
}

function buildHistoryContext(retrieved: ContextRetrievalResult): string {
  const parts: string[] = [];

  if (retrieved.similarPastConflicts.length > 0) {
    parts.push('Similar past situations:');
    for (const conflict of retrieved.similarPastConflicts.slice(0, 2)) {
      parts.push(`  - ${conflict.summary}`);
      if (conflict.whatHelped) parts.push(`    Previously helped: ${conflict.whatHelped}`);
      if (conflict.whatEscalated) parts.push(`    Previously escalated: ${conflict.whatEscalated}`);
    }
  }

  if (retrieved.recurringTriggers.length > 0) {
    parts.push('Known triggers: ' + retrieved.recurringTriggers.map(t => t.description).join(', '));
  }

  return parts.join('\n');
}

function buildFallbackResult(
  transcript: RAGPipelineInput['currentTranscript'],
): ClinicalSupervisionResult {
  // Simple heuristic-based fallback
  const recentText = transcript.slice(-10).map(e => e.text).join(' ').toLowerCase();

  let classification: ConflictClassification = 'neutral';
  let framework: TherapeuticFramework = 'solution-focused';
  let deEscalationNeeded = false;

  // Check for escalation indicators
  const escalationWords = ['yelling', 'screaming', 'shut up', 'hate you', 'always', 'never', '!!', 'damn', 'hell'];
  const withdrawalWords = ['fine', 'whatever', 'i don\'t care', 'leave me alone', 'forget it', 'nothing'];
  const criticismWords = ['you always', 'you never', 'why can\'t you', 'what\'s wrong with you'];

  if (escalationWords.some(w => recentText.includes(w))) {
    classification = 'escalation';
    framework = 'de-escalation';
    deEscalationNeeded = true;
  } else if (withdrawalWords.some(w => recentText.includes(w))) {
    classification = 'withdrawal';
    framework = 'emotionally-focused';
  } else if (criticismWords.some(w => recentText.includes(w))) {
    classification = 'criticism';
    framework = 'gottman-method';
  }

  return {
    selectedFramework: framework,
    reasoning: 'Fallback heuristic analysis (LLM unavailable). Based on keyword detection in recent transcript.',
    techniques: TECHNIQUE_LIBRARY[framework] || [],
    suggestedInterventions: deEscalationNeeded
      ? ['Consider a structured time-out', 'Use softened start-up to redirect']
      : ['Continue observation', 'Ask a clarifying question'],
    deEscalationNeeded,
    conflictClassification: classification,
  };
}
