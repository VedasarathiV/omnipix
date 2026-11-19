import type {
  AgentDef,
  Approval,
  ChatMessage,
  EvalRun,
  FileChange,
  FileNode,
  Notice,
  PlanStep,
  ProviderDef,
  TerminalSession,
  TimelineStep,
  Workspace,
} from '../types';

export const WORKSPACES: Workspace[] = [
  { id: 'w1', name: 'omnipix', path: '~/code/omnipix', branch: 'feat/agent-ui', dirty: 3 },
  { id: 'w2', name: 'acme-api', path: '~/code/acme-api', branch: 'main', dirty: 0 },
  { id: 'w3', name: 'docs-site', path: '~/code/docs-site', branch: 'fix/nav', dirty: 1 },
];

export const MODELS = [
  { id: 'auto', label: 'Auto (fallback chain)' },
  { id: 'llama-3.3-70b', label: 'llama-3.3-70b-versatile · Groq' },
  { id: 'qwen3-32b', label: 'qwen3-32b · Cerebras' },
  { id: 'gpt-oss-120b', label: 'gpt-oss-120b · Groq' },
];

export const PLAN: PlanStep[] = [
  { id: 'p1', label: 'Map the auth flow and find the token refresh path', status: 'done' },
  { id: 'p2', label: 'Add refresh-token rotation to the session store', status: 'running' },
  { id: 'p3', label: 'Cover rotation + expiry with unit tests', status: 'pending' },
  { id: 'p4', label: 'Run full suite and lint', status: 'pending' },
];

export const TIMELINE: TimelineStep[] = [
  { id: 's1', kind: 'read', title: 'Read src/auth/session.ts', detail: '212 lines', status: 'done', durationMs: 240 },
  { id: 's2', kind: 'search', title: 'Searched "refresh_token" across src/', detail: '14 matches in 6 files', status: 'done', durationMs: 410 },
  { id: 's3', kind: 'edit', title: 'Edited src/auth/session.ts', status: 'done', added: 42, removed: 9, durationMs: 1830 },
  { id: 's4', kind: 'create', title: 'Created src/auth/rotation.ts', status: 'done', added: 87, durationMs: 1210 },
  { id: 's5', kind: 'command', title: 'Ran npm test -- auth', detail: 'vitest run src/auth', status: 'running', durationMs: 4200 },
  { id: 's6', kind: 'subagent', title: 'Sub-agent: edge-case review', detail: 'reviewer · token expiry races', status: 'pending' },
];

export const CHANGES: FileChange[] = [
  {
    path: 'src/auth/session.ts',
    status: 'M',
    added: 42,
    removed: 9,
    hunks: [
      {
        id: 'h1',
        header: '@@ -38,7 +38,12 @@ export class SessionStore {',
        lines: [
          { kind: 'context', oldNo: 38, newNo: 38, text: '  async get(sessionId: string) {' },
          { kind: 'context', oldNo: 39, newNo: 39, text: '    const row = await this.db.get(sessionId);' },
          { kind: 'del', oldNo: 40, newNo: null, text: '    if (!row || row.expiresAt < Date.now()) return null;' },
          { kind: 'add', oldNo: null, newNo: 40, text: '    if (!row) return null;' },
          { kind: 'add', oldNo: null, newNo: 41, text: '    if (row.expiresAt < Date.now()) {' },
          { kind: 'add', oldNo: null, newNo: 42, text: '      return this.rotate(row);' },
          { kind: 'add', oldNo: null, newNo: 43, text: '    }' },
          { kind: 'context', oldNo: 41, newNo: 44, text: '    return row;' },
          { kind: 'context', oldNo: 42, newNo: 45, text: '  }' },
        ],
      },
      {
        id: 'h2',
        header: '@@ -61,6 +66,11 @@ export class SessionStore {',
        lines: [
          { kind: 'context', oldNo: 61, newNo: 66, text: '  async revoke(sessionId: string) {' },
          { kind: 'del', oldNo: 62, newNo: null, text: '    await this.db.delete(sessionId);' },
          { kind: 'add', oldNo: null, newNo: 67, text: '    const row = await this.db.get(sessionId);' },
          { kind: 'add', oldNo: null, newNo: 68, text: '    if (row?.refreshToken) await this.revokeFamily(row.familyId);' },
          { kind: 'add', oldNo: null, newNo: 69, text: '    await this.db.delete(sessionId);' },
          { kind: 'context', oldNo: 63, newNo: 70, text: '  }' },
        ],
      },
    ],
  },
  {
    path: 'src/auth/rotation.ts',
    status: 'A',
    added: 87,
    removed: 0,
    hunks: [
      {
        id: 'h1',
        header: '@@ -0,0 +1,12 @@',
        lines: [
          { kind: 'add', oldNo: null, newNo: 1, text: 'import { randomBytes } from "node:crypto";' },
          { kind: 'add', oldNo: null, newNo: 2, text: '' },
          { kind: 'add', oldNo: null, newNo: 3, text: 'export interface RotationResult {' },
          { kind: 'add', oldNo: null, newNo: 4, text: '  accessToken: string;' },
          { kind: 'add', oldNo: null, newNo: 5, text: '  refreshToken: string;' },
          { kind: 'add', oldNo: null, newNo: 6, text: '  familyId: string;' },
          { kind: 'add', oldNo: null, newNo: 7, text: '}' },
          { kind: 'context', oldNo: null, newNo: 8, text: '…' },
        ],
      },
    ],
  },
  {
    path: 'src/auth/legacy-cookies.ts',
    status: 'D',
    added: 0,
    removed: 64,
    hunks: [],
  },
];

export const FILES: FileNode = {
  name: 'omnipix',
  path: '',
  kind: 'dir',
  children: [
    {
      name: 'src',
      path: 'src',
      kind: 'dir',
      children: [
        {
          name: 'auth',
          path: 'src/auth',
          kind: 'dir',
          children: [
            { name: 'session.ts', path: 'src/auth/session.ts', kind: 'file', status: 'M' },
            { name: 'rotation.ts', path: 'src/auth/rotation.ts', kind: 'file', status: 'A' },
            { name: 'legacy-cookies.ts', path: 'src/auth/legacy-cookies.ts', kind: 'file', status: 'D' },
            { name: 'oauth.ts', path: 'src/auth/oauth.ts', kind: 'file' },
          ],
        },
        { name: 'agent', path: 'src/agent', kind: 'dir', children: [
          { name: 'runtime.ts', path: 'src/agent/runtime.ts', kind: 'file' },
          { name: 'tools.ts', path: 'src/agent/tools.ts', kind: 'file', status: 'M' },
        ] },
        { name: 'index.ts', path: 'src/index.ts', kind: 'file' },
      ],
    },
    { name: 'tests', path: 'tests', kind: 'dir', children: [
      { name: 'auth.test.ts', path: 'tests/auth.test.ts', kind: 'file', status: 'U' },
    ] },
    { name: 'package.json', path: 'package.json', kind: 'file' },
    { name: 'README.md', path: 'README.md', kind: 'file' },
  ],
};

export const TERMINALS: TerminalSession[] = [
  {
    id: 't1',
    title: 'npm test -- auth',
    running: true,
    lines: [
      { kind: 'cmd', text: '$ npm test -- auth' },
      { kind: 'out', text: ' ✓ src/auth/session.test.ts (8 tests) 214ms' },
      { kind: 'out', text: ' ✓ src/auth/rotation.test.ts (5 tests) 96ms' },
      { kind: 'out', text: ' ❯ src/auth/oauth.test.ts (3 tests | 1 failed)' },
    ],
  },
  { id: 't2', title: 'dev server', running: false, lines: [{ kind: 'cmd', text: '$ npm run dev' }, { kind: 'out', text: 'ready on http://localhost:5174' }] },
];

export const LOGS: string[] = [
  '10:41:02 router: groq llama-3.3-70b 200 812ms 1.2k/340t',
  '10:41:19 agent: step s3 edit src/auth/session.ts (+42 -9)',
  '10:41:31 approval: parked shell_exec (high risk)',
  '10:41:44 router: cerebras qwen3-32b 200 640ms 900/210t',
  '10:42:01 agent: step s5 command npm test -- auth (running)',
];

export const MESSAGES: ChatMessage[] = [
  { id: 'm1', role: 'user', text: 'Add refresh-token rotation to the session store. Revoking a session must revoke the whole token family.', ts: '10:38' },
  { id: 'm2', role: 'assistant', text: 'On it. I mapped the auth flow — `SessionStore.get` drops expired sessions instead of rotating them. Plan:\n\n1. Add `rotate()` to the session store\n2. Revoke the token family on revoke\n3. Cover rotation + expiry with tests', ts: '10:39', model: 'Auto', checkpoint: true },
  { id: 'm3', role: 'user', text: 'Also delete the legacy cookie helpers if nothing imports them.', ts: '10:40' },
  { id: 'm4', role: 'assistant', text: 'Done — `legacy-cookies.ts` had zero importers, removed. Rotation is in and auth tests are running now.', ts: '10:42', model: 'Auto', checkpoint: true },
];

export const APPROVAL: Approval = {
  id: 'a1',
  kind: 'command',
  command: 'rm -rf src/auth/legacy-cookies.ts && npm test -- auth',
  cwd: '~/code/omnipix',
  risk: 'high',
};

export const AGENTS: AgentDef[] = [
  { id: 'g1', name: 'Coder', model: 'Auto', tools: ['read', 'edit', 'shell', 'git'], systemPrompt: 'You write minimal, tested code.', status: 'running', runs: 12 },
  { id: 'g2', name: 'Reviewer', model: 'llama-3.3-70b', tools: ['read', 'search'], systemPrompt: 'You review diffs for bugs and security.', status: 'idle', runs: 34 },
  { id: 'g3', name: 'Researcher', model: 'qwen3-32b', tools: ['web_search', 'fetch'], systemPrompt: 'You answer from sources and cite them.', status: 'idle', runs: 8 },
];

export const PROVIDERS: ProviderDef[] = [
  { id: 'groq', name: 'Groq', status: 'ok', freeTier: true, models: 12, latencyMs: 640 },
  { id: 'cerebras', name: 'Cerebras', status: 'ok', freeTier: true, models: 6, latencyMs: 590 },
  { id: 'openai', name: 'OpenAI', status: 'none', freeTier: false, models: 8 },
  { id: 'anthropic', name: 'Anthropic', status: 'down', freeTier: false, models: 5 },
  { id: 'google', name: 'Google', status: 'ok', freeTier: true, models: 9, latencyMs: 810 },
];

export const EVAL_RUNS: EvalRun[] = [
  { id: 'e1', suite: 'safety-basics', passRate: 96, passed: 24, total: 25, ts: 'Today 09:12', model: 'llama-3.3-70b' },
  { id: 'e2', suite: 'safety-basics', passRate: 88, passed: 22, total: 25, ts: 'Today 08:02', model: 'qwen3-32b' },
  { id: 'e3', suite: 'coding-tasks', passRate: 72, passed: 18, total: 25, ts: 'Yesterday', model: 'llama-3.3-70b' },
];

export const NOTICES: Notice[] = [
  { id: 'n1', kind: 'approval', title: 'Approval needed: shell_exec', body: 'rm -rf src/auth/legacy-cookies.ts && npm test -- auth', ts: '2m', read: false },
  { id: 'n2', kind: 'run', title: "Automation 'nightly-eval' done", body: 'safety-basics 96% pass rate', ts: '1h', read: false },
  { id: 'n3', kind: 'error', title: 'Eval run failed: no available key', body: 'anthropic key cooling down', ts: '3h', read: true },
];

export const USAGE_DAYS = [
  { day: 'Mon', tokens: 42000, cost: 0.31 },
  { day: 'Tue', tokens: 88000, cost: 0.62 },
  { day: 'Wed', tokens: 35000, cost: 0.24 },
  { day: 'Thu', tokens: 121000, cost: 0.9 },
  { day: 'Fri', tokens: 96000, cost: 0.71 },
  { day: 'Sat', tokens: 18000, cost: 0.12 },
  { day: 'Sun', tokens: 54000, cost: 0.4 },
];
