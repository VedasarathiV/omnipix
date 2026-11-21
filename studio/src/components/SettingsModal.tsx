import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { applyTheme, loadThemePref, type ThemePref } from '../lib/theme';
import { loadDiffView, saveDiffView, type DiffView } from '../lib/prefs';
import { useApprovalRules, useConversation, useMedia, useModels, useVoiceSettings } from '../lib/queries';

const SECTIONS = ['Model', 'Sampling', 'System prompt', 'Voice', 'Permissions', 'Appearance', 'Shortcuts', 'Data'] as const;

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useStudio();
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('Model');
  if (!settingsOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setSettingsOpen(false)}>
      <div
        role="dialog"
        aria-label="Settings"
        className="flex h-[32rem] w-full max-w-3xl overflow-hidden rounded-xl border border-line bg-base-1 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <nav aria-label="Settings sections" className="w-44 shrink-0 border-r border-line p-2">
          {SECTIONS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={`block w-full rounded-lg px-3 py-1.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                section === s ? 'bg-base-2 font-medium' : 'text-ink-dim hover:text-ink'
              }`}
            >
              {s}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">{section}</h2>
            <button
              type="button"
              aria-label="Close settings"
              onClick={() => setSettingsOpen(false)}
              className="rounded-lg p-1 text-ink-dim outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="size-4" strokeWidth={1.5} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {section === 'Model' && <ModelSection />}
            {section === 'Sampling' && <SamplingSection />}
            {section === 'System prompt' && <SystemSection />}
            {section === 'Voice' && <VoiceSection />}
            {section === 'Permissions' && <PermissionsSection />}
            {section === 'Appearance' && <AppearanceSection />}
            {section === 'Shortcuts' && <ShortcutsSection />}
            {section === 'Data' && <DataSection />}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div>
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-ink-dim">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ on, onFlip, label }: { on: boolean; onFlip: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onFlip}
      className={`relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${on ? 'bg-accent' : 'bg-base-2'}`}
    >
      <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function ModelSection() {
  const { model, setModel } = useStudio();
  const { data: models = [] } = useModels();
  const enabled = models.filter(m => m.enabled);
  return (
    <div className="divide-y divide-line">
      <Row label="Default model" hint="Used for new chats and agent runs">
        <select value={model} onChange={e => setModel(e.target.value)} className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <option value="auto">Auto (fallback chain)</option>
          {enabled.map(m => <option key={m.id} value={m.modelId}>{m.modelId} · {m.platform}</option>)}
        </select>
      </Row>
      <Row label="Catalog" hint="Enabled chat models behind Auto">
        <span className="font-mono text-xs text-ink-dim">{enabled.length} models</span>
      </Row>
    </div>
  );
}

interface SamplingState {
  temp: [boolean, number];
  topP: [boolean, number];
  maxTok: [boolean, number];
}

const SAMPLING_DEFAULTS: SamplingState = { temp: [false, 0.7], topP: [false, 0.9], maxTok: [false, 4096] };

function loadSampling(): SamplingState {
  try {
    const raw = localStorage.getItem('studio.sampling');
    if (!raw) return SAMPLING_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<SamplingState>;
    const valid = (v: unknown, fallback: [boolean, number]): [boolean, number] =>
      Array.isArray(v) && typeof v[0] === 'boolean' && typeof v[1] === 'number' ? [v[0], v[1]] : fallback;
    return {
      temp: valid(parsed.temp, SAMPLING_DEFAULTS.temp),
      topP: valid(parsed.topP, SAMPLING_DEFAULTS.topP),
      maxTok: valid(parsed.maxTok, SAMPLING_DEFAULTS.maxTok),
    };
  } catch {
    return SAMPLING_DEFAULTS;
  }
}

/** Sampling overrides for chat send: only enabled sliders are transmitted. */
export function readSampling(): SamplingState {
  return loadSampling();
}

function SamplingSection() {
  const [state, setState] = useState<SamplingState>(loadSampling);
  function set(key: keyof SamplingState, value: [boolean, number]) {
    setState(current => {
      const next = { ...current, [key]: value };
      try {
        localStorage.setItem('studio.sampling', JSON.stringify(next));
      } catch {
        // Private mode: preference just doesn't persist.
      }
      return next;
    });
  }
  const { temp, topP, maxTok } = state;
  const slider = (label: string, hint: string, v: [boolean, number], set: (v: [boolean, number]) => void, min: number, max: number, step: number) => (
    <Row label={label} hint={hint}>
      <span className="flex items-center gap-2">
        <button type="button" onClick={() => set([!v[0], v[1]])} className={`rounded-md px-1.5 py-0.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${v[0] ? 'bg-base-2 text-ink' : 'text-ink-faint'}`}>
          {v[0] ? v[1] : 'Default'}
        </button>
        <input type="range" aria-label={label} min={min} max={max} step={step} value={v[1]} disabled={!v[0]} onChange={e => set([true, Number(e.target.value)])} className="w-28 accent-[var(--accent)] disabled:opacity-30" />
      </span>
    </Row>
  );
  const setTemp = (v: [boolean, number]) => set('temp', v);
  const setTopP = (v: [boolean, number]) => set('topP', v);
  const setMaxTok = (v: [boolean, number]) => set('maxTok', v);
  return (
    <div className="divide-y divide-line">
      {slider('Temperature', 'Higher = more creative', temp, setTemp, 0, 2, 0.05)}
      {slider('Top P', 'Nucleus sampling cutoff', topP, setTopP, 0, 1, 0.05)}
      {slider('Max tokens', 'Cap per response', maxTok, setMaxTok, 256, 128000, 256)}
    </div>
  );
}

function SystemSection() {
  const { conversationId, pushToast } = useStudio();
  const { data: conversation } = useConversation(conversationId);
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? conversation?.systemPrompt ?? '';
  if (conversationId === null) {
    return <p className="py-4 text-center text-xs text-ink-faint">Open a chat to set its system prompt.</p>;
  }
  async function save() {
    try {
      await apiFetch(`/api/conversations/${conversationId}`, { method: 'PUT', body: JSON.stringify({ systemPrompt: shown }) });
      pushToast('ok', 'System prompt saved to this chat');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Save failed');
    }
  }
  return (
    <div>
      <p className="mb-2 text-xs text-ink-dim">Optional. Sent as a system message before this chat.</p>
      <textarea value={shown} onChange={e => setText(e.target.value)} rows={6} className="w-full rounded-lg border border-line bg-base-0 p-2.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent" />
      <button type="button" onClick={() => void save()} className="mt-2 rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Save to chat</button>
    </div>
  );
}

function VoiceSection() {
  const { data: voice } = useVoiceSettings();
  const { data: media } = useMedia();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const stt = (media?.models ?? []).filter(m => m.modality === 'transcription' && m.enabled);
  async function save(patch: Record<string, unknown>) {
    try {
      await apiFetch('/api/settings/voice', { method: 'PUT', body: JSON.stringify(patch) });
      void queryClient.invalidateQueries({ queryKey: ['voice-settings'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Save failed');
    }
  }
  return (
    <div className="divide-y divide-line">
      <Row label="Dictation model" hint="Speech-to-text for the mic">
        <select
          value={voice?.sttModel ?? 'auto'}
          onChange={e => void save({ sttModel: e.target.value })}
          aria-label="Dictation model"
          className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="auto">Auto</option>
          {stt.map(m => <option key={m.id} value={m.modelId}>{m.displayName}</option>)}
        </select>
      </Row>
      <Row label="Voice output" hint="Read chat responses aloud">
        <Toggle on={!!voice?.autoSpeakChat} onFlip={() => void save({ autoSpeakChat: !voice?.autoSpeakChat })} label="Voice output" />
      </Row>
    </div>
  );
}

function PermissionsSection() {
  const { data } = useApprovalRules();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const rules = data?.rules ?? [];
  const allow = rules.filter(r => r.decision === 'allow');
  const deny = rules.filter(r => r.decision === 'deny');

  async function clear(tool: string) {
    try {
      await apiFetch(`/api/agents/approval-rules/${encodeURIComponent(tool)}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: ['approval-rules'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Clear failed');
    }
  }

  return (
    <div className="divide-y divide-line">
      <Row label="Always allow" hint="Tools pinned from approval prompts">
        <span className="font-mono text-xs text-ok">{allow.length} rule{allow.length === 1 ? '' : 's'}</span>
      </Row>
      {allow.map(r => (
        <Row key={r.tool} label={r.tool} hint="tap Clear to ask again">
          <button type="button" onClick={() => void clear(r.tool)} className="rounded-lg border border-line px-2 py-1 text-[11px] outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Clear</button>
        </Row>
      ))}
      <Row label="Always deny" hint="Tools refused automatically">
        <span className="font-mono text-xs text-bad">{deny.length} rule{deny.length === 1 ? '' : 's'}</span>
      </Row>
      {deny.map(r => (
        <Row key={r.tool} label={r.tool} hint="tap Clear to ask again">
          <button type="button" onClick={() => void clear(r.tool)} className="rounded-lg border border-line px-2 py-1 text-[11px] outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Clear</button>
        </Row>
      ))}
      {rules.length === 0 && <p className="py-3 text-center text-xs text-ink-faint">No pinned rules — approvals ask every time.</p>}
    </div>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState<ThemePref>(loadThemePref);
  const [diffView, setDiffView] = useState<DiffView>(loadDiffView);
  return (
    <div className="divide-y divide-line">
      <Row label="Theme" hint="Dark first, light supported">
        <select
          value={theme}
          onChange={e => { const next = e.target.value as ThemePref; setTheme(next); applyTheme(next); }}
          aria-label="Theme"
          className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>
      </Row>
      <Row label="Diff view" hint="Default for the changes panel">
        <select
          value={diffView}
          onChange={e => { const next = e.target.value as DiffView; setDiffView(next); saveDiffView(next); }}
          aria-label="Diff view"
          className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="split">Split</option>
          <option value="unified">Unified</option>
        </select>
      </Row>
    </div>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ['⌘K', 'Command palette'], ['⌘N', 'New chat'], ['⌘Enter', 'Run / send'], ['Esc', 'Stop run'],
  ['⌘M', 'Change model'], ['⌘.', 'Cycle Ask / Plan / Agent'], ['⌘,', 'Settings'],
  ['⌘1–0', 'Switch rail section'], ['⌘B', 'Toggle sidebar'], ['⌘⌥B', 'Toggle inspector'],
  ['↑', 'Previous prompt'], ['/', 'Slash commands'], ['@', 'Mention file'],
];

function ShortcutsSection() {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
      {SHORTCUTS.map(([keys, what]) => (
        <div key={what} className="flex items-center justify-between rounded-lg bg-base-0 px-3 py-1.5 text-xs">
          <span className="text-ink-dim">{what}</span>
          <kbd className="rounded-md border border-line bg-base-1 px-1.5 py-0.5 font-mono text-[11px]">{keys}</kbd>
        </div>
      ))}
    </div>
  );
}

function DataSection() {
  const { pushToast } = useStudio();
  async function downloadDiagnostics() {
    try {
      const bundle = await apiFetch<unknown>('/api/diagnostics/bundle');
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'omnipix-diagnostics.json';
      link.click();
      URL.revokeObjectURL(url);
      pushToast('ok', 'Diagnostics downloaded');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Download failed');
    }
  }
  async function exportData() {
    try {
      const { backup } = await apiFetch<{ backup: { id: number; filename: string } }>('/api/backups', { method: 'POST' });
      const token = localStorage.getItem('omnipix_dashboard_token');
      const res = await fetch(`/api/backups/${backup.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = backup.filename;
      link.click();
      URL.revokeObjectURL(url);
      pushToast('ok', 'Backup downloaded');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Export failed');
    }
  }
  return (
    <div className="divide-y divide-line">
      <Row label="Export data" hint="Full encrypted database backup">
        <button type="button" onClick={() => void exportData()} className="rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Export</button>
      </Row>
      <Row label="Diagnostics" hint="Redacted support bundle">
        <button type="button" onClick={() => void downloadDiagnostics()} className="rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Download</button>
      </Row>
      <Row label="Storage" hint="Local-first: everything lives on this machine"><span className="font-mono text-xs text-ok">local</span></Row>
    </div>
  );
}
