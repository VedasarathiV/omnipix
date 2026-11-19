import { useState } from 'react';
import { Brain, FileText, Plus, RefreshCw } from 'lucide-react';
import { useStudio } from '../state/store';

const TABS = ['Docs', 'Memories'] as const;

const DOCS = [
  { url: 'https://docs.stripe.test/api', title: 'Stripe API', chunks: 42, updated: '2h ago' },
  { url: 'https://react.dev/reference', title: 'React reference', chunks: 128, updated: '3d ago' },
];

const MEMORIES = [
  { key: 'theme', value: 'User prefers dark mode, green accent', scope: 'user' },
  { key: 'stack', value: 'acme-api runs on Node 22 + Postgres', scope: 'project: acme-api' },
];

export function DocsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Docs');
  const { pushToast } = useStudio();
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
      {tab === 'Docs' && (
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <button type="button" onClick={() => pushToast('ok', 'Doc ingested: 12 chunks')} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">
              <Plus className="size-3.5" strokeWidth={1.5} /> Ingest URL
            </button>
            <button type="button" onClick={() => pushToast('ok', 'Docs synced: 1 refreshed, 1 fresh')} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-1 focus-visible:ring-2 focus-visible:ring-accent">
              <RefreshCw className="size-3.5" strokeWidth={1.5} /> Sync stale
            </button>
          </div>
          {DOCS.map(d => (
            <div key={d.url} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
              <FileText className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{d.title}</p>
                <p className="truncate font-mono text-[11px] text-ink-dim">{d.url} · {d.chunks} chunks · {d.updated}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'Memories' && (
        <div className="space-y-2">
          {MEMORIES.map(m => (
            <div key={m.key} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
              <Brain className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13px] font-medium">{m.key}</p>
                <p className="truncate text-xs text-ink-dim">{m.value}</p>
              </div>
              <span className="shrink-0 rounded-md bg-base-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">{m.scope}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
