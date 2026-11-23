// Migration: refresh Kilo Gateway anonymous :free rows (Nov 2026 probe)
// Created: 2026-11-17
//
// DOWN: reversible (restores the V20 values in place)

import type { Db } from '../types.js';

// The four V20 Kilo rows all 404 upstream now ("free period ended" transition
// the V20 comment warned about) — live-probed keyless 2026-11-17, each returns
// model_not_found. Replaced in place (UPDATE, not DELETE+INSERT) so row ids,
// fallback_config entries, and any operator edits to other columns (notably
// enabled) survive the refresh. The four replacements were verified live the
// same day. Per-model limits stay null exactly like V20: the 200/hr budget is
// per-IP, so the router relies on Kilo's own 429s + gateway failover.
// Idempotent: re-running matches zero rows.
const REFRESH: Array<{
  from: [string, string];
  to: [string, string, string, number, number, string, number | null];
}> = [
  {
    from: ['kilo', 'poolside/laguna-m.1:free'],
    to: ['kilo-auto/free', 'Kilo Auto Free', 'Medium', 16, 6, 'free · 200/hr per IP', 256000],
  },
  {
    from: ['kilo', 'poolside/laguna-xs.2:free'],
    to: ['liquid/lfm-3-1.7b:free', 'LFM 3 1.7B (Kilo)', 'Small', 28, 2, 'free · 200/hr per IP', 262144],
  },
  {
    from: ['kilo', 'nvidia/nemotron-3-super-120b-a12b:free'],
    to: ['particle-ai/particle-1:free', 'Particle-1 (Kilo)', 'Large', 10, 7, 'free · 200/hr per IP', 1048576],
  },
  {
    from: ['kilo', 'stepfun/step-3.7-flash:free'],
    to: ['reflection/beam-free', 'Beam 1.0 (Kilo)', 'Large', 12, 7, 'free · 200/hr per IP', 1048576],
  },
];

// V20 values, for DOWN: [model_id, display_name, size, intel, speed, budget, ctx].
const V20: Array<[string, string, string, number, number, string, number | null]> = [
  ['poolside/laguna-m.1:free', 'Poolside Laguna M.1 (Kilo)', 'Large', 13, 8, 'free · 200/hr per IP', 262144],
  ['poolside/laguna-xs.2:free', 'Poolside Laguna XS.2 (Kilo)', 'Medium', 16, 4, 'free · 200/hr per IP', 262144],
  ['nvidia/nemotron-3-super-120b-a12b:free', 'Nemotron 3 Super 120B (Kilo)', 'Large', 12, 5, 'free · 200/hr per IP (trial)', 1000000],
  ['stepfun/step-3.7-flash:free', 'StepFun Step 3.7 Flash (Kilo)', 'Medium', 14, 3, 'free · 200/hr per IP', 262144],
];

function refresh(
  db: Db,
  pairs: Array<{ matchId: string; values: [string, string, string, number, number, string, number | null] }>,
): void {
  const update = db.prepare(`
    UPDATE models
       SET model_id = ?, display_name = ?, size_label = ?,
           intelligence_rank = ?, speed_rank = ?,
           monthly_token_budget = ?, context_window = ?
     WHERE platform = 'kilo' AND model_id = ?
  `);
  const targetTaken = db.prepare("SELECT 1 FROM models WHERE platform = 'kilo' AND model_id = ?");
  for (const pair of pairs) {
    // An operator row already holding the target id (custom model with the
    // same id) wins: renaming onto it would violate the unique key and fail
    // the boot migration, so this one row is left for the operator.
    if (targetTaken.get(pair.values[0])) continue;
    update.run(...pair.values, pair.matchId);
  }
}

export function up(db: Db): void {
  const apply = db.transaction(() => {
    refresh(
      db,
      REFRESH.map(entry => ({ matchId: entry.from[1], values: entry.to })),
    );
  });
  apply();
}

export function down(db: Db): void {
  const apply = db.transaction(() => {
    refresh(
      db,
      REFRESH.map((entry, i) => ({ matchId: entry.to[0], values: V20[i] })),
    );
  });
  apply();
}
