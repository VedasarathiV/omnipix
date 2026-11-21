import type { AgentStep } from '../lib/queries';
import { StepCard, ThinkingBlock } from './StepCard';
import type { StepStatus, TimelineStep } from '../types';

function statusOf(step: AgentStep, result: AgentStep | null): StepStatus {
  if (step.kind === 'error') return 'failed';
  const exitCode = (result?.content as Record<string, unknown> | undefined)?.exitCode;
  if (typeof exitCode === 'number' && exitCode !== 0) return 'failed';
  if ((result?.content as Record<string, unknown> | undefined)?.error !== undefined) return 'failed';
  return 'done';
}

/** The tool_result paired with a call: scan forward, stop at the next call. */
function pairResult(steps: AgentStep[], index: number): AgentStep | null {
  const name = steps[index].name;
  for (let i = index + 1; i < steps.length; i++) {
    if (steps[i].kind === 'tool_call') break;
    if (steps[i].kind === 'tool_result' && steps[i].name === name) return steps[i];
  }
  return null;
}

function toTimeline(step: AgentStep, result: AgentStep | null): TimelineStep | null {
  if (step.kind === 'thought' || step.kind === 'plan' || step.kind === 'compact') return null;
  const content = step.content as Record<string, unknown>;
  // Call steps store inputs under `arguments`; fall back to flat fields.
  const args = (content.arguments ?? {}) as Record<string, unknown>;
  const arg = (key: string): unknown => args[key] ?? content[key];
  const status = statusOf(step, result);
  const name = step.name ?? step.kind;
  if (step.kind === 'tool_call') {
    if (name === 'read_file') {
      return { id: String(step.id), kind: 'read', title: `Read ${String(arg('path') ?? 'file')}`, status };
    }
    if (name === 'grep_search') {
      return { id: String(step.id), kind: 'search', title: `Searched ${String(arg('pattern') ?? '')}`, status };
    }
    if (name === 'write_file' || name === 'edit_file') {
      return {
        id: String(step.id),
        kind: name === 'write_file' ? 'create' : 'edit',
        title: `${name === 'write_file' ? 'Wrote' : 'Edited'} ${String(arg('path') ?? 'file')}`,
        status,
      };
    }
    if (name === 'shell_exec' || name === 'run_check') {
      const exitCode = (result?.content as Record<string, unknown> | undefined)?.exitCode;
      return {
        id: String(step.id),
        kind: 'command',
        title: `Ran ${String(arg('command') ?? name)}`,
        detail: typeof exitCode === 'number' ? `exit ${exitCode}` : undefined,
        status,
        exitCode: typeof exitCode === 'number' ? exitCode : undefined,
      };
    }
    if (name === 'delegate') {
      return { id: String(step.id), kind: 'subagent', title: `Sub-agent: ${String(arg('goal') ?? 'task')}`, status };
    }
    if (name.startsWith('git_')) {
      return { id: String(step.id), kind: 'command', title: `git ${name.slice(4)}`, status };
    }
    return { id: String(step.id), kind: 'search', title: `${name}`, detail: JSON.stringify(content).slice(0, 120), status };
  }
  if (step.kind === 'answer') {
    return { id: String(step.id), kind: 'read', title: 'Final answer', detail: String(content.text ?? '').slice(0, 200), status: 'done' };
  }
  if (step.kind === 'error') {
    return { id: String(step.id), kind: 'command', title: 'Step failed', detail: String(content.message ?? 'error'), status: 'failed' };
  }
  if (step.kind === 'check') {
    return { id: String(step.id), kind: 'command', title: `Check: ${String(content.name ?? name)}`, status: content.pass ? 'done' : 'failed' };
  }
  if (step.kind === 'restore') {
    return { id: String(step.id), kind: 'read', title: `Restored checkpoint ${String(content.checkpoint_id ?? '')}`, status: 'done' };
  }
  return null;
}

/** Live agent-run timeline from the durable step log. */
export function RunTimeline({ steps, runId }: { steps: AgentStep[]; runStatus: string; runId: number }) {
  async function resume() {
    const { apiFetch } = await import('../lib/api');
    await apiFetch(`/api/agents/runs/${runId}/resume`, { method: 'POST' });
  }
  const items = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.kind !== 'tool_result' && s.kind !== 'hook')
    .map(({ s, i }) => toTimeline(s, s.kind === 'tool_call' ? pairResult(steps, i) : null))
    .filter((s): s is TimelineStep => s !== null);
  const thoughts = steps.filter(s => s.kind === 'thought');
  if (!items.length && !thoughts.length) {
    return <p className="py-6 text-center text-xs text-ink-faint">Run started — steps stream in here.</p>;
  }
  return (
    <div className="space-y-2" aria-label="Agent timeline">
      {thoughts.length > 0 && (
        <ThinkingBlock thoughts={thoughts.map(t => String((t.content as Record<string, unknown>).text ?? JSON.stringify(t.content)).slice(0, 2000))} />
      )}
      {items.map(step => <StepCard key={step.id} step={step} onResume={() => void resume()} />)}
    </div>
  );
}
