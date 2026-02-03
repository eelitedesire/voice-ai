import { NextRequest, NextResponse } from 'next/server';
import { SherpaONNXManager } from '@/lib/sherpa-onnx';
import { TranscriptEntry } from '@/types';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

let sherpaManager: SherpaONNXManager | null = null;

async function initializeSherpa() {
  if (!sherpaManager) {
    sherpaManager = new SherpaONNXManager('./models');
    await sherpaManager.initializeRecognizer();
    await sherpaManager.initializeSpeakerEmbedding();

    const dbPath = path.join(process.cwd(), 'speaker_db.json');
    if (fs.existsSync(dbPath)) {
      await sherpaManager.loadSpeakerDatabase(dbPath);
    } else {
      console.warn('Speaker database not found. Speaker identification will not work.');
    }
  }
  return sherpaManager;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    // Save audio to temporary file
    const tempFilePath = path.join(tmpdir(), `audio-${Date.now()}.webm`);
    const audioBuffer = await audioFile.arrayBuffer();
    await fs.promises.writeFile(tempFilePath, Buffer.from(audioBuffer));

    try {
      // Initialize Sherpa-ONNX
      const sherpa = await initializeSherpa();

      // Process audio file
      // Note: This is a simplified version. In production, you'd need to:
      // 1. Convert WebM to WAV format at 16kHz
      // 2. Split audio into segments for speaker identification
      // 3. Process each segment through Sherpa-ONNX

      // For now, we'll return a mock response
      // In production, implement actual Sherpa-ONNX processing
      const transcript: TranscriptEntry[] = [
        {
          speaker: 'Therapist',
          text: 'How have you been feeling this week?',
          timestamp: Date.now() - 5000,
        },
        {
          speaker: 'Client',
          text: "I've been struggling with anxiety, especially in the mornings.",
          timestamp: Date.now() - 3000,
        },
        {
          speaker: 'Therapist',
          text: 'Can you tell me more about what triggers this anxiety?',
          timestamp: Date.now() - 1000,
        },
      ];

      return NextResponse.json({ transcript });
    } finally {
      // Clean up temporary file
      try {
        await fs.promises.unlink(tempFilePath);
      } catch (err) {
        console.error('Failed to delete temp file:', err);
      }
    }
  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: 'Transcription failed' },
      { status: 500 }
    );
  }
}

// Cleanup on process exit
process.on('exit', () => {
  if (sherpaManager) {
    sherpaManager.cleanup();
  }
});
