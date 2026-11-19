import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentMode, RailId, RightTab, RunStatus } from '../types';
import { APPROVAL, CHANGES, TERMINALS } from '../mock/data';
import type { Approval } from '../types';

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
}

interface StudioState {
  rail: RailId;
  setRail: (r: RailId) => void;
  mode: AgentMode;
  setMode: (m: AgentMode) => void;
  model: string;
  setModel: (m: string) => void;
  runStatus: RunStatus;
  setRunStatus: (s: RunStatus) => void;
  rightOpen: boolean;
  setRightOpen: (open: boolean) => void;
  rightTab: RightTab;
  setRightTab: (t: RightTab) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarTab: 'chats' | 'files';
  setSidebarTab: (t: 'chats' | 'files') => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  approval: Approval | null;
  decideApproval: (decision: 'once' | 'always' | 'deny') => void;
  acceptedFiles: Set<string>;
  acceptFile: (path: string, accept: boolean) => void;
  acceptAll: () => void;
  toasts: Toast[];
  pushToast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  terminalId: string;
  setTerminalId: (id: string) => void;
  elapsedSec: number;
  hasKeys: boolean;
  setHasKeys: (has: boolean) => void;
  agentEditor: string | null;
  setAgentEditor: (id: string | null) => void;
}

const StudioContext = createContext<StudioState | null>(null);

let toastSeq = 1;

const RAILS: RailId[] = ['chat', 'agents', 'skills', 'keys', 'evals', 'search', 'docs', 'settings', 'notifications', 'voice'];

function initialRail(): RailId {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return (RAILS as string[]).includes(hash) ? (hash as RailId) : 'chat';
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [rail, setRailState] = useState<RailId>(initialRail);
  const setRail = useCallback((next: RailId) => {
    setRailState(next);
    try {
      window.history.replaceState(null, '', `#/${next}`);
    } catch {
      // No history in exotic embeds; the rail still switches.
    }
  }, []);
  const [mode, setMode] = useState<AgentMode>('agent');
  const [model, setModel] = useState('auto');
  const [runStatus, setRunStatus] = useState<RunStatus>('running');
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightTab>('changes');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'chats' | 'files'>('files');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(APPROVAL);
  const [acceptedFiles, setAcceptedFiles] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [terminalId, setTerminalId] = useState(TERMINALS[0].id);
  const [hasKeys, setHasKeys] = useState(true);
  const [agentEditor, setAgentEditor] = useState<string | null>(null);

  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const id = toastSeq++;
    setToasts(current => [...current.slice(-3), { id, kind, text }]);
    window.setTimeout(() => {
      setToasts(current => current.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(current => current.filter(t => t.id !== id));
  }, []);

  const decideApproval = useCallback((decision: 'once' | 'always' | 'deny') => {
    setApproval(null);
    setRunStatus(decision === 'deny' ? 'idle' : 'running');
    setToasts(current => [
      ...current.slice(-3),
      {
        id: toastSeq++,
        kind: decision === 'deny' ? 'error' : 'ok',
        text: decision === 'once' ? 'Allowed once — resuming' : decision === 'always' ? 'Always allowed for shell_exec' : 'Denied — agent will work around it',
      },
    ]);
  }, []);

  const acceptFile = useCallback((path: string, accept: boolean) => {
    setAcceptedFiles(current => {
      const next = new Set(current);
      if (accept) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const acceptAll = useCallback(() => {
    setAcceptedFiles(new Set(CHANGES.map(c => c.path)));
  }, []);

  const value = useMemo<StudioState>(() => ({
    rail, setRail, mode, setMode, model, setModel, runStatus, setRunStatus,
    rightOpen, setRightOpen, rightTab, setRightTab,
    sidebarOpen, setSidebarOpen, sidebarTab, setSidebarTab,
    paletteOpen, setPaletteOpen, settingsOpen, setSettingsOpen,
    approval, decideApproval, acceptedFiles, acceptFile, acceptAll,
    toasts, pushToast, dismissToast, terminalId, setTerminalId,
    elapsedSec: 147, hasKeys, setHasKeys, agentEditor, setAgentEditor,
  }), [
    rail, mode, model, runStatus, rightOpen, rightTab, sidebarOpen, sidebarTab,
    paletteOpen, settingsOpen, approval, acceptedFiles, toasts, terminalId,
    hasKeys, agentEditor,
    decideApproval, acceptFile, acceptAll, pushToast, dismissToast,
  ]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioState {
  const state = useContext(StudioContext);
  if (!state) throw new Error('useStudio outside StudioProvider');
  return state;
}
