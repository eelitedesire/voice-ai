/**
 * JSON Memory Repository
 *
 * Implements IMemoryRepository using a local JSON file for persistence.
 * This is the infrastructure-layer concrete implementation; callers
 * should depend on IMemoryRepository, not this class directly.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { IMemoryRepository } from '@/lib/domain/repositories/IMemoryRepository';
import type { MemoryDatabase, MemoryFact, SpeakerMemory } from '@/lib/domain/entities';

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

export class JsonMemoryRepository implements IMemoryRepository {
  getForSpeaker(speakerName: string): SpeakerMemory | null {
    const db = readDb();
    const key = speakerName.toLowerCase();
    return db.speakers[key] ?? null;
  }

  getAll(): MemoryDatabase {
    return readDb();
  }

  addFacts(
    speakerName: string,
    facts: Omit<MemoryFact, 'id' | 'extractedAt'>[],
  ): MemoryFact[] {
    const db = readDb();
    const key = speakerName.toLowerCase();

    if (!db.speakers[key]) {
      db.speakers[key] = { facts: [], updatedAt: Date.now() };
    }

    const speaker = db.speakers[key];
    const existingContents = new Set(speaker.facts.map(f => f.content.toLowerCase()));
    const added: MemoryFact[] = [];

    for (const fact of facts) {
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

  deleteFact(speakerName: string, factId: string): boolean {
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

  clearSpeaker(speakerName: string): boolean {
    const db = readDb();
    const key = speakerName.toLowerCase();

    if (!db.speakers[key]) return false;

    delete db.speakers[key];
    writeDb(db);
    return true;
  }

  formatForContext(speakerNames: string[]): string {
    const sections: string[] = [];

    for (const name of speakerNames) {
      const memory = this.getForSpeaker(name);
      if (memory && memory.facts.length > 0) {
        const formatted = memory.facts.map(f => `- ${f.content}`).join('\n');
        sections.push(`Known information about ${name}:\n${formatted}`);
      }
    }

    return sections.length > 0
      ? `\n\nPrevious session memories:\n${sections.join('\n\n')}\n`
      : '';
  }
}

/** Module-level singleton — reused across requests. */
export const memoryRepository = new JsonMemoryRepository();
