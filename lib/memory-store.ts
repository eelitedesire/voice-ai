import * as fs from 'fs';
import * as path from 'path';
import { MemoryDatabase, SpeakerMemory, MemoryFact } from '@/types';

const DB_PATH = path.join(process.cwd(), 'memory_db.json');

function readDb(): MemoryDatabase {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return { speakers: {} };
    }
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data) as MemoryDatabase;
  } catch {
    return { speakers: {} };
  }
}

function writeDb(db: MemoryDatabase): void {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

export function getMemoriesForSpeaker(speakerName: string): SpeakerMemory | null {
  const db = readDb();
  const key = speakerName.toLowerCase();
  return db.speakers[key] ?? null;
}

export function getAllMemories(): MemoryDatabase {
  return readDb();
}

export function addFacts(speakerName: string, facts: Omit<MemoryFact, 'id' | 'extractedAt'>[]): MemoryFact[] {
  const db = readDb();
  const key = speakerName.toLowerCase();

  if (!db.speakers[key]) {
    db.speakers[key] = { facts: [], updatedAt: Date.now() };
  }

  const speaker = db.speakers[key];
  const existingContents = new Set(speaker.facts.map(f => f.content.toLowerCase()));
  const added: MemoryFact[] = [];

  for (const fact of facts) {
    // Skip duplicates by exact content match
    if (existingContents.has(fact.content.toLowerCase())) {
      continue;
    }

    const newFact: MemoryFact = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: fact.content,
      category: fact.category,
      extractedAt: Date.now(),
    };

    speaker.facts.push(newFact);
    existingContents.add(fact.content.toLowerCase());
    added.push(newFact);
  }

  speaker.updatedAt = Date.now();
  writeDb(db);
  return added;
}

export function deleteMemory(speakerName: string, factId: string): boolean {
  const db = readDb();
  const key = speakerName.toLowerCase();
  const speaker = db.speakers[key];

  if (!speaker) return false;

  const before = speaker.facts.length;
  speaker.facts = speaker.facts.filter(f => f.id !== factId);

  if (speaker.facts.length === before) return false;

  speaker.updatedAt = Date.now();
  writeDb(db);
  return true;
}

export function clearMemoriesForSpeaker(speakerName: string): boolean {
  const db = readDb();
  const key = speakerName.toLowerCase();

  if (!db.speakers[key]) return false;

  delete db.speakers[key];
  writeDb(db);
  return true;
}

export function formatMemoriesForContext(speakerName: string): string {
  const memory = getMemoriesForSpeaker(speakerName);
  if (!memory || memory.facts.length === 0) return '';

  return memory.facts.map(f => `- ${f.content}`).join('\n');
}

export function formatAllMemoriesForContext(speakerNames: string[]): string {
  const sections: string[] = [];

  for (const name of speakerNames) {
    const formatted = formatMemoriesForContext(name);
    if (formatted) {
      sections.push(`Known information about ${name}:\n${formatted}`);
    }
  }

  return sections.length > 0
    ? `\n\nPrevious session memories:\n${sections.join('\n\n')}\n`
    : '';
}
