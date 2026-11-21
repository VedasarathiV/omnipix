import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Blocks, Plug, Search, Store, Webhook } from 'lucide-react';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { useAgentPresets, useCommands, useMcpServers, useSkills, useWebhooks } from '../lib/queries';

const TABS = ['Skills', 'Commands', 'Presets', 'MCP servers', 'Registry', 'Webhooks'] as const;

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
      {tab === 'Commands' && <CommandsTab />}
      {tab === 'Presets' && <PresetsTab />}
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
  const [urlMode, setUrlMode] = useState(false);
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', instructions: '', bundle: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ description: '', instructions: '', bundle: '' });
  const skills = (data?.skills ?? []).filter(s =>
    !query || s.name.toLowerCase().includes(query.toLowerCase()) || s.description.toLowerCase().includes(query.toLowerCase()),
  );

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['skills'] });
  }

  async function toggle(name: string, enabled: boolean) {
    try {
      await apiFetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !enabled }) });
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Toggle failed');
    }
  }

  async function installFile(file: File) {
    try {
      const content = await file.text();
      const res = await apiFetch<{ skill: { name: string } }>('/api/skills/import', { method: 'POST', body: JSON.stringify({ content }) });
      pushToast('ok', `Installed ${res.skill.name}`);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Install failed');
    }
  }

  async function installUrl() {
    if (!url.trim()) return;
    try {
      const res = await apiFetch<{ skill: { name: string } }>('/api/skills/import-url', { method: 'POST', body: JSON.stringify({ url: url.trim() }) });
      pushToast('ok', `Installed ${res.skill.name}`);
      setUrl('');
      setUrlMode(false);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Install failed');
    }
  }

  async function create() {
    const bundle = form.bundle.split(',').map(s => s.trim()).filter(Boolean);
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          instructions: form.instructions.trim(),
          ...(bundle.length ? { bundle } : {}),
        }),
      });
      pushToast('ok', `Created ${form.name.trim()}`);
      setForm({ name: '', description: '', instructions: '', bundle: '' });
      setCreating(false);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function remove(name: string) {
    try {
      await apiFetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
      pushToast('ok', `Deleted ${name}`);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function saveEdit(name: string) {
    const bundle = edit.bundle.split(',').map(s => s.trim()).filter(Boolean);
    try {
      await apiFetch(`/api/skills/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: edit.description.trim(), instructions: edit.instructions.trim(), bundle }),
      });
      pushToast('ok', `Saved ${name}`);
      setEditing(null);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function download(name: string) {
    try {
      const res = await apiFetch<{ content: string }>(`/api/skills/${encodeURIComponent(name)}/export`);
      const blob = new Blob([res.content], { type: 'text/markdown' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${name}.md`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Export failed');
    }
  }

  function startEdit(name: string, description: string) {
    // Instructions live server-side; start from empty and require full text
    // so a save never blanks them from a stale row.
    setEdit({ description, instructions: '', bundle: '' });
    setEditing(name);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-line bg-base-1 px-2.5 py-2">
          <Search className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${data?.skills.length ?? 0} skills…`}
            aria-label="Search skills"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
          />
        </div>
        <label className="shrink-0 cursor-pointer rounded-lg border border-line px-2.5 py-2 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">
          Install file
          <input
            type="file"
            accept=".md,.txt"
            aria-label="Install skill from file"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void installFile(file);
            }}
          />
        </label>
        <button type="button" onClick={() => setUrlMode(m => !m)} className="shrink-0 rounded-lg border border-line px-2.5 py-2 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">From URL</button>
        <button type="button" onClick={() => setCreating(c => !c)} className="shrink-0 rounded-lg bg-accent px-2.5 py-2 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">New skill</button>
      </div>
      {urlMode && (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-base-1 px-3 py-2.5">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void installUrl(); }}
            placeholder="https://…/SKILL.md"
            aria-label="Skill file URL"
            className="w-full bg-transparent font-mono text-xs outline-none placeholder:text-ink-faint"
          />
          <button type="button" onClick={() => void installUrl()} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Install</button>
        </div>
      )}
      {creating && (
        <div className="space-y-2 rounded-xl border border-line bg-base-1 p-4">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="name (lowercase-dashes)" aria-label="Skill name" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="One-line description" aria-label="Skill description" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <textarea value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} placeholder="Instructions…" rows={4} aria-label="Skill instructions" className="w-full rounded-lg border border-line bg-base-0 p-2.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <input value={form.bundle} onChange={e => setForm({ ...form, bundle: e.target.value })} placeholder="Bundle members, comma-separated (optional)" aria-label="Skill bundle" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <div className="flex gap-2">
            <button type="button" onClick={() => void create()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Create skill</button>
            <button type="button" onClick={() => setCreating(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Cancel</button>
          </div>
        </div>
      )}
      {skills.slice(0, 100).map(s => (
        <div key={s.name}>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-base-1 px-4 py-3">
            <Blocks className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[13px] font-medium">{s.name}{s.builtin && <span className="ml-1.5 rounded bg-base-2 px-1 py-0.5 text-[10px] text-ink-dim">built-in</span>}</p>
              <p className="truncate text-xs text-ink-dim">{s.description}</p>
            </div>
            <button type="button" title="Download .md" aria-label={`Export ${s.name}`} onClick={() => void download(s.name)} className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent">Export</button>
            <button type="button" title="Edit skill" aria-label={`Edit ${s.name}`} onClick={() => (editing === s.name ? setEditing(null) : startEdit(s.name, s.description))} className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent">Edit</button>
            {!s.builtin && (
              <button type="button" title="Delete skill" aria-label={`Delete ${s.name}`} onClick={() => void remove(s.name)} className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-dim outline-none hover:bg-base-2 hover:text-bad focus-visible:ring-2 focus-visible:ring-accent">Delete</button>
            )}
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
          {editing === s.name && (
            <div className="mt-1 ml-8 space-y-2 rounded-xl border border-line bg-base-1 p-3">
              <input value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} placeholder="Description" aria-label={`Edit description for ${s.name}`} className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
              <textarea value={edit.instructions} onChange={e => setEdit({ ...edit, instructions: e.target.value })} placeholder="Full instructions (required — retype or paste; blank never saves)" rows={4} aria-label={`Edit instructions for ${s.name}`} className="w-full rounded-lg border border-line bg-base-0 p-2.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
              <input value={edit.bundle} onChange={e => setEdit({ ...edit, bundle: e.target.value })} placeholder="Bundle members, comma-separated (empty clears)" aria-label={`Edit bundle for ${s.name}`} className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
              <div className="flex gap-2">
                <button type="button" onClick={() => void saveEdit(s.name)} disabled={!edit.instructions.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40">Save</button>
                <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
      <p className="text-xs text-ink-dim">Showing {Math.min(100, skills.length)} of {skills.length} — the agent auto-selects by task.</p>
    </div>
  );
}

function CommandsTab() {
  const { data } = useCommands();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', template: '', agent: '', model: '' });
  const commands = data?.commands ?? [];

  async function create() {
    try {
      await apiFetch('/api/commands', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          template: form.template.trim(),
          ...(form.agent.trim() ? { agent: form.agent.trim() } : {}),
          ...(form.model.trim() ? { model: form.model.trim() } : {}),
        }),
      });
      pushToast('ok', `Created /${form.name.trim()}`);
      setForm({ name: '', description: '', template: '', agent: '', model: '' });
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ['commands'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => setCreating(c => !c)} className="rounded-lg bg-accent px-2.5 py-2 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">New command</button>
      </div>
      {creating && (
        <div className="space-y-2 rounded-xl border border-line bg-base-1 p-4">
          <div className="flex gap-2">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="name or nested/path" aria-label="Command name" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
            <input value={form.agent} onChange={e => setForm({ ...form, agent: e.target.value })} placeholder="agent preset (optional)" aria-label="Command agent" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          </div>
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="One-line description" aria-label="Command description" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <textarea value={form.template} onChange={e => setForm({ ...form, template: e.target.value })} placeholder="Template with $1..$N or $ARGUMENTS" rows={4} aria-label="Command template" className="w-full rounded-lg border border-line bg-base-0 p-2.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="model override (optional)" aria-label="Command model" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <div className="flex gap-2">
            <button type="button" onClick={() => void create()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Create command</button>
            <button type="button" onClick={() => setCreating(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Cancel</button>
          </div>
        </div>
      )}
      {!commands.length && <p className="py-6 text-center text-xs text-ink-faint">No file commands — create one above or drop .md files in a commands/ folder.</p>}
      {commands.map(c => (
        <div key={c.name} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] font-medium">/{c.name}</p>
            <p className="truncate text-xs text-ink-dim">{c.description}{c.agent ? ` · ${c.agent}` : ''}</p>
          </div>
        </div>
      ))}
      <p className="text-xs text-ink-dim">Files live beside your skills dirs; edit or delete them on disk.</p>
    </div>
  );
}

function PresetsTab() {
  const { data } = useAgentPresets();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', skills: '', tools: '', model: '', notes: '' });
  const presets = data?.presets ?? [];

  async function create() {
    const skills = form.skills.split(',').map(s => s.trim()).filter(Boolean);
    const tools = form.tools.split(',').map(s => s.trim()).filter(Boolean);
    try {
      await apiFetch('/api/agents/presets', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          ...(skills.length ? { skills } : {}),
          ...(tools.length ? { tools } : {}),
          ...(form.model.trim() ? { model: form.model.trim() } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        }),
      });
      pushToast('ok', `Created preset ${form.name.trim()}`);
      setForm({ name: '', description: '', skills: '', tools: '', model: '', notes: '' });
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ['agent-presets'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => setCreating(c => !c)} className="rounded-lg bg-accent px-2.5 py-2 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">New preset</button>
      </div>
      {creating && (
        <div className="space-y-2 rounded-xl border border-line bg-base-1 p-4">
          <div className="flex gap-2">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="name" aria-label="Preset name" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
            <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="model (optional)" aria-label="Preset model" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          </div>
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="One-line description" aria-label="Preset description" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <input value={form.skills} onChange={e => setForm({ ...form, skills: e.target.value })} placeholder="skills, comma-separated (optional)" aria-label="Preset skills" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <input value={form.tools} onChange={e => setForm({ ...form, tools: e.target.value })} placeholder="tools, comma-separated (optional)" aria-label="Preset tools" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notes (optional)" rows={2} aria-label="Preset notes" className="w-full rounded-lg border border-line bg-base-0 p-2.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <div className="flex gap-2">
            <button type="button" onClick={() => void create()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Create preset</button>
            <button type="button" onClick={() => setCreating(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Cancel</button>
          </div>
        </div>
      )}
      {!presets.length && <p className="py-6 text-center text-xs text-ink-faint">No agent presets — create one above or drop .md files in an agents/ folder.</p>}
      {presets.map(p => (
        <div key={p.name} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] font-medium">{p.name}</p>
            <p className="truncate text-xs text-ink-dim">{p.description}</p>
            <p className="truncate font-mono text-[11px] text-ink-faint">
              {[...(p.skills ?? []).map(s => `/${s}`), ...(p.tools ?? [])].join(' · ') || 'no overrides'}{p.model ? ` · ${p.model}` : ''}{p.planMode ? ' · plan' : ''}
            </p>
          </div>
        </div>
      ))}
      <p className="text-xs text-ink-dim">Files live beside your skills dirs; edit or delete them on disk. Use presets from AgentEditor or <span className="font-mono">agent run --agent</span>.</p>
    </div>
  );
}

function parseEnvLines(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function McpTab() {
  const { data } = useMcpServers();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', transport: 'stdio', command: '', args: '', url: '', env: '' });
  const servers = data?.servers ?? [];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
  }

  async function test(id: number, name: string) {
    try {
      const res = await apiFetch<{ tools?: unknown[] }>(`/api/mcp/servers/${id}/test`, { method: 'POST' });
      pushToast('ok', `${name}: ${(res.tools ?? []).length} tools reachable`);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Test failed');
    }
  }

  async function flip(id: number, name: string, enabled: boolean) {
    try {
      await apiFetch(`/api/mcp/servers/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !enabled }) });
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : `Toggle failed for ${name}`);
    }
  }

  async function remove(id: number, name: string) {
    try {
      await apiFetch(`/api/mcp/servers/${id}`, { method: 'DELETE' });
      pushToast('ok', `Deleted ${name}`);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function add() {
    const args = form.args.split(/\s+/).map(s => s.trim()).filter(Boolean);
    try {
      await apiFetch('/api/mcp/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          transport: form.transport,
          ...(form.transport === 'stdio'
            ? { command: form.command.trim(), ...(args.length ? { args } : {}) }
            : { url: form.url.trim() }),
          ...(() => {
            const env = parseEnvLines(form.env);
            return Object.keys(env).length ? { env } : {};
          })(),
        }),
      });
      pushToast('ok', `Added ${form.name.trim()}`);
      setForm({ name: '', transport: 'stdio', command: '', args: '', url: '', env: '' });
      setAdding(false);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Add failed');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => setAdding(a => !a)} className="rounded-lg bg-accent px-2.5 py-2 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Add server</button>
      </div>
      {adding && (
        <div className="space-y-2 rounded-xl border border-line bg-base-1 p-4">
          <div className="flex gap-2">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="name" aria-label="Server name" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
            <select value={form.transport} onChange={e => setForm({ ...form, transport: e.target.value })} aria-label="Transport" className="rounded-lg border border-line bg-base-1 px-2 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
          </div>
          {form.transport === 'stdio' ? (
            <>
              <input value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} placeholder="command (npx, node, python3…)" aria-label="Server command" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
              <input value={form.args} onChange={e => setForm({ ...form, args: e.target.value })} placeholder="args, space-separated (optional)" aria-label="Server args" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
            </>
          ) : (
            <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://… server URL" aria-label="Server URL" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          )}
          <textarea value={form.env} onChange={e => setForm({ ...form, env: e.target.value })} placeholder="Env, one KEY=value per line (optional)" rows={2} aria-label="Server env" className="w-full rounded-lg border border-line bg-base-0 p-2.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <div className="flex gap-2">
            <button type="button" onClick={() => void add()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Add server</button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Cancel</button>
          </div>
        </div>
      )}
      {!servers.length && <p className="py-6 text-center text-xs text-ink-faint">No MCP servers — add one above or install from the Registry tab.</p>}
      {servers.map(s => (
        <div key={s.id} className="flex items-center gap-2 rounded-xl border border-line bg-base-1 px-4 py-3">
          <Plug className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] font-medium">{s.name}</p>
            <p className="font-mono text-[11px] text-ink-dim">{s.transport} · {s.tool_count ?? '?'} tools{s.last_error ? ` · ${s.last_error}` : s.enabled ? '' : ' · disabled'}</p>
          </div>
          <button type="button" onClick={() => void test(s.id, s.name)} className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Test</button>
          <button
            type="button"
            role="switch"
            aria-checked={!!s.enabled}
            aria-label={`Enable ${s.name}`}
            onClick={() => void flip(s.id, s.name, !!s.enabled)}
            className={`relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${s.enabled ? 'bg-accent' : 'bg-base-2'}`}
          >
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${s.enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
          <button type="button" title="Delete server" aria-label={`Delete ${s.name}`} onClick={() => void remove(s.id, s.name)} className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-dim outline-none hover:bg-base-2 hover:text-bad focus-visible:ring-2 focus-visible:ring-accent">Delete</button>
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
  const [envFor, setEnvFor] = useState<string | null>(null);
  const [envText, setEnvText] = useState('');
  const [asName, setAsName] = useState('');

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

  async function install(name: string, env?: Record<string, string>, as?: string) {
    try {
      await apiFetch('/api/mcp/install', {
        method: 'POST',
        body: JSON.stringify({ name, ...(env && Object.keys(env).length ? { env } : {}), ...(as?.trim() ? { as: as.trim() } : {}) }),
      });
      pushToast('ok', `Installed ${as?.trim() || name}`);
      setEnvFor(null);
      setEnvText('');
      setAsName('');
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Install failed';
      const missing = /Missing required env vars: (.+)\./.exec(message)?.[1];
      if (missing && envFor !== name) {
        // The package needs secrets: open the env form prefilled with the
        // required names so the user just fills values and retries.
        setEnvFor(name);
        setEnvText(missing.split(',').map(v => `${v.trim()}=`).join('\n'));
        pushToast('info', `${name} needs ${missing}`);
        return;
      }
      pushToast('error', message);
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
        <div key={r.name}>
          <div className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
            <Store className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] font-medium">{r.name}</p>
              <p className="truncate text-xs text-ink-dim">{r.description} · {r.transports.join(', ')}</p>
            </div>
            <button type="button" onClick={() => void install(r.name)} className="shrink-0 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Install</button>
          </div>
          {envFor === r.name && (
            <div className="mt-1 ml-8 space-y-2 rounded-xl border border-line bg-base-1 p-3">
              <p className="text-xs text-ink-dim">This package needs secrets before it can install.</p>
              <textarea value={envText} onChange={e => setEnvText(e.target.value)} placeholder="KEY=value, one per line" rows={3} aria-label={`Env for ${r.name}`} className="w-full rounded-lg border border-line bg-base-0 p-2.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
              <input value={asName} onChange={e => setAsName(e.target.value)} placeholder="Install as… (optional display name)" aria-label={`Display name for ${r.name}`} className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
              <div className="flex gap-2">
                <button type="button" onClick={() => void install(r.name, parseEnvLines(envText), asName)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Install with env</button>
                <button type="button" onClick={() => { setEnvFor(null); setEnvText(''); setAsName(''); }} className="rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function WebhooksTab() {
  const { data } = useWebhooks();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', events: '*', secret: '' });
  const [editing, setEditing] = useState<number | null>(null);
  const [edit, setEdit] = useState({ name: '', url: '', events: '', enabled: true });
  const hooks = data?.webhooks ?? [];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
  }

  async function fire(id: number, name: string) {
    try {
      await apiFetch(`/api/webhooks/${id}/test`, { method: 'POST' });
      pushToast('ok', `Test delivery sent to ${name}`);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Test failed');
    }
  }

  async function register() {
    const events = form.events.split(',').map(s => s.trim()).filter(Boolean);
    try {
      await apiFetch('/api/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          url: form.url.trim(),
          events: events.length ? events : ['*'],
          ...(form.secret ? { secret: form.secret } : {}),
        }),
      });
      pushToast('ok', `Registered ${form.name.trim()}`);
      setForm({ name: '', url: '', events: '*', secret: '' });
      setAdding(false);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Register failed');
    }
  }

  async function saveEdit(id: number) {
    const events = edit.events.split(',').map(s => s.trim()).filter(Boolean);
    try {
      await apiFetch(`/api/webhooks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: edit.name.trim(), url: edit.url.trim(), events, enabled: edit.enabled }),
      });
      pushToast('ok', 'Webhook saved');
      setEditing(null);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function remove(id: number, name: string) {
    try {
      await apiFetch(`/api/webhooks/${id}`, { method: 'DELETE' });
      pushToast('ok', `Deleted ${name}`);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => setAdding(a => !a)} className="rounded-lg bg-accent px-2.5 py-2 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Register webhook</button>
      </div>
      {adding && (
        <div className="space-y-2 rounded-xl border border-line bg-base-1 p-4">
          <div className="flex gap-2">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="name" aria-label="Webhook name" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
            <input value={form.events} onChange={e => setForm({ ...form, events: e.target.value })} placeholder="events (* or comma list)" aria-label="Webhook events" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          </div>
          <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://… receiver URL" aria-label="Webhook URL" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <input value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })} placeholder="HMAC secret (optional)" aria-label="Webhook secret" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          <div className="flex gap-2">
            <button type="button" onClick={() => void register()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Register</button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Cancel</button>
          </div>
        </div>
      )}
      {!hooks.length && <p className="py-6 text-center text-xs text-ink-faint">No webhooks — register one to get signed POSTs on run, approval, and eval events.</p>}
      {hooks.map(h => (
        <div key={h.id}>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-base-1 px-4 py-3">
            <Webhook className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[13px] font-medium">{h.name}</p>
              <p className="truncate font-mono text-[11px] text-ink-dim">{h.url} · {h.events.join(', ') || 'all'}{h.enabled ? '' : ' · disabled'}</p>
            </div>
            <span className={`shrink-0 font-mono text-[11px] ${h.last_status === 200 ? 'text-ok' : h.last_status ? 'text-bad' : 'text-ink-faint'}`}>
              {h.last_status ?? (h.last_error ? 'err' : '—')}
            </span>
            <button type="button" onClick={() => void fire(h.id, h.name)} className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Send test</button>
            <button type="button" aria-label={`Edit webhook ${h.name}`} onClick={() => (editing === h.id ? setEditing(null) : (setEdit({ name: h.name, url: h.url, events: h.events.join(', '), enabled: !!h.enabled }), setEditing(h.id)))} className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent">Edit</button>
            <button type="button" aria-label={`Delete webhook ${h.name}`} onClick={() => void remove(h.id, h.name)} className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-dim outline-none hover:bg-base-2 hover:text-bad focus-visible:ring-2 focus-visible:ring-accent">Delete</button>
          </div>
          {editing === h.id && (
            <div className="mt-1 ml-8 space-y-2 rounded-xl border border-line bg-base-1 p-3">
              <div className="flex gap-2">
                <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} aria-label={`Edit name for ${h.name}`} className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent" />
                <input value={edit.events} onChange={e => setEdit({ ...edit, events: e.target.value })} aria-label={`Edit events for ${h.name}`} className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent" />
              </div>
              <input value={edit.url} onChange={e => setEdit({ ...edit, url: e.target.value })} aria-label={`Edit URL for ${h.name}`} className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent" />
              <label className="flex items-center gap-2 text-xs text-ink-dim">
                <input type="checkbox" checked={edit.enabled} onChange={e => setEdit({ ...edit, enabled: e.target.checked })} className="accent-[var(--accent)]" /> Enabled
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => void saveEdit(h.id)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Save</button>
                <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
