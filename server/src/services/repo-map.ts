import fs from 'node:fs';
import path from 'node:path';
import { runWorkspace } from '../lib/workspace.js';
import { listRootFiles } from './run-workspace.js';

// Repo map (aider-style): a compact "symbols per file" sketch of the run's
// workspace, injected into the agent's system prompt so it navigates by
// structure instead of blind grep. Pure regex extraction — no parser
// dependency, no embeddings, milliseconds per build.
//
// Budgets keep one huge monorepo from eating the context window: capped
// files, capped symbols per file, capped total chars. Whatever doesn't fit
// is counted, never silently dropped without a marker.

export const REPO_MAP_MAX_FILES = 150;
export const REPO_MAP_MAX_SYMBOLS_PER_FILE = 40;
export const REPO_MAP_MAX_CHARS = 12_000;
export const REPO_MAP_MAX_FILE_BYTES = 100 * 1024;

interface SymbolPattern {
  kind: string;
  re: RegExp;
  nameGroup: number;
}

const SCRIPT_PATTERNS: SymbolPattern[] = [
  { kind: 'class', re: /^\s*(?:export\s+)?(?:default\s+)?class\s+([\w$]+)/, nameGroup: 1 },
  { kind: 'function', re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([\w$]+)/, nameGroup: 1 },
  { kind: 'function', re: /^\s*(?:export\s+)?const\s+([\w$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/, nameGroup: 1 },
  { kind: 'function', re: /^\s*(?:export\s+)?const\s+([\w$]+)\s*=\s*[\w$]+\s*=>/, nameGroup: 1 },
  { kind: 'type', re: /^\s*(?:export\s+)?(?:interface|type)\s+([\w$]+)/, nameGroup: 1 },
];

const FAMILY_PATTERNS: Record<string, SymbolPattern[]> = {
  script: SCRIPT_PATTERNS,
  python: [
    { kind: 'class', re: /^\s*class\s+(\w+)/, nameGroup: 1 },
    { kind: 'function', re: /^\s*(?:async\s+)?def\s+(\w+)/, nameGroup: 1 },
  ],
  go: [
    { kind: 'function', re: /^func\s+(?:\([^)]*\)\s*)?(\w+)/, nameGroup: 1 },
    { kind: 'type', re: /^type\s+(\w+)\s+(?:struct|interface)/, nameGroup: 1 },
  ],
  rust: [
    { kind: 'function', re: /^(?:pub\s+)?fn\s+(\w+)/, nameGroup: 1 },
    { kind: 'type', re: /^(?:pub\s+)?(struct|enum|trait)\s+(\w+)/, nameGroup: 2 },
    { kind: 'impl', re: /^impl\s+([^{\s]+)/, nameGroup: 1 },
  ],
  jvm: [
    { kind: 'class', re: /^\s*(?:public|private|protected|internal)?\s*(?:data\s+|sealed\s+|abstract\s+|open\s+)?(class|interface|enum|object)\s+(\w+)/, nameGroup: 2 },
    { kind: 'function', re: /^\s*(?:public|private|protected|internal)?\s*(?:suspend\s+)?fun\s+(\w+)/, nameGroup: 1 },
  ],
  ruby: [
    { kind: 'class', re: /^\s*class\s+(\w+)/, nameGroup: 1 },
    { kind: 'function', re: /^\s*def\s+([\w?!]+)/, nameGroup: 1 },
  ],
  php: [
    { kind: 'class', re: /^\s*(?:abstract\s+|final\s+)?class\s+(\w+)/, nameGroup: 1 },
    { kind: 'function', re: /^\s*(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)/, nameGroup: 1 },
  ],
  c: [
    { kind: 'class', re: /^\s*(?:class|struct)\s+(\w+)/, nameGroup: 1 },
    { kind: 'define', re: /^\s*#define\s+(\w+)/, nameGroup: 1 },
  ],
  swift: [
    { kind: 'class', re: /^\s*(?:public|private|internal|open|final)?\s*(class|struct|enum|protocol)\s+(\w+)/, nameGroup: 2 },
    { kind: 'function', re: /^\s*(?:public|private|internal|open)?\s*func\s+(\w+)/, nameGroup: 1 },
  ],
  shell: [
    { kind: 'function', re: /^(\w+)\s*\(\)/, nameGroup: 1 },
  ],
};

const EXT_FAMILY: Record<string, string> = {
  '.js': 'script', '.jsx': 'script', '.ts': 'script', '.tsx': 'script',
  '.mjs': 'script', '.cjs': 'script', '.mts': 'script', '.cts': 'script',
  '.py': 'python', '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'jvm', '.kt': 'jvm', '.kts': 'jvm',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c', '.h': 'c', '.cpp': 'c', '.hpp': 'c', '.cc': 'c',
  '.swift': 'swift',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
};

function isMinified(sample: string): boolean {
  const lines = sample.split('\n').slice(0, 50).filter(l => l.length > 0);
  if (lines.length === 0) return false;
  const avg = lines.reduce((n, l) => n + l.length, 0) / lines.length;
  return avg > 500;
}

/** `kind name` lines for one file's top-level symbols, capped and deduped. */
export function extractSymbols(relPath: string, content: string): string[] {
  const family = EXT_FAMILY[path.extname(relPath).toLowerCase()];
  if (!family) return [];
  const patterns = FAMILY_PATTERNS[family];
  if (!patterns || isMinified(content)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of content.split('\n')) {
    for (const p of patterns) {
      const m = p.re.exec(line);
      if (!m) continue;
      const entry = `${p.kind} ${m[p.nameGroup]}`;
      if (seen.has(entry)) break;
      seen.add(entry);
      out.push(entry);
      if (out.length >= REPO_MAP_MAX_SYMBOLS_PER_FILE) return out;
      break;
    }
  }
  return out;
}

export interface RepoMap {
  /** Rendered map, ready to paste into a prompt. '' when nothing mappable. */
  text: string;
  files: number;
  symbols: number;
  truncated: boolean;
}

export function buildRepoMap(absBase: string, displayPrefix = ''): RepoMap {
  let entries;
  try {
    entries = listRootFiles(absBase);
  } catch {
    return { text: '', files: 0, symbols: 0, truncated: false };
  }
  const files = entries.filter(e => e.kind === 'file');
  const lines: string[] = [];
  let fileCount = 0;
  let symbolCount = 0;
  let truncated = false;
  let chars = 0;
  for (const entry of files) {
    if (fileCount >= REPO_MAP_MAX_FILES) { truncated = true; break; }
    if ((entry.size ?? 0) > REPO_MAP_MAX_FILE_BYTES) continue;
    let content: string;
    try {
      const buf = fs.readFileSync(path.join(absBase, entry.path));
      if (buf.subarray(0, Math.min(buf.length, 8192)).includes(0)) continue;
      content = buf.toString('utf8');
    } catch {
      continue;
    }
    const rel = displayPrefix ? `${displayPrefix}/${entry.path}` : entry.path;
    const symbols = extractSymbols(entry.path, content);
    if (symbols.length === 0) continue;
    const block = `${rel}:\n${symbols.map(s => `  ${s}`).join('\n')}`;
    if (chars + block.length > REPO_MAP_MAX_CHARS) { truncated = true; break; }
    chars += block.length;
    lines.push(block);
    fileCount += 1;
    symbolCount += symbols.length;
  }
  if (fileCount === 0) return { text: '', files: 0, symbols: 0, truncated };
  const head = `Repository map (${fileCount} files, ${symbolCount} symbols${truncated ? '; truncated' : ''}):`;
  return { text: `${head}\n${lines.join('\n')}`, files: fileCount, symbols: symbolCount, truncated };
}

/** The system-prompt section for a run; '' when the workspace has no mappable code. */
export function repoMapSection(runId: number): string {
  let root: string;
  try {
    root = runWorkspace(runId);
  } catch {
    return '';
  }
  const map = buildRepoMap(root);
  if (!map.text) return '';
  return `${map.text}\nUse read_file for full contents; the repo_map tool refreshes this view after big changes.`;
}
