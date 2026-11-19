import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Blocks, Plug, Search, Store, Webhook } from 'lucide-react';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { useMcpServers, useSkills, useWebhooks } from '../lib/queries';

const TABS = ['Skills', 'MCP servers', 'Registry', 'Webhooks'] as const;

export function SkillsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Skills');
  const { data: skillsData } = useSkills();
  const active = (skillsData?.skills ?? []).filter(s => s.enabled).length;
  const total = (skillsData?.skills ?? []).length;
  return (
    <div className="mx-auto max-w-5xl px-5 py-4">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Integrations</h1>
        <span className="font-mono text-xs text-ink-dim">{active}/{total} skills active</span>
      </div>
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist" aria-label="Integrations sections">
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
      {tab === 'Skills' && <SkillsTab />}
      {tab === 'MCP servers' && <McpTab />}
      {tab === 'Registry' && <RegistryTab />}
      {tab === 'Webhooks' && <WebhooksTab />}
    </div>
  );
}

function SkillsTab() {
  const { data } = useSkills();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const skills = (data?.skills ?? []).filter(s =>
    !query || s.name.toLowerCase().includes(query.toLowerCase()) || s.description.toLowerCase().includes(query.toLowerCase()),
  );

  async function toggle(name: string, enabled: boolean) {
    try {
      await apiFetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !enabled }) });
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Toggle failed');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-base-1 px-2.5 py-2">
        <Search className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${data?.skills.length ?? 0} skills…`}
          aria-label="Search skills"
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
        />
      </div>
      {skills.slice(0, 100).map(s => (
        <div key={s.name} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <Blocks className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] font-medium">{s.name}{s.builtin && <span className="ml-1.5 rounded bg-base-2 px-1 py-0.5 text-[10px] text-ink-dim">built-in</span>}</p>
            <p className="truncate text-xs text-ink-dim">{s.description}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={s.enabled}
            aria-label={s.name}
            onClick={() => void toggle(s.name, s.enabled)}
            className={`relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${s.enabled ? 'bg-accent' : 'bg-base-2'}`}
          >
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${s.enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
      ))}
      <p className="text-xs text-ink-dim">Showing {Math.min(100, skills.length)} of {skills.length} — the agent auto-selects by task.</p>
    </div>
  );
}

function McpTab() {
  const { data } = useMcpServers();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const servers = data?.servers ?? [];
  if (!servers.length) {
    return <p className="py-6 text-center text-xs text-ink-faint">No MCP servers — install one from the Registry tab.</p>;
  }
  async function test(id: number, name: string) {
    try {
      const res = await apiFetch<{ tools?: unknown[] }>(`/api/mcp/servers/${id}/test`, { method: 'POST' });
      pushToast('ok', `${name}: ${(res.tools ?? []).length} tools reachable`);
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Test failed');
    }
  }
  return (
    <div className="space-y-2">
      {servers.map(s => (
        <div key={s.id} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <Plug className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] font-medium">{s.name}</p>
            <p className="font-mono text-[11px] text-ink-dim">{s.transport} · {s.tool_count ?? '?'} tools{s.last_error ? ` · ${s.last_error}` : s.enabled ? '' : ' · disabled'}</p>
          </div>
          <button type="button" onClick={() => void test(s.id, s.name)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Test</button>
        </div>
      ))}
    </div>
  );
}

interface RegistryEntry {
  name: string;
  title: string;
  description: string;
  version: string;
  isLatest: boolean;
  transports: string[];
}

function RegistryTab() {
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RegistryEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true);
    try {
      const res = await apiFetch<{ servers: RegistryEntry[] }>('/api/mcp/registry' + (query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''));
      setResults(res.servers);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Registry search failed');
    } finally {
      setBusy(false);
    }
  }

  async function install(name: string) {
    try {
      await apiFetch('/api/mcp/install', { method: 'POST', body: JSON.stringify({ name }) });
      pushToast('ok', `Installed ${name}`);
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Install failed');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-base-1 px-2.5 py-2">
        <Search className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void search(); }}
          placeholder="Search the MCP registry… (Enter)"
          aria-label="Search registry"
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
        />
        {busy && <span className="animate-pulse text-xs text-ink-faint">…</span>}
      </div>
      {results === null && <p className="py-4 text-center text-xs text-ink-faint">Search the official registry, then one-click install.</p>}
      {(results ?? []).map(r => (
        <div key={r.name} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <Store className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[13px] font-medium">{r.name}</p>
            <p className="truncate text-xs text-ink-dim">{r.description} · {r.transports.join(', ')}</p>
          </div>
          <button type="button" onClick={() => void install(r.name)} className="shrink-0 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Install</button>
        </div>
      ))}
    </div>
  );
}

function WebhooksTab() {
  const { data } = useWebhooks();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const hooks = data?.webhooks ?? [];
  if (!hooks.length) {
    return <p className="py-6 text-center text-xs text-ink-faint">No webhooks — register one to get signed POSTs on run, approval, and eval events.</p>;
  }
  async function fire(id: number, name: string) {
    try {
      await apiFetch(`/api/webhooks/${id}/test`, { method: 'POST' });
      pushToast('ok', `Test delivery sent to ${name}`);
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Test failed');
    }
  }
  return (
    <div className="space-y-2">
      {hooks.map(h => (
        <div key={h.id} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <Webhook className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] font-medium">{h.name}</p>
            <p className="truncate font-mono text-[11px] text-ink-dim">{h.url} · {h.events.join(', ') || 'all'}</p>
          </div>
          <span className={`shrink-0 font-mono text-[11px] ${h.last_status === 200 ? 'text-ok' : h.last_status ? 'text-bad' : 'text-ink-faint'}`}>
            {h.last_status ?? (h.last_error ? 'err' : '—')}
          </span>
          <button type="button" onClick={() => void fire(h.id, h.name)} className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Send test</button>
        </div>
      ))}
    </div>
  );
}
