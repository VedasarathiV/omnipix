// Pure message-composition helpers for the input bar and bubbles. DOM-free
// by design so the studio unit suite can cover them without a browser.

export interface SlashEntry {
  cmd: string;
  desc: string;
  expand?: string;
}

/** Single source for the slash menu and the send-time parser. */
export const SLASH_COMMANDS: SlashEntry[] = [
  { cmd: '/plan', desc: 'Switch to Plan mode' },
  { cmd: '/test', desc: 'Run the test suite', expand: 'Run the test suite and report failures with file:line.' },
  { cmd: '/fix', desc: 'Fix the last failure', expand: 'Fix the last failure. Reproduce it first if needed, then verify the fix.' },
  { cmd: '/commit', desc: 'Suggest a commit message', expand: 'Suggest a commit message for the current changes.' },
  { cmd: '/clear', desc: 'Clear this chat' },
];

export type SlashAction =
  | { kind: 'clear' }
  | { kind: 'plan'; rest: string }
  | { kind: 'expand'; text: string }
  | { kind: 'none' };

/** Leading /name[/sub] candidate (server resolves; misses fall through). */
export function parseCommandName(text: string): { name: string; input: string } | null {
  const match = /^\/([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)(?=[ \t]+|$)/.exec(text.trimStart());
  if (!match) return null;
  return { name: match[1], input: text.trimStart().slice(match[0].length).trimStart() };
}

/**
 * Expand a file-command template (mirrors the server rules): $N takes the
 * Nth word with the last placeholder greedy, $ARGUMENTS takes all input,
 * and input with no placeholders appends.
 */
export function expandFileTemplate(template: string, input: string): string {
  const args = input.trim() ? input.trim().split(/\s+/) : [];
  const placeholders = [...template.matchAll(/\$(\d+)/g)].map(m => Number(m[1]));
  const last = placeholders.length ? Math.max(...placeholders) : 0;
  const expanded = template.replace(/\$ARGUMENTS|\$(\d+)/g, (match, index: string | undefined) => {
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

/** Strip SKILL.md frontmatter, leaving instructions (Ask-mode /skill inline). */
export function stripSkillFrontmatter(content: string): string {
  const text = content.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return text.trim();
  const end = text.indexOf('\n---', 4);
  if (end === -1) return text.trim();
  return text.slice(end + 4).replace(/^\n/, '').trim();
}

/**
 * Subsequence fuzzy score for palettes: substring hits score 1000+,
 * subsequence hits 0..100 by tightness, and only a true miss is -1.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  if (t.includes(q)) return 1000 - t.indexOf(q);
  let gaps = 0;
  let ti = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    gaps += (found - ti);
    ti = found + 1;
  }
  return Math.max(0, 100 - gaps);
}

/** Parse a leading /command. Unknown commands are sent as plain text. */
export function parseSlashCommand(text: string): SlashAction {
  if (!text.startsWith('/')) return { kind: 'none' };
  const [cmd, ...rest] = text.split(/\s+/);
  const tail = rest.join(' ').trim();
  if (cmd === '/clear') return { kind: 'clear' };
  if (cmd === '/plan') return { kind: 'plan', rest: tail };
  const entry = SLASH_COMMANDS.find(s => s.cmd === cmd);
  if (entry?.expand) return { kind: 'expand', text: tail ? `${entry.expand} ${tail}` : entry.expand };
  return { kind: 'none' };
}

const STOPWORDS = new Set(
  'the,a,an,and,or,for,with,from,that,this,what,when,how,why,can,you,your,have,has,are,was,were,will,would,should,could,please,into,over'.split(','),
);

/** Distinctive lowercase words for keyword doc search (deduped, capped). */
export function distinctiveWords(text: string, max: number): string[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)].slice(0, max);
}

export interface ResolvedChip {
  url: string;
  title: string;
  chunks: Array<{ section: string; content: string }>;
}

/** Prepend resolved doc context to a goal; chips with no hits say so. */
export function buildChipContext(goal: string, resolved: ResolvedChip[]): string {
  if (!resolved.length) return goal;
  const blocks = resolved.map(r => {
    if (!r.chunks.length) return `--- context: ${r.title} (${r.url}) — no matching chunks found ---`;
    const body = r.chunks.map(c => (c.section ? `## ${c.section}\n` : '') + c.content).join('\n\n');
    return `--- context from ${r.title} (${r.url}) ---\n${body}`;
  });
  return `${blocks.join('\n\n')}\n\n--- user request ---\n${goal}`;
}

/** Render a conversation message part: plain strings as-is, array content
 *  (vision turns) as its text parts plus an image marker per image part. */
export function renderMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const out: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      out.push(part);
    } else if (part && typeof part === 'object') {
      const p = part as { type?: string; text?: string };
      if (p.type === 'text' && typeof p.text === 'string') out.push(p.text);
      else if (p.type === 'image_url') out.push('[image attached]');
    }
  }
  return out.join('\n');
}
