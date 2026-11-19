import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Brain, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { useDocs, useMemories } from '../lib/queries';

const TABS = ['Docs', 'Memories'] as const;

export function DocsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Docs');
  return (
    <div className="mx-auto max-w-4xl px-5 py-4">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Knowledge</h1>
      </div>
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist" aria-label="Knowledge sections">
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
      {tab === 'Docs' && <DocsTab />}
      {tab === 'Memories' && <MemoriesTab />}
    </div>
  );
}

function DocsTab() {
  const { data } = useDocs();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [project, setProject] = useState('default');
  const docs = data?.docs ?? [];

  async function ingest() {
    if (!url.trim()) {
      pushToast('error', 'Paste a URL first');
      return;
    }
    try {
      const res = await apiFetch<{ doc: { chunks: number } }>('/api/memories/ingest', {
        method: 'POST',
        body: JSON.stringify({ url, project }),
      });
      setUrl('');
      pushToast('ok', `Ingested ${res.doc.chunks} chunks`);
      void queryClient.invalidateQueries({ queryKey: ['docs'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Ingest failed');
    }
  }

  async function sync() {
    try {
      const res = await apiFetch<{ synced: unknown[]; failed: unknown[]; skipped: number }>('/api/memories/docs/sync', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      pushToast('ok', `Sync: ${res.synced.length} refreshed, ${res.skipped} fresh, ${res.failed.length} failed`);
      void queryClient.invalidateQueries({ queryKey: ['docs'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Sync failed');
    }
  }

  async function remove(projectKey: string, sourceUrl: string) {
    try {
      await apiFetch(`/api/memories/docs?project=${encodeURIComponent(projectKey)}&url=${encodeURIComponent(sourceUrl)}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: ['docs'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-base-1 p-3">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://docs…"
          aria-label="URL to ingest"
          className="min-w-48 flex-[2] rounded-lg border border-line bg-base-0 px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
        />
        <input
          value={project}
          onChange={e => setProject(e.target.value)}
          placeholder="project"
          aria-label="Project key"
          className="min-w-24 flex-1 rounded-lg border border-line bg-base-0 px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button type="button" onClick={() => void ingest()} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">
          <Plus className="size-3.5" strokeWidth={1.5} /> Ingest
        </button>
        <button type="button" onClick={() => void sync()} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">
          <RefreshCw className="size-3.5" strokeWidth={1.5} /> Sync stale
        </button>
      </div>
      {docs.length === 0 && <p className="py-4 text-center text-xs text-ink-faint">No ingested docs — paste a URL above. @-mentions read from here.</p>}
      {docs.map(d => (
        <div key={`${d.project_key}:${d.source_url}`} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <FileText className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{d.title || d.source_url}</p>
            <p className="truncate font-mono text-[11px] text-ink-dim">{d.project_key} · {d.chunks} chunks · {d.updated_at}</p>
          </div>
          <button
            type="button"
            aria-label={`Delete ${d.source_url}`}
            onClick={() => void remove(d.project_key, d.source_url)}
            className="rounded-md p-1.5 text-ink-faint outline-none hover:text-bad focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Trash2 className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  );
}

function MemoriesTab() {
  const { data } = useMemories();
  const memories = data?.memories ?? [];
  if (!memories.length) {
    return <p className="py-6 text-center text-xs text-ink-faint">No memories — teach the assistant from Agents → Assistant.</p>;
  }
  return (
    <div className="space-y-2">
      {memories.map(m => (
        <div key={m.id} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <Brain className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] font-medium">{m.key}</p>
            <p className="truncate text-xs text-ink-dim">{m.value}</p>
          </div>
          <span className="shrink-0 rounded-md bg-base-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">{m.scope}</span>
        </div>
      ))}
    </div>
  );
}
