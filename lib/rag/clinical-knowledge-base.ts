/**
 * Clinical Knowledge Base — Layer 1: The "Wisdom" Layer
 *
 * A static, read-only vector database acting as the AI's "medical degree."
 * Contains high-density embeddings of structured therapeutic protocols:
 *
 * - Gottman Method: Four Horsemen + antidotes, repair attempts, love maps
 * - Emotionally Focused Therapy (EFT): De-escalation, attachment styles
 * - Cognitive Behavioral Therapy (CBT): Cognitive distortions, thought records
 * - Narrative Therapy: Externalization, unique outcomes
 * - Solution-Focused Brief Therapy: Miracle question, scaling
 * - Trauma-Informed Care: Window of tolerance, grounding
 * - Psychodynamic: Defense mechanisms, family-of-origin patterns
 * - Imago Therapy: Mirroring, validation, empathy
 *
 * Also includes a "Red Line" safety index for crisis keyword detection
 * that triggers immediate referral to human crisis lines.
 */

import { VectorStore, VectorDocument } from './vector-store';
import { TFIDFEmbedder } from './embeddings';

// ─── Types ──────────────────────────────────────────────────────────

export interface ClinicalProtocol {
  id: string;
  framework: string;
  name: string;
  description: string;
  whenToUse: string;
  steps?: string[];
  antidote?: string;
  redLine?: boolean;
}

export interface ClinicalSearchResult {
  protocol: ClinicalProtocol;
  relevanceScore: number;
}

// ─── Clinical Protocol Database ─────────────────────────────────────

const CLINICAL_PROTOCOLS: ClinicalProtocol[] = [
  // ── Gottman Method ──────────────────────────────────────────────
  {
    id: 'gottman-horseman-criticism',
    framework: 'gottman-method',
    name: 'Four Horsemen: Criticism',
    description: 'Criticism attacks the character of the person rather than addressing a specific behavior. It goes beyond a complaint to a global attack on the partner\'s personality. Example: "You never think about anyone but yourself" instead of "I felt hurt when you made plans without asking me."',
    whenToUse: 'When one partner uses "you always" or "you never" statements, or attacks character rather than addressing specific behavior.',
    antidote: 'Gentle Start-Up: Express feelings using "I" statements about a specific situation. Template: "I feel [emotion] about [specific situation], and I need [what you need]."',
  },
  {
    id: 'gottman-horseman-contempt',
    framework: 'gottman-method',
    name: 'Four Horsemen: Contempt',
    description: 'Contempt is the single greatest predictor of divorce. It involves treating the partner with disrespect, mockery, sarcasm, eye-rolling, name-calling, or hostile humor. It conveys disgust and superiority. It is fueled by long-simmering negative thoughts about the partner.',
    whenToUse: 'When a partner uses sarcasm, mocking tone, eye-rolling, name-calling, or expresses disgust or moral superiority over their partner.',
    antidote: 'Build a Culture of Appreciation: Regularly express genuine appreciation, gratitude, affection, and respect. Use the 5:1 ratio — five positive interactions for every negative one. Practice describing your own feelings and needs rather than criticizing your partner\'s character.',
    steps: [
      'Name the contempt pattern without blame: "I notice some strong frustration coming through."',
      'Redirect to the underlying hurt: "What is the feeling underneath that sarcasm?"',
      'Guide toward appreciation: "Can you share one thing your partner did recently that you valued?"',
      'Establish the 5:1 principle for homework.',
    ],
  },
  {
    id: 'gottman-horseman-defensiveness',
    framework: 'gottman-method',
    name: 'Four Horsemen: Defensiveness',
    description: 'Defensiveness is a response to perceived criticism. It involves making excuses, meeting one complaint with another (counter-attacking), or playing the victim to ward off a perceived attack. It escalates conflict because the defensive partner is not taking responsibility.',
    whenToUse: 'When a partner responds to a complaint with excuses, counter-complaints, "yes-but" statements, or victim posturing.',
    antidote: 'Take Responsibility: Accept even a small part of the complaint. This does not mean accepting blame for everything — just acknowledging your partner\'s perspective has some validity. Template: "You\'re right, I did [specific thing]. I can see how that would feel [emotion] for you."',
  },
  {
    id: 'gottman-horseman-stonewalling',
    framework: 'gottman-method',
    name: 'Four Horsemen: Stonewalling',
    description: 'Stonewalling occurs when one partner withdraws from the interaction, shuts down, and stops responding. It is usually a response to emotional flooding — the person\'s heart rate exceeds 100 BPM and they can no longer process information. It is more common in men (85% of stonewallers are male).',
    whenToUse: 'When a partner goes silent, gives monosyllabic answers, breaks eye contact, physically turns away, or appears to "check out" during a discussion.',
    antidote: 'Physiological Self-Soothing: Take a structured break of at least 20 minutes. During the break, do something calming (walk, breathe, listen to music) — do NOT rehearse the argument. Return when heart rate is below 100 BPM and re-engage.',
    steps: [
      'Recognize the flooding: "I can see this is feeling overwhelming right now."',
      'Normalize it: "When we feel flooded, our body shuts down to protect us. That\'s natural."',
      'Suggest a structured break: "Let\'s take a 20-minute pause. During that time, try to do something calming."',
      'Set a return time: "Let\'s come back together at [specific time] to continue this."',
      'When they return, use a Softened Start-Up to re-enter the conversation.',
    ],
  },
  {
    id: 'gottman-softened-startup',
    framework: 'gottman-method',
    name: 'Softened Start-Up',
    description: 'The way a conversation begins determines how it will end 96% of the time (Gottman research). A softened start-up uses "I" statements, describes what is happening without judgment, and expresses a positive need rather than a negative complaint.',
    whenToUse: 'When a partner begins a conversation with criticism, blame, or "you always/never" language. Redirect them to a softened start-up before the conversation escalates.',
    steps: [
      '"I feel..." (state the emotion without blame)',
      '"About..." (describe the specific situation, not the person)',
      '"I need..." (state a positive need, what you DO want, not what you don\'t want)',
    ],
  },
  {
    id: 'gottman-repair-attempts',
    framework: 'gottman-method',
    name: 'Repair Attempts',
    description: 'Repair attempts are any statement or action that prevents negativity from escalating out of control. They are the secret weapon of emotionally healthy couples. Failed repair attempts are a primary predictor of divorce. Examples include humor, apology, physical affection, agreement with part of the complaint, or saying "I need to calm down."',
    whenToUse: 'When one partner makes a bid to de-escalate or reconnect during conflict — recognize and amplify it. Also when the couple needs to learn to make and receive repair attempts.',
  },
  {
    id: 'gottman-dreams-within-conflict',
    framework: 'gottman-method',
    name: 'Dreams Within Conflict',
    description: 'Most recurring conflicts in relationships (69%) are perpetual problems rooted in fundamental personality differences or core life dreams. Rather than trying to "solve" these, couples need to understand the deeper dream or need beneath each partner\'s position.',
    whenToUse: 'When a couple keeps having the same fight about a topic that never resolves (money, chores, parenting style, in-laws). The surface issue is a proxy for a deeper need.',
    steps: [
      'Identify the recurring pattern: "You\'ve mentioned this topic comes up often."',
      'Explore the dream: "What does [this issue] mean to you at a deeper level? What dream or need is connected to it?"',
      'Listen without judgment: The other partner\'s job is to understand, not agree.',
      'Find areas of flexibility: "Where can you be flexible, and where is your core non-negotiable?"',
    ],
  },
  {
    id: 'gottman-love-maps',
    framework: 'gottman-method',
    name: 'Love Maps',
    description: 'A Love Map is each partner\'s knowledge of the other\'s inner world — their fears, dreams, stresses, joys, history, and preferences. Couples with detailed Love Maps are better equipped to handle conflict and life transitions because they know what matters to their partner.',
    whenToUse: 'When partners seem disconnected, make wrong assumptions about each other, or don\'t know each other\'s current stresses and hopes.',
  },

  // ── Emotionally Focused Therapy (EFT) ─────────────────────────
  {
    id: 'eft-negative-cycle',
    framework: 'emotionally-focused-therapy',
    name: 'Negative Cycle Identification',
    description: 'In EFT, the "enemy" is not either partner but the negative cycle they are trapped in. Common cycles: Pursue-Withdraw (one chases, one retreats), Attack-Attack (mutual escalation), Withdraw-Withdraw (mutual shutdown). The cycle is driven by unmet attachment needs.',
    whenToUse: 'When partners are locked in a repeating pattern where each person\'s reaction triggers the other\'s reaction in a predictable loop.',
    steps: [
      'Map the cycle: "When you [action], your partner tends to [reaction]. Then you respond with [reaction], and it goes around."',
      'Name it externally: "This is the cycle — it\'s the thing pushing you apart, not each other."',
      'Identify the emotion underneath: "What happens inside you right before you [pursue/withdraw]?"',
      'Connect to attachment need: "What are you really needing from your partner in that moment?"',
    ],
  },
  {
    id: 'eft-attachment-styles',
    framework: 'emotionally-focused-therapy',
    name: 'Attachment Style Awareness',
    description: 'Understanding each partner\'s attachment style helps decode their conflict behavior. Secure: comfortable with closeness and independence. Anxious (preoccupied): fears abandonment, seeks reassurance, may pursue or protest. Avoidant (dismissive): fears engulfment, values independence, may withdraw or shut down. Fearful-avoidant (disorganized): wants closeness but fears it, may alternate between clinging and pushing away.',
    whenToUse: 'When a partner\'s reaction seems disproportionate to the situation — their attachment system is activated. When one partner consistently pursues while the other withdraws.',
  },
  {
    id: 'eft-de-escalation',
    framework: 'emotionally-focused-therapy',
    name: 'EFT De-escalation Steps',
    description: 'The first stage of EFT involves de-escalating the negative cycle by accessing the primary emotions underneath the reactive secondary emotions. Anger is often secondary to fear, sadness, or shame. When partners can access and share their primary emotions, the other partner can respond with empathy.',
    whenToUse: 'When the couple is in an escalated state and needs to slow down, access deeper emotions, and break out of their reactive cycle.',
    steps: [
      'Slow the process: "Let\'s slow this down for a moment."',
      'Validate secondary emotion: "I can see you\'re really angry right now."',
      'Reach for primary emotion: "What\'s underneath the anger? Is there fear? Sadness? Hurt?"',
      'Reflect the primary emotion: "So underneath the frustration, you\'re actually feeling scared that [attachment fear]."',
      'Turn to the other partner: "Can you hear that? When [partner] gets angry, they\'re actually scared that [fear]."',
      'Invite empathic response: "What happens inside you when you hear that?"',
    ],
  },
  {
    id: 'eft-attachment-injury',
    framework: 'emotionally-focused-therapy',
    name: 'Attachment Injury Repair',
    description: 'An attachment injury is a specific event where one partner failed to respond to the other\'s critical need for comfort, connection, or support (e.g., not being there during a miscarriage, betrayal, or crisis). These wounds remain raw until explicitly addressed and healed.',
    whenToUse: 'When a partner keeps returning to a specific past event as evidence that they cannot trust their partner. When the hurt is disproportionate to the current situation because it is connected to an unhealed wound.',
    steps: [
      'Allow the injured partner to describe the injury and its impact',
      'Help the offending partner stay present and hear the pain without defending',
      'Guide the offending partner to acknowledge the injury and express genuine remorse',
      'Facilitate a new, healing interaction around the injury',
      'Integrate the healing into the couple\'s new narrative',
    ],
  },

  // ── Cognitive Behavioral Therapy (CBT) ────────────────────────
  {
    id: 'cbt-cognitive-distortions',
    framework: 'cbt-couples',
    name: 'Cognitive Distortions in Relationships',
    description: 'Common cognitive distortions that fuel relationship conflict: Mind-Reading (assuming you know what your partner thinks/feels without asking), Catastrophizing (predicting the worst outcome: "If we can\'t agree on this, we\'ll end up divorced"), Black-and-White Thinking (all-or-nothing: "You ALWAYS do this" / "You NEVER listen"), Personalization (taking everything as a personal attack), Emotional Reasoning (feeling it, so it must be true: "I feel unloved, so you don\'t love me"), Fortune-Telling (predicting negative future without evidence), Should Statements ("You should know what I need without me saying it"), Labeling (reducing partner to a label: "You\'re selfish" instead of "That action felt selfish to me").',
    whenToUse: 'When a partner makes absolute statements, attributes malicious intent, predicts catastrophic outcomes, or reasons from emotions rather than evidence.',
    steps: [
      'Identify the distortion: "I notice a thought pattern there — that sounds like [mind-reading/catastrophizing/etc.]."',
      'Gently challenge: "What evidence do you have for that thought? What evidence against it?"',
      'Reframe: "What\'s another way to interpret this situation?"',
      'Test the thought: "If you asked your partner directly, what might they say?"',
    ],
  },
  {
    id: 'cbt-thought-records',
    framework: 'cbt-couples',
    name: 'Couples Thought Record',
    description: 'A structured exercise for examining automatic negative thoughts about the partner or relationship. Columns: (1) Triggering Situation, (2) Automatic Thought, (3) Emotion & Intensity (0-100), (4) Evidence For, (5) Evidence Against, (6) Balanced Thought, (7) New Emotion & Intensity.',
    whenToUse: 'When a partner has a strong negative reaction based on interpretation rather than evidence. When the same thought patterns keep driving the same conflicts.',
  },
  {
    id: 'cbt-behavioral-exchange',
    framework: 'cbt-couples',
    name: 'Behavioral Exchange / Positive Reciprocity',
    description: 'Breaking the cycle of mutual negativity by deliberately increasing positive behaviors. Each partner identifies specific, concrete positive actions they can take for the other. Focus on behaviors, not feelings (you can control actions, not emotions).',
    whenToUse: 'When the couple is stuck in a pattern of mutual criticism and negativity. When both partners focus only on what the other does wrong.',
    steps: [
      'Each partner lists 5 small, specific things the other could do that would feel caring.',
      'Each partner commits to doing 2-3 items from their partner\'s list this week.',
      'Track follow-through without keeping score against each other.',
      'Review next session: what worked? What felt good to receive?',
    ],
  },

  // ── Narrative Therapy ─────────────────────────────────────────
  {
    id: 'narrative-externalization',
    framework: 'narrative-therapy',
    name: 'Externalization',
    description: 'Separating the problem from the person. Instead of "You are angry," say "The anger took over." Instead of "We have a bad relationship," say "This pattern has been getting in the way of our relationship." This reduces shame and defensiveness, making it easier to collaborate against the problem.',
    whenToUse: 'When partners identify each other (or themselves) as the problem. When shame or blame is preventing productive discussion.',
    steps: [
      'Name the problem as an external entity: "Let\'s give this pattern a name."',
      'Map its influence: "When does [the pattern] show up? How does it affect each of you?"',
      'Explore agency: "Are there times when [the pattern] tried to take over but you resisted?"',
      'Build a counter-narrative: "What does your relationship look like when [the pattern] is not in charge?"',
    ],
  },
  {
    id: 'narrative-unique-outcomes',
    framework: 'narrative-therapy',
    name: 'Unique Outcomes / Exceptions',
    description: 'Identifying moments when the problem did NOT dominate — times of connection, successful conflict resolution, humor, or coping. These exceptions are evidence that the couple has the skills to overcome the problem; they just need to expand these moments.',
    whenToUse: 'When the couple feels hopeless or defines their relationship solely by its problems. When they cannot see any positive moments.',
  },

  // ── Solution-Focused Brief Therapy ────────────────────────────
  {
    id: 'sfbt-miracle-question',
    framework: 'solution-focused',
    name: 'The Miracle Question',
    description: 'A signature SFBT intervention: "Suppose tonight while you sleep, a miracle happens and this problem is completely resolved. You don\'t know it happened because you were sleeping. When you wake up tomorrow, what is the first small thing you would notice that tells you the miracle happened?" This bypasses resistance and helps couples envision their desired future.',
    whenToUse: 'When the couple is stuck in problem talk with no vision of what "better" looks like. When they need to shift from focusing on what\'s wrong to what they want.',
  },
  {
    id: 'sfbt-scaling-questions',
    framework: 'solution-focused',
    name: 'Scaling Questions',
    description: 'On a scale of 1-10 (where 10 is the best your relationship has been and 1 is the worst), where are you today? What would move you up just one point? This creates concrete, measurable micro-goals and helps track progress.',
    whenToUse: 'When measuring progress, setting micro-goals, or when the couple needs a concrete way to see that things are improving (or identify what small change would help).',
  },
  {
    id: 'sfbt-exception-finding',
    framework: 'solution-focused',
    name: 'Exception Finding',
    description: 'When was the last time this problem did NOT happen? What was different about that time? What were you doing differently? This reveals the couple\'s existing resources and solutions that they may not recognize.',
    whenToUse: 'When partners believe the problem is constant and unchangeable. When they need evidence that they already have coping strategies.',
  },

  // ── Trauma-Informed Care ──────────────────────────────────────
  {
    id: 'trauma-window-of-tolerance',
    framework: 'trauma-informed',
    name: 'Window of Tolerance',
    description: 'The "window of tolerance" is the zone where a person can process information and emotions effectively. Above it: hyperarousal (anxiety, panic, anger, hypervigilance). Below it: hypoarousal (numbness, dissociation, shutdown, collapse). Trauma narrows this window. In couples therapy, when one partner leaves their window, productive conversation stops.',
    whenToUse: 'When a partner shows signs of panic, rage, dissociation, numbness, or emotional shutdown. When a discussion triggers a trauma response.',
    steps: [
      'Recognize the dysregulation: "I notice your body seems to be responding strongly right now."',
      'Name the zone: "It looks like you might be outside your window of tolerance."',
      'Offer grounding: "Let\'s pause and do a quick grounding exercise together."',
      'Do not push content: "We don\'t need to continue this topic right now. Your safety is more important."',
    ],
  },
  {
    id: 'trauma-grounding-exercises',
    framework: 'trauma-informed',
    name: 'Grounding Exercises (5-4-3-2-1)',
    description: 'The 5-4-3-2-1 technique brings a person back to the present moment: Name 5 things you can SEE, 4 things you can TOUCH, 3 things you can HEAR, 2 things you can SMELL, 1 thing you can TASTE. Also: box breathing (inhale 4 counts, hold 4, exhale 4, hold 4).',
    whenToUse: 'When a partner is flooded, dissociating, or experiencing a trauma response. When someone needs to return to their window of tolerance before continuing.',
  },
  {
    id: 'trauma-safety-assessment',
    framework: 'trauma-informed',
    name: 'Safety Assessment',
    description: 'Evaluate both physical and emotional safety. Physical safety: Is anyone at risk of harm? Emotional safety: Does each partner feel safe enough to be vulnerable? If either type of safety is compromised, it must be addressed before therapeutic work can continue.',
    whenToUse: 'When trauma responses are triggered, when discussion touches on past abuse, when there are any indicators of current danger or coercion.',
    redLine: true,
  },

  // ── Psychodynamic ─────────────────────────────────────────────
  {
    id: 'psychodynamic-family-of-origin',
    framework: 'psychodynamic',
    name: 'Family-of-Origin Pattern Analysis',
    description: 'Current relationship dynamics often mirror patterns learned in the family of origin. A person who grew up with an emotionally unavailable parent may marry someone emotionally unavailable — or may become hypersensitive to any perceived emotional distance. Connecting present reactions to past patterns creates insight.',
    whenToUse: 'When a partner\'s reaction seems disproportionate to the current situation. When patterns from childhood or past relationships keep repeating.',
    steps: [
      'Notice the pattern: "This reaction feels bigger than just this moment."',
      'Explore the origin: "Does this remind you of anything from growing up?"',
      'Connect: "So when [partner] does X, it might feel like [childhood experience] happening again."',
      'Differentiate: "Your partner is not your parent. Can we separate past from present here?"',
    ],
  },
  {
    id: 'psychodynamic-defense-mechanisms',
    framework: 'psychodynamic',
    name: 'Defense Mechanism Identification',
    description: 'Common defense mechanisms in couples: Projection (attributing your own feelings to your partner: "You\'re the angry one"), Displacement (taking feelings from one context to another: angry at boss, snapping at partner), Intellectualization (avoiding emotion by going into logic/analysis mode), Denial (refusing to acknowledge a problem), Reaction Formation (behaving opposite to true feelings).',
    whenToUse: 'When a partner attributes their own feelings to the other (projection), avoids emotion through logic (intellectualization), or takes out external stress on the partner (displacement).',
  },

  // ── Imago Therapy ─────────────────────────────────────────────
  {
    id: 'imago-dialogue',
    framework: 'imago-therapy',
    name: 'Imago Dialogue Process',
    description: 'A structured three-step communication process: (1) Mirroring — "What I hear you saying is... Did I get that? Is there more?" (2) Validation — "That makes sense because..." (3) Empathy — "I imagine you might be feeling..." The listener focuses on understanding, not responding.',
    whenToUse: 'When partners need a safe, structured way to truly hear each other. When conversations keep going off track or escalating. When one or both partners feel chronically unheard.',
    steps: [
      'Sender shares using "I" statements (2-3 sentences at a time)',
      'Receiver mirrors: "What I hear you saying is... Did I get that?"',
      'Sender confirms or clarifies, then: "Is there more?"',
      'After full sharing, Receiver validates: "That makes sense because..."',
      'Receiver empathizes: "I imagine you might be feeling..."',
      'Switch roles and repeat',
    ],
  },
  {
    id: 'imago-childhood-wounds',
    framework: 'imago-therapy',
    name: 'Childhood Wound Exploration',
    description: 'In Imago theory, we are unconsciously attracted to partners who resemble our caregivers — both positive and negative traits. Current frustrations often connect to unmet childhood needs. When a partner triggers an outsized reaction, it is often because the wound is old and deep.',
    whenToUse: 'When a partner has an outsized emotional reaction suggesting a deeper, older wound. When the same issue keeps triggering intense pain beyond what the current situation warrants.',
  },

  // ── Cross-Framework: Love Languages ───────────────────────────
  {
    id: 'love-languages-assessment',
    framework: 'integrative',
    name: 'Love Language Mapping',
    description: 'The five love languages (Chapman): Words of Affirmation, Quality Time, Receiving Gifts, Acts of Service, Physical Touch. Partners often express love in their own language and feel unloved when their partner uses a different one. Mapping each partner\'s primary love language reduces the "I do so much and they don\'t appreciate it" dynamic.',
    whenToUse: 'When partners feel unappreciated despite the other\'s efforts. When there is a mismatch between how each person gives and receives love.',
  },

  // ── Cross-Framework: Communication ────────────────────────────
  {
    id: 'communication-active-listening',
    framework: 'integrative',
    name: 'Active Listening Protocol',
    description: 'Active listening involves: full attention (no devices), reflecting back what you heard, asking clarifying questions, validating the emotion even if you disagree with the content, and not preparing your response while the other person is speaking.',
    whenToUse: 'When partners talk over each other, when one partner feels chronically unheard, when conversations keep going in circles.',
  },
  {
    id: 'communication-nonviolent',
    framework: 'integrative',
    name: 'Nonviolent Communication (NVC)',
    description: 'Marshall Rosenberg\'s NVC framework: (1) Observation — describe what happened without evaluation, (2) Feeling — name your emotion, (3) Need — identify the unmet need, (4) Request — make a clear, positive, specific request. Example: "When I see dishes in the sink (observation), I feel frustrated (feeling) because I need shared responsibility (need). Would you be willing to do the dishes after dinner? (request)"',
    whenToUse: 'When partners struggle to express needs without blame. When conversations escalate because complaints are delivered as attacks.',
    steps: [
      'Observe without evaluating: "When I notice [specific behavior]..."',
      'Name the feeling: "I feel [emotion]..."',
      'Connect to the need: "Because I need [need]..."',
      'Make a request: "Would you be willing to [specific action]?"',
    ],
  },

  // ── Red Line Protocols ────────────────────────────────────────
  {
    id: 'redline-safety-plan',
    framework: 'crisis-intervention',
    name: 'Safety Planning Protocol',
    description: 'When indicators of abuse, self-harm, or imminent danger are detected, the AI must: (1) Acknowledge the seriousness, (2) NOT attempt to do therapy around the crisis, (3) Provide crisis resources immediately, (4) Recommend professional human intervention.',
    whenToUse: 'When any safety flags are detected: domestic violence indicators, self-harm, suicidal ideation, child abuse, substance crisis.',
    redLine: true,
    steps: [
      'STOP therapeutic technique exploration',
      'Acknowledge: "What you\'re describing sounds serious and I want to make sure you\'re safe."',
      'Provide resources: crisis hotlines, safety planning tools',
      'Recommend: "Please reach out to a professional who can help with this directly."',
      'Do NOT attempt to be the crisis intervention — defer to human professionals',
    ],
  },
  {
    id: 'redline-abuse-indicators',
    framework: 'crisis-intervention',
    name: 'Abuse Pattern Recognition',
    description: 'Indicators that the relationship may involve abuse rather than mutual conflict: Power imbalance (one partner controls finances, social contacts, movement), Fear (one partner is afraid of the other), Escalating physical violence, Isolation from support systems, Monitoring/surveillance behavior, Threats to children or pets, Forced sexual contact.',
    whenToUse: 'When patterns suggest abuse rather than mutual conflict. Couples therapy can be harmful in abusive relationships because it can give the abuser more tools for manipulation.',
    redLine: true,
  },
];

// ─── Clinical Knowledge Base Class ──────────────────────────────────

const CLINICAL_EMBEDDING_DIMS = 256;

export class ClinicalKnowledgeBase {
  private vectorStore: VectorStore;
  private embedder: TFIDFEmbedder;
  private protocols: Map<string, ClinicalProtocol> = new Map();
  private initialized: boolean = false;

  constructor() {
    this.vectorStore = new VectorStore({
      dimensions: CLINICAL_EMBEDDING_DIMS,
      readonly: true,
    });
    this.embedder = new TFIDFEmbedder({
      dimensions: CLINICAL_EMBEDDING_DIMS,
      useBigrams: true,
      useTrigrams: true,
    });
  }

  /** Initialize the knowledge base with all clinical protocols */
  initialize(): void {
    if (this.initialized) return;

    // Store protocols in lookup map
    for (const protocol of CLINICAL_PROTOCOLS) {
      this.protocols.set(protocol.id, protocol);
    }

    // Build training corpus from all protocol text
    const corpus = CLINICAL_PROTOCOLS.map(p => this.protocolToText(p));

    // Fit the embedder on the clinical corpus
    this.embedder.fit(corpus);

    // Create vector documents for each protocol
    const docs: VectorDocument[] = CLINICAL_PROTOCOLS.map((protocol, idx) => ({
      id: protocol.id,
      embedding: this.embedder.embed(corpus[idx]),
      content: corpus[idx],
      metadata: {
        framework: protocol.framework,
        name: protocol.name,
        redLine: protocol.redLine ?? false,
        hasSteps: (protocol.steps?.length ?? 0) > 0,
        hasAntidote: !!protocol.antidote,
      },
    }));

    // Load into the readonly vector store
    this.vectorStore.load(docs);
    this.initialized = true;

    console.log(`[ClinicalKB] Initialized with ${this.vectorStore.size} protocols, vocabulary size: ${this.embedder.vocabSize}`);
  }

  /**
   * Search the clinical knowledge base for protocols relevant to a query.
   *
   * @param query - The clinical situation to search for (e.g., "partner is using contempt and sarcasm")
   * @param topK - Maximum results to return
   * @param minScore - Minimum relevance threshold
   * @param framework - Optional filter to specific therapeutic framework
   */
  search(
    query: string,
    topK: number = 5,
    minScore: number = 0.1,
    framework?: string,
  ): ClinicalSearchResult[] {
    this.ensureInitialized();

    const queryEmbedding = this.embedder.embed(query);
    const filters = framework
      ? [{ field: 'framework', value: framework }]
      : undefined;

    const results = this.vectorStore.search(queryEmbedding, topK, minScore, filters);

    return results.map(r => ({
      protocol: this.protocols.get(r.id)!,
      relevanceScore: r.score,
    }));
  }

  /** Search specifically for red-line (crisis) protocols */
  searchRedLine(query: string, topK: number = 3): ClinicalSearchResult[] {
    this.ensureInitialized();

    const queryEmbedding = this.embedder.embed(query);
    const results = this.vectorStore.search(
      queryEmbedding,
      topK,
      0.05,
      [{ field: 'redLine', value: true }],
    );

    return results.map(r => ({
      protocol: this.protocols.get(r.id)!,
      relevanceScore: r.score,
    }));
  }

  /** Get a specific protocol by ID */
  getProtocol(id: string): ClinicalProtocol | undefined {
    return this.protocols.get(id);
  }

  /** Get all protocols for a specific framework */
  getFrameworkProtocols(framework: string): ClinicalProtocol[] {
    return CLINICAL_PROTOCOLS.filter(p => p.framework === framework);
  }

  /** Get all protocol IDs */
  getAllProtocolIds(): string[] {
    return CLINICAL_PROTOCOLS.map(p => p.id);
  }

  /** Get the number of protocols */
  get protocolCount(): number {
    return CLINICAL_PROTOCOLS.length;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** Format search results for LLM context injection */
  formatForContext(results: ClinicalSearchResult[], maxProtocols: number = 3): string {
    if (results.length === 0) return '';

    const parts: string[] = [];
    const topResults = results.slice(0, maxProtocols);

    for (const { protocol, relevanceScore } of topResults) {
      parts.push(`[${protocol.framework}] ${protocol.name} (relevance: ${Math.round(relevanceScore * 100)}%)`);
      parts.push(`  ${protocol.description}`);
      if (protocol.antidote) {
        parts.push(`  Antidote: ${protocol.antidote}`);
      }
      if (protocol.steps && protocol.steps.length > 0) {
        parts.push(`  Steps:`);
        for (const step of protocol.steps) {
          parts.push(`    - ${step}`);
        }
      }
      parts.push(`  When to use: ${protocol.whenToUse}`);
    }

    return parts.join('\n');
  }

  // ── Internal ──────────────────────────────────────────────────

  private protocolToText(protocol: ClinicalProtocol): string {
    const parts = [
      protocol.framework,
      protocol.name,
      protocol.description,
      protocol.whenToUse,
    ];
    if (protocol.antidote) parts.push(protocol.antidote);
    if (protocol.steps) parts.push(protocol.steps.join(' '));
    return parts.join(' ');
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

let clinicalKBInstance: ClinicalKnowledgeBase | null = null;

export function getClinicalKnowledgeBase(): ClinicalKnowledgeBase {
  if (!clinicalKBInstance) {
    clinicalKBInstance = new ClinicalKnowledgeBase();
    clinicalKBInstance.initialize();
  }
  return clinicalKBInstance;
}
