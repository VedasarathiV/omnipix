// Migration: builtin coding-basics eval suite (rank models on agentic code
// tasks: write a function, fix a bug, edit a file, read output).
// Created: 2026-11-23.
//
// Agent items run unattended in seeded workspaces; shell checks grade via
// node (always present where the server runs). Deterministic, offline, fast.
//
// DOWN: removes the seeded suite only (user suites and run history stay).

import type { Db } from '../types.js';

interface SeedItem {
  id: string;
  prompt: string;
  checks: Array<{ type: string; value?: string }>;
  agent?: { maxSteps?: number; tools?: string[]; files?: Record<string, string> };
}

const CODING_BASICS: SeedItem[] = [
  {
    id: 'write-function',
    prompt: 'Create a file named add.js in the workspace that exports a function add(a, b) returning their sum (CommonJS require style). Nothing else is needed.',
    checks: [
      {
        type: 'shell',
        value: 'node -e "const {add}=require(\'./add.js\');if(typeof add!==\'function\'||add(2,3)!==5||add(-1,1)!==0)process.exit(1)"',
      },
    ],
    agent: { maxSteps: 8 },
  },
  {
    id: 'fix-bug',
    prompt: 'The file buggy.js exports double(n) but it is wrong: it adds 1 instead of multiplying by 2. Fix the file so double(n) returns n * 2.',
    checks: [
      {
        type: 'shell',
        value: 'node -e "const {double}=require(\'./buggy.js\');if(double(4)!==8||double(0)!==0)process.exit(1)"',
      },
    ],
    agent: {
      maxSteps: 8,
      files: { 'buggy.js': 'module.exports = { double: (n) => n + 1 }; // BUG: adds instead of multiplying\n' },
    },
  },
  {
    id: 'edit-config',
    prompt: 'In config.json, set "debug" to true and "retries" to 5. Keep every other key and the JSON valid.',
    checks: [
      {
        type: 'shell',
        value: 'node -e "const c=require(\'./config.json\');if(c.debug!==true||c.retries!==5||c.name!==\'demo\')process.exit(1)"',
      },
    ],
    agent: {
      maxSteps: 8,
      files: { 'config.json': '{\n  "name": "demo",\n  "debug": false,\n  "retries": 1\n}\n' },
    },
  },
  {
    id: 'read-output',
    prompt: 'Reply with ONLY the exact stdout of this program, nothing else: console.log([1, 2, 3].map(x => x * 2).join("-"))',
    checks: [{ type: 'includes', value: '2-4-6' }],
  },
];

export function up(db: Db): void {
  // Fixed created_at: the migration round-trip test requires up→down→up to
  // reproduce identical rows, and a clock timestamp would differ every run.
  db.prepare(
    "INSERT OR IGNORE INTO eval_suites (name, description, items_json, builtin, created_at) VALUES (?, ?, ?, 1, '2026-11-23T00:00:00.000Z')",
  ).run(
    'coding-basics',
    'Agentic code tasks (write, fix, edit) plus one output-reading check. Ranks models on real coding work.',
    JSON.stringify(CODING_BASICS),
  );
}

export function down(db: Db): void {
  db.prepare("DELETE FROM eval_suites WHERE name = 'coding-basics' AND builtin = 1").run();
}
