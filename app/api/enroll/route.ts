import { NextRequest, NextResponse } from 'next/server';
import { SherpaONNXManager } from '@/lib/sherpa-onnx';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DB_PATH = path.join(process.cwd(), 'speaker_db.json');

async function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  await execAsync(
    `ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -sample_fmt s16 "${outputPath}" -y`
  );
}

export async function POST(request: NextRequest) {
  const tempInputPath = path.join(tmpdir(), `enroll-${Date.now()}.webm`);
  const tempWavPath = path.join(tmpdir(), `enroll-${Date.now()}.wav`);

  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const name = formData.get('name') as string;

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Speaker name is required' }, { status: 400 });
    }

    const speakerName = name.trim();
    const speakerId = speakerName.toLowerCase().replace(/\s+/g, '-');

    // Save audio to temp file
    const audioBuffer = await audioFile.arrayBuffer();
    await fs.promises.writeFile(tempInputPath, Buffer.from(audioBuffer));

    // Convert to WAV
    await convertToWav(tempInputPath, tempWavPath);

    // Validate file size
    const stats = fs.statSync(tempWavPath);
    if (stats.size < 1000) {
      return NextResponse.json(
        { error: 'Audio recording is too short. Please record at least 5 seconds.' },
        { status: 400 }
      );
    }

    // Initialize Sherpa-ONNX for enrollment
    const modelsPath = path.join(process.cwd(), 'models');
    const sherpa = new SherpaONNXManager(modelsPath);
    await sherpa.initializeSpeakerEmbedding();
    await sherpa.loadSpeakerDatabase(DB_PATH, false);

    // Enroll the speaker
    await sherpa.enrollSpeaker(speakerId, speakerName, tempWavPath);

    // Save the updated database
    await sherpa.saveSpeakerDatabase(DB_PATH);

    sherpa.cleanup();

    return NextResponse.json({
      success: true,
      speaker: { id: speakerId, name: speakerName },
    });
  } catch (error) {
    console.error('Enrollment error:', error);
    return NextResponse.json(
      {
        error: 'Enrollment failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
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
