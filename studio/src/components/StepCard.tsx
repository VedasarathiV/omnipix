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

export function StepCard({ step, onResume }: { step: TimelineStep; onResume?: () => void }) {
  const [open, setOpen] = useState(step.status === 'running' || step.status === 'failed');
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
          {step.detail && <p className="font-mono text-[11px] break-words whitespace-pre-wrap text-ink-dim">{step.detail}</p>}
          {!step.detail && <p className="font-mono text-[11px] text-ink-faint">No additional output.</p>}
          {step.status === 'failed' && onResume && (
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={onResume}
                className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <RotateCcw className="size-3" strokeWidth={1.5} /> Resume run
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ThinkingBlock({ thoughts }: { thoughts: string[] }) {
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
        Reasoning ({thoughts.length})
        <ChevronDown className={`size-3.5 transition-transform ${open ? '' : '-rotate-90'}`} strokeWidth={1.5} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2">
          {thoughts.map((text, i) => (
            <p key={i} className="text-xs leading-relaxed whitespace-pre-wrap text-ink-dim">{text}</p>
          ))}
        </div>
      )}
    </div>
  );
}
