import { useState } from 'react';
import { Bot, KeyRound, MessagesSquare, X } from 'lucide-react';
import { useStudio } from '../state/store';

const SEEN_KEY = 'studio:onboarded';

function seen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

/** First-run onboarding: keys → chat modes → agents. Shown once per browser. */
export function Onboarding() {
  const { setRail } = useStudio();
  const [open, setOpen] = useState(() => !seen());
  const [step, setStep] = useState(0);

  if (!open) return null;

  function finish() {
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Private mode: shows again next visit.
    }
    setOpen(false);
  }

  const last = 2;
  const steps = [
    {
      icon: <KeyRound className="size-6 text-accent" strokeWidth={1.5} />,
      title: 'Add a provider key',
      body: 'OmniPix routes across your own keys — Groq, Cerebras, and Google all have free tiers. Keys stay encrypted on this machine. No key? Connect free local Ollama instead.',
      cta: 'Add a key',
      run: () => { setRail('keys'); setStep(1); },
    },
    {
      icon: <MessagesSquare className="size-6 text-accent" strokeWidth={1.5} />,
      title: 'Chat, plan, or delegate',
      body: 'Ask answers questions. Plan drafts a checklist for approval. Agent edits files and runs commands, asking before anything risky.',
      cta: 'Continue',
      run: () => { setStep(2); },
    },
    {
      icon: <Bot className="size-6 text-accent" strokeWidth={1.5} />,
      title: 'Crews that work alone',
      body: 'The Agents tab runs multi-agent teams and scheduled automations. Every run keeps a step trace you can review and revert.',
      cta: 'Get started',
      run: () => { setRail('chat'); finish(); },
    },
  ];
  const current = steps[step];

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-label="Welcome to OmniPix" className="w-full max-w-md rounded-2xl border border-line bg-base-1 p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-base-2">{current.icon}</div>
        <p className="text-base font-semibold">{current.title}</p>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-dim">{current.body}</p>
        <div className="mt-4 flex items-center justify-center gap-1.5">
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full ${i === step ? 'w-6 bg-accent' : 'w-1.5 bg-line'}`} />
          ))}
        </div>
        <div className="mt-4 flex justify-center gap-2">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className="rounded-lg border border-line px-4 py-2 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Back</button>
          )}
          <button type="button" onClick={current.run} className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">{step === last ? 'Get started' : current.cta}</button>
        </div>
        <button
          type="button"
          onClick={finish}
          className="mt-3 inline-flex items-center gap-1 text-xs text-ink-faint outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="size-3" strokeWidth={1.5} /> Skip tour
        </button>
      </div>
    </div>
  );
}
