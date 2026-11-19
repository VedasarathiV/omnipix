import { useRef, useState } from 'react';
import { AtSign, LayoutTemplate, Mic, Paperclip, Send, Slash, X } from 'lucide-react';
import { useStudio } from '../state/store';
import { MODELS } from '../mock/data';

const SLASH = [
  { cmd: '/plan', desc: 'Draft a plan for approval' },
  { cmd: '/test', desc: 'Run the test suite' },
  { cmd: '/fix', desc: 'Fix the last failure' },
  { cmd: '/explain', desc: 'Explain the selected code' },
  { cmd: '/commit', desc: 'Suggest a commit message' },
  { cmd: '/clear', desc: 'Clear this chat' },
];

const FILES = ['src/auth/session.ts', 'src/auth/rotation.ts', 'src/agent/tools.ts', 'tests/auth.test.ts'];
const HISTORY = ['Add refresh-token rotation to the session store', 'Explain the fallback chain', 'Run evals on the new model'];
const TEMPLATES = [
  { name: 'Bug fix', text: 'Reproduce the bug, write a failing test, fix it, then run the suite. Bug: ' },
  { name: 'Code review', text: 'Review the current diff for bugs, security issues, and performance. Be specific with file:line.' },
  { name: 'Explain', text: 'Explain how this code works, starting from the entry point: ' },
  { name: 'Refactor', text: 'Refactor for clarity without changing behavior. Keep the diff minimal: ' },
];

export function InputBar() {
  const { mode, setMode, model, setModel, setRunStatus, pushToast } = useStudio();
  const [text, setText] = useState('');
  const [chips, setChips] = useState(['src/auth/session.ts', 'src/auth/rotation.ts']);
  const [menu, setMenu] = useState<'slash' | 'mention' | 'templates' | null>(null);
  const [histIdx, setHistIdx] = useState(-1);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  function send() {
    if (!text.trim()) return;
    setRunStatus('running');
    pushToast('info', mode === 'ask' ? 'Asking…' : mode === 'plan' ? 'Planning…' : 'Agent running…');
    setText('');
    setMenu(null);
    setHistIdx(-1);
  }

  return (
    <div className="shrink-0 border-t border-line bg-base-1 p-3">
      {chips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached context">
          {chips.map(c => (
            <span key={c} className="flex items-center gap-1 rounded-md bg-base-2 py-1 pr-1 pl-2 font-mono text-[11px]">
              {c} <span className="text-ink-faint">1.2k</span>
              <button
                type="button"
                aria-label={`Remove ${c}`}
                onClick={() => setChips(list => list.filter(x => x !== c))}
                className="rounded p-0.5 text-ink-faint outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="size-3" strokeWidth={1.5} />
              </button>
            </span>
          ))}
          <span className="py-1 font-mono text-[11px] text-ink-faint">2.4k tokens</span>
        </div>
      )}
      <div className="relative">
        {menu === 'slash' && (
          <Menu onClose={() => setMenu(null)}>
            {SLASH.map(s => (
              <button key={s.cmd} type="button" onClick={() => { setText(s.cmd + ' '); setMenu(null); boxRef.current?.focus(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-base-2">
                <Slash className="size-3.5 text-accent" strokeWidth={1.5} />
                <span className="font-mono">{s.cmd}</span>
                <span className="truncate text-xs text-ink-dim">{s.desc}</span>
              </button>
            ))}
          </Menu>
        )}
        {menu === 'mention' && (
          <Menu onClose={() => setMenu(null)}>
            {FILES.map(f => (
              <button key={f} type="button" onClick={() => { setChips(list => [...new Set([...list, f])]); setText(t => t.replace(/@\w*$/, '')); setMenu(null); boxRef.current?.focus(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-xs outline-none hover:bg-base-2">
                <AtSign className="size-3.5 text-accent" strokeWidth={1.5} />{f}
              </button>
            ))}
          </Menu>
        )}
        {menu === 'templates' && (
          <Menu onClose={() => setMenu(null)}>
            {TEMPLATES.map(t => (
              <button key={t.name} type="button" onClick={() => { setText(t.text); setMenu(null); boxRef.current?.focus(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-base-2">
                <LayoutTemplate className="size-3.5 text-accent" strokeWidth={1.5} />
                <span className="font-medium">{t.name}</span>
                <span className="truncate text-xs text-ink-dim">{t.text}</span>
              </button>
            ))}
          </Menu>
        )}
        <textarea
          ref={boxRef}
          value={text}
          onChange={e => {
            const v = e.target.value;
            setText(v);
            if (v.endsWith('/')) setMenu('slash');
            else if (/@\w*$/.test(v)) setMenu('mention');
            else setMenu(null);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            if (e.key === 'ArrowUp' && !text && histIdx < HISTORY.length - 1) {
              e.preventDefault();
              const next = histIdx + 1;
              setHistIdx(next);
              setText(HISTORY[next]);
            }
            if (e.key === 'Escape') setMenu(null);
          }}
          rows={2}
          placeholder="Ask, plan, or instruct the agent… (@ for files, / for commands)"
          aria-label="Message input"
          className="w-full resize-none rounded-xl border border-line bg-base-0 px-3 pt-2.5 pb-11 text-sm outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="absolute right-2 bottom-2 left-2 flex items-center gap-1">
          <IconBtn label="Attach file or image" onClick={() => pushToast('info', 'Drop files or paste a screenshot')}><Paperclip className="size-4" strokeWidth={1.5} /></IconBtn>
          <IconBtn label="Mention file (@)" onClick={() => { setText(t => t + '@'); setMenu('mention'); boxRef.current?.focus(); }}><AtSign className="size-4" strokeWidth={1.5} /></IconBtn>
          <IconBtn label="Prompt templates" onClick={() => setMenu(menu === 'templates' ? null : 'templates')}><LayoutTemplate className="size-4" strokeWidth={1.5} /></IconBtn>
          <select
            aria-label="Input mode"
            value={mode}
            onChange={e => setMode(e.target.value as typeof mode)}
            className="rounded-md bg-transparent px-1 py-1 text-xs text-ink-dim outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="ask">Ask</option>
            <option value="plan">Plan</option>
            <option value="agent">Agent</option>
          </select>
          <select
            aria-label="Input model"
            value={model}
            onChange={e => setModel(e.target.value)}
            className="max-w-32 rounded-md bg-transparent px-1 py-1 text-xs text-ink-dim outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <div className="flex-1" />
          <IconBtn label="Dictate (mic)" onClick={() => pushToast('info', 'Listening… (mock dictation)')}><Mic className="size-4" strokeWidth={1.5} /></IconBtn>
          <button
            type="button"
            aria-label="Send (Enter)"
            onClick={send}
            disabled={!text.trim()}
            className="flex size-8 items-center justify-center rounded-lg bg-accent text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            <Send className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-ink-faint">Enter to send · Shift+Enter newline · ↑ prompt history</p>
    </div>
  );
}

function Menu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-full left-0 z-20 mb-1.5 max-h-56 w-72 overflow-y-auto rounded-xl border border-line bg-base-1 p-1 shadow-xl">
        {children}
      </div>
    </>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </button>
  );
}
