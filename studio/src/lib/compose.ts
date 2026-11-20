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
