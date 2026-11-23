import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { BookOpenText, Bot, ChevronRight, CircleAlert, FileText, FolderGit2, Globe, PanelRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiFetch } from '@/lib/api'
import { buildModelOptions } from '@/lib/model-groups'
import type { Chain } from '@/components/chain-manager'
import { Markdown } from '@/components/markdown'
import { ArtifactHostContext } from '@/lib/artifact-host'
import { CodeHostContext } from '@/lib/code-host'
import { ArtifactPanel, ARTIFACT_PANEL_TRANSITION_MS } from '@/components/playground/artifact-panel'
import { CodePane, CODE_PANE_TRANSITION_MS } from '@/components/playground/code-pane'
import { ARTIFACT_WIDTH_STORAGE_KEY, CONVERSATION_RAIL_COLLAPSED_WIDTH, CONVERSATION_RAIL_OPEN_WIDTH, WORKBENCH_CHROME_WIDTH, clampArtifactWidth, readArtifactWidth } from '@/lib/artifact-panel-size'
import { extractArtifacts, extractCodeFiles, type Artifact, type ArtifactKind, type CodeFile } from '@/lib/artifacts'
import { CopyButton } from '@/components/copy-button'
import { SpeakButton } from '@/components/speak-button'
import { toast } from '@/lib/toast'
import {
  ACCEPT_ATTRIBUTE,
  AttachmentError,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_TEXT_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  attachmentImages,
  classifyFile,
  composeText,
  dataUrlBytes,
  detectMention,
  docsContextMessage,
  filterMentionDocs,
  filterMentionFiles,
  formatBytes,
  isMentionableFile,
  parsePdfAttachment,
  readImageAttachment,
  readTextAttachment,
  splitMessageAttachments,
  toMessageContent,
  type Attachment,
  type DocChunk,
  type IngestedDoc,
} from '@/lib/attachments'
import { readChatStream } from '@/lib/playground-stream'
import { speakText, useVoiceSettings } from '@/lib/speech'
import { canPickFolder, pickFolderTree, readFolderTree } from '@/lib/desktop-folder'
import { OPEN_PANEL_EVENT, pinFolderContext, useOpenFolder } from '@/lib/open-folder'
import { MentionPicker } from '@/components/playground/mention-picker'
import { parseSlashCommand, slashSkillsMessage, type SlashSkill } from '@/lib/slash-skills'
import { CONVERSATIONS_CHANGED_EVENT, NEW_CONVERSATION_EVENT, OPEN_CONVERSATION_EVENT, OPEN_FOLDER_EVENT } from '@/lib/workbench'
import { ConversationSidebar } from '@/components/playground/conversation-sidebar'
import { SettingsRail } from '@/components/playground/settings-rail'
import { LiquidComposer } from '@/components/playground/liquid-composer'
import { SearchSources } from '@/components/playground/search-sources'
import { searchContextMessage, searchProviderName, searchReadinessHint, type SearchResult } from '@/lib/search'
import { useSearchReadiness } from '@/hooks/use-search-readiness'
import { ModelMakerIcon } from '@/components/model-maker-icon'
import { BrandMark } from '@/components/brand'
import { composerHasContent } from '@/lib/composer-geometry'
import {
  DICTATION_AUTO,
  DICTATION_MODEL_STORAGE_KEY,
  appendDictation,
  hasTranscription,
  resolveDictationModel,
  transcriptionOptions,
  type TranscriptionModelRow,
} from '@/lib/transcription'
import {
  readSampling,
  samplingRequestParams,
  writeSampling,
  type SamplingRequestParams,
  type SamplingSettings,
} from '@/lib/playground-sampling'
import {
  SIDEBAR_OPEN_KEY,
  autoTitle,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  readActiveConversationId,
  toStoredMessages,
  updateConversation,
  writeActiveConversationId,
  type ChatMessage,
  type WebSearchMeta,
  type ConversationSummary,
  type FusionPanelEntry,
  type GeneratedMedia,
} from '@/lib/playground-conversations'
import { useI18n } from '@/i18n'

// One Server-Sent-Event frame from a chat/fusion stream: fusion control frames,
// OpenAI error envelopes, or choice deltas.
interface SseFrame {
  _fusion?: {
    event?: string
    platform?: string
    model?: string
    status?: string
    content?: string
    error?: string
  }
  error?: { message?: string }
  choices?: Array<{ delta?: { content?: string } }>
}

interface FallbackEntry {
  modelDbId: number
  priority: number
  enabled: boolean
  platform: string
  modelId: string
  canonicalId?: string
  displayName: string
  sizeLabel: string
  intelligenceRank: number
  supportsVision: boolean
  keyCount: number
}

// ChatMessage / FusionPanelEntry now live in lib/playground-conversations.ts:
// the transcript is persisted, so its shape is shared with the storage layer
// rather than owned by this component.

// Render a fusion panel/judge entry as "platform/model", but avoid doubling
// the provider when the model id already carries it (e.g. openrouter/owl-alpha,
// groq/compound) — those would otherwise read "openrouter/openrouter/owl-alpha".
function fusionRouteLabel(p: { platform: string; model: string }): string {
  return p.model.startsWith(`${p.platform}/`) ? p.model : `${p.platform}/${p.model}`
}

// Smooth show/hide for the Playground's tucked-away detail (thinking, web
// sources, the fusion panel). The content stays mounted and the row animates
// from 0fr to 1fr, so it opens to its natural height without measuring;
// `inert` keeps a closed panel's links out of the tab order.
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      data-open={open}
      className="grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none data-[open=false]:opacity-0"
      style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

// User messages carry inlined attachment blocks (folder trees, file text)
// that can run to hundreds of lines. Render what was typed plainly and tuck
// each attachment behind a <details> row showing its name + size.
function UserMessageContent({ content }: { content: string }) {
  const { text, attachments } = useMemo(() => splitMessageAttachments(content), [content])
  if (attachments.length === 0) {
    return <div className="whitespace-pre-wrap">{content}</div>
  }
  return (
    <div className="min-w-0">
      {text.trim() && <div className="whitespace-pre-wrap">{text}</div>}
      <div className="mt-1.5 flex flex-col gap-1">
        {attachments.map((a, i) => {
          const lines = a.body.split('\n').length
          return (
            <details key={`${a.name}-${i}`} className="group rounded-lg border bg-background/60 text-xs">
              <summary className="cursor-pointer list-none px-2.5 py-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <span className="font-mono">{a.name}</span>
                <span className="ml-2 tabular-nums opacity-70">{lines} lines</span>
              </summary>
              <pre className="max-h-64 overflow-auto border-t px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
                {a.body}
              </pre>
            </details>
          )
        })}
      </div>
    </div>
  )
}

// Collapsible, minimal-font trace shown OUTSIDE the main answer bubble: each
// panel model's raw answer as it streamed in, plus the judge that synthesized
// the final answer. Default-open so you can watch it work; collapse to tuck away.
function FusionTrace({ panel, judge, streaming, answerStarted }: {
  panel: FusionPanelEntry[]
  judge?: { platform: string; model: string } | null
  streaming?: boolean
  answerStarted?: boolean
}) {
  const { t } = useI18n()
  // Open while the panel streams in so you can watch it work; auto-collapse the
  // moment the final answer STARTS streaming (first token in the bubble), so it
  // tucks away as the answer takes over — unless the user manually toggled it.
  const [open, setOpen] = useState(true)
  const touched = useRef(false)
  useEffect(() => {
    if (answerStarted && !touched.current) setOpen(false)
  }, [answerStarted])
  return (
    <div className="w-full text-[10px] leading-snug text-muted-foreground/80">
      <button
        type="button"
        onClick={() => { touched.current = true; setOpen(o => !o) }}
        className="inline-flex items-center gap-1 font-mono hover:text-foreground transition-colors"
      >
        <ChevronRight className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        {t('playground.fusionTrace', { count: panel.length })}{streaming ? ' …' : ''}
      </button>
      <Collapse open={open}>
        <div className="mt-1 space-y-2 border-l border-border/60 pl-2.5">
          {panel.map((p, i) => (
            <div key={i} className="space-y-0.5">
              <span className="font-mono font-medium">{fusionRouteLabel(p)}</span>
              {p.status === 'failed'
                ? <span className="ml-1.5 text-amber-600 dark:text-amber-400">{t('playground.fusionFailed')}{p.error ? `: ${p.error}` : ''}</span>
                : p.content
                  ? <div className="whitespace-pre-wrap opacity-80">{p.content}</div>
                  : <span className="ml-1.5 opacity-60">…</span>}
            </div>
          ))}
          {judge && (
            <div className="pt-1.5 border-t border-border/60">
              <span className="font-mono font-medium">{fusionRouteLabel(judge)}</span>
              <span className="ml-1.5 opacity-70">{t('playground.fusionJudgeSynth')}</span>
            </div>
          )}
        </div>
      </Collapse>
    </div>
  )
}

// Thinking tokens, shown INSIDE the assistant bubble above the answer. Same
// visual language as FusionTrace (minimal font, muted, hanging rule, chevron
// toggle) and the same behaviour: open while it streams so you can watch the
// model work, auto-collapsing once the answer itself starts.
function ReplyTrace({ reasoning, search, answerStarted }: {
  reasoning?: string
  search?: WebSearchMeta
  answerStarted?: boolean
}) {
  const { t } = useI18n()
  // Thinking opens while it streams and tucks away once the answer starts.
  // Web sources never open on their own: they are there for the curious, so a
  // searched reply with no thinking starts closed.
  const [open, setOpen] = useState(() => !!reasoning && !answerStarted)
  const touched = useRef(false)
  useEffect(() => {
    if (answerStarted && !touched.current) setOpen(false)
  }, [answerStarted])
  useEffect(() => {
    if (reasoning && !answerStarted && !touched.current) setOpen(true)
  }, [reasoning, answerStarted])
  const sourceCount = search?.sources.length ?? 0
  return (
    <div className="mb-2 text-muted-foreground/80">
      <button
        type="button"
        onClick={() => { touched.current = true; setOpen(o => !o) }}
        aria-expanded={open}
        className="inline-flex items-center gap-1 font-mono text-[10px] leading-snug hover:text-foreground transition-colors"
      >
        <ChevronRight className={`size-3 transition-transform duration-300 ${open ? 'rotate-90' : ''}`} />
        {open ? t('common.hide') : t('common.show')}
        {sourceCount > 0 && (
          <span className="inline-flex items-center gap-1 opacity-80">
            · <Globe className="size-2.5" /> {t('search.traceSources', { count: sourceCount })}
          </span>
        )}
      </button>
      <Collapse open={open}>
        {search && sourceCount > 0 && <SearchSources search={search} />}
        {reasoning && (
          // Same type as the answer beneath it, size and leading, only quieter.
          <div className="mt-1 whitespace-pre-wrap border-l border-border/60 pl-2.5 text-sm leading-relaxed text-muted-foreground">
            {reasoning}
          </div>
        )}
      </Collapse>
    </div>
  )
}

// How close to the bottom of the transcript still counts as "reading the live
// answer", in pixels. Slack is needed either way — sub-pixel scroll positions
// mean an exact comparison never matches — and a couple of lines' worth of it
// keeps the follow from dropping out on a stray trackpad nudge.
const SCROLL_FOLLOW_SLACK = 40

/** localStorage key holding whether the right-hand settings rail is expanded. */
const SETTINGS_OPEN_KEY = 'playground.settingsOpen'
/** localStorage keys for the code pane: split on/off and the settled width. */
const CODE_SPLIT_STORAGE_KEY = 'playground.codeSplit'
const CODE_WIDTH_STORAGE_KEY = 'playground.codeWidth'

// Both rails plus the chat need room the small breakpoints do not have: three
// columns on a phone leave the transcript a sliver. So below lg a visit starts
// with the rails collapsed to their strips whatever a desktop session
// remembered — the toggles still work, the remembered choice just isn't
// restored until there is width for it.
function initialRailOpen(key: string): boolean {
  if (typeof window === 'undefined') return true
  if (!window.matchMedia('(min-width: 1024px)').matches) return false
  return localStorage.getItem(key) !== 'false'
}

function systemDictationHintKey(models: TranscriptionModelRow[] | undefined) {
  const desktop = window as Window & { __OMNIPIX_DESKTOP__?: boolean; __OMNIPIX_PLATFORM__?: string }
  // Wait for the catalog. A keyed provider with disabled models still uses the model setup flow.
  if (!desktop.__OMNIPIX_DESKTOP__ || !models || models.some(m => m.modality === 'transcription' && m.keyCount > 0)) return
  if (desktop.__OMNIPIX_PLATFORM__ === 'darwin') return 'playground.dictationMacShortcut'
  if (desktop.__OMNIPIX_PLATFORM__ === 'win32') return 'playground.dictationWindowsShortcut'
}

export default function PlaygroundPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // Optional system prompt for this Playground session. Client-side only:
  // when set, it's prepended as a `system` message to the request. Persisted
  // to localStorage so it survives reloads.
  const [systemPrompt, setSystemPrompt] = useState<string>(
    () => localStorage.getItem('playground.systemPrompt') ?? '',
  )
  const updateSystemPrompt = (v: string) => {
    setSystemPrompt(v)
    localStorage.setItem('playground.systemPrompt', v)
  }
  // Sampling knobs (temperature / top_p / max_tokens), edited in the settings
  // rail. Every one is opt-in, so an untouched rail composes exactly the
  // request the Playground sent before they existed. Remembered in
  // localStorage, NOT on the conversation row — these are how YOU like to
  // drive the Playground, not part of a saved transcript.
  const [sampling, setSampling] = useState<SamplingSettings>(() => readSampling())
  const updateSampling = (next: SamplingSettings) => {
    setSampling(next)
    writeSampling(next)
  }
  // "Search the web" (#1174): look the question up with POST /v1/search first
  // and hand the model numbered sources to cite. A preference like the
  // sampling knobs, so it is remembered here rather than per conversation.
  const [webSearch, setWebSearch] = useState<boolean>(
    () => localStorage.getItem('playground.webSearch') === '1',
  )
  const updateWebSearch = (enabled: boolean) => {
    setWebSearch(enabled)
    localStorage.setItem('playground.webSearch', enabled ? '1' : '0')
  }
  const [input, setInput] = useState('')
  type ChatMode = 'chat' | 'image' | 'video' | 'audio'
  const MODE_LABEL_KEYS: Record<ChatMode, string> = {
    chat: 'playground.modeChat',
    image: 'playground.modeImage',
    video: 'playground.modeVideo',
    audio: 'playground.modeAudio',
  }
  const MODE_PLACEHOLDER_KEYS: Record<ChatMode, string> = {
    chat: 'playground.inputPlaceholder',
    image: 'playground.inputPlaceholderImage',
    video: 'playground.inputPlaceholderVideo',
    audio: 'playground.inputPlaceholderAudio',
  }
  const [mode, setMode] = useState<ChatMode>('chat')
  // Open @-mention token (anchor index + filter query) and the picker's
  // keyboard cursor. The picker lives outside the goo composer on purpose:
  // the Liquid tree owns its own layout and must not gain siblings.
  const [mention, setMention] = useState<{ anchor: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  // Text-like files of the open folder, for @file completion. Loaded once
  // per root while a token is open; a failed list degrades to docs-only.
  const [folderFiles, setFolderFiles] = useState<{ root: string; files: string[] } | null>(null)
  const folderFilesLoading = useRef<string | null>(null)
  const ensureFolderFiles = (root: string) => {
    if (folderFiles?.root === root || folderFilesLoading.current === root) return
    folderFilesLoading.current = root
    apiFetch<{ entries: { path: string; kind: string }[] }>(`/api/fs/list?root=${encodeURIComponent(root)}`)
      .then(res => {
        const files = (res.entries ?? [])
          .filter(e => e.kind === 'file' && isMentionableFile(e.path))
          .map(e => e.path)
        setFolderFiles({ root, files })
      })
      .catch(() => setFolderFiles({ root, files: [] }))
      .finally(() => { folderFilesLoading.current = null })
  }
  const [loading, setLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>(
    () => localStorage.getItem('playground.model') ?? 'auto',
  )
  // Files staged for the NEXT message: images already downscaled to a data URI,
  // text-like files already decoded. Cleared on send. (#325)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Whether the transcript should keep itself pinned to the bottom. Every model
  // streams now, so a message can grow for a minute straight — scrolling up to
  // re-read something must not be undone by the next token.
  const followRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  // Cancels the in-flight completion when the user clears the chat, sends
  // again, or navigates away mid-stream.
  const abortRef = useRef<AbortController | null>(null)

  // ---- Saved conversations -------------------------------------------------
  // The transcript lives on the server now. `conversationId` is the row this
  // page is writing to; null means "nothing sent yet", and no row exists until
  // the first message — a fresh visit still opens on an empty transcript.
  const queryClient = useQueryClient()
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => initialRailOpen(SIDEBAR_OPEN_KEY))
  const [settingsOpen, setSettingsOpen] = useState<boolean>(() => initialRailOpen(SETTINGS_OPEN_KEY))
  // Mirrors of state the async save paths read AFTER their closure was made:
  // a stream that started before the row existed still has to save into it.
  const conversationIdRef = useRef<number | null>(null)
  const titleRef = useRef('')
  // Memoised create, so two saves racing at the start of a conversation (a
  // fast first answer and a quick second question) cannot mint two rows.
  const createRef = useRef<Promise<number | null> | null>(null)

  const { data: conversations = [] } = useQuery<ConversationSummary[]>({
    queryKey: ['playground-conversations'],
    queryFn: listConversations,
  })
  const refreshConversations = () => {
    queryClient.invalidateQueries({ queryKey: ['playground-conversations'] })
  }

  const { data: keyData } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })
  const { data: voiceSettings } = useVoiceSettings()

  // Ingested docs for @-mentions. Fetched once per page load; ingestion
  // happens in the Assistant tab, and a refetch-on-open keeps the picker
  // honest without polling.
  const { data: ingestedDocs = [], refetch: refetchDocs } = useQuery<IngestedDoc[]>({
    queryKey: ['ingested-docs'],
    queryFn: () => apiFetch<{ docs: IngestedDoc[] }>('/api/memories/docs').then(r => r.docs),
    staleTime: 60_000,
  })

  // Skills for /slash invocation. Shared cache key with the runs panel.
  const { data: skills = [] } = useQuery<SlashSkill[]>({
    queryKey: ['agent-skills'],
    queryFn: () => apiFetch<{ skills: SlashSkill[] }>('/api/skills').then(r => r.skills),
    staleTime: 60_000,
  })

  // Speech-to-text for the composer's mic: which transcription models can
  // route right now, and which one the user asked for (Auto by default,
  // remembered in localStorage like the chat model).
  const { data: mediaData } = useQuery<{ models: TranscriptionModelRow[] }>({
    queryKey: ['media'],
    queryFn: () => apiFetch('/api/media'),
  })
  const mediaModels = mediaData?.models ?? []

  const searchReadiness = useSearchReadiness()
  const usableEngines = searchReadiness.readyEngines
  const webSearchAvailable = searchReadiness.available
  const webSearchUnavailableHint = searchReadinessHint(searchReadiness.data, searchReadiness.failed, searchReadiness.loading, t)
  const webSearchOn = webSearch && webSearchAvailable
  const transcriptionAvailable = hasTranscription(mediaModels)
  const shortcutHintKey = systemDictationHintKey(mediaData?.models)
  const dictationUnavailableHint = transcriptionAvailable ? undefined : t(shortcutHintKey ?? 'playground.dictationUnavailable')
  const [dictationChoice, setDictationChoice] = useState<string>(
    () => localStorage.getItem(DICTATION_MODEL_STORAGE_KEY) ?? DICTATION_AUTO,
  )
  const pickDictationModel = (v: string) => {
    setDictationChoice(v)
    localStorage.setItem(DICTATION_MODEL_STORAGE_KEY, v)
  }
  const dictationOptions = transcriptionOptions(mediaModels, t('playground.autoModel'))
  const dictationModel = resolveDictationModel(dictationChoice, mediaModels)

  // Rails sharing the row with the panes. At md+ the workbench shell owns
  // the row (activity rail + sidebar; the page's own conversation rail
  // hides to avoid a doubled sidebar), so the pane max subtracts the
  // workbench chrome; below md the page rail is the only chrome.
  const paneChromeWidth =
    (typeof window !== 'undefined' && window.innerWidth >= 768 ? WORKBENCH_CHROME_WIDTH : 0) +
    (typeof window !== 'undefined' && window.innerWidth >= 768 ? 0 : (sidebarOpen ? CONVERSATION_RAIL_OPEN_WIDTH : CONVERSATION_RAIL_COLLAPSED_WIDTH))

  // Code-pane mount states live up here (before the artifact block) because
  // the artifact openers below settle the pane synchronously on slot
  // handoff. Everything else code-related stays in the code block further
  // down, where it can read the artifact state it depends on.
  const [codeOpen, setCodeOpen] = useState(false)
  const [codeMounted, setCodeMounted] = useState(false)
  const codeCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Synchronous unmount for slot handoff: when an artifact takes the column,
  // the code pane leaves at once instead of stranding its exit timer behind
  // an instantly-unmounted tree.
  const settleCodePane = useCallback(() => {
    if (codeCloseTimer.current) { clearTimeout(codeCloseTimer.current); codeCloseTimer.current = null }
    setCodeOpen(false)
    setCodeMounted(false)
  }, [])

  // Artifacts (#playground): runnable code in a reply (HTML, SVG) opens in a
  // side panel with a sandboxed preview next to the source. A card in the
  // reply opens it by hand; a reply that finishes with an artifact opens its
  // first one on its own, once, like the Artifacts pattern users know.
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  // `artifactOpen` drives the slide; the artifact itself stays mounted through
  // the exit animation and is dropped once it has finished.
  const [artifactOpen, setArtifactOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [artifactWidth, setArtifactWidth] = useState<number>(
    () => readArtifactWidth(localStorage.getItem(ARTIFACT_WIDTH_STORAGE_KEY), window.innerWidth, paneChromeWidth),
  )
  const commitArtifactWidth = (w: number) => {
    const next = clampArtifactWidth(w, window.innerWidth, paneChromeWidth)
    setArtifactWidth(next)
    localStorage.setItem(ARTIFACT_WIDTH_STORAGE_KEY, String(next))
  }
  const showArtifact = useCallback((a: Artifact) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    settleCodePane()
    setArtifact(a)
    setArtifactOpen(true)
  }, [settleCodePane])
  const closeArtifact = () => {
    setArtifactOpen(false)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setArtifact(null); closeTimer.current = null }, ARTIFACT_PANEL_TRANSITION_MS)
  }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  const openArtifact = useCallback((kind: ArtifactKind, language: string, code: string) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    settleCodePane()
    setArtifact({
      id: `manual:${code.length}:${code.slice(0, 40)}`,
      kind,
      language,
      code,
      title: /<title[^>]*>([^<]{1,120})<\/title>/i.exec(code)?.[1]?.trim() ?? null,
      filename: kind === 'svg' ? 'artifact.svg' : 'artifact.html',
    })
    setArtifactOpen(true)
  }, [settleCodePane])
  const artifactHost = useMemo(() => ({ open: openArtifact, activeCode: artifact?.code ?? null }), [openArtifact, artifact?.code])
  // Auto-open only for a reply that just finished HERE — not for every old
  // conversation that happens to contain one, which would pop the panel on
  // each visit. `loading` going true→false marks the reply's completion.
  const wasLoadingRef = useRef(false)
  useEffect(() => {
    if (loading) { wasLoadingRef.current = true; return }
    if (!wasLoadingRef.current) return
    wasLoadingRef.current = false
    const idx = messages.length - 1
    const last = messages[idx]
    if (!last || last.role !== 'assistant' || last.isError) return
    const found = extractArtifacts(last.content, idx)
    if (found.length === 0) return
    // Deferred a tick: the open is a consequence of the reply landing, not
    // part of rendering it, and it must not cascade into this commit.
    const timer = setTimeout(() => showArtifact(found[0]), 0)
    return () => clearTimeout(timer)
  }, [loading, messages, showArtifact])

  // Code pane: the chat's second column, Claude-style. Every fenced block in
  // the thread's assistant replies (minus html/svg, which keep going to the
  // artifact panel) lands here as a file. Split defaults on, so the pane
  // appears with the first code block; the header toggle (or the pane's own
  // close button) dismisses it, and an open artifact takes the slot instead.
  const codeFiles: CodeFile[] = useMemo(
    () => messages.flatMap((m, i) => (m.role === 'assistant' && !m.isError ? extractCodeFiles(m.content, i) : [])),
    [messages],
  )
  const [split, setSplit] = useState<boolean>(() => {
    try { return localStorage.getItem(CODE_SPLIT_STORAGE_KEY) !== '0' } catch { return true }
  })
  const [codeActiveId, setCodeActiveId] = useState<string | null>(null)
  // `codeOpen` drives the slide; `codeMounted` keeps the pane up through the
  // exit animation (same two-state dance as the artifact panel). Both live
  // above the artifact block (see settleCodePane there).
  const [codeWidth, setCodeWidth] = useState<number>(
    () => readArtifactWidth(localStorage.getItem(CODE_WIDTH_STORAGE_KEY), window.innerWidth, paneChromeWidth),
  )
  const codeVisible = split && codeFiles.length > 0 && !artifact
  // The mount/unmount + slide states track the derived visibility, and the
  // exit timer needs effect cleanup on unmount — setState here is the same
  // justified pattern as the session-restore effect above.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (codeVisible) {
      if (codeCloseTimer.current) { clearTimeout(codeCloseTimer.current); codeCloseTimer.current = null }
      setCodeMounted(true)
      setCodeOpen(true)
      return
    }
    if (!codeMounted) return
    setCodeOpen(false)
    if (codeCloseTimer.current) clearTimeout(codeCloseTimer.current)
    codeCloseTimer.current = setTimeout(() => { setCodeMounted(false); codeCloseTimer.current = null }, CODE_PANE_TRANSITION_MS)
  }, [codeVisible, codeMounted])
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => () => { if (codeCloseTimer.current) clearTimeout(codeCloseTimer.current) }, [])
  const commitCodeWidth = (w: number) => {
    const next = clampArtifactWidth(w, window.innerWidth, paneChromeWidth)
    setCodeWidth(next)
    localStorage.setItem(CODE_WIDTH_STORAGE_KEY, String(next))
  }
  const toggleSplit = useCallback(() => {
    setSplit(prev => {
      const next = !prev
      try { localStorage.setItem(CODE_SPLIT_STORAGE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  const openCodeFile = useCallback((language: string, code: string) => {
    const file = codeFiles.find(f => f.code === code && f.language === language)
      ?? codeFiles.find(f => f.code === code)
    if (!file) return
    setCodeActiveId(file.id)
    // An open artifact owns the slot: dismiss it first so this is never a
    // silent no-op; the code pane mounts as the artifact exits.
    if (artifact) closeArtifact()
    setSplit(prev => {
      if (!prev) { try { localStorage.setItem(CODE_SPLIT_STORAGE_KEY, '1') } catch { /* ignore */ } }
      return true
    })
  }, [codeFiles, artifact])
  const codeHost = useMemo(() => {
    const active = codeFiles.find(f => f.id === codeActiveId) ?? codeFiles[codeFiles.length - 1] ?? null
    return { open: openCodeFile, activeCode: active?.code ?? null }
  }, [openCodeFile, codeFiles, codeActiveId])

  const { data: fallbackEntries = [] } = useQuery<FallbackEntry[]>({
    queryKey: ['fallback'],
    queryFn: () => apiFetch('/api/fallback'),
  })

  // Named fallback chains (#1021). Every custom chain is served as an
  // `auto:<name>` model — /v1/models lists them and the send path already
  // routes them — but the picker only ever offered 'auto', so the one place
  // you could try a chain you had just built was a curl command. The id is
  // derived exactly as the server derives it (routes/proxy.ts).
  const { data: chains = [] } = useQuery<Chain[]>({
    queryKey: ['profiles'],
    queryFn: () => apiFetch('/api/profiles'),
  })
  const chainOptions = chains
    .filter(c => c.type === 'custom')
    .map(c => ({
      value: `auto:${c.name.toLowerCase()}`,
      label: c.emoji ? `${c.emoji} ${c.name}` : c.name,
      sub: `auto:${c.name.toLowerCase()}`,
      isNew: false,
      platforms: [] as string[],
    }))

  // Unification is always on now (the on/off toggle was removed), so the picker
  // always collapses a model's providers into one option.
  const unifyOn = true

  const availableModels = fallbackEntries.filter(e => e.keyCount > 0 && e.enabled)
  // Collapse the same model from multiple providers into one option (value =
  // canonical id, which the proxy resolves to the whole group).
  const modelOptions = buildModelOptions(availableModels, unifyOn)

  // Picker values that can accept images. A unified option counts as vision-
  // capable when ANY of its providers is, because routing picks a vision member
  // for image requests. Auto/Fusion are never flagged: the server picks the
  // model there (and hard-fails with a clear error if none can see).
  const visionValues = new Set(
    availableModels.filter(e => e.supportsVision).map(e => e.canonicalId ?? e.modelId),
  )
  const pendingImages = attachmentImages(attachments)
  // A chain (`auto:<name>`) is as server-picked as plain auto: the router
  // chooses a vision-capable member for an image request, so the hint would be
  // guesswork about a model that has not been picked yet.
  const modelBlindToImages = pendingImages.length > 0
    && selectedModel !== 'auto' && selectedModel !== 'fusion'
    && !selectedModel.startsWith('auto:')
    && !visionValues.has(selectedModel)

  // Follow the stream only while the reader is parked at the bottom. Judging
  // by direction (rather than position alone) keeps our own smooth-scroll
  // animation — which always travels downwards — from being mistaken for the
  // user taking over, whatever they used to scroll: wheel, keys, or the bar.
  useEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    lastScrollTopRef.current = el.scrollTop
    const onScroll = () => {
      const top = el.scrollTop
      const movedUp = top < lastScrollTopRef.current - 1
      lastScrollTopRef.current = top
      if (el.scrollHeight - top - el.clientHeight <= SCROLL_FOLLOW_SLACK) followRef.current = true
      else if (movedUp) followRef.current = false
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (followRef.current) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // A stream left running after the page goes away would keep calling
  // setMessages on an unmounted tree (and hold the socket open).
  useEffect(() => () => abortRef.current?.abort(), [])

  // Opened folder: sticky project context shared with the sidebar and the
  // Files panel. Persists across messages (and reloads) until closed, so the
  // model never loses sight of the project mid-conversation. Declared ahead
  // of the conversation helpers: saves bind the folder, opens restore it.
  const [openFolder, setOpenFolderState] = useOpenFolder()
  const attachFolderTree = useCallback((tree: { root: string; tree: string; files: number; truncated: boolean }) => {
    setOpenFolderState({ root: tree.root, tree: tree.tree, files: tree.files, truncated: tree.truncated })
    // setOpenFolderState is the module-level writer: stable, never re-created.
  }, [setOpenFolderState])

  // Adopt a conversation the server just handed back as the one this page is
  // writing to, and remember it for the next reload.
  const adoptConversation = (id: number, title: string) => {
    conversationIdRef.current = id
    titleRef.current = title
    setConversationId(id)
    writeActiveConversationId(id)
  }

  // The id to save into, creating the row on the first message. Returns null
  // when the create failed — saving is best-effort, never something that costs
  // you the answer on screen.
  const conversationIdFor = (msgs: ChatMessage[]): Promise<number | null> => {
    if (conversationIdRef.current !== null) return Promise.resolve(conversationIdRef.current)
    if (!createRef.current) {
      createRef.current = createConversation({
        title: autoTitle(msgs),
        messages: toStoredMessages(msgs),
        model: selectedModel,
        systemPrompt: systemPrompt.trim() || null,
        // A chat born with a folder open belongs to that folder from birth.
        ...(openFolder ? { folder: openFolder } : {}),
      })
        .then(created => {
          adoptConversation(created.id, created.title)
          refreshConversations()
          return created.id
        })
        .catch(err => {
          // Let the next completed exchange try again rather than wedging the
          // page on one bad request.
          createRef.current = null
          console.error('[playground] could not create the conversation', err)
          return null
        })
    }
    return createRef.current
  }

  // Save the whole conversation — transcript, title, model, system prompt — in
  // one PUT. Called when a response FINISHES (never per delta) and on
  // rename/clear. A failure is logged and dropped: the transcript on screen is
  // the source of truth, and the next exchange saves it again.
  const persistConversation = async (msgs: ChatMessage[]) => {
    const id = await conversationIdFor(msgs)
    if (id === null) return
    try {
      const saved = await updateConversation(id, {
        // Auto-title once, from the opening question; a rename makes the title
        // non-empty for good, so it is never recomputed over.
        title: titleRef.current || autoTitle(msgs),
        messages: toStoredMessages(msgs),
        model: selectedModel,
        systemPrompt: systemPrompt.trim() || null,
        // The save carries the live folder state: an open folder binds (or
        // refreshes) the chat, a closed one unbinds it. The binding is what
        // reopening the chat restores.
        folder: openFolder,
      })
      if (conversationIdRef.current === id) titleRef.current = saved.title
      refreshConversations()
    } catch (err) {
      console.error('[playground] could not save the conversation', err)
    }
  }

  // Drop everything tied to the current conversation. Shared by "new
  // conversation", "clear", and a stored id that no longer exists.
  const resetConversationState = () => {
    abortRef.current?.abort()
    abortRef.current = null
    conversationIdRef.current = null
    titleRef.current = ''
    createRef.current = null
    setConversationId(null)
    writeActiveConversationId(null)
    setMessages([])
    setAttachments([])
    followRef.current = true
  }

  // Save whatever is on screen before it goes away — leaving a conversation
  // mid-stream should keep the part that had already arrived. The last
  // completed exchange saved itself; this only ever adds to that.
  const flushCurrentConversation = () => {
    if (messages.length > 0) void persistConversation(messages)
  }

  // Switch to a saved conversation: transcript, model and system prompt all
  // come back, so you land exactly where you left it.
  const openConversation = async (id: number) => {
    abortRef.current?.abort()
    abortRef.current = null
    const conversation = await getConversation(id)
    createRef.current = null
    setMessages(conversation.messages)
    setAttachments([])
    pickModel(conversation.model ?? 'auto')
    updateSystemPrompt(conversation.systemPrompt ?? '')
    adoptConversation(conversation.id, conversation.title)
    // The chat's folder comes back with it: a live re-read on desktop (the
    // snapshot may be stale), the stored snapshot everywhere else, cleared
    // when the chat was never bound.
    if (!conversation.folder) {
      setOpenFolderState(null)
    } else if (canPickFolder()) {
      try {
        attachFolderTree(await readFolderTree(conversation.folder.root))
      } catch {
        attachFolderTree(conversation.folder)
      }
    } else {
      attachFolderTree(conversation.folder)
    }
    followRef.current = true
    inputRef.current?.focus()
  }

  const handleSelectConversation = (id: number) => {
    if (id === conversationIdRef.current) return
    flushCurrentConversation()
    openConversation(id).then(
      () => window.dispatchEvent(new Event(CONVERSATIONS_CHANGED_EVENT)),
      err => {
        console.error('[playground] could not open the conversation', err)
        toast.error(t('playgroundSessions.loadFailed'))
        refreshConversations()
      },
    )
  }

  // "New conversation" and "Clear" are the same move now: bank the current
  // transcript, then start with a blank one. The old chat stays in the sidebar.
  const handleNewConversation = () => {
    flushCurrentConversation()
    resetConversationState()
    inputRef.current?.focus()
    window.dispatchEvent(new Event(CONVERSATIONS_CHANGED_EVENT))
  }

  // The workbench sidebar drives the Playground from any page: open a recent
  // conversation, or start fresh. The handlers close over the live transcript
  // (switching banks it first), so the listener reads them through a ref —
  // subscribing once, never to a stale render.
  const externalHandlers = useRef({ select: handleSelectConversation, fresh: handleNewConversation })
  externalHandlers.current = { select: handleSelectConversation, fresh: handleNewConversation }
  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<{ id: number }>).detail?.id
      if (typeof id === 'number') externalHandlers.current.select(id)
    }
    const fresh = () => externalHandlers.current.fresh()
    const folder = (e: Event) => {
      const tree = (e as CustomEvent<{ root: string; tree: string; files: number; truncated: boolean }>).detail
      if (tree && typeof tree.root === 'string' && typeof tree.tree === 'string') attachFolderTree(tree)
    }
    window.addEventListener(OPEN_CONVERSATION_EVENT, open)
    window.addEventListener(NEW_CONVERSATION_EVENT, fresh)
    window.addEventListener(OPEN_FOLDER_EVENT, folder)
    return () => {
      window.removeEventListener(OPEN_CONVERSATION_EVENT, open)
      window.removeEventListener(NEW_CONVERSATION_EVENT, fresh)
      window.removeEventListener(OPEN_FOLDER_EVENT, folder)
    }
  }, [attachFolderTree])

  // Chat → agent continuity: bank the transcript, open a session linked to
  // this conversation, and continue there. The agent UI reads ?session=.
  const handoffToAgent = async () => {
    const id = conversationIdRef.current
    if (id == null) return
    flushCurrentConversation()
    try {
      const session = await apiFetch<{ id: number }>('/api/agents/sessions', {
        method: 'POST',
        // The open project folder rides along so the agent session starts in
        // the same directory the chat was discussing — no retyping paths.
        body: JSON.stringify({
          title: titleRef.current || t('playground.agentHandoffTitle'),
          conversationId: id,
          ...(openFolder ? { workdir: openFolder.root } : {}),
        }),
      })
      navigate(`/agents?tab=runs&session=${session.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRenameConversation = (id: number, title: string) => {
    // Title only: a rename must not race the transcript of an in-flight answer
    // away, which is exactly what re-sending messages here would risk.
    updateConversation(id, { title })
      .then(saved => {
        if (conversationIdRef.current === id) titleRef.current = saved.title
        refreshConversations()
        window.dispatchEvent(new Event(CONVERSATIONS_CHANGED_EVENT))
      })
      .catch(err => {
        console.error('[playground] could not rename the conversation', err)
        toast.error(t('playgroundSessions.renameFailed'))
      })
  }

  const handleDeleteConversation = (id: number) => {
    deleteConversation(id)
      .then(() => {
        // Deleting the open one leaves the Playground on a blank slate, the
        // same state a first-ever visit gets.
        if (conversationIdRef.current === id) resetConversationState()
        refreshConversations()
        window.dispatchEvent(new Event(CONVERSATIONS_CHANGED_EVENT))
      })
      .catch(err => {
        console.error('[playground] could not delete the conversation', err)
        toast.error(t('playgroundSessions.deleteFailed'))
      })
  }

  const toggleSidebar = () => {
    setSidebarOpen(open => {
      localStorage.setItem(SIDEBAR_OPEN_KEY, String(!open))
      return !open
    })
  }

  const toggleSettings = () => {
    setSettingsOpen(open => {
      localStorage.setItem(SETTINGS_OPEN_KEY, String(!open))
      return !open
    })
  }

  // Reopen whatever was on screen before the reload. A stored id that no longer
  // exists (deleted in another tab) just falls back to an empty transcript.
  useEffect(() => {
    const stored = readActiveConversationId()
    if (stored === null) return
    // The state it sets lands after the fetch resolves, not during this body —
    // restoring the session IS synchronising React with an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    openConversation(stored).catch(() => writeActiveConversationId(null))
    // Mount only: this restores the session, it does not track later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Read a fusion SSE stream, updating the assistant message in place as panel
  // answers + the judge arrive (additive `_fusion` frames) and the final answer
  // streams as content deltas.
  const streamFusion = async (stream: ReadableStream<Uint8Array>, baseMessages: ChatMessage[], start: number) => {
    const reader = stream.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let finalContent = ''
    const panel: FusionPanelEntry[] = []
    let judge: { platform: string; model: string } | null = null

    // Returns the transcript it rendered, so the final flush can hand the
    // finished exchange straight to the save without rebuilding it.
    const flush = (streaming: boolean): ChatMessage[] => {
      const next: ChatMessage[] = [...baseMessages, {
        role: 'assistant',
        content: finalContent,
        meta: { latency: Date.now() - start, fusionPanel: [...panel], fusionJudge: judge, fusionStreaming: streaming },
      }]
      setMessages(next)
      return next
    }
    flush(true)

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const tl = line.trim()
        if (!tl.startsWith('data:')) continue
        const d = tl.slice(5).trim()
        if (d === '[DONE]') continue
        let obj: SseFrame
        try { obj = JSON.parse(d) as SseFrame } catch { continue }
        if (obj._fusion) {
          if (obj._fusion.event === 'panel') {
            const fusion = obj._fusion
            panel.push({
              platform: fusion.platform ?? '',
              model: fusion.model ?? '',
              status: fusion.status === 'ok' || fusion.status === 'failed' ? fusion.status : undefined,
              content: fusion.content,
              error: fusion.error,
            })
          } else if (obj._fusion.event === 'judge') {
            judge = { platform: obj._fusion.platform ?? '', model: obj._fusion.model ?? '' }
          }
          flush(true)
        } else if (obj.error) {
          finalContent = `${t('playground.errorPrefix')} ${obj.error.message ?? ''}`
          flush(true)
        } else if (obj.choices) {
          const delta = obj.choices[0]?.delta?.content
          if (delta) { finalContent += delta; flush(true) }
        }
      }
    }
    // The exchange is complete: one save, here, never per delta.
    await persistConversation(flush(false))
  }

  // Read a plain (non-fusion) OpenAI chat stream, filling the assistant bubble
  // in place as content and reasoning deltas land. The routing metadata is
  // already known — it rides on the response headers, which arrive before the
  // first frame — so the only thing the stream adds is the latency, measured
  // to the last frame rather than to the first.
  const streamChat = async (
    stream: ReadableStream<Uint8Array>,
    baseMessages: ChatMessage[],
    start: number,
    routedVia: string | null,
    fallbackAttempts: string | null,
    webSearchMeta?: WebSearchMeta,
  ) => {
    const via = routedVia
      ? { platform: routedVia.split('/')[0], model: routedVia.split('/').slice(1).join('/') }
      : undefined
    let content = ''
    let reasoning = ''
    let failure: string | null = null

    // Returns the transcript it rendered, so the final flush can hand the
    // finished exchange straight to the save without rebuilding it.
    const flush = (streaming: boolean): ChatMessage[] => {
      const next: ChatMessage[] = [...baseMessages]
      // A stream that broke before the first token has nothing to show but the
      // error; one that broke halfway keeps what it managed to say.
      if (content || reasoning || failure === null) {
        next.push({
          role: 'assistant',
          content,
          ...(reasoning ? { reasoning } : {}),
          ...(streaming ? { streaming: true } : {}),
          meta: {
            platform: via?.platform,
            model: via?.model,
            latency: Date.now() - start,
            fallbackAttempts: fallbackAttempts ? parseInt(fallbackAttempts) : undefined,
            ...(webSearchMeta ? { webSearch: webSearchMeta } : {}),
          },
        })
      }
      if (failure !== null) next.push({ role: 'assistant', isError: true, content: failure })
      setMessages(next)
      return next
    }

    await readChatStream(stream, {
      onDelta: text => { content += text; flush(true) },
      onReasoning: text => { reasoning += text; flush(true) },
      onError: message => { failure = message; flush(true) },
    })
    // The exchange is complete: one save, here, never per delta.
    await persistConversation(flush(false))
  }

  // Stage dropped/pasted/picked files. Every rejection is reported by name so a
  // silently missing attachment is impossible; accepted files are added in one
  // batch after the async reads settle.
  const addFiles = async (files: File[]) => {
    if (files.length === 0) return
    const accepted: Attachment[] = []
    let imageBytes = pendingImages.reduce((sum, url) => sum + dataUrlBytes(url), 0)

    for (const file of files) {
      if (attachments.length + accepted.length >= MAX_ATTACHMENTS) {
        toast.error(t('playground.attachTooMany', { count: MAX_ATTACHMENTS }))
        break
      }
      const kind = classifyFile(file)
      if (!kind) {
        toast.error(t('playground.attachUnsupported', { name: file.name }))
        continue
      }
      // PDFs parse server-side with their own failure modes (scanned image,
      // corrupt file): the server's message names the problem, so it toasts
      // verbatim instead of the generic "could not read".
      if (kind === 'pdf') {
        try {
          const text = await parsePdfAttachment(file)
          accepted.push({ id: `${Date.now()}-${accepted.length}-${file.name}`, kind, name: file.name, text })
        } catch (err) {
          if (err instanceof AttachmentError && err.reason === 'too-large') {
            toast.error(t('playground.attachTooLarge', { name: file.name, max: formatBytes(MAX_PDF_BYTES) }))
          } else {
            toast.error(err instanceof Error && err.message
              ? `${file.name}: ${err.message}`
              : t('playground.attachFailed', { name: file.name }))
          }
        }
        continue
      }
      try {
        if (kind === 'image') {
          const dataUrl = await readImageAttachment(file)
          if (imageBytes + dataUrlBytes(dataUrl) > MAX_TOTAL_IMAGE_BYTES) {
            toast.error(t('playground.attachTooLarge', { name: file.name, max: formatBytes(MAX_TOTAL_IMAGE_BYTES) }))
            continue
          }
          imageBytes += dataUrlBytes(dataUrl)
          accepted.push({ id: `${Date.now()}-${accepted.length}-${file.name}`, kind, name: file.name, dataUrl })
        } else {
          const text = await readTextAttachment(file)
          accepted.push({ id: `${Date.now()}-${accepted.length}-${file.name}`, kind, name: file.name, text })
        }
      } catch (err) {
        const reason = err instanceof AttachmentError ? err.reason : 'unreadable'
        toast.error(reason === 'too-large'
          ? t('playground.attachTooLarge', {
              name: file.name,
              max: formatBytes(kind === 'image' ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES),
            })
          : t('playground.attachFailed', { name: file.name }))
      }
    }
    if (accepted.length > 0) setAttachments(prev => [...prev, ...accepted])
  }

  const removeAttachment = (id: string) => setAttachments(prev => prev.filter(a => a.id !== id))

  const handleFolder = async () => {
    try {
      const tree = await pickFolderTree()
      if (!tree) return
      attachFolderTree(tree)
      try { localStorage.setItem('panel.filesRoot', tree.root) } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: { tab: 'files' } }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  // Blobs (video MP4, audio) persist as data URIs only under 4MB; bigger
  // ones stay session-only so one generation can't bloat the saved chat.
  const persistableUrl = async (blob: Blob): Promise<{ url: string; sessionOnly: boolean }> => {
    const objectUrl = URL.createObjectURL(blob)
    if (blob.size > 4 * 1024 * 1024) return { url: objectUrl, sessionOnly: true }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    URL.revokeObjectURL(objectUrl)
    return { url: dataUrl, sessionOnly: false }
  }

  const runMediaMode = async (prompt: string) => {
    const t0 = Date.now()
    const userMsg: ChatMessage = { role: 'user', content: prompt }
    const withUser = [...messages, userMsg]
    followRef.current = true
    setMessages(withUser)
    setInput('')
    setAttachments([])
    setLoading(true)
    inputRef.current?.focus()
    void conversationIdFor(withUser)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`
      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const media: GeneratedMedia[] = []
      let caption: string
      if (mode === 'image') {
        const res = await fetch(`${base}/v1/images/generations`, {
          method: 'POST', headers, body: JSON.stringify({ prompt }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`)
        const data = await res.json() as { data?: { url?: string; b64_json?: string }[], model?: string }
        for (const item of data.data ?? []) {
          if (item.url) media.push({ kind: 'image', url: item.url, prompt })
          else if (item.b64_json) media.push({ kind: 'image', url: `data:image/png;base64,${item.b64_json}`, prompt })
        }
        if (media.length === 0) throw new Error(t('playground.mediaEmpty'))
        caption = t('playground.mediaImageCaption', { prompt })
      } else if (mode === 'video') {
        const res = await fetch(`${base}/v1/videos/generations`, {
          method: 'POST', headers, body: JSON.stringify({ prompt }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`)
        const blob = await res.blob()
        const { url } = await persistableUrl(blob)
        media.push({ kind: 'video', url, prompt })
        caption = t('playground.mediaVideoCaption', { prompt })
      } else {
        const res = await fetch(`${base}/v1/audio/speech`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            input: prompt,
            ...(voiceSettings?.ttsModel && voiceSettings.ttsModel !== 'auto' ? { model: voiceSettings.ttsModel } : {}),
            ...(voiceSettings?.ttsVoice ? { voice: voiceSettings.ttsVoice } : {}),
          }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`)
        const blob = await res.blob()
        const { url } = await persistableUrl(blob)
        media.push({ kind: 'audio', url, prompt })
        caption = t('playground.mediaAudioCaption', { prompt })
      }
      const answered: ChatMessage[] = [...withUser, {
        role: 'assistant',
        content: caption,
        media,
        meta: { latency: Date.now() - t0 },
      }]
      setMessages(answered)
      await persistConversation(answered)
    } catch (err: unknown) {
      const failed: ChatMessage[] = [...withUser, {
        role: 'assistant',
        isError: true,
        content: err instanceof Error ? err.message : String(err),
      }]
      setMessages(failed)
      await persistConversation(failed)
    } finally {
      setLoading(false)
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || loading) return
    if (mode !== 'chat') {
      if (!text) return
      // Attachments only travel with chat requests; dropping them silently
      // would lose user files, so refuse and say so instead.
      if (attachments.length > 0) {
        toast.info(t('playground.mediaNoAttachments'))
        return
      }
      await runMediaMode(text)
      return
    }

    // Slash invocation: /name attaches that skill's instructions for this
    // message. Unknown or bare slashes stop the send with guidance instead
    // of confusing the model.
    let sendText = text
    let skillContext: string | null = null
    const slash = parseSlashCommand(text)
    if (slash) {
      const byName = new Map(skills.map(s => [s.name, s]))
      const missing = slash.names.filter(n => {
        const s = byName.get(n)
        return !s || !s.enabled
      })
      if (!slash.rest) {
        toast.error(t('playground.slashEmpty'))
        return
      }
      if (missing.length > 0) {
        toast.error(t('playground.slashUnknown', { names: missing.join(', ') }))
        return
      }
      skillContext = slashSkillsMessage(slash.names.map(n => byName.get(n)!))
      sendText = slash.rest
    }

    // Text-like files are inlined into the prompt; images ride along as data
    // URIs and become `image_url` parts in the request envelope below.
    const userMsg: ChatMessage = {
      role: 'user',
      content: composeText(sendText, attachments),
      ...(pendingImages.length > 0 ? { images: pendingImages } : {}),
    }
    const newMessages = [...messages, userMsg]
    // Your own message always brings the transcript back down, however far up
    // you had scrolled to read.
    followRef.current = true
    setMessages(newMessages)
    setInput('')
    setAttachments([])
    setMention(null)
    setMentionIndex(0)
    setLoading(true)
    inputRef.current?.focus()

    // The server row is born HERE — with the first message, not on arrival at
    // the page — so a visit that sends nothing leaves no trace in the sidebar.
    // Not awaited: the create runs alongside the completion, and every save
    // below waits on the same memoised promise.
    void conversationIdFor(newMessages)

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`
      const base = import.meta.env.BASE_URL.replace(/\/$/, '')

      // Web search first, when it is on and there is a question to look up. A
      // failed search is reported and the question is answered without it.
      let searchContext: string | null = null
      let webSearchMeta: WebSearchMeta | undefined
      if (webSearchOn && sendText) {
        const searchStart = Date.now()
        try {
          const res = await fetch(`${base}/v1/search`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query: sendText, max_results: 5 }),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
            throw new Error(err.error?.message ?? err.message ?? `HTTP ${res.status}`)
          }
          const found = await res.json() as SearchResult
          if (found.results.length > 0) {
            searchContext = searchContextMessage(found)
            webSearchMeta = {
              engine: searchProviderName(found.provider),
              latency: Date.now() - searchStart,
              sources: found.results.map(r => ({ title: r.title, url: r.url })),
            }
          }
        } catch (err) {
          toast.error(t('search.playgroundFailed', { reason: err instanceof Error ? err.message : String(err) }))
        }
      }

      // @-mentioned docs resolve to the chunks most relevant to THIS
      // question. A failed lookup toasts and the message still sends.
      let docsContext: string | null = null
      const docAttachments = attachments.filter(a => a.kind === 'doc' && a.project && a.url)
      if (docAttachments.length > 0) {
        try {
          const all: DocChunk[] = []
          for (const doc of docAttachments) {
            const found = await apiFetch<{ chunks: DocChunk[] }>(
              `/api/memories/docs/search?project=${encodeURIComponent(doc.project!)}&url=${encodeURIComponent(doc.url!)}&q=${encodeURIComponent(sendText || doc.name)}&limit=3`,
            )
            all.push(...found.chunks)
          }
          if (all.length > 0) docsContext = docsContextMessage(all.slice(0, 8))
        } catch (err) {
          toast.error(t('playground.mentionResolveFailed', { reason: err instanceof Error ? err.message : String(err) }))
        }
      }

      const isFusion = selectedModel === 'fusion'
      const sysPrompt = systemPrompt.trim()
      const turns = newMessages.map(m => ({ role: m.role, content: toMessageContent(m.content, m.images) }))
      const body: { messages: Array<{ role: string; content: unknown }>; model?: string; stream?: boolean } & SamplingRequestParams = {
        messages: [
          ...(sysPrompt ? [{ role: 'system', content: sysPrompt }] : []),
          ...(searchContext ? [{ role: 'system', content: searchContext }] : []),
          ...(docsContext ? [{ role: 'system', content: docsContext }] : []),
          ...(skillContext ? [{ role: 'system', content: skillContext }] : []),
          // Folder context rides as a user turn, not a system preamble —
          // small models skim system text and then claim they cannot see it.
          ...(openFolder ? pinFolderContext(turns, openFolder) : turns),
        ],
        // Only the knobs switched on in the settings rail: temperature, top_p
        // and max_tokens, spelled as /v1/chat/completions parses them. An
        // untouched rail adds nothing at all, leaving provider defaults alone.
        ...samplingRequestParams(sampling),
      }
      if (selectedModel !== 'auto') body.model = selectedModel
      // Everything streams: fusion so you can watch the panel and the judge
      // arrive, every other model so the answer appears token by token instead
      // of after a silent minute.
      body.stream = true

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const start = Date.now()
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const latency = Date.now() - start
      const routedVia = res.headers.get('X-Routed-Via')
      const fallbackAttempts = res.headers.get('X-Fallback-Attempts')

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        // A refused request still ends an exchange, and the question that
        // provoked it is worth keeping — save the error bubble along with it.
        const failed: ChatMessage[] = [...newMessages, {
          role: 'assistant',
          isError: true,
          content: err.error?.message ?? t('common.unknownError'),
        }]
        setMessages(failed)
        await persistConversation(failed)
        return
      }

      if (isFusion && res.body) {
        await streamFusion(res.body, newMessages, start)
        return
      }

      // The proxy answers a streamed request with SSE or not at all (every
      // pre-commit failure is a non-2xx JSON body, already handled above), but
      // fall back to the buffered path rather than trusting that: a proxy in
      // front of us, or a future non-streaming route, can still hand back JSON.
      if (!isFusion && res.body && (res.headers.get('Content-Type') ?? '').includes('text/event-stream')) {
        await streamChat(res.body, newMessages, start, routedVia, fallbackAttempts, webSearchMeta)
        return
      }

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content ?? JSON.stringify(data, null, 2)
      const via = data._routed_via ?? (routedVia ? {
        platform: routedVia.split('/')[0],
        model: routedVia.split('/').slice(1).join('/'),
      } : undefined)

      // Fusion responses carry a structured routing summary so we can show the
      // panel models that replied + the judge, rather than parsing the compact
      // X-Routed-Via string.
      const fusion = data._fusion as
        | { panel: { platform: string; model: string }[]; judge: { platform: string; model: string } | null }
        | undefined

      const answered: ChatMessage[] = [...newMessages, {
        role: 'assistant',
        content,
        meta: {
          platform: via?.platform,
          model: via?.model,
          latency,
          fallbackAttempts: fallbackAttempts ? parseInt(fallbackAttempts) : undefined,
          fusionPanel: fusion?.panel,
          fusionJudge: fusion?.judge,
          ...(webSearchMeta ? { webSearch: webSearchMeta } : {}),
        },
      }]
      setMessages(answered)
      await persistConversation(answered)
      // Auto-speak: read the finished reply aloud when the voice setting is
      // on. Fire-and-forget — speech must never fail the chat.
      if (voiceSettings?.autoSpeakChat && keyData?.apiKey) {
        void speakText(content, {
          apiKey: keyData.apiKey,
          model: voiceSettings.ttsModel,
          voice: voiceSettings.ttsVoice,
        }).catch(() => {})
      }
    } catch (err: unknown) {
      // Clearing the chat (or leaving the page) aborts the stream on purpose —
      // that is not a failure to report, and the transcript it belonged to is
      // already gone.
      if (err instanceof Error && err.name === 'AbortError') return
      const failed: ChatMessage[] = [...newMessages, {
        role: 'assistant',
        isError: true,
        content: err instanceof Error ? err.message : String(err),
      }]
      setMessages(failed)
      await persistConversation(failed)
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const mentionDocs = useMemo(
    () => (mention ? filterMentionDocs(ingestedDocs, mention.query) : []),
    [mention, ingestedDocs],
  )
  const mentionFiles = useMemo(
    () => (mention && folderFiles && openFolder && folderFiles.root === openFolder.root
      ? filterMentionFiles(folderFiles.files, mention.query)
      : []),
    [mention, folderFiles, openFolder],
  )

  const closeMention = () => {
    setMention(null)
    setMentionIndex(0)
  }

  const clearMentionToken = () => {
    if (!mention) return
    const caret = inputRef.current?.selectionStart ?? input.length
    setInput(input.slice(0, mention.anchor) + input.slice(caret))
  }

  const handleComposerChange = (value: string) => {
    setInput(value)
    const caret = inputRef.current?.selectionStart ?? value.length
    const token = loading ? null : detectMention(value.slice(0, caret))
    if (token) {
      if (!mention) void refetchDocs()
      if (openFolder) ensureFolderFiles(openFolder.root)
      setMention(token)
      setMentionIndex(0)
    } else if (mention) {
      closeMention()
    }
  }

  const selectMentionDoc = (doc: IngestedDoc) => {
    if (!mention) return
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast.error(t('playground.attachTooMany', { count: MAX_ATTACHMENTS }))
      return
    }
    setAttachments(prev => [...prev, {
      id: `doc-${Date.now()}-${doc.source_url}`,
      kind: 'doc',
      name: doc.title || doc.source_url,
      project: doc.project_key,
      url: doc.source_url,
    }])
    clearMentionToken()
    closeMention()
    inputRef.current?.focus()
  }

  const attachFileFromMention = () => {
    clearMentionToken()
    closeMention()
    fileInputRef.current?.click()
  }

  // @file: pull a workspace file's contents into a text attachment, fenced
  // under its project-relative path like a dropped file.
  const selectMentionFile = async (rel: string) => {
    if (!mention || !openFolder) return
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast.error(t('playground.attachTooMany', { count: MAX_ATTACHMENTS }))
      return
    }
    try {
      const res = await apiFetch<{ content?: string; binary?: boolean }>(
        `/api/fs/read?root=${encodeURIComponent(openFolder.root)}&path=${encodeURIComponent(rel)}`,
      )
      if (res.binary || typeof res.content !== 'string') {
        toast.error(t('playground.attachUnsupported', { name: rel }))
        return
      }
      const text = res.content.length > MAX_TEXT_BYTES
        ? `${res.content.slice(0, MAX_TEXT_BYTES)}\n…(truncated to ${MAX_TEXT_BYTES} bytes)`
        : res.content
      setAttachments(prev => [...prev, { id: `file-${Date.now()}-${rel}`, kind: 'text', name: rel, text }])
      clearMentionToken()
      closeMention()
      inputRef.current?.focus()
    } catch {
      toast.error(t('playground.attachFailed', { name: rel }))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mention) {
      const rows = mentionDocs.length + mentionFiles.length + 1 // docs + files + the attach-file row
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(i => (i + 1) % rows)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(i => (i - 1 + rows) % rows)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (mentionIndex < mentionDocs.length) selectMentionDoc(mentionDocs[mentionIndex])
        else if (mentionIndex < mentionDocs.length + mentionFiles.length) void selectMentionFile(mentionFiles[mentionIndex - mentionDocs.length])
        else attachFileFromMention()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMention()
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // "Clear" no longer throws the chat away: it starts a NEW conversation and
  // leaves the old one in the sidebar. (resetConversationState stops an open
  // stream too, or its next frame would paste the half-finished answer back
  // into the empty transcript.)

  // Searchable picker options: auto + fusion pinned at the top, then every model
  // ordered BY INTELLIGENCE — size tier first (Frontier→Small), then the catalog
  // rank within the tier, name as the final tiebreaker. (Raw intelligence_rank is
  // per-provider, not global, so tier-first matches the server's preset; #135.)
  const pickerOptions = [
    { value: 'auto', label: t('playground.autoModel'), sub: '', isNew: false, platforms: [] as string[] },
    { value: 'fusion', label: t('playground.fusionModel'), sub: '', isNew: false, platforms: [] as string[] },
    ...chainOptions,
    ...modelOptions
      .slice()
      .sort((a, b) =>
        a.sizeTier - b.sizeTier ||
        a.intelligenceRank - b.intelligenceRank ||
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      .map(o => ({
        value: o.value,
        label: o.label,
        sub: o.providerCount > 1 ? t('models.providerCount', { count: o.providerCount }) : o.platform,
        isNew: false,
        // Provider names for the multi-provider hover + search; empty when solo.
        platforms: o.providerCount > 1 ? o.platforms : [],
        // With images staged, flag (and dim) the models that can't read them.
        // Only a hint — sending anyway is allowed and the server decides.
        note: pendingImages.length > 0 && !visionValues.has(o.value)
          ? t('playground.noVisionBadge')
          : undefined,
      })),
  ]
  function pickModel(v: string) {
    setSelectedModel(v)
    localStorage.setItem('playground.model', v)
  }

  const activeModelLabel = selectedModel === 'auto'
    ? t('playground.autoModel')
    : selectedModel === 'fusion'
    ? t('playground.fusionModel')
    : selectedModel.startsWith('auto:')
    // A remembered chain whose name has since changed (or been deleted) has no
    // option left to read a label from; the raw id is still the truth.
    ? chainOptions.find(o => o.value === selectedModel)?.label ?? selectedModel
    : modelOptions.find(o => o.value === selectedModel)?.label ?? selectedModel

  return (
    // Three columns, edge to edge: conversations, the chat, the settings rail.
    // The page is a flex child of the shell's full-bleed container, so it is
    // exactly as tall as what the navbar leaves and nothing here scrolls except
    // the three panes that mean to. The transcript keeps its OWN scroll
    // container in the middle column — transcriptRef and the follow-the-stream
    // behaviour are untouched by the reshuffle.
    // Every lucide icon in the three panes draws at 1.5 instead of the default
    // 2: the page is dense with small glyphs and the bold stroke read heavy.
    <div className="flex min-h-0 flex-1 overflow-hidden [&_svg]:stroke-[1.5]">
      {/* The page's own conversation rail shows only below md: at md+ the
          workbench sidebar already lists recent chats, and two sidebars is
          one too many. `contents` keeps the flex row intact on mobile. */}
      <div className="contents md:hidden">
      <ConversationSidebar
        conversations={conversations}
        activeId={conversationId}
        open={sidebarOpen}
        onToggle={toggleSidebar}
        onNew={handleNewConversation}
        onSelect={handleSelectConversation}
        onRename={handleRenameConversation}
        onDelete={handleDeleteConversation}
      />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Chat header: what answers, and the code-pane split toggle (only
            once there is code to show — a toggle to nowhere teaches nothing). */}
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5">
          <Select value={selectedModel} onValueChange={(v) => { if (typeof v === 'string') pickModel(v) }}>
            <SelectTrigger
              size="sm"
              aria-label={t('playground.answeringAs', { model: activeModelLabel })}
              className="h-7 max-w-[240px] gap-1 border-0 bg-transparent px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <SelectValue>{activeModelLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {pickerOptions.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  <span className="truncate">{o.label}</span>
                  {o.sub ? <span className="truncate text-xs text-muted-foreground">{o.sub}</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {conversationId != null && (
            <Button
              variant="ghost"
              size="icon-sm"
              id="playground-agent-handoff"
              className={codeFiles.length > 0 ? '' : 'ml-auto'}
              aria-label={t('playground.agentHandoff')}
              title={t('playground.agentHandoff')}
              onClick={() => void handoffToAgent()}
            >
              <Bot className="size-4" />
            </Button>
          )}
          {codeFiles.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              id="playground-split-toggle"
              className="ml-auto"
              aria-pressed={split}
              onClick={toggleSplit}
              aria-label={t('playground.codeToggle')}
              title={t('playground.codeToggle')}
            >
              <PanelRight className="size-4" />
            </Button>
          )}
        </div>
        <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto p-6">
          {/* The chat sits in a centred column; the composer below shares its width. */}
          <div className="mx-auto h-full w-full max-w-3xl space-y-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center">
              <div className="space-y-2 max-w-sm">
                <div className="flex justify-center pb-1" aria-hidden="true">
                  <BrandMark size={52} animated />
                </div>
                {availableModels.length === 0 ? (
                  <>
                    <p className="text-base font-medium">{t('playground.emptyNoKeysTitle')}</p>
                    <p className="text-sm text-muted-foreground">{t('playground.emptyNoKeysBody')}</p>
                    <Button className="mt-2" onClick={() => navigate('/keys')}>
                      {t('playground.emptyNoKeysCta')}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-base font-medium">{t('playground.emptyTitle')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('playground.emptyDescription', { model: activeModelLabel })}
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => {
                const fusionPanel = msg.meta?.fusionPanel
                const okPanel = fusionPanel?.filter(p => p.status !== 'failed') ?? []
                // Skip an empty assistant bubble while the fusion trace is still
                // streaming in (no final answer yet) — the trace shows below.
                // Reasoning that arrives before the first answer token counts:
                // that IS the bubble's content for the moment.
                const showBubble = msg.role === 'user' || msg.content.length > 0 || !!msg.reasoning
                return (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {/* The user speaks in a bubble; the assistant answers as plain
                        text across the whole column — no box, no padding, no fill.
                        Errors keep their tinted box so they read as errors. */}
                    <div className={`flex flex-col gap-1 ${msg.role === 'user' ? 'max-w-[80%] items-end' : 'w-full items-start'}`}>
                      {showBubble && (
                        <div
                          className={`group relative text-sm leading-relaxed ${
                            msg.role === 'user'
                              ? 'rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground'
                              : msg.isError
                                ? 'rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-destructive'
                                : 'w-full'
                          }`}
                        >
                          {msg.images && msg.images.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {msg.images.map((src, n) => (
                                <img key={n} src={src} alt="" className="size-20 rounded-lg object-cover" />
                              ))}
                            </div>
                          )}
                          {msg.isError ? (
                            <div className="flex items-start gap-2">
                              <CircleAlert className="mt-0.5 size-4 shrink-0" />
                              <div className="min-w-0">
                                <p className="font-medium">{t('playground.errorTitle')}</p>
                                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                              </div>
                            </div>
                          ) : msg.role === 'assistant' ? (
                            <>
                              {(msg.reasoning || (msg.meta?.webSearch && msg.meta.webSearch.sources.length > 0)) && (
                                <ReplyTrace
                                  reasoning={msg.reasoning}
                                  search={msg.meta?.webSearch}
                                  answerStarted={msg.content.length > 0}
                                />
                              )}
                              <ArtifactHostContext.Provider value={artifactHost}>
                                <CodeHostContext.Provider value={codeHost}>
                                  <Markdown>{msg.content}</Markdown>
                                  {msg.media?.map((item, mi) => (
                                    <div key={mi} className="mt-2">
                                      {!item.url && (
                                        <p className="text-xs italic text-muted-foreground">{t('playground.mediaExpired')}</p>
                                      )}
                                      {item.kind === 'image' && item.url && (
                                        <img src={item.url} alt={item.prompt ?? 'Generated image'} className="max-h-64 rounded-lg border border-border" loading="lazy" />
                                      )}
                                      {item.kind === 'video' && item.url && (
                                        <video src={item.url} controls className="max-h-64 rounded-lg border border-border" />
                                      )}
                                      {item.kind === 'audio' && item.url && (
                                        <audio src={item.url} controls className="w-full" />
                                      )}
                                    </div>
                                  ))}
                                </CodeHostContext.Provider>
                              </ArtifactHostContext.Provider>
                            </>
                          ) : (
                            <UserMessageContent content={msg.content} />
                          )}
                          {msg.meta && (
                            <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px] opacity-70 tabular-nums">
                              {(fusionPanel || msg.meta.fusionStreaming) ? (
                                <>
                                  {okPanel.length > 0 && (
                                    <span>
                                      {t('playground.fusionPanel')}:{' '}
                                      <span className="font-mono">{okPanel.map(fusionRouteLabel).join(', ')}</span>
                                    </span>
                                  )}
                                  {msg.meta.fusionJudge && (
                                    <span>
                                      · {t('playground.fusionJudge')}:{' '}
                                      <span className="font-mono">{fusionRouteLabel(msg.meta.fusionJudge)}</span>
                                    </span>
                                  )}
                                  {msg.meta.latency != null && <span>· {msg.meta.latency} ms</span>}
                                </>
                              ) : (
                                <>
                                  {/* The maker's mark stands in for the host's name; the
                                      host is in the tooltip. Unknown makers get a neutral glyph. */}
                                  {(msg.meta.model || msg.meta.platform) && (
                                    <ModelMakerIcon modelId={msg.meta.model} platform={msg.meta.platform} className="size-3" />
                                  )}
                                  {msg.meta.model && <span className="font-mono">{msg.meta.model}</span>}
                                  {/* Which provider served it is known from the
                                      response headers straight away; the timing
                                      only means something once the last frame
                                      has landed. */}
                                  {msg.meta.latency != null && !msg.streaming && <span>· {msg.meta.latency} ms</span>}
                                  {msg.meta.fallbackAttempts != null && msg.meta.fallbackAttempts > 0 && (
                                    <span>· {msg.meta.fallbackAttempts} {msg.meta.fallbackAttempts > 1 ? t('playground.fallbacks') : t('playground.fallback')}</span>
                                  )}
                                </>
                              )}
                              {msg.role === 'assistant' && !msg.isError && msg.content && (
                                <CopyButton
                                  text={msg.content}
                                  label={t('playground.copyReply')}
                                  className="size-5 border-0 bg-transparent opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-60 hover:!opacity-100"
                                />
                              )}
                              {msg.role === 'assistant' && !msg.isError && msg.content && (
                                <SpeakButton
                                  text={msg.content}
                                  apiKey={keyData?.apiKey}
                                  className="size-5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-60 hover:!opacity-100"
                                />
                              )}
                            </div>
                          )}
                          {!msg.meta && msg.role === 'assistant' && !msg.isError && msg.content && (
                            <span className="mt-1 inline-flex items-center gap-1">
                              <CopyButton
                                text={msg.content}
                                label={t('playground.copyReply')}
                                className="size-5 border-0 bg-transparent opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-60 hover:!opacity-100"
                              />
                              <SpeakButton
                                text={msg.content}
                                apiKey={keyData?.apiKey}
                                className="size-5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-60 hover:!opacity-100"
                              />
                            </span>
                          )}
                        </div>
                      )}
                      {msg.role === 'assistant' && fusionPanel && fusionPanel.length > 0 && (
                        <FusionTrace
                          panel={fusionPanel}
                          judge={msg.meta?.fusionJudge}
                          streaming={msg.meta?.fusionStreaming}
                          answerStarted={msg.content.length > 0}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
              {/* Typing dots until the reply starts materialising — which is
                  the first fusion frame, the first token of a stream, or the
                  whole message on the buffered path. */}
              {loading && messages[messages.length - 1]?.role === 'user' && (
                <div className="flex justify-start">
                  <div className="py-2">
                    <div className="flex gap-1">
                      <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
          </div>
        </div>

        <div
          className={`mx-auto w-full max-w-3xl px-6 pb-4 pt-1 transition-colors ${dragging ? 'rounded-2xl bg-primary/5 ring-1 ring-inset ring-primary/40' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
          onDrop={e => {
            e.preventDefault()
            setDragging(false)
            addFiles([...e.dataTransfer.files])
          }}
        >
          {mention && !loading && (
            <MentionPicker
              docs={mentionDocs}
              files={mentionFiles}
              activeIndex={Math.min(mentionIndex, mentionDocs.length + mentionFiles.length)}
              onSelectDoc={selectMentionDoc}
              onSelectFile={rel => void selectMentionFile(rel)}
              onAttachFile={attachFileFromMention}
              onHover={setMentionIndex}
            />
          )}
          {/* One composer box: context chips, the input, and every option
              (modes, model, search) live inside it — nothing floats beside. */}
          <div className="rounded-2xl border border-border/70 bg-card/40 p-2">
            {(openFolder || attachments.length > 0) && (
              <div className="flex flex-wrap gap-2 px-1 pb-2">
                {openFolder && (
              <div className="relative flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 py-1 pl-1.5 pr-6 text-xs">
                <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="max-w-[200px] truncate font-mono" title={openFolder.root}>
                  {openFolder.root.split('/').pop() || openFolder.root}/
                </span>
                <span className="tabular-nums text-muted-foreground">{openFolder.files}</span>
                <button
                  type="button"
                  aria-label={t('common.remove')}
                  title={t('common.remove')}
                  onClick={() => setOpenFolderState(null)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
                )}
                {attachments.map(a => (
                <div key={a.id} className="relative flex items-center gap-1.5 rounded-lg border bg-background py-1 pl-1.5 pr-6 text-xs">
                  {a.kind === 'image' && a.dataUrl
                    ? <img src={a.dataUrl} alt="" className="size-8 rounded object-cover" />
                    : a.kind === 'doc'
                      ? <BookOpenText className="size-4 shrink-0 text-muted-foreground" />
                      : a.id.startsWith('folder-')
                        ? <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                        : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="max-w-[140px] truncate">{a.name}</span>
                  <button
                    type="button"
                    aria-label={t('common.remove')}
                    title={t('common.remove')}
                    onClick={() => removeAttachment(a.id)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                ))}
              </div>
            )}
          {modelBlindToImages && (
            <div className="mb-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>{t('playground.visionWarning', { model: activeModelLabel })}</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="hidden"
            onChange={e => {
              addFiles([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          <LiquidComposer
            inputRef={inputRef}
            value={input}
            onChange={handleComposerChange}
            onKeyDown={handleKeyDown}
            onPaste={e => {
              // Screenshot straight from the clipboard; a normal text paste
              // carries no files and falls through untouched.
              const files = [...e.clipboardData.files]
              if (files.length === 0) return
              e.preventDefault()
              addFiles(files)
            }}
            placeholder={t(MODE_PLACEHOLDER_KEYS[mode])}
            hasContent={composerHasContent(input, attachments.length)}
            loading={loading}
            onSend={handleSend}
            onAttach={() => fileInputRef.current?.click()}
            onFolder={canPickFolder() ? handleFolder : undefined}
            labels={{ add: t('playground.addMenu'), attach: t('playground.attach'), folder: t('playground.folder'), send: t('playground.send'), sending: t('playground.sending') }}
            dictation={{
              onUnavailable: dictationUnavailableHint ? () => {
                if (shortcutHintKey) inputRef.current?.focus()
                toast.info(dictationUnavailableHint)
              } : undefined,
              model: dictationModel,
              apiKey: keyData?.apiKey,
              onText: text => {
                setInput(prev => appendDictation(prev, text))
                inputRef.current?.focus()
              },
            }}
          />
            {/* Composer toolbar: modes, model, and web search — the options
                that used to float around the box, now one row inside it. */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 pt-1.5">
              <div className="flex items-center gap-0.5" role="group" aria-label={t('playground.modeLabel')}>
                {(['chat', 'image', 'video', 'audio'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                      mode === m
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {t(MODE_LABEL_KEYS[m])}
                  </button>
                ))}
              </div>
              <span aria-hidden="true" className="h-4 w-px bg-border" />
              <Select value={selectedModel} onValueChange={(v) => { if (typeof v === 'string') pickModel(v) }}>
                <SelectTrigger
                  size="sm"
                  aria-label={t('playground.answeringAs', { model: activeModelLabel })}
                  title={t('playground.answeringAs', { model: activeModelLabel })}
                  className="h-6 max-w-[150px] gap-1 border-0 bg-transparent px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <SelectValue>{activeModelLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {pickerOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="truncate">{o.label}</span>
                      {o.sub ? <span className="truncate text-xs text-muted-foreground">{o.sub}</span> : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span aria-hidden="true" className="h-4 w-px bg-border" />
              <button
                type="button"
                onClick={() => updateWebSearch(!webSearchOn)}
                disabled={!webSearchAvailable}
                aria-pressed={webSearchOn}
                title={webSearchAvailable ? t('search.playgroundToggle') : (webSearchUnavailableHint ?? t('search.playgroundToggle'))}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  webSearchOn
                    ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Globe className="size-3" />
                {t('search.playgroundToggle')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Last column, and last in the DOM on purpose: the system prompt textarea
          it carries must never come before the composer's, which is what a
          plain `textarea` selector reaches for. */}
      {/* The artifact panel takes the rail's column while something is open;
          else the code pane when split is on and the thread has code;
          otherwise the settings rail as it was. */}
      {artifact ? (
        <ArtifactPanel
          artifact={artifact}
          open={artifactOpen}
          width={artifactWidth}
          onWidthChange={setArtifactWidth}
          onWidthCommit={commitArtifactWidth}
          chromeWidth={paneChromeWidth}
          onClose={() => {
            closeArtifact()
            // The close button unmounts with the panel — land focus on the
            // composer, the page's primary control, instead of the body.
            inputRef.current?.focus()
          }}
        />
      ) : codeMounted ? (
        <CodePane
          files={codeFiles}
          activeId={codeActiveId}
          onSelect={setCodeActiveId}
          open={codeOpen}
          width={codeWidth}
          onWidthChange={setCodeWidth}
          onWidthCommit={commitCodeWidth}
          chromeWidth={paneChromeWidth}
          onClose={() => {
            toggleSplit()
            // The close button unmounts with the pane — land focus on the
            // split toggle instead of dropping it to the body.
            document.getElementById('playground-split-toggle')?.focus()
          }}
        />
      ) : (
      <SettingsRail
        open={settingsOpen}
        onToggle={toggleSettings}
        modelValue={selectedModel}
        modelOptions={pickerOptions}
        onSelectModel={pickModel}
        noModels={availableModels.length === 0}
        dictationValue={dictationModel}
        dictationOptions={dictationOptions}
        onSelectDictation={pickDictationModel}
        dictationUnavailableHint={dictationUnavailableHint}
        systemPrompt={systemPrompt}
        onSystemPromptChange={updateSystemPrompt}
        sampling={sampling}
        onSamplingChange={updateSampling}
        webSearch={webSearch}
        onWebSearchChange={updateWebSearch}
        webSearchAvailable={webSearchAvailable}
        webSearchUnavailableHint={webSearchUnavailableHint}
        webSearchChain={usableEngines.map(e => e.displayName).join(' → ')}
      />
      )}
    </div>
  )
}
