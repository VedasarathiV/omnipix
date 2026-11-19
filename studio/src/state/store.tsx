import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentMode, RailId, RightTab } from '../types';


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
  acceptedFiles: Set<string>;
  acceptFile: (path: string, accept: boolean) => void;
  acceptAll: (paths: string[]) => void;
  toasts: Toast[];
  pushToast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  agentEditor: string | null;
  setAgentEditor: (id: string | null) => void;
  conversationId: number | null;
  setConversationId: (id: number | null) => void;
  activeRunId: number | null;
  setActiveRunId: (id: number | null) => void;
  streamingReply: string | null;
  setStreamingReply: (text: string | null) => void;
  dictation: { text: string; seq: number } | null;
  setDictation: (d: { text: string; seq: number } | null) => void;
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;
}

const StudioContext = createContext<StudioState | null>(null);

let toastSeq = 1;

const RAILS: RailId[] = ['chat', 'agents', 'skills', 'keys', 'models', 'evals', 'search', 'docs', 'settings', 'notifications', 'voice'];

function hashParts(): { rail: RailId; runId: number | null; conversationId: number | null; file: string | null } {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query ?? '');
  const runId = Number(params.get('run'));
  const conversationId = Number(params.get('chat'));
  const file = params.get('file');
  return {
    rail: (RAILS as string[]).includes(path) ? (path as RailId) : 'chat',
    runId: Number.isInteger(runId) && runId > 0 ? runId : null,
    conversationId: Number.isInteger(conversationId) && conversationId > 0 ? conversationId : null,
    file: file && !file.includes('..') ? file : null,
  };
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [rail, setRailState] = useState<RailId>(() => hashParts().rail);
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
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightTab>('changes');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'chats' | 'files'>('chats');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [acceptedFiles, setAcceptedFiles] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [agentEditor, setAgentEditor] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(() => hashParts().conversationId);
  const [activeRunId, setActiveRunId] = useState<number | null>(() => hashParts().runId);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [dictation, setDictation] = useState<{ text: string; seq: number } | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(() => hashParts().file);

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

  const acceptFile = useCallback((path: string, accept: boolean) => {
    setAcceptedFiles(current => {
      const next = new Set(current);
      if (accept) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const acceptAll = useCallback((paths: string[]) => {
    setAcceptedFiles(new Set(paths));
  }, []);

  const value = useMemo<StudioState>(() => ({
    rail, setRail, mode, setMode, model, setModel,
    rightOpen, setRightOpen, rightTab, setRightTab,
    sidebarOpen, setSidebarOpen, sidebarTab, setSidebarTab,
    paletteOpen, setPaletteOpen, settingsOpen, setSettingsOpen,
    acceptedFiles, acceptFile, acceptAll,
    toasts, pushToast, dismissToast,
    agentEditor, setAgentEditor,
    conversationId, setConversationId, activeRunId, setActiveRunId,
    streamingReply, setStreamingReply, dictation, setDictation,
    selectedFile, setSelectedFile,
  }), [
    rail, mode, model, rightOpen, rightTab, sidebarOpen, sidebarTab,
    paletteOpen, settingsOpen, acceptedFiles, toasts,
    agentEditor, conversationId, activeRunId, streamingReply, dictation, selectedFile,
    acceptFile, acceptAll, pushToast, dismissToast,
  ]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioState {
  const state = useContext(StudioContext);
  if (!state) throw new Error('useStudio outside StudioProvider');
  return state;
}
