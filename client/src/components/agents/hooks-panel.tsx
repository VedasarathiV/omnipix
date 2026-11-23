import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogClose, DialogPopup, DialogTitle } from '@/components/ui/dialog'

export interface HookRow {
  id: number
  name: string
  event: 'pre_tool' | 'post_tool'
  tool_filter: string
  command: string
  timeout_ms: number
  enabled: number
}

export function HooksPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<HookRow | null>(null)
  const [name, setName] = useState('')
  const [event, setEvent] = useState<'pre_tool' | 'post_tool'>('pre_tool')
  const [toolFilter, setToolFilter] = useState('')
  const [command, setCommand] = useState('')
  const [timeoutMs, setTimeoutMs] = useState(30000)

  const { data: rows = [], isLoading } = useQuery<HookRow[]>({
    queryKey: ['agent-hooks'],
    queryFn: () => apiFetch<{ hooks: HookRow[] }>('/api/agents/hooks').then(r => r.hooks),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['agent-hooks'] })
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        event,
        toolFilter: toolFilter.trim(),
        command: command.trim(),
        timeoutMs: Number(timeoutMs),
      }
      return editing
        ? apiFetch(`/api/agents/hooks/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : apiFetch('/api/agents/hooks', { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: () => {
      setDialogOpen(false)
      invalidate()
    },
  })

  const toggle = useMutation({
    mutationFn: (row: HookRow) =>
      apiFetch(`/api/agents/hooks/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !row.enabled }),
      }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/agents/hooks/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  function openCreate() {
    setEditing(null)
    setName('')
    setEvent('pre_tool')
    setToolFilter('')
    setCommand('')
    setTimeoutMs(30000)
    setDialogOpen(true)
  }

  function openEdit(row: HookRow) {
    setEditing(row)
    setName(row.name)
    setEvent(row.event)
    setToolFilter(row.tool_filter)
    setCommand(row.command)
    setTimeoutMs(row.timeout_ms)
    setDialogOpen(true)
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('agents.hooks.title')}</CardTitle>
        <CardDescription>{t('agents.hooks.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div>
          <Button size="sm" onClick={openCreate}>
            <Plus /> {t('agents.hooks.new')}
          </Button>
        </div>
        {isLoading && <p className="text-xs text-muted-foreground">…</p>}
        {!isLoading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('agents.hooks.empty')}</p>
        )}
        {rows.map(row => (
          <div
            key={row.id}
            className="flex items-start gap-3 rounded-xl border px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs font-medium">
                <span className="font-mono">{row.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {row.event === 'pre_tool' ? t('agents.hooks.eventPre') : t('agents.hooks.eventPost')}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {row.tool_filter || t('agents.hooks.toolFilterAny')}
                </Badge>
              </p>
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{row.command}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Switch
                checked={Boolean(row.enabled)}
                onCheckedChange={() => toggle.mutate(row)}
                aria-label={row.enabled ? t('agents.hooks.disable') : t('agents.hooks.enable')}
              />
              <Button variant="ghost" size="icon-sm" onClick={() => openEdit(row)} aria-label={t('agents.hooks.edit')}>
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  if (window.confirm(t('agents.hooks.deleteConfirm'))) remove.mutate(row.id)
                }}
                aria-label={t('agents.hooks.delete')}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogPopup maxWidth="max-w-xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <DialogTitle>
                {editing ? t('agents.hooks.edit') : t('agents.hooks.new')}
              </DialogTitle>
              <DialogClose
                aria-label={t('common.dismiss')}
                className="-mr-1 rounded-lg p-1 text-muted-foreground/70 transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-4" />
              </DialogClose>
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="hook-name">{t('agents.hooks.name')}</Label>
                <Input
                  id="hook-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="hook-event">{t('agents.hooks.event')}</Label>
                <Select value={event} onValueChange={v => { if (v === 'pre_tool' || v === 'post_tool') setEvent(v) }}>
                  <SelectTrigger id="hook-event">
                    <span className="flex flex-1 truncate text-left">
                      {event === 'pre_tool' ? t('agents.hooks.eventPre') : t('agents.hooks.eventPost')}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pre_tool">{t('agents.hooks.eventPre')}</SelectItem>
                    <SelectItem value="post_tool">{t('agents.hooks.eventPost')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="hook-tool-filter">{t('agents.hooks.toolFilter')}</Label>
                <Input
                  id="hook-tool-filter"
                  value={toolFilter}
                  onChange={e => setToolFilter(e.target.value)}
                  placeholder={t('agents.hooks.toolFilterHint')}
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="hook-command">{t('agents.hooks.command')}</Label>
                <Input
                  id="hook-command"
                  value={command}
                  onChange={e => setCommand(e.target.value)}
                  placeholder={t('agents.hooks.commandPlaceholder')}
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">{t('agents.hooks.commandHint')}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="hook-timeout">{t('agents.hooks.timeout')}</Label>
                <Input
                  id="hook-timeout"
                  type="number"
                  min={1000}
                  max={300000}
                  step={1000}
                  value={timeoutMs}
                  onChange={e => setTimeoutMs(Number(e.target.value))}
                  className="w-32"
                />
              </div>
              {save.isError && (
                <p role="alert" className="text-xs text-destructive">
                  {(save.error as Error).message}
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {t('agents.hooks.cancel')}
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={save.isPending || !name.trim() || !command.trim()}
              >
                {editing ? t('agents.hooks.save') : t('agents.hooks.create')}
              </Button>
            </div>
          </DialogPopup>
        </Dialog>
      </CardContent>
    </Card>
  )
}
