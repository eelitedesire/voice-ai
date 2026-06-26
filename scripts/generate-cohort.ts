/**
 * Background-cohort generation (Stage 2).
 *
 * Extracts one L2-normalized speaker embedding per audio file in a directory,
 * using THE EXACT runtime embedding model + 16 kHz pipeline, and writes
 * models/cohort.json. This cohort is the AS-Norm imposter reference; it MUST be
 * produced with the same model as enrollment or the score normalization is
 * meaningless — hence the modelVersion stamp and the version checks downstream.
 *
 * Usage:
 *   npm run generate-cohort -- --audio-dir ./cohort-audio [--out models/cohort.json]
 *
 * Provide a directory of single-speaker utterances (5–15 s each, 16 kHz mono
 * WAV) from a public multi-speaker corpus (e.g. LibriSpeech dev-clean). Use
 * speakers that will NEVER be enrolled — this is the "rest of the world".
 *
 * Requires the model on disk: run `npm run download-models` first.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SherpaONNXManager } from '../lib/sherpa-onnx';
import { validateCohort, type BackgroundCohort } from '../lib/domain/cohort';
import { EMBEDDING_MODEL_ID } from '../lib/embedding-config';

function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v : v.map((x) => x / n);
}

function parseArgs(argv: string[]) {
  let audioDir = path.join(process.cwd(), 'cohort-audio');
  let out = path.join(process.cwd(), 'models', 'cohort.json');
  let modelId = EMBEDDING_MODEL_ID;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--audio-dir') audioDir = path.resolve(argv[++i]);
    else if (a === '--out') out = path.resolve(argv[++i]);
    else if (a === '--model-id') modelId = argv[++i];
  }
  return { audioDir, out, modelId };
}

async function main() {
  const { audioDir, out, modelId } = parseArgs(process.argv);
  const modelPath = path.join(process.cwd(), 'models');

  if (!fs.existsSync(path.join(modelPath, 'speaker-embedding.onnx'))) {
    console.error('❌ models/speaker-embedding.onnx not found. Run: npm run download-models');
    process.exit(1);
  }
  if (!fs.existsSync(audioDir)) {
    console.error(`❌ Audio directory not found: ${audioDir}`);
    console.error('   Provide single-speaker WAVs (16kHz mono) from a public corpus.');
    process.exit(1);
  }

  const files = fs
    .readdirSync(audioDir)
    .filter((f) => /\.(wav|flac)$/i.test(f))
    .map((f) => path.join(audioDir, f));

  if (files.length === 0) {
    console.error(`❌ No .wav/.flac files in ${audioDir}`);
    process.exit(1);
  }

  console.log(`🎙️  Extracting embeddings from ${files.length} files using ${modelId} …`);

  const manager = new SherpaONNXManager(modelPath);
  await manager.initializeSpeakerEmbedding();

  const embeddings: number[][] = [];
  let dim = 0;
  let failures = 0;

  for (const file of files) {
    try {
      const raw = await manager.extractVoiceprint(file);
      if (dim === 0) dim = raw.length;
      if (raw.length !== dim) {
        console.warn(`   ⚠️  ${path.basename(file)}: dim ${raw.length} != ${dim}, skipping`);
        failures++;
        continue;
      }
      embeddings.push(l2normalize(raw));
    } catch (e) {
      failures++;
      console.warn(`   ⚠️  ${path.basename(file)}: ${(e as Error).message}`);
    }
  }
  manager.cleanup();

  if (embeddings.length === 0) {
    console.error('❌ No embeddings extracted. Check audio format (16kHz mono WAV).');
    process.exit(1);
  }

  // Content-addressed version: same audio + model ⇒ same version (reproducible).
  const hash = crypto
    .createHash('sha256')
    .update(modelId)
    .update(JSON.stringify(embeddings.map((e) => e.map((x) => Math.round(x * 1e4)))))
    .digest('hex')
    .slice(0, 8);
  const version = `cohort-${modelId}-${embeddings.length}-${hash}`;

  const cohort: BackgroundCohort = {
    version,
    modelVersion: modelId,
    dim,
    embeddings,
    createdAt: Date.now(),
    sourceCount: embeddings.length,
  };

  const problems = validateCohort(cohort);
  if (problems.length > 0) {
    console.error('❌ Cohort failed validation:');
    for (const p of problems) console.error(`   - ${p}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(cohort, null, 2), 'utf-8');

  console.log(`\n✅ Wrote ${out}`);
  console.log(`   version: ${version}`);
  console.log(`   dim: ${dim}, embeddings: ${embeddings.length}, failures: ${failures}`);
  console.log('\nNext: npm run calibrate');
}

main().catch((e) => {
  console.error('❌ Cohort generation failed:', e);
  process.exit(1);
});
