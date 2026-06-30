import * as sherpa from 'sherpa-onnx-node';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';

export interface StreamingEvent {
  type: 'partial' | 'final' | 'vad' | 'ready' | 'error';
  text?: string;
  speaker?: string;
  isSpeaking?: boolean;
  timestamp?: number;
  message?: string;
}

/**
 * Streaming transcription engine that processes audio in real-time.
 *
 * Pipeline:
 *   PCM chunks → VAD (speech detection) → OnlineRecognizer (streaming ASR)
 *                                        → Speaker ID (on segment boundaries)
 *
 * Emits events:
 *   'partial'  – interim transcription while user is speaking
 *   'final'    – completed utterance with speaker label
 *   'vad'      – speech activity status change
 *   'ready'    – engine initialized
 *   'error'    – something went wrong
 */
export class StreamingTranscriber extends EventEmitter {
  private recognizer: any = null;
  private asrStream: any = null;
  private vad: any = null;
  private speakerEmbedding: any = null;
  private speakerManager: any = null;

  private modelPath: string;
  private sampleRate = 16000;
  private initialized = false;

  // VAD state
  private isSpeaking = false;

  // Accumulate speech audio for speaker ID
  private speechSamplesBuffer: number[] = [];
  private lastPartialText = '';

  // Decode throttle: avoid calling decode too frequently
  private pendingSamples = 0;
  private readonly DECODE_EVERY_N_SAMPLES = 1600; // decode every 100ms of audio

  constructor(modelPath?: string) {
    super();
    this.modelPath = modelPath || path.join(process.cwd(), 'models');
  }

  async initialize(): Promise<void> {
    try {
      // Initialize ASR (OnlineRecognizer - streaming)
      const asrConfig = {
        featConfig: {
          sampleRate: this.sampleRate,
          featureDim: 80,
        },
        modelConfig: {
          transducer: {
            encoder: path.join(this.modelPath, 'encoder.onnx'),
            decoder: path.join(this.modelPath, 'decoder.onnx'),
            joiner: path.join(this.modelPath, 'joiner.onnx'),
          },
          tokens: path.join(this.modelPath, 'tokens.txt'),
          numThreads: 2,
          provider: 'cpu',
          debug: 0,
        },
        enableEndpoint: true,
        rule1MinTrailingSilence: 2.4,
        rule2MinTrailingSilence: 1.2,
        rule3MinUtteranceLength: 20,
      };

      this.recognizer = new sherpa.OnlineRecognizer(asrConfig);

      // Initialize VAD
      const vadConfig = {
        sileroVad: {
          model: path.join(this.modelPath, 'silero_vad.onnx'),
          minSilenceDuration: 0.25,
          minSpeechDuration: 0.25,
          threshold: 0.4,
          windowSize: 512,
        },
        sampleRate: this.sampleRate,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      };

      this.vad = new sherpa.Vad(vadConfig, 60);

      // Initialize speaker embedding
      const speakerConfig = {
        model: path.join(this.modelPath, 'speaker-embedding.onnx'),
        numThreads: 1,
        debug: 0,
        provider: 'cpu',
      };

      this.speakerEmbedding = new sherpa.SpeakerEmbeddingExtractor(speakerConfig);
      this.speakerManager = new sherpa.SpeakerEmbeddingManager(this.speakerEmbedding.dim);

      // Load speaker database
      await this.loadSpeakers();

      // Create initial ASR stream
      this.asrStream = this.recognizer.createStream();

      this.initialized = true;
      this.emit('event', { type: 'ready' } as StreamingEvent);
      console.log('[StreamingTranscriber] Initialized successfully');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[StreamingTranscriber] Init failed:', msg);
      this.emit('event', { type: 'error', message: msg } as StreamingEvent);
      throw error;
    }
  }

  private async loadSpeakers(): Promise<void> {
    const dbPath = path.join(process.cwd(), 'speaker_db.json');
    if (!fs.existsSync(dbPath)) {
      console.log('[StreamingTranscriber] No speaker database found');
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      for (const speaker of data.speakers) {
        const voiceprint = new Float32Array(speaker.voiceprint);
        const name = speaker.name || speaker.role;
        this.speakerManager.addMulti({ name, v: [voiceprint] });
        console.log(`[StreamingTranscriber] Loaded speaker: ${name}`);
      }
      console.log(`[StreamingTranscriber] ${this.speakerManager.getNumSpeakers()} speakers loaded`);
    } catch (e) {
      console.warn('[StreamingTranscriber] Failed to load speakers:', e);
    }
  }

  /**
   * Process incoming PCM audio chunk (Float32Array, 16kHz mono).
   * This is the main entry point called for each audio chunk from WebSocket.
   */
  processAudio(samples: Float32Array): void {
    if (!this.initialized) return;

    // Feed VAD
    this.processVAD(samples);

    // Feed ASR if speaking
    if (this.isSpeaking) {
      // Accumulate samples for speaker ID
      for (let i = 0; i < samples.length; i++) {
        this.speechSamplesBuffer.push(samples[i]);
      }

      // Feed to ASR stream
      this.asrStream.acceptWaveform({ samples, sampleRate: this.sampleRate });
      this.pendingSamples += samples.length;

      // Decode periodically
      if (this.pendingSamples >= this.DECODE_EVERY_N_SAMPLES) {
        this.pendingSamples = 0;
        while (this.recognizer.isReady(this.asrStream)) {
          this.recognizer.decode(this.asrStream);
        }

        // Get partial result
        const result = this.recognizer.getResult(this.asrStream);
        const text = (result.text || '').trim();
        if (text && text !== this.lastPartialText) {
          this.lastPartialText = text;
          this.emit('event', {
            type: 'partial',
            text,
            timestamp: Date.now(),
          } as StreamingEvent);
        }
      }
    }
  }

  /**
   * Process audio through VAD to detect speech boundaries.
   * When speech ends, finalize the utterance and identify speaker.
   */
  private processVAD(samples: Float32Array): void {
    const windowSize = 512;

    for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
      const chunk = samples.subarray(i, i + windowSize);
      this.vad.acceptWaveform(chunk);

      // Check for completed speech segments
      while (!this.vad.isEmpty()) {
        const segment = this.vad.front();
        this.vad.pop();

        // A segment completed means speech ended
        if (this.isSpeaking) {
          this.onSpeechEnd();
        }
      }
    }

    // Check if VAD is currently detecting speech
    // We infer speaking state from whether we're accumulating audio
    // and no segment has been popped recently
    const wasSpeaking = this.isSpeaking;

    // Heuristic: if we have accumulated speech samples and no segment was
    // just popped, we're likely in speech. The VAD pops segments when speech
    // ends, so if nothing was popped and we're feeding audio, speech may be
    // ongoing. We use the VAD's internal state indirectly.
    //
    // Simpler approach: use the accumulated buffer size as a proxy.
    // If we've been collecting samples, we're speaking.
    // When a segment is popped, we finalize.
    //
    // Actually, the best approach: always feed to ASR. Use VAD segments
    // to determine when to finalize + do speaker ID.
    if (!this.isSpeaking && this.speechSamplesBuffer.length === 0) {
      // Start speaking detection based on VAD signal
      // We'll set isSpeaking = true once we start accumulating
    }
  }

  /**
   * Called when VAD detects end of a speech segment.
   * Finalizes the ASR result and identifies the speaker.
   */
  private onSpeechEnd(): void {
    // Flush remaining decoding
    while (this.recognizer.isReady(this.asrStream)) {
      this.recognizer.decode(this.asrStream);
    }

    const result = this.recognizer.getResult(this.asrStream);
    const text = (result.text || '').trim();

    // Identify speaker from accumulated speech
    let speaker = '';
    if (this.speechSamplesBuffer.length >= this.sampleRate * 0.5) {
      speaker = this.identifySpeakerSync(new Float32Array(this.speechSamplesBuffer));
    }

    if (text) {
      this.emit('event', {
        type: 'final',
        text,
        speaker,
        timestamp: Date.now(),
      } as StreamingEvent);
    }

    // Reset for next utterance
    this.resetStream();

    this.emit('event', {
      type: 'vad',
      isSpeaking: false,
      timestamp: Date.now(),
    } as StreamingEvent);
  }

  /**
   * Identify speaker from audio samples synchronously.
   */
  private identifySpeakerSync(samples: Float32Array): string {
    if (!this.speakerEmbedding || this.speakerManager.getNumSpeakers() === 0) {
      return '';
    }

    try {
      const stream = this.speakerEmbedding.createStream();
      stream.acceptWaveform({ sampleRate: this.sampleRate, samples });
      stream.inputFinished();

      if (!this.speakerEmbedding.isReady(stream)) return '';

      const embedding = this.speakerEmbedding.compute(stream);
      if (!embedding || embedding.length === 0) return '';

      // Always pick the closest enrolled speaker (threshold -1 accepts any cosine similarity)
      const name = this.speakerManager.search({
        v: new Float32Array(embedding),
        threshold: -1,
      });

      return name || '';
    } catch {
      return '';
    }
  }

  /**
   * Reset ASR stream for next utterance.
   */
  private resetStream(): void {
    this.asrStream = this.recognizer.createStream();
    this.speechSamplesBuffer = [];
    this.lastPartialText = '';
    this.pendingSamples = 0;
    this.isSpeaking = false;
  }

  /**
   * Signal that audio input has ended.
   * Finalizes any in-progress transcription.
   */
  finalize(): void {
    if (!this.initialized) return;

    if (this.speechSamplesBuffer.length > 0) {
      // Feed remaining silence to trigger VAD flush
      const silence = new Float32Array(this.sampleRate * 0.5);
      this.asrStream.acceptWaveform({ samples: silence, sampleRate: this.sampleRate });

      // Flush VAD
      this.vad.flush();
      while (!this.vad.isEmpty()) {
        this.vad.pop();
      }

      // Get final result
      this.asrStream.inputFinished();
      while (this.recognizer.isReady(this.asrStream)) {
        this.recognizer.decode(this.asrStream);
      }

      const result = this.recognizer.getResult(this.asrStream);
      const text = (result.text || '').trim();

      if (text) {
        let speaker = '';
        if (this.speechSamplesBuffer.length >= this.sampleRate * 0.5) {
          speaker = this.identifySpeakerSync(new Float32Array(this.speechSamplesBuffer));
        }

        this.emit('event', {
          type: 'final',
          text,
          speaker,
          timestamp: Date.now(),
        } as StreamingEvent);
      }
    }

    this.resetStream();
  }

  cleanup(): void {
    this.asrStream = null;
    this.recognizer = null;
    this.vad = null;
    this.speakerEmbedding = null;
    this.speakerManager = null;
    this.initialized = false;
    this.removeAllListeners();
  }
}

/**
 * Improved streaming transcriber that uses VAD-segmented audio for better quality.
 *
 * Instead of feeding raw audio directly to the ASR, this version:
 * 1. Continuously feeds audio to VAD
 * 2. When VAD produces a speech segment, feeds that complete segment to ASR
 * 3. Runs speaker ID on the complete speech segment
 *
 * This gives cleaner transcription because the ASR gets clean speech segments
 * without silence/noise, and speaker ID gets complete utterances.
 */
export class VADSegmentedTranscriber extends EventEmitter {
  private recognizer: any = null;
  private vad: any = null;
  private speakerEmbedding: any = null;
  private speakerManager: any = null;

  private modelPath: string;
  private sampleRate = 16000;
  private initialized = false;

  // Track all incoming audio for partial results
  private ongoingSamples: number[] = [];
  private ongoingAsrStream: any = null;
  private lastPartialText = '';
  private pendingSamples = 0;
  private readonly DECODE_EVERY_N_SAMPLES = 1600;

  // VAD state for client signalling
  private isSpeechActive = false;

  constructor(modelPath?: string) {
    super();
    this.modelPath = modelPath || path.join(process.cwd(), 'models');
  }

  async initialize(): Promise<void> {
    try {
      // ASR
      const asrConfig = {
        featConfig: {
          sampleRate: this.sampleRate,
          featureDim: 80,
        },
        modelConfig: {
          transducer: {
            encoder: path.join(this.modelPath, 'encoder.onnx'),
            decoder: path.join(this.modelPath, 'decoder.onnx'),
            joiner: path.join(this.modelPath, 'joiner.onnx'),
          },
          tokens: path.join(this.modelPath, 'tokens.txt'),
          numThreads: 2,
          provider: 'cpu',
          debug: 0,
        },
        enableEndpoint: true,
        rule1MinTrailingSilence: 2.4,
        rule2MinTrailingSilence: 1.2,
        rule3MinUtteranceLength: 20,
      };

      this.recognizer = new sherpa.OnlineRecognizer(asrConfig);

      // VAD
      const vadConfig = {
        sileroVad: {
          model: path.join(this.modelPath, 'silero_vad.onnx'),
          minSilenceDuration: 0.3,
          minSpeechDuration: 0.25,
          threshold: 0.4,
          windowSize: 512,
        },
        sampleRate: this.sampleRate,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      };

      this.vad = new sherpa.Vad(vadConfig, 60);

      // Speaker embedding
      const speakerConfig = {
        model: path.join(this.modelPath, 'speaker-embedding.onnx'),
        numThreads: 1,
        debug: 0,
        provider: 'cpu',
      };

      this.speakerEmbedding = new sherpa.SpeakerEmbeddingExtractor(speakerConfig);
      this.speakerManager = new sherpa.SpeakerEmbeddingManager(this.speakerEmbedding.dim);

      await this.loadSpeakers();

      // Create ongoing ASR stream for partial results
      this.ongoingAsrStream = this.recognizer.createStream();

      this.initialized = true;
      this.emit('event', { type: 'ready' } as StreamingEvent);
      console.log('[VADSegmentedTranscriber] Initialized');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[VADSegmentedTranscriber] Init failed:', msg);
      this.emit('event', { type: 'error', message: msg } as StreamingEvent);
      throw error;
    }
  }

  private async loadSpeakers(): Promise<void> {
    const dbPath = path.join(process.cwd(), 'speaker_db.json');
    if (!fs.existsSync(dbPath)) {
      console.log('[VADSegmentedTranscriber] No speaker database found');
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      for (const speaker of data.speakers) {
        const voiceprint = new Float32Array(speaker.voiceprint);
        const name = speaker.name || speaker.role;
        this.speakerManager.addMulti({ name, v: [voiceprint] });
      }
      console.log(`[VADSegmentedTranscriber] ${this.speakerManager.getNumSpeakers()} speakers loaded`);
    } catch (e) {
      console.warn('[VADSegmentedTranscriber] Failed to load speakers:', e);
    }
  }

  /**
   * Process incoming PCM audio chunk.
   */
  processAudio(samples: Float32Array): void {
    if (!this.initialized) return;

    // Feed to ongoing ASR for partial results
    this.ongoingAsrStream.acceptWaveform({ samples, sampleRate: this.sampleRate });
    this.pendingSamples += samples.length;

    // Track samples for speaker ID
    for (let i = 0; i < samples.length; i++) {
      this.ongoingSamples.push(samples[i]);
    }

    // Periodic decode for partial results
    if (this.pendingSamples >= this.DECODE_EVERY_N_SAMPLES) {
      this.pendingSamples = 0;
      while (this.recognizer.isReady(this.ongoingAsrStream)) {
        this.recognizer.decode(this.ongoingAsrStream);
      }

      const result = this.recognizer.getResult(this.ongoingAsrStream);
      const text = (result.text || '').trim();
      if (text && text !== this.lastPartialText) {
        this.lastPartialText = text;
        // Signal speech start on first recognized text
        if (!this.isSpeechActive) {
          this.isSpeechActive = true;
          this.emit('event', {
            type: 'vad',
            isSpeaking: true,
            timestamp: Date.now(),
          } as StreamingEvent);
        }
        this.emit('event', {
          type: 'partial',
          text,
          timestamp: Date.now(),
        } as StreamingEvent);
      }

      // Fallback: use ASR endpoint detection when VAD hasn't segmented yet
      if (this.isSpeechActive && this.recognizer.isEndpoint(this.ongoingAsrStream)) {
        const endpointResult = this.recognizer.getResult(this.ongoingAsrStream);
        const endpointText = (endpointResult.text || '').trim();
        if (endpointText) {
          const speaker = this.ongoingSamples.length >= this.sampleRate * 0.5
            ? this.identifySpeaker(new Float32Array(this.ongoingSamples))
            : '';
          this.emit('event', {
            type: 'final',
            text: endpointText,
            speaker,
            timestamp: Date.now(),
          } as StreamingEvent);
        }
        // Reset for next utterance
        this.ongoingAsrStream = this.recognizer.createStream();
        this.lastPartialText = '';
        this.pendingSamples = 0;
        this.ongoingSamples = [];
        this.isSpeechActive = false;
        this.emit('event', {
          type: 'vad',
          isSpeaking: false,
          timestamp: Date.now(),
        } as StreamingEvent);
      }
    }

    // Feed VAD in windowSize chunks
    const windowSize = 512;
    for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
      const chunk = samples.subarray(i, i + windowSize);
      this.vad.acceptWaveform(chunk);

      // Check for completed segments
      while (!this.vad.isEmpty()) {
        const segment = this.vad.front();
        this.vad.pop();
        this.onVADSegment(segment);
      }
    }
  }

  /**
   * Called when VAD produces a complete speech segment.
   * Transcribes it cleanly and identifies the speaker.
   */
  private onVADSegment(segment: any): void {
    const segmentSamples = segment.samples instanceof Float32Array
      ? segment.samples
      : new Float32Array(segment.samples);

    const duration = segmentSamples.length / this.sampleRate;
    console.log(`[VADSegmentedTranscriber] Speech segment: ${duration.toFixed(2)}s`);

    if (duration < 0.3) return; // Skip very short segments

    // Transcribe the clean speech segment
    const text = this.transcribeSegment(segmentSamples);

    // Identify speaker
    let speaker = '';
    if (segmentSamples.length >= this.sampleRate * 0.5) {
      speaker = this.identifySpeaker(segmentSamples);
    }

    if (text) {
      this.emit('event', {
        type: 'final',
        text,
        speaker,
        timestamp: Date.now(),
      } as StreamingEvent);
    }

    // Reset the ongoing ASR stream (the partial results are now stale
    // since we got a final result from the VAD segment)
    this.ongoingAsrStream = this.recognizer.createStream();
    this.lastPartialText = '';
    this.pendingSamples = 0;
    this.ongoingSamples = [];

    // Always signal speech end so the client clears the partial transcript,
    // even if the segment produced no transcription text.
    this.isSpeechActive = false;
    this.emit('event', {
      type: 'vad',
      isSpeaking: false,
      timestamp: Date.now(),
    } as StreamingEvent);
  }

  /**
   * Transcribe a complete speech segment using a fresh ASR stream.
   */
  private transcribeSegment(samples: Float32Array): string {
    try {
      const stream = this.recognizer.createStream();

      // Add leading silence for model context
      const leadingSilence = new Float32Array(this.sampleRate * 0.5);
      const trailingSilence = new Float32Array(this.sampleRate * 0.3);

      const padded = new Float32Array(
        leadingSilence.length + samples.length + trailingSilence.length
      );
      padded.set(leadingSilence, 0);
      padded.set(samples, leadingSilence.length);
      padded.set(trailingSilence, leadingSilence.length + samples.length);

      stream.acceptWaveform({ samples: padded, sampleRate: this.sampleRate });
      stream.inputFinished();

      while (this.recognizer.isReady(stream)) {
        this.recognizer.decode(stream);
      }

      const result = this.recognizer.getResult(stream);
      return (result.text || '').trim();
    } catch (e) {
      console.error('[VADSegmentedTranscriber] Segment transcription failed:', e);
      return '';
    }
  }

  /**
   * Identify speaker from audio samples.
   */
  private identifySpeaker(samples: Float32Array): string {
    if (!this.speakerEmbedding || this.speakerManager.getNumSpeakers() === 0) {
      return '';
    }

    try {
      const stream = this.speakerEmbedding.createStream();
      stream.acceptWaveform({ sampleRate: this.sampleRate, samples });
      stream.inputFinished();

      if (!this.speakerEmbedding.isReady(stream)) return '';

      const embedding = this.speakerEmbedding.compute(stream);
      if (!embedding || embedding.length === 0) return '';

      // Always pick the closest enrolled speaker (threshold -1 accepts any cosine similarity)
      const name = this.speakerManager.search({
        v: new Float32Array(embedding),
        threshold: -1,
      });

      return name || '';
    } catch {
      return '';
    }
  }

  /**
   * Finalize: flush VAD and process any remaining audio.
   */
  finalize(): void {
    if (!this.initialized) return;

    // Add trailing silence and flush VAD
    const silence = new Float32Array(this.sampleRate * 0.5);
    const windowSize = 512;
    for (let i = 0; i + windowSize <= silence.length; i += windowSize) {
      this.vad.acceptWaveform(silence.subarray(i, i + windowSize));
    }
    this.vad.flush();

    while (!this.vad.isEmpty()) {
      const segment = this.vad.front();
      this.vad.pop();
      this.onVADSegment(segment);
    }

    // If there's remaining audio in the ongoing stream, finalize it
    if (this.ongoingSamples.length > this.sampleRate * 0.3) {
      this.ongoingAsrStream.inputFinished();
      while (this.recognizer.isReady(this.ongoingAsrStream)) {
        this.recognizer.decode(this.ongoingAsrStream);
      }

      const result = this.recognizer.getResult(this.ongoingAsrStream);
      const text = (result.text || '').trim();

      if (text) {
        const speaker = this.ongoingSamples.length >= this.sampleRate * 0.5
          ? this.identifySpeaker(new Float32Array(this.ongoingSamples))
          : '';

        this.emit('event', {
          type: 'final',
          text,
          speaker,
          timestamp: Date.now(),
        } as StreamingEvent);
      }
    }

    // Reset
    this.ongoingAsrStream = this.recognizer.createStream();
    this.ongoingSamples = [];
    this.lastPartialText = '';
    this.pendingSamples = 0;
  }

  cleanup(): void {
    this.ongoingAsrStream = null;
    this.recognizer = null;
    this.vad = null;
    this.speakerEmbedding = null;
    this.speakerManager = null;
    this.initialized = false;
    this.removeAllListeners();
  }
}
