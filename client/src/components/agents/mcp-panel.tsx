import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Dialog, DialogClose, DialogPopup, DialogTitle } from '@/components/ui/dialog'

export interface McpServer {
  id: number
  name: string
  transport: 'stdio' | 'http'
  command: string
  args: string[]
  url: string
  enabled: number
  tool_count: number | null
  last_error: string | null
  last_seen_at: string | null
  created_at: string
}

function parseLines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean)
}

function parsePairs(text: string, sep: '=' | ':'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of parseLines(text)) {
    const idx = line.indexOf(sep)
    if (idx <= 0) continue
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

export function McpPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [secrets, setSecrets] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery<McpServer[]>({
    queryKey: ['mcp-servers'],
    queryFn: () => apiFetch<{ servers: McpServer[] }>('/api/mcp/servers').then(r => r.servers),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
    void queryClient.invalidateQueries({ queryKey: ['mcp-tools'] })
  }

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = transport === 'stdio'
        ? { name: name.trim(), transport, command: command.trim(), args: parseLines(args), env: parsePairs(secrets, '=') }
        : { name: name.trim(), transport, url: url.trim(), headers: parsePairs(secrets, ':') };
      return editing
        ? apiFetch(`/api/mcp/servers/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : apiFetch('/api/mcp/servers', { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: () => {
      setDialogOpen(false)
      invalidate()
    },
  })

  const toggle = useMutation({
    mutationFn: (row: McpServer) =>
      apiFetch(`/api/mcp/servers/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !row.enabled }),
      }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/mcp/servers/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  const test = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ tools: Array<{ name: string }> }>(`/api/mcp/servers/${id}/test`, { method: 'POST' }),
    onSuccess: data => {
      setTestResult(`${t('agents.mcp.testOk')} ${data.tools.map(tool => tool.name).join(', ')}`)
      invalidate()
    },
    onError: (err: Error) => setTestResult(err.message),
  })

  const [installOpen, setInstallOpen] = useState(false)
  const [regName, setRegName] = useState('')
  const [regEnvText, setRegEnvText] = useState('')
  const [regError, setRegError] = useState<string | null>(null)

  const install = useMutation({
    mutationFn: () => {
      const env: Record<string, string> = {}
      for (const line of regEnvText.split('\n')) {
        const sep = line.indexOf('=')
        if (sep > 0) env[line.slice(0, sep).trim()] = line.slice(sep + 1).trim()
      }
      return apiFetch('/api/mcp/install', {
        method: 'POST',
        body: JSON.stringify({ name: regName.trim(), env }),
      })
    },
    onSuccess: () => {
      setInstallOpen(false)
      setRegName('')
      setRegEnvText('')
      setRegError(null)
      invalidate()
    },
    onError: (err: Error) => setRegError(err.message),
  })

  function openCreate() {
    setEditing(null)
    setName('')
    setTransport('stdio')
    setCommand('')
    setArgs('')
    setUrl('')
    setSecrets('')
    setTestResult(null)
    setDialogOpen(true)
  }

  function openEdit(row: McpServer) {
    setEditing(row)
    setName(row.name)
    setTransport(row.transport)
    setCommand(row.command)
    setArgs(row.args.join('\n'))
    setUrl(row.url)
    // Secrets are write-only (encrypted at rest, never returned): blank
    // means keep, any content replaces.
    setSecrets('')
    setTestResult(null)
    setDialogOpen(true)
  }

  const valid = name.trim() !== '' && (transport === 'http' ? url.trim() !== '' : command.trim() !== '')

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('agents.mcp.title')}</CardTitle>
        <CardDescription>{t('agents.mcp.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={openCreate}>
            <Plus /> {t('agents.mcp.new')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setInstallOpen(v => !v); setRegError(null) }}>
            <Download /> {t('agents.mcp.install')}
          </Button>
        </div>
        {installOpen && (
          <div className="grid gap-2 rounded-xl border p-3">
            <Input
              id="mcp-registry-name"
              value={regName}
              onChange={e => setRegName(e.target.value)}
              placeholder={t('agents.mcp.installPlaceholder')}
              className="font-mono"
              aria-label={t('agents.mcp.installPlaceholder')}
            />
            <Textarea
              id="mcp-registry-env"
              value={regEnvText}
              onChange={e => setRegEnvText(e.target.value)}
              placeholder={t('agents.mcp.installEnvPlaceholder')}
              rows={2}
              className="font-mono"
              aria-label={t('agents.mcp.installEnvPlaceholder')}
            />
            <p className="text-[11px] text-muted-foreground">{t('agents.mcp.installHint')}</p>
            {regError && <p role="alert" className="text-xs text-destructive">{regError}</p>}
            <div>
              <Button size="sm" onClick={() => install.mutate()} disabled={!regName.trim() || install.isPending}>
                {install.isPending ? t('agents.mcp.installing') : t('agents.mcp.installGo')}
              </Button>
            </div>
          </div>
        )}
        {isLoading && <p className="text-xs text-muted-foreground">…</p>}
        {!isLoading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('agents.mcp.empty')}</p>
        )}
        {testResult && (
          <p role="status" className="text-xs text-muted-foreground">{testResult}</p>
        )}
        {test.isError && (
          <p role="alert" className="text-xs text-destructive">{(test.error as Error).message}</p>
        )}
        {rows.map(row => (
          <div key={row.id} className="flex items-start gap-3 rounded-xl border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs font-medium">
                <span className="font-mono">{row.name}</span>
                <Badge variant="outline" className="text-[10px]">{row.transport}</Badge>
                {row.tool_count !== null && (
                  <Badge variant="secondary" className="text-[10px]">
                    {t('agents.mcp.tools', { count: row.tool_count })}
                  </Badge>
                )}
                {!row.enabled && (
                  <Badge variant="outline" className="text-[10px]">{t('agents.skills.disable')}</Badge>
                )}
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {row.transport === 'stdio' ? `${row.command} ${row.args.join(' ')}`.trim() : row.url}
              </p>
              {row.last_error && (
                <p className="mt-0.5 text-[11px] text-destructive">
                  {t('agents.mcp.lastError')}: {row.last_error}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="ghost" size="icon-sm"
                disabled={test.isPending}
                onClick={() => { setTestResult(null); test.mutate(row.id) }}
                aria-label={t('agents.mcp.test')}
              >
                <Play />
              </Button>
              <Switch
                checked={Boolean(row.enabled)}
                onCheckedChange={() => toggle.mutate(row)}
                aria-label={row.enabled ? t('agents.mcp.disable') : t('agents.mcp.enable')}
              />
              <Button variant="ghost" size="icon-sm" onClick={() => openEdit(row)} aria-label={t('agents.mcp.edit')}>
                <Pencil />
              </Button>
              <Button
                variant="ghost" size="icon-sm"
                onClick={() => {
                  if (window.confirm(t('agents.mcp.deleteConfirm'))) remove.mutate(row.id)
                }}
                aria-label={t('agents.mcp.delete')}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogPopup maxWidth="max-w-xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <DialogTitle>{editing ? t('agents.mcp.edit') : t('agents.mcp.new')}</DialogTitle>
              <DialogClose
                aria-label={t('common.dismiss')}
                className="-mr-1 rounded-lg p-1 text-muted-foreground/70 transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-4" />
              </DialogClose>
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-name">{t('agents.mcp.name')}</Label>
                <Input
                  id="mcp-name" value={name} onChange={e => setName(e.target.value)}
                  placeholder={t('agents.mcp.namePlaceholder')} className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-transport">{t('agents.mcp.transport')}</Label>
                <Select value={transport} onValueChange={v => { if (v === 'stdio' || v === 'http') setTransport(v) }}>
                  <SelectTrigger id="mcp-transport">
                    <span className="flex flex-1 truncate text-left">
                      {transport === 'stdio' ? t('agents.mcp.transportStdio') : t('agents.mcp.transportHttp')}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">{t('agents.mcp.transportStdio')}</SelectItem>
                    <SelectItem value="http">{t('agents.mcp.transportHttp')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {transport === 'stdio' ? (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="mcp-command">{t('agents.mcp.command')}</Label>
                    <Input
                      id="mcp-command" value={command} onChange={e => setCommand(e.target.value)}
                      placeholder={t('agents.mcp.commandPlaceholder')} className="font-mono"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="mcp-args">{t('agents.mcp.args')}</Label>
                    <Textarea
                      id="mcp-args" value={args} onChange={e => setArgs(e.target.value)}
                      placeholder={t('agents.mcp.argsPlaceholder')} rows={3} className="font-mono text-xs"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="mcp-secrets">{t('agents.mcp.env')}</Label>
                    <Textarea
                      id="mcp-secrets" value={secrets} onChange={e => setSecrets(e.target.value)}
                      placeholder="TOKEN=..." rows={2} className="font-mono text-xs"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="mcp-url">{t('agents.mcp.url')}</Label>
                    <Input
                      id="mcp-url" value={url} onChange={e => setUrl(e.target.value)}
                      placeholder={t('agents.mcp.urlPlaceholder')} className="font-mono"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="mcp-secrets">{t('agents.mcp.headers')}</Label>
                    <Textarea
                      id="mcp-secrets" value={secrets} onChange={e => setSecrets(e.target.value)}
                      placeholder="Authorization: Bearer ..." rows={2} className="font-mono text-xs"
                    />
                  </div>
                </>
              )}
              {save.isError && (
                <p role="alert" className="text-xs text-destructive">{(save.error as Error).message}</p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {t('agents.mcp.cancel')}
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending || !valid}>
                {editing ? t('agents.mcp.save') : t('agents.mcp.create')}
              </Button>
            </div>
          </DialogPopup>
        </Dialog>
      </CardContent>
    </Card>
  )
}
