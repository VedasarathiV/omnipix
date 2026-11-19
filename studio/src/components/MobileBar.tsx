import { FileDiff, Files, MessageSquare, MoreHorizontal } from 'lucide-react';
import { useStudio } from '../state/store';

export type MobilePane = 'chat' | 'files' | 'changes' | 'more';

const PANES: Array<{ id: MobilePane; label: string; icon: typeof MessageSquare }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'changes', label: 'Changes', icon: FileDiff },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

export function MobileBar({ pane, setPane }: { pane: MobilePane; setPane: (p: MobilePane) => void }) {
  const { setPaletteOpen } = useStudio();
  return (
    <nav aria-label="Mobile" className="flex shrink-0 items-center border-t border-line bg-base-1 px-2 py-1.5 md:hidden">
      {PANES.map(p => (
        <button
          key={p.id}
          type="button"
          aria-pressed={pane === p.id}
          onClick={() => (p.id === 'more' ? setPaletteOpen(true) : setPane(p.id))}
          className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            pane === p.id ? 'text-accent' : 'text-ink-dim'
          }`}
        >
          <p.icon className="size-5" strokeWidth={1.5} />
          {p.label}
        </button>
      ))}
    </nav>
  );
}
