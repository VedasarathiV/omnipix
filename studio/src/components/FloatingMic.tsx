import { Mic } from 'lucide-react';
import { useStudio } from '../state/store';

/** Floating dictation button, anchored to the chat pane. Hidden on mobile. */
export function FloatingMic() {
  const { pushToast } = useStudio();
  return (
    <button
      type="button"
      title="Dictate (mic)"
      aria-label="Dictate"
      onClick={() => pushToast('info', 'Listening… (mock dictation)')}
      className="absolute right-5 bottom-40 z-30 hidden size-11 items-center justify-center rounded-full border border-line bg-base-1 shadow-xl outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent md:flex"
    >
      <Mic className="size-5 text-ink-dim" strokeWidth={1.5} />
    </button>
  );
}
