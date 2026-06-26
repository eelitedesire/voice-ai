/**
 * Task 1 — real-data enrollment verification.
 *
 * Runs a complete normal/loud/soft enrollment against a TEMP database (your real
 * speaker_db.json is untouched) and asserts every structural claim:
 *   - SpeakerPrototype records are created
 *   - every prototype.source === 'enrolled'
 *   - conditions are stored (normal/loud/soft all present)
 *   - enrollmentStatus becomes 'complete'
 *   - buildEnrolledSpeakers loads the profile via the PROTOTYPE path
 * Also reports qualityScore behavior per condition.
 *
 * Usage (16 kHz mono WAVs):
 *   npm run verify-enroll -- --name "Sarah" --normal n.wav --loud l.wav --soft s.wav
 *   npm run verify-enroll -- --name "Sarah" --record           (record interactively)
 *
 * Requires ./models (npm run download-models). For --record: SoX or FFmpeg.
 */
import { SherpaONNXManager } from '../lib/sherpa-onnx';
import { buildEnrolledSpeakers } from '../lib/speaker-identification';
import { AudioRecorder } from '../lib/audio-recorder';
import type { SpeakerDatabase } from '../lib/domain/entities';
import { REQUIRED_CONDITIONS } from '../lib/domain/enrollment';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

let pass = true;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) pass = false;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const name = arg('name') || 'Test Speaker';
  const speakerId = name.toLowerCase().replace(/\s+/g, '-');

  if (!fs.existsSync(path.join(process.cwd(), 'models', 'speaker-embedding.onnx'))) {
    console.error('❌ models/speaker-embedding.onnx not found. Run: npm run download-models');
    process.exit(1);
  }

  // Resolve a wav path per condition (record or file).
  const paths: Record<string, string> = {};
  const cleanup: string[] = [];
  if (has('record')) {
    const rec = new AudioRecorder();
    const prompts: Record<string, string> = {
      normal: 'Speak naturally', loud: 'Speak up / louder', soft: 'Speak quietly / softer',
    };
    for (const c of REQUIRED_CONDITIONS) {
      await rec.waitEnter(`\nPress ENTER to record ${c.toUpperCase()} (${prompts[c]}), 10s...`);
      const out = path.join(os.tmpdir(), `verify-${c}-${Date.now()}.wav`);
      await rec.recordClip(out, 10);
      paths[c] = out;
      cleanup.push(out);
    }
  } else {
    for (const c of REQUIRED_CONDITIONS) {
      const p = arg(c);
      if (!p || !fs.existsSync(p)) {
        console.error(`❌ Missing --${c} <wav> (or use --record)`);
        process.exit(1);
      }
      paths[c] = path.resolve(p);
    }
  }

  const manager = new SherpaONNXManager('./models');
  await manager.initializeSpeakerEmbedding();
  const tmpDb = path.join(os.tmpdir(), `verify-db-${Date.now()}.json`);
  await manager.loadSpeakerDatabase(tmpDb, false); // nonexistent → empty DB

  console.log(`\n🎤 Enrolling "${name}" (${speakerId})`);
  for (const c of REQUIRED_CONDITIONS) {
    const r = await manager.enrollCondition(speakerId, name, paths[c], c);
    console.log(`  ${r.accepted ? '✅' : '❌'} ${c}: ${r.accepted ? `${r.prototypesAdded} prototypes` : r.reason}`);
    if (!r.accepted) {
      console.error('Enrollment rejected — fix the recording and rerun.');
      manager.cleanup();
      process.exit(1);
    }
  }
  const fin = await manager.finalizeEnrollment(speakerId);
  console.log(`  finalize: ${fin.finalized ? `complete (tightness ${fin.tightness?.toFixed(3)})` : fin.reason}`);
  for (const w of fin.warnings ?? []) console.log(`     ⚠️  ${w.message}`);

  // Persist temp DB and read it back to inspect the on-disk shape.
  await manager.saveSpeakerDatabase(tmpDb);
  manager.cleanup();
  const db: SpeakerDatabase = JSON.parse(fs.readFileSync(tmpDb, 'utf-8'));
  const profile = db.speakers.find((s) => s.id === speakerId)!;

  console.log('\n— Assertions —');
  const protos = profile.prototypes ?? [];
  check('SpeakerPrototype records created', protos.length > 0, `${protos.length} prototypes`);
  check("every prototype.source === 'enrolled'", protos.every((p) => p.source === 'enrolled'));
  const present = [...new Set(protos.map((p) => p.conditions))].sort();
  check('conditions stored (normal/loud/soft)', REQUIRED_CONDITIONS.every((c) => present.includes(c)), present.join(', '));
  check("enrollmentStatus === 'complete'", profile.enrollmentStatus === 'complete', String(profile.enrollmentStatus));

  const built = buildEnrolledSpeakers([profile]);
  check('buildEnrolledSpeakers returns the speaker', built.length === 1);
  check('loaded via PROTOTYPE path', built.length === 1 && built[0].embeddings.length === protos.length && built[0].tightness !== undefined,
    `embeddings=${built[0]?.embeddings.length} vs prototypes=${protos.length}, tightness=${built[0]?.tightness?.toFixed(3)}`);

  console.log('\n— qualityScore by condition —');
  for (const c of REQUIRED_CONDITIONS) {
    const q = protos.filter((p) => p.conditions === c).map((p) => p.qualityScore);
    if (q.length) {
      const mean = q.reduce((a, b) => a + b, 0) / q.length;
      console.log(`  ${c.padEnd(7)} n=${q.length}  min=${Math.min(...q).toFixed(2)} mean=${mean.toFixed(2)} max=${Math.max(...q).toFixed(2)}`);
    }
  }

  for (const f of cleanup) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }

  console.log(`\n${pass ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('❌ verify-enrollment failed:', e);
  process.exit(1);
});
