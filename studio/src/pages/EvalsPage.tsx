import { useState } from 'react';
import { GitCompare, Play } from 'lucide-react';
import { EVAL_RUNS, USAGE_DAYS } from '../mock/data';
import { useStudio } from '../state/store';

const TABS = ['Runs', 'Compare', 'Usage'] as const;

export function EvalsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Runs');
  return (
    <div className="mx-auto max-w-5xl px-5 py-4">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Evals & usage</h1>
      </div>
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist" aria-label="Evals sections">
        {TABS.map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              tab === t ? 'border-accent font-medium' : 'border-transparent text-ink-dim hover:text-ink'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Runs' && <RunsTab />}
      {tab === 'Compare' && <CompareTab />}
      {tab === 'Usage' && <UsageTab />}
    </div>
  );
}

function RunsTab() {
  const { pushToast } = useStudio();
  const max = Math.max(...EVAL_RUNS.map(r => r.passRate));
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => pushToast('info', 'Eval run started: safety-basics')}
        className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Play className="size-3.5" strokeWidth={1.5} /> New eval run
      </button>
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-base-1 text-xs text-ink-dim">
              <th className="px-3 py-2 font-medium">Suite</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Pass rate</th>
              <th className="px-3 py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {EVAL_RUNS.map(run => (
              <tr key={run.id} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 font-mono text-xs">{run.suite}</td>
                <td className="px-3 py-2 font-mono text-xs">{run.model}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-base-2">
                      <span className={`block h-full rounded-full ${run.passRate >= 90 ? 'bg-ok' : run.passRate >= 70 ? 'bg-warn' : 'bg-bad'}`} style={{ width: `${(run.passRate / max) * 100}%` }} />
                    </span>
                    <span className="font-mono text-xs">{run.passRate}% ({run.passed}/{run.total})</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-ink-dim">{run.ts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompareTab() {
  const { pushToast } = useStudio();
  const [a, b] = EVAL_RUNS;
  return (
    <div>
      <button
        type="button"
        onClick={() => pushToast('info', 'Comparing latest two safety-basics runs')}
        className="mb-3 flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-1 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <GitCompare className="size-3.5" strokeWidth={1.5} /> Compare selected
      </button>
      <div className="grid gap-3 md:grid-cols-2">
        {[a, b].map(run => (
          <article key={run.id} className="rounded-xl border border-line bg-base-1 p-4">
            <p className="font-mono text-xs text-ink-dim">{run.model} · {run.ts}</p>
            <p className="mt-1 text-2xl font-bold">{run.passRate}%</p>
            <p className="text-xs text-ink-dim">{run.passed}/{run.total} passed · {run.suite}</p>
          </article>
        ))}
      </div>
      <p className="mt-3 rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-xs">
        Δ +8pts for {a.model} — both newly-passing items are refusal checks.
      </p>
    </div>
  );
}

function UsageTab() {
  const max = Math.max(...USAGE_DAYS.map(d => d.tokens));
  const totalCost = USAGE_DAYS.reduce((a, d) => a + d.cost, 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Tokens this week" value="533k" />
        <Stat label="Cost this week" value={`$${totalCost.toFixed(2)}`} />
        <Stat label="Top provider" value="Groq · 61%" />
      </div>
      <div className="rounded-xl border border-line bg-base-1 p-4">
        <p className="mb-3 text-[13px] font-semibold">Tokens per day</p>
        <div className="flex h-32 items-end gap-2" role="img" aria-label="Tokens per day bar chart">
          {USAGE_DAYS.map(d => (
            <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.tokens.toLocaleString()} tokens · $${d.cost}`}>
              <div className="flex w-full flex-1 items-end rounded-md bg-base-0">
                <div className="w-full rounded-md bg-accent" style={{ height: `${(d.tokens / max) * 100}%` }} />
              </div>
              <span className="text-[10px] text-ink-faint">{d.day}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-base-1 p-4">
      <p className="text-xs text-ink-dim">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}
