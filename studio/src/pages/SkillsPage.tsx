import { useState } from 'react';
import { Blocks, Plug, Search, Store, Webhook } from 'lucide-react';
import { useStudio } from '../state/store';

const TABS = ['Skills', 'MCP servers', 'Registry', 'Webhooks'] as const;

const SKILLS = [
  { name: 'code-reviewer', desc: 'Reviews code like a mentor: correctness, security, performance.', on: true },
  { name: 'database-optimizer', desc: 'Keeps databases fast: plans, indexes, pools.', on: true },
  { name: 'incident-responder', desc: 'Leads breach response: triage, contain, evidence.', on: true },
  { name: 'agency-penetration-tester', desc: 'Authorized offensive testing with evidence.', on: false },
  { name: 'prompt-engineer', desc: 'Turns vague instructions into tested prompts.', on: true },
];

const SERVERS = [
  { name: 'local-fs', transport: 'stdio', tools: 14, on: true, error: '' },
  { name: 'github-remote', transport: 'http', tools: 8, on: true, error: '' },
  { name: 'legacy-docs', transport: 'stdio', tools: 0, on: false, error: 'spawn ENOENT' },
];

const REGISTRY = [
  { name: 'io.github.acme/notes', desc: 'Notes server with search.', transports: 'stdio' },
  { name: 'com.pulsemcp/remote-filesystem', desc: 'Hosted filesystem access.', transports: 'streamable-http' },
  { name: 'io.github.acme/py', desc: 'Python REPL tools.', transports: 'stdio' },
];

const HOOKS = [
  { name: 'deploy-notify', url: 'https://hooks.acme.test/omnipix', events: 'run.finished', status: 200 },
  { name: 'pagerduty-bridge', url: 'https://events.pd.test/x', events: '*', status: null },
];

export function SkillsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Skills');
  const { pushToast } = useStudio();
  return (
    <div className="mx-auto max-w-5xl px-5 py-4">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Integrations</h1>
        <span className="font-mono text-xs text-ink-dim">317 skills active</span>
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

      {tab === 'Skills' && (
        <div className="space-y-2">
          {SKILLS.map(s => (
            <SkillRow key={s.name} name={s.name} desc={s.desc} on={s.on} />
          ))}
          <p className="text-xs text-ink-dim">Showing 5 of 317 — the agent auto-selects by task.</p>
        </div>
      )}

      {tab === 'MCP servers' && (
        <div className="space-y-2">
          {SERVERS.map(s => (
            <div key={s.name} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
              <Plug className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13px] font-medium">{s.name}</p>
                <p className="font-mono text-[11px] text-ink-dim">{s.transport} · {s.tools} tools{s.error ? ` · ${s.error}` : ''}</p>
              </div>
              <button type="button" onClick={() => pushToast('ok', `${s.name}: 14 tools reachable`)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Test</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'Registry' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-line bg-base-1 px-2.5 py-2">
            <Search className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />
            <input placeholder="Search the MCP registry…" aria-label="Search registry" className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-faint" />
          </div>
          {REGISTRY.map(r => (
            <div key={r.name} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
              <Store className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px] font-medium">{r.name}</p>
                <p className="truncate text-xs text-ink-dim">{r.desc} · {r.transports}</p>
              </div>
              <button type="button" onClick={() => pushToast('ok', `Installed ${r.name}`)} className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Install</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'Webhooks' && (
        <div className="space-y-2">
          {HOOKS.map(h => (
            <div key={h.name} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
              <Webhook className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13px] font-medium">{h.name}</p>
                <p className="truncate font-mono text-[11px] text-ink-dim">{h.url} · {h.events}</p>
              </div>
              <span className={`font-mono text-[11px] ${h.status === 200 ? 'text-ok' : 'text-ink-faint'}`}>{h.status ?? '—'}</span>
              <button type="button" onClick={() => pushToast('ok', `Test delivery sent to ${h.name}`)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Send test</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillRow({ name, desc, on }: { name: string; desc: string; on: boolean }) {
  const { pushToast } = useStudio();
  const [enabled, setEnabled] = useState(on);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
      <Blocks className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[13px] font-medium">{name}</p>
        <p className="truncate text-xs text-ink-dim">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={name}
        onClick={() => { setEnabled(!enabled); pushToast('ok', `${name} ${enabled ? 'disabled' : 'enabled'}`); }}
        className={`relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${enabled ? 'bg-accent' : 'bg-base-2'}`}
      >
        <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}
