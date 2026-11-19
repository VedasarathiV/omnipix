import { useState } from 'react';
import { Check, Columns2, Rows3, Undo2 } from 'lucide-react';
import type { DiffHunk, DiffLine } from '../types';
import { useStudio } from '../state/store';

export function DiffViewer({ path, hunks }: { path: string; hunks: DiffHunk[] }) {
  const [split, setSplit] = useState(true);
  const { acceptFile, acceptedFiles, pushToast } = useStudio();
  const accepted = acceptedFiles.has(path);

  if (!hunks.length) {
    return <p className="px-3 py-4 text-center text-xs text-ink-faint">Binary file or full-file change — no hunks to show.</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate px-1 font-mono text-[11px] text-ink-dim">{path}</span>
        <ViewBtn label="Split view" active={split} onClick={() => setSplit(true)}><Columns2 className="size-3.5" strokeWidth={1.5} /></ViewBtn>
        <ViewBtn label="Unified view" active={!split} onClick={() => setSplit(false)}><Rows3 className="size-3.5" strokeWidth={1.5} /></ViewBtn>
        {accepted ? (
          <button
            type="button"
            onClick={() => acceptFile(path, false)}
            title="Revert file"
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ok outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Check className="size-3.5" strokeWidth={1.5} /> Accepted
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => acceptFile(path, true)}
              className="rounded-md bg-ok px-2 py-1 text-[11px] font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
            >
              Accept
            </button>
            <button
              type="button"
              title="Revert file"
              onClick={() => pushToast('error', `Reverted ${path}`)}
              className="rounded-md p-1 text-ink-dim outline-none hover:bg-base-2 hover:text-bad focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Undo2 className="size-3.5" strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>
      {hunks.map(hunk => (
        <HunkView key={hunk.id} path={path} hunk={hunk} split={split} />
      ))}
    </div>
  );
}

function ViewBtn({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-accent ${active ? 'bg-base-2 text-ink' : 'text-ink-faint hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

function HunkView({ path, hunk, split }: { path: string; hunk: DiffHunk; split: boolean }) {
  const { pushToast } = useStudio();
  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-2 bg-base-0 px-3 py-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-faint">{hunk.header}</span>
        <button
          type="button"
          title="Accept hunk"
          onClick={() => pushToast('ok', `Hunk accepted in ${path}`)}
          className="rounded p-0.5 text-ink-faint outline-none hover:text-ok focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Check className="size-3" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          title="Revert hunk"
          onClick={() => pushToast('error', `Hunk reverted in ${path}`)}
          className="rounded p-0.5 text-ink-faint outline-none hover:text-bad focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Undo2 className="size-3" strokeWidth={1.5} />
        </button>
      </div>
      {split ? <SplitLines lines={hunk.lines} /> : <UnifiedLines lines={hunk.lines} />}
    </div>
  );
}

function SplitLines({ lines }: { lines: DiffLine[] }) {
  const left = lines.filter(l => l.kind !== 'add');
  const right = lines.filter(l => l.kind !== 'del');
  const rows = Math.max(left.length, right.length);
  return (
    <div className="grid grid-cols-2 overflow-x-auto font-mono text-[11px] leading-5">
      <div className="min-w-36 border-r border-line">
        {Array.from({ length: rows }).map((_, i) => {
          const line = left[i];
          if (!line) return <div key={i} className="px-2">&nbsp;</div>;
          return (
            <div key={i} className={`flex gap-2 px-2 ${line.kind === 'del' ? 'bg-bad/15' : ''}`}>
              <span className="w-6 shrink-0 text-right text-ink-faint select-none">{line.oldNo ?? ''}</span>
              <span className="whitespace-pre">{line.text || ' '}</span>
            </div>
          );
        })}
      </div>
      <div className="min-w-36">
        {Array.from({ length: rows }).map((_, i) => {
          const line = right[i];
          if (!line) return <div key={i} className="px-2">&nbsp;</div>;
          return (
            <div key={i} className={`flex gap-2 px-2 ${line.kind === 'add' ? 'bg-ok/15' : ''}`}>
              <span className="w-6 shrink-0 text-right text-ink-faint select-none">{line.newNo ?? ''}</span>
              <span className="whitespace-pre">{line.text || ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UnifiedLines({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="overflow-x-auto font-mono text-[11px] leading-5">
      {lines.map((line, i) => (
        <div
          key={i}
          className={`flex gap-2 px-2 ${line.kind === 'add' ? 'bg-ok/15' : line.kind === 'del' ? 'bg-bad/15' : ''}`}
        >
          <span className="w-6 shrink-0 text-right text-ink-faint select-none">{line.oldNo ?? ''}</span>
          <span className="w-6 shrink-0 text-right text-ink-faint select-none">{line.newNo ?? ''}</span>
          <span className={`w-3 shrink-0 select-none ${line.kind === 'add' ? 'text-ok' : line.kind === 'del' ? 'text-bad' : 'text-ink-faint'}`}>
            {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
          </span>
          <span className="whitespace-pre">{line.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}
