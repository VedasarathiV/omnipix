import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AtSign, FileText, Image as ImageIcon, LayoutTemplate, Mic, Paperclip, Send, Slash, Square, X } from 'lucide-react';
import { useStudio } from '../state/store';
import { ModelPicker } from './ModelPicker';
import { apiFetch, streamChat } from '../lib/api';
import {
  buildChipContext,
  distinctiveWords,
  expandFileTemplate,
  parseCommandName,
  parseSlashCommand,
  SLASH_COMMANDS,
  stripSkillFrontmatter,
  type ResolvedChip,
} from '../lib/compose';
import { readSampling } from './SettingsModal';
import { startDictationRecording, transcribeAudio, type DictationRecorder } from '../lib/voice';
import { useCommands, useConversation, useDocs, useMentionFiles, useSkills, useUnifiedKey, useVoiceSettings, type AgentRun, type Conversation, type DocRow, type FileContent } from '../lib/queries';

// Slash menu entries come from lib/compose (single source with the parser).
const SLASH = SLASH_COMMANDS;


const TEMPLATES = [
  { name: 'Bug fix', text: 'Reproduce the bug, write a failing test, fix it, then run the suite. Bug: ' },
  { name: 'Code review', text: 'Review the current diff for bugs, security issues, and performance. Be specific with file:line.' },
  { name: 'Explain', text: 'Explain how this code works, starting from the entry point: ' },
  { name: 'Refactor', text: 'Refactor for clarity without changing behavior. Keep the diff minimal: ' },
];

const ATTACH_TEXT_MAX_BYTES = 100 * 1024;
const ATTACH_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const CHUNKS_PER_CHIP = 3;

export function InputBar() {
  const {
    mode, setMode, model, pushToast, conversationId, setConversationId,
    setActiveRunId, setStreamingReply, dictation, editDraft, setEditDraft,
    activeRunId, fileRoot,
  } = useStudio();
  const queryClient = useQueryClient();
  const { data: keyData } = useUnifiedKey();
  const { data: conversation } = useConversation(conversationId);
  const { data: docsData } = useDocs();
  const { data: voiceSettings } = useVoiceSettings();
  const { data: commandsData } = useCommands();
  const { data: skillsData } = useSkills();
  const fileCommands = commandsData?.commands ?? [];
  const enabledSkills = (skillsData?.skills ?? []).filter(s => s.enabled);
  const [recorder, setRecorder] = useState<DictationRecorder | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const lastDictationSeq = useRef(-1);
  const lastEditSeq = useRef(-1);

  // Floating-mic takes land here.
  useEffect(() => {
    if (dictation && dictation.seq !== lastDictationSeq.current) {
      lastDictationSeq.current = dictation.seq;
      setText(current => (current ? `${current} ${dictation.text}` : dictation.text));
      boxRef.current?.focus();
    }
  }, [dictation]);

  // Message edits replace the box content (resend continues from the edit).
  useEffect(() => {
    if (editDraft && editDraft.seq !== lastEditSeq.current) {
      lastEditSeq.current = editDraft.seq;
      setText(editDraft.text);
      setEditDraft(null);
      boxRef.current?.focus();
    }
  }, [editDraft, setEditDraft]);

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
  const docs = docsData?.docs ?? [];
  const mentionFiles = docs.map(d => d.source_url);
  // Prompt history (↑): the current conversation's own user messages, newest first.
  const history = (conversation?.messages ?? [])
    .filter(m => m.role === 'user' && typeof m.content === 'string')
    .map(m => m.content as string)
    .reverse();
  const [text, setText] = useState('');
  const [chips, setChips] = useState<string[]>([]);
  const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [menu, setMenu] = useState<'slash' | 'mention' | 'templates' | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [histIdx, setHistIdx] = useState(-1);
  const [sending, setSending] = useState(false);
  const mentionToken = /@(\w*)$/.exec(text)?.[1] ?? '';
  const { data: mentionFileData } = useMentionFiles(activeRunId, fileRoot, mentionToken);
  const mentionFileHits = (mentionFileData?.hits ?? []).slice(0, 8);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  function docFor(url: string): DocRow | undefined {
    return docs.find(d => d.source_url === url);
  }

  /** Resolve attached docs to their top chunks for the given goal text. */
  async function resolveChips(urls: string[], goal: string): Promise<ResolvedChip[]> {
    const out: ResolvedChip[] = [];
    const goalQuery = distinctiveWords(goal, 6).join(' ');
    for (const url of urls) {
      const doc = docFor(url);
      if (!doc) continue;
      // Goal-matched chunks first, then title-matched, then each title
      // word alone — the search ANDs every word, so multi-word queries
      // narrow fast and single words are the widest honest net.
      const titleWords = distinctiveWords(doc.title, 4);
      let chunks: Array<{ section: string; content: string }> = [];
      for (const q of [goalQuery, titleWords.join(' '), ...titleWords]) {
        try {
          const res = await apiFetch<{ chunks: Array<{ section: string; content: string }> }>(
            `/api/memories/docs/search?project=${encodeURIComponent(doc.project_key)}&q=${encodeURIComponent(q)}&url=${encodeURIComponent(url)}&limit=${CHUNKS_PER_CHIP}`,
          );
          if (res.chunks.length) { chunks = res.chunks; break; }
        } catch {
          // One unresolvable chip must not block the send.
        }
      }
      out.push({ url, title: doc.title, chunks });
    }
    return out;
  }

  function withChipContext(goal: string, resolved: ResolvedChip[]): string {
    return buildChipContext(goal, resolved);
  }

  function handleAttachClick() {
    fileRef.current?.click();
  }

  /** Inline a workspace/folder file picked from the @ menu. */
  async function attachWorkspaceFile(path: string) {
    setText(t => t.replace(/@\w*$/, ''));
    setMenu(null);
    try {
      const file = fileRoot
        ? await apiFetch<FileContent>(`/api/fs/read?root=${encodeURIComponent(fileRoot)}&path=${encodeURIComponent(path)}`)
        : await apiFetch<FileContent>(`/api/agents/runs/${activeRunId}/files/content?path=${encodeURIComponent(path)}`);
      if (file.binary || !file.content) {
        pushToast('error', 'That file has no readable text.');
        return;
      }
      inlineText(path, file.content);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Could not read file');
    } finally {
      boxRef.current?.focus();
    }
  }

  async function handleAttachFile(file: File) {
    if (IMAGE_MIMES.includes(file.type)) {
      if (mode !== 'ask') {
        setMode('ask');
        pushToast('info', 'Switched to Ask mode — images send in Ask mode.');
      }
      if (file.size > ATTACH_IMAGE_MAX_BYTES) {
        pushToast('error', `Image too large (${Math.round(file.size / 1024 / 1024)} MB; 5 MB max).`);
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      }).catch(() => null);
      if (!dataUrl) {
        pushToast('error', 'Could not read that image.');
        return;
      }
      setImage({ name: file.name, dataUrl });
      return;
    }
    // PDFs extract server-side, then flow through the same inline path.
    let fileName = file.name;
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      if (file.size > 5 * 1024 * 1024) {
        pushToast('error', `PDF too large (${Math.round(file.size / 1024 / 1024)} MB; 5 MB max).`);
        return;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const parsed = await apiFetch<{ text: string; pages?: number }>(
          '/api/uploads/parse-pdf',
          { method: 'POST', body: JSON.stringify({ filename: file.name, dataBase64: btoa(binary) }) },
        );
        fileName = `${file.name}${parsed.pages ? ` (${parsed.pages}p)` : ''}`;
        inlineText(fileName, parsed.text);
        return;
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : 'PDF parse failed');
        return;
      }
    }
    const content = await file.text().catch(() => null);
    if (content === null || content.includes('\0')) {
      pushToast('error', 'Only text files, PDFs, and images attach — that file looks binary.');
      return;
    }
    inlineText(fileName, content, Math.round(file.size / 1024));
  }

  /** Shared inline path: over-cap text truncates with a loud notice instead
   *  of refusing, so the model sees the head and knows it is partial. */
  function inlineText(displayName: string, content: string, totalKb?: number) {
    const body = content.trim();
    const total = totalKb ?? Math.max(1, Math.round(body.length / 1024));
    const clipped = body.length > ATTACH_TEXT_MAX_BYTES
      ? `${body.slice(0, ATTACH_TEXT_MAX_BYTES)}\n[... truncated: showing first 100 KB of ${Math.max(101, total)} KB]`
      : body;
    if (clipped !== body) {
      pushToast('info', `Attached first 100 KB of ${displayName} (${Math.max(101, total)} KB total).`);
    }
    setText(current => `${current}${current && !current.endsWith('\n') ? '\n' : ''}\n--- attached file: ${displayName} ---\n${clipped}\n`);
    boxRef.current?.focus();
  }

  async function send() {
    let goal = text.trim();
    if ((!goal && !image) || sending) return;
    // Ask mode has no server expansion (plain chat): expand file commands
    // and inline /skills locally. Agent/plan go raw; the server expands.
    // Builtins (/clear, /plan, /test…) always win over same-named files.
    if (mode === 'ask' && parseSlashCommand(goal).kind === 'none') {
      const candidate = parseCommandName(goal);
      const file = candidate && fileCommands.find(c => c.name === candidate.name);
      if (candidate && file) {
        goal = expandFileTemplate(file.template, candidate.input);
      } else if (candidate && enabledSkills.some(s => s.name === candidate.name)) {
        try {
          const exported = await apiFetch<{ content: string }>(`/api/skills/${candidate.name}/export`);
          goal = `--- skill: ${candidate.name} ---\n${stripSkillFrontmatter(exported.content)}\n\n--- user request ---\n${candidate.input || goal}`;
        } catch {
          // Unresolvable skill must not block the send; raw text still goes.
        }
      }
    }
    // Slash commands: /clear and /plan act, the rest expand to real prompts.
    const slash = parseSlashCommand(goal);
    if (slash.kind === 'clear') {
      setConversationId(null);
      setActiveRunId(null);
      setText('');
      setChips([]);
      setImage(null);
      setMenu(null);
      setHistIdx(-1);
      pushToast('ok', 'Started a new chat');
      return;
    }
    if (slash.kind === 'plan') {
      setMode('plan');
      if (!slash.rest) {
        setText('');
        setMenu(null);
        pushToast('info', 'Plan mode on — describe the change to draft a plan');
        return;
      }
      goal = slash.rest;
    } else if (slash.kind === 'expand') {
      goal = slash.text;
    }
    if (mode === 'image' || mode === 'video' || mode === 'audio') {
      if (image) {
        pushToast('error', 'Generation modes take a text prompt only — remove the attachment first.');
        return;
      }
      await sendMedia(mode, goal);
      setText('');
      setMenu(null);
      setHistIdx(-1);
      return;
    }
    setSending(true);
    try {
      const resolved = await resolveChips(chips, goal);
      const full = withChipContext(goal, resolved);
      if (mode === 'ask') {
        await sendChat(full, image?.dataUrl ?? null);
      } else {
        // Images attach in Ask mode only; a mode switch after attaching must
        // refuse loudly rather than silently drop the image.
        if (image) {
          pushToast('error', 'Images send in Ask mode — remove it or switch back to Ask.');
          return;
        }
        const run = await apiFetch<AgentRun>('/api/agents/runs', {
          method: 'POST',
          body: JSON.stringify({ goal: full, model, planMode: mode === 'plan' }),
        });
        setConversationId(null);
        setActiveRunId(run.id);
        pushToast('info', mode === 'plan' ? `Plan requested (run #${run.id})` : `Agent running (#${run.id})`);
        void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
      }
      setText('');
      setChips([]);
      setImage(null);
      setMenu(null);
      setHistIdx(-1);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  /** Blob → base64 data URL (generation results persist inside the message). */
  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(blob);
    });
  }

  /** Image / video / audio generation turns: prompt in, playable media out,
   *  persisted as message parts so results survive reloads. No CLI needed. */
  async function sendMedia(kind: 'image' | 'video' | 'audio', prompt: string) {
    const apiKey = keyData?.apiKey;
    if (!apiKey) {
      pushToast('error', 'No unified API key — add a provider key first.');
      return;
    }
    const label = kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'audio';
    let convId = conversationId;
    if (convId === null) {
      const created = await apiFetch<Conversation>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ title: prompt.slice(0, 80), model, messages: [] }),
      });
      convId = created.id;
      setConversationId(convId);
    }
    const base = (conversation?.messages ?? []).map(m => ({ role: m.role, content: m.content }));
    const withUser = [...base, { role: 'user', content: prompt }];
    await apiFetch(`/api/conversations/${convId}`, { method: 'PUT', body: JSON.stringify({ messages: withUser }) });
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['conversation', convId] });
    setStreamingReply(`Generating ${label}…`);
    // First image on a fresh install: no anonymous rows exist yet. The send
    // itself is the opt-in — enable free image generation once, say so, and
    // retry. Audio and video keep their honest errors (anonymous TTS flakes
    // upstream 401s, so it is not promised keyless; video needs a real key).
    let enabledOnce = false;
    const enableFree = async () => {
      if (enabledOnce || kind !== 'image') return false;
      enabledOnce = true;
      await apiFetch('/api/media/keyless', { method: 'POST' });
      pushToast('info', 'Free image generation on — no key needed.');
      return true;
    };
    try {
      let part: unknown;
      if (kind === 'image') {
        const runImage = async () => {
          const res = await fetch('/v1/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ prompt, n: 1 }),
          });
          const data = await res.json().catch(() => null) as { data?: Array<{ b64_json?: string; url?: string }>; error?: { message?: string } } | null;
          if ((res.status === 502 || res.status === 503) && (await enableFree())) return runImage();
          if (!res.ok) throw new Error(data?.error?.message ?? `Image failed (${res.status})`);
          return data;
        };
        const data = await runImage();
        const first = data?.data?.[0];
        let url = first?.url;
        if (!url && first?.b64_json) {
          // Providers return PNG, JPEG, or WebP bytes — sniff the magic so
          // the data URL carries the true MIME (JPEG bytes labeled PNG fail
          // to paint in some renderers).
          const head = first.b64_json.slice(0, 16);
          const mime = head.startsWith('iVBOR') ? 'image/png'
            : head.startsWith('/9j/') ? 'image/jpeg'
            : head.startsWith('UklGR') ? 'image/webp'
            : 'image/png';
          url = `data:${mime};base64,${first.b64_json}`;
        }
        if (!url) throw new Error('The provider returned no image');
        part = { type: 'image_url', image_url: { url } };
      } else if (kind === 'video') {
        const res = await fetch('/v1/videos/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ prompt }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null) as { error?: { message?: string } } | null;
          throw new Error(data?.error?.message ?? `Video failed (${res.status})`);
        }
        const blob = await res.blob();
        if (blob.size > 12 * 1024 * 1024) throw new Error('Video is over the 12 MB chat cap — try a shorter prompt');
        const url = await blobToDataUrl(blob);
        part = { type: 'video_url', video_url: { url } };
      } else {
        const res = await fetch('/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            input: prompt.slice(0, 2000),
            ...(voiceSettings?.ttsVoice ? { voice: voiceSettings.ttsVoice } : {}),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null) as { error?: { message?: string } } | null;
          throw new Error(data?.error?.message ?? `Audio failed (${res.status})`);
        }
        const url = await blobToDataUrl(await res.blob());
        part = { type: 'audio_url', audio_url: { url } };
      }
      await apiFetch(`/api/conversations/${convId}`, {
        method: 'PUT',
        body: JSON.stringify({
          messages: [...withUser, { role: 'assistant', content: [{ type: 'text', text: `${label[0].toUpperCase()}${label.slice(1)} for: "${prompt.slice(0, 200)}"` }, part] }],
        }),
      });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setStreamingReply(null);
    }
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['conversation', convId] });
  }

  async function sendChat(goal: string, imageDataUrl: string | null) {
    const apiKey = keyData?.apiKey;
    if (!apiKey) {
      pushToast('error', 'No unified API key — add a provider key first.');
      return;
    }
    let convId = conversationId;
    let messages: Array<{ role: string; content: unknown }> = (conversation?.messages ?? []).map(m => ({
      role: m.role,
      content: m.content,
    }));
    if (convId === null) {
      const created = await apiFetch<Conversation>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ title: goal.slice(0, 80), model, messages: [] }),
      });
      convId = created.id;
      setConversationId(convId);
    }
    const userContent: unknown = imageDataUrl
      ? [
          ...(goal ? [{ type: 'text', text: goal }] : []),
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ]
      : goal;
    messages = [...messages, { role: 'user', content: userContent }];
    await apiFetch(`/api/conversations/${convId}`, {
      method: 'PUT',
      body: JSON.stringify({ messages }),
    });
    setStreamingReply('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const start = Date.now();
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
      const full = await streamChat('/v1/chat/completions', apiKey, payload, setStreamingReply, controller.signal);
      await apiFetch(`/api/conversations/${convId}`, {
        method: 'PUT',
        body: JSON.stringify({ messages: [...messages, { role: 'assistant', content: full, meta: { latency: Date.now() - start } }] }),
      });
    } catch (err) {
      // Stopping is deliberate — keep the prompt, drop the stream, no noise.
      if (err instanceof Error && err.name === 'AbortError') return;
      // Failures persist as error turns (red bubble) instead of vanishing and
      // leaving the user's message hanging with no reply.
      const message = err instanceof Error ? err.message : 'Send failed';
      try {
        await apiFetch(`/api/conversations/${convId}`, {
          method: 'PUT',
          body: JSON.stringify({ messages: [...messages, { role: 'assistant', content: message, isError: true }] }),
        });
      } catch {
        pushToast('error', message);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreamingReply(null);
    }
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['conversation', convId] });
  }

  return (
    <div className="shrink-0 border-t border-line bg-base-1 p-3">
      {chips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached context">
          {chips.map(c => {
            const doc = docFor(c);
            return (
              <span key={c} title={c} className="flex items-center gap-1 rounded-md bg-base-2 py-1 pr-1 pl-2 font-mono text-[11px]">
                {doc?.title ?? c} <span className="text-ink-faint">{doc ? `${doc.chunks} chunks` : ''}</span>
                <button
                  type="button"
                  aria-label={`Remove ${c}`}
                  onClick={() => setChips(list => list.filter(x => x !== c))}
                  className="rounded p-0.5 text-ink-faint outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <X className="size-3" strokeWidth={1.5} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {image && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-base-2 px-2 py-1.5">
          <ImageIcon className="size-4 text-ink-dim" strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{image.name}</span>
          <button
            type="button"
            aria-label={`Remove ${image.name}`}
            onClick={() => setImage(null)}
            className="rounded p-0.5 text-ink-faint outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="size-3" strokeWidth={1.5} />
          </button>
        </div>
      )}
      <div
        className="relative"
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleAttachFile(file);
        }}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-base-0/80 text-sm font-medium text-ink-dim">
            Drop to attach
          </div>
        )}
        {menu === 'slash' && (
          <Menu onClose={() => setMenu(null)}>
            {SLASH.map(s => (
              <button key={s.cmd} type="button" onClick={() => { setText(s.cmd + ' '); setMenu(null); boxRef.current?.focus(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-base-2">
                <Slash className="size-3.5 text-accent" strokeWidth={1.5} />
                <span className="font-mono">{s.cmd}</span>
                <span className="truncate text-xs text-ink-dim">{s.desc}</span>
              </button>
            ))}
            {fileCommands.length > 0 && (
              <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">Commands</p>
            )}
            {fileCommands.map(c => (
              <button key={`cmd-${c.name}`} type="button" onClick={() => { setText(`/${c.name} `); setMenu(null); boxRef.current?.focus(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-base-2">
                <Slash className="size-3.5 text-ink-dim" strokeWidth={1.5} />
                <span className="font-mono">/{c.name}</span>
                <span className="truncate text-xs text-ink-dim">{c.description}</span>
              </button>
            ))}
            {enabledSkills.length > 0 && (
              <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">Skills</p>
            )}
            {enabledSkills.map(s => (
              <button key={`skill-${s.name}`} type="button" onClick={() => { setText(`/${s.name} `); setMenu(null); boxRef.current?.focus(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-base-2">
                <Slash className="size-3.5 text-ink-dim" strokeWidth={1.5} />
                <span className="font-mono">/{s.name}</span>
                <span className="truncate text-xs text-ink-dim">{s.description}</span>
              </button>
            ))}
          </Menu>
        )}
        {menu === 'mention' && (
          <Menu onClose={() => setMenu(null)}>
            {mentionFiles.filter(f => f.toLowerCase().includes(mentionToken.toLowerCase())).map(f => (
              <button key={f} type="button" onClick={() => { setChips(list => [...new Set([...list, f])]); setText(t => t.replace(/@\w*$/, '')); setMenu(null); boxRef.current?.focus(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-xs outline-none hover:bg-base-2">
                <AtSign className="size-3.5 text-accent" strokeWidth={1.5} />{f}
              </button>
            ))}
            {mentionFileHits.length > 0 && (
              <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
                {fileRoot ? 'Folder files' : 'Workspace files'}
              </p>
            )}
            {mentionFileHits.map(h => (
              <button key={`${h.path}:${h.line}`} type="button" onClick={() => void attachWorkspaceFile(h.path)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-base-2">
                <FileText className="size-3.5 shrink-0 text-ink-dim" strokeWidth={1.5} />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs">{h.path}:{h.line}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-dim">{h.text.trim()}</span>
                </span>
              </button>
            ))}
            {mentionFiles.length === 0 && mentionFileHits.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-ink-faint">
                {mentionToken.length >= 2 && activeRunId === null && !fileRoot
                  ? 'Open a folder or start a run to search files.'
                  : 'No ingested docs — add URLs on the Docs page.'}
              </p>
            )}
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
          placeholder={
            mode === 'image' ? 'Describe the image to generate…'
              : mode === 'video' ? 'Describe the video to generate…'
                : mode === 'audio' ? 'Text to speak…'
                  : 'Ask, plan, or instruct the agent… (@ for files, / for commands)'
          }
          aria-label="Message input"
          className="w-full resize-none rounded-xl border border-line bg-base-0 px-3 pt-2.5 pb-11 text-sm outline-none placeholder:text-ink-faint focus:border-ink-faint"
        />
        <input
          ref={fileRef}
          type="file"
          aria-hidden
          tabIndex={-1}
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleAttachFile(file);
          }}
        />
        <div className="absolute right-2 bottom-2 left-2 flex items-center gap-1">
          <IconBtn label="Attach file or image" onClick={handleAttachClick}><Paperclip className="size-4" strokeWidth={1.5} /></IconBtn>
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
            <option value="image">Image</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
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
          {sending ? (
            <button
              type="button"
              aria-label="Stop response"
              title="Stop response"
              onClick={() => abortRef.current?.abort()}
              className="flex size-8 items-center justify-center rounded-lg bg-bad text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Square className="size-4" strokeWidth={1.5} />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send (Enter)"
              onClick={() => void send()}
              disabled={!text.trim() && !image}
              className="flex size-8 items-center justify-center rounded-lg bg-accent text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            >
              <Send className="size-4" strokeWidth={1.5} />
            </button>
          )}
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
