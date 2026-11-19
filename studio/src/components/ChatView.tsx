import { Sparkles } from 'lucide-react';
import { MESSAGES, TIMELINE } from '../mock/data';
import { MessageBubble } from './MessageBubble';
import { PlanCard } from './PlanCard';
import { StepCard, ThinkingBlock } from './StepCard';
import { ApprovalPrompt } from './ApprovalPrompt';
import { EmptyState } from './EmptyState';
import { KeyBanner, OfflineBanner, RunErrorBanner } from './StateBanners';
import { useStudio } from '../state/store';

export function ChatView() {
  const { approval, pushToast } = useStudio();
  const showTimeline = TIMELINE.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OfflineBanner />
      <KeyBanner />
      <RunErrorBanner />
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <span className="text-[13px] font-semibold">Refresh-token rotation</span>
        <span className="font-mono text-[11px] text-ink-faint">12.4k tokens · $0.09</span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {MESSAGES.length === 0 && (
          <EmptyState
            icon={<Sparkles className="size-5" strokeWidth={1.5} />}
            title="What should the agent do?"
            body="Pick a suggested task or describe your own. Attach files with @."
            action={
              <span className="mt-2 flex flex-wrap justify-center gap-1.5">
                {['Fix failing tests', 'Explain this repo', 'Add dark mode'].map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => pushToast('info', `Started: ${s}`)}
                    className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-1 focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {s}
                  </button>
                ))}
              </span>
            }
          />
        )}
        <PlanCard />
        {showTimeline && (
          <div className="space-y-2" aria-label="Agent timeline">
            <ThinkingBlock />
            {TIMELINE.map(step => <StepCard key={step.id} step={step} />)}
          </div>
        )}
        {MESSAGES.map(m => <MessageBubble key={m.id} message={m} />)}
        {approval && <ApprovalPrompt approval={approval} />}
      </div>
    </div>
  );
}
