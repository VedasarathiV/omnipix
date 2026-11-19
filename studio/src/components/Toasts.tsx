import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useStudio } from '../state/store';

export function Toasts() {
  const { toasts, dismissToast } = useStudio();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map(t => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-2 rounded-xl border border-line bg-base-1 p-3 text-sm shadow-xl"
        >
          {t.kind === 'ok' ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={1.5} />
          ) : t.kind === 'error' ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-bad" strokeWidth={1.5} />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0 text-info" strokeWidth={1.5} />
          )}
          <span className="min-w-0 flex-1">{t.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
            className="rounded p-0.5 text-ink-faint outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  );
}
