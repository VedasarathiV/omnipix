import { useState } from 'react';
import { Check, ChevronDown, GitBranch, GitCommitHorizontal, GitPullRequest, Play } from 'lucide-react';
import { CHANGES } from '../mock/data';
import { DiffViewer } from './DiffViewer';
import { useStudio } from '../state/store';

const STATUS_STYLE: Record<string, string> = {
  M: 'text-warn',
  A: 'text-ok',
  D: 'text-bad',
  U: 'text-info',
};

export function ChangesPanel() {
  const { acceptedFiles, acceptAll, pushToast } = useStudio();
  const [open, setOpen] = useState<string | null>(CHANGES[0]?.path ?? null);
  const [commitMsg, setCommitMsg] = useState('Add refresh-token rotation to session store');
  const totalAdded = CHANGES.reduce((a, c) => a + c.added, 0);
  const totalRemoved = CHANGES.reduce((a, c) => a + c.removed, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[13px] font-semibold">Changes</span>
        <span className="font-mono text-[11px]">
          <span className="text-ok">+{totalAdded}</span> <span className="text-bad">-{totalRemoved}</span>
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={acceptAll}
          className="rounded-md bg-ok px-2 py-1 text-[11px] font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
        >
          Accept all
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {CHANGES.map(change => {
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
              {isOpen && <DiffViewer path={change.path} hunks={change.hunks} />}
            </div>
          );
        })}
      </div>
      <div className="shrink-0 space-y-2 border-t border-line p-3">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => pushToast('ok', 'Tests passed: 13/14 (1 pre-existing oauth failure)')}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Play className="size-3.5" strokeWidth={1.5} /> Run tests
          </button>
          <button
            type="button"
            onClick={() => pushToast('ok', 'Build passed in 4.2s')}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Play className="size-3.5" strokeWidth={1.5} /> Build
          </button>
        </div>
        <input
          value={commitMsg}
          onChange={e => setCommitMsg(e.target.value)}
          aria-label="Commit message"
          placeholder="Commit message (AI suggested)"
          className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-1.5 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => pushToast('ok', `Committed: ${commitMsg}`)}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent px-2 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <GitCommitHorizontal className="size-3.5" strokeWidth={1.5} /> Commit
          </button>
          <button
            type="button"
            title="Create branch"
            onClick={() => pushToast('ok', 'Branch feat/rotation created')}
            className="rounded-lg border border-line p-1.5 outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <GitBranch className="size-3.5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            title="Open PR"
            onClick={() => pushToast('ok', 'PR #42 opened')}
            className="rounded-lg border border-line p-1.5 outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <GitPullRequest className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
