import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { defaultConfigDirs } from './skills-sync.js';

// File-defined agent presets (opencode parity M2): markdown files at
// <config>/{agent,agents}/**/*.md name a reusable run preset (skills,
// tools, model, planMode). Explicit request fields always win over the
// preset; unknown agent names fail the request like unknown skills.

const AGENT_DIRS = ['agent', 'agents'];
const MAX_DEPTH = 6;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const NAME_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

export interface FileAgent {
  name: string;
  description: string;
  skills?: string[];
  tools?: string[];
  model?: string;
  planMode?: boolean;
  /** Free-form preset notes; informational only, never executed. */
  notes?: string;
  path: string;
}

function unquote(value: string): string {
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value.trim());
  return quoted ? quoted[2] : value.trim();
}

function wordList(raw: string | undefined, field: string, path: string, max: number): string[] | undefined {
  if (raw === undefined || !raw.trim()) return undefined;
  const items = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];
  if (!items.length || items.length > max) {
    throw new Error(`agent ${field} must list 1..${max} names: ${path}`);
  }
  return items;
}

/** Parse one agent file. Throws on anything malformed. */
export function parseAgentFile(content: string, path = '<inline>'): Omit<FileAgent, 'name' | 'path'> {
  const text = content.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) throw new Error(`agent file must start with a --- frontmatter fence: ${path}`);
  const end = text.indexOf('\n---', 4);
  if (end === -1) throw new Error(`agent file frontmatter is missing its closing ---: ${path}`);
  const front = text.slice(4, end);
  const notes = text.slice(end + 4).replace(/^\n/, '').trim();
  const fields = new Map<string, string>();
  for (const line of front.split('\n')) {
    if (!line.trim() || /^\s/.test(line) || line.trimStart().startsWith('- ')) continue;
    const sepIdx = line.indexOf(':');
    if (sepIdx === -1) throw new Error(`bad frontmatter line in ${path}: ${line.trim().slice(0, 60)}`);
    fields.set(line.slice(0, sepIdx).trim().toLowerCase(), unquote(line.slice(sepIdx + 1)));
  }
  const description = fields.get('description') ?? '';
  if (!description) throw new Error(`agent file needs a description: ${path}`);
  if (description.length > 1024) throw new Error(`agent description must be at most 1024 characters: ${path}`);
  const skills = wordList(fields.get('skills'), 'skills', path, 10);
  const tools = wordList(fields.get('tools'), 'tools', path, 32);
  const model = fields.get('model') || undefined;
  if (model !== undefined && (model.length < 1 || model.length > 200)) {
    throw new Error(`agent model must be 1..200 characters: ${path}`);
  }
  const planRaw = fields.get('planmode');
  if (planRaw !== undefined && planRaw !== 'true' && planRaw !== 'false') {
    throw new Error(`agent planMode must be true or false: ${path}`);
  }
  return {
    description,
    skills,
    tools,
    model,
    planMode: planRaw === undefined ? undefined : planRaw === 'true',
    notes: notes || undefined,
  };
}

/** Collect agent files; name = path minus the agent dir and .md. */
export function scanAgentFiles(configDirs: string[]): FileAgent[] {
  const out: FileAgent[] = [];
  const walk = (dir: string, depth: number, root: string): void => {
    if (depth > MAX_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (!SKIP_DIRS.has(entry)) walk(full, depth + 1, root);
        continue;
      }
      if (!entry.endsWith('.md')) continue;
      const name = relative(root, full).split(sep).join('/').replace(/\.md$/, '');
      if (!NAME_RE.test(name)) continue;
      try {
        out.push({ name, path: full, ...parseAgentFile(readFileSync(full, 'utf8'), full) });
      } catch {
        continue;
      }
    }
  };
  for (const configDir of configDirs) {
    for (const sub of AGENT_DIRS) {
      walk(join(resolve(configDir), sub), 0, join(resolve(configDir), sub));
    }
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/** Resolve a preset by name. Later config dirs win clashes. Null when unknown. */
export function resolveFileAgent(name: string, configDirs: string[] = defaultConfigDirs()): FileAgent | null {
  if (!NAME_RE.test(name)) return null;
  let found: FileAgent | null = null;
  for (const agent of scanAgentFiles(configDirs)) {
    if (agent.name === name) found = agent;
  }
  return found;
}

export interface AgentPreset {
  skills?: string[];
  tools?: string[];
  model?: string;
  planMode?: boolean;
}

/**
 * Merge a preset under explicit request fields: explicit skills/tools
 * replace the preset's lists, explicit model/planMode win when set.
 */
export function applyAgentPreset(
  preset: AgentPreset,
  explicit: { skills?: string[]; tools?: string[]; model?: string; planMode?: boolean },
): AgentPreset {
  return {
    skills: explicit.skills ?? preset.skills,
    tools: explicit.tools ?? preset.tools,
    model: explicit.model ?? preset.model,
    planMode: explicit.planMode ?? preset.planMode,
  };
}
