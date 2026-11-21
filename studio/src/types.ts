// Shared domain types for the studio workspace UI. Shapes mirror the live
// OmniPix API responses; see lib/queries.ts for the fetch layer.

export type AgentMode = 'ask' | 'plan' | 'agent' | 'image' | 'video' | 'audio';
export type RunStatus = 'idle' | 'thinking' | 'running' | 'waiting' | 'done' | 'failed';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed';
export type StepKind =
  | 'read'
  | 'search'
  | 'edit'
  | 'create'
  | 'delete'
  | 'command'
  | 'websearch'
  | 'subagent'
  | 'thinking';

export interface PlanStep {
  id: string;
  label: string;
  status: StepStatus;
}

export interface TimelineStep {
  id: string;
  kind: StepKind;
  title: string;
  detail?: string;
  status: StepStatus;
  durationMs?: number;
  exitCode?: number;
  added?: number;
  removed?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: string;
  model?: string;
  media?: Array<{ kind: 'image' | 'video' | 'audio'; url: string }>;
}

export interface Approval {
  id: string;
  kind: 'command' | 'delete' | 'network';
  command: string;
  cwd: string;
  risk: 'low' | 'medium' | 'high';
}

export interface FileChange {
  path: string;
  status: 'M' | 'A' | 'D' | 'U';
  added: number;
  removed: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  id?: string;
  header: string;
  lines: DiffLine[];
  accepted?: boolean;
}

export interface DiffLine {
  kind: 'context' | 'add' | 'del';
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface FileNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  status?: 'M' | 'A' | 'D' | 'U';
  children?: FileNode[];
}

export interface TerminalSession {
  id: string;
  title: string;
  lines: TerminalLine[];
  running: boolean;
}

export interface TerminalLine {
  kind: 'cmd' | 'out' | 'err';
  text: string;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  branch: string;
  dirty: number;
}

export interface AgentDef {
  id: string;
  name: string;
  model: string;
  tools: string[];
  systemPrompt: string;
  status: 'idle' | 'running';
  runs: number;
}

export interface ProviderDef {
  id: string;
  name: string;
  status: 'ok' | 'down' | 'none';
  freeTier: boolean;
  models: number;
  latencyMs?: number;
}

export interface EvalRun {
  id: string;
  suite: string;
  passRate: number;
  passed: number;
  total: number;
  ts: string;
  model: string;
}

export interface Notice {
  id: string;
  kind: 'run' | 'approval' | 'error' | 'info';
  title: string;
  body: string;
  ts: string;
  read: boolean;
}

export type RightTab = 'changes' | 'files' | 'terminal' | 'preview' | 'logs';
export type RailId =
  | 'chat'
  | 'agents'
  | 'skills'
  | 'keys'
  | 'models'
  | 'evals'
  | 'search'
  | 'docs'
  | 'settings'
  | 'notifications'
  | 'voice';
