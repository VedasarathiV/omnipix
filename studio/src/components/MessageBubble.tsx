import { useState } from 'react';
import { Check, Copy, GitBranch, Pencil, Trash2, WrapText } from 'lucide-react';
import type { ChatMessage } from '../types';
import { useStudio } from '../state/store';
import { renderMessageContent } from '../lib/compose';

export { renderMessageContent };

export function MessageBubble({
  message,
  onDelete,
  onBranch,
  onEdit,
}: {
  message: ChatMessage;
  /** Conversation actions; omitted for run-final and streaming bubbles. */
  onDelete?: () => void;
  onBranch?: () => void;
  onEdit?: () => void;
}) {
  const { pushToast } = useStudio();
  const [wrapped, setWrapped] = useState(false);
  const [copied, setCopied] = useState(false);
  const mine = message.role === 'user';

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      pushToast('ok', 'Copied to clipboard');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      pushToast('error', 'Copy failed — clipboard unavailable');
    }
  }

  return (
    <div className={`group flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${mine ? 'bg-accent text-white' : 'bg-base-1'}`}>
        {message.text.split('\n').map((line, i) => (
          <span key={i} className={wrapped ? '' : 'block truncate-0'}>
            {line.startsWith('```') ? null : line}
            {i < message.text.split('\n').length - 1 && <br />}
          </span>
        ))}
        <span className={`mt-1.5 flex items-center gap-2 text-[11px] ${mine ? 'text-white/70' : 'text-ink-faint'}`}>
          {message.ts}
          {message.model && <span>· {message.model}</span>}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <MsgBtn label="Copy" onClick={() => void copy()}>{copied ? <Check className="size-3.5 text-ok" strokeWidth={1.5} /> : <Copy className="size-3.5" strokeWidth={1.5} />}</MsgBtn>
        {!mine && <MsgBtn label="Toggle wrap" onClick={() => setWrapped(w => !w)}><WrapText className="size-3.5" strokeWidth={1.5} /></MsgBtn>}
        {onBranch && !mine && <MsgBtn label="Branch from here" onClick={onBranch}><GitBranch className="size-3.5" strokeWidth={1.5} /></MsgBtn>}
        {onEdit && mine && <MsgBtn label="Edit and resend" onClick={onEdit}><Pencil className="size-3.5" strokeWidth={1.5} /></MsgBtn>}
        {onDelete && <MsgBtn label="Delete message" onClick={onDelete}><Trash2 className="size-3.5" strokeWidth={1.5} /></MsgBtn>}
      </div>
    </div>
  );
}

function MsgBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-ink-faint outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </button>
  );
}
