import type { RunStatus, StepStatus } from '../types';

const COLORS: Record<string, string> = {
  idle: 'bg-ink-faint',
  thinking: 'bg-info',
  running: 'bg-accent',
  waiting: 'bg-warn',
  done: 'bg-ok',
  failed: 'bg-bad',
  pending: 'bg-ink-faint',
};

const LABELS: Record<string, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  running: 'Running',
  waiting: 'Waiting approval',
  done: 'Done',
  failed: 'Failed',
  pending: 'Pending',
};

export function StatusDot({ status, pulse }: { status: RunStatus | StepStatus; pulse?: boolean }) {
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${COLORS[status]} ${pulse && (status === 'running' || status === 'thinking') ? 'animate-pulse' : ''}`}
      aria-label={LABELS[status]}
    />
  );
}

export function statusLabel(status: RunStatus | StepStatus): string {
  return LABELS[status];
}
