/**
 * One-shot migration of speaker_db.json to the multi-prototype schema (Stage 1).
 *
 * Usage:
 *   npx tsx scripts/migrate-speaker-db.ts [path-to-db] [--model <id>] [--dry-run]
 *
 * Defaults to ./speaker_db.json. Writes a timestamped backup before overwriting.
 *
 * NOTE: This migration converts legacy single-centroid profiles into normalized
 * multi-prototype profiles and stamps the `none` cohort sentinel. It does NOT
 * compute AS-Norm cohort statistics — that requires the embedding model and the
 * background cohort (Stage 2/3). Migrated profiles are safe to load; AS-Norm
 * treats them as stale until recomputed.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  migrateDatabase,
  validateDatabase,
  needsMigration,
  UNKNOWN_LEGACY_MODEL,
} from '../lib/domain/speaker-profile';
import type { SpeakerDatabase } from '../lib/domain/entities';

function parseArgs(argv: string[]): {
  dbPath: string;
  modelVersion: string;
  dryRun: boolean;
} {
  let dbPath = path.join(process.cwd(), 'speaker_db.json');
  let modelVersion = UNKNOWN_LEGACY_MODEL;
  let dryRun = false;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') modelVersion = argv[++i] ?? modelVersion;
    else if (a === '--dry-run') dryRun = true;
    else if (!a.startsWith('--')) dbPath = path.resolve(a);
  }
  return { dbPath, modelVersion, dryRun };
}

function main(): void {
  const { dbPath, modelVersion, dryRun } = parseArgs(process.argv);

  if (!fs.existsSync(dbPath)) {
    console.error(`❌ No database found at ${dbPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(dbPath, 'utf-8');
  let db: SpeakerDatabase;
  try {
    db = JSON.parse(raw);
  } catch (e) {
    console.error(`❌ Failed to parse ${dbPath}:`, e);
    process.exit(1);
    return;
  }

  console.log(`📂 ${dbPath}`);
  console.log(`   speakers: ${db.speakers?.length ?? 0}`);
  console.log(`   schemaVersion: ${db.schemaVersion ?? '(none / legacy)'}`);

  if (!needsMigration(db)) {
    console.log('✅ Already on the current schema. Nothing to do.');
    return;
  }

  const { db: migrated, report } = migrateDatabase(db, { modelVersion });
  const problems = validateDatabase(migrated);

  console.log('\n— Migration report —');
  console.log(`   migrated:   ${report.migratedSpeakers}`);
  console.log(`   unchanged:  ${report.alreadyCurrent}`);
  console.log(`   prototypes: ${report.prototypesCreated}`);
  for (const w of report.warnings) console.log(`   ⚠️  ${w}`);

  if (problems.length > 0) {
    console.error('\n❌ Validation problems — NOT writing:');
    for (const p of problems) console.error(`   - ${p}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n(dry run) Validated successfully; no files written.');
    return;
  }

  const backup = `${dbPath}.backup-${Date.now()}.json`;
  fs.writeFileSync(backup, raw, 'utf-8');
  fs.writeFileSync(dbPath, JSON.stringify(migrated, null, 2), 'utf-8');

  console.log(`\n💾 Backup: ${backup}`);
  console.log(`✅ Wrote migrated database to ${dbPath}`);
  console.log('   cohortVersion: none (AS-Norm stats pending Stage 2/3).');
}

main();
