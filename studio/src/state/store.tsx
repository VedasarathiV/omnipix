import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
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
  welcomeOpen: boolean;
  setWelcomeOpen: (open: boolean) => void;
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
  /** Message-edit draft: replaces (not appends) the input box content. */
  editDraft: { text: string; seq: number } | null;
  setEditDraft: (d: { text: string; seq: number } | null) => void;
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;
  /** Host folder root for browsing real source; null means run workspace. */
  fileRoot: string | null;
  setFileRoot: (root: string | null) => void;
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
  // The location hash mirrors rail+chat+run so reloads and links reopen the
  // same view. Refs mirror the state so sequential setter calls in one
  // handler (e.g. clear chat AND run) each see the latest values.
  const railRef = useRef<RailId>(rail);
  const initialParts = useRef(hashParts());
  const chatRef = useRef<number | null>(initialParts.current.conversationId);
  const runRef = useRef<number | null>(initialParts.current.runId);
  const fileRef = useRef<string | null>(initialParts.current.file);
  const writeHash = useCallback(() => {
    try {
      const params = new URLSearchParams();
      if (runRef.current !== null) params.set('run', String(runRef.current));
      if (chatRef.current !== null) params.set('chat', String(chatRef.current));
      if (fileRef.current) params.set('file', fileRef.current);
      const q = params.toString();
      window.history.replaceState(null, '', `#/${railRef.current}${q ? `?${q}` : ''}`);
    } catch {
      // No history in exotic embeds; the state still switches.
    }
  }, []);
  const setRail = useCallback((next: RailId) => {
    railRef.current = next;
    setRailState(next);
    writeHash();
  }, [writeHash]);
  const [mode, setMode] = useState<AgentMode>('agent');
  const [model, setModelState] = useState(() => {
    try {
      return window.localStorage.getItem('studio.model') || 'auto';
    } catch {
      return 'auto';
    }
  });
  const setModel = useCallback((next: string) => {
    setModelState(next);
    try {
      window.localStorage.setItem('studio.model', next);
    } catch {
      // Private mode: preference just doesn't persist.
    }
  }, []);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightTab>('changes');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'chats' | 'files'>('chats');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [acceptedFiles, setAcceptedFiles] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [agentEditor, setAgentEditor] = useState<string | null>(null);
  const [conversationId, setConversationIdState] = useState<number | null>(() => hashParts().conversationId);
  const [activeRunId, setActiveRunIdState] = useState<number | null>(() => hashParts().runId);
  const setConversationId = useCallback((id: number | null) => {
    chatRef.current = id;
    setConversationIdState(id);
    writeHash();
  }, [writeHash]);
  const setActiveRunId = useCallback((id: number | null) => {
    runRef.current = id;
    setActiveRunIdState(id);
    writeHash();
  }, [writeHash]);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [dictation, setDictation] = useState<{ text: string; seq: number } | null>(null);
  const [editDraft, setEditDraft] = useState<{ text: string; seq: number } | null>(null);
  const [selectedFile, setSelectedFileState] = useState<string | null>(() => hashParts().file);
  const setSelectedFile = useCallback((path: string | null) => {
    fileRef.current = path;
    setSelectedFileState(path);
    writeHash();
  }, [writeHash]);
  // Session-only on purpose: a persisted root plus a run-linked hash file
  // would open the wrong backend on boot. Folder browsing is explicit.
  const [fileRoot, setFileRoot] = useState<string | null>(null);

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
    paletteOpen, setPaletteOpen, settingsOpen, setSettingsOpen, welcomeOpen, setWelcomeOpen,
    acceptedFiles, acceptFile, acceptAll,
    toasts, pushToast, dismissToast,
    agentEditor, setAgentEditor,
    conversationId, setConversationId, activeRunId, setActiveRunId,
    streamingReply, setStreamingReply, dictation, setDictation,
    editDraft, setEditDraft,
    selectedFile, setSelectedFile,
    fileRoot, setFileRoot,
  }), [
    rail, mode, model, rightOpen, rightTab, sidebarOpen, sidebarTab,
    paletteOpen, settingsOpen, welcomeOpen, acceptedFiles, toasts,
    agentEditor, conversationId, activeRunId, streamingReply, dictation, editDraft, selectedFile, fileRoot,
    acceptFile, acceptAll, pushToast, dismissToast,
  ]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioState {
  const state = useContext(StudioContext);
  if (!state) throw new Error('useStudio outside StudioProvider');
  return state;
}
