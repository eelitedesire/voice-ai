import { NextRequest, NextResponse } from 'next/server';
import {
  getAllMemories,
  getMemoriesForSpeaker,
  deleteMemory,
  clearMemoriesForSpeaker,
} from '@/lib/memory-store';

export async function GET(request: NextRequest) {
  const speaker = request.nextUrl.searchParams.get('speaker');

  if (speaker) {
    const memory = getMemoriesForSpeaker(speaker);
    return NextResponse.json({ speaker, memory });
  }

  const db = getAllMemories();
  return NextResponse.json(db);
}

export async function DELETE(request: NextRequest) {
  try {
    const { speaker, factId } = await request.json();

    if (!speaker) {
      return NextResponse.json({ error: 'Speaker name is required' }, { status: 400 });
    }

    if (factId) {
      const deleted = deleteMemory(speaker, factId);
      if (!deleted) {
        return NextResponse.json({ error: 'Memory fact not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    // Clear all memories for speaker
    const cleared = clearMemoriesForSpeaker(speaker);
    if (!cleared) {
      return NextResponse.json({ error: 'No memories found for speaker' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Memory delete error:', error);
    return NextResponse.json({ error: 'Failed to delete memory' }, { status: 500 });
  }
}
