// Migration: task handoff contracts (orchestration #1).
//
// expected_output is a task's acceptance criteria (CrewAI shape); inputs_json
// wires named inputs from other tasks' handoffs; handoff_json is the record
// the driver writes at completion (summary + blackboard keys the task wrote).
// Contracts render into downstream prompts; enforcement (guardrails) is a
// later layer — this migration only carries the structure.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'agent_tasks', 'expected_output')) {
    db.exec('ALTER TABLE agent_tasks ADD COLUMN expected_output TEXT;');
  }
  if (!hasColumn(db, 'agent_tasks', 'inputs_json')) {
    db.exec("ALTER TABLE agent_tasks ADD COLUMN inputs_json TEXT NOT NULL DEFAULT '[]';");
  }
  if (!hasColumn(db, 'agent_tasks', 'handoff_json')) {
    db.exec('ALTER TABLE agent_tasks ADD COLUMN handoff_json TEXT;');
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'agent_tasks', 'handoff_json')) {
    db.exec('ALTER TABLE agent_tasks DROP COLUMN handoff_json;');
  }
  if (hasColumn(db, 'agent_tasks', 'inputs_json')) {
    db.exec('ALTER TABLE agent_tasks DROP COLUMN inputs_json;');
  }
  if (hasColumn(db, 'agent_tasks', 'expected_output')) {
    db.exec('ALTER TABLE agent_tasks DROP COLUMN expected_output;');
  }
}
