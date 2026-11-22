import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { extractMessageMedia, MessageBubble, renderMessageContent } from './MessageBubble';
import { PlanCard } from './PlanCard';
import { RunTimeline } from './RunTimeline';
import { ApprovalPrompt } from './ApprovalPrompt';
import { EmptyState } from './EmptyState';
import { KeyBanner, OfflineBanner, RunErrorBanner } from './StateBanners';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { speakText, stopSpeech } from '../lib/voice';
import { useApprovals, useConversation, useRun, useUnifiedKey, useVoiceSettings, type Conversation } from '../lib/queries';

/** A model that answers with a bare tool call ({name, arguments}) instead of
 *  prose gets pretty-printed JSON rather than a confusing one-liner. */
function formatFinalAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { name?: unknown; arguments?: unknown };
      if (typeof parsed.name === 'string') {
        return `The model returned a tool call instead of a written answer:\n\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
      }
    } catch {
      // Not JSON — render as prose.
    }
  }
  return answer;
}

function formatTs(value: string | null | undefined): string {
  if (!value) return '';
  const ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toLocaleDateString();
}

export function ChatView() {
  const { conversationId, activeRunId, streamingReply, setDictation, setConversationId, setEditDraft, pushToast } = useStudio();
  const queryClient = useQueryClient();
  const { data: conversation } = useConversation(conversationId);
  const { data: run } = useRun(activeRunId, true);
  const { data: approvalsData } = useApprovals();
  const { data: voiceSettings } = useVoiceSettings();
  const { data: keyData } = useUnifiedKey();
  const liveApproval = (approvalsData?.approvals ?? []).find(a => a.status === 'pending' && (activeRunId === null || a.run_id === activeRunId)) ?? null;

  const messages = conversation?.messages ?? [];

  // Voice-output toggle: read new assistant replies aloud. One-shot per
  // message (tracked by conversation + count); failures stay silent so a
  // missing speech model never interrupts reading.
  const spokenRef = useRef('');
  useEffect(() => {
    if (!voiceSettings?.autoSpeakChat || !keyData?.apiKey) return;
    const assistants = messages.filter(m => m.role !== 'user');
    if (!assistants.length) return;
    const key = `${conversationId}:${assistants.length}`;
    if (spokenRef.current === key) return;
    spokenRef.current = key;
    const text = renderMessageContent(assistants[assistants.length - 1].content);
    if (!text.trim()) return;
    void speakText(text, keyData.apiKey, voiceSettings.ttsModel, voiceSettings.ttsVoice || undefined).catch(() => {});
  }, [messages, conversationId, voiceSettings, keyData]);
  useEffect(() => {
    spokenRef.current = '';
    stopSpeech();
  }, [conversationId]);

  // Announce-runs toggle: speak terminal run states and fresh approvals.
  const announcedRef = useRef('');
  useEffect(() => {
    if (!voiceSettings?.autoSpeakRuns || !keyData?.apiKey) return;
    if (liveApproval) {
      const key = `approval:${liveApproval.id}`;
      if (announcedRef.current !== key) {
        announcedRef.current = key;
        void speakText(`Approval needed: ${liveApproval.tool}.`, keyData.apiKey, voiceSettings.ttsModel, voiceSettings.ttsVoice || undefined).catch(() => {});
      }
      return;
    }
    if (!run || run.status === 'running') return;
    const key = `run:${run.id}:${run.status}`;
    if (announcedRef.current === key) return;
    announcedRef.current = key;
    const phrase = run.status === 'done'
      ? `Run ${run.id} finished.`
      : run.status === 'error'
        ? `Run ${run.id} failed.`
        : run.status === 'stopped' ? `Run ${run.id} stopped.` : null;
    if (phrase) void speakText(phrase, keyData.apiKey, voiceSettings.ttsModel, voiceSettings.ttsVoice || undefined).catch(() => {});
  }, [run, liveApproval, voiceSettings, keyData]);

  function refreshConversation() {
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    if (conversationId !== null) void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
  }

  async function deleteMessage(index: number) {
    if (conversationId === null) return;
    try {
      await apiFetch(`/api/conversations/${conversationId}`, {
        method: 'PUT',
        body: JSON.stringify({ messages: messages.filter((_, i) => i !== index) }),
      });
      pushToast('ok', 'Message deleted');
      refreshConversation();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function branchFrom(index: number) {
    try {
      const branched = await apiFetch<Conversation>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({
          title: `${conversation?.title ?? 'Chat'} (branch)`,
          model: conversation?.model ?? undefined,
          messages: messages.slice(0, index + 1),
        }),
      });
      setConversationId(branched.id);
      pushToast('ok', 'Branched into a new chat');
      refreshConversation();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Branch failed');
    }
  }

  async function editMessage(index: number) {
    if (conversationId === null) return;
    const text = renderMessageContent((messages[index] as { content?: unknown })?.content);
    try {
      // Truncate the transcript at the edited message, then hand its text to
      // the input box; sending resumes the conversation from the edit.
      await apiFetch(`/api/conversations/${conversationId}`, {
        method: 'PUT',
        body: JSON.stringify({ messages: messages.slice(0, index) }),
      });
      setEditDraft({ text, seq: Date.now() });
      refreshConversation();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Edit failed');
    }
  }

  const header = run ? run.goal : conversation?.title || 'New chat';
  const showEmpty = !conversationId && !activeRunId && !streamingReply;
  // The plan-mode step holds free-form plan text; render numbered/bulleted
  // lines as the checklist, with progress from the run's own status.
  const planStep = run?.steps.find(s => s.kind === 'plan');
  const planText = typeof planStep?.content.text === 'string' ? planStep.content.text : '';
  const planItems = planText
    .split('\n')
    .map(line => line.replace(/^\s*(?:\d+[.)]\s*|[-*]\s*(?:\[[ xX]\]\s*)?)/, '').trim())
    .filter(line => line.length > 0)
    .slice(0, 12)
    .map((label, i) => ({
      id: `plan-${i}`,
      label,
      status: (run?.status === 'done'
        ? 'done'
        : run?.status === 'error'
          ? i === 0 ? 'failed' : 'pending'
          : i === 0 ? 'running' : 'pending') as 'pending' | 'running' | 'done' | 'failed',
    }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OfflineBanner />
      <KeyBanner />
      <RunErrorBanner />
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <span className="truncate text-[13px] font-semibold">{header}</span>
        {run && (
          <span className="font-mono text-[11px] text-ink-dim">
            {run.prompt_tokens + run.completion_tokens} tokens · ${run.cost_usd.toFixed(2)} · {run.status}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {showEmpty && (
          <EmptyState
            icon={<Sparkles className="size-5" strokeWidth={1.5} />}
            title="What should the agent do?"
            body="Ask a question, plan a change, or let the agent edit. Attach files with @."
            action={
              <span className="mt-2 flex flex-wrap justify-center gap-1.5">
                {['Fix failing tests', 'Explain this repo', 'Add dark mode'].map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setDictation({ text: s, seq: Date.now() })}
                    className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-1 focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {s}
                  </button>
                ))}
              </span>
            }
          />
        )}
        {run && planItems.length > 0 && <PlanCard key={run.id} steps={planItems} />}
        {run && <RunTimeline steps={run.steps} runStatus={run.status} runId={run.id} />}
        {run?.final_answer && (
          <MessageBubble message={{ id: `final-${run.id}`, role: 'assistant', text: formatFinalAnswer(run.final_answer), ts: formatTs(run.finished_at), model: run.model ?? undefined }} />
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            message={{
              id: `m${i}`,
              role: m.role === 'user' ? 'user' : 'assistant',
              text: renderMessageContent(m.content),
              ts: '',
              model: conversation?.model ?? undefined,
              media: extractMessageMedia(m.content),
              isError: m.isError,
              latencyMs: typeof m.meta?.latency === 'number' ? m.meta.latency : undefined,
            }}
            onDelete={() => void deleteMessage(i)}
            onBranch={m.role === 'user' ? undefined : () => void branchFrom(i)}
            onEdit={m.role === 'user' ? () => void editMessage(i) : undefined}
          />
        ))}
        {streamingReply !== null && (
          <MessageBubble message={{ id: 'streaming', role: 'assistant', text: streamingReply || '…', ts: '' }} />
        )}
        {liveApproval && (
          <ApprovalPrompt
            tool={liveApproval.tool}
            approval={{
              id: String(liveApproval.id),
              kind: liveApproval.tool === 'shell_exec' ? 'command' : liveApproval.tool.includes('delete') ? 'delete' : 'network',
              command: liveApproval.summary || liveApproval.tool,
              cwd: 'run workspace',
              risk: (liveApproval.risk as 'low' | 'medium' | 'high') ?? 'medium',
            }}
          />
        )}
      </div>
    </div>
  );
}
