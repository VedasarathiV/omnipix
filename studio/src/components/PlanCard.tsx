import { useState } from 'react';
import { Check, ChevronDown, Circle, Loader2, Pencil, X } from 'lucide-react';
import type { PlanStep, StepStatus } from '../types';

export function PlanCard({ steps: initial }: { steps: PlanStep[] }) {
  const [steps, setSteps] = useState<PlanStep[]>(initial);
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);

  const done = steps.filter(s => s.status === 'done').length;
  return (
    <section aria-label="Plan" className="rounded-xl border border-line bg-base-1">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ChevronDown className={`size-4 text-ink-dim transition-transform ${open ? '' : '-rotate-90'}`} strokeWidth={1.5} />
        <span className="text-[13px] font-semibold">Plan</span>
        <span className="font-mono text-[11px] text-ink-dim">{done}/{steps.length}</span>
        <span className="mx-1 h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-base-2">
          <span className="block h-full rounded-full bg-ok" style={{ width: `${(done / steps.length) * 100}%` }} />
        </span>
      </button>
      {open && (
        <ol className="space-y-0.5 px-2 pb-2">
          {steps.map(step => (
            <li key={step.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-base-0">
              <StepIcon status={step.status} />
              {editing === step.id ? (
                <input
                  autoFocus
                  defaultValue={step.label}
                  aria-label="Edit step"
                  onBlur={e => {
                    setSteps(list => list.map(s => (s.id === step.id ? { ...s, label: e.target.value } : s)));
                    setEditing(null);
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="min-w-0 flex-1 rounded-md border border-line bg-base-0 px-1.5 py-0.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              ) : (
                <span className={`min-w-0 flex-1 text-[13px] ${step.status === 'done' ? 'text-ink-dim line-through' : ''}`}>{step.label}</span>
              )}
              <button
                type="button"
                aria-label={`Edit ${step.label}`}
                onClick={() => setEditing(step.id)}
                className="rounded p-1 text-ink-faint opacity-0 outline-none group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Pencil className="size-3.5" strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <Check className="size-4 shrink-0 text-ok" strokeWidth={2} />;
  if (status === 'running') return <Loader2 className="size-4 shrink-0 animate-spin text-accent" strokeWidth={1.5} />;
  if (status === 'failed') return <X className="size-4 shrink-0 text-bad" strokeWidth={2} />;
  return <Circle className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />;
}
