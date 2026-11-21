import { useEffect, useState } from 'react';
import { ExternalLink, FileText, Globe, MessageSquare, Search } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useConversations, useUnifiedKey } from '../lib/queries';
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

  const [scope, setScope] = useState<'library' | 'web'>('library');

  return (
    <div className="mx-auto max-w-3xl px-5 py-4">
      <h1 className="mb-3 text-lg font-semibold">Search</h1>
      <div className="mb-3 flex gap-1" role="tablist" aria-label="Search scope">
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'library'}
          onClick={() => setScope('library')}
          className={`flex-1 rounded-lg px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${scope === 'library' ? 'bg-base-2 font-medium' : 'text-ink-dim hover:text-ink'}`}
        >
          Library
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'web'}
          onClick={() => setScope('web')}
          className={`flex-1 rounded-lg px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${scope === 'web' ? 'bg-base-2 font-medium' : 'text-ink-dim hover:text-ink'}`}
        >
          Web
        </button>
      </div>
      {scope === 'web' ? <WebSearch /> : (
      <>
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
      </>
      )}
    </div>
  );
}

interface WebHit {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface WebResult {
  answer?: string;
  results: WebHit[];
  provider: string;
  engine: string;
}

/** Web search on the gateway's own engine (POST /v1/search). */
function WebSearch() {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<WebResult | null>(null);
  const [engines, setEngines] = useState<Array<{ engineId: string }> | null>(null);
  const [enabling, setEnabling] = useState(false);
  const { data: keyData } = useUnifiedKey();
  const { setRail, pushToast } = useStudio();

  useEffect(() => {
    let live = true;
    apiFetch<Array<{ engineId: string }>>('/api/search/engines')
      .then(list => { if (live) setEngines(list); })
      .catch(() => { if (live) setEngines([]); });
    return () => { live = false; };
  }, []);

  async function enableKeyless() {
    if (enabling) return;
    setEnabling(true);
    try {
      const out = await apiFetch<{ engines: string[] }>('/api/search/engines/keyless', { method: 'POST' });
      setEngines(out.engines.map(engineId => ({ engineId })));
      setError('');
      pushToast('ok', `Keyless search on — ${out.engines.length} engines ready.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Could not enable keyless search');
    } finally {
      setEnabling(false);
    }
  }

  async function search() {
    const q = query.trim();
    if (!q || busy) return;
    if (!keyData?.apiKey) {
      setError('Add a provider key first — web search bills through the unified key.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyData.apiKey}` },
        body: JSON.stringify({ query: q, max_results: 8, include_answer: answer }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = (data as { error?: { message?: string } } | null)?.error?.message ?? `Search failed (${res.status})`;
        throw new Error(message);
      }
      setResult(data as WebResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-base-1 px-3 py-2.5">
        <Globe className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void search(); }}
          placeholder="Search the web… (Enter)"
          aria-label="Search the web"
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-faint"
        />
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-dim">
          <input type="checkbox" checked={answer} onChange={e => setAnswer(e.target.checked)} className="accent-[var(--accent)]" /> AI answer
        </label>
        <button
          type="button"
          onClick={() => void search()}
          disabled={busy}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      {error && (
        <div className="mt-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <p className="text-[13px] text-bad">{error}</p>
          <button
            type="button"
            onClick={() => setRail('keys')}
            className="mt-1.5 text-xs text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
          >
            Open provider keys
          </button>
        </div>
      )}
      {result?.answer && (
        <div className="mt-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <p className="mb-1 text-[11px] font-semibold tracking-wider text-ink-faint uppercase">Answer</p>
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{result.answer}</p>
        </div>
      )}
      <div className="mt-3 space-y-1.5">
        {(result?.results ?? []).map((hit, i) => (
          <a
            key={`${hit.url}:${i}`}
            href={hit.url}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-start gap-2.5 rounded-xl border border-line bg-base-1 px-3.5 py-2.5 text-left outline-none hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ExternalLink className="mt-0.5 size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{hit.title || hit.url}</span>
              <span className="block truncate font-mono text-[11px] text-accent">{hit.url}</span>
              {hit.content && <span className="mt-0.5 line-clamp-2 block text-xs text-ink-dim">{hit.content.slice(0, 300)}</span>}
            </span>
          </a>
        ))}
      </div>
      {result && (
        <p className="mt-2 px-1 font-mono text-[11px] text-ink-faint">
          {result.results.length} result{result.results.length === 1 ? '' : 's'} · {result.provider} · {result.engine}
        </p>
      )}
      {engines && engines.length === 0 && !result && (
        <div className="mt-3 rounded-xl border border-line bg-base-1 px-4 py-3 text-center">
          <p className="text-[13px]">No search engine installed yet.</p>
          <button
            type="button"
            onClick={() => void enableKeyless()}
            disabled={enabling}
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            {enabling ? 'Enabling…' : 'Enable keyless search'}
          </button>
          <p className="mt-1.5 text-[11px] text-ink-faint">Free anonymous engines — no API key needed. Or add keys under Providers.</p>
        </div>
      )}
      {engines && engines.length > 0 && !result && !error && (
        <p className="py-4 text-center text-xs text-ink-faint">Runs on the gateway search chain — manage engines under Models → Search.</p>
      )}
    </div>
  );
}
