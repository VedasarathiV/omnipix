import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, FileDiff, GitBranch, GitCommitHorizontal } from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import { EmptyState } from './EmptyState';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { useCheckpoints, useGitStatus, useRunDiff } from '../lib/queries';

const STATUS_STYLE: Record<string, string> = {
  M: 'text-warn',
  A: 'text-ok',
  D: 'text-bad',
  U: 'text-info',
};

export function ChangesPanel() {
  const { activeRunId, acceptedFiles, acceptFile, acceptAll, pushToast, setAgentEditor } = useStudio();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [against, setAgainst] = useState<number | null>(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [branchName, setBranchName] = useState('');
  const [showBranch, setShowBranch] = useState(false);

  const { data: diff, isLoading } = useRunDiff(activeRunId, against);
  const { data: checkpoints } = useCheckpoints(activeRunId);
  const { data: git } = useGitStatus(activeRunId);

  if (activeRunId === null) {
    return (
      <EmptyState
        icon={<FileDiff className="size-5" strokeWidth={1.5} />}
        title="No run selected"
        body="Start an agent run from the input bar — its file changes land here for review."
        action={
          <button
            type="button"
            onClick={() => setAgentEditor('new')}
            className="mt-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
          >
            New run
          </button>
        }
      />
    );
  }
  if (isLoading || !diff) {
    return <p className="animate-pulse px-3 py-4 text-center text-xs text-ink-dim">Loading changes…</p>;
  }

  const totalAdded = diff.files.reduce((a, c) => a + c.added, 0);
  const totalRemoved = diff.files.reduce((a, c) => a + c.removed, 0);

  async function revertFile(path: string) {
    try {
      await apiFetch(`/api/agents/runs/${activeRunId}/files/revert`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      acceptFile(path, false);
      pushToast('ok', `Reverted ${path}`);
      void queryClient.invalidateQueries({ queryKey: ['run-diff'] });
      void queryClient.invalidateQueries({ queryKey: ['run-files'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Revert failed');
    }
  }

  async function commit() {
    if (!commitMsg.trim()) {
      pushToast('error', 'Write a commit message first');
      return;
    }
    try {
      const res = await apiFetch<{ sha: string }>(`/api/agents/runs/${activeRunId}/git/commit`, {
        method: 'POST',
        body: JSON.stringify({ message: commitMsg }),
      });
      setCommitMsg('');
      pushToast('ok', `Committed ${res.sha}`);
      void queryClient.invalidateQueries({ queryKey: ['git-status'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Commit failed');
    }
  }

  async function createBranch() {
    if (!branchName.trim()) return;
    try {
      const res = await apiFetch<{ branch: string }>(`/api/agents/runs/${activeRunId}/git/branch`, {
        method: 'POST',
        body: JSON.stringify({ name: branchName }),
      });
      setBranchName('');
      setShowBranch(false);
      pushToast('ok', `Branch ${res.branch} created`);
      void queryClient.invalidateQueries({ queryKey: ['git-status'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Branch failed');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[13px] font-semibold">Changes</span>
        <span className="font-mono text-[11px]">
          <span className="text-ok">+{totalAdded}</span> <span className="text-bad">-{totalRemoved}</span>
        </span>
        <span className="flex-1" />
        {(checkpoints?.checkpoints ?? []).length > 0 && (
          <select
            aria-label="Compare against checkpoint"
            value={against ?? ''}
            onChange={e => setAgainst(e.target.value ? Number(e.target.value) : null)}
            className="max-w-32 rounded-md border border-line bg-base-1 px-1 py-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">vs empty</option>
            {(checkpoints?.checkpoints ?? []).map(c => (
              <option key={c.id} value={c.id}>#{c.id} {c.label || 'snapshot'}</option>
            ))}
          </select>
        )}
        {diff.files.length > 0 && (
          <button
            type="button"
            onClick={() => {
              acceptAll(diff.files.map(f => f.path));
              pushToast('ok', 'All changes accepted');
            }}
            className="rounded-md bg-ok px-2 py-1 text-[11px] font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
          >
            Accept all
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {diff.files.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-ink-faint">No changes yet — the agent has not written any files.</p>
        )}
        {diff.files.map(change => {
          const isOpen = open === change.path;
          const accepted = acceptedFiles.has(change.path);
          return (
            <div key={change.path} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : change.path)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2 px-3 py-2 text-left outline-none hover:bg-base-0 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className={`w-3 font-mono text-[11px] font-bold ${STATUS_STYLE[change.status]}`}>{change.status}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{change.path}</span>
                {accepted && <Check className="size-3.5 shrink-0 text-ok" strokeWidth={2} />}
                <span className="shrink-0 font-mono text-[11px]">
                  <span className="text-ok">+{change.added}</span> <span className="text-bad">-{change.removed}</span>
                </span>
                <ChevronDown className={`size-3.5 shrink-0 text-ink-faint transition-transform ${isOpen ? '' : '-rotate-90'}`} strokeWidth={1.5} />
              </button>
              {isOpen && <DiffViewer path={change.path} hunks={change.hunks} onRevert={() => void revertFile(change.path)} />}
            </div>
          );
        })}
      </div>
      <div className="shrink-0 space-y-2 border-t border-line p-3">
        {git?.isRepo ? (
          <>
            <p className="font-mono text-[11px] text-ink-dim">git · {git.branch || 'detached'}</p>
            <input
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
              aria-label="Commit message"
              placeholder="Commit message"
              className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-1.5 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void commit()}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent px-2 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <GitCommitHorizontal className="size-3.5" strokeWidth={1.5} /> Commit
              </button>
              <button
                type="button"
                title="Create branch"
                aria-label="Create branch"
                onClick={() => setShowBranch(s => !s)}
                className="rounded-lg border border-line p-1.5 outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <GitBranch className="size-3.5" strokeWidth={1.5} />
              </button>
            </div>
            {showBranch && (
              <div className="flex gap-1.5">
                <input
                  value={branchName}
                  onChange={e => setBranchName(e.target.value)}
                  aria-label="Branch name"
                  placeholder="feat/name"
                  onKeyDown={e => { if (e.key === 'Enter') void createBranch(); }}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-base-0 px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
                />
                <button
                  type="button"
                  onClick={() => void createBranch()}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Create
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-[11px] text-ink-faint">Not a git workspace — snapshots + per-file revert still apply.</p>
        )}
      </div>
    </div>
  );
}
