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

  it('seeds rows at the fixed reserved ids', async () => {
    const db = await migratedDb();
    const rows = db.prepare(`
      SELECT id, model_id FROM models WHERE platform = 'deepseek' ORDER BY id
    `).all();
    expect(rows).toEqual([
      { id: 900001, model_id: 'deepseek-flash' },
      { id: 900002, model_id: 'deepseek-v4-pro' },
    ]);
  });

  it('up() heals legacy rows at other ids without duplicating', async () => {
    const db = await migratedDb();
    // Simulate a legacy DB: same identities, autoincrement ids, wrong flags,
    // no chain entries (a previous partial run re-inserted them without ids).
    down(db);
    const insert = db.prepare(`
      INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, monthly_token_budget, context_window, supports_vision, supports_tools)
      VALUES ('deepseek', ?, ?, 4, 6, 'Frontier', '~pay-as-you-go', 1048576, ?, ?)
    `);
    insert.run('deepseek-flash', 'DeepSeek Flash', 0, 0);
    insert.run('deepseek-v4-pro', 'DeepSeek V4 Pro', 1, 0);
    const legacyIds = (db.prepare(`SELECT id FROM models WHERE platform = 'deepseek' ORDER BY id`).all() as { id: number }[]).map(r => r.id);
    expect(legacyIds).not.toContain(900001);
    expect(legacyIds).not.toContain(900002);

    up(db);

    // No duplicate rows: the UNIQUE(platform, model_id) insert was ignored.
    const rows = db.prepare(`
      SELECT id, model_id, supports_vision, supports_tools FROM models WHERE platform = 'deepseek' ORDER BY model_id
    `).all();
    expect(rows).toEqual([
      { id: legacyIds[0], model_id: 'deepseek-flash', supports_vision: 1, supports_tools: 1 },
      { id: legacyIds[1], model_id: 'deepseek-v4-pro', supports_vision: 0, supports_tools: 1 },
    ]);
    // Chain entries point at the LIVE ids, not the fixed ones.
    const chained = (db.prepare(`SELECT model_db_id AS id FROM fallback_config`).all() as { id: number }[]).map(r => r.id);
    expect(chained).toContain(legacyIds[0]);
    expect(chained).toContain(legacyIds[1]);
    // ...and nothing dangles off the fixed ids, which hold no rows here.
    expect(chained).not.toContain(900001);
    expect(chained).not.toContain(900002);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('down() then up() restores rows at stable ids', async () => {
    const db = await migratedDb();
    down(db);
    up(db);
    const rows = db.prepare(`
      SELECT id, model_id FROM models WHERE platform = 'deepseek' ORDER BY id
    `).all();
    expect(rows).toEqual([
      { id: 900001, model_id: 'deepseek-flash' },
      { id: 900002, model_id: 'deepseek-v4-pro' },
    ]);
    const chained = (db.prepare(`
      SELECT COUNT(*) AS n FROM fallback_config
      WHERE model_db_id IN (SELECT id FROM models WHERE platform = 'deepseek')
    `).get() as { n: number }).n;
    expect(chained).toBe(2);
  });

  it('up() repairs rows missing their chain entries', async () => {
    const db = await migratedDb();
    db.prepare(`DELETE FROM fallback_config WHERE model_db_id IN (SELECT id FROM models WHERE platform = 'deepseek')`).run();
    up(db);
    const chained = (db.prepare(`
      SELECT COUNT(*) AS n FROM fallback_config
      WHERE model_db_id IN (SELECT id FROM models WHERE platform = 'deepseek')
    `).get() as { n: number }).n;
    expect(chained).toBe(2);
    expect((db.prepare("SELECT COUNT(*) AS n FROM models WHERE platform = 'deepseek'").get() as { n: number }).n).toBe(2);
  });

  it('down() only removes DeepSeek rows and their chain entries', async () => {
    const db = await migratedDb();
    db.prepare(`
      INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank)
      VALUES ('test', 'other-model', 'Other', 1, 1)
    `).run();
    const otherId = (db.prepare("SELECT id FROM models WHERE platform = 'test'").get() as { id: number }).id;
    db.prepare(`INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, 9999, 1)`).run(otherId);
    down(db);
    expect((db.prepare("SELECT COUNT(*) AS n FROM models WHERE platform = 'deepseek'").get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM models WHERE id = ?').get(otherId) as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM fallback_config WHERE model_db_id = ?').get(otherId) as { n: number }).n).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('up() is idempotent and down() removes the rows with their chain entries', async () => {
    const db = await migratedDb();
    up(db);
    up(db);
    // Idempotent means identical, not just same-count: ids and flags stable.
    const rows = db.prepare(`
      SELECT id, model_id, supports_vision, supports_tools FROM models WHERE platform = 'deepseek' ORDER BY id
    `).all();
    expect(rows).toEqual([
      { id: 900001, model_id: 'deepseek-flash', supports_vision: 1, supports_tools: 1 },
      { id: 900002, model_id: 'deepseek-v4-pro', supports_vision: 0, supports_tools: 1 },
    ]);
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
