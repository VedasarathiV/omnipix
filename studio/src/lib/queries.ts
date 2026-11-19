import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

// Live data hooks. One hook per dashboard surface; shapes mirror the server
// responses 1:1 so components stay thin.

export interface KeyRow {
  id: number;
  platform: string;
  label: string;
  status: string;
  enabled: number;
  maskedKey?: string;
  last_health_error?: string | null;
}

export function useKeys() {
  return useQuery<KeyRow[]>({ queryKey: ['keys'], queryFn: () => apiFetch('/api/keys') });
}

export interface ModelRow {
  id: number;
  platform: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  supportsVision: boolean;
  monthlyTokenBudget: string | null;
  keyLabel: string | null;
}

export function useModels() {
  return useQuery<ModelRow[]>({
    queryKey: ['models'],
    queryFn: () => apiFetch('/api/models'),
    staleTime: 30_000,
  });
}

export function useUnifiedKey() {
  return useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  });
}

export interface ConversationSummary {
  id: number;
  title: string;
  model: string | null;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export function useConversations() {
  return useQuery<ConversationSummary[]>({
    queryKey: ['conversations'],
    queryFn: () => apiFetch('/api/conversations'),
  });
}

export interface ConversationMessage {
  role: string;
  content: string;
}

export interface Conversation {
  id: number;
  title: string;
  model: string | null;
  systemPrompt: string | null;
  messages: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
}

export function useConversation(id: number | null) {
  return useQuery<Conversation>({
    queryKey: ['conversation', id],
    queryFn: () => apiFetch(`/api/conversations/${id}`),
    enabled: id !== null,
  });
}

export interface AgentStep {
  id: number;
  seq: number;
  kind: string;
  name: string | null;
  label: string | null;
  content: Record<string, unknown>;
  created_at: string;
}

export interface AgentRun {
  id: number;
  goal: string;
  model: string;
  tools: string[];
  skills: string[];
  session_id: number | null;
  status: 'running' | 'done' | 'error' | 'stopped' | 'awaiting_approval';
  final_answer: string | null;
  error: string | null;
  steps_used: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  plan_mode: number;
  created_at: string;
  finished_at: string | null;
  steps: AgentStep[];
}

export function useRuns() {
  return useQuery<{ runs: AgentRun[] }>({
    queryKey: ['agent-runs'],
    queryFn: () => apiFetch('/api/agents/runs'),
    refetchInterval: 3000,
  });
}

export function useRun(id: number | null, live = false) {
  return useQuery<AgentRun>({
    queryKey: ['agent-run', id],
    queryFn: () => apiFetch(`/api/agents/runs/${id}`),
    enabled: id !== null,
    refetchInterval: live ? 2000 : false,
  });
}

export interface ApprovalRow {
  id: number;
  run_id: number;
  seq: number;
  tool: string;
  args_json: string;
  risk: string;
  summary: string;
  status: string;
  created_at: string;
}

export function useApprovals() {
  return useQuery<{ approvals: ApprovalRow[] }>({
    queryKey: ['approvals'],
    queryFn: () => apiFetch('/api/agents/approvals'),
    refetchInterval: 3000,
  });
}

export function useApprovalRules() {
  return useQuery<{ rules: Array<{ tool: string; decision: string }> }>({
    queryKey: ['approval-rules'],
    queryFn: () => apiFetch('/api/agents/approval-rules'),
  });
}

export interface SkillRow {
  name: string;
  description: string;
  enabled: boolean;
  builtin: boolean;
}

export function useSkills() {
  return useQuery<{ skills: SkillRow[] }>({
    queryKey: ['skills'],
    queryFn: () => apiFetch('/api/skills'),
  });
}

export interface McpServerRow {
  id: number;
  name: string;
  transport: string;
  enabled: number;
  tool_count: number | null;
  last_error: string | null;
}

export function useMcpServers() {
  return useQuery<{ servers: McpServerRow[] }>({
    queryKey: ['mcp-servers'],
    queryFn: () => apiFetch('/api/mcp/servers'),
  });
}

export interface EvalSuite {
  id: number;
  name: string;
  description: string;
}

export function useEvalSuites() {
  return useQuery<{ suites: EvalSuite[] }>({
    queryKey: ['eval-suites'],
    queryFn: () => apiFetch('/api/arena/suites'),
  });
}

export interface EvalRunRow {
  id: number;
  suite: string;
  status: string;
  created_at: string;
  results: Array<{ model: string; passed: number; total: number }>;
}

export function useEvalRuns() {
  return useQuery<{ evals: EvalRunRow[] }>({
    queryKey: ['eval-runs'],
    queryFn: () => apiFetch('/api/arena/evals'),
  });
}

export interface MemoryRow {
  id: number;
  scope: string;
  key: string;
  value: string;
  importance: number;
}

export function useMemories() {
  return useQuery<{ memories: MemoryRow[] }>({
    queryKey: ['memories'],
    queryFn: () => apiFetch('/api/memories'),
  });
}

export interface DocRow {
  project_key: string;
  source_url: string;
  title: string;
  chunks: number;
  updated_at: string;
}

export function useDocs() {
  return useQuery<{ docs: DocRow[] }>({
    queryKey: ['docs'],
    queryFn: () => apiFetch('/api/memories/docs'),
  });
}

export interface AutomationRow {
  id: number;
  name: string;
  goal: string;
  schedule: string | null;
  enabled: number;
  reviewed: number;
  last_status: string | null;
}

export function useAutomations() {
  return useQuery<{ automations: AutomationRow[] }>({
    queryKey: ['automations'],
    queryFn: () => apiFetch('/api/automations'),
  });
}

export interface NotificationRow {
  id: number;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  read: number;
}

export function useNotifications() {
  return useQuery<{ notifications: NotificationRow[]; unread: number }>({
    queryKey: ['notifications'],
    queryFn: () => apiFetch('/api/notifications'),
    refetchInterval: 5000,
  });
}

export interface VoiceSettings {
  ttsModel: string;
  ttsVoice: string;
  sttModel: string;
  autoSpeakChat: boolean;
  autoSpeakRuns: boolean;
}

export function useVoiceSettings() {
  return useQuery<VoiceSettings>({
    queryKey: ['voice-settings'],
    queryFn: () => apiFetch('/api/settings/voice'),
  });
}

export interface MediaRow {
  id: number;
  platform: string;
  modelId: string;
  displayName: string;
  modality: string;
  enabled: number;
}

export function useMedia() {
  return useQuery<{ models: MediaRow[] }>({
    queryKey: ['media'],
    queryFn: () => apiFetch('/api/media'),
  });
}

export interface ProxySettings {
  proxyUrl: string;
  proxyMode: 'forward' | 'fetch-relay';
  fetchRelayTokenConfigured: boolean;
  enabled: boolean;
  bypassPlatforms: string[];
  active: boolean;
}

export function useProxySettings() {
  return useQuery<ProxySettings>({
    queryKey: ['proxy-settings'],
    queryFn: () => apiFetch('/api/settings/proxy'),
  });
}

export interface WebhookRow {
  id: number;
  name: string;
  url: string;
  events: string[];
  hasSecret: boolean;
  enabled: number;
  last_status: number | null;
  last_error: string | null;
}

export function useWebhooks() {
  return useQuery<{ webhooks: WebhookRow[] }>({
    queryKey: ['webhooks'],
    queryFn: () => apiFetch('/api/webhooks'),
  });
}

export interface GroupRow {
  id: number;
  goal: string;
  status: string;
  task_count: number;
  done_count: number;
}

export function useGroups() {
  return useQuery<{ groups: GroupRow[] }>({
    queryKey: ['agent-groups'],
    queryFn: () => apiFetch('/api/agents/groups'),
    refetchInterval: 3000,
  });
}

export interface WorkspaceEntry {
  path: string;
  kind: 'file' | 'dir';
  size?: number;
}

export function useRunFiles(runId: number | null) {
  return useQuery<{ files: WorkspaceEntry[] }>({
    queryKey: ['run-files', runId],
    queryFn: () => apiFetch(`/api/agents/runs/${runId}/files`),
    enabled: runId !== null,
  });
}

export interface DiffLine {
  kind: 'context' | 'add' | 'del';
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface DiffFile {
  path: string;
  status: 'M' | 'A' | 'D';
  added: number;
  removed: number;
  hunks: Array<{ header: string; lines: DiffLine[] }>;
  truncated: boolean;
}

export interface RunDiff {
  against: { checkpointId: number; label: string } | null;
  files: DiffFile[];
  truncated: boolean;
}

export function useRunDiff(runId: number | null, against: number | null) {
  return useQuery<RunDiff>({
    queryKey: ['run-diff', runId, against],
    queryFn: () => apiFetch(`/api/agents/runs/${runId}/diff${against !== null ? `?against=${against}` : ''}`),
    enabled: runId !== null,
  });
}

export interface CheckpointRow {
  id: number;
  run_id: number;
  seq: number;
  label: string;
  created_at: string;
}

export function useCheckpoints(runId: number | null) {
  return useQuery<{ checkpoints: CheckpointRow[] }>({
    queryKey: ['checkpoints', runId],
    queryFn: () => apiFetch(`/api/agents/runs/${runId}/checkpoints`),
    enabled: runId !== null,
  });
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  files: Array<{ path: string; status: 'M' | 'A' | 'D' | 'U' }>;
}

export function useGitStatus(runId: number | null) {
  return useQuery<GitStatus>({
    queryKey: ['git-status', runId],
    queryFn: () => apiFetch(`/api/agents/runs/${runId}/git/status`),
    enabled: runId !== null,
  });
}

export interface LogEntry {
  id: number;
  ts: string;
  level: string;
  source?: string;
  message: string;
}

export function useLogs() {
  return useQuery<{ entries: LogEntry[] }>({
    queryKey: ['logs'],
    queryFn: () => apiFetch('/api/logs?limit=100'),
    refetchInterval: 5000,
  });
}
