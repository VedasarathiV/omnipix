import { AlertTriangle } from 'lucide-react';
import type { Approval } from '../types';
import { useStudio } from '../state/store';

const RISK_STYLE = { low: 'text-ok', medium: 'text-warn', high: 'text-bad' } as const;

export function ApprovalPrompt({ approval }: { approval: Approval }) {
  const { decideApproval } = useStudio();
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
          onClick={() => decideApproval('once')}
          className="rounded-lg bg-ok px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
        >
          Allow once
        </button>
        <button
          type="button"
          onClick={() => decideApproval('always')}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
        >
          Always allow
        </button>
        <button
          type="button"
          onClick={() => decideApproval('deny')}
          className="rounded-lg border border-bad/50 px-3 py-1.5 text-xs font-medium text-bad outline-none hover:bg-bad/10 focus-visible:ring-2 focus-visible:ring-accent"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
