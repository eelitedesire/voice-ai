/**
 * Threshold calibration (Stage 2).
 *
 * Reads the (migrated, multi-prototype) speaker_db.json and models/cohort.json,
 * builds genuine vs. imposter AS-Norm score distributions, and derives the
 * operating threshold at a fixed low false-accept rate. Writes
 * models/calibration.json for the live recognizer (Stage 3) to consume.
 *
 * Pure JS + fs — does NOT load the ONNX model (embeddings already exist on disk).
 *
 * Usage:
 *   npm run calibrate -- [--db speaker_db.json] [--cohort models/cohort.json]
 *                        [--far 0.01] [--out models/calibration.json]
 */
import * as fs from 'fs';
import * as path from 'path';
import { calibrate, type CalibrationSpeaker } from '../lib/domain/calibration';
import { validateCohort, DEFAULT_ASNORM_CONFIG, type BackgroundCohort } from '../lib/domain/cohort';
import { needsMigration } from '../lib/domain/speaker-profile';
import type { SpeakerDatabase } from '../lib/domain/entities';

function parseArgs(argv: string[]) {
  let db = path.join(process.cwd(), 'speaker_db.json');
  let cohortPath = path.join(process.cwd(), 'models', 'cohort.json');
  let out = path.join(process.cwd(), 'models', 'calibration.json');
  let far = 0.01;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') db = path.resolve(argv[++i]);
    else if (a === '--cohort') cohortPath = path.resolve(argv[++i]);
    else if (a === '--out') out = path.resolve(argv[++i]);
    else if (a === '--far') far = Number(argv[++i]);
  }
  return { db, cohortPath, out, far };
}

function histogram(values: number[], bins = 10): string {
  if (values.length === 0) return '(none)';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - min) / width))]++;
  const peak = Math.max(...counts);
  return counts
    .map((c, i) => {
      const lo = (min + i * width).toFixed(2).padStart(6);
      const bar = '█'.repeat(Math.round((c / peak) * 30));
      return `   ${lo} | ${bar} ${c}`;
    })
    .join('\n');
}

function main() {
  const { db: dbPath, cohortPath, out, far } = parseArgs(process.argv);

  if (!fs.existsSync(dbPath)) {
    console.error(`❌ No speaker database at ${dbPath}. Enroll speakers first.`);
    process.exit(1);
  }
  if (!fs.existsSync(cohortPath)) {
    console.error(`❌ No cohort at ${cohortPath}. Run: npm run generate-cohort`);
    process.exit(1);
  }

  const db: SpeakerDatabase = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  const cohort: BackgroundCohort = JSON.parse(fs.readFileSync(cohortPath, 'utf-8'));

  if (needsMigration(db)) {
    console.error('❌ speaker_db.json is not migrated. Run: npm run migrate-db');
    process.exit(1);
  }
  const cohortProblems = validateCohort(cohort);
  if (cohortProblems.length > 0) {
    console.error('❌ Cohort invalid:');
    for (const p of cohortProblems) console.error(`   - ${p}`);
    process.exit(1);
  }

  // Model-consistency guard: prototypes must come from the cohort's model.
  const protoModels = new Set<string>();
  for (const s of db.speakers) for (const p of s.prototypes ?? []) protoModels.add(p.modelVersion);
  if (protoModels.size > 0 && !protoModels.has(cohort.modelVersion)) {
    console.warn(
      `⚠️  Prototype model(s) [${Array.from(protoModels).join(', ')}] != cohort model ` +
        `${cohort.modelVersion}. AS-Norm assumes a single model — re-enroll or regenerate the cohort.`,
    );
  }

  const speakers: CalibrationSpeaker[] = db.speakers.map((s) => ({
    id: s.id,
    protos: (s.prototypes ?? []).map((p) => p.v),
    tightness: s.stats?.intraClassTightness ?? 1,
  }));

  const result = calibrate(speakers, cohort.embeddings, { targetFAR: far });

  console.log(`\n📊 Calibration (cohort ${cohort.version}, ${cohort.embeddings.length} imposters)`);
  console.log(`   speakers: ${speakers.length}`);
  console.log(`   target trials: ${result.numTargetTrials}, non-target trials: ${result.numNontargetTrials}`);
  for (const w of result.warnings) console.log(`   ⚠️  ${w}`);

  console.log('\n— Genuine (target) AS-Norm scores —');
  console.log(`   mean ${result.summary.targetMean.toFixed(3)}, min ${result.summary.targetMin.toFixed(3)}`);
  console.log('\n— Imposter (non-target) AS-Norm scores —');
  console.log(`   mean ${result.summary.nontargetMean.toFixed(3)}, max ${result.summary.nontargetMax.toFixed(3)}`);

  console.log('\n— Operating point —');
  console.log(`   threshold:    ${result.threshold.toFixed(4)} (targetFAR ${far})`);
  console.log(`   achieved FAR: ${(result.achievedFAR * 100).toFixed(2)}%`);
  console.log(`   achieved FRR: ${(result.achievedFRR * 100).toFixed(2)}%`);
  console.log(`   EER:          ${(result.eer * 100).toFixed(2)}% @ ${result.eerThreshold.toFixed(4)}`);
  console.log('\n   per-speaker thresholds:');
  for (const [id, t] of Object.entries(result.perSpeakerThresholds)) {
    console.log(`     ${id.padEnd(16)} ${t.toFixed(4)}`);
  }

  const calibration = {
    cohortVersion: cohort.version,
    modelVersion: cohort.modelVersion,
    targetFAR: far,
    threshold: result.threshold,
    perSpeakerThresholds: result.perSpeakerThresholds,
    // Persist the AS-Norm config used, so the runtime scores identically.
    asnorm: { protoK: DEFAULT_ASNORM_CONFIG.protoK, cohortK: DEFAULT_ASNORM_CONFIG.cohortK },
    eer: result.eer,
    achievedFAR: result.achievedFAR,
    achievedFRR: result.achievedFRR,
    createdAt: Date.now(),
  };

  fs.writeFileSync(out, JSON.stringify(calibration, null, 2), 'utf-8');
  console.log(`\n💾 Wrote ${out}`);

  if (result.summary.targetMin <= result.summary.nontargetMax) {
    console.log(
      '\n⚠️  Target/imposter distributions overlap — inspect the histograms below and ' +
        'consider more/cleaner enrollment utterances before trusting the threshold.',
    );
    console.log('\nGenuine:\n' + histogram([result.summary.targetMin, result.summary.targetMean]));
  }
}

main();
