import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { defaultConfigDirs } from './skills-sync.js';

// File-defined slash commands: markdown files at
// <config>/{command,commands}/**/*.md expand a leading `/name args` into
// prompt text. Deliberately smaller than opencode: no `!shell` auto-exec
// (the agent already has shell_exec behind approvals) and no session
// agent-switching (a command names a file agent preset instead, and the
// delegate tool covers subagents).

const COMMAND_DIRS = ['command', 'commands'];
const MAX_DEPTH = 6;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

export interface FileCommand {
  /** Path-derived name, e.g. `review` or `deploy/staging`. */
  name: string;
  description: string;
  /** File-agent preset to apply, when the frontmatter names one. */
  agent?: string;
  model?: string;
  template: string;
  path: string;
}

function unquote(value: string): string {
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value.trim());
  return quoted ? quoted[2] : value.trim();
}

function splitFrontmatter(content: string): { front: string; body: string } {
  const text = content.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) throw new Error('command file must start with a --- frontmatter fence');
  const end = text.indexOf('\n---', 4);
  if (end === -1) throw new Error('command file frontmatter is missing its closing ---');
  return { front: text.slice(4, end), body: text.slice(end + 4).replace(/^\n/, '').trim() };
}

/** Parse one command file. Throws on anything malformed. */
export function parseCommandFile(content: string, path = '<inline>'): Omit<FileCommand, 'name' | 'path'> & { name?: string } {
  const { front, body } = splitFrontmatter(content);
  const fields = new Map<string, string>();
  for (const line of front.split('\n')) {
    if (!line.trim() || /^\s/.test(line) || line.trimStart().startsWith('- ')) continue;
    const sepIdx = line.indexOf(':');
    if (sepIdx === -1) throw new Error(`bad frontmatter line in ${path}: ${line.trim().slice(0, 60)}`);
    fields.set(line.slice(0, sepIdx).trim().toLowerCase(), unquote(line.slice(sepIdx + 1)));
  }
  const description = fields.get('description') ?? '';
  if (!description) throw new Error(`command file needs a description: ${path}`);
  if (description.length > 1024) throw new Error(`command description must be at most 1024 characters: ${path}`);
  if (!body) throw new Error(`command file needs a template after the frontmatter: ${path}`);
  if (body.length > 131072) throw new Error(`command template must be at most 128KB: ${path}`);
  const agent = fields.get('agent') || undefined;
  if (agent !== undefined && !/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(agent)) {
    throw new Error(`command agent must be a valid command/agent name: ${path}`);
  }
  const model = fields.get('model') || undefined;
  if (model !== undefined && (model.length < 1 || model.length > 200)) {
    throw new Error(`command model must be 1..200 characters: ${path}`);
  }
  return { description, agent, model, template: body };
}

/** Collect command files; name = path minus the command dir and .md. */
export function scanCommandFiles(configDirs: string[]): FileCommand[] {
  const out: FileCommand[] = [];
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
      const rel = relative(root, full).split(sep).join('/');
      const name = rel.replace(/\.md$/, '');
      let parsed;
      try {
        parsed = parseCommandFile(readFileSync(full, 'utf8'), full);
      } catch {
        continue;
      }
      out.push({ name, path: full, ...parsed });
    }
  };
  for (const configDir of configDirs) {
    for (const sub of COMMAND_DIRS) {
      const root = join(resolve(configDir), sub);
      walk(root, 0, root);
    }
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

const ARG_RE = /\$ARGUMENTS|\$(\d+)/g;
const PLACEHOLDER_RE = /\$(\d+)/g;

/**
 * Expand a command template with the invocation input (opencode rules):
 * $N takes the Nth word (the last placeholder greedily takes the rest),
 * $ARGUMENTS takes the whole input, and input with no placeholders at
 * all appends. Pure — tested.
 */
export function expandCommandTemplate(template: string, input: string): string {
  const args = input.trim() ? input.trim().split(/\s+/) : [];
  const placeholders = [...template.matchAll(PLACEHOLDER_RE)].map(m => Number(m[1]));
  const last = placeholders.length ? Math.max(...placeholders) : 0;
  const expanded = template.replace(ARG_RE, (match, index: string | undefined) => {
    if (match === '$ARGUMENTS') return input.trim();
    const position = Number(index);
    if (position < 1 || position > args.length) return '';
    if (position === last) return args.slice(position - 1).join(' ');
    return args[position - 1];
  });
  if (!placeholders.length && !template.includes('$ARGUMENTS') && input.trim()) {
    return `${expanded}\n\n${input.trim()}`.trim();
  }
  return expanded.trim();
}

/** Serialize a command definition to its markdown file form. */
export function serializeCommandFile(cmd: { description: string; agent?: string; model?: string; template: string }): string {
  const agent = cmd.agent ? `agent: ${cmd.agent}\n` : '';
  const model = cmd.model ? `model: ${cmd.model}\n` : '';
  return `---\ndescription: ${cmd.description.trim()}\n${agent}${model}---\n${cmd.template.trim()}\n`;
}

/** Leading `/name[/sub] args` invocation (multi-segment names allowed). */
const COMMAND_RE = /^\/([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)(?=[ \t]+|$)/;

export function parseCommandInvocation(goal: string): { name: string; input: string } | null {
  const match = COMMAND_RE.exec(goal.trimStart());
  if (!match) return null;
  return { name: match[1], input: goal.trimStart().slice(match[0].length).trimStart() };
}

export interface ResolvedCommand {
  goal: string;
  agent?: string;
  model?: string;
  command: string;
}

/**
 * Expand a leading /command in the goal. Returns null when the text is
 * not a command invocation or no command file matches (the caller falls
 * through to /skill parsing). Later config dirs win name clashes.
 */
export function expandFileCommand(goal: string, configDirs: string[] = defaultConfigDirs()): ResolvedCommand | null {
  const invocation = parseCommandInvocation(goal);
  if (!invocation) return null;
  const byName = new Map<string, FileCommand>();
  for (const cmd of scanCommandFiles(configDirs)) byName.set(cmd.name, cmd);
  const cmd = byName.get(invocation.name);
  if (!cmd) return null;
  return {
    goal: expandCommandTemplate(cmd.template, invocation.input),
    agent: cmd.agent,
    model: cmd.model,
    command: cmd.name,
  };
}
