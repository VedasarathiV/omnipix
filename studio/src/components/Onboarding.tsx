import { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { useStudio } from '../state/store';

const SEEN_KEY = 'studio:onboarded';

function seen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

/** First-run welcome: one card sending the user to add a key. Shown once. */
export function Onboarding() {
  const { setRail } = useStudio();
  const [open, setOpen] = useState(() => !seen());

  if (!open) return null;

  function finish() {
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Private mode: shows again next visit.
    }
    setOpen(false);
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-label="Welcome to OmniPix" className="w-full max-w-md rounded-2xl border border-line bg-base-1 p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-base-2">
          <KeyRound className="size-6 text-accent" strokeWidth={1.5} />
        </div>
        <p className="text-base font-semibold">Add a provider key</p>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-dim">
          OmniPix routes across your own keys — Groq, Cerebras, and Google all have free tiers.
          Keys stay encrypted on this machine. No key? Connect free local Ollama instead.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => { setRail('keys'); finish(); }}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
          >
            Add a key
          </button>
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
