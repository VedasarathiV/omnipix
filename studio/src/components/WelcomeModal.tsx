import { useEffect, useRef } from 'react';
import { Check, Circle, X } from 'lucide-react';
import { useStudio } from '../state/store';
import { useConversations, useKeys, useRuns, useSkills } from '../lib/queries';

const HIDE_KEY = 'studio.welcomeHidden';

function hidden(): boolean {
  try {
    return window.localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return true;
  }
}



/** VS Code-style welcome checklist with live state. Relaunch from the palette. */
export function WelcomeModal() {
  const { welcomeOpen, setWelcomeOpen, setRail, setAgentEditor } = useStudio();
  const { data: keys = [], isLoading: keysLoading } = useKeys();
  const { data: conversations = [], isLoading: chatsLoading } = useConversations();
  const { data: runsData, isLoading: runsLoading } = useRuns();
  const { data: skillsData } = useSkills();

  const hasKey = keys.some(k => k.enabled);
  const hasChat = conversations.length > 0;
  const hasRun = (runsData?.runs ?? []).length > 0;
  const hasSkill = (skillsData?.skills ?? []).some(s => !s.builtin);

  // True first run only, decided once queries settle: keys, chats, and
  // runs all empty, onboarding tour done, never dismissed. Any manual
  // close ends auto-open for the session so it never nags.
  const closedRef = useRef(false);
  useEffect(() => {
    if (closedRef.current || welcomeOpen || keysLoading || chatsLoading || runsLoading) return;
    let onboarded = true;
    try {
      onboarded = window.localStorage.getItem('studio:onboarded') === '1';
    } catch {
      onboarded = true;
    }
    if (!onboarded) return;
    if (!hidden() && !hasKey && !hasChat && !hasRun) setWelcomeOpen(true);
    else closedRef.current = true;
  }, [welcomeOpen, keysLoading, chatsLoading, runsLoading, hasKey, hasChat, hasRun, setWelcomeOpen]);

  if (!welcomeOpen) return null;

  function dismiss(remember: boolean) {
    closedRef.current = true;
    if (remember) {
      try {
        window.localStorage.setItem(HIDE_KEY, '1');
      } catch {
        // Private mode: shows again next visit.
      }
    }
    setWelcomeOpen(false);
  }

  function go(rail: 'keys' | 'chat' | 'skills') {
    closedRef.current = true;
    setWelcomeOpen(false);
    setRail(rail);
  }

  const rows: Array<{ done: boolean; label: string; hint: string; action: string; run: () => void }> = [
    { done: hasKey, label: 'Add a provider key', hint: 'Groq, Cerebras, and Google have free tiers — or connect local Ollama', action: 'Keys', run: () => go('keys') },
    { done: hasChat, label: 'Send your first chat', hint: 'Ask a question; attach files with @', action: 'Chat', run: () => go('chat') },
    {
      done: hasRun,
      label: 'Launch an agent run',
      hint: 'Agent mode edits files and runs commands with approvals',
      action: 'New run',
      run: () => { closedRef.current = true; setWelcomeOpen(false); setAgentEditor('new'); },
    },
    { done: hasSkill, label: 'Install a skill', hint: 'Drop a SKILL.md or import from file/URL', action: 'Skills', run: () => go('skills') },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => dismiss(false)}>
      <div
        role="dialog"
        aria-label="Welcome checklist"
        className="w-full max-w-md rounded-2xl border border-line bg-base-1 p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">Welcome to OmniPix</h2>
          <button
            type="button"
            aria-label="Close welcome"
            onClick={() => dismiss(false)}
            className="rounded-lg p-1 text-ink-dim outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <p className="mb-4 text-xs text-ink-dim">Get productive in four steps — each one jumps where you need to go.</p>
        <div className="space-y-1.5">
          {rows.map(row => (
            <div key={row.label} className="flex items-center gap-3 rounded-xl border border-line bg-base-0 px-3 py-2.5">
              {row.done
                ? <Check className="size-4 shrink-0 text-ok" strokeWidth={2} />
                : <Circle className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{row.label}</p>
                <p className="truncate text-[11px] text-ink-dim">{row.hint}</p>
              </div>
              {!row.done && (
                <button
                  type="button"
                  onClick={row.run}
                  className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {row.action}
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => dismiss(true)}
          className="mt-4 w-full text-center text-xs text-ink-faint outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          Don&apos;t show again
        </button>
      </div>
    </div>
  );
}
