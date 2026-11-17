// Migration: add the DeepSeek platform provider rows
// Created: 2026-11-17
//
// DOWN: reversible (removes the DeepSeek rows and their chain entries)

import type { Db } from '../types.js';

// DeepSeek platform API (https://api-docs.deepseek.com, Nov 2026): bearer keys
// from platform.deepseek.com, OpenAI-compatible with NO /v1 path segment.
// deepseek-flash (V4.1-Flash-1017, 1M ctx, vision+tools) and deepseek-v4-pro
// (V4-Pro-0813, 1M ctx, tools, no vision). Paid API, no free tier — the budget
// label says so honestly and parses as "no budget info" for quota math.
// Thinking is on by default server-side; reasoning_effort is forwarded by the
// shared pipeline and reasoning_content is folded by the shared adapter.
//
// Row ids are FIXED, not autoincremented: models and fallback_config both use
// AUTOINCREMENT, whose sequence never reuses deleted ids, so a plain
// INSERT ... DOWN ... INSERT cycle would drift ids forever and break the
// migration round-trip contract. 900001+ is documented-reserved and far beyond
// any catalog growth. Idempotent (INSERT OR IGNORE), safe to re-run.
const ROWS = [
  { id: 900001, fbId: 900001, modelId: 'deepseek-flash', display: 'DeepSeek Flash', intel: 4, speed: 6, vision: 1 },
  { id: 900002, fbId: 900002, modelId: 'deepseek-v4-pro', display: 'DeepSeek V4 Pro', intel: 2, speed: 8, vision: 0 },
] as const;

export function up(db: Db): void {
  const apply = db.transaction(() => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO models (id, platform, model_id, display_name, intelligence_rank, speed_rank, size_label, monthly_token_budget, context_window, supports_vision, supports_tools)
      VALUES (?, 'deepseek', ?, ?, ?, ?, 'Frontier', '~pay-as-you-go', 1048576, ?, 1)
    `);
    // A legacy DB can already carry these rows at other ids (re-inserted
    // without ids by a previous partial run); always resolve the live id and
    // re-assert the flags rather than assuming the fixed ones.
    const findId = db.prepare("SELECT id FROM models WHERE platform = 'deepseek' AND model_id = ?");
    const flag = db.prepare('UPDATE models SET supports_vision = ?, supports_tools = ? WHERE id = ?');
    for (const row of ROWS) {
      insert.run(row.id, row.modelId, row.display, row.intel, row.speed, row.vision);
      const live = findId.get(row.modelId) as { id: number } | undefined;
      if (live) flag.run(row.vision ? 1 : 0, 1, live.id);
    }
    const maxPriority = (db.prepare('SELECT COALESCE(MAX(priority), 0) AS mx FROM fallback_config').get() as { mx: number }).mx;
    const existing = new Set(
      (db.prepare('SELECT model_db_id AS id FROM fallback_config').all() as { id: number }[]).map(r => r.id),
    );
    const addFb = db.prepare('INSERT OR IGNORE INTO fallback_config (id, model_db_id, priority, enabled) VALUES (?, ?, ?, 1)');
    ROWS.forEach((row, i) => {
      const live = findId.get(row.modelId) as { id: number } | undefined;
      if (live && !existing.has(live.id)) addFb.run(row.fbId, live.id, maxPriority + i + 1);
    });
  });
  apply();
}

export function down(db: Db): void {
  const apply = db.transaction(() => {
    // By identity, not by id: a legacy DB may carry these rows at other ids.
    db.prepare(`DELETE FROM fallback_config WHERE model_db_id IN (
      SELECT id FROM models WHERE platform = 'deepseek' AND model_id IN ('deepseek-flash', 'deepseek-v4-pro')
    )`).run();
    db.prepare("DELETE FROM models WHERE platform = 'deepseek' AND model_id IN ('deepseek-flash', 'deepseek-v4-pro')").run();
  });
  apply();
}
