#!/usr/bin/env node

/**
 * Guided multi-condition voice enrollment (CLI).
 *
 * Each speaker is enrolled across three conditions — normal / loud / soft — so
 * the profile covers the speaker's RANGE, not one repeated condition. Each
 * recording is VAD-gated, quality-checked, and energy-validated against the
 * speaker's normal sample; on success its prototypes are written in the new
 * multi-prototype schema, and the speaker is finalized once all three pass.
 *
 * Usage:
 *   Record interactively (default):
 *     npm run enroll
 *
 *   Use existing 16 kHz mono WAVs (one per condition, per speaker):
 *     npm run enroll -- --dir ./audio
 *   expecting files named <speakerId>-<condition>.wav, e.g.
 *     client1-normal.wav  client1-loud.wav  client1-soft.wav
 *     client2-normal.wav  client2-loud.wav  client2-soft.wav
 *
 * Requirements: Sherpa-ONNX models in ./models; for recording, SoX or FFmpeg.
 */

import { SherpaONNXManager } from '../lib/sherpa-onnx';
import { AudioRecorder } from '../lib/audio-recorder';
import { REQUIRED_CONDITIONS, type EnrollmentCondition } from '../lib/domain/enrollment';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DB_PATH = path.join(process.cwd(), 'speaker_db.json');
const RECORD_SECONDS = 10;

const SPEAKERS = [
  { id: 'client1', name: 'Client 1' },
  { id: 'client2', name: 'Client 2' },
];

const PROMPTS: Record<string, string> = {
  normal: 'Speak NATURALLY, as you would in a session.',
  loud: 'Speak UP — project as if across the room.',
  soft: 'Speak QUIETLY — a low, calm voice.',
};

function parseDir(): string | null {
  const args = process.argv.slice(2);
  const i = args.indexOf('--dir');
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : null;
}

async function enrollFromFiles(sherpa: SherpaONNXManager, dir: string): Promise<void> {
  for (const sp of SPEAKERS) {
    console.log(`\n🎤 ${sp.name}`);
    for (const condition of REQUIRED_CONDITIONS) {
      const file = path.join(dir, `${sp.id}-${condition}.wav`);
      if (!fs.existsSync(file)) {
        console.warn(`   ⚠️  missing ${path.basename(file)} — skipping ${condition}`);
        continue;
      }
      const r = await sherpa.enrollCondition(sp.id, sp.name, file, condition);
      console.log(r.accepted ? `   ✅ ${condition}` : `   ❌ ${condition}: ${r.reason}`);
    }
    await finalize(sherpa, sp.id, sp.name);
  }
}

async function enrollByRecording(sherpa: SherpaONNXManager): Promise<void> {
  const recorder = new AudioRecorder();
  for (const sp of SPEAKERS) {
    console.log(`\n${'='.repeat(56)}\n🎤 ${sp.name}\n${'='.repeat(56)}`);
    for (const condition of REQUIRED_CONDITIONS) {
      let accepted = false;
      while (!accepted) {
        console.log(`\n— ${condition.toUpperCase()} — ${PROMPTS[condition]}`);
        await recorder.waitEnter(`Press ENTER to record ${RECORD_SECONDS}s...`);
        const tmp = path.join(os.tmpdir(), `enroll-${sp.id}-${condition}-${Date.now()}.wav`);
        try {
          await recorder.recordClip(tmp, RECORD_SECONDS);
          const r = await sherpa.enrollCondition(sp.id, sp.name, tmp, condition as EnrollmentCondition);
          if (r.accepted) {
            console.log(`   ✅ ${condition} accepted (${r.prototypesAdded} prototypes)`);
            accepted = true;
          } else {
            console.log(`   ❌ ${r.reason}`);
            const again = await recorder.ask('Redo this condition? (Y/n): ');
            if (again.toLowerCase() === 'n') throw new Error(`Aborted at ${sp.name}/${condition}`);
          }
        } finally {
          if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        }
      }
    }
    await finalize(sherpa, sp.id, sp.name);
  }
}

async function finalize(sherpa: SherpaONNXManager, id: string, name: string): Promise<void> {
  const r = await sherpa.finalizeEnrollment(id);
  if (!r.finalized) {
    console.warn(`   ⚠️  ${name} not finalized: ${r.reason}`);
    return;
  }
  console.log(`   🎉 ${name} complete (tightness ${r.tightness?.toFixed(2)})`);
  for (const w of r.warnings ?? []) console.warn(`   ⚠️  ${w.message}`);
}

async function main() {
  console.log('🎙️  Guided multi-condition voice enrollment\n');

  if (!fs.existsSync(path.join(process.cwd(), 'models', 'speaker-embedding.onnx'))) {
    console.error('❌ models/speaker-embedding.onnx not found. Run: npm run download-models');
    process.exit(1);
  }

  const sherpa = new SherpaONNXManager('./models');
  await sherpa.initializeSpeakerEmbedding();
  await sherpa.loadSpeakerDatabase(DB_PATH, false);

  try {
    const dir = parseDir();
    if (dir) await enrollFromFiles(sherpa, dir);
    else await enrollByRecording(sherpa);

    await sherpa.saveSpeakerDatabase(DB_PATH);
    console.log(`\n💾 Saved ${DB_PATH}`);
    console.log('Next: npm run dev → start a session.');
  } catch (error) {
    console.error('❌ Enrollment failed:', error);
    // Persist whatever passed so the user can resume the rest in the web UI.
    try {
      await sherpa.saveSpeakerDatabase(DB_PATH);
      console.log('💾 Saved partial progress; resume the remaining conditions in the app.');
    } catch {
      // ignore
    }
    process.exit(1);
  } finally {
    sherpa.cleanup();
  }
}

main();
