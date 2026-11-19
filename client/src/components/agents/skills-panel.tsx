import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogClose, DialogPopup, DialogTitle } from '@/components/ui/dialog'

export interface SkillRow {
  name: string
  description: string
  instructions: string
  enabled: number
  builtin: number
  bundle?: string[] | null
}

interface ProposalRow {
  id: number
  kind: string
  title: string
  body_json: string
  source_run_id: number | null
  status: string
}

export function SkillsPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SkillRow | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [bundle, setBundle] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importContent, setImportContent] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: rows = [], isLoading } = useQuery<SkillRow[]>({
    queryKey: ['agent-skills'],
    queryFn: () => apiFetch<{ skills: SkillRow[] }>('/api/skills').then(r => r.skills),
  })

  const { data: proposals = [] } = useQuery<ProposalRow[]>({
    queryKey: ['learning-proposals'],
    queryFn: () => apiFetch<{ proposals: ProposalRow[] }>('/api/agents/proposals').then(r => r.proposals),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['agent-skills'] })
    void queryClient.invalidateQueries({ queryKey: ['learning-proposals'] })
  }

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiFetch(`/api/skills/${editing.name}`, {
            method: 'PATCH',
            body: JSON.stringify({ description, instructions, bundle: bundle.split(',').map(m => m.trim()).filter(Boolean) }),
          })
        : apiFetch('/api/skills', {
            method: 'POST',
            body: JSON.stringify({
              name: name.trim(),
              description,
              instructions,
              ...(bundle.trim() ? { bundle: bundle.split(',').map(m => m.trim()).filter(Boolean) } : {}),
            }),
          }),
    onSuccess: () => {
      setDialogOpen(false)
      invalidate()
    },
  })

  const toggle = useMutation({
    mutationFn: (row: SkillRow) =>
      apiFetch(`/api/skills/${row.name}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !row.enabled }),
      }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (rowName: string) =>
      apiFetch(`/api/skills/${rowName}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  const doExport = useMutation({
    mutationFn: async (row: SkillRow) => {
      const { content } = await apiFetch<{ name: string; content: string }>(`/api/skills/${row.name}/export`)
      const blob = new Blob([content], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = `${row.name}.skill.md`
        document.body.appendChild(a)
        a.click()
        a.remove()
      } finally {
        URL.revokeObjectURL(url)
      }
    },
  })

  const doImport = useMutation({
    mutationFn: () =>
      apiFetch('/api/skills/import', {
        method: 'POST',
        body: JSON.stringify({ content: importContent }),
      }),
    onSuccess: () => {
      setImportOpen(false)
      setImportContent('')
      invalidate()
    },
  })

  async function loadImportFile(file: File | undefined) {
    if (!file) return
    setImportContent(await file.text())
  }

  const resolveProposal = useMutation({
    mutationFn: ({ id, accept }: { id: number; accept: boolean }) =>
      apiFetch(`/api/agents/proposals/${id}/${accept ? 'accept' : 'discard'}`, { method: 'POST' }),
    onSuccess: invalidate,
  })

  function proposalSummary(row: ProposalRow): string {
    try {
      const body = JSON.parse(row.body_json) as Record<string, string>
      if (row.kind === 'skill') return String(body.description ?? '')
      const scope = String(body.scope ?? 'user')
      const where = scope === 'project' && body.projectKey ? ` @${body.projectKey}` : ''
      return `[${scope}${where}] ${String(body.key ?? '')}: ${String(body.value ?? '').slice(0, 160)}`
    } catch {
      return ''
    }
  }

  function openCreate() {
    setEditing(null)
    setName('')
    setDescription('')
    setInstructions('')
    setBundle('')
    setDialogOpen(true)
  }

  function openEdit(row: SkillRow) {
    setEditing(row)
    setName(row.name)
    setDescription(row.description)
    setInstructions(row.instructions)
    setBundle((row.bundle ?? []).join(', '))
    setDialogOpen(true)
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('agents.skills.title')}</CardTitle>
        <CardDescription>{t('agents.skills.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button size="sm" onClick={openCreate}>
            <Plus /> {t('agents.skills.new')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setImportContent(''); setImportOpen(true) }}>
            <Upload /> {t('agents.skills.import')}
          </Button>
        </div>
        {doExport.isError && (
          <p role="alert" className="text-xs text-destructive">
            {(doExport.error as Error).message}
          </p>
        )}
        {proposals.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-dashed p-2">
            <p className="text-xs font-medium">
              {t('agents.skills.proposals', { count: proposals.length })}
            </p>
            {proposals.map(row => (
              <div key={row.id} className="flex items-start gap-2 rounded-lg bg-muted/50 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant="outline" className="text-[10px]">{row.kind}</Badge>
                    <span className="font-mono">{row.title}</span>
                    {row.source_run_id != null && (
                      <span className="font-mono text-[10px] text-muted-foreground">#{row.source_run_id}</span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{proposalSummary(row)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost" size="sm" className="h-6 px-2 text-xs"
                    disabled={resolveProposal.isPending}
                    onClick={() => resolveProposal.mutate({ id: row.id, accept: true })}
                  >
                    {t('agents.skills.accept')}
                  </Button>
                  <Button
                    variant="ghost" size="sm" className="h-6 px-2 text-xs"
                    disabled={resolveProposal.isPending}
                    onClick={() => resolveProposal.mutate({ id: row.id, accept: false })}
                  >
                    {t('agents.skills.discard')}
                  </Button>
                </div>
              </div>
            ))}
            {resolveProposal.isError && (
              <p role="alert" className="text-xs text-destructive">
                {(resolveProposal.error as Error).message}
              </p>
            )}
          </div>
        )}
        {isLoading && <p className="text-xs text-muted-foreground">…</p>}
        {!isLoading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('agents.skills.empty')}</p>
        )}
        {rows.map(row => (
          <div
            key={row.name}
            className="flex items-start gap-3 rounded-xl border px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs font-medium">
                <span className="font-mono">{row.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {row.builtin ? t('agents.skills.builtin') : t('agents.skills.custom')}
                </Badge>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p>
              {(row.bundle ?? []).length > 0 && (
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {t('agents.skills.bundleMembers', { members: (row.bundle ?? []).join(', ') })}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Switch
                checked={Boolean(row.enabled)}
                onCheckedChange={() => toggle.mutate(row)}
                aria-label={row.enabled ? t('agents.skills.disable') : t('agents.skills.enable')}
              />
              <Button variant="ghost" size="icon-sm" onClick={() => openEdit(row)} aria-label={t('agents.skills.edit')}>
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={doExport.isPending}
                onClick={() => doExport.mutate(row)}
                aria-label={`${t('agents.skills.export')} ${row.name}`}
              >
                <Download />
              </Button>
              {!row.builtin && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    if (window.confirm(t('agents.skills.deleteConfirm'))) remove.mutate(row.name)
                  }}
                  aria-label={t('agents.skills.delete')}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          </div>
        ))}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogPopup maxWidth="max-w-xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <DialogTitle>
                {editing ? t('agents.skills.edit') : t('agents.skills.new')}
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
                <Label htmlFor="skill-name">{t('agents.skills.name')}</Label>
                <Input
                  id="skill-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('agents.skills.namePlaceholder')}
                  disabled={Boolean(editing)}
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="skill-desc">{t('agents.skills.skillDesc')}</Label>
                <Input
                  id="skill-desc"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="skill-instructions">{t('agents.skills.instructions')}</Label>
                <Textarea
                  id="skill-instructions"
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  placeholder={t('agents.skills.instructionsPlaceholder')}
                  rows={6}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="skill-bundle">{t('agents.skills.bundle')}</Label>
                <Input
                  id="skill-bundle"
                  value={bundle}
                  onChange={e => setBundle(e.target.value)}
                  placeholder={t('agents.skills.bundlePlaceholder')}
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">{t('agents.skills.bundleHint')}</p>
              </div>
              {save.isError && (
                <p role="alert" className="text-xs text-destructive">
                  {(save.error as Error).message}
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {t('agents.skills.cancel')}
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={
                  save.isPending ||
                  (!editing && !name.trim()) ||
                  !description.trim() ||
                  !instructions.trim()
                }
              >
                {editing ? t('agents.skills.save') : t('agents.skills.create')}
              </Button>
            </div>
          </DialogPopup>
        </Dialog>

        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogPopup maxWidth="max-w-xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <DialogTitle>
                {t('agents.skills.import')}
              </DialogTitle>
              <DialogClose
                aria-label={t('common.dismiss')}
                className="-mr-1 rounded-lg p-1 text-muted-foreground/70 transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-4" />
              </DialogClose>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">{t('agents.skills.importHint')}</p>
              <div className="grid gap-1.5">
                <Label htmlFor="skill-import">{t('agents.skills.importContent')}</Label>
                <Textarea
                  id="skill-import"
                  value={importContent}
                  onChange={e => setImportContent(e.target.value)}
                  placeholder="---&#10;name: my-skill&#10;---&#10;…"
                  rows={10}
                  className="font-mono"
                />
              </div>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".md,.txt"
                  className="hidden"
                  aria-label={t('agents.skills.loadFile')}
                  onChange={e => {
                    void loadImportFile(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                  {t('agents.skills.loadFile')}
                </Button>
              </div>
              {doImport.isError && (
                <p role="alert" className="text-xs text-destructive">
                  {(doImport.error as Error).message}
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setImportOpen(false)}>
                {t('agents.skills.cancel')}
              </Button>
              <Button
                onClick={() => doImport.mutate()}
                disabled={doImport.isPending || !importContent.trim()}
              >
                {t('agents.skills.import')}
              </Button>
            </div>
          </DialogPopup>
        </Dialog>
      </CardContent>
    </Card>
  )
}
