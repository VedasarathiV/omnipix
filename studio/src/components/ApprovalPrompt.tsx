import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import type { Approval } from '../types';
import { apiFetch } from '../lib/api';
import { useStudio } from '../state/store';

const RISK_STYLE = { low: 'text-ok', medium: 'text-warn', high: 'text-bad' } as const;

export function ApprovalPrompt({ approval, tool }: { approval: Approval; tool?: string }) {
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function decide(decision: 'once' | 'always' | 'deny') {
    setBusy(true);
    try {
      const id = Number(approval.id);
      if (decision === 'always' && tool) {
        await apiFetch('/api/agents/approval-rules', {
          method: 'POST',
          body: JSON.stringify({ tool, decision: 'allow' }),
        });
      }
      if (decision === 'deny' && tool) {
        // Deny stays one-shot; only explicit "always deny" pins (dashboard runs panel).
      }
      await apiFetch(`/api/agents/approvals/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ approved: decision !== 'deny' }),
      });
      pushToast(decision === 'deny' ? 'error' : 'ok', decision === 'deny' ? 'Denied — agent will work around it' : 'Approved — run resumed');
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['agent-run'] });
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Decision failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alertdialog" aria-label="Permission prompt" className="rounded-xl border border-warn/50 bg-base-1">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <AlertTriangle className="size-4 text-warn" strokeWidth={1.5} />
        <p className="text-[13px] font-semibold">Permission needed</p>
        <span className={`ml-auto rounded-md bg-base-2 px-1.5 py-0.5 text-[11px] font-medium ${RISK_STYLE[approval.risk]}`}>
          {approval.risk} risk
        </span>
      </div>
      <p className="px-3 pt-1 text-xs text-ink-dim">
        The agent wants to run a <span className="font-medium text-ink">{approval.kind}</span> in{' '}
        <span className="font-mono">{approval.cwd}</span>
      </p>
      <pre className="mx-3 mt-2 overflow-x-auto rounded-lg bg-base-0 p-2.5 font-mono text-xs break-all whitespace-pre-wrap">
        {approval.command}
      </pre>
      <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide('once')}
          className="rounded-lg bg-ok px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          Allow once
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide('always')}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          Always allow
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide('deny')}
          className="rounded-lg border border-bad/50 px-3 py-1.5 text-xs font-medium text-bad outline-none hover:bg-bad/10 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
