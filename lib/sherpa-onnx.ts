import * as sherpa from 'sherpa-onnx-node';
import { SpeakerDatabase, SpeakerProfile, SpeakerPrototype } from '@/types';
import {
  SpeakerIdentifier,
  buildEnrolledSpeakers,
  configFromEnv,
  l2normalize,
  centroid,
} from './speaker-identification';
import { computeIntraClassTightness } from './domain/speaker-profile';
import {
  REQUIRED_CONDITIONS,
  gateRecording,
  validateEnergySeparation,
  assessCoverage,
  assessConfusable,
  conditionsPresent,
  computeEnrollmentStatus,
  meanRmsForCondition,
  replaceConditionPrototypes,
  type RecordingMetrics,
  type EnrollmentCondition,
  type CoverageWarning,
} from './domain/enrollment';
import { EMBEDDING_MODEL_ID } from './embedding-config';
import * as fs from 'fs';
import * as path from 'path';

// ─── Enrollment audio metrics (pure-ish signal helpers) ─────────────────────

/** Root-mean-square of a sample buffer. */
function bufferRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Fraction of samples at/near full scale (clipping indicator). */
function clippingFraction(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= 0.99) clipped++;
  return clipped / samples.length;
}

/** Quality score 0..1 from SNR, clipping and how full the analysis window is. */
function windowQuality(snrDb: number, clipFrac: number, windowSec: number, fullWindowSec: number): number {
  const snrScore = Math.max(0, Math.min(1, (snrDb - 5) / 25)); // 5 dB→0, 30 dB→1
  const clipScore = Math.max(0, 1 - clipFrac / 0.02); // 2% clipping→0
  const lenScore = Math.max(0, Math.min(1, windowSec / fullWindowSec));
  return Math.max(0, Math.min(1, 0.6 * snrScore + 0.25 * clipScore + 0.15 * lenScore));
}

/** Result of extracting prototypes from one labeled condition recording. */
export interface ConditionExtraction {
  prototypes: SpeakerPrototype[];
  metrics: RecordingMetrics;
}

/** Outcome of enrolling one condition recording. */
export interface EnrollConditionResult {
  accepted: boolean;
  condition: EnrollmentCondition;
  reason?: string;
  prototypesAdded?: number;
  conditionsPresent?: string[];
  status?: 'incomplete' | 'complete';
}

/** Outcome of finalizing a speaker's enrollment. */
export interface FinalizeEnrollmentResult {
  finalized: boolean;
  status?: 'incomplete' | 'complete';
  missing?: string[];
  tightness?: number;
  warnings?: CoverageWarning[];
  reason?: string;
}

export class VADManager {
  private vad: any = null;
  private modelPath: string;

  constructor(modelPath: string = './models') {
    this.modelPath = modelPath;
  }

  async initialize(): Promise<void> {
    try {
      const config = {
        sileroVad: {
          model: path.join(this.modelPath, 'silero_vad.onnx'),
          minSilenceDuration: 0.15,
          minSpeechDuration: 0.25,
          threshold: 0.35,
          windowSize: 512,
        },
        sampleRate: 16000,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      };

      // Second parameter is buffer size in seconds
      this.vad = new sherpa.Vad(config, 200);

      if (!this.vad) {
        throw new Error('Failed to create VAD instance');
      }

      console.log('VAD initialized successfully');
    } catch (error) {
      console.error('Failed to initialize VAD:', error);
      throw error;
    }
  }

  /**
   * Check if audio file contains speech
   */
  async hasSpeech(audioPath: string): Promise<boolean> {
    if (!this.vad) {
      throw new Error('VAD not initialized');
    }

    try {
      const wave = sherpa.readWave(audioPath);

      if (!wave || !wave.samples) {
        throw new Error(`Failed to read audio file: ${audioPath}`);
      }

      // Ensure samples is Float32Array
      const samples = wave.samples instanceof Float32Array
        ? wave.samples
        : new Float32Array(wave.samples);

      // Process all audio samples
      this.vad.acceptWaveform(samples);
      this.vad.flush();

      // Check if any speech segments were detected
      const hasSpeech = !this.vad.isEmpty();

      // Clear the VAD buffer
      while (!this.vad.isEmpty()) {
        this.vad.pop();
      }

      return hasSpeech;
    } catch (error) {
      console.error('Failed to detect speech:', error);
      return false;
    }
  }

  /**
   * Get speech segments from audio file
   * Returns array of [start_time, end_time] in seconds
   *
   * Uses chunked processing: feeds audio in windowSize chunks and pops
   * completed segments as they become available. This avoids circular
   * buffer corruption that occurs when feeding all samples at once.
   */
  async getSpeechSegments(audioPath: string): Promise<Array<[number, number]>> {
    if (!this.vad) {
      throw new Error('VAD not initialized');
    }

    try {
      const wave = sherpa.readWave(audioPath);

      if (!wave || !wave.samples) {
        throw new Error(`Failed to read audio file: ${audioPath}`);
      }

      // Ensure samples is Float32Array
      const samples = wave.samples instanceof Float32Array
        ? wave.samples
        : new Float32Array(wave.samples);

      const sampleRate = wave.sampleRate;
      const windowSize = 512; // Must match config
      const segments: Array<[number, number]> = [];

      const popSegments = () => {
        while (!this.vad.isEmpty()) {
          const segment = this.vad.front();
          this.vad.pop();

          const startTime = segment.start / sampleRate;
          const duration = segment.samples.length / sampleRate;
          const endTime = startTime + duration;

          console.log(`VAD segment: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s (${duration.toFixed(2)}s)`);
          segments.push([startTime, endTime]);
        }
      };

      // Feed audio in windowSize chunks (canonical sherpa-onnx pattern)
      for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
        const chunk = samples.subarray(i, i + windowSize);
        this.vad.acceptWaveform(chunk);
        // Pop completed segments as they become available
        popSegments();
      }

      // Flush remaining audio and pop final segments
      this.vad.flush();
      popSegments();

      console.log(`VAD total: ${segments.length} speech segments detected`);
      return segments;
    } catch (error) {
      console.error('Failed to get speech segments:', error);
      return [];
    }
  }

  cleanup(): void {
    if (this.vad) {
      // VAD cleanup - no free() method needed, just set to null
      this.vad = null;
    }
  }
}

export class SherpaONNXManager {
  private recognizer: any = null;
  private speakerEmbedding: any = null;
  private speakerManager: any = null; // Use SpeakerEmbeddingManager for recognition
  private speakerDatabase: SpeakerDatabase | null = null; // Keep for enrollment script compatibility
  private speakerIdentifier: SpeakerIdentifier | null = null; // strict cosine identifier (recognition)
  private modelPath: string;

  constructor(modelPath: string = './models') {
    this.modelPath = modelPath;
  }

  async initializeRecognizer(): Promise<void> {
    try {
      // Initialize speech recognition (ASR) using OnlineRecognizer
      // The downloaded models are streaming zipformer models for OnlineRecognizer
      const config = {
        featConfig: {
          sampleRate: 16000,
          featureDim: 80,
        },
        modelConfig: {
          transducer: {
            encoder: path.join(this.modelPath, 'encoder.onnx'),
            decoder: path.join(this.modelPath, 'decoder.onnx'),
            joiner: path.join(this.modelPath, 'joiner.onnx'),
          },
          tokens: path.join(this.modelPath, 'tokens.txt'),
          numThreads: 1,
          provider: 'cpu',
          debug: 1,  // Enable debug for troubleshooting
        },
      };

      this.recognizer = new sherpa.OnlineRecognizer(config);
      console.log('OnlineRecognizer initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Sherpa-ONNX recognizer:', error);
      throw error;
    }
  }

  async initializeSpeakerEmbedding(): Promise<void> {
    try {
      // Initialize speaker embedding model for speaker ID
      const config = {
        model: path.join(this.modelPath, 'speaker-embedding.onnx'),
        numThreads: 1,
        debug: 0,
        provider: 'cpu',
      };

      this.speakerEmbedding = new sherpa.SpeakerEmbeddingExtractor(config);

      if (!this.speakerEmbedding) {
        throw new Error('Failed to create speaker embedding extractor');
      }

      // Create SpeakerEmbeddingManager with the extractor's dimension
      this.speakerManager = new sherpa.SpeakerEmbeddingManager(this.speakerEmbedding.dim);

      console.log(`Speaker embedding extractor created. Dimension: ${this.speakerEmbedding.dim}`);
      console.log(`Speaker embedding manager initialized`);
    } catch (error) {
      console.error('Failed to initialize speaker embedding:', error);
      throw error;
    }
  }

  async loadSpeakerDatabase(dbPath: string, loadToManager: boolean = true): Promise<void> {
    try {
      const data = await fs.promises.readFile(dbPath, 'utf-8');
      this.speakerDatabase = JSON.parse(data);
      this.speakerIdentifier = null; // rebuild lazily from the freshly loaded DB

      console.log(`Loading speaker database: ${this.speakerDatabase!.speakers.length} speakers`);

      // Only load into manager if requested (for recognition, not enrollment)
      if (loadToManager && this.speakerManager) {
        // Add each speaker to the SpeakerEmbeddingManager using addMulti()
        for (const speaker of this.speakerDatabase!.speakers) {
          const voiceprint = new Float32Array(speaker.voiceprint);
          // Use name field if available, fall back to role for backward compat
          const displayName = speaker.name || speaker.role;

          const success = this.speakerManager.addMulti({
            name: displayName,
            v: [voiceprint],
          });

          if (success) {
            console.log(`  ✅ Loaded ${displayName} (${speaker.id})`);
          } else {
            console.warn(`  ❌ Failed to load ${displayName}`);
          }
        }

        console.log(`Speaker manager now has ${this.speakerManager.getNumSpeakers()} speakers`);
      } else {
        console.log('Database loaded to memory only (not to manager)');
      }
    } catch (error) {
      console.log(error);
      console.warn('Speaker database not found or failed to load');
      this.speakerDatabase = {
        speakers: [],
        modelVersion: '1.0.0',
        createdAt: Date.now(),
      };
      console.log('Speaker database initialized as empty');
    }
  }

  async saveSpeakerDatabase(dbPath: string): Promise<void> {
    if (!this.speakerDatabase) {
      throw new Error('No speaker database to save');
    }

    await fs.promises.writeFile(
      dbPath,
      JSON.stringify(this.speakerDatabase, null, 2),
      'utf-8'
    );
  }

  async extractVoiceprintFromSamples(samples: Float32Array, sampleRate: number = 16000): Promise<number[]> {
    if (!this.speakerEmbedding) {
      throw new Error('Speaker embedding model not initialized');
    }

    const stream = this.speakerEmbedding.createStream();
    if (!stream) {
      throw new Error('Failed to create speaker embedding stream');
    }

    stream.acceptWaveform({ sampleRate, samples });
    stream.inputFinished();

    if (!this.speakerEmbedding.isReady(stream)) {
      throw new Error('Speaker embedding stream is not ready - audio too short');
    }

    const embedding = this.speakerEmbedding.compute(stream);
    if (!embedding || embedding.length === 0) {
      throw new Error('Failed to compute speaker embedding');
    }

    return Array.from(embedding);
  }

  async extractVoiceprint(audioPath: string): Promise<number[]> {
    if (!this.speakerEmbedding) {
      throw new Error('Speaker embedding model not initialized');
    }

    try {
      // Read audio file using sherpa-onnx's readWave function
      const wave = sherpa.readWave(audioPath);

      if (!wave || !wave.samples) {
        throw new Error(`Failed to read audio file: ${audioPath}`);
      }

      // Create a stream for the speaker embedding
      const stream = this.speakerEmbedding.createStream();

      if (!stream) {
        throw new Error('Failed to create speaker embedding stream');
      }

      // Accept waveform
      stream.acceptWaveform({
        sampleRate: wave.sampleRate,
        samples: wave.samples,
      });

      // Input is finished
      stream.inputFinished();

      // Check if stream is ready
      if (!this.speakerEmbedding.isReady(stream)) {
        throw new Error('Speaker embedding stream is not ready');
      }

      // Compute embedding
      const embedding = this.speakerEmbedding.compute(stream);

      if (!embedding || embedding.length === 0) {
        throw new Error('Failed to compute speaker embedding');
      }

      // Stream cleanup - no free() method needed, will be garbage collected

      return Array.from(embedding);
    } catch (error) {
      console.error('Failed to extract voiceprint:', error);
      throw error;
    }
  }

  // ─── Guided multi-condition enrollment (writes the new prototype schema) ───

  /**
   * Extract prototypes from ONE labeled condition recording. VAD-gates the clip
   * (silence/non-speech excluded), slides 3 s / 1.5 s windows within voiced
   * regions, embeds + normalizes each, and tags every prototype with this
   * recording's `condition`, quality, duration and RMS. Also returns the
   * recording-level metrics the pure gating/energy checks consume.
   *
   * Replaces the old `extractEnrollmentEmbeddings` (whole-clip slicing, no VAD,
   * no quality) — that method is retained only until the route is reshaped.
   */
  async extractConditionPrototypes(
    audioPath: string,
    condition: EnrollmentCondition,
  ): Promise<ConditionExtraction> {
    if (!this.speakerEmbedding) {
      throw new Error('Speaker embedding model not initialized');
    }
    const wave = sherpa.readWave(audioPath);
    if (!wave || !wave.samples) throw new Error(`Failed to read audio file: ${audioPath}`);
    const samples: Float32Array =
      wave.samples instanceof Float32Array ? wave.samples : new Float32Array(wave.samples);
    const sr: number = wave.sampleRate;

    // VAD: voiced segments [start,end] in seconds.
    const vad = new VADManager(this.modelPath);
    await vad.initialize();
    const segments = await vad.getSpeechSegments(audioPath);
    vad.cleanup();

    // Noise floor: RMS over the NON-voiced span (for SNR). Build a voiced mask.
    const voicedMask = new Uint8Array(samples.length);
    let voicedCount = 0;
    for (const [s, e] of segments) {
      const a = Math.max(0, Math.floor(s * sr));
      const b = Math.min(samples.length, Math.floor(e * sr));
      for (let i = a; i < b; i++) {
        if (!voicedMask[i]) voicedCount++;
        voicedMask[i] = 1;
      }
    }
    let voicedSumSq = 0;
    let noiseSumSq = 0;
    let noiseCount = 0;
    for (let i = 0; i < samples.length; i++) {
      const sq = samples[i] * samples[i];
      if (voicedMask[i]) voicedSumSq += sq;
      else {
        noiseSumSq += sq;
        noiseCount++;
      }
    }
    const voicedRms = voicedCount > 0 ? Math.sqrt(voicedSumSq / voicedCount) : 0;
    const noiseRms = noiseCount > 0 ? Math.sqrt(noiseSumSq / noiseCount) : 1e-6;
    const snrDb = 20 * Math.log10(Math.max(voicedRms, 1e-9) / Math.max(noiseRms, 1e-9));
    const voicedSec = voicedCount / sr;
    const clipFrac = clippingFraction(samples);

    const metrics: RecordingMetrics = {
      condition,
      voicedSec,
      snrDb,
      clippingFraction: clipFrac,
      rms: voicedRms,
    };

    // Slide windows WITHIN each voiced segment; reject low-quality windows.
    const fullWindowSec = 3.0;
    const win = Math.floor(fullWindowSec * sr);
    const hop = Math.floor(1.5 * sr);
    const now = Date.now();
    const prototypes: SpeakerPrototype[] = [];

    for (const [segStart, segEnd] of segments) {
      const a = Math.max(0, Math.floor(segStart * sr));
      const b = Math.min(samples.length, Math.floor(segEnd * sr));
      if (b - a < Math.floor(1.0 * sr)) continue; // skip < 1 s voiced fragments

      const starts: number[] = [];
      for (let off = a; off + win <= b; off += hop) starts.push(off);
      // Always include a tail window so the segment end isn't lost.
      if (b - a >= win) starts.push(b - win);
      else starts.push(a); // short segment: one window of whatever voiced audio exists

      for (const start of Array.from(new Set(starts))) {
        const end = Math.min(b, start + win);
        const winSamples = samples.subarray(start, end);
        const winSec = winSamples.length / sr;
        try {
          const raw = await this.extractVoiceprintFromSamples(winSamples, sr);
          const v = Array.from(l2normalize(raw));
          const wq = windowQuality(snrDb, clippingFraction(winSamples), winSec, fullWindowSec);
          if (wq < 0.25) continue; // drop poor windows
          prototypes.push({
            v,
            dim: v.length,
            durationSec: winSec,
            qualityScore: wq,
            rms: bufferRms(winSamples),
            timestamp: now,
            modelVersion: EMBEDDING_MODEL_ID,
            conditions: condition,
            source: 'enrolled',
          });
        } catch {
          // skip a window that failed to embed
        }
      }
    }

    return { prototypes, metrics };
  }

  /**
   * Enroll ONE labeled condition recording. Gates the recording on its own
   * merits, then validates its energy against the stored `normal` sample
   * (loud/soft must actually differ). On success, appends the prototypes to the
   * profile in the NEW schema, recomputes tightness, and marks the profile
   * `incomplete` (it cannot go live until finalize). On failure, the DB is
   * untouched and a redo reason for THIS condition is returned — passed
   * recordings are preserved.
   */
  async enrollCondition(
    speakerId: string,
    name: string,
    audioPath: string,
    condition: EnrollmentCondition,
  ): Promise<EnrollConditionResult> {
    if (!this.speakerDatabase) throw new Error('Speaker database not loaded');

    const { prototypes, metrics } = await this.extractConditionPrototypes(audioPath, condition);
    if (prototypes.length === 0) {
      return { accepted: false, condition, reason: 'No usable speech found in this recording — redo it.' };
    }

    const gate = gateRecording(metrics);
    if (!gate.ok) return { accepted: false, condition, reason: gate.reason };

    const existing = this.speakerDatabase.speakers.find((s) => s.id === speakerId);
    const normalRms = existing?.prototypes
      ? meanRmsForCondition(existing.prototypes, 'normal')
      : null;
    const energy = validateEnergySeparation(condition, metrics.rms, normalRms);
    if (!energy.ok) return { accepted: false, condition, reason: energy.reason };

    const profile: SpeakerProfile =
      existing ?? { id: speakerId, name, role: name, voiceprint: [], prototypes: [] };
    // Replace (not stack) any prior prototypes for this condition, then cap.
    profile.prototypes = replaceConditionPrototypes(profile.prototypes ?? [], prototypes, condition);
    profile.voiceprint = profile.prototypes[0].v; // legacy mirror (field is required)
    profile.name = name;
    profile.role = name;
    profile.schemaVersion = '2.0.0-multiproto';
    profile.stats = {
      ...(profile.stats ?? { cohortMean: 0, cohortStd: 0, cohortVersion: 'none' }),
      intraClassTightness: computeIntraClassTightness(profile.prototypes),
      cohortMean: 0,
      cohortStd: 0,
      cohortVersion: 'none', // AS-Norm recomputes enroll-side stats at load
    };
    profile.enrollmentStatus = 'incomplete';
    if (!existing) this.speakerDatabase.speakers.push(profile);

    const present = conditionsPresent(profile.prototypes);
    return {
      accepted: true,
      condition,
      prototypesAdded: prototypes.length,
      conditionsPresent: present,
      status: 'incomplete',
    };
  }

  /**
   * Finalize a speaker's enrollment: require all conditions present, then run
   * the inverted coverage/tightness assessment + confusable-pair check and mark
   * the profile `complete` (so it becomes eligible for live matching). Warnings
   * are advisory; only missing conditions block completion.
   */
  async finalizeEnrollment(speakerId: string): Promise<FinalizeEnrollmentResult> {
    if (!this.speakerDatabase) throw new Error('Speaker database not loaded');
    const profile = this.speakerDatabase.speakers.find((s) => s.id === speakerId);
    if (!profile || !profile.prototypes || profile.prototypes.length === 0) {
      return { finalized: false, reason: 'Speaker has no recordings.' };
    }

    const present = conditionsPresent(profile.prototypes);
    const status = computeEnrollmentStatus({ conditionsPresent: present, finalized: true });
    if (status !== 'complete') {
      const missing = REQUIRED_CONDITIONS.filter((c) => !present.includes(c));
      return { finalized: false, status: 'incomplete', missing, reason: `Missing condition(s): ${missing.join(', ')}.` };
    }

    const tightness = computeIntraClassTightness(profile.prototypes);
    const warnings = assessCoverage({ tightness, conditionsPresent: present });

    // Confusable check vs other COMPLETE (or legacy) speakers with prototypes.
    const candidateCentroid = Array.from(
      centroid(profile.prototypes.map((p) => l2normalize(p.v))),
    );
    const others = this.speakerDatabase.speakers
      .filter((s) => s.id !== speakerId && s.enrollmentStatus !== 'incomplete' && s.prototypes?.length)
      .map((s) => ({
        id: s.id,
        name: s.name,
        centroid: Array.from(centroid(s.prototypes!.map((p) => l2normalize(p.v)))),
      }));
    warnings.push(
      ...assessConfusable({ candidate: { id: speakerId, name: profile.name, centroid: candidateCentroid }, others }),
    );

    profile.stats = {
      ...(profile.stats ?? { cohortMean: 0, cohortStd: 0, cohortVersion: 'none' }),
      intraClassTightness: tightness,
    };
    profile.enrollmentStatus = 'complete';

    return { finalized: true, status: 'complete', tightness, warnings };
  }

  /**
   * Strict speaker identification via the shared SpeakerIdentifier (cosine +
   * margin + calibrated thresholds). Returns the enrolled name ONLY when the
   * match is confident enough; otherwise null so the caller labels it Unknown.
   * No "best guess" fallback — that was the source of false positives.
   */
  async identifySpeaker(voiceprint: number[]): Promise<string | null> {
    if (!this.speakerDatabase || this.speakerDatabase.speakers.length === 0) {
      return null;
    }
    if (!this.speakerIdentifier) {
      const enrolled = buildEnrolledSpeakers(this.speakerDatabase.speakers);
      // Batch path identifies windows independently, so disable cross-window
      // unknown clustering (it can't carry state reliably here).
      this.speakerIdentifier = new SpeakerIdentifier(enrolled, {
        ...configFromEnv(),
        labelUnknownClusters: false,
      });
    }

    const m = this.speakerIdentifier.identify(voiceprint);
    if (m.decision === 'known') {
      console.log(`✅ Identified ${m.speaker} (score=${m.score.toFixed(2)}; ${m.reason})`);
      return m.speaker;
    }
    console.log(`↪︎ Unknown (${m.reason})`);
    return null;
  }

  async transcribeAudio(audioBuffer: Float32Array): Promise<string> {
    if (!this.recognizer) {
      throw new Error('Recognizer not initialized');
    }

    try {
      // Create a stream for OnlineRecognizer
      const stream = this.recognizer.createStream();

      // Add leading silence for left context (model needs ~128 frames of context)
      // At 10ms frame shift, 128 frames = 1.28s
      const leadingSilence = new Float32Array(16000 * 1.5); // 1.5s of silence

      // Add trailing silence to ensure complete decoding
      const trailingSilence = new Float32Array(16000 * 0.5); // 0.5s of silence

      // Combine: leading silence + audio + trailing silence
      const paddedBuffer = new Float32Array(
        leadingSilence.length + audioBuffer.length + trailingSilence.length
      );
      paddedBuffer.set(leadingSilence, 0);
      paddedBuffer.set(audioBuffer, leadingSilence.length);
      paddedBuffer.set(trailingSilence, leadingSilence.length + audioBuffer.length);

      console.log(`Transcription input: ${audioBuffer.length} samples + ${leadingSilence.length + trailingSilence.length} padding = ${paddedBuffer.length} total`);

      // Accept waveform (feed all audio at once for a complete segment)
      stream.acceptWaveform({
        samples: paddedBuffer,
        sampleRate: 16000,
      });

      // Signal that input is finished
      stream.inputFinished();

      // Decode in a loop while the recognizer is ready
      while (this.recognizer.isReady(stream)) {
        this.recognizer.decode(stream);
      }

      // Get the final result
      const result = this.recognizer.getResult(stream);

      console.log('Transcription result:', result.text || '(empty)');

      // Stream cleanup - no free() method needed, will be garbage collected

      return result.text || '';
    } catch (error) {
      console.error('Failed to transcribe audio:', error);
      return '';
    }
  }

  cleanup(): void {
    if (this.recognizer) {
      // Cleanup recognizer - no free() method needed, just set to null
      this.recognizer = null;
    }
    if (this.speakerEmbedding) {
      // Cleanup speaker embedding - no free() method needed, just set to null
      this.speakerEmbedding = null;
    }
  }

  /**
   * Generates a similarity report for a given voiceprint against the database.
   */
  async generateSimilarityReport(voiceprint: number[]): Promise<Array<{ name: string, score: number }>> {
    if (!this.speakerDatabase) return [];
    
    const results = [];
    const v1 = new Float32Array(voiceprint);

    for (const speaker of this.speakerDatabase.speakers) {
      const v2 = new Float32Array(speaker.voiceprint);
      
      // Manual Cosine Similarity
      let dotProduct = 0, normA = 0, normB = 0;
      for (let i = 0; i < v1.length; i++) {
        dotProduct += v1[i] * v2[i];
        normA += v1[i] * v1[i];
        normB += v2[i] * v2[i];
      }
      const score = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      results.push({ name: speaker.role, score });
    }

    return results.sort((a, b) => b.score - a.score);
  }
}
