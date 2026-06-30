import { NextRequest, NextResponse } from 'next/server';
import { SpeakerDatabase } from '@/types';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = path.join(process.cwd(), 'speaker_db.json');

export async function GET() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return NextResponse.json({ speakers: [] });
    }

    const data = await fs.promises.readFile(DB_PATH, 'utf-8');
    const db: SpeakerDatabase = JSON.parse(data);

    // Return speakers without voiceprint data (it's large and not needed by the UI)
    const speakers = db.speakers.map(s => ({
      id: s.id,
      name: s.name || s.role,
    }));

    return NextResponse.json({ speakers });
  } catch (error) {
    console.error('Failed to read speakers:', error);
    return NextResponse.json({ speakers: [] });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Speaker id is required' }, { status: 400 });
    }

    if (!fs.existsSync(DB_PATH)) {
      return NextResponse.json({ error: 'No speaker database found' }, { status: 404 });
    }

    const data = await fs.promises.readFile(DB_PATH, 'utf-8');
    const db: SpeakerDatabase = JSON.parse(data);

    const before = db.speakers.length;
    db.speakers = db.speakers.filter(s => s.id !== id);

    if (db.speakers.length === before) {
      return NextResponse.json({ error: 'Speaker not found' }, { status: 404 });
    }

    await fs.promises.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete speaker:', error);
    return NextResponse.json(
      { error: 'Failed to delete speaker' },
      { status: 500 }
    );
  }
}
