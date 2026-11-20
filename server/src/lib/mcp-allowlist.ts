// MCP stdio command allowlist (SEC-05). Pure by design (see
// module-purity.test.ts): matching over caller-supplied lists only, no DB.

export const MCP_ALLOWED_COMMANDS_SETTING = 'mcp_allowed_commands';

/** Runtimes most MCP servers ship as. Used only when the operator has
 *  never saved a list; an explicitly saved list (even empty) always wins. */
export const DEFAULT_MCP_COMMANDS: readonly string[] = ['npx', 'node', 'python3', 'python', 'uvx'];

/** Parse the stored setting: null = unset/corrupt (caller falls back). */
export function parseMcpAllowlist(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);
  } catch {
    return null;
  }
}

/**
 * True when the command equals an entry or its basename does
 * (`/usr/local/bin/python3` matches `python3`). Case-sensitive: binary
 * names are. An empty list denies everything (fail closed).
 */
export function isMcpCommandAllowed(command: string, allowlist: readonly string[]): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  const base = cmd.split(/[/\\]/).pop() ?? cmd;
  return allowlist.some(entry => entry === cmd || entry === base);
}
