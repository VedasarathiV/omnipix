// One-click coding-agent setup from the desktop app. The renderer picks a
// catalog entry; the desktop process owns credentials, destination paths,
// and terminal commands.
export const terminalAgents = ['codex', 'goose', 'kilo', 'crush', 'mimo'] as const;
export type TerminalAgent = typeof terminalAgents[number];
export function isTerminalAgent(id: string): id is TerminalAgent {
  return (terminalAgents as readonly string[]).includes(id);
}

export interface SetupFile { path: string; changed?: boolean; backupPath?: string }
export type SetupError = 'gateway' | 'catalog' | 'permission' | 'config' | 'missing' | 'terminal';
export type SetupResult = { ok: true; files: SetupFile[] } | { ok: false; error: SetupError };
export interface AgentSetupBridge {
  details(id: string): Promise<SetupResult>;
  connect(id: string): Promise<SetupResult>;
  launch(id: string): Promise<SetupResult>;
}
