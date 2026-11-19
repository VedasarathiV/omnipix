import type { SkillRow } from './agent-runtime.js';

// Skill files (gap 9): portable SKILL.md with YAML-ish frontmatter, so
// skills move between installs (and to/from version control) as files:
//
//   ---
//   name: planner
//   description: Plans before acting.
//   ---
//   <instructions…>
//
// The parser is deliberately strict: a skill file that doesn't round-trip
// byte-for-byte meaning is rejected rather than guessed at.

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface ParsedSkill {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  bundle?: string[];
}

export function serializeSkill(skill: Pick<SkillRow, 'name' | 'description' | 'instructions' | 'enabled' | 'bundle'>): string {
  const enabled = skill.enabled ? '' : 'enabled: false\n';
  const bundle = skill.bundle?.length ? `bundle: ${skill.bundle.join(', ')}\n` : '';
  return `---\nname: ${skill.name}\ndescription: ${skill.description.trim()}\n${enabled}${bundle}---\n${skill.instructions.trim()}\n`;
}

function unquote(value: string): string {
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value.trim());
  return quoted ? quoted[2] : value.trim();
}

/** Parse SKILL.md content. Throws on anything malformed. */
export function parseSkillFile(content: string): ParsedSkill {
  const text = content.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) {
    throw new Error('skill file must start with a --- frontmatter fence');
  }
  const end = text.indexOf('\n---', 4);
  if (end === -1) {
    throw new Error('skill file frontmatter is missing its closing ---');
  }
  const front = text.slice(4, end);
  const instructions = text.slice(end + 4).replace(/^\n/, '').trim();
  const fields = new Map<string, string>();
  for (const line of front.split('\n')) {
    if (!line.trim()) continue;
    const sep = line.indexOf(':');
    if (sep === -1) throw new Error(`bad frontmatter line: ${line.trim().slice(0, 60)}`);
    fields.set(line.slice(0, sep).trim().toLowerCase(), unquote(line.slice(sep + 1)));
  }
  const name = fields.get('name') ?? '';
  const description = fields.get('description') ?? '';
  if (!NAME_RE.test(name)) {
    throw new Error('skill file needs a valid name (lowercase letters, numbers, dashes)');
  }
  if (!description) {
    throw new Error('skill file needs a description');
  }
  if (!instructions) {
    throw new Error('skill file needs instructions after the frontmatter');
  }
  if (description.length > 500) throw new Error('skill description must be at most 500 characters');
  if (instructions.length > 20000) throw new Error('skill instructions must be at most 20000 characters');
  const enabledRaw = fields.get('enabled');
  if (enabledRaw !== undefined && enabledRaw !== 'true' && enabledRaw !== 'false') {
    throw new Error('skill enabled must be true or false');
  }
  let bundle: string[] | undefined;
  const bundleRaw = fields.get('bundle');
  if (bundleRaw !== undefined) {
    bundle = [...new Set(bundleRaw.split(',').map(m => m.trim()).filter(Boolean))];
    if (!bundle.length || bundle.length > 8 || bundle.some(m => !NAME_RE.test(m))) {
      throw new Error('skill bundle must list 1..8 valid skill names');
    }
  }
  return { name, description, instructions, enabled: enabledRaw !== 'false', bundle };
}
