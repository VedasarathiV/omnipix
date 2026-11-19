import { useState } from 'react';
import {
  Bot,
  ChevronDown,
  FileDiff,
  FilePlus2,
  FileText,
  FileX2,
  Globe,
  RotateCcw,
  Search,
  Terminal,
} from 'lucide-react';
import type { TimelineStep } from '../types';
import { StepIcon } from './PlanCard';
import { useStudio } from '../state/store';

const KIND_ICON: Record<TimelineStep['kind'], typeof Search> = {
  read: FileText,
  search: Search,
  edit: FileDiff,
  create: FilePlus2,
  delete: FileX2,
  command: Terminal,
  websearch: Globe,
  subagent: Bot,
  thinking: Bot,
};

export function StepCard({ step }: { step: TimelineStep }) {
  const [open, setOpen] = useState(step.status === 'running' || step.status === 'failed');
  const { pushToast } = useStudio();
  const Icon = KIND_ICON[step.kind];

  return (
    <div className={`rounded-xl border bg-base-1 ${step.status === 'failed' ? 'border-bad/50' : 'border-line'}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{step.title}</span>
        {step.added !== undefined && (
          <span className="shrink-0 font-mono text-[11px]">
            <span className="text-ok">+{step.added}</span> <span className="text-bad">-{step.removed ?? 0}</span>
          </span>
        )}
        {step.exitCode !== undefined && (
          <span className={`shrink-0 font-mono text-[11px] ${step.exitCode === 0 ? 'text-ok' : 'text-bad'}`}>exit {step.exitCode}</span>
        )}
        {step.durationMs !== undefined && (
          <span className="shrink-0 font-mono text-[11px] text-ink-faint">{(step.durationMs / 1000).toFixed(1)}s</span>
        )}
        <StepIcon status={step.status} />
        <ChevronDown className={`size-3.5 shrink-0 text-ink-faint transition-transform ${open ? '' : '-rotate-90'}`} strokeWidth={1.5} />
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2">
          {step.detail && <p className="font-mono text-[11px] break-words text-ink-dim">{step.detail}</p>}
          <p className="mt-1 font-mono text-[11px] break-words text-ink-faint">
            {step.kind === 'command' && '$ npm test -- auth\n ✓ 13 passed · 1 failed (oauth.test.ts)'}
            {step.kind === 'search' && 'src/auth/session.ts:40 · src/auth/oauth.ts:12 · src/agent/tools.ts:88 …'}
            {step.kind === 'subagent' && 'Verdict: rotation looks correct; watch the revoke-family race.'}
            {step.kind === 'read' && '212 lines · session lifecycle, expiry check at L40'}
            {(step.kind === 'edit' || step.kind === 'create') && 'See the Changes tab to review this diff.'}
          </p>
          <div className="mt-2 flex gap-1.5">
            {step.status === 'failed' && (
              <button
                type="button"
                onClick={() => pushToast('info', `Retrying ${step.title}`)}
                className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <RotateCcw className="size-3" strokeWidth={1.5} /> Retry step
              </button>
            )}
            <button
              type="button"
              onClick={() => pushToast('ok', 'Restored to before this step')}
              className="rounded-md border border-line px-2 py-1 text-[11px] outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
            >
              Restore to before this step
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ThinkingBlock() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-dashed border-line bg-base-1">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-dim outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Bot className="size-3.5" strokeWidth={1.5} />
        Reasoning
        <ChevronDown className={`size-3.5 transition-transform ${open ? '' : '-rotate-90'}`} strokeWidth={1.5} />
      </button>
      {open && (
        <p className="border-t border-line px-3 py-2 text-xs leading-relaxed text-ink-dim">
          The expiry check in `get` conflates “missing” with “expired”. Rotation needs the family id before the row is
          dropped, so the fix splits the branch and rotates first. Legacy cookies have no importers — safe to delete
          after the approval lands.
        </p>
      )}
    </div>
  );
}
