import { NextRequest, NextResponse } from 'next/server';
import { SherpaONNXManager } from '@/lib/sherpa-onnx';
import { REQUIRED_CONDITIONS } from '@/lib/domain/enrollment';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DB_PATH = path.join(process.cwd(), 'speaker_db.json');

async function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  await execAsync(
    `ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -sample_fmt s16 "${outputPath}" -y`,
  );
}

function speakerIdFromName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Enroll ONE labeled condition recording.
 * FormData: { audio, name, condition: 'normal'|'loud'|'soft' }
 *
 * 200 → accepted; the recording's prototypes were stored (profile stays
 *       `incomplete` until /api/enroll/finalize).
 * 422 → well-formed but REJECTED (gating / energy). Body carries an actionable
 *       `reason` for the user to redo THIS condition; passed conditions are kept.
 */
export async function POST(request: NextRequest) {
  const ts = Date.now();
  const tempInputPath = path.join(tmpdir(), `enroll-${ts}.webm`);
  const tempWavPath = path.join(tmpdir(), `enroll-${ts}.wav`);

  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const name = ((formData.get('name') as string) || '').trim();
    const condition = ((formData.get('condition') as string) || '').trim();

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: 'Speaker name is required' }, { status: 400 });
    }
    if (!condition || !(REQUIRED_CONDITIONS as readonly string[]).includes(condition)) {
      return NextResponse.json(
        { error: `condition must be one of: ${REQUIRED_CONDITIONS.join(', ')}` },
        { status: 400 },
      );
    }

    const speakerId = speakerIdFromName(name);

    const audioBuffer = await audioFile.arrayBuffer();
    await fs.promises.writeFile(tempInputPath, Buffer.from(audioBuffer));
    await convertToWav(tempInputPath, tempWavPath);

    const modelsPath = path.join(process.cwd(), 'models');
    const sherpa = new SherpaONNXManager(modelsPath);
    await sherpa.initializeSpeakerEmbedding();
    await sherpa.loadSpeakerDatabase(DB_PATH, false);

    const result = await sherpa.enrollCondition(speakerId, name, tempWavPath, condition);

    if (result.accepted) {
      await sherpa.saveSpeakerDatabase(DB_PATH);
    }
    sherpa.cleanup();

    return NextResponse.json(
      {
        ...result,
        speaker: { id: speakerId, name },
        requiredConditions: REQUIRED_CONDITIONS,
      },
      { status: result.accepted ? 200 : 422 },
    );
  } catch (error) {
    console.error('Enrollment error:', error);
    return NextResponse.json(
      {
        error: 'Enrollment failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  } finally {
    for (const filePath of [tempInputPath, tempWavPath]) {
      try {
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
      } catch (err) {
        console.error(`Failed to delete temp file ${filePath}:`, err);
      }
    }
  }
}
