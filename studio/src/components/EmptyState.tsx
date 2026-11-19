import type { ReactNode } from 'react';

export function EmptyState({ icon, title, body, action }: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-base-2 text-ink-dim">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-ink-dim">{body}</p>
      {action}
    </div>
  );
}
