import { Files, MessageSquare, PanelLeftClose, Plus } from 'lucide-react';
import { FileTree } from './FileTree';
import { useStudio } from '../state/store';
import { useConversations } from '../lib/queries';

export function Sidebar() {
  const { sidebarTab, setSidebarTab, setSidebarOpen, setConversationId, setActiveRunId, conversationId } = useStudio();
  const { data: conversations = [] } = useConversations();
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
          onClick={() => { setConversationId(null); setActiveRunId(null); }}
          className="rounded-md p-1.5 text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus className="size-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          onClick={() => setSidebarOpen(false)}
          className="hidden rounded-md p-1.5 text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent md:block"
        >
          <PanelLeftClose className="size-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {sidebarTab === 'files' ? (
          <FileTree />
        ) : (
          <div className="h-full overflow-y-auto p-1.5">
            {conversations.length === 0 && (
              <p className="px-2.5 py-4 text-center text-xs text-ink-faint">No chats yet — press + above or type below in chat.</p>
            )}
            {conversations.map(chat => (
              <button
                key={chat.id}
                type="button"
                onClick={() => { setConversationId(chat.id); setActiveRunId(null); }}
                className={`block w-full rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  conversationId === chat.id ? 'bg-base-2' : 'hover:bg-base-2/60'
                }`}
              >
                <span className="block truncate text-[13px] font-medium">{chat.title || 'Untitled chat'}</span>
                <span className="block truncate text-[11px] text-ink-dim">{chat.messageCount} messages{chat.model ? ` · ${chat.model}` : ''}</span>
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
