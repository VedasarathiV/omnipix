// Migration: hierarchical crews (orchestration #2).
//
// mode selects the driver: 'dag' runs the static upfront graph, while
// 'hierarchical' lets a manager agent create tasks live. manager_tokens and
// manager_decisions account the manager's own spend and decision budget on
// the group row, so the token ceiling covers management overhead too.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'agent_groups', 'mode')) {
    db.exec("ALTER TABLE agent_groups ADD COLUMN mode TEXT NOT NULL DEFAULT 'dag';");
  }
  if (!hasColumn(db, 'agent_groups', 'manager_tokens')) {
    db.exec('ALTER TABLE agent_groups ADD COLUMN manager_tokens INTEGER NOT NULL DEFAULT 0;');
  }
  if (!hasColumn(db, 'agent_groups', 'manager_decisions')) {
    db.exec('ALTER TABLE agent_groups ADD COLUMN manager_decisions INTEGER NOT NULL DEFAULT 0;');
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'agent_groups', 'manager_decisions')) {
    db.exec('ALTER TABLE agent_groups DROP COLUMN manager_decisions;');
  }
  if (hasColumn(db, 'agent_groups', 'manager_tokens')) {
    db.exec('ALTER TABLE agent_groups DROP COLUMN manager_tokens;');
  }
  if (hasColumn(db, 'agent_groups', 'mode')) {
    db.exec('ALTER TABLE agent_groups DROP COLUMN mode;');
  }
}
