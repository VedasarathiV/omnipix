import type { AgentStep } from '../lib/queries';
import { StepCard, ThinkingBlock } from './StepCard';
import type { StepStatus, TimelineStep } from '../types';

function statusOf(step: AgentStep, runStatus: string): StepStatus {
  if (step.kind === 'error') return 'failed';
  if (runStatus === 'error' || runStatus === 'stopped') return 'failed';
  return 'done';
}

function toTimeline(step: AgentStep, runStatus: string): TimelineStep | null {
  if (step.kind === 'thought' || step.kind === 'plan' || step.kind === 'compact') return null;
  const content = step.content as Record<string, unknown>;
  const name = step.name ?? step.kind;
  if (step.kind === 'tool_call') {
    if (name === 'read_file') {
      return { id: String(step.id), kind: 'read', title: `Read ${String(content.path ?? 'file')}`, status: statusOf(step, runStatus) };
    }
    if (name === 'grep_search') {
      return { id: String(step.id), kind: 'search', title: `Searched ${String(content.pattern ?? '')}`, status: statusOf(step, runStatus) };
    }
    if (name === 'write_file' || name === 'edit_file') {
      return {
        id: String(step.id),
        kind: name === 'write_file' ? 'create' : 'edit',
        title: `${name === 'write_file' ? 'Wrote' : 'Edited'} ${String(content.path ?? 'file')}`,
        status: statusOf(step, runStatus),
      };
    }
    if (name === 'shell_exec' || name === 'run_check') {
      return {
        id: String(step.id),
        kind: 'command',
        title: `Ran ${String(content.command ?? name)}`,
        detail: typeof content.exitCode === 'number' ? `exit ${content.exitCode}` : undefined,
        status: statusOf(step, runStatus),
        exitCode: typeof content.exitCode === 'number' ? content.exitCode : undefined,
      };
    }
    if (name === 'delegate') {
      return { id: String(step.id), kind: 'subagent', title: `Sub-agent: ${String(content.goal ?? 'task')}`, status: statusOf(step, runStatus) };
    }
    if (name.startsWith('git_')) {
      return { id: String(step.id), kind: 'command', title: `git ${name.slice(4)}`, status: statusOf(step, runStatus) };
    }
    return { id: String(step.id), kind: 'search', title: `${name}`, detail: JSON.stringify(content).slice(0, 120), status: statusOf(step, runStatus) };
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
export function RunTimeline({ steps, runStatus, runId }: { steps: AgentStep[]; runStatus: string; runId: number }) {
  async function resume() {
    const { apiFetch } = await import('../lib/api');
    await apiFetch(`/api/agents/runs/${runId}/resume`, { method: 'POST' });
  }
  const items = steps
    .filter(s => s.kind !== 'tool_result' && s.kind !== 'hook')
    .map(s => toTimeline(s, runStatus))
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
