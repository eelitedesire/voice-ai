import { NextRequest, NextResponse } from 'next/server';
import { SherpaONNXManager } from '@/lib/sherpa-onnx';
import * as path from 'path';

const DB_PATH = path.join(process.cwd(), 'speaker_db.json');

function speakerIdFromName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Finalize a speaker's guided enrollment.
 * Body: { name } (or { id }).
 *
 * 200 → all required conditions present; profile flipped to `complete` and is
 *       now eligible for live matching. Body carries advisory coverage /
 *       confusable warnings + tightness.
 * 422 → still incomplete (missing conditions listed); profile unchanged.
 *
 * No embedding model needed — operates on already-stored prototypes.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = (body?.name as string | undefined)?.trim();
    const id = (body?.id as string | undefined)?.trim();
    const speakerId = id || (name ? speakerIdFromName(name) : '');

    if (!speakerId) {
      return NextResponse.json({ error: 'name or id is required' }, { status: 400 });
    }

    const modelsPath = path.join(process.cwd(), 'models');
    const sherpa = new SherpaONNXManager(modelsPath);
    await sherpa.loadSpeakerDatabase(DB_PATH, false);

    const result = await sherpa.finalizeEnrollment(speakerId);

    if (result.finalized) {
      await sherpa.saveSpeakerDatabase(DB_PATH);
    }
    sherpa.cleanup();

    return NextResponse.json(result, { status: result.finalized ? 200 : 422 });
  } catch (error) {
    console.error('Finalize enrollment error:', error);
    return NextResponse.json(
      { error: 'Failed to finalize enrollment', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
