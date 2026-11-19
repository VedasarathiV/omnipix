import { useState } from 'react';
import { X } from 'lucide-react';
import { MODELS } from '../mock/data';
import { useStudio } from '../state/store';

const SECTIONS = ['Model', 'Sampling', 'System prompt', 'Search', 'Voice', 'Permissions', 'Appearance', 'Shortcuts', 'Data'] as const;

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, pushToast } = useStudio();
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
            {section === 'Search' && <SearchSection />}
            {section === 'Voice' && <VoiceSection />}
            {section === 'Permissions' && <PermissionsSection />}
            {section === 'Appearance' && <AppearanceSection />}
            {section === 'Shortcuts' && <ShortcutsSection />}
            {section === 'Data' && <DataSection />}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={() => { setSettingsOpen(false); pushToast('ok', 'Settings saved'); }}
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
            >
              Save changes
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
  return (
    <div className="divide-y divide-line">
      <Row label="Default model" hint="Used for new chats and agent runs">
        <select value={model} onChange={e => setModel(e.target.value)} className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Row>
      <Row label="Fallback chain" hint="Auto moves to the next provider on rate limits">
        <span className="font-mono text-xs text-ink-dim">Groq → Cerebras → Google</span>
      </Row>
    </div>
  );
}

function SamplingSection() {
  const [temp, setTemp] = useState<[boolean, number]>([false, 0.7]);
  const [topP, setTopP] = useState<[boolean, number]>([false, 0.9]);
  const [maxTok, setMaxTok] = useState<[boolean, number]>([false, 4096]);
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
  return (
    <div className="divide-y divide-line">
      {slider('Temperature', 'Higher = more creative', temp, setTemp, 0, 2, 0.05)}
      {slider('Top P', 'Nucleus sampling cutoff', topP, setTopP, 0, 1, 0.05)}
      {slider('Max tokens', 'Cap per response', maxTok, setMaxTok, 256, 128000, 256)}
    </div>
  );
}

function SystemSection() {
  const [text, setText] = useState('You are a careful coding assistant. Prefer minimal diffs and always run the tests you touch.');
  return (
    <div>
      <p className="mb-2 text-xs text-ink-dim">Optional. Sent as a system message before every chat.</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={6} className="w-full rounded-lg border border-line bg-base-0 p-2.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent" />
    </div>
  );
}

function SearchSection() {
  const [on, setOn] = useState(true);
  return (
    <div className="divide-y divide-line">
      <Row label="Web search" hint="Engines sync from the catalog"><Toggle on={on} onFlip={() => setOn(!on)} label="Web search" /></Row>
      <Row label="Engines" hint="2 configured"><span className="font-mono text-xs text-ink-dim">tavily · exa</span></Row>
    </div>
  );
}

function VoiceSection() {
  return (
    <div className="divide-y divide-line">
      <Row label="Dictation model" hint="Speech-to-text for the mic"><span className="text-xs">whisper-large-v3-turbo</span></Row>
      <Row label="Voice output" hint="Read chat responses aloud"><Toggle on={false} onFlip={() => {}} label="Voice output" /></Row>
    </div>
  );
}

function PermissionsSection() {
  const [level, setLevel] = useState('risky');
  return (
    <div className="divide-y divide-line">
      <Row label="Permission level" hint="What the agent may do without asking">
        <select value={level} onChange={e => setLevel(e.target.value)} className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <option value="always">Ask always</option>
          <option value="risky">Ask for risky</option>
          <option value="auto">Auto</option>
        </select>
      </Row>
      <Row label="Protected paths" hint="Never edited without approval"><span className="font-mono text-xs text-ink-dim">.env, *.pem, main</span></Row>
      <Row label="Always allow" hint="shell_exec · npm test"><span className="font-mono text-xs text-ok">2 rules</span></Row>
      <Row label="Always deny" hint="rm -rf /, shutdown"><span className="font-mono text-xs text-bad">2 rules</span></Row>
    </div>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState('dark');
  return (
    <div className="divide-y divide-line">
      <Row label="Theme" hint="Dark first, light supported">
        <select
          value={theme}
          onChange={e => { setTheme(e.target.value); document.documentElement.classList.toggle('dark', e.target.value !== 'light'); }}
          className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>
      </Row>
      <Row label="Diff view" hint="Default for the changes panel"><span className="text-xs">Split</span></Row>
    </div>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ['⌘K', 'Command palette'], ['⌘N', 'New chat'], ['⌘Enter', 'Run / send'], ['Esc', 'Stop run'],
  ['⌘M', 'Change model'], ['⌘.', 'Cycle Ask / Plan / Agent'], ['⌘,', 'Settings'],
  ['⌘1–9', 'Switch rail section'], ['↑', 'Previous prompt'], ['/', 'Slash commands'], ['@', 'Mention file'],
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
  return (
    <div className="divide-y divide-line">
      <Row label="Export data" hint="Chats, settings, and keys as encrypted JSON">
        <button type="button" onClick={() => pushToast('ok', 'Export downloaded')} className="rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Export</button>
      </Row>
      <Row label="Diagnostics" hint="Redacted support bundle"><span className="font-mono text-xs text-ink-dim">/api/diagnostics/bundle</span></Row>
      <Row label="Storage" hint="Local-first: everything lives on this machine"><span className="font-mono text-xs text-ok">local</span></Row>
    </div>
  );
}
