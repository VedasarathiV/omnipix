import { useEffect, useState } from 'react';
import { AlertTriangle, KeyRound, RotateCcw, WifiOff } from 'lucide-react';
import { useStudio } from '../state/store';

/** No-keys banner (§1 keep). Driven by store.hasKeys (wired to /api/keys live). */
export function KeyBanner() {
  const { hasKeys, setRail } = useStudio();
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

/** Error banner with Fix/Retry, shown when the run fails. */
export function RunErrorBanner() {
  const { runStatus, setRunStatus, pushToast } = useStudio();
  if (runStatus !== 'failed') return null;
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-bad/40 bg-bad/10 px-4 py-2">
      <AlertTriangle className="size-4 shrink-0 text-bad" strokeWidth={1.5} />
      <p className="min-w-0 flex-1 truncate text-xs">
        <span className="font-semibold">Run failed:</span>
        <span className="font-mono text-ink-dim"> oauth.test.ts — expected 401, got 200</span>
      </p>
      <button
        type="button"
        onClick={() => { setRunStatus('running'); pushToast('info', 'Fixing the failure…'); }}
        className="shrink-0 rounded-lg border border-line bg-base-1 px-2.5 py-1 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
      >
        Fix
      </button>
      <button
        type="button"
        onClick={() => setRunStatus('running')}
        className="flex shrink-0 items-center gap-1 rounded-lg bg-bad px-2.5 py-1 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <RotateCcw className="size-3" strokeWidth={1.5} /> Retry
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
