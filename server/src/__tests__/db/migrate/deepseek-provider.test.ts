import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../db/migrate/runner.js';
import { up, down } from '../../../db/migrations/20261117_000002_deepseek_provider.js';

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

describe('deepseek_provider migration', () => {
  it('seeds both DeepSeek rows with flags and chain entries', async () => {
    const db = await migratedDb();
    const rows = db.prepare(`
      SELECT model_id, display_name, context_window, supports_vision, supports_tools, enabled
        FROM models WHERE platform = 'deepseek' ORDER BY model_id
    `).all();
    expect(rows).toEqual([
      { model_id: 'deepseek-flash', display_name: 'DeepSeek Flash', context_window: 1048576, supports_vision: 1, supports_tools: 1, enabled: 1 },
      { model_id: 'deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', context_window: 1048576, supports_vision: 0, supports_tools: 1, enabled: 1 },
    ]);
    const chained = (db.prepare(`
      SELECT COUNT(*) AS n FROM fallback_config
      WHERE model_db_id IN (SELECT id FROM models WHERE platform = 'deepseek')
    `).get() as { n: number }).n;
    expect(chained).toBe(2);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('up() is idempotent and down() removes the rows with their chain entries', async () => {
    const db = await migratedDb();
    up(db);
    expect((db.prepare("SELECT COUNT(*) AS n FROM models WHERE platform = 'deepseek'").get() as { n: number }).n).toBe(2);
    down(db);
    expect((db.prepare("SELECT COUNT(*) AS n FROM models WHERE platform = 'deepseek'").get() as { n: number }).n).toBe(0);
    expect((db.prepare(`
      SELECT COUNT(*) AS n FROM fallback_config
      WHERE model_db_id IN (SELECT id FROM models WHERE platform = 'deepseek')
    `).get() as { n: number }).n).toBe(0);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    // down() twice is safe (missing rows match nothing).
    down(db);
  });
});
