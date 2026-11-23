import { getDb } from '../db/index.js';
import { notify } from './notifications.js';
import { emitWebhook } from '../services/webhooks.js';

// Agent tool policy: every tool call is evaluated BEFORE it executes.
//
// Risk tiers (fixed in Phase 0; per-install tuning arrives with the
// file/shell tools in Phase 1):
//   read  — side-effect-free (calculator, time, search, fetch, memory).
//           Auto-approved, decision recorded for the audit trail.
//   write — mutates user state (Phase 1 file tools). Parks the run in
//           `awaiting_approval` until an operator approves or denies.
//   shell — executes commands (Phase 1 shell). Same parking as write.
//   deny  — unknown tools. Never execute; the model gets a denial message.
//
// The loop waits in-process for the decision (a promise per approval id).
// A server restart orphans parked runs; boot reconciliation marks them
// errored with an explicit message rather than leaving them hanging.

export type ToolRisk = 'read' | 'write' | 'shell' | 'deny';
export type PolicyDecision = 'auto' | 'pending' | 'deny';

export interface ApprovalRow {
  id: number;
  run_id: number;
  seq: number;
  tool: string;
  args_json: string;
  risk: string;
  summary: string;
  diff_text: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  created_at: string;
  decided_at: string | null;
}

const READ_TOOLS = new Set([
  'calculator',
  'current_time',
  'web_search',
  'fetch_url',
  'memory_write',
  'memory_read',
  'read_file',
  'grep_search',
  'blackboard_read',
  'blackboard_write',
  'recall_memory',
  'git_status',
  'git_diff',
  'git_log',
  // Spawning a subagent is auto-approved: the child's own risky tools still
  // park individually, so gating the delegation too would double-escalate.
  'delegate',
  'recall_docs',
  'find_skill',
  'todo_write',
  'browser_navigate',
  'browser_snapshot',
  'browser_screenshot',
  'read_office',
  // Side-effect-free views: the repo sketch, a background job's output tail,
  // and credit-metered web reads (same footing as web_search/fetch_url).
  'repo_map',
  'shell_poll',
  'firecrawl_scrape',
  'firecrawl_map',
  'firecrawl_crawl',
  'firecrawl_extract',
]);

const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'remember', 'git_branch', 'git_commit', 'browser_click', 'browser_type', 'write_docx', 'write_xlsx', 'write_pptx']);
const SHELL_TOOLS = new Set(['shell_exec', 'run_check', 'git_clone', 'shell_start', 'shell_kill', 'git_pr']);

// Test seam + future strictness knob: per-tool risk overrides. A stricter
// install (or a test forcing the pending path) raises a tool's tier here.
const riskOverrides = new Map<string, ToolRisk>();

/** Test seam: force a risk tier for one tool. */
export function __setRiskOverride(tool: string, risk: ToolRisk): void {
  riskOverrides.set(tool, risk);
}

/** Test seam: drop all risk overrides. */
export function __clearRiskOverrides(): void {
  riskOverrides.clear();
}

export function toolRisk(name: string): ToolRisk {
  const override = riskOverrides.get(name);
  if (override) return override;
  // Pseudo-tool for plan-mode approvals: reviewing a plan changes nothing.
  // It is never offered in tool definitions, so it can never execute.
  if (name === 'plan') return 'read';
  if (READ_TOOLS.has(name)) return 'read';
  if (WRITE_TOOLS.has(name)) return 'write';
  if (SHELL_TOOLS.has(name)) return 'shell';
  // Third-party MCP tools can do anything their server allows — park them
  // like shell commands until an operator approves the call.
  if (name.startsWith('mcp:')) return 'shell';
  return 'deny';
}

export interface ApprovalRule {
  tool: string;
  decision: 'allow' | 'deny';
  created_at: string;
}

export function listApprovalRules(): ApprovalRule[] {
  return getDb().prepare('SELECT tool, decision, created_at FROM approval_rules ORDER BY tool').all() as ApprovalRule[];
}

export function setApprovalRule(tool: string, decision: 'allow' | 'deny'): ApprovalRule {
  const db = getDb();
  db.prepare(`INSERT INTO approval_rules (tool, decision) VALUES (?, ?)
              ON CONFLICT(tool) DO UPDATE SET decision = excluded.decision`).run(tool, decision);
  return db.prepare('SELECT tool, decision, created_at FROM approval_rules WHERE tool = ?').get(tool) as ApprovalRule;
}

export function clearApprovalRule(tool: string): boolean {
  return getDb().prepare('DELETE FROM approval_rules WHERE tool = ?').run(tool).changes > 0;
}

function ruleFor(tool: string): 'allow' | 'deny' | null {
  try {
    const row = getDb().prepare('SELECT decision FROM approval_rules WHERE tool = ?').get(tool) as { decision: 'allow' | 'deny' } | undefined;
    return row?.decision ?? null;
  } catch {
    // Table predates old test schemas; no rules then.
    return null;
  }
}

export function evaluateToolCall(name: string): PolicyDecision {
  // Persistent operator rules win over tiers: pinned trust compounds.
  const rule = ruleFor(name);
  if (rule === 'allow') return 'auto';
  if (rule === 'deny') return 'deny';
  const risk = toolRisk(name);
  if (risk === 'read') return 'auto';
  if (risk === 'deny') return 'deny';
  return 'pending';
}

/** One-line human summary of a tool call for the inbox and trace. */
export function summarizeToolCall(tool: string, args: Record<string, unknown>): string {
  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
  switch (tool) {
    case 'plan': {
      const plan = str(args.plan);
      return plan ? `Review plan: ${plan}` : 'Review plan';
    }
    case 'delegate': {
      const goal = str(args.goal);
      return goal ? `Delegate: ${goal}` : 'Delegate subtask';
    }
    case 'calculator': {
      const expr = str(args.expression);
      return expr ? `Calculate ${expr}` : 'Calculate an expression';
    }
    case 'current_time':
      return 'Read the current time';
    case 'web_search': {
      const query = str(args.query);
      return query ? `Search the web for "${query}"` : 'Search the web';
    }
    case 'fetch_url': {
      const url = str(args.url);
      return url ? `Fetch ${url}` : 'Fetch a URL';
    }
    case 'memory_write': {
      const key = str(args.key);
      return key ? `Remember "${key}"` : 'Write a memory';
    }
    case 'memory_read': {
      const key = str(args.key);
      return key ? `Recall "${key}"` : 'Read a memory';
    }
    case 'read_file': {
      const file = str(args.path);
      return file ? `Read ${file}` : 'Read a file';
    }
    case 'grep_search': {
      const pattern = str(args.pattern);
      return pattern ? `Search for "${pattern}"` : 'Search the workspace';
    }
    case 'write_file': {
      const file = str(args.path);
      return file ? `Write ${file}` : 'Write a file';
    }
    case 'edit_file': {
      const file = str(args.path);
      return file ? `Edit ${file}` : 'Edit a file';
    }
    case 'shell_exec': {
      const command = str(args.command);
      return command ? `Run: ${command}` : 'Run a shell command';
    }
    case 'run_check': {
      const name = str(args.name);
      return name ? `Run check "${name}"` : 'Run a repo check';
    }
    case 'blackboard_read': {
      const key = str(args.key);
      return key ? `Read shared "${key}"` : 'List shared findings';
    }
    case 'blackboard_write': {
      const key = str(args.key);
      return key ? `Publish "${key}" for the team` : 'Publish a team finding';
    }
    case 'remember': {
      const key = str(args.key);
      return key ? `Remember "${key}" long-term` : 'Save a long-term memory';
    }
    case 'recall_memory': {
      const query = str(args.query);
      return query ? `Search memory for "${query}"` : 'List long-term memories';
    }
    case 'recall_docs': {
      const query = str(args.query);
      return query ? `Search docs for "${query}"` : 'Search ingested docs';
    }
    case 'git_status':
      return 'Show git working-tree status';
    case 'git_diff':
      return 'Show uncommitted diff';
    case 'git_log':
      return 'Show recent commits';
    case 'git_branch': {
      const name = str(args.name);
      return name ? `Create branch "${name}"` : 'List branches';
    }
    case 'git_commit': {
      const message = str(args.message);
      return message ? `Commit: ${message.slice(0, 100)}` : 'Commit changes';
    }
    case 'git_clone': {
      const url = str(args.url);
      return url ? `Clone ${url}` : 'Clone a repository';
    }
    case 'git_pr': {
      const title = str(args.title);
      return title ? `Open PR: ${title.slice(0, 100)}` : 'Open a pull request';
    }
    case 'repo_map': {
      const target = str(args.path);
      return target ? `Map ${target}` : 'Sketch the repo map';
    }
    case 'shell_start': {
      const command = str(args.command);
      return command ? `Start background: ${command.slice(0, 100)}` : 'Start a background job';
    }
    case 'shell_poll': {
      const id = str(args.id);
      return id ? `Poll ${id}` : 'Poll a background job';
    }
    case 'shell_kill': {
      const id = str(args.id);
      return id ? `Kill ${id}` : 'Kill a background job';
    }
    case 'browser_navigate': {
      const url = str(args.url);
      return url ? `Browse to ${url}` : 'Browse to a URL';
    }
    case 'browser_snapshot':
      return 'Snapshot the browser page';
    case 'browser_click': {
      const ref = args.ref;
      return typeof ref === 'number' ? `Click element ${ref}` : 'Click a page element';
    }
    case 'browser_type':
      return 'Type into a page element';
    case 'browser_screenshot':
      return 'Screenshot the browser page';
    case 'read_office':
      return str(args.path) ? `Read office file ${str(args.path)}` : 'Read an office file';
    case 'write_docx':
      return str(args.path) ? `Write Word document ${str(args.path)}` : 'Write a Word document';
    case 'write_xlsx':
      return str(args.path) ? `Write Excel workbook ${str(args.path)}` : 'Write an Excel workbook';
    case 'write_pptx':
      return str(args.path) ? `Write PowerPoint deck ${str(args.path)}` : 'Write a PowerPoint deck';
    default: {
      if (tool.startsWith('mcp:')) {
        const rest = tool.slice('mcp:'.length);
        const sep = rest.indexOf(':');
        const label = sep > 0 ? `${rest.slice(0, sep)}/${rest.slice(sep + 1)}` : tool;
        return `MCP ${label}`;
      }
      return `${tool}(${Object.keys(args).join(', ')})`;
    }
  }
}

/**
 * Park a run for approval: insert the pending row and flip the run to
 * `awaiting_approval`. Returns the approval id the loop waits on.
 */
export function parkForApproval(
  runId: number,
  seq: number,
  tool: string,
  args: Record<string, unknown>,
  diffText?: string,
): number {
  const db = getDb();
  const row = db.prepare(
    `INSERT INTO approvals (run_id, seq, tool, args_json, risk, summary, diff_text, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending') RETURNING id`,
  ).get(
    runId, seq, tool, JSON.stringify(args), toolRisk(tool),
    summarizeToolCall(tool, args), diffText ?? null,
  ) as { id: number };
  db.prepare("UPDATE agent_runs SET status = 'awaiting_approval' WHERE id = ?").run(runId);
  touchSessionForRun(runId);
  notify('approval-pending', `Approval needed: ${tool}`, summarizeToolCall(tool, args), `/agents?tab=approvals`);
  emitWebhook('approval.created', { approvalId: row.id, runId, tool, risk: toolRisk(tool) });
  return row.id;
}

function touchSessionForRun(runId: number): void {
  getDb().prepare(
    `UPDATE agent_sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = (SELECT session_id FROM agent_runs WHERE id = ?)`,
  ).run(runId);
}

export interface ApprovalDecision {
  approved: boolean;
  /** Operator-narrowed file scope. Only git_commit honors it; ignored elsewhere. */
  paths?: string[];
}

type Waiter = (decision: ApprovalDecision) => void;
const waiters = new Map<number, Waiter>();

/** The loop awaits this; decideApproval resolves it. Never rejects. */
export function waitForDecision(approvalId: number, signal?: AbortSignal): Promise<ApprovalDecision> {
  if (signal?.aborted) return Promise.resolve({ approved: false });
  return new Promise<ApprovalDecision>(resolve => {
    const onAbort = () => {
      waiters.delete(approvalId);
      signal?.removeEventListener('abort', onAbort);
      resolve({ approved: false });
    };
    waiters.set(approvalId, decision => {
      waiters.delete(approvalId);
      signal?.removeEventListener('abort', onAbort);
      resolve(decision);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Mark a pending approval expired (run stopped while parked). */
export function expireApproval(id: number): void {
  getDb().prepare(
    `UPDATE approvals SET status = 'expired', decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ? AND status = 'pending'`,
  ).run(id);
}

export function getApproval(id: number): ApprovalRow | null {
  const row = getDb().prepare('SELECT * FROM approvals WHERE id = ?').get(id) as ApprovalRow | undefined;
  return row ?? null;
}

export function listApprovals(status?: string, limit = 50): ApprovalRow[] {
  const db = getDb();
  if (status) {
    return db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit) as ApprovalRow[];
  }
  return db.prepare('SELECT * FROM approvals ORDER BY id DESC LIMIT ?').all(limit) as ApprovalRow[];
}

/**
 * Decide a pending approval. Returns the run id so the caller can report it;
 * the parked loop wakes itself through the waiter map. Deciding an already
 * decided row throws — the caller renders that as a 409. `paths` narrows a
 * git_commit approval to those files; it is rejected for any other tool.
 */
export function decideApproval(id: number, approved: boolean, paths?: string[]): number {
  const db = getDb();
  const row = getApproval(id);
  if (!row) throw new Error('Approval not found');
  if (row.status !== 'pending') throw new Error(`Approval already ${row.status}`);
  const scoped = (paths ?? []).map(p => p.trim()).filter(Boolean);
  if (scoped.length > 0 && row.tool !== 'git_commit') {
    throw new Error('File-scoped approval only applies to git_commit');
  }
  db.prepare(
    `UPDATE approvals SET status = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
  ).run(approved ? 'approved' : 'denied', id);
  const waiter = waiters.get(id);
  if (waiter) {
    // Back to running BEFORE waking: the loop's next step must land on a
    // running run, and a deny still resumes the loop (it records the denial
    // as the tool result and lets the model react).
    db.prepare("UPDATE agent_runs SET status = 'running' WHERE id = ? AND status = 'awaiting_approval'").run(row.run_id);
    waiter({ approved, ...(scoped.length > 0 ? { paths: scoped } : {}) });
  } else if (!approved) {
    // No live waiter (restart, or the run was stopped): a denial still kills
    // the run explicitly rather than leaving it parked.
    db.prepare("UPDATE agent_runs SET status = 'stopped', error = 'denied by operator', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'awaiting_approval'")
      .run(row.run_id);
  }
  touchSessionForRun(row.run_id);
  return row.run_id;
}

/**
 * Boot reconciliation: any run still parked after a restart has no waiter
 * and would hang forever. Fail it loudly instead. Idempotent and cheap —
 * safe to call on every boot (and in tests, where it is a no-op).
 */
export function reconcileOrphanedApprovals(): number {
  const db = getDb();
  const parked = db.prepare("SELECT id FROM agent_runs WHERE status = 'awaiting_approval'").all() as { id: number }[];
  if (!parked.length) return 0;
  // waiters is non-empty only when called mid-process (tests); on a real boot
  // it is always empty, so every parked run is orphaned.
  let orphaned = 0;
  for (const run of parked) {
    const hasWaiter = [...waiters.keys()].some(approvalId => {
      const row = getApproval(approvalId);
      return row?.run_id === run.id && row.status === 'pending';
    });
    if (hasWaiter) continue;
    db.prepare(
      `UPDATE agent_runs SET status = 'error', error = 'server restarted while awaiting approval — review the pending request and re-run',
       finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    ).run(run.id);
    db.prepare("UPDATE approvals SET status = 'expired', decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id = ? AND status = 'pending'")
      .run(run.id);
    orphaned++;
  }
  return orphaned;
}
