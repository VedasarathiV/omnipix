import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AtSign, LayoutTemplate, Mic, Paperclip, Send, Slash, X } from 'lucide-react';
import { useStudio } from '../state/store';
import { ModelPicker } from './ModelPicker';
import { apiFetch, streamChat } from '../lib/api';
import { readSampling } from './SettingsModal';
import { startDictationRecording, transcribeAudio, type DictationRecorder } from '../lib/voice';
import { useConversation, useDocs, useUnifiedKey, useVoiceSettings, type AgentRun, type Conversation } from '../lib/queries';

const SLASH = [
  { cmd: '/plan', desc: 'Draft a plan for approval' },
  { cmd: '/test', desc: 'Run the test suite' },
  { cmd: '/fix', desc: 'Fix the last failure' },
  { cmd: '/explain', desc: 'Explain the selected code' },
  { cmd: '/commit', desc: 'Suggest a commit message' },
  { cmd: '/clear', desc: 'Clear this chat' },
];


const TEMPLATES = [
  { name: 'Bug fix', text: 'Reproduce the bug, write a failing test, fix it, then run the suite. Bug: ' },
  { name: 'Code review', text: 'Review the current diff for bugs, security issues, and performance. Be specific with file:line.' },
  { name: 'Explain', text: 'Explain how this code works, starting from the entry point: ' },
  { name: 'Refactor', text: 'Refactor for clarity without changing behavior. Keep the diff minimal: ' },
];

export function InputBar() {
  const {
    mode, setMode, model, pushToast, conversationId, setConversationId,
    setActiveRunId, setStreamingReply, dictation,
  } = useStudio();
  const queryClient = useQueryClient();
  const { data: keyData } = useUnifiedKey();
  const { data: conversation } = useConversation(conversationId);
  const { data: docsData } = useDocs();
  const { data: voiceSettings } = useVoiceSettings();
  const [recorder, setRecorder] = useState<DictationRecorder | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const lastDictationSeq = useRef(-1);

  // Floating-mic takes land here.
  useEffect(() => {
    if (dictation && dictation.seq !== lastDictationSeq.current) {
      lastDictationSeq.current = dictation.seq;
      setText(current => (current ? `${current} ${dictation.text}` : dictation.text));
      boxRef.current?.focus();
    }
  }, [dictation]);

  async function toggleDictation() {
    if (recorder) {
      const take = await recorder.stop().catch((err: unknown) => {
        pushToast('error', err instanceof Error ? err.message : 'Recording failed');
        return null;
      });
      setRecorder(null);
      if (!take) return;
      if (!keyData?.apiKey) {
        pushToast('error', 'Add a provider key before dictating.');
        return;
      }
      setTranscribing(true);
      try {
        const text = await transcribeAudio(take.blob, take.filename, keyData.apiKey, voiceSettings?.sttModel ?? 'auto');
        if (text.trim()) setText(current => (current ? `${current} ${text.trim()}` : text.trim()));
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : 'Transcription failed');
      } finally {
        setTranscribing(false);
      }
      return;
    }
    try {
      setRecorder(await startDictationRecording());
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Microphone unavailable');
    }
  }
  const mentionFiles = (docsData?.docs ?? []).map(d => d.source_url);
  // Prompt history (↑): the current conversation's own user messages, newest first.
  const history = (conversation?.messages ?? [])
    .filter(m => m.role === 'user' && typeof m.content === 'string')
    .map(m => m.content as string)
    .reverse();
  const [text, setText] = useState('');
  const [chips, setChips] = useState<string[]>([]);
  const [menu, setMenu] = useState<'slash' | 'mention' | 'templates' | null>(null);
  const [histIdx, setHistIdx] = useState(-1);
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  async function send() {
    const goal = text.trim();
    if (!goal || sending) return;
    setSending(true);
    try {
      if (mode === 'ask') {
        await sendChat(goal);
      } else {
        const run = await apiFetch<AgentRun>('/api/agents/runs', {
          method: 'POST',
          body: JSON.stringify({ goal, model, planMode: mode === 'plan' }),
        });
        setConversationId(null);
        setActiveRunId(run.id);
        pushToast('info', mode === 'plan' ? `Plan requested (run #${run.id})` : `Agent running (#${run.id})`);
        void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
      }
      setText('');
      setMenu(null);
      setHistIdx(-1);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  async function sendChat(goal: string) {
    const apiKey = keyData?.apiKey;
    if (!apiKey) {
      pushToast('error', 'No unified API key — add a provider key first.');
      return;
    }
    let convId = conversationId;
    let messages: Array<{ role: string; content: string }> = (conversation?.messages ?? []).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
    if (convId === null) {
      const created = await apiFetch<Conversation>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ title: goal.slice(0, 80), model, messages: [] }),
      });
      convId = created.id;
      setConversationId(convId);
    }
    messages = [...messages, { role: 'user', content: goal }];
    await apiFetch(`/api/conversations/${convId}`, {
      method: 'PUT',
      body: JSON.stringify({ messages }),
    });
    setStreamingReply('');
    try {
      const sampling = readSampling();
      const system = conversation?.systemPrompt?.trim();
      const payload: Record<string, unknown> = {
        model,
        messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
        ...(sampling.temp[0] ? { temperature: sampling.temp[1] } : {}),
        ...(sampling.topP[0] ? { top_p: sampling.topP[1] } : {}),
        ...(sampling.maxTok[0] ? { max_tokens: sampling.maxTok[1] } : {}),
      };
      const full = await streamChat('/v1/chat/completions', apiKey, payload, setStreamingReply);
      await apiFetch(`/api/conversations/${convId}`, {
        method: 'PUT',
        body: JSON.stringify({ messages: [...messages, { role: 'assistant', content: full }] }),
      });
    } finally {
      setStreamingReply(null);
    }
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['conversation', convId] });
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
            {mentionFiles.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-ink-faint">No ingested docs — add URLs on the Docs page.</p>
            )}
            {mentionFiles.map(f => (
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
            if (e.key === 'ArrowUp' && !text && histIdx < history.length - 1) {
              e.preventDefault();
              const next = histIdx + 1;
              setHistIdx(next);
              setText(history[next]);
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
          <ModelPicker compact />
          <div className="flex-1" />
          <span className={recorder ? 'animate-pulse rounded-md bg-bad/20' : transcribing ? 'animate-pulse' : ''}>
            <IconBtn
              label={recorder ? 'Stop and transcribe' : transcribing ? 'Transcribing…' : 'Dictate (mic)'}
              onClick={() => void toggleDictation()}
            >
              <Mic className={`size-4 ${recorder ? 'text-bad' : ''}`} strokeWidth={1.5} />
            </IconBtn>
          </span>
          <button
            type="button"
            aria-label="Send (Enter)"
            onClick={() => void send()}
            disabled={!text.trim() || sending}
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
