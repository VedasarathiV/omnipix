import { useState } from 'react';
import { FileText, MessageSquare, Search } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useConversations } from '../lib/queries';
import { useStudio } from '../state/store';

interface RunHit {
  id: number;
  goal: string;
  status: string;
}

interface FileHit {
  path: string;
  line: number;
  text: string;
}

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [runHits, setRunHits] = useState<RunHit[] | null>(null);
  const [fileHits, setFileHits] = useState<FileHit[] | null>(null);
  const { data: conversations = [] } = useConversations();
  const { setConversationId, setActiveRunId, setRail, pushToast, activeRunId, setSelectedFile, setRightTab, setRightOpen } = useStudio();

  const q = query.toLowerCase().trim();
  const chatHits = q
    ? conversations.filter(c => (c.title || '').toLowerCase().includes(q)).slice(0, 10)
    : [];

  async function searchRuns() {
    if (!q) {
      setRunHits(null);
      setFileHits(null);
      return;
    }
    try {
      const res = await apiFetch<{ runs: RunHit[] }>(`/api/agents/runs/search?q=${encodeURIComponent(q)}&limit=10`);
      setRunHits(res.runs);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Search failed');
    }
    if (activeRunId !== null) {
      try {
        const res = await apiFetch<{ hits: FileHit[] }>(`/api/agents/runs/${activeRunId}/search?q=${encodeURIComponent(q)}`);
        setFileHits(res.hits);
      } catch {
        setFileHits([]);
      }
    } else {
      setFileHits(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-4">
      <h1 className="mb-3 text-lg font-semibold">Search</h1>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-base-1 px-3 py-2.5">
        <Search className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void searchRuns(); }}
          placeholder="Search chats and agent runs… (Enter)"
          aria-label="Search everything"
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-faint"
        />
      </div>
      <div className="mt-3 space-y-1.5">
        {!q && <p className="py-4 text-center text-xs text-ink-faint">Chat titles filter as you type; Enter searches run transcripts.</p>}
        {chatHits.map(hit => (
          <button
            key={`c${hit.id}`}
            type="button"
            onClick={() => { setConversationId(hit.id); setActiveRunId(null); setRail('chat'); }}
            className="flex w-full items-start gap-2.5 rounded-xl border border-line bg-base-1 px-3.5 py-2.5 text-left outline-none hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <MessageSquare className="mt-0.5 size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{hit.title || 'Untitled chat'}</span>
              <span className="block text-xs text-ink-dim">{hit.messageCount} messages</span>
            </span>
          </button>
        ))}
        {(runHits ?? []).map(hit => (
          <button
            key={`r${hit.id}`}
            type="button"
            onClick={() => { setConversationId(null); setActiveRunId(hit.id); setRail('chat'); }}
            className="flex w-full items-start gap-2.5 rounded-xl border border-line bg-base-1 px-3.5 py-2.5 text-left outline-none hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <FileText className="mt-0.5 size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">Run #{hit.id}: {hit.goal}</span>
              <span className="block font-mono text-[11px] text-ink-dim">{hit.status}</span>
            </span>
          </button>
        ))}
        {fileHits !== null && fileHits.length > 0 && (
          <p className="px-1 pt-2 text-[11px] font-medium text-ink-faint">Workspace files</p>
        )}
        {(fileHits ?? []).map((hit, i) => (
          <button
            key={`${hit.path}:${hit.line}:${i}`}
            type="button"
            onClick={() => { setSelectedFile(hit.path); setRightTab('files'); setRightOpen(true); setRail('chat'); }}
            className="flex w-full items-start gap-2.5 rounded-xl border border-line bg-base-1 px-3.5 py-2.5 text-left outline-none hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <FileText className="mt-0.5 size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
            <span className="min-w-0">
              <span className="block truncate font-mono text-[13px] font-medium">{hit.path}:{hit.line}</span>
              <span className="block truncate font-mono text-[11px] text-ink-dim">{hit.text.trim()}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
