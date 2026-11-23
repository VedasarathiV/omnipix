import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isBlockedFetchUrlResolved } from '../lib/guarded-fetch.js';

// Managed headless Chromium for agent browsing: navigate real pages,
// snapshot an LLM-readable element tree, click/type, screenshot.
// Zero new dependencies: CDP over the global WebSocket client.
//
// One browser per server process with a single page; concurrent runs
// serialize on it. Good enough for research flows; a pool would be
// the follow-up if agents ever browse in parallel.

const RPC_TIMEOUT_MS = 30_000;
const NAV_TIMEOUT_MS = 30_000;
const MAX_SNAPSHOT_NODES = 300;

function findChrome(): string {
  const override = (process.env.CHROME_PATH ?? '').trim();
  if (override) {
    if (existsSync(override)) return override;
    throw new Error(`CHROME_PATH is set but not found: ${override}`);
  }
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const found = execFileSync('which', [bin], { encoding: 'utf8' }).trim().split('\n')[0]?.trim();
      if (found) return found;
    } catch {
      // Not on PATH; keep looking.
    }
  }
  throw new Error('No Chrome/Chromium found (set CHROME_PATH to the binary)');
}

/** Public + loopback URLs pass; private/link-local ranges are refused. */
export async function checkBrowserUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs browse');
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  if (loopback) return url.toString();
  const blocked = await isBlockedFetchUrlResolved(url.toString());
  if (blocked) throw new Error(blocked);
  return url.toString();
}

interface CdpCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

class CdpPage {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, CdpCall>();
  private loadResolve: (() => void) | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', (event: MessageEvent) => {
      let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const call = this.pending.get(msg.id);
        if (!call) return;
        this.pending.delete(msg.id);
        clearTimeout(call.timer);
        if (msg.error) call.reject(new Error(String(msg.error.message ?? 'CDP error')));
        else call.resolve(msg.result);
        return;
      }
      if (msg.method === 'Page.loadEventFired' && this.loadResolve) {
        const done = this.loadResolve;
        this.loadResolve = null;
        done();
      }
    });
  }

  async open(): Promise<void> {
    const ws = this.ws;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connect timed out')), 10000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP connect failed'));
      }, { once: true });
    });
    await this.call('Page.enable', {});
    await this.call('Runtime.enable', {});
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForLoad(timeoutMs = NAV_TIMEOUT_MS): Promise<void> {
    return new Promise(resolve => {
      this.loadResolve = resolve;
      setTimeout(() => {
        if (this.loadResolve) {
          this.loadResolve = null;
          resolve();
        }
      }, timeoutMs);
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // Already gone.
    }
  }
}

interface SnapshotNode {
  ref: number;
  role: string;
  name: string;
  backendId: number;
}

/** Flatten an AX tree into numbered [ref] lines the model can act on. */
export function formatSnapshot(nodes: Array<{ role?: { value?: string }; name?: { value?: string }; backendDOMNodeId?: number; childIds?: number[] }>): { text: string; refs: Map<number, number> } {
  const refs = new Map<number, number>();
  const lines: string[] = [];
  let ref = 0;
  const skip = new Set(['none', 'generic', 'RootWebArea', 'StaticText', 'InlineTextBox']);
  for (const node of nodes) {
    if (refs.size >= MAX_SNAPSHOT_NODES) break;
    const role = node.role?.value ?? 'unknown';
    const name = (node.name?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (skip.has(role) && !name) continue;
    if (node.backendDOMNodeId === undefined) continue;
    ref += 1;
    refs.set(ref, node.backendDOMNodeId);
    lines.push(name ? `[${ref}] ${role} ${JSON.stringify(name)}` : `[${ref}] ${role}`);
  }
  return { text: lines.join('\n'), refs };
}

let child: ChildProcess | null = null;
let page: CdpPage | null = null;
let refsByNumber = new Map<number, number>();
let connecting: Promise<CdpPage> | null = null;

async function debugPort(binary: string): Promise<{ port: number; proc: ChildProcess }> {
  const profile = join(tmpdir(), `omnipix-browser-${process.pid}`);
  const proc = spawn(binary, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: false });
  const stderr = proc.stderr;
  if (!stderr) throw new Error('Chrome stderr unavailable');
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome DevTools port never appeared')), 30000);
    let text = '';
    stderr.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(text)
        ?? /DevTools listening on ws:\/\/\[::1\]:(\d+)/.exec(text);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    proc.once('error', err => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
    proc.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited during launch (code ${code ?? '?'})`));
    });
  });
  return { port, proc };
}

async function connect(): Promise<CdpPage> {
  if (page) return page;
  if (connecting) return connecting;
  connecting = (async () => {
    const binary = findChrome();
    const { port, proc } = await debugPort(binary);
    child = proc;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl?: string }>;
    const target = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!target?.webSocketDebuggerUrl) throw new Error('No debuggable page in managed Chrome');
    const next = new CdpPage(target.webSocketDebuggerUrl);
    await next.open();
    page = next;
    return next;
  })();
  try {
    return await connecting;
  } catch (err) {
    connecting = null;
    closeBrowser();
    throw err;
  }
}

/** Best-effort shutdown (process exit also reaps the non-detached child). */
export function closeBrowser(): void {
  connecting = null;
  if (page) {
    page.close();
    page = null;
  }
  refsByNumber = new Map();
  if (child) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
    child = null;
  }
}

export async function browserNavigate(rawUrl: string): Promise<string> {
  const url = await checkBrowserUrl(rawUrl);
  const session = await connect();
  const started = session.waitForLoad();
  const nav = await session.call('Page.navigate', { url }) as { errorText?: string };
  if (nav?.errorText) throw new Error(`Navigation failed: ${nav.errorText}`);
  await started;
  const { result } = await session.call('Runtime.evaluate', { expression: 'document.title', returnByValue: true }) as { result: { value?: string } };
  refsByNumber = new Map();
  return `Loaded ${url}${result?.value ? ` — ${String(result.value).slice(0, 160)}` : ''}`;
}

export async function browserSnapshot(): Promise<string> {
  const session = await connect();
  const tree = await session.call('Accessibility.getFullAXTree', {}) as { nodes?: Array<{ role?: { value?: string }; name?: { value?: string }; backendDOMNodeId?: number; childIds?: number[] }> };
  const { text, refs } = formatSnapshot(tree.nodes ?? []);
  refsByNumber = refs;
  if (!text) return 'Empty page (no interactive elements found). Take a snapshot after navigating.';
  return text;
}

async function nodeForRef(ref: number): Promise<{ objectId: string }> {
  const backendId = refsByNumber.get(ref);
  if (backendId === undefined) throw new Error(`Unknown element ref ${ref} — take a fresh snapshot first.`);
  const session = await connect();
  const resolved = await session.call('DOM.resolveNode', { backendNodeId: backendId }) as { object?: { objectId?: string } };
  const objectId = resolved?.object?.objectId;
  if (!objectId) throw new Error(`Element ${ref} is gone — take a fresh snapshot first.`);
  return { objectId };
}

export async function browserClick(ref: number): Promise<string> {
  const session = await connect();
  const { objectId } = await nodeForRef(ref);
  const box = await session.call('DOM.getBoxModel', { objectId }) as { model?: { content?: number[] } };
  const content = box?.model?.content;
  if (!content || content.length < 8) throw new Error(`Element ${ref} has no clickable box.`);
  const xs = [content[0], content[2], content[4], content[6]];
  const ys = [content[1], content[3], content[5], content[7]];
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await session.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  refsByNumber = new Map();
  return `Clicked element ${ref}. Take a snapshot to see the result.`;
}

export async function browserType(ref: number, text: string, submit = false): Promise<string> {
  if (!text) throw new Error('Nothing to type');
  await browserClick(ref);
  const session = await connect();
  await session.call('Input.insertText', { text });
  if (submit) {
    await session.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await session.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }
  refsByNumber = new Map();
  return submit ? `Typed into element ${ref} and pressed Enter.` : `Typed into element ${ref}.`;
}

export async function browserScreenshot(): Promise<{ pngBase64: string }> {
  const session = await connect();
  const shot = await session.call('Page.captureScreenshot', { format: 'png' }) as { data?: string };
  if (!shot?.data) throw new Error('Screenshot came back empty');
  return { pngBase64: shot.data };
}
