import {
  Bell,
  Blocks,
  BookOpen,
  Bot,
  KeyRound,
  Mic,
  Search,
  Settings,
  Trophy,
  Waypoints,
} from 'lucide-react';
import type { RailId } from '../types';
import { useStudio } from '../state/store';

const ITEMS: Array<{ id: RailId; label: string; icon: typeof Bot; shortcut: string }> = [
  { id: 'chat', label: 'Chat', icon: Waypoints, shortcut: '⌘1' },
  { id: 'agents', label: 'Agents', icon: Bot, shortcut: '⌘2' },
  { id: 'skills', label: 'Skills', icon: Blocks, shortcut: '⌘3' },
  { id: 'keys', label: 'Provider keys', icon: KeyRound, shortcut: '⌘4' },
  { id: 'evals', label: 'Evals', icon: Trophy, shortcut: '⌘5' },
  { id: 'search', label: 'Search', icon: Search, shortcut: '⌘6' },
  { id: 'docs', label: 'Docs', icon: BookOpen, shortcut: '⌘7' },
  { id: 'notifications', label: 'Notifications', icon: Bell, shortcut: '⌘8' },
  { id: 'voice', label: 'Voice', icon: Mic, shortcut: '⌘9' },
];

export function IconRail() {
  const { rail, setRail, setSettingsOpen } = useStudio();
  return (
    <nav aria-label="Primary" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-base-1 py-2">
      <div className="mb-2 flex size-7 items-center justify-center rounded-lg bg-ok font-mono text-xs font-bold text-base-0" aria-label="OmniPix">
        O
      </div>
      {ITEMS.slice(0, 7).map(item => (
        <RailButton key={item.id} active={rail === item.id} onClick={() => setRail(item.id)} label={`${item.label} (${item.shortcut})`}>
          <item.icon className="size-5" strokeWidth={1.5} />
        </RailButton>
      ))}
      <div className="flex-1" />
      {ITEMS.slice(7).map(item => (
        <RailButton key={item.id} active={rail === item.id} onClick={() => setRail(item.id)} label={`${item.label} (${item.shortcut})`}>
          <item.icon className="size-5" strokeWidth={1.5} />
        </RailButton>
      ))}
      <RailButton active={false} onClick={() => setSettingsOpen(true)} label="Settings (⌘,)">
        <Settings className="size-5" strokeWidth={1.5} />
      </RailButton>
    </nav>
  );
}

function RailButton({ active, onClick, label, children }: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex size-9 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
        active ? 'bg-base-2 text-ink' : 'text-ink-faint hover:bg-base-2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
