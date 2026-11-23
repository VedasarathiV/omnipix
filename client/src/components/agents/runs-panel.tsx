import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ImagePlus, Loader2, Play, Search, Square, SquareTerminal, Trash2, X } from 'lucide-react'
import { apiFetch, getToken } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { SpeakButton } from '@/components/speak-button'
import { DictationButton } from '@/components/playground/dictation-button'
import { speakText, useVoiceSettings } from '@/lib/speech'
import { canPickFolder, pickFolderTree } from '@/lib/desktop-folder'
import { AttachmentError, MAX_IMAGE_BYTES, readImageAttachment } from '@/lib/attachments'
import { hasTranscription, resolveDictationModel, type TranscriptionModelRow } from '@/lib/transcription'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'

export interface AgentStep {
  seq: number
  kind: string
  label: string
  content: Record<string, unknown> | null
}

export interface AgentRun {
  id: number
  goal: string
  model: string
  tools: string[]
  skills: string[]
  image_count?: number
  session_id: number | null
  plan_mode: number
  parent_run_id: number | null
  auto_approve: number
  workdir?: string | null
  status: 'running' | 'done' | 'error' | 'stopped' | 'awaiting_approval'
  final_answer: string | null
  error: string | null
  steps_used: number
  prompt_tokens: number
  completion_tokens: number
  cost_usd?: number
  created_at: string
  steps: AgentStep[]
}

export interface AgentSession {
  id: number
  title: string
  conversation_id: number | null
  workdir: string | null
  run_count: number
  last_status: string | null
  created_at: string
  updated_at: string
}

interface SkillRow {
  name: string
  description: string
  enabled: number
  builtin: number
}

interface ModelRow {
  modelId: string
  displayName: string
  enabled: boolean
  keyCount: number
}

interface McpTool {
  qualifiedName: string
  serverName: string
  name: string
  description?: string
}

interface Checkpoint {
  id: number
  run_id: number
  seq: number
  label: string
  created_at: string
}

interface ToolCatalogEntry {
  name: string
  description: string
  risk: string
}

const STATUS_VARIANT: Record<AgentRun['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'default',
  done: 'secondary',
  error: 'destructive',
  stopped: 'outline',
  awaiting_approval: 'default',
}

function stepText(step: AgentStep): string {
  const c = step.content ?? {}
  switch (step.kind) {
    case 'thought':
    case 'answer':
    case 'plan':
      return typeof c.text === 'string' ? c.text : ''
    case 'tool_call':
      return `${String(c.tool ?? '?')}(${typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {})})`
    case 'tool_result':
      return String(
        c.result ?? (c.ok === false ? c.error ?? 'failed' : JSON.stringify(c).slice(0, 500)),
      )
    case 'check':
      return `${c.pass ? 'PASS' : 'FAIL'} ${String(c.command ?? '')}${c.summary ? `\n${String(c.summary).slice(0, 1000)}` : ''}`
    case 'restore':
      return `restored checkpoint #${String(c.checkpoint_id ?? '?')} (${String(c.label ?? '')})`
    case 'hook':
      return `hook "${String(c.hook ?? '?')}" (${String(c.event ?? '')}): ${String(c.message ?? '')}`
    case 'compact':
      return `context compacted (cycle ${String(c.cycle ?? '?')}${typeof c.trigger === 'string' ? `, ${c.trigger}` : ''}): ${typeof c.summary === 'string' ? c.summary : ''}`
    default:
      return JSON.stringify(c).slice(0, 500)
  }
}

export function AgentRunsPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [goal, setGoal] = useState('')
  // Native tool catalog, live from the server: new tools appear in the
  // launcher without a dashboard change. Null until the first load seeds it.
  const { data: toolCatalog = [] } = useQuery<ToolCatalogEntry[]>({
    queryKey: ['agent-tool-catalog'],
    queryFn: () => apiFetch<{ tools: ToolCatalogEntry[] }>('/api/agents/tools').then(r => r.tools),
  })
  const [toolSelection, setToolSelection] = useState<string[] | null>(null)
  const toolNames = toolCatalog.map(tool => tool.name)
  const effectiveTools = toolSelection ?? toolNames
  if (toolSelection === null && toolNames.length > 0) {
    setToolSelection(toolNames)
  }
  // Reference images riding on the run goal (screenshots, mockups). Encoded
  // with the chat's caps so oversized pastes shrink instead of failing.
  const [runImages, setRunImages] = useState<string[]>([])
  const runImageInput = useRef<HTMLInputElement | null>(null)
  const [model, setModel] = useState('auto')
  const tools = effectiveTools
  const setTools = setToolSelection
  const [skills, setSkills] = useState<string[]>([])
  const [maxSteps, setMaxSteps] = useState(12)
  const [maxTokens, setMaxTokens] = useState('')
  const [compactions, setCompactions] = useState(1)
  const [planMode, setPlanMode] = useState(false)
  const [workdir, setWorkdir] = useState('')
  const [sessionId, setSessionId] = useState<string>('new')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([])
  const [streamDead, setStreamDead] = useState(false)
  const [terminal, setTerminal] = useState('')
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [restored, setRestored] = useState<{ runId: number; id: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Deep links (?session=ID from chat/CLI, ?run=ID from notifications) apply
  // during render, not in an effect: the previous-link state makes each link
  // apply exactly once, including Back-button navigations, with no commit.
  const [consumedLinks, setConsumedLinks] = useState('')
  const links = `${searchParams.get('session') ?? ''}|${searchParams.get('run') ?? ''}`
  if (links !== consumedLinks) {
    setConsumedLinks(links)
    const linkedSession = searchParams.get('session')
    if (linkedSession && /^\d+$/.test(linkedSession)) setSessionId(linkedSession)
    const linkedRun = searchParams.get('run')
    if (linkedRun && /^\d+$/.test(linkedRun)) setSelectedId(Number(linkedRun))
  }

  const { data: models = [] } = useQuery<ModelRow[]>({
    queryKey: ['models'],
    queryFn: () => apiFetch('/api/models'),
  })
  const { data: keyData } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })
  const { data: voiceSettings } = useVoiceSettings()
  const { data: mediaData } = useQuery<{ models: TranscriptionModelRow[] }>({
    queryKey: ['media'],
    queryFn: () => apiFetch('/api/media'),
  })
  const mediaModels = mediaData?.models ?? []
  const { data: skillRows = [] } = useQuery<SkillRow[]>({
    queryKey: ['agent-skills'],
    queryFn: () => apiFetch<{ skills: SkillRow[] }>('/api/skills').then(r => r.skills),
  })
  const { data: mcpTools = [] } = useQuery<McpTool[]>({
    queryKey: ['mcp-tools'],
    queryFn: () => apiFetch<{ tools: McpTool[] }>('/api/mcp/tools').then(r => r.tools),
  })
  const { data: sessions = [] } = useQuery<AgentSession[]>({
    queryKey: ['agent-sessions'],
    queryFn: () => apiFetch<{ sessions: AgentSession[] }>('/api/agents/sessions?limit=30').then(r => r.sessions),
  })
  const activeSessionId = sessionId === 'new' ? undefined : Number(sessionId)

  // A session carries its project folder (chat handoff sets it): picking a
  // session prefills an untouched workdir box. Typed text always wins — the
  // seed key records every session seen, so clearing the box never re-seeds.
  // Render-time like the deep-link block above: setState-in-effect is banned.
  const [seededWorkdirKey, setSeededWorkdirKey] = useState('')
  const seedSession = sessionId === 'new' ? undefined : sessions.find(x => String(x.id) === sessionId)
  const seedKey = `${sessionId}|${seedSession?.workdir ?? ''}`
  if (seedKey !== seededWorkdirKey) {
    setSeededWorkdirKey(seedKey)
    if (!workdir.trim() && seedSession?.workdir) setWorkdir(seedSession.workdir)
  }
  const sessionLabel = useMemo(() => {
    if (sessionId === 'new') return t('agents.sessions.new')
    const s = sessions.find(x => String(x.id) === sessionId)
    return s ? `${s.title || `#${s.id}`} · ${t('agents.sessions.runs', { count: s.run_count })}` : `#${sessionId}`
  }, [sessionId, sessions, t])
  const { data: runsData } = useQuery<{ runs: AgentRun[] }>({
    queryKey: ['agent-runs', activeSessionId ?? 'all'],
    queryFn: () => apiFetch(activeSessionId === undefined
      ? '/api/agents/runs?limit=30'
      : `/api/agents/runs?limit=30&session=${activeSessionId}`),
    refetchInterval: query =>
      query.state.data?.runs.some(r => r.status === 'running' || r.status === 'awaiting_approval') ? 2000 : false,
  })
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])
  const searching = debouncedSearch.length >= 2
  const { data: searchData } = useQuery<{ runs: AgentRun[] }>({
    queryKey: ['agent-runs-search', debouncedSearch],
    queryFn: () => apiFetch(`/api/agents/runs/search?q=${encodeURIComponent(debouncedSearch)}&limit=30`),
    enabled: searching,
  })
  // Search hits are summaries; the trace loads the full run on selection.
  const { data: searchDetail } = useQuery<AgentRun>({
    queryKey: ['agent-run', selectedId],
    queryFn: () => apiFetch(`/api/agents/runs/${selectedId}`),
    enabled: searching && selectedId != null,
  })
  const runs = useMemo(
    () => searching ? (searchData?.runs ?? []) : (runsData?.runs ?? []),
    [searching, searchData, runsData],
  )
  const selected = useMemo(
    () => searching ? (searchDetail ?? null) : (runs.find(r => r.id === selectedId) ?? null),
    [searching, searchDetail, runs, selectedId],
  )

  // One-click PR form state, reset per selected run (render-time like the
  // deep-link block: setState-in-effect is banned in this codebase).
  const [prOpen, setPrOpen] = useState(false)
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [prBase, setPrBase] = useState('')
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [prRunId, setPrRunId] = useState<number | null>(null)
  if ((selected?.id ?? null) !== prRunId) {
    setPrRunId(selected?.id ?? null)
    setPrOpen(false)
    setPrTitle(selected?.goal ?? '')
    setPrBody('')
    setPrBase('')
    setPrUrl(null)
  }
  const openPr = useMutation({
    mutationFn: () =>
      apiFetch<{ url: string }>(`/api/agents/runs/${selectedId}/git/pr`, {
        method: 'POST',
        body: JSON.stringify({
          title: prTitle.trim(),
          ...(prBody.trim() ? { body: prBody.trim() } : {}),
          ...(prBase.trim() ? { base: prBase.trim() } : {}),
        }),
      }),
    onSuccess: res => setPrUrl(res.url),
    onError: err => toast.error(err instanceof Error ? err.message : String(err)),
  })

  // Voice agent announcements: when auto-speak is on, read the selected run's
  // outcome once as it lands — completion, failure, or approval request.
  const announcedRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    if (!voiceSettings?.autoSpeakRuns || !keyData?.apiKey || !selected) return
    if (announcedRef.current.has(selected.id)) return
    const status = selected.status
    if (status !== 'done' && status !== 'error' && status !== 'stopped' && status !== 'awaiting_approval') return
    announcedRef.current.add(selected.id)
    const message = status === 'awaiting_approval'
      ? t('agents.runs.voiceApproval')
      : status === 'done'
        ? `${t('agents.runs.voiceDone')} ${selected.final_answer ?? ''}`
        : t('agents.runs.voiceFailed', { error: selected.error ?? '' })
    void speakText(message, {
      apiKey: keyData.apiKey,
      model: voiceSettings.ttsModel,
      voice: voiceSettings.ttsVoice,
    }).catch(() => {})
  }, [voiceSettings, keyData?.apiKey, selected, t])

  const addRunImages = async (files: File[]) => {
    for (const file of files) {
      if (runImages.length >= 5) {
        toast.error(t('agents.runs.tooManyImages', { count: 5 }))
        break
      }
      try {
        const dataUrl = await readImageAttachment(file)
        setRunImages(prev => (prev.length >= 5 ? prev : [...prev, dataUrl]))
      } catch (err) {
        toast.error(err instanceof AttachmentError && err.reason === 'too-large'
          ? t('playground.attachTooLarge', { name: file.name, max: `${Math.round(MAX_IMAGE_BYTES / 1_000_000)} MB` })
          : t('playground.attachFailed', { name: file.name }))
      }
    }
  }

  const start = useMutation({
    mutationFn: () =>
      apiFetch<AgentRun>('/api/agents/runs', {
        method: 'POST',
        body: JSON.stringify({
          goal: goal.trim(), model, tools, skills, maxSteps,
          ...(maxTokens.trim() ? { maxTokens: Number(maxTokens) } : {}),
          planMode, compactions,
          ...(workdir.trim() ? { workdir: workdir.trim() } : {}),
          ...(activeSessionId === undefined ? {} : { sessionId: activeSessionId }),
          ...(runImages.length ? { images: runImages } : {}),
        }),
      }),
    onSuccess: run => {
      setGoal('')
      setRunImages([])
      setSelectedId(run.id)
      setLiveSteps([])
      setStreamDead(false)
      // A fresh run got its own session server-side: adopt it so history
      // and follow-ups stay in the same thread.
      if (run.session_id != null) {
        setSessionId(String(run.session_id))
        setSearchParams(prev => {
          const next = new URLSearchParams(prev)
          next.set('session', String(run.session_id))
          return next
        }, { replace: true })
      }
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] })
      void queryClient.invalidateQueries({ queryKey: ['agent-sessions'] })
    },
  })

  const removeSession = useMutation({
    mutationFn: () =>
      apiFetch(`/api/agents/sessions/${activeSessionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSessionId('new')
      setSelectedId(null)
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        next.delete('session')
        return next
      }, { replace: true })
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] })
      void queryClient.invalidateQueries({ queryKey: ['agent-sessions'] })
    },
  })

  const stop = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/agents/runs/${id}/stop`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-runs'] }),
  })

  const { data: checkpointsData } = useQuery<{ checkpoints: Checkpoint[] }>({
    queryKey: ['agent-checkpoints', selectedId],
    queryFn: () => apiFetch(`/api/agents/runs/${selectedId}/checkpoints`),
    enabled: selectedId != null,
  })
  const checkpoints = checkpointsData?.checkpoints ?? []

  const snapshot = useMutation({
    mutationFn: () =>
      apiFetch(`/api/agents/runs/${selectedId}/checkpoints`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-checkpoints', selectedId] }),
  })
  const restore = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ restored: number; run: AgentRun }>(`/api/agents/checkpoints/${id}/restore`, { method: 'POST' }),
    onSuccess: result => {
      if (selectedId != null) setRestored({ runId: selectedId, id: result.restored })
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] })
    },
  })
  // Fork: an independent copy of the selected run (own workspace, transcript
  // prefix), started immediately. The new run takes over the detail view.
  const fork = useMutation({
    mutationFn: (checkpointId?: number) =>
      apiFetch<AgentRun & { fromSeq: number | null }>(`/api/agents/runs/${selectedId}/fork`, {
        method: 'POST',
        body: JSON.stringify(checkpointId === undefined ? {} : { checkpointId }),
      }),
    onSuccess: result => {
      toast.success(t('agents.runs.forked', { id: result.id }))
      setSelectedId(result.id)
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] })
    },
    onError: err => toast.error(err instanceof Error ? err.message : String(err)),
  })

  // Live step stream for the selected running run. fetch + reader, not
  // EventSource, so the dashboard bearer token travels with the request.
  // The synchronous resets are intentional: switching runs must clear the
  // previous run's steps/terminal before the new subscription lands.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setLiveSteps([])
    setStreamDead(false)
    setTerminal('')
    if (selectedId == null) return
    const run = runs.find(r => r.id === selectedId)
    if (!run || (run.status !== 'running' && run.status !== 'awaiting_approval')) return
    const controller = new AbortController()
    abortRef.current = controller
    let cancelled = false
    ;(async () => {
      try {
        const token = getToken()
        const res = await fetch(`./api/agents/runs/${selectedId}/events`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          if (!cancelled) setStreamDead(true)
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const frames = buf.split('\n\n')
          buf = frames.pop() ?? ''
          for (const frame of frames) {
            const line = frame.split('\n').find(l => l.startsWith('data:'))
            if (!line) continue
            try {
              const evt = JSON.parse(line.slice(5).trim()) as
                | { type: 'step'; step: AgentStep }
                | { type: 'terminal'; data: string; stream: string }
                | { type: 'done' | 'error' | 'stopped' | 'awaiting' }
              if (evt.type === 'step') {
                setLiveSteps(prev =>
                  prev.some(s => s.seq === evt.step.seq) ? prev : [...prev, evt.step],
                )
              } else if (evt.type === 'terminal') {
                // Live shell output only — the capped result persists in the
                // tool_result step, so a reconnect loses nothing durable.
                setTerminal(prev => (prev + (evt.data ?? '')).slice(-20000))
                setTerminalOpen(true)
              } else {
                void queryClient.invalidateQueries({ queryKey: ['agent-runs'] })
              }
            } catch { /* partial frame */ }
          }
        }
      } catch (err) {
        if (!cancelled && (err as Error).name !== 'AbortError') setStreamDead(true)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.status])
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggle(list: string[], value: string, set: (v: string[]) => void) {
    set(list.includes(value) ? list.filter(v => v !== value) : [...list, value])
  }

  // SSE replays persisted steps too: merge live frames with the stored list,
  // deduped by seq, so refresh and reconnect never duplicate a step.
  const steps = useMemo(() => {
    const stored = selected?.steps ?? []
    const seen = new Set(stored.map(s => s.seq))
    return [...stored, ...liveSteps.filter(s => !seen.has(s.seq))].sort((a, b) => a.seq - b.seq)
  }, [selected, liveSteps])

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t('agents.runs.newTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="agent-goal">{t('agents.runs.goal')}</Label>
              <DictationButton
                onUnavailable={hasTranscription(mediaModels) ? undefined : () => toast.info(t('playground.dictationUnavailable'))}
                model={resolveDictationModel(voiceSettings?.sttModel, mediaModels)}
                apiKey={keyData?.apiKey}
                onText={text => setGoal(prev => prev ? `${prev} ${text}` : text)}
              />
            </div>
            <Textarea
              id="agent-goal"
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder={t('agents.runs.goalPlaceholder')}
              rows={3}
            />
            <p className="text-[11px] text-muted-foreground">{t('agents.runs.slashHint')}</p>
            <input
              ref={runImageInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              aria-label={t('agents.runs.attachImages')}
              onChange={e => {
                void addRunImages([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => runImageInput.current?.click()}
              >
                <ImagePlus /> {t('agents.runs.attachImages')}
              </Button>
              {runImages.map((url, i) => (
                <div key={`${i}-${url.slice(0, 32)}`} className="relative">
                  <img src={url} alt="" className="size-10 rounded-md border object-cover" />
                  <button
                    type="button"
                    aria-label={t('common.remove')}
                    onClick={() => setRunImages(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-session">{t('agents.sessions.label')}</Label>
            <div className="flex gap-1.5">
              <Select value={sessionId} onValueChange={v => { if (v) { setSessionId(v); setSelectedId(null) } }}>
                <SelectTrigger id="agent-session" className="min-w-0 flex-1">
                  <span className="flex flex-1 truncate text-left">{sessionLabel}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">{t('agents.sessions.new')}</SelectItem>
                  {sessions.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.title || `#${s.id}`} · {t('agents.sessions.runs', { count: s.run_count })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeSessionId !== undefined && (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={removeSession.isPending}
                  aria-label={t('agents.sessions.delete')}
                  onClick={() => {
                    if (window.confirm(t('agents.sessions.deleteConfirm'))) removeSession.mutate()
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-model">{t('agents.runs.model')}</Label>
            <Select value={model} onValueChange={v => { if (v) setModel(v) }}>
              <SelectTrigger id="agent-model">
                <span className="flex flex-1 truncate text-left">
                  {model === 'auto' ? t('agents.runs.modelAuto') : (models.find(m => m.modelId === model)?.displayName ?? model)}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('agents.runs.modelAuto')}</SelectItem>
                {models
                  .filter(m => m.enabled && (m.keyCount ?? 0) > 0)
                  .map(m => (
                    <SelectItem key={m.modelId} value={m.modelId}>
                      {m.displayName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {models.length > 0 && !models.some(m => m.enabled && (m.keyCount ?? 0) > 0) && (
            <p role="note" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              {t('agents.runs.noKeys')}
            </p>
          )}
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium">{t('agents.runs.tools')}</legend>
            <p className="mb-1.5 text-[11px] text-muted-foreground">{t('agents.runs.approvalHint')}</p>
            <div className="mb-1.5 flex gap-2">
              <button
                type="button"
                onClick={() => setTools([...toolNames, ...mcpTools.map(m => m.qualifiedName)])}
                className="text-[11px] text-primary underline-offset-2 hover:underline"
              >
                {t('agents.runs.selectAll')}
              </button>
              <span className="text-[11px] text-muted-foreground">
                {t('agents.runs.selectedCount', { count: tools.length })}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {toolCatalog.map(tool => (
                <Badge
                  key={tool.name}
                  variant={tools.includes(tool.name) ? 'default' : 'outline'}
                  className="cursor-pointer font-mono text-[11px]"
                  title={tool.description}
                  onClick={() => toggle(tools, tool.name, setTools)}
                >
                  {tool.name}
                </Badge>
              ))}
            </div>
          </fieldset>
          {mcpTools.length > 0 && (
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium">{t('agents.mcp.runTools')}</legend>
              <div className="flex flex-wrap gap-1.5">
                {mcpTools.map(tool => (
                  <Badge
                    key={tool.qualifiedName}
                    variant={tools.includes(tool.qualifiedName) ? 'default' : 'outline'}
                    className="cursor-pointer font-mono text-[11px]"
                    title={tool.description}
                    onClick={() => toggle(tools, tool.qualifiedName, setTools)}
                  >
                    {tool.serverName}/{tool.name}
                  </Badge>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium">{t('agents.runs.skills')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {skillRows.filter(s => s.enabled).map(s => (
                <Badge
                  key={s.name}
                  variant={skills.includes(s.name) ? 'default' : 'outline'}
                  className="cursor-pointer text-[11px]"
                  onClick={() => toggle(skills, s.name, setSkills)}
                >
                  {s.name}
                </Badge>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="agent-max-steps">{t('agents.runs.maxSteps')}</Label>
              <Input
                id="agent-max-steps"
                type="number"
                min={1}
                max={25}
                value={maxSteps}
                onChange={e => setMaxSteps(Number(e.target.value))}
                className="w-24"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="agent-max-tokens">{t('agents.runs.maxTokens')}</Label>
              <Input
                id="agent-max-tokens"
                type="number"
                min={100}
                value={maxTokens}
                onChange={e => setMaxTokens(e.target.value)}
                placeholder={t('agents.runs.maxTokensPlaceholder')}
                className="w-28"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="agent-compactions">{t('agents.runs.compactions')}</Label>
              <Input
                id="agent-compactions"
                type="number"
                min={0}
                max={3}
                value={compactions}
                onChange={e => setCompactions(Number(e.target.value))}
                className="w-24"
              />
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">{t('agents.runs.compactionsHint')}</p>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-workdir">{t('agents.runs.workdir')}</Label>
            <div className="flex gap-2">
              <Input
                id="agent-workdir"
                value={workdir}
                onChange={e => setWorkdir(e.target.value)}
                placeholder={t('agents.runs.workdirPlaceholder')}
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 flex-1 font-mono text-xs"
              />
              {canPickFolder() && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void pickFolderTree().then(tree => { if (tree) setWorkdir(tree.root) }).catch(() => {})}
                >
                  {t('agents.runs.workdirPick')}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">{t('agents.runs.workdirHint')}</p>
          </div>
          <div className="flex items-start gap-2">
            <Switch
              id="agent-plan-mode"
              checked={planMode}
              onCheckedChange={setPlanMode}
            />
            <div className="grid gap-0.5">
              <Label htmlFor="agent-plan-mode">{t('agents.runs.planMode')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('agents.runs.planModeHint')}</p>
            </div>
          </div>
          {start.isError && (
            <p role="alert" className="text-xs text-destructive">
              {(start.error as Error).message}
            </p>
          )}
          <Button
            onClick={() => start.mutate()}
            disabled={!goal.trim() || start.isPending}
            className="w-fit"
          >
            {start.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            {start.isPending ? t('agents.runs.starting') : t('agents.runs.start')}
          </Button>
        </CardContent>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('agents.runs.history')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('agents.runs.searchPlaceholder')}
                aria-label={t('agents.runs.searchPlaceholder')}
                className="h-8 pl-8 text-xs"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setSelectedId(null) }}
                  aria-label={t('agents.runs.searchClear')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            {runs.length === 0 && (
              <p className="text-xs text-muted-foreground">{searching ? t('agents.runs.searchEmpty') : t('agents.runs.empty')}</p>
            )}
            {runs.map(run => (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelectedId(run.id)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50 ${
                  run.id === selectedId ? 'border-primary/40 bg-muted/50' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{run.goal}</span>
                {run.plan_mode === 1 && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {t('agents.runs.planned')}
                  </Badge>
                )}
                {run.auto_approve === 1 && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {t('agents.runs.autoApprove')}
                  </Badge>
                )}
                <span className="shrink-0 text-muted-foreground">
                  {run.steps_used} {t('agents.runs.steps')}
                </span>
                <Badge variant={STATUS_VARIANT[run.status]} className="flex shrink-0 items-center gap-1.5">
                  {(run.status === 'running' || run.status === 'awaiting_approval') && (
                    <span className="ox-live-dot inline-block size-1.5 rounded-full bg-current" aria-hidden="true" />
                  )}
                  {t(`agents.runs.status.${run.status}`)}
                </Badge>
              </button>
            ))}
          </CardContent>
        </Card>

        {selected && (
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium">{selected.goal}</CardTitle>
              <CardDescription className="font-mono text-[11px]">
                {selected.model} · {selected.prompt_tokens + selected.completion_tokens} tokens
                {(selected.cost_usd ?? 0) > 0 && <> · ${selected.cost_usd!.toFixed(4)}</>}
                {selected.parent_run_id != null && (
                  <> · {t('agents.runs.childOf', { id: selected.parent_run_id })}</>
                )}
                {(selected.image_count ?? 0) > 0 && (
                  <> · {t('agents.runs.imageCount', { count: selected.image_count ?? 0 })}</>
                )}
                {selected.workdir != null && selected.workdir !== '' && (
                  <span className="block truncate" title={selected.workdir}>📁 {selected.workdir}</span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {streamDead && (
                <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
                  {t('agents.runs.streamError')}
                </p>
              )}
              {(selected.status === 'running' || selected.status === 'awaiting_approval') && steps.length === 0 && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> {t('agents.runs.thinking')}
                </p>
              )}
              {steps.map(step => (
                <div key={step.seq} className="rounded-xl bg-muted/50 px-3 py-2">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    #{step.seq} · {step.label}
                  </p>
                  <p className="mt-0.5 text-xs whitespace-pre-wrap break-words">
                    {stepText(step)}
                  </p>
                </div>
              ))}
              {selected.final_answer && (
                <div className="rounded-xl border border-primary/30 px-3 py-2">
                  <p className="flex items-center gap-1 text-[11px] font-medium text-primary">
                    {t('agents.runs.finalAnswer')}
                    <SpeakButton text={selected.final_answer} apiKey={keyData?.apiKey} className="size-5" />
                  </p>
                  <p className="mt-0.5 text-xs whitespace-pre-wrap break-words">
                    {selected.final_answer}
                  </p>
                </div>
              )}
              {selected.error && (
                <p role="alert" className="text-xs text-destructive">{selected.error}</p>
              )}
              {terminal && (
                <div className="rounded-xl border">
                  <button
                    type="button"
                    onClick={() => setTerminalOpen(v => !v)}
                    aria-expanded={terminalOpen}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium text-muted-foreground"
                  >
                    <SquareTerminal className="size-3.5" />
                    {t('agents.runs.terminal')}
                    <ChevronDown className={`ml-auto size-3.5 transition-transform ${terminalOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {terminalOpen && (
                    <pre className="max-h-56 overflow-auto border-t bg-black/85 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-100 dark:bg-black">
                      {terminal}
                    </pre>
                  )}
                </div>
              )}
              {(selected.status === 'running' || selected.status === 'awaiting_approval') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={stop.isPending}
                  onClick={() => stop.mutate(selected.id)}
                >
                  <Square /> {t('agents.runs.stop')}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={fork.isPending}
                title={t('agents.runs.forkHint')}
                onClick={() => fork.mutate(undefined)}
              >
                {fork.isPending ? t('agents.runs.forking') : t('agents.runs.fork')}
              </Button>
              <div className="rounded-xl border px-3 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {t('agents.runs.pr.title')}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-2 text-xs"
                    onClick={() => setPrOpen(v => !v)}
                    aria-expanded={prOpen}
                  >
                    {prOpen ? t('agents.runs.pr.hide') : t('agents.runs.pr.open')}
                  </Button>
                </div>
                {prOpen && (
                  <div className="mt-2 flex flex-col gap-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="run-pr-title" className="text-xs">{t('agents.runs.pr.titleLabel')}</Label>
                      <Input
                        id="run-pr-title"
                        value={prTitle}
                        onChange={e => setPrTitle(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="run-pr-body" className="text-xs">{t('agents.runs.pr.bodyLabel')}</Label>
                      <Textarea
                        id="run-pr-body"
                        value={prBody}
                        onChange={e => setPrBody(e.target.value)}
                        placeholder={t('agents.runs.pr.bodyPlaceholder')}
                        rows={2}
                        className="text-xs"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="run-pr-base" className="text-xs">{t('agents.runs.pr.baseLabel')}</Label>
                      <Input
                        id="run-pr-base"
                        value={prBase}
                        onChange={e => setPrBase(e.target.value)}
                        placeholder={t('agents.runs.pr.basePlaceholder')}
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={openPr.isPending || !prTitle.trim()}
                        onClick={() => openPr.mutate()}
                      >
                        {openPr.isPending ? t('agents.runs.pr.creating') : t('agents.runs.pr.create')}
                      </Button>
                      {prUrl && (
                        <a href={prUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline-offset-2 hover:underline">
                          {t('agents.runs.pr.view')}
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-xl border px-3 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {t('agents.runs.checkpoints.title')}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 text-xs"
                    disabled={snapshot.isPending}
                    onClick={() => { setRestored(null); snapshot.mutate() }}
                  >
                    {snapshot.isPending ? t('agents.runs.checkpoints.snapshotting') : t('agents.runs.checkpoints.snapshot')}
                  </Button>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t('agents.runs.checkpoints.description')}
                </p>
                {snapshot.isError && (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    {t('agents.runs.checkpoints.failed', { error: (snapshot.error as Error).message })}
                  </p>
                )}
                {restore.isError && (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    {(restore.error as Error).message}
                  </p>
                )}
                {restored != null && restored.runId === selectedId && !restore.isError && (
                  <p role="status" className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                    {t('agents.runs.checkpoints.restored', { id: restored.id })}
                  </p>
                )}
                {checkpoints.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('agents.runs.checkpoints.empty')}
                  </p>
                ) : (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {checkpoints.map(cp => {
                      const live = selected.status === 'running' || selected.status === 'awaiting_approval'
                      return (
                        <li key={cp.id} className="flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-1 text-xs">
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-mono text-[11px] text-muted-foreground">#{cp.id}</span>{' '}
                            {cp.label || t('agents.runs.checkpoints.auto')}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {new Date(cp.created_at).toLocaleString()}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 shrink-0 px-2 text-xs"
                            disabled={live || restore.isPending}
                            title={live ? t('agents.runs.checkpoints.liveBlocked') : undefined}
                            onClick={() => {
                              if (window.confirm(t('agents.runs.checkpoints.restoreConfirm'))) restore.mutate(cp.id)
                            }}
                          >
                            {restore.isPending ? t('agents.runs.checkpoints.restoring') : t('agents.runs.checkpoints.restore')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 shrink-0 px-2 text-xs"
                            disabled={fork.isPending}
                            title={t('agents.runs.forkHint')}
                            onClick={() => fork.mutate(cp.id)}
                          >
                            {fork.isPending ? t('agents.runs.forking') : t('agents.runs.fork')}
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
