import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { useModels } from '../lib/queries';

const STRATEGIES = [
  { id: 'priority', label: 'Manual order', hint: 'Drag the chain; top wins' },
  { id: 'balanced', label: 'Balanced', hint: 'Reliability, speed, intelligence' },
  { id: 'smartest', label: 'Smartest', hint: 'Intelligence first' },
  { id: 'fastest', label: 'Fastest', hint: 'Latency first' },
  { id: 'reliable', label: 'Most reliable', hint: 'Uptime first' },
  { id: 'decision', label: 'Decision', hint: 'A judge picks per turn' },
] as const;

interface ChainRow {
  modelDbId: number;
  priority: number;
  effectivePriority: number;
  penalty: number;
  rateLimitHits: number;
  enabled: boolean;
  platform: string;
  modelId: string;
  displayName: string;
  retiredUpstream?: boolean;
  retiredReason?: string | null;
}

interface RoutingState {
  strategy?: string;
  active?: string;
}

export function ModelsPage() {
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [chain, setChain] = useState<ChainRow[] | null>(null);
  const [strategy, setStrategy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const { data: models = [] } = useModels();

  async function refresh() {
    try {
      const [chainRes, routingRes] = await Promise.all([
        apiFetch<ChainRow[]>('/api/fallback'),
        apiFetch<RoutingState>('/api/fallback/routing'),
      ]);
      setChain(chainRes);
      setStrategy(routingRes.strategy ?? routingRes.active ?? 'balanced');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Load failed');
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setPreset(id: string) {
    try {
      await apiFetch('/api/fallback/routing', { method: 'PUT', body: JSON.stringify({ strategy: id }) });
      setStrategy(id);
      pushToast('ok', `Routing strategy: ${id}`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Strategy failed');
    }
  }

  async function saveChain(next: ChainRow[]) {
    setChain(next);
    try {
      await apiFetch('/api/fallback', {
        method: 'PUT',
        body: JSON.stringify(next.map((row, i) => ({ modelDbId: row.modelDbId, priority: i, enabled: row.enabled }))),
      });
      void queryClient.invalidateQueries({ queryKey: ['models'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Reorder failed');
      void refresh();
    }
  }

  async function toggleModel(row: ChainRow) {
    try {
      await apiFetch(`/api/models/${row.modelDbId}`, { method: 'PATCH', body: JSON.stringify({ enabled: !row.enabled }) });
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['models'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Toggle failed');
    }
  }

  function move(modelDbId: number, dir: -1 | 1) {
    if (!chain) return;
    const i = chain.findIndex(r => r.modelDbId === modelDbId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= chain.length) return;
    const next = [...chain];
    [next[i], next[j]] = [next[j], next[i]];
    void saveChain(next);
  }

  const enabledCount = models.filter(m => m.enabled).length;
  const q = query.toLowerCase().trim();
  const rows = (chain ?? []).filter(r => !q || r.modelId.toLowerCase().includes(q) || r.platform.toLowerCase().includes(q));

  return (
    <div className="mx-auto max-w-5xl px-5 py-4">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Models</h1>
        <span className="font-mono text-xs text-ink-dim">{enabledCount} of {models.length} enabled</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Routing strategy">
        {STRATEGIES.map(s => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={strategy === s.id}
            title={s.hint}
            onClick={() => void setPreset(s.id)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              strategy === s.id ? 'border-accent/60 bg-accent/10 font-medium' : 'border-line text-ink-dim hover:text-ink'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-line bg-base-1 px-2.5 py-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Filter ${chain?.length ?? 0} chained models…`}
          aria-label="Filter models"
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
        />
      </div>
      {chain === null && <p className="animate-pulse py-4 text-center text-xs text-ink-dim">Loading fallback chain…</p>}
      <div className="space-y-1.5">
        {rows.slice(0, 120).map(row => (
          <div key={row.modelDbId} className="flex items-center gap-2 rounded-xl border border-line bg-base-1 px-3 py-2">
            <span className="w-7 shrink-0 text-right font-mono text-[11px] text-ink-faint">{row.priority}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs font-medium">
                {row.modelId}
                <span className="ml-1.5 text-ink-faint">· {row.platform}</span>
                {row.penalty > 0 && <span className="ml-1.5 text-warn">+{row.penalty} penalty</span>}
                {row.retiredUpstream && <span className="ml-1.5 text-bad">retired upstream</span>}
              </p>
            </div>
            <button type="button" title="Move up" aria-label={`Move ${row.modelId} up`} onClick={() => move(row.modelDbId, -1)} className="rounded-md px-1.5 py-1 text-xs text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent">↑</button>
            <button type="button" title="Move down" aria-label={`Move ${row.modelId} down`} onClick={() => move(row.modelDbId, 1)} className="rounded-md px-1.5 py-1 text-xs text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent">↓</button>
            <button
              type="button"
              role="switch"
              aria-checked={row.enabled}
              aria-label={row.modelId}
              onClick={() => void toggleModel(row)}
              className={`relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${row.enabled ? 'bg-accent' : 'bg-base-2'}`}
            >
              <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${row.enabled ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>
        ))}
      </div>
      {(chain?.length ?? 0) > 120 && <p className="mt-2 text-xs text-ink-faint">Showing 120 of {chain?.length} — filter to narrow.</p>}
    </div>
  );
}
