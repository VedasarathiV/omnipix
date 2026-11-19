import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, FileText } from 'lucide-react';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { useRunFileContent } from '../lib/queries';

/** Workspace file editor: breadcrumbs, dirty tracking, save (⌘S). */
export function FileViewer() {
  const { activeRunId, selectedFile, pushToast } = useStudio();
  const queryClient = useQueryClient();
  const { data, isLoading } = useRunFileContent(activeRunId, selectedFile);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(null);
  }, [activeRunId, selectedFile]);

  if (activeRunId === null || !selectedFile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-base-2 text-ink-dim">
          <FileText className="size-5" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium">No file open</p>
        <p className="max-w-xs text-xs leading-relaxed text-ink-dim">
          {activeRunId === null
            ? 'Start an agent run, then pick a file from its workspace tree.'
            : 'Pick a file from the workspace tree to read and edit it here.'}
        </p>
      </div>
    );
  }
  if (isLoading || !data) {
    return <p className="animate-pulse px-3 py-6 text-center text-xs text-ink-dim">Loading {selectedFile}…</p>;
  }
  if (data.binary) {
    return <p className="px-3 py-6 text-center font-mono text-xs text-ink-faint">{selectedFile} is binary.</p>;
  }

  const text = draft ?? data.content;
  const dirty = draft !== null && draft !== data.content;
  const crumbs = selectedFile.split('/');

  async function save() {
    if (!dirty || activeRunId === null || !selectedFile) return;
    setSaving(true);
    try {
      await apiFetch(`/api/agents/runs/${activeRunId}/files/content`, {
        method: 'PUT',
        body: JSON.stringify({ path: selectedFile, content: text }),
      });
      setDraft(null);
      pushToast('ok', `Saved ${selectedFile}`);
      void queryClient.invalidateQueries({ queryKey: ['run-file', activeRunId, selectedFile] });
      void queryClient.invalidateQueries({ queryKey: ['run-diff'] });
      void queryClient.invalidateQueries({ queryKey: ['run-files'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto font-mono text-[11px] text-ink-dim">
          {crumbs.map((part, i) => (
            <span key={i} className="flex shrink-0 items-center gap-1">
              {i > 0 && <span className="text-ink-faint">/</span>}
              <span className={i === crumbs.length - 1 ? 'text-ink' : ''}>{part}</span>
            </span>
          ))}
          {dirty && <span className="shrink-0 text-warn">●</span>}
        </nav>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving || data.truncated}
          title={data.truncated ? 'File exceeds the 200KB edit cap' : 'Save (⌘S)'}
          className="flex shrink-0 items-center gap-1 rounded-md bg-ok px-2 py-1 text-[11px] font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          <Check className="size-3" strokeWidth={2} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <textarea
        value={text}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            void save();
          }
        }}
        spellCheck={false}
        aria-label={selectedFile}
        className="min-h-0 flex-1 resize-none bg-base-0 p-3 font-mono text-[11px] leading-5 text-ink-dim outline-none"
      />
      {data.truncated && <p className="border-t border-line px-3 py-1 font-mono text-[10px] text-warn">Showing the first 200KB — editing disabled on truncated files.</p>}
    </div>
  );
}
