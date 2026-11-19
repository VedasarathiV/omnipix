import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Play, X } from 'lucide-react';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { useModels, useSkills, type AgentRun } from '../lib/queries';

const ALL_TOOLS = ['read_file', 'grep_search', 'write_file', 'edit_file', 'shell_exec', 'run_check', 'git_status', 'git_diff', 'git_commit', 'delegate', 'web_search', 'fetch_url', 'todo_write'];

/** New run launcher: goal + tools + skills + model. Runs are the agents. */
export function AgentEditor() {
  const { agentEditor, setAgentEditor, pushToast, setActiveRunId, setConversationId, setRail } = useStudio();
  const queryClient = useQueryClient();
  const { data: models = [] } = useModels();
  const { data: skillsData } = useSkills();
  const [goal, setGoal] = useState('');
  const [tools, setTools] = useState<string[]>(['read_file', 'grep_search', 'write_file', 'edit_file', 'shell_exec']);
  const [skills, setSkills] = useState<string[]>([]);
  const [model, setModel] = useState('auto');
  const [planMode, setPlanMode] = useState(false);
  if (!agentEditor) return null;

  const enabled = models.filter(m => m.enabled);
  const skillNames = (skillsData?.skills ?? []).filter(s => s.enabled).map(s => s.name);

  function flip(list: string[], set: (v: string[]) => void, name: string) {
    set(list.includes(name) ? list.filter(t => t !== name) : [...list, name]);
  }

  async function launch() {
    if (!goal.trim()) {
      pushToast('error', 'Describe the goal first');
      return;
    }
    try {
      const run = await apiFetch<AgentRun>('/api/agents/runs', {
        method: 'POST',
        body: JSON.stringify({ goal, model, tools, skills, planMode }),
      });
      setAgentEditor(null);
      setConversationId(null);
      setActiveRunId(run.id);
      setRail('chat');
      pushToast('ok', `Run #${run.id} started`);
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Launch failed');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setAgentEditor(null)}>
      <div
        role="dialog"
        aria-label="New agent run"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-base-1 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">New agent run</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setAgentEditor(null)}
            className="rounded-lg p-1 text-ink-dim outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div>
            <p className="mb-1.5 text-xs font-medium">Goal</p>
            <textarea
              value={goal}
              onChange={e => setGoal(e.target.value)}
              rows={3}
              placeholder="What should the agent achieve?"
              className="w-full rounded-lg border border-line bg-base-0 p-2.5 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
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
                  onClick={() => flip(tools, setTools, tool)}
                  className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    tools.includes(tool) ? 'border-accent/60 bg-accent/10 text-ink' : 'border-line text-ink-faint'
                  }`}
                >
                  {tool}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium">Skills <span className="font-normal text-ink-faint">(optional — the router also auto-selects)</span></p>
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {skillNames.slice(0, 60).map(name => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={skills.includes(name)}
                  onClick={() => flip(skills, setSkills, name)}
                  className={`rounded-lg border px-2 py-1 font-mono text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    skills.includes(name) ? 'border-accent/60 bg-accent/10 text-ink' : 'border-line text-ink-faint'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">Model</p>
            <select value={model} onChange={e => setModel(e.target.value)} aria-label="Run model" className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <option value="auto">Auto (fallback chain)</option>
              {enabled.map(m => <option key={m.id} value={m.modelId}>{m.modelId}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium">Plan mode</p>
              <p className="text-[11px] text-ink-dim">Draft a plan and wait for approval first</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={planMode}
              aria-label="Plan mode"
              onClick={() => setPlanMode(!planMode)}
              className={`relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${planMode ? 'bg-accent' : 'bg-base-2'}`}
            >
              <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${planMode ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => void launch()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Play className="size-3.5" strokeWidth={1.5} /> Launch run
          </button>
        </div>
      </div>
    </div>
  );
}
