import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GitCompare, Play } from 'lucide-react';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { useEvalRuns, useEvalSuites, useModels } from '../lib/queries';

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
  const queryClient = useQueryClient();
  const { data: suitesData } = useEvalSuites();
  const { data: runsData } = useEvalRuns();
  const { data: models = [] } = useModels();
  const [suite, setSuite] = useState('');
  const [model, setModel] = useState('');
  const runs = runsData?.evals ?? [];
  const suites = suitesData?.suites ?? [];
  const enabled = models.filter(m => m.enabled);

  async function launch() {
    if (!suite || !model) {
      pushToast('error', 'Pick a suite and a model first');
      return;
    }
    try {
      await apiFetch('/api/arena/evals', { method: 'POST', body: JSON.stringify({ suite, models: [model] }) });
      pushToast('ok', `Eval started: ${suite} on ${model}`);
      void queryClient.invalidateQueries({ queryKey: ['eval-runs'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Launch failed');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-base-1 p-3">
        <select value={suite} onChange={e => setSuite(e.target.value)} aria-label="Suite" className="min-w-40 flex-1 rounded-lg border border-line bg-base-0 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <option value="">Pick a suite…</option>
          {suites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <select value={model} onChange={e => setModel(e.target.value)} aria-label="Model" className="min-w-40 flex-1 rounded-lg border border-line bg-base-0 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <option value="">Pick a model…</option>
          {enabled.map(m => <option key={m.id} value={m.modelId}>{m.modelId}</option>)}
        </select>
        <button
          type="button"
          onClick={() => void launch()}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Play className="size-3.5" strokeWidth={1.5} /> New eval run
        </button>
      </div>
      {runs.length === 0 && <p className="py-4 text-center text-xs text-ink-faint">No eval runs yet.</p>}
      {runs.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-base-1 text-xs text-ink-dim">
                <th className="px-3 py-2 font-medium">Suite</th>
                <th className="px-3 py-2 font-medium">Models</th>
                <th className="px-3 py-2 font-medium">Pass rate</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => {
                const passed = run.results.reduce((a, r) => a + r.passed, 0);
                const total = run.results.reduce((a, r) => a + r.total, 0);
                const rate = total ? Math.round((passed / total) * 100) : 0;
                return (
                  <tr key={run.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs">{run.suite}</td>
                    <td className="px-3 py-2 font-mono text-xs">{run.results.map(r => r.model).join(', ') || '—'}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-base-2">
                          <span className={`block h-full rounded-full ${rate >= 90 ? 'bg-ok' : rate >= 70 ? 'bg-warn' : 'bg-bad'}`} style={{ width: `${rate}%` }} />
                        </span>
                        <span className="font-mono text-xs">{run.status === 'done' ? `${rate}% (${passed}/${total})` : run.status}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-dim">{run.created_at}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CompareTab() {
  const { data } = useEvalRuns();
  const done = (data?.evals ?? []).filter(e => e.status === 'done').slice(0, 2);
  if (done.length < 2) {
    return <p className="py-6 text-center text-xs text-ink-faint">Run two evals to compare them side by side.</p>;
  }
  const rates = done.map(run => {
    const passed = run.results.reduce((a, r) => a + r.passed, 0);
    const total = run.results.reduce((a, r) => a + r.total, 0);
    return { run, rate: total ? Math.round((passed / total) * 100) : 0, passed, total };
  });
  const delta = rates[0].rate - rates[1].rate;
  return (
    <div>
      <p className="mb-3 flex items-center gap-1.5 text-xs text-ink-dim">
        <GitCompare className="size-3.5" strokeWidth={1.5} /> Latest two finished runs
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {rates.map(({ run, rate, passed, total }) => (
          <article key={run.id} className="rounded-xl border border-line bg-base-1 p-4">
            <p className="font-mono text-xs text-ink-dim">{run.suite} · {run.results.map(r => r.model).join(', ')}</p>
            <p className="mt-1 text-2xl font-bold">{rate}%</p>
            <p className="text-xs text-ink-dim">{passed}/{total} passed</p>
          </article>
        ))}
      </div>
      <p className={`mt-3 rounded-xl border px-3 py-2 text-xs ${delta >= 0 ? 'border-ok/40 bg-ok/10' : 'border-bad/40 bg-bad/10'}`}>
        Δ {delta >= 0 ? '+' : ''}{delta}pts for the newer run.
      </p>
    </div>
  );
}

interface UsageSummary {
  total_requests?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  est_cost_usd?: number;
  by_platform?: Array<{ platform: string; requests: number; cost_usd?: number }>;
}

function UsageTab() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    apiFetch<UsageSummary>('/api/analytics/summary?range=7d')
      .then(data => { if (live) setSummary(data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  if (failed) {
    return <p className="py-6 text-center text-xs text-ink-faint">Usage analytics are unavailable right now.</p>;
  }
  if (!summary) {
    return <p className="animate-pulse py-6 text-center text-xs text-ink-dim">Loading usage…</p>;
  }
  const platforms = summary.by_platform ?? [];
  const max = Math.max(1, ...platforms.map(p => p.requests));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Requests (7d)" value={String(summary.total_requests ?? 0)} />
        <Stat label="Tokens (7d)" value={((summary.total_input_tokens ?? 0) + (summary.total_output_tokens ?? 0)).toLocaleString()} />
        <Stat label="Est. cost (7d)" value={`$${(summary.est_cost_usd ?? 0).toFixed(2)}`} />
      </div>
      <div className="rounded-xl border border-line bg-base-1 p-4">
        <p className="mb-3 text-[13px] font-semibold">Requests per provider</p>
        {platforms.length === 0 && <p className="text-xs text-ink-faint">No traffic in range.</p>}
        <div className="space-y-2">
          {platforms.map(p => (
            <div key={p.platform} className="flex items-center gap-2" title={`${p.requests} requests`}>
              <span className="w-24 truncate font-mono text-[11px]">{p.platform}</span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-base-2">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${(p.requests / max) * 100}%` }} />
              </span>
              <span className="w-12 text-right font-mono text-[11px] text-ink-dim">{p.requests}</span>
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
