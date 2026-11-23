import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogClose, DialogPopup, DialogTitle } from '@/components/ui/dialog'

// Slash commands: reusable prompt templates invoked as `/name input` at the
// start of a run goal. Files live on disk (see /api/commands); the dashboard
// authors new ones and deletes its own — shipped commands resolve from
// read-only dirs and refuse deletion server-side.
export interface CommandRow {
  name: string
  description: string
  agent: string | null
  model: string | null
  template: string
}

export function CommandsPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [template, setTemplate] = useState('')
  const [agent, setAgent] = useState('')
  const [model, setModel] = useState('')

  const { data: rows = [], isLoading } = useQuery<CommandRow[]>({
    queryKey: ['agent-commands'],
    queryFn: () => apiFetch<{ commands: CommandRow[] }>('/api/commands').then(r => r.commands),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['agent-commands'] })
  }

  const save = useMutation({
    mutationFn: () =>
      apiFetch('/api/commands', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          template: template.trim(),
          ...(agent.trim() ? { agent: agent.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
        }),
      }),
    onSuccess: () => {
      setDialogOpen(false)
      invalidate()
    },
    onError: err => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const remove = useMutation({
    mutationFn: (row: CommandRow) =>
      apiFetch(`/api/commands/${row.name}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: err => toast.error(err instanceof Error ? err.message : String(err)),
  })

  function openCreate() {
    setName('')
    setDescription('')
    setTemplate('')
    setAgent('')
    setModel('')
    setDialogOpen(true)
  }

  // "Edit" an authored command by loading it into the create form: saving
  // under the same name 409s, so the operator renames or deletes first —
  // the server has no update because files are the source of truth.
  function openDuplicate(row: CommandRow) {
    setName(`${row.name}-copy`)
    setDescription(row.description)
    setTemplate(row.template)
    setAgent(row.agent ?? '')
    setModel(row.model ?? '')
    setDialogOpen(true)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>{t('agents.commands.title')}</CardTitle>
            <CardDescription>{t('agents.commands.description')}</CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus /> {t('agents.commands.new')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('agents.commands.empty')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map(row => (
              <div key={row.name} className="rounded-xl border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-medium">/{row.name}</span>
                  {(row.agent || row.model) && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {[row.agent, row.model].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <div className="ml-auto flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      title={t('agents.commands.duplicate')}
                      aria-label={`${t('agents.commands.duplicate')} ${row.name}`}
                      onClick={() => openDuplicate(row)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-destructive"
                      title={t('agents.commands.delete')}
                      aria-label={`${t('agents.commands.delete')} ${row.name}`}
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(t('agents.commands.deleteConfirm', { name: row.name }))) remove.mutate(row)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p>
              </div>
            ))}
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogPopup maxWidth="max-w-xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <DialogTitle>{t('agents.commands.new')}</DialogTitle>
              <DialogClose
                aria-label={t('common.dismiss')}
                className="-mr-1 rounded-lg p-1 text-muted-foreground/70 transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-4" />
              </DialogClose>
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="command-name">{t('agents.commands.name')}</Label>
                <Input
                  id="command-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('agents.commands.namePlaceholder')}
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="command-desc">{t('agents.commands.commandDesc')}</Label>
                <Input
                  id="command-desc"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="command-template">{t('agents.commands.template')}</Label>
                <Textarea
                  id="command-template"
                  value={template}
                  onChange={e => setTemplate(e.target.value)}
                  placeholder={t('agents.commands.templatePlaceholder')}
                  rows={6}
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">{t('agents.commands.templateHint')}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="command-agent">{t('agents.commands.agent')}</Label>
                  <Input
                    id="command-agent"
                    value={agent}
                    onChange={e => setAgent(e.target.value)}
                    placeholder={t('agents.commands.agentPlaceholder')}
                    className="font-mono"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="command-model">{t('agents.commands.model')}</Label>
                  <Input
                    id="command-model"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder={t('agents.commands.modelPlaceholder')}
                    className="font-mono"
                  />
                </div>
              </div>
              {save.isError && (
                <p role="alert" className="text-xs text-destructive">
                  {(save.error as Error).message}
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {t('agents.commands.cancel')}
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={save.isPending || !name.trim() || !description.trim() || !template.trim()}
              >
                {t('agents.commands.create')}
              </Button>
            </div>
          </DialogPopup>
        </Dialog>
      </CardContent>
    </Card>
  )
}
