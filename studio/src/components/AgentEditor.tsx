import { useState } from 'react';
import { Play, X } from 'lucide-react';
import { AGENTS, MODELS } from '../mock/data';
import { useStudio } from '../state/store';

const ALL_TOOLS = ['read', 'search', 'edit', 'shell', 'git', 'web_search', 'fetch', 'memory'];

export function AgentEditor() {
  const { agentEditor, setAgentEditor, pushToast } = useStudio();
  const [tools, setTools] = useState<string[]>(['read', 'edit', 'shell', 'git']);
  const [instructions, setInstructions] = useState('You write minimal, tested code.');
  const [memory, setMemory] = useState(true);
  const [perms, setPerms] = useState('risky');
  if (!agentEditor) return null;

  const agent = AGENTS.find(a => a.id === agentEditor);
  const title = agent ? `Edit ${agent.name}` : 'New agent';

  function flip(tool: string) {
    setTools(list => (list.includes(tool) ? list.filter(t => t !== tool) : [...list, tool]));
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setAgentEditor(null)}>
      <div
        role="dialog"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-base-1 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Close editor"
            onClick={() => setAgentEditor(null)}
            className="rounded-lg p-1 text-ink-dim outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div>
            <p className="mb-1.5 text-xs font-medium">Instructions</p>
            <textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-line bg-base-0 p-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium">Tools</p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_TOOLS.map(tool => (
                <button
                  key={tool}
                  type="button"
                  aria-pressed={tools.includes(tool)}
                  onClick={() => flip(tool)}
                  className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    tools.includes(tool) ? 'border-accent/60 bg-accent/10 text-ink' : 'border-line text-ink-faint'
                  }`}
                >
                  {tool}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">Model</p>
            <select aria-label="Agent model" className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium">Memory</p>
              <p className="text-[11px] text-ink-dim">Recall project memories in runs</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={memory}
              aria-label="Memory"
              onClick={() => setMemory(!memory)}
              className={`relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${memory ? 'bg-accent' : 'bg-base-2'}`}
            >
              <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${memory ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">Permissions</p>
            <select value={perms} onChange={e => setPerms(e.target.value)} aria-label="Agent permissions" className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <option value="always">Ask always</option>
              <option value="risky">Ask for risky</option>
              <option value="auto">Auto</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => pushToast('info', 'Test run started')}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Play className="size-3.5" strokeWidth={1.5} /> Test run
          </button>
          <button
            type="button"
            onClick={() => { setAgentEditor(null); pushToast('ok', 'Agent saved'); }}
            className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
          >
            Save agent
          </button>
        </div>
      </div>
    </div>
  );
}
