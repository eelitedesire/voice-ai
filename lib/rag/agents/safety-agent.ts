/**
 * Safety/Refusal Agent — The "Cold" Layer
 *
 * A deterministic, keyword-and-pattern-based monitor that runs BEFORE any
 * LLM processing. It scans every incoming message and transcript segment
 * for indicators of self-harm, suicidal ideation, domestic violence, child
 * abuse, and other crisis situations.
 *
 * If triggered at CRITICAL severity, it overrides the AI response entirely
 * and provides crisis resources. This agent does NOT rely on an LLM for
 * detection — it uses pattern matching for speed and reliability.
 */

import {
  SafetyCheckResult,
  SafetyFlag,
  SafetyFlagType,
  CrisisResource,
} from '../types';

// ─── Crisis Resources ────────────────────────────────────────────────

const CRISIS_RESOURCES: Record<SafetyFlagType, CrisisResource[]> = {
  'self-harm': [
    {
      name: 'Crisis Text Line',
      text: 'Text HOME to 741741',
      description: 'Free 24/7 crisis counseling via text message',
    },
    {
      name: '988 Suicide & Crisis Lifeline',
      phone: '988',
      url: 'https://988lifeline.org',
      description: '24/7 free and confidential support',
    },
  ],
  'suicidal-ideation': [
    {
      name: '988 Suicide & Crisis Lifeline',
      phone: '988',
      url: 'https://988lifeline.org',
      description: '24/7 free and confidential support for people in distress',
    },
    {
      name: 'Crisis Text Line',
      text: 'Text HOME to 741741',
      description: 'Free 24/7 crisis counseling via text message',
    },
    {
      name: 'International Association for Suicide Prevention',
      url: 'https://www.iasp.info/resources/Crisis_Centres/',
      description: 'Directory of crisis centers worldwide',
    },
  ],
  'domestic-violence': [
    {
      name: 'National Domestic Violence Hotline',
      phone: '1-800-799-7233',
      text: 'Text START to 88788',
      url: 'https://www.thehotline.org',
      description: '24/7 confidential support for domestic violence survivors',
    },
    {
      name: 'National Coalition Against Domestic Violence',
      url: 'https://ncadv.org',
      description: 'Resources and safety planning tools',
    },
  ],
  'child-abuse': [
    {
      name: 'Childhelp National Child Abuse Hotline',
      phone: '1-800-422-4453',
      url: 'https://www.childhelp.org',
      description: '24/7 crisis intervention and support',
    },
  ],
  'substance-crisis': [
    {
      name: 'SAMHSA National Helpline',
      phone: '1-800-662-4357',
      url: 'https://www.samhsa.gov/find-help/national-helpline',
      description: 'Free 24/7 treatment referral and information service',
    },
  ],
  'homicidal-ideation': [
    {
      name: '988 Suicide & Crisis Lifeline',
      phone: '988',
      description: 'Also handles homicidal ideation — call immediately',
    },
    {
      name: 'Emergency Services',
      phone: '911',
      description: 'If there is an immediate threat to life, call 911',
    },
  ],
  'severe-dissociation': [
    {
      name: '988 Suicide & Crisis Lifeline',
      phone: '988',
      description: '24/7 support for mental health crises',
    },
    {
      name: 'Crisis Text Line',
      text: 'Text HOME to 741741',
      description: 'Free 24/7 crisis counseling via text message',
    },
  ],
};

// ─── Detection Patterns ──────────────────────────────────────────────

interface DetectionPattern {
  type: SafetyFlagType;
  patterns: RegExp[];
  /** Higher weight = more likely to be a genuine flag vs. figurative speech */
  weight: 'definite' | 'probable' | 'possible';
}

const DETECTION_PATTERNS: DetectionPattern[] = [
  // ── Suicidal Ideation ──
  {
    type: 'suicidal-ideation',
    weight: 'definite',
    patterns: [
      /\b(want|going|plan(?:ning)?|try(?:ing)?|going)\s+to\s+(kill\s+myself|end\s+(my|it\s+all|everything)|take\s+my\s+(own\s+)?life|die)\b/i,
      /\b(i('?m| am)\s+going\s+to\s+)?(commit|attempt)\s+suicide\b/i,
      /\bsuicid(e|al)\s+(plan|note|attempt|ideation|thought)/i,
      /\bi\s+have\s+a\s+plan\s+to\s+(die|end\s+it)/i,
      /\beveryone\s+would\s+be\s+better\s+off\s+(without\s+me|if\s+i\s+(was|were)\s+(dead|gone))/i,
    ],
  },
  {
    type: 'suicidal-ideation',
    weight: 'probable',
    patterns: [
      /\b(don'?t|do\s+not)\s+want\s+to\s+(be\s+alive|live|exist|be\s+here)\b/i,
      /\b(wish|wished)\s+(i|I)\s+(was|were)\s+dead\b/i,
      /\bno\s+(reason|point)\s+(to|in)\s+(live|living|go(?:ing)?\s+on)\b/i,
      /\bcan'?t\s+(go|keep|take)\s+(on|going|it)\s+any\s*more\b/i,
      /\bi('?m| am)\s+(a\s+)?burden\b/i,
    ],
  },
  {
    type: 'suicidal-ideation',
    weight: 'possible',
    patterns: [
      /\b(think(?:ing)?\s+about|thought\s+about)\s+(ending\s+it|not\s+being\s+here|disappearing)\b/i,
      /\bwhat('?s| is)\s+the\s+point\b/i,
    ],
  },

  // ── Self-Harm ──
  {
    type: 'self-harm',
    weight: 'definite',
    patterns: [
      /\b(cut(?:ting)?|burn(?:ing)?|hurt(?:ing)?)\s+(myself|my\s+(arm|leg|wrist|body|skin))\b/i,
      /\bself[- ]?harm/i,
      /\bi\s+(want|need)\s+to\s+(feel\s+)?pain\b/i,
    ],
  },
  {
    type: 'self-harm',
    weight: 'probable',
    patterns: [
      /\b(scratch(?:ing)?|hit(?:ting)?|bang(?:ing)?)\s+(myself|my\s+head)\b/i,
      /\bstarving\s+myself\b/i,
      /\bpulling\s+(my\s+)?hair\s+out\b/i,
    ],
  },

  // ── Domestic Violence ──
  {
    type: 'domestic-violence',
    weight: 'definite',
    patterns: [
      /\b(he|she|they|partner|spouse|husband|wife)\s+(hit|hits|beat|beats|punch(?:ed|es)?|slap(?:ped|s)?|chok(?:ed|es|ing)?|kick(?:ed|s)?|stab(?:bed|s)?|strangle[ds]?)\s+(me|her|him)\b/i,
      /\b(i('?m| am)|i\s+feel)\s+(scared|afraid)\s+(of|for)\s+(him|her|my\s+(life|safety|partner|husband|wife))\b/i,
      /\b(threaten(?:ed|s|ing)?)\s+to\s+(kill|hurt|harm|hit)\s+(me|her|him)\b/i,
    ],
  },
  {
    type: 'domestic-violence',
    weight: 'probable',
    patterns: [
      /\b(won'?t|will\s+not)\s+let\s+me\s+(leave|go|see\s+(?:my\s+)?(?:friends|family))\b/i,
      /\b(controls?|controlling)\s+(everything|my\s+(money|phone|life))\b/i,
      /\b(bruise[ds]?|black\s+eye|broken\s+(bone|rib|nose|arm))\b/i,
      /\b(threw|throws)\s+(things?\s+at\s+me|me\s+against)\b/i,
      /\bforced\s+(me\s+)?to\s+(have\s+sex|sleep\s+with)/i,
    ],
  },

  // ── Child Abuse ──
  {
    type: 'child-abuse',
    weight: 'definite',
    patterns: [
      /\b(hit(?:s|ting)?|beat(?:s|ing)?|abus(?:ed?|es|ing))\s+(the\s+)?(kids?|child(?:ren)?|baby|son|daughter)\b/i,
      /\b(child|kid|minor)\s+(abuse|neglect|molestation)\b/i,
    ],
  },
  {
    type: 'child-abuse',
    weight: 'probable',
    patterns: [
      /\b(kids?|child(?:ren)?)\s+(are|is)\s+(scared|terrified|afraid)\s+of\s+(him|her|us|me)\b/i,
      /\bleave\s+the\s+(kid|child|children|baby)\s+(alone|hungry|locked)/i,
    ],
  },

  // ── Homicidal Ideation ──
  {
    type: 'homicidal-ideation',
    weight: 'definite',
    patterns: [
      /\b(want|going|plan(?:ning)?)\s+to\s+(kill|murder|hurt|harm)\s+(him|her|them|you|my\s+(partner|husband|wife|spouse))\b/i,
      /\bi('?ll| will)\s+(kill|murder)\b/i,
    ],
  },
  {
    type: 'homicidal-ideation',
    weight: 'probable',
    patterns: [
      /\b(wish|wished)\s+(he|she|they)\s+(was|were)\s+dead\b/i,
    ],
  },

  // ── Substance Crisis ──
  {
    type: 'substance-crisis',
    weight: 'definite',
    patterns: [
      /\b(overdos(?:ed?|ing)|OD'?d)\b/i,
      /\b(took|taking)\s+(too\s+many|a\s+lot\s+of)\s+(pills?|medication|drugs?)\b/i,
    ],
  },
  {
    type: 'substance-crisis',
    weight: 'probable',
    patterns: [
      /\b(can'?t|cannot)\s+stop\s+(drinking|using|taking)\b/i,
      /\b(blacked?\s+out|passed\s+out)\s+(from|after)\s+(drinking|drugs?)\b/i,
    ],
  },

  // ── Severe Dissociation ──
  {
    type: 'severe-dissociation',
    weight: 'probable',
    patterns: [
      /\b(don'?t|can'?t)\s+(know|remember|feel)\s+(who|where|if)\s+(i\s+am|i('?m| am))\b/i,
      /\b(losing|lost)\s+(touch\s+with\s+reality|time|hours|days)\b/i,
      /\bhearing\s+voices\b/i,
    ],
  },
];

// ─── Override Response Templates ─────────────────────────────────────

function buildOverrideResponse(flags: SafetyFlag[]): string {
  const resources = new Map<string, CrisisResource>();

  // Collect unique resources for all flagged types
  for (const flag of flags) {
    const typeResources = CRISIS_RESOURCES[flag.type] || [];
    for (const r of typeResources) {
      resources.set(r.name, r);
    }
  }

  const lines: string[] = [
    'I want to pause our conversation because what you\'re sharing sounds very serious, and I care about your safety.',
    '',
    'What you\'re describing may require immediate professional support beyond what I can provide here.',
    '',
    'Please reach out to one of these resources — they are free, confidential, and available 24/7:',
    '',
  ];

  for (const [, resource] of resources) {
    let line = `**${resource.name}**`;
    if (resource.phone) line += ` — Call ${resource.phone}`;
    if (resource.text) line += ` — ${resource.text}`;
    if (resource.url) line += ` — ${resource.url}`;
    lines.push(line);
    lines.push(`  ${resource.description}`);
    lines.push('');
  }

  lines.push('You are not alone, and help is available right now.');

  return lines.join('\n');
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Run the safety check on all provided text.
 * This is a deterministic, non-LLM check for maximum speed and reliability.
 */
export function runSafetyCheck(texts: string[]): SafetyCheckResult {
  const flags: SafetyFlag[] = [];
  const combined = texts.join('\n');

  for (const detection of DETECTION_PATTERNS) {
    for (const pattern of detection.patterns) {
      const match = combined.match(pattern);
      if (match) {
        // Extract surrounding context (up to 80 chars on each side)
        const idx = combined.indexOf(match[0]);
        const start = Math.max(0, idx - 80);
        const end = Math.min(combined.length, idx + match[0].length + 80);
        const context = combined.slice(start, end);

        flags.push({
          type: detection.type,
          matchedContent: match[0],
          confidence: detection.weight,
          context: context.trim(),
        });

        // Only flag each pattern type once per check
        break;
      }
    }
  }

  if (flags.length === 0) {
    return { safe: true, severity: 'none', flags: [] };
  }

  // Determine overall severity
  const hasDefinite = flags.some(f => f.confidence === 'definite');
  const hasProbable = flags.some(f => f.confidence === 'probable');
  const hasCriticalType = flags.some(f =>
    f.type === 'suicidal-ideation' ||
    f.type === 'homicidal-ideation' ||
    f.type === 'domestic-violence' ||
    f.type === 'child-abuse'
  );

  let severity: SafetyCheckResult['severity'];
  if (hasDefinite && hasCriticalType) {
    severity = 'critical';
  } else if (hasDefinite || (hasProbable && hasCriticalType)) {
    severity = 'high';
  } else if (hasProbable) {
    severity = 'medium';
  } else {
    severity = 'low';
  }

  // Collect crisis resources for all flagged types
  const allResources: CrisisResource[] = [];
  const seenResources = new Set<string>();
  for (const flag of flags) {
    const resources = CRISIS_RESOURCES[flag.type] || [];
    for (const r of resources) {
      if (!seenResources.has(r.name)) {
        seenResources.add(r.name);
        allResources.push(r);
      }
    }
  }

  const result: SafetyCheckResult = {
    safe: false,
    severity,
    flags,
    crisisResources: allResources,
  };

  // Critical severity: override the entire AI response
  if (severity === 'critical') {
    result.overrideResponse = buildOverrideResponse(flags);
  }

  console.log(`[Safety] Flagged ${flags.length} concern(s) at severity: ${severity}`);
  for (const flag of flags) {
    console.log(`  [${flag.confidence}] ${flag.type}: "${flag.matchedContent}"`);
  }

  return result;
}

/**
 * Quick check — returns true if any critical flags are present.
 * Use this for fast-path decisions.
 */
export function hasCriticalSafetyFlags(texts: string[]): boolean {
  const result = runSafetyCheck(texts);
  return result.severity === 'critical';
}
