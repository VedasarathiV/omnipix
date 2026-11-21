import { useEffect, useRef, useState } from 'react';
import { Bot, FileText, FolderGit2, MessageSquare, Search, Slash, Trophy } from 'lucide-react';
import { useStudio } from '../state/store';
import { fuzzyScore } from '../lib/compose';
import { useCommands, useConversations, useEvalSuites, useModels, useRuns, useSkills } from '../lib/queries';

interface Entry {
  group: string;
  label: string;
  hint: string;
  icon: typeof Bot;
  run: () => void;
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setRail, setModel, setSettingsOpen, pushToast, setConversationId, setActiveRunId, setMode, setEditDraft } = useStudio();
  const { data: runsData } = useRuns();
  const { data: conversations = [] } = useConversations();
  const { data: models = [] } = useModels();
  const { data: skillsData } = useSkills();
  const { data: commandsData } = useCommands();
  const insertSlash = (name: string) => {
    // Draft-only: the current chat/run stays put, only the box changes.
    setPaletteOpen(false);
    setRail('chat');
    setEditDraft({ text: `/${name} `, seq: Date.now() });
  };
  const runs = runsData?.runs ?? [];
  const { data: suitesData } = useEvalSuites();
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
    ...runs.slice(0, 4).map(r => ({
      group: 'Runs', label: `#${r.id} ${r.goal.slice(0, 50)}`, hint: r.status, icon: FolderGit2,
      run: () => { setActiveRunId(r.id); setConversationId(null); setRail('chat'); },
    })),
    ...conversations.slice(0, 4).map(c => ({
      group: 'Chats', label: c.title || 'Untitled chat', hint: `${c.messageCount} msgs`, icon: MessageSquare,
      run: () => { setConversationId(c.id); setActiveRunId(null); setRail('chat'); },
    })),
    { group: 'Model', label: 'Auto (fallback chain)', hint: 'Set model', icon: Bot, run: () => setModel('auto') },
    ...models.filter(m => m.enabled).slice(0, 6).map(m => ({
      group: 'Model', label: `${m.modelId} · ${m.platform}`, hint: 'Set model', icon: Bot,
      run: () => { setModel(m.modelId); pushToast('ok', `Model: ${m.modelId}`); },
    })),
    ...(suitesData?.suites ?? []).slice(0, 3).map(s => ({
      group: 'Evals', label: s.name, hint: 'Open evals', icon: Trophy,
      run: () => setRail('evals'),
    })),
    { group: 'Mode', label: 'Ask mode', hint: '⌘.', icon: Bot, run: () => setMode('ask') },
    { group: 'Mode', label: 'Plan mode', hint: '⌘.', icon: Bot, run: () => setMode('plan') },
    { group: 'Mode', label: 'Agent mode', hint: '⌘.', icon: Bot, run: () => setMode('agent') },
    { group: 'Go', label: 'Search everything', hint: '⌘6', icon: Search, run: () => setRail('search') },
    { group: 'Go', label: 'Open docs', hint: '⌘7', icon: FileText, run: () => setRail('docs') },
    { group: 'Go', label: 'New chat', hint: '⌘N', icon: MessageSquare, run: () => { setConversationId(null); setActiveRunId(null); setRail('chat'); } },
    { group: 'Go', label: 'Open settings', hint: '⌘,', icon: Search, run: () => setSettingsOpen(true) },
    ...(commandsData?.commands ?? []).slice(0, 12).map(c => ({
      group: 'Commands', label: `/${c.name} — ${c.description}`, hint: 'Insert', icon: Slash,
      run: () => insertSlash(c.name),
    })),
    ...(skillsData?.skills ?? []).filter(s => s.enabled).slice(0, 12).map(s => ({
      group: 'Skills', label: `/${s.name} — ${s.description}`, hint: 'Insert', icon: Bot,
      run: () => insertSlash(s.name),
    })),
  ];

  const q = query.trim();
  const filtered = entries
    .map(e => ({ e, score: fuzzyScore(q, `${e.group} ${e.label}`) }))
    .filter(x => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.e);
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
