/**
 * Task 2 — real-conversation baseline measurement.
 *
 * Feeds a recorded conversation WAV (16 kHz mono) through the live
 * VADSegmentedTranscriber and reports the speaker-ID baseline:
 *   - speaker score distribution (AS-Norm z in AS-Norm mode, cosine in degraded)
 *   - unknown rate
 *   - identity switches
 *   - per-segment tracker decisions (from speakerInfo.reason)
 *
 * Record a session with intentional variation (normal, louder/emotional,
 * laughter, softer, natural volume changes), export 16 kHz mono WAV, then:
 *   npm run measure-session -- --audio session.wav
 *
 * Uses ./models + speaker_db.json (+ models/cohort.json & calibration.json for
 * AS-Norm if present; otherwise degraded mode is reported).
 */
import * as sherpa from 'sherpa-onnx-node';
import * as fs from 'fs';
import * as path from 'path';
import { VADSegmentedTranscriber, StreamingEvent } from '../lib/streaming-transcription';
import { buildCategoryReport, categorizeMiss, isMiss, type SegmentDiag } from '../lib/domain/diagnostics';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function stats(xs: number[]) {
  if (xs.length === 0) return { min: NaN, mean: NaN, median: NaN, max: NaN };
  const s = [...xs].sort((a, b) => a - b);
  return {
    min: s[0],
    max: s[s.length - 1],
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    median: s[Math.floor(s.length / 2)],
  };
}

async function main() {
  const audio = arg('audio');
  if (!audio || !fs.existsSync(audio)) {
    console.error('❌ --audio <16kHz mono wav> required');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(process.cwd(), 'models', 'speaker-embedding.onnx'))) {
    console.error('❌ models not found. Run: npm run download-models');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(process.cwd(), 'speaker_db.json'))) {
    console.warn('⚠️  No speaker_db.json — every segment will be Unknown. Enroll first.');
  }

  const wave = sherpa.readWave(audio);
  const samples: Float32Array =
    wave.samples instanceof Float32Array ? wave.samples : new Float32Array(wave.samples);
  if (wave.sampleRate !== 16000) {
    console.error(`❌ Expected 16 kHz, got ${wave.sampleRate}. Convert: ffmpeg -i in -ar 16000 -ac 1 out.wav`);
    process.exit(1);
  }
  console.log(`🎧 ${audio}: ${(samples.length / 16000).toFixed(1)}s\n`);

  const finals: StreamingEvent[] = [];
  const t = new VADSegmentedTranscriber();
  t.on('event', (e: StreamingEvent) => {
    if (e.type === 'final') finals.push(e);
  });
  await t.initialize();

  // Feed in 512-sample frames (matches the live worklet chunk).
  for (let i = 0; i + 512 <= samples.length; i += 512) {
    t.processAudio(samples.subarray(i, i + 512));
  }
  t.finalize();

  // ── Aggregate ──
  const speakers = new Map<string, number>();
  const scores: number[] = [];
  let unknown = 0;
  let switches = 0;
  let prev: string | null = null;

  const diags: SegmentDiag[] = [];
  console.log('— Per-segment —');
  for (const f of finals) {
    const sp = f.speaker || '(none)';
    speakers.set(sp, (speakers.get(sp) ?? 0) + 1);
    const info = f.speakerInfo;
    const score = info?.score;
    if (typeof score === 'number' && Number.isFinite(score)) scores.push(score);
    const decision = info?.decision ?? 'unknown';
    if (decision !== 'known') unknown++;
    if (prev !== null && sp !== prev) switches++;
    prev = sp;

    const d: SegmentDiag = {
      speaker: sp,
      decision,
      rawScore: info?.rawScore,
      score: info?.score,
      threshold: info?.threshold,
      trackerOverride: info?.trackerOverride,
    };
    diags.push(d);

    const tag = isMiss(d) ? `MISS:${categorizeMiss(d)}` : d.trackerOverride ? 'HOLD' : 'ok';
    const raw = typeof info?.rawScore === 'number' ? info.rawScore.toFixed(2) : 'n/a';
    console.log(
      `  [${sp}] ${tag} (${decision} norm=${typeof score === 'number' ? score.toFixed(2) : 'n/a'} raw=${raw} thr=${typeof info?.threshold === 'number' ? info.threshold.toFixed(2) : 'n/a'}) | "${(f.text || '').slice(0, 36)}"`,
    );
  }

  const dist = stats(scores);
  const report = buildCategoryReport(diags);

  console.log('\n— Baseline —');
  console.log(`  segments:               ${finals.length}`);
  console.log(`  speakers:               ${[...speakers.entries()].map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}`);
  console.log(`  score min/mean/med/max: ${dist.min.toFixed(2)} / ${dist.mean.toFixed(2)} / ${dist.median.toFixed(2)} / ${dist.max.toFixed(2)}`);
  console.log(`  unknown rate:           ${finals.length ? ((unknown / finals.length) * 100).toFixed(1) : '0'}% (${unknown}/${finals.length})`);
  console.log(`  identity switches:      ${switches}`);
  console.log(`  tracker holds:          ${report.trackerHolds} (suppressed dips — successes)`);

  console.log('\n— Failure categories (heuristic; no ground truth) —');
  console.log(`  embedding failures:  ${report.embeddingFailures}  (raw similarity below floor → MODEL-level)`);
  console.log(`  threshold failures:  ${report.thresholdFailures}  (raw ok but rejected → SCORING/calibration-level)`);
  console.log(`  tracker flickers:    ${report.flickers}  (A→B→A reverts → TRACKING-level)`);
  console.log(`\n  ➜ Dominant problem: ${report.dominant.toUpperCase()} ⇒ next improvement is ${{
    embedding: 'model-level (embedding robustness / model swap)',
    threshold: 'scoring-level (recalibrate thresholds / margin)',
    tracker: 'tracking-level (hysteresis / hold tuning)',
    none: 'none — baseline is clean',
  }[report.dominant]}`);

  t.cleanup();
}

main().catch((e) => {
  console.error('❌ measure-session failed:', e);
  process.exit(1);
});
