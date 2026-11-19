// Slash invocation for chat: a message starting with /names resolves those
// skills and injects their instructions as system context. Mirrors the
// server's parseSlashSkills exactly (same regex, same edge rules) so chat
// and agent runs agree on what a slash means.

const SLASH_RE = /^((?:\/[a-z0-9][a-z0-9-]*)(?:[ \t]+\/[a-z0-9][a-z0-9-]*)*)(?=[ \t]+|$)/

export interface SlashCommand {
  names: string[]
  rest: string
}

/** Leading /names plus the remaining text. Null when no slash opens the message. */
export function parseSlashCommand(text: string): SlashCommand | null {
  const match = SLASH_RE.exec(text.trimStart())
  if (!match) return null
  const names = [...new Set(match[1].split(/[ \t]+/).map(t => t.slice(1)))]
  return { names, rest: text.trimStart().slice(match[0].length).trimStart() }
}

export interface SlashSkill {
  name: string
  instructions: string
  enabled: number
}

/** Render invoked skills as the system context the send path injects. */
export function slashSkillsMessage(skills: SlashSkill[]): string {
  const blocks = skills.map(s => `## ${s.name}\n${s.instructions}`)
  return `Invoked skills (follow these instructions for this message):\n${blocks.join('\n\n')}`
}
