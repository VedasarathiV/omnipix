import { useEffect, useRef, useState } from 'react';
import { Bot, FileText, FolderGit2, MessageSquare, Search, Trophy } from 'lucide-react';
import { AGENTS, EVAL_RUNS, MODELS, WORKSPACES } from '../mock/data';
import { useStudio } from '../state/store';

interface Entry {
  group: string;
  label: string;
  hint: string;
  icon: typeof Bot;
  run: () => void;
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setRail, setModel, setSettingsOpen, pushToast } = useStudio();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (paletteOpen) {
      setQuery('');
      setIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [paletteOpen]);

  if (!paletteOpen) return null;

  const entries: Entry[] = [
    ...WORKSPACES.map(w => ({
      group: 'Workspace', label: `Switch to ${w.name}`, hint: w.branch, icon: FolderGit2,
      run: () => pushToast('info', `Switched to workspace ${w.name}`),
    })),
    ...MODELS.map(m => ({
      group: 'Model', label: m.label, hint: 'Set model', icon: Bot,
      run: () => { setModel(m.id); pushToast('ok', `Model: ${m.label}`); },
    })),
    ...AGENTS.map(a => ({
      group: 'Agents', label: `Open agent ${a.name}`, hint: a.model, icon: Bot,
      run: () => setRail('agents'),
    })),
    ...EVAL_RUNS.slice(0, 2).map(e => ({
      group: 'Evals', label: `${e.suite} — ${e.passRate}%`, hint: e.ts, icon: Trophy,
      run: () => setRail('evals'),
    })),
    { group: 'Go', label: 'Search chats', hint: '⌘6', icon: Search, run: () => setRail('search') },
    { group: 'Go', label: 'Open docs', hint: '⌘7', icon: FileText, run: () => setRail('docs') },
    { group: 'Go', label: 'New chat', hint: '⌘N', icon: MessageSquare, run: () => { setRail('chat'); pushToast('ok', 'New chat started'); } },
    { group: 'Go', label: 'Open settings', hint: '⌘,', icon: Search, run: () => setSettingsOpen(true) },
  ];

  const q = query.toLowerCase();
  const filtered = entries.filter(e => !q || e.label.toLowerCase().includes(q) || e.group.toLowerCase().includes(q));
  const current = filtered[Math.min(index, Math.max(0, filtered.length - 1))];

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-24" onClick={() => setPaletteOpen(false)}>
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-base-1 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setIndex(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, filtered.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
            if (e.key === 'Enter' && current) { setPaletteOpen(false); current.run(); }
            if (e.key === 'Escape') setPaletteOpen(false);
          }}
          placeholder="Type a command, file, chat, agent, or model…"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-sm outline-none placeholder:text-ink-faint"
        />
        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 && <p className="px-3 py-4 text-center text-xs text-ink-faint">No matches</p>}
          {filtered.map((entry, i) => (
            <button
              key={`${entry.group}-${entry.label}`}
              type="button"
              onClick={() => { setPaletteOpen(false); entry.run(); }}
              onMouseEnter={() => setIndex(i)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none ${
                i === Math.min(index, filtered.length - 1) ? 'bg-base-2' : ''
              }`}
            >
              <entry.icon className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              <span className="shrink-0 text-[11px] text-ink-faint">{entry.group} · {entry.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
