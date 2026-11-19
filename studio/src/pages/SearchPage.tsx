import { useState } from 'react';
import { FileText, MessageSquare, Search } from 'lucide-react';

const RESULTS = [
  { kind: 'chat' as const, title: 'Refresh-token rotation', snippet: '…rotate() to the session store before the row is dropped…' },
  { kind: 'chat' as const, title: 'Explain fallback chain', snippet: '…Auto moves to the next provider on rate limits…' },
  { kind: 'file' as const, title: 'src/auth/session.ts', snippet: '…return this.rotate(row) when expired…' },
  { kind: 'file' as const, title: 'src/agent/tools.ts', snippet: '…shell_exec approval policy…' },
];

export function SearchPage() {
  const [query, setQuery] = useState('rotat');
  const q = query.toLowerCase();
  const hits = RESULTS.filter(r => !q || r.title.toLowerCase().includes(q) || r.snippet.toLowerCase().includes(q));
  return (
    <div className="mx-auto max-w-3xl px-5 py-4">
      <h1 className="mb-3 text-lg font-semibold">Search</h1>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-base-1 px-3 py-2.5">
        <Search className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search chats, files, and docs…"
          aria-label="Search everything"
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-faint"
        />
      </div>
      <div className="mt-3 space-y-1.5">
        {hits.length === 0 && <p className="py-6 text-center text-xs text-ink-faint">No results for “{query}”.</p>}
        {hits.map((hit, i) => (
          <button
            key={i}
            type="button"
            className="flex w-full items-start gap-2.5 rounded-xl border border-line bg-base-1 px-3.5 py-2.5 text-left outline-none hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent"
          >
            {hit.kind === 'chat'
              ? <MessageSquare className="mt-0.5 size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
              : <FileText className="mt-0.5 size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />}
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{hit.title}</span>
              <span className="block truncate text-xs text-ink-dim">{hit.snippet}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
