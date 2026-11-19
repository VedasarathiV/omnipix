import { Files, MessageSquare, PanelLeftClose, Plus } from 'lucide-react';
import { FileTree } from './FileTree';
import { useStudio } from '../state/store';

const CHATS = [
  { id: 'c1', title: 'Refresh-token rotation', preview: 'Rotation is in and tests run…', active: true },
  { id: 'c2', title: 'Explain fallback chain', preview: 'How does auto-routing pick…', active: false },
  { id: 'c3', title: 'Eval the new model', preview: 'safety-basics 96% pass…', active: false },
  { id: 'c4', title: 'Debug oauth flake', preview: 'Intermittent 401 on refresh…', active: false },
];

export function Sidebar() {
  const { sidebarTab, setSidebarTab, setSidebarOpen, pushToast } = useStudio();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line p-2">
        <TabBtn active={sidebarTab === 'chats'} onClick={() => setSidebarTab('chats')} label="Chats">
          <MessageSquare className="size-3.5" strokeWidth={1.5} /> Chats
        </TabBtn>
        <TabBtn active={sidebarTab === 'files'} onClick={() => setSidebarTab('files')} label="Files">
          <Files className="size-3.5" strokeWidth={1.5} /> Files
        </TabBtn>
        <span className="flex-1" />
        <button
          type="button"
          title="New chat (⌘N)"
          aria-label="New chat"
          onClick={() => pushToast('ok', 'New chat started')}
          className="rounded-md p-1.5 text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus className="size-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          onClick={() => setSidebarOpen(false)}
          className="rounded-md p-1.5 text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <PanelLeftClose className="size-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {sidebarTab === 'files' ? (
          <FileTree />
        ) : (
          <div className="h-full overflow-y-auto p-1.5">
            {CHATS.map(chat => (
              <button
                key={chat.id}
                type="button"
                onClick={() => pushToast('info', `Opened "${chat.title}"`)}
                className={`block w-full rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  chat.active ? 'bg-base-2' : 'hover:bg-base-2/60'
                }`}
              >
                <span className="block truncate text-[13px] font-medium">{chat.title}</span>
                <span className="block truncate text-[11px] text-ink-dim">{chat.preview}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active ? 'bg-base-2 font-medium text-ink' : 'text-ink-dim hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
