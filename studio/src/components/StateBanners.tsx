import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, RotateCcw, WifiOff } from 'lucide-react';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { useKeys, useRun } from '../lib/queries';

/** No-keys banner. Live: shows when no enabled provider key exists. */
export function KeyBanner() {
  const { setRail } = useStudio();
  const { data: keys = [] } = useKeys();
  const hasKeys = keys.some(k => k.enabled);
  if (hasKeys) return null;
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2">
      <KeyRound className="size-4 shrink-0 text-warn" strokeWidth={1.5} />
      <p className="min-w-0 flex-1 truncate text-xs">
        <span className="font-semibold">No provider keys yet</span>
        <span className="text-ink-dim"> — chat, agents, and evals all need one to run. Free tiers work.</span>
      </p>
      <button
        type="button"
        onClick={() => setRail('keys')}
        className="shrink-0 rounded-lg bg-warn px-2.5 py-1 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
      >
        Add a key
      </button>
    </div>
  );
}

/** Error banner with Retry, shown when the active run fails. */
export function RunErrorBanner() {
  const { activeRunId, pushToast } = useStudio();
  const { data: run } = useRun(activeRunId, true);
  const queryClient = useQueryClient();
  if (!run || (run.status !== 'error' && run.status !== 'stopped')) return null;

  async function resume() {
    if (activeRunId === null) return;
    try {
      await apiFetch(`/api/agents/runs/${activeRunId}/resume`, { method: 'POST' });
      pushToast('ok', 'Run resumed from the step log');
      void queryClient.invalidateQueries({ queryKey: ['agent-run', activeRunId] });
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Resume failed');
    }
  }

  return (
    <div role="alert" className="flex items-center gap-2 border-b border-bad/40 bg-bad/10 px-4 py-2">
      <AlertTriangle className="size-4 shrink-0 text-bad" strokeWidth={1.5} />
      <p className="min-w-0 flex-1 truncate text-xs">
        <span className="font-semibold">Run {run.status}:</span>
        <span className="font-mono text-ink-dim"> {(run.error ?? 'stopped').slice(0, 160)}</span>
      </p>
      <button
        type="button"
        onClick={() => void resume()}
        className="flex shrink-0 items-center gap-1 rounded-lg bg-bad px-2.5 py-1 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <RotateCcw className="size-3" strokeWidth={1.5} /> Resume
      </button>
    </div>
  );
}

/** Offline banner. Live: tracks navigator.onLine. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => window.navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  if (online) return null;
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-line bg-base-2 px-4 py-2">
      <WifiOff className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
      <p className="text-xs text-ink-dim">You are offline. Local drafts are kept; the agent resumes when you reconnect.</p>
    </div>
  );
}
