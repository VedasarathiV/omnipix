import { FileDiff, PanelBottomClose, Play, ScrollText, SquareTerminal, X } from 'lucide-react';
import type { PanelTab } from '../types';
import { ChangesPanel } from './ChangesPanel';
import { FileViewer } from './FileViewer';
import { LogsPanel, PreviewPanel, TerminalPanel } from './TerminalPreview';
import { useStudio } from '../state/store';
import { useRunDiff } from '../lib/queries';

const TABS: Array<{ id: PanelTab; label: string; icon: typeof FileDiff }> = [
  { id: 'changes', label: 'Changes', icon: FileDiff },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'preview', label: 'Preview', icon: Play },
  { id: 'logs', label: 'Logs', icon: ScrollText },
];

export function BottomPanel() {
  const { panelTab, setPanelTab, setPanelOpen, activeRunId } = useStudio();
  const { data: diff } = useRunDiff(activeRunId, null);
  const changeCount = diff?.files.length ?? 0;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-line p-1.5" role="tablist" aria-label="Panel">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={panelTab === tab.id}
            title={tab.label}
            onClick={() => setPanelTab(tab.id)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              panelTab === tab.id ? 'bg-base-2 font-medium text-ink' : 'text-ink-dim hover:text-ink'
            }`}
          >
            <tab.icon className="size-3.5" strokeWidth={1.5} />
            <span>{tab.label}</span>
            {tab.id === 'changes' && changeCount > 0 && (
              <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-base-0">{changeCount}</span>
            )}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          title="Collapse panel"
          aria-label="Collapse panel"
          onClick={() => setPanelOpen(false)}
          className="rounded-md p-1.5 text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <PanelBottomClose className="size-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {panelTab === 'changes' && <ChangesPanel />}
        {panelTab === 'terminal' && <TerminalPanel />}
        {panelTab === 'preview' && <PreviewPanel />}
        {panelTab === 'logs' && <LogsPanel />}
      </div>
    </div>
  );
}

/** File viewer as an overlay: files live in the left sidebar only, and opening
 *  one pops the viewer over the workspace instead of a side tab. */
export function FileModal() {
  const { fileViewerOpen, setFileViewerOpen, selectedFile, setSelectedFile } = useStudio();
  if (!fileViewerOpen || !selectedFile) return null;
  function close() {
    setFileViewerOpen(false);
    setSelectedFile(null);
  }
  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-6"
      onClick={close}
      role="dialog"
      aria-label={`Viewing ${selectedFile}`}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-base-1 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate font-mono text-xs">{selectedFile}</p>
          <button
            type="button"
            onClick={close}
            aria-label="Close file viewer"
            className="rounded-md p-1.5 text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FileViewer />
        </div>
      </div>
    </div>
  );
}
