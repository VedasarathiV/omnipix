import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import {
  __clearRiskOverrides,
  __setRiskOverride,
  clearApprovalRule,
  decideApproval,
  evaluateToolCall,
  expireApproval,
  getApproval,
  listApprovalRules,
  listApprovals,
  parkForApproval,
  reconcileOrphanedApprovals,
  setApprovalRule,
  summarizeToolCall,
  toolRisk,
  waitForDecision,
} from '../../lib/agent-policy.js';

function seedRun(): number {
  const row = getDb().prepare(
    "INSERT INTO agent_runs (goal, model, status) VALUES ('goal', 'auto', 'running') RETURNING id",
  ).get() as { id: number };
  return row.id;
}

describe('agent policy', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    __clearRiskOverrides();
  });

  afterEach(() => {
    __clearRiskOverrides();
  });

  it('lets persistent rules override tiers, and clears them', () => {
    expect(evaluateToolCall('shell_exec')).toBe('pending');
    setApprovalRule('shell_exec', 'allow');
    expect(evaluateToolCall('shell_exec')).toBe('auto');
    setApprovalRule('shell_exec', 'deny');
    expect(evaluateToolCall('shell_exec')).toBe('deny');
    expect(listApprovalRules()).toMatchObject([{ tool: 'shell_exec', decision: 'deny' }]);
    expect(clearApprovalRule('shell_exec')).toBe(true);
    expect(clearApprovalRule('shell_exec')).toBe(false);
    expect(evaluateToolCall('shell_exec')).toBe('pending');
  });

  it('tiers tools: read auto, write/shell pending, unknown denied', () => {
    for (const tool of ['calculator', 'current_time', 'web_search', 'fetch_url', 'memory_write', 'memory_read', 'read_file', 'grep_search', 'blackboard_read', 'blackboard_write', 'recall_memory', 'recall_docs', 'find_skill', 'todo_write', 'git_status', 'git_diff', 'git_log', 'delegate', 'plan', 'browser_navigate', 'browser_snapshot', 'browser_screenshot', 'read_office']) {
      expect(toolRisk(tool)).toBe('read');
      expect(evaluateToolCall(tool)).toBe('auto');
    }
    for (const tool of ['write_file', 'edit_file', 'remember', 'git_branch', 'git_commit', 'browser_click', 'browser_type', 'write_docx', 'write_xlsx', 'write_pptx']) {
      expect(toolRisk(tool)).toBe('write');
      expect(evaluateToolCall(tool)).toBe('pending');
    }
    for (const tool of ['shell_exec', 'run_check', 'git_clone']) {
      expect(toolRisk(tool)).toBe('shell');
      expect(evaluateToolCall(tool)).toBe('pending');
    }
    expect(toolRisk('nuke_everything')).toBe('deny');
    expect(evaluateToolCall('nuke_everything')).toBe('deny');
  });

  it('parks elevated tools until decided', () => {
    __setRiskOverride('calculator', 'write');
    expect(evaluateToolCall('calculator')).toBe('pending');
  });

  it('summarizes tool calls for the inbox', () => {
    expect(summarizeToolCall('calculator', { expression: '2 + 2' })).toBe('Calculate 2 + 2');
    expect(summarizeToolCall('fetch_url', { url: 'https://x.test' })).toBe('Fetch https://x.test');
    expect(summarizeToolCall('delegate', { goal: 'Fix tests' })).toBe('Delegate: Fix tests');
    expect(summarizeToolCall('plan', { plan: '1. Think' })).toBe('Review plan: 1. Think');
    expect(summarizeToolCall('mystery', { a: 1 })).toBe('mystery(a)');
  });

  it('parks a run and resumes it on approve', async () => {
    const runId = seedRun();
    const id = parkForApproval(runId, 1, 'calculator', { expression: '1+1' });
    expect(getDb().prepare('SELECT status FROM agent_runs WHERE id = ?').get(runId)).toMatchObject({ status: 'awaiting_approval' });
    expect(getApproval(id)).toMatchObject({ run_id: runId, tool: 'calculator', status: 'pending' });

    const waited = waitForDecision(id);
    const decidedRun = decideApproval(id, true);
    expect(decidedRun).toBe(runId);
    expect(await waited).toBe(true);
    expect(getApproval(id)?.status).toBe('approved');
    expect(getDb().prepare('SELECT status FROM agent_runs WHERE id = ?').get(runId)).toMatchObject({ status: 'running' });
  });

  it('denies park the denial on the row and still resumes the loop', async () => {
    const runId = seedRun();
    const id = parkForApproval(runId, 1, 'calculator', {});
    const waited = waitForDecision(id);
    decideApproval(id, false);
    expect(await waited).toBe(false);
    expect(getApproval(id)?.status).toBe('denied');
    expect(getDb().prepare('SELECT status FROM agent_runs WHERE id = ?').get(runId)).toMatchObject({ status: 'running' });
  });

  it('rejects double decisions and unknown ids', () => {
    const runId = seedRun();
    const id = parkForApproval(runId, 1, 'calculator', {});
    decideApproval(id, true);
    expect(() => decideApproval(id, true)).toThrow('already approved');
    expect(() => decideApproval(99999, true)).toThrow('Approval not found');
  });

  it('expires approvals for stopped runs', () => {
    const runId = seedRun();
    const id = parkForApproval(runId, 1, 'calculator', {});
    expireApproval(id);
    expect(getApproval(id)?.status).toBe('expired');
    // Expiring twice, or expiring a decided row, is a silent no-op.
    expireApproval(id);
    expect(getApproval(id)?.status).toBe('expired');
  });

  it('aborting the waiter resolves false without deciding the row', async () => {
    const runId = seedRun();
    const id = parkForApproval(runId, 1, 'calculator', {});
    const controller = new AbortController();
    const waited = waitForDecision(id, controller.signal);
    controller.abort();
    expect(await waited).toBe(false);
    expect(getApproval(id)?.status).toBe('pending');
  });

  it('lists approvals newest first with an optional status filter', () => {
    const runId = seedRun();
    const first = parkForApproval(runId, 1, 'calculator', {});
    const second = parkForApproval(runId, 2, 'fetch_url', {});
    decideApproval(first, true);
    expect(listApprovals().map(a => a.id)).toEqual([second, first]);
    expect(listApprovals('pending').map(a => a.id)).toEqual([second]);
    expect(listApprovals('approved').map(a => a.id)).toEqual([first]);
  });

  it('reconciles runs orphaned by a restart', () => {
    const runId = seedRun();
    const id = parkForApproval(runId, 1, 'calculator', {});
    // No waiter exists (fresh process): the run is orphaned.
    expect(reconcileOrphanedApprovals()).toBe(1);
    expect(getDb().prepare('SELECT status, error FROM agent_runs WHERE id = ?').get(runId)).toMatchObject({
      status: 'error',
      error: expect.stringContaining('restarted'),
    });
    expect(getApproval(id)?.status).toBe('expired');
    // Second call is a no-op.
    expect(reconcileOrphanedApprovals()).toBe(0);
  });

  it('leaves live parked runs alone during reconciliation', async () => {
    const runId = seedRun();
    const id = parkForApproval(runId, 1, 'calculator', {});
    const waited = waitForDecision(id);
    expect(reconcileOrphanedApprovals()).toBe(0);
    decideApproval(id, true);
    expect(await waited).toBe(true);
  });
});
