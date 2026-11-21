import { useState } from 'react';
import { Check, Copy, ExternalLink, Plug, Terminal } from 'lucide-react';
import { isTerminalAgent, type AgentSetupBridge, type SetupError, type SetupFile } from '@omnipix/shared/agent-setup.js';
import catalog from '../data/agent-tools.json';
import { useStudio } from '../state/store';

interface Tool {
  id: string;
  name: string;
  category: string;
  configType: string;
  protocol: string;
  baseUrlSupport: string;
  command: string;
  docsUrl: string;
}

const FEATURED = ['claude', 'codex', 'cline', 'opencode', 'continue', 'aider'];
const TOOLS = [...FEATURED.map(id => (catalog as Tool[]).find(t => t.id === id)!), ...(catalog as Tool[]).filter(t => !FEATURED.includes(t.id))];

const SURFACES: Record<string, string> = {
  cline: 'Editor', continue: 'Editor', roo: 'Editor', cursor: 'Editor', generic: 'API',
  kilo: 'Editor / CLI', opencode: 'CLI / Desktop', goose: 'CLI / Desktop', zcode: 'Desktop / CLI',
  reasonix: 'CLI / Desktop', openclaw: 'Agent', hermes: 'Agent',
};

function bridge(): AgentSetupBridge | null {
  const w = window as unknown as { __OMNIPIX_AGENT_SETUP__?: AgentSetupBridge };
  return w.__OMNIPIX_AGENT_SETUP__ ?? null;
}

/** Initial tile with a stable hue per agent id. */
function AgentTile({ id, name }: { id: string; name: string }) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
      style={{ backgroundColor: `hsl(${hue} 55% 38%)` }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

const ERRORS: Record<SetupError, string> = {
  gateway: 'Gateway unreachable — is the app running?',
  catalog: 'No usable models in the catalog yet.',
  permission: 'Could not write the config file (permission denied).',
  config: 'Could not write the config file.',
  missing: 'That agent is not installed.',
  terminal: 'Could not open a terminal.',
};

function AgentCard({ tool }: { tool: Tool }) {
  const { pushToast } = useStudio();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SetupFile[] | null>(null);
  const [error, setError] = useState<SetupError | null>(null);
  const [launched, setLaunched] = useState(false);
  const hasBridge = bridge() !== null;
  const terminal = isTerminalAgent(tool.id);
  const guide = tool.configType === 'guide';

  async function connect() {
    const b = bridge();
    if (!b) return;
    setBusy(true);
    setError(null);
    try {
      const result = await b.connect(tool.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (guide) {
        pushToast('info', `${tool.name} needs a manual step — see its docs.`);
        return;
      }
      setSaved(result.files);
      pushToast('ok', `${tool.name} connected to this gateway.`);
    } catch {
      setError('config');
    } finally {
      setBusy(false);
    }
  }

  async function launch() {
    const b = bridge();
    if (!b) return;
    setBusy(true);
    try {
      const result = await b.launch(tool.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLaunched(true);
    } catch {
      setError('terminal');
    } finally {
      setBusy(false);
    }
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(`npx omnipix ${tool.command} --url ${window.location.origin} --api-key <unified-key>`);
      pushToast('ok', 'Setup command copied — paste your unified key at the end.');
    } catch {
      pushToast('error', 'Copy failed — clipboard unavailable');
    }
  }

  return (
    <article className="rounded-xl border border-line bg-base-1 p-4">
      <div className="flex items-center gap-2.5">
        <AgentTile id={tool.id} name={tool.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{tool.name}</p>
          <p className="truncate font-mono text-[11px] text-ink-faint">{SURFACES[tool.id] ?? 'Terminal'} · {tool.protocol}</p>
        </div>
      </div>
      {saved && (
        <ul className="mt-2 space-y-0.5">
          {saved.map(f => (
            <li key={f.path} className="truncate font-mono text-[11px] text-ok" title={f.path}>✓ {f.path}</li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-bad">{ERRORS[error]}</p>}
      <div className="mt-3 flex items-center gap-1.5">
        {hasBridge ? (
          <>
            {!saved || guide ? (
              <button
                type="button"
                onClick={() => void connect()}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
              >
                <Plug className="size-3.5" strokeWidth={1.5} /> {busy ? 'Working…' : guide ? 'Guide' : 'Connect'}
              </button>
            ) : terminal && !launched ? (
              <button
                type="button"
                onClick={() => void launch()}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
              >
                <Terminal className="size-3.5" strokeWidth={1.5} /> {busy ? 'Launching…' : 'Launch'}
              </button>
            ) : (
              <span className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ok/15 px-2 py-1.5 text-xs font-semibold text-ok">
                <Check className="size-3.5" strokeWidth={1.5} /> Connected
              </span>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => void copyCommand()}
            title="Copy the terminal setup command"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Copy className="size-3.5" strokeWidth={1.5} /> Copy setup command
          </button>
        )}
        <a
          href={tool.docsUrl}
          target="_blank"
          rel="noreferrer"
          title={`${tool.name} docs`}
          aria-label={`${tool.name} documentation`}
          className="rounded-lg border border-line p-2 text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ExternalLink className="size-3.5" strokeWidth={1.5} />
        </a>
      </div>
    </article>
  );
}

export function AgentSetupTab() {
  const desktop = bridge() !== null;
  return (
    <div>
      <p className="mb-3 text-[13px] text-ink-dim">
        {desktop
          ? 'One click points a coding agent at this gateway — existing configs are backed up first.'
          : 'One-click setup lives in the desktop app. Here, copy a setup command and run it in a terminal.'}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {TOOLS.map(tool => (
          <AgentCard key={tool.id} tool={tool} />
        ))}
      </div>
    </div>
  );
}
