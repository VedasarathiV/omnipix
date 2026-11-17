import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../db/migrate/runner.js';
import { up, down } from '../../../db/migrations/20261117_000001_kilo_free_refresh.js';

// The V20 Kilo :free rows all 404 upstream (live-probed 2026-11-17); this
// migration swaps them for four routes verified live the same day.

const DEAD = [
  'poolside/laguna-m.1:free',
  'poolside/laguna-xs.2:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'stepfun/step-3.7-flash:free',
];
const LIVE = [
  'kilo-auto/free',
  'particle-ai/particle-1:free',
  'reflection/beam-free',
  'liquid/lfm-3-1.7b:free',
];

const dbs: Database.Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

async function migratedDb(): Promise<Database.Database> {
  const db = new Database(':memory:');
  dbs.push(db);
  await runMigrations(db, 'up');
  return db;
}

function kiloIds(db: Database.Database): string[] {
  return (db.prepare("SELECT model_id AS id FROM models WHERE platform = 'kilo' ORDER BY model_id").all() as { id: string }[])
    .map(r => r.id);
}

function chainedIds(db: Database.Database): string[] {
  return (db.prepare(`
    SELECT m.model_id AS id FROM models m
    JOIN fallback_config f ON f.model_db_id = m.id
    WHERE m.platform = 'kilo' ORDER BY m.model_id
  `).all() as { id: string }[]).map(r => r.id);
}

describe('kilo_free_refresh migration', () => {
  it('a migrated DB carries the live rows in the chain and none of the dead rows', async () => {
    const db = await migratedDb();
    expect(kiloIds(db).sort()).toEqual([...LIVE].sort());
    expect(chainedIds(db).sort()).toEqual([...LIVE].sort());
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('up() is idempotent: re-running over a pre-migration state converges', async () => {
    const db = await migratedDb();
    // Simulate the pre-migration state: dead rows back, live rows gone.
    down(db);
    expect(kiloIds(db).sort()).toEqual([...DEAD].sort());
    up(db);
    expect(kiloIds(db).sort()).toEqual([...LIVE].sort());
    expect(chainedIds(db).sort()).toEqual([...LIVE].sort());
    // Second run changes nothing.
    up(db);
    expect(kiloIds(db).sort()).toEqual([...LIVE].sort());
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('down() restores the V20 rows with their fallback entries', async () => {
    const db = await migratedDb();
    down(db);
    expect(kiloIds(db).sort()).toEqual([...DEAD].sort());
    expect(chainedIds(db).sort()).toEqual([...DEAD].sort());
    const nemotron = db.prepare("SELECT display_name, context_window FROM models WHERE platform = 'kilo' AND model_id = ?")
      .get('nvidia/nemotron-3-super-120b-a12b:free') as { display_name: string; context_window: number };
    expect(nemotron).toEqual({ display_name: 'Nemotron 3 Super 120B (Kilo)', context_window: 1000000 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});
