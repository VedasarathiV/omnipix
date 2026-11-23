import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Play, Square, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'

interface TaskStep {
  seq: number
  kind: string
  name: string | null
  content: Record<string, unknown>
  created_at: string
}

export interface GroupTask {
  id: number
  name: string
  role: string
  goal: string
  tools: string[]
  dependsOn: number[]
  status: string
  run_id: number | null
  attempts: number
  max_attempts: number
  result_summary: string | null
  error: string | null
  expected_output: string | null
  inputs: Array<{ name: string; from: number }>
  handoff: { summary: string; outputs: Record<string, unknown>; expected_output: string | null } | null
  verdict: { pass: boolean; reason: string; kind: string } | null
  output_json: number
  output_file: string | null
  steps: TaskStep[]
}

export interface AgentGroup {
  id: number
  goal: string
  status: string
  mode: string
  budget_tokens: number | null
  tokens_used: number
  cost_usd?: number
  manager_decisions: number
  error: string | null
  created_at: string
  finished_at: string | null
  workspace?: string
  git_branch?: string | null
  tasks: GroupTask[]
  blackboard: Array<{ key: string; value: unknown; writerTaskId: number | null }>
  locks: Array<{ path: string; taskId: number }>
}

export interface GroupSummary extends Omit<AgentGroup, 'tasks' | 'blackboard' | 'locks'> {
  task_count: number
  done_count: number
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'default',
  awaiting_approval: 'default',
  done: 'secondary',
  error: 'destructive',
  stopped: 'outline',
  pending: 'outline',
  skipped: 'outline',
}

function stepText(step: TaskStep): string {
  const c = step.content ?? {}
  switch (step.kind) {
    case 'thought':
    case 'answer':
      return typeof c.text === 'string' ? c.text : ''
    case 'tool_call':
      return `${step.name ?? '?'}(${(c.arguments ? JSON.stringify(c.arguments) : '').slice(0, 200)})`
    case 'tool_result':
      return String(c.result ?? '').slice(0, 300)
    case 'check':
      return `${c.pass ? 'PASS' : 'FAIL'} ${String(c.command ?? '')}`
    case 'error':
      return String(c.message ?? 'error')
    default:
      return JSON.stringify(c).slice(0, 300)
  }
}

export function GroupsPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [goal, setGoal] = useState('')
  const [mode, setMode] = useState<'auto' | 'manual' | 'preset'>('auto')
  const [crewMode, setCrewMode] = useState<'dag' | 'hierarchical'>('dag')
  const [tasksJson, setTasksJson] = useState('')
  const [preset, setPreset] = useState('startup-mvp')
  const [budget, setBudget] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [noteKey, setNoteKey] = useState('')
  const [noteValue, setNoteValue] = useState('')

  const { data: models = [] } = useQuery<Array<{ enabled: boolean; keyCount?: number }>>({
    queryKey: ['models'],
    queryFn: () => apiFetch('/api/models'),
    staleTime: 30_000,
  })
  const { data: runbooks = [] } = useQuery<Array<{ name: string; description: string }>>({
    queryKey: ['agent-runbooks'],
    queryFn: () => apiFetch<{ runbooks: Array<{ name: string; description: string }> }>('/api/agents/runbooks').then(r => r.runbooks),
    staleTime: 300_000,
  })
  const { data: groups = [] } = useQuery<GroupSummary[]>({
    queryKey: ['agent-groups'],
    queryFn: () => apiFetch<{ groups: GroupSummary[] }>('/api/agents/groups?limit=20').then(r => r.groups),
    refetchInterval: query =>
      query.state.data?.some(g => g.status === 'running') ? 2000 : false,
  })
  const { data: selected } = useQuery<AgentGroup | null>({
    queryKey: ['agent-group', selectedId],
    queryFn: () => (selectedId == null
      ? Promise.resolve(null)
      : apiFetch<AgentGroup>(`/api/agents/groups/${selectedId}`)),
    enabled: selectedId != null,
    refetchInterval: query =>
      query.state.data?.status === 'running' ? 2000 : false,
  })

  const start = useMutation({
    mutationFn: () => {
      let tasks: unknown;
      if (mode === 'manual') {
        if (!tasksJson.trim()) {
          // Hierarchical crews accept an empty queue: the manager plans live.
          if (crewMode !== 'hierarchical') throw new Error('Tasks JSON is required.');
        } else {
          try {
            tasks = JSON.parse(tasksJson);
          } catch {
            throw new Error('Tasks JSON is not valid JSON.');
          }
        }
      }
      return apiFetch<AgentGroup>('/api/agents/groups', {
        method: 'POST',
        body: JSON.stringify({
          goal: goal.trim(),
          ...(mode === 'auto' ? { auto: true } : mode === 'preset' ? { preset } : tasks === undefined ? {} : { tasks }),
          ...(crewMode === 'hierarchical' ? { mode: 'hierarchical' } : {}),
          ...(budget.trim() ? { budgetTokens: Number(budget) } : {}),
        }),
      })
    },
    onSuccess: group => {
      setGoal('')
      setTasksJson('')
      setBudget('')
      setSelectedId(group.id)
      void queryClient.invalidateQueries({ queryKey: ['agent-groups'] })
    },
  })

  const stop = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/agents/groups/${id}/stop`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent-groups'] })
      void queryClient.invalidateQueries({ queryKey: ['agent-group', selectedId] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/agents/groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSelectedId(null)
      void queryClient.invalidateQueries({ queryKey: ['agent-groups'] })
    },
  })

  const pinNote = useMutation({
    mutationFn: () => apiFetch(`/api/agents/groups/${selectedId}/blackboard`, {
      method: 'POST',
      body: JSON.stringify({ key: noteKey.trim(), value: noteValue.trim() }),
    }),
    onSuccess: () => {
      setNoteKey('')
      setNoteValue('')
      void queryClient.invalidateQueries({ queryKey: ['agent-group', selectedId] })
    },
  })

  // Interleaved timeline: every task's steps merged by wall clock, tagged
  // with the task name so parallel work reads as one story.
  const timeline = useMemo(() => {
    if (!selected) return []
    return (selected.tasks ?? [])
      .flatMap(task => (task.steps ?? []).map(step => ({ task, step })))
      .sort((a, b) => a.step.created_at.localeCompare(b.step.created_at))
  }, [selected])

  const budgetValid = budget.trim() === '' || (Number.isInteger(Number(budget)) && Number(budget) >= 1000)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t('agents.groups.newTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="group-goal">{t('agents.groups.goal')}</Label>
            <Textarea
              id="group-goal"
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder={t('agents.groups.goalPlaceholder')}
              rows={3}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="group-mode">{t('agents.groups.mode')}</Label>
            <Select value={mode} onValueChange={v => { if (v === 'auto' || v === 'manual' || v === 'preset') setMode(v) }}>
              <SelectTrigger id="group-mode">
                <span className="flex flex-1 truncate text-left">
                  {mode === 'auto' ? t('agents.groups.modeAuto') : mode === 'preset' ? t('agents.groups.modePreset') : t('agents.groups.modeManual')}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('agents.groups.modeAuto')}</SelectItem>
                <SelectItem value="manual">{t('agents.groups.modeManual')}</SelectItem>
                <SelectItem value="preset">{t('agents.groups.modePreset')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === 'preset' && (
            <div className="grid gap-1.5">
              <Label htmlFor="group-preset">{t('agents.groups.preset')}</Label>
              <Select value={preset} onValueChange={v => { if (typeof v === 'string') setPreset(v) }}>
                <SelectTrigger id="group-preset">
                  <span className="flex flex-1 truncate text-left">{preset}</span>
                </SelectTrigger>
                <SelectContent>
                  {runbooks.map(r => (
                    <SelectItem key={r.name} value={r.name}>{r.name} — {r.description}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="group-crew-mode">{t('agents.groups.crewMode')}</Label>
            <Select value={crewMode} onValueChange={v => { if (v === 'dag' || v === 'hierarchical') setCrewMode(v) }}>
              <SelectTrigger id="group-crew-mode">
                <span className="flex flex-1 truncate text-left">
                  {crewMode === 'dag' ? t('agents.groups.crewDag') : t('agents.groups.crewHierarchical')}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dag">{t('agents.groups.crewDag')}</SelectItem>
                <SelectItem value="hierarchical">{t('agents.groups.crewHierarchical')}</SelectItem>
              </SelectContent>
            </Select>
            {crewMode === 'hierarchical' && (
              <p className="text-[11px] text-muted-foreground">{t('agents.groups.crewHierarchicalHint')}</p>
            )}
          </div>
          {mode === 'manual' && (
            <div className="grid gap-1.5">
              <Label htmlFor="group-tasks">{t('agents.groups.tasksJson')}</Label>
              <Textarea
                id="group-tasks"
                value={tasksJson}
                onChange={e => setTasksJson(e.target.value)}
                placeholder={t('agents.groups.tasksJsonPlaceholder')}
                rows={5}
                className="font-mono text-xs"
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="group-budget">{t('agents.groups.budget')}</Label>
            <Input
              id="group-budget"
              inputMode="numeric"
              value={budget}
              onChange={e => setBudget(e.target.value)}
              className="w-32 font-mono text-xs"
              aria-invalid={!budgetValid}
            />
          </div>
          {models.length > 0 && !models.some(m => m.enabled && (m.keyCount ?? 0) > 0) && (
            <p role="note" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              {t('agents.groups.noKeys')}
            </p>
          )}
          {start.isError && (
            <p role="alert" className="text-xs text-destructive">{(start.error as Error).message}</p>
          )}
          <Button
            onClick={() => start.mutate()}
            disabled={!goal.trim() || !budgetValid || start.isPending || (mode === 'manual' && !tasksJson.trim() && crewMode === 'dag')}
            className="w-fit"
          >
            {start.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            {start.isPending ? t('agents.groups.starting') : t('agents.groups.start')}
          </Button>
        </CardContent>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('agents.groups.history')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {groups.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('agents.groups.empty')}</p>
            )}
            {groups.map(group => (
              <button
                key={group.id}
                type="button"
                onClick={() => setSelectedId(group.id)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50 ${
                  group.id === selectedId ? 'border-primary/40 bg-muted/50' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{group.goal}</span>
                <span className="shrink-0 text-muted-foreground">
                  {group.done_count}/{group.task_count}
                </span>
                <Badge variant={STATUS_VARIANT[group.status] ?? 'outline'} className="shrink-0">
                  {t(`agents.groups.status.${group.status}`)}
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
                {t('agents.groups.tokens', { used: selected.tokens_used })}
                {selected.budget_tokens != null && ` ${t('agents.groups.budgetOf', { budget: selected.budget_tokens })}`}
                {(selected.cost_usd ?? 0) > 0 && ` · $${selected.cost_usd!.toFixed(4)}`}
                {selected.workspace && ` · ${selected.workspace}`}
                {selected.git_branch && ` @ ${selected.git_branch}`}
                {selected.mode === 'hierarchical' && ` · ${t('agents.groups.managerDecisions', { count: selected.manager_decisions ?? 0 })}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {selected.error && (
                <p role="alert" className="text-xs text-destructive">{selected.error}</p>
              )}
              <div>
                <p className="mb-1.5 text-xs font-medium">{t('agents.groups.tasks')}</p>
                <div className="flex flex-col gap-1.5">
                  {(selected.tasks ?? []).map(task => (
                    <div key={task.id} className="rounded-xl bg-muted/50 px-3 py-2">
                      <p className="flex items-center gap-2 text-xs font-medium">
                        <span className="min-w-0 flex-1 truncate">{task.name}</span>
                        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{task.role}</Badge>
                        <Badge variant={STATUS_VARIANT[task.status] ?? 'outline'} className="shrink-0">
                          {t(`agents.groups.status.${task.status}`)}
                        </Badge>
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{task.goal}</p>
                      {task.expected_output && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {t('agents.groups.expects')}: {task.expected_output}
                        </p>
                      )}
                      {(task.inputs ?? []).length > 0 && (
                        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                          {(task.inputs ?? []).map(w =>
                            t('agents.groups.inputFrom', {
                              name: w.name,
                              task: (selected.tasks ?? []).find(x => x.id === w.from)?.name ?? `#${w.from}`,
                            }),
                          ).join(' · ')}
                        </p>
                      )}
                      {task.error && (
                        <p className="mt-0.5 text-[11px] text-destructive">{task.error}</p>
                      )}
                      {task.result_summary && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">→ {task.result_summary.slice(0, 200)}</p>
                      )}
                      {task.handoff && Object.keys(task.handoff.outputs ?? {}).length > 0 && (
                        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                          {t('agents.groups.handoffKeys', { keys: Object.keys(task.handoff.outputs ?? {}).join(', ') })}
                        </p>
                      )}
                      {task.verdict && (
                        <p className={`mt-0.5 truncate text-[11px] ${task.verdict.pass ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
                          {t('agents.groups.verdict')}: {task.verdict.pass ? 'PASS' : 'FAIL'} — {task.verdict.reason}
                        </p>
                      )}
                      {(task.output_json === 1 || task.output_file) && (
                        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                          {t('agents.groups.outputTo', {
                            target: [
                              task.output_json === 1 ? 'JSON' : null,
                              task.output_file ? task.output_file : null,
                            ].filter(Boolean).join(' → '),
                          })}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {timeline.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium">{t('agents.groups.timeline')}</p>
                  <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-xl border p-2">
                    {timeline.map(({ task, step }, i) => (
                      <p key={`${task.id}-${step.seq}-${i}`} className="text-[11px]">
                        <span className="font-mono text-primary">{task.name}</span>
                        <span className="text-muted-foreground"> #{step.seq} {step.kind} </span>
                        <span className="whitespace-pre-wrap break-words">{stepText(step).slice(0, 300)}</span>
                      </p>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="mb-1.5 text-xs font-medium">{t('agents.groups.blackboard')}</p>
                {(selected.blackboard ?? []).length === 0 && (
                  <p className="text-[11px] text-muted-foreground">{t('agents.groups.blackboardEmpty')}</p>
                )}
                {(selected.blackboard ?? []).map(entry => (
                  <p key={entry.key} className="text-[11px]">
                    <span className="font-mono font-medium">{entry.key}</span>
                    <span className="text-muted-foreground">: {JSON.stringify(entry.value).slice(0, 200)}</span>
                  </p>
                ))}
                {selected.status === 'running' && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div className="grid gap-1">
                      <Label htmlFor="group-note-key" className="text-[11px]">{t('agents.groups.noteKey')}</Label>
                      <Input
                        id="group-note-key" value={noteKey} onChange={e => setNoteKey(e.target.value)}
                        className="h-8 w-28 font-mono text-xs"
                      />
                    </div>
                    <div className="grid flex-1 gap-1">
                      <Label htmlFor="group-note-value" className="text-[11px]">{t('agents.groups.noteValue')}</Label>
                      <Input
                        id="group-note-value" value={noteValue} onChange={e => setNoteValue(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <Button
                      size="sm" disabled={!noteKey.trim() || !noteValue.trim() || pinNote.isPending}
                      onClick={() => pinNote.mutate()}
                    >
                      {t('agents.groups.pinNote')}
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                {selected.status === 'running' && (
                  <Button variant="outline" size="sm" disabled={stop.isPending} onClick={() => stop.mutate(selected.id)}>
                    <Square /> {t('agents.groups.stop')}
                  </Button>
                )}
                <Button
                  variant="ghost" size="sm" disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(t('agents.groups.deleteConfirm'))) remove.mutate(selected.id)
                  }}
                >
                  <Trash2 /> {t('agents.groups.delete')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
