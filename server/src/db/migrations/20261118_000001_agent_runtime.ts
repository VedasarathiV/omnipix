// Migration: agent runtime tables + seeded skills
// Created: 2026-11-18
//
// Agent runs execute a tool loop through the gateway's own router (any
// provider — runs are never pinned to one model). Steps persist as they land
// so a trace view can poll or stream them. Skills are Hermes-style Markdown
// instructions injected by relevance; builtins ship enabled, operators add
// their own via the API.
//
// DOWN: drops all four tables (runs, steps, memory, skills).

import type { Db } from '../types.js';

const SEED_SKILLS: Array<{ name: string; description: string; instructions: string }> = [
  {
    name: 'planner',
    description: 'Break a goal into a short ordered plan before acting.',
    instructions: [
      'Before using any tool, restate the goal in one sentence.',
      'List at most 5 concrete steps, each naming the tool it needs.',
      'If a step fails twice, replan around it instead of retrying verbatim.',
    ].join('\n'),
  },
  {
    name: 'researcher',
    description: 'Answer from searched sources and cite them.',
    instructions: [
      'Use web_search for any fact newer than your training or that needs a source.',
      'Prefer primary sources; say when evidence is thin or conflicting.',
      'End with a short Sources list naming the pages used.',
    ].join('\n'),
  },
  {
    name: 'critic',
    description: 'Check the draft answer for errors before finalizing.',
    instructions: [
      'Re-read your draft for wrong facts, missing steps, and unsafe advice.',
      'Fix what you find; if unsure about a fact, say so instead of asserting it.',
      'Keep the final answer tight — cut anything the goal did not ask for.',
    ].join('\n'),
  },
];

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'auto',
      tools_json TEXT NOT NULL DEFAULT '[]',
      skills_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'running',
      final_answer TEXT,
      error TEXT,
      steps_used INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      name TEXT,
      content_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, seq);
    CREATE TABLE IF NOT EXISTS agent_memory (
      run_id INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (run_id, key)
    );
    CREATE TABLE IF NOT EXISTS skills (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      instructions TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  // Fixed created_at: the migration round-trip test requires up→down→up to
  // reproduce identical rows, and a clock timestamp would differ every run.
  const insert = db.prepare(
    "INSERT OR IGNORE INTO skills (name, description, instructions, enabled, builtin, created_at) VALUES (?, ?, ?, 1, 1, '2026-11-18T00:00:00.000Z')",
  );
  for (const skill of SEED_SKILLS) {
    insert.run(skill.name, skill.description, skill.instructions);
  }
}

export function down(db: Db): void {
  db.exec(`
    DROP TABLE IF EXISTS agent_memory;
    DROP TABLE IF EXISTS agent_steps;
    DROP TABLE IF EXISTS agent_runs;
    DROP TABLE IF EXISTS skills;
  `);
}
