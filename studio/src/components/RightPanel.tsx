import { FileDiff, Files, PanelRightClose, Play, ScrollText, SquareTerminal } from 'lucide-react';
import type { RightTab } from '../types';
import { ChangesPanel } from './ChangesPanel';
import { FileTree } from './FileTree';
import { LogsPanel, PreviewPanel, TerminalPanel } from './TerminalPreview';
import { useStudio } from '../state/store';

const TABS: Array<{ id: RightTab; label: string; icon: typeof FileDiff }> = [
  { id: 'changes', label: 'Changes', icon: FileDiff },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'preview', label: 'Preview', icon: Play },
  { id: 'logs', label: 'Logs', icon: ScrollText },
];

export function RightPanel() {
  const { rightTab, setRightTab, setRightOpen } = useStudio();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-line p-1.5" role="tablist" aria-label="Inspector">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={rightTab === tab.id}
            title={tab.label}
            onClick={() => setRightTab(tab.id)}
            className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              rightTab === tab.id ? 'bg-base-2 font-medium text-ink' : 'text-ink-dim hover:text-ink'
            }`}
          >
            <tab.icon className="size-3.5" strokeWidth={1.5} />
            <span className="hidden xl:inline">{tab.label}</span>
            {tab.id === 'changes' && (
              <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-base-0">3</span>
            )}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          title="Collapse panel"
          aria-label="Collapse panel"
          onClick={() => setRightOpen(false)}
          className="rounded-md p-1.5 text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <PanelRightClose className="size-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {rightTab === 'changes' && <ChangesPanel />}
        {rightTab === 'files' && <FileTree />}
        {rightTab === 'terminal' && <TerminalPanel />}
        {rightTab === 'preview' && <PreviewPanel />}
        {rightTab === 'logs' && <LogsPanel />}
      </div>
    </div>
  );
}
