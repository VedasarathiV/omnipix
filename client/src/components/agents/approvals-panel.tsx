import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DiffViewer } from './diff-viewer'

export interface Approval {
  id: number
  run_id: number
  seq: number
  tool: string
  args_json: string
  risk: string
  summary: string
  diff_text: string | null
  status: 'pending' | 'approved' | 'denied' | 'expired'
  created_at: string
  decided_at: string | null
}

const STATUS_VARIANT: Record<Approval['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'default',
  approved: 'secondary',
  denied: 'destructive',
  expired: 'outline',
}

interface GitStatusFile {
  path: string
  status: 'M' | 'A' | 'D' | 'U'
}

// Per-file commit scope: a pending git_commit approval lists the run's dirty
// files with checkboxes. Approving a subset commits only those files; the
// rest stay dirty in the workspace. All-checked is a plain approve.
function CommitScope({ runId, disabled, onApprove }: {
  runId: number
  disabled: boolean
  onApprove: (paths: string[]) => void
}) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<string[] | null>(null)
  const { data, isLoading } = useQuery<{ isRepo: boolean; branch: string; files: GitStatusFile[] }>({
    queryKey: ['run-git-status', runId],
    queryFn: () => apiFetch(`/api/agents/runs/${runId}/git/status`),
  })
  const files = data?.files ?? []
  // Everything checked until the operator touches the list (null = pristine).
  const checked = selected ?? files.map(f => f.path)
  const toggle = (path: string) => {
    const base = selected ?? files.map(f => f.path)
    setSelected(base.includes(path) ? base.filter(p => p !== path) : [...base, path])
  }
  if (isLoading) {
    return <p className="text-[11px] text-muted-foreground">{t('common.loading')}</p>
  }
  if (!data?.isRepo || files.length === 0) return null
  const narrowed = checked.length < files.length
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium">{t('agents.approvals.filesTitle')}</p>
      <ul className="flex max-h-40 flex-col gap-0.5 overflow-auto rounded-xl bg-muted/50 px-2 py-1.5">
        {files.map(f => (
          <li key={f.path}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-muted">
              <input
                type="checkbox"
                checked={checked.includes(f.path)}
                disabled={disabled}
                onChange={() => toggle(f.path)}
                className="size-3.5 shrink-0 accent-primary"
              />
              <span className="w-3 shrink-0 text-center font-mono text-muted-foreground">{f.status}</span>
              <span className="min-w-0 flex-1 truncate font-mono">{f.path}</span>
            </label>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || checked.length === 0}
        title={t('agents.approvals.scopeHint')}
        onClick={() => onApprove(narrowed ? checked : [])}
        className="mt-1.5"
      >
        {t('agents.approvals.approveSelected', { count: checked.length })}
      </Button>
    </div>
  )
}

export function ApprovalsPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [showDecided, setShowDecided] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)

  const { data: rows = [] } = useQuery<Approval[]>({
    queryKey: ['approvals'],
    queryFn: () => apiFetch<{ approvals: Approval[] }>('/api/agents/approvals?limit=50').then(r => r.approvals),
    // Pending requests resolve outside this tab (CLI, another browser), and
    // new ones park while the inbox sits open — poll while any are pending.
    refetchInterval: query =>
      query.state.data?.some(a => a.status === 'pending') ? 2000 : false,
  })

  const decide = useMutation({
    mutationFn: ({ id, approved, paths }: { id: number; approved: boolean; paths?: string[] }) =>
      apiFetch(`/api/agents/approvals/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify(paths?.length ? { approved, paths } : { approved }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approvals'] })
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] })
    },
  })

  const { data: rules = [] } = useQuery<Array<{ tool: string; decision: string }>>({
    queryKey: ['approval-rules'],
    queryFn: () => apiFetch<{ rules: Array<{ tool: string; decision: string }> }>('/api/agents/approval-rules').then(r => r.rules),
  })

  const pinAndDecide = useMutation({
    mutationFn: async ({ id, tool, approved }: { id: number; tool: string; approved: boolean }) => {
      await apiFetch('/api/agents/approval-rules', {
        method: 'POST',
        body: JSON.stringify({ tool, decision: approved ? 'allow' : 'deny' }),
      })
      return apiFetch(`/api/agents/approvals/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ approved }),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approvals'] })
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] })
      void queryClient.invalidateQueries({ queryKey: ['approval-rules'] })
    },
  })

  const clearRule = useMutation({
    mutationFn: (tool: string) =>
      apiFetch(`/api/agents/approval-rules/${encodeURIComponent(tool)}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approval-rules'] })
    },
  })

  const visible = showDecided ? rows : rows.filter(r => r.status === 'pending')

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('agents.approvals.title')}</CardTitle>
        <CardDescription>{t('agents.approvals.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={showDecided}
            onClick={() => setShowDecided(v => !v)}
          >
            {t('agents.approvals.showDecided')}
          </Button>
        </div>
        {visible.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('agents.approvals.empty')}</p>
        )}
        {visible.map(row => {
          const open = expanded === row.id
          let args = row.args_json
          try {
            args = JSON.stringify(JSON.parse(row.args_json), null, 2)
          } catch { /* show raw */ }
          return (
            <div key={row.id} className="rounded-xl border">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : row.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
              >
                <span className="font-mono text-muted-foreground">#{row.id}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{row.summary}</span>
                <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{row.tool}</Badge>
                <Badge variant={STATUS_VARIANT[row.status]} className="shrink-0">
                  {t(`agents.approvals.${row.status}`)}
                </Badge>
              </button>
              {open && (
                <div className="flex flex-col gap-2 border-t px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">
                    {t('agents.approvals.run')} #{row.run_id} · {t('agents.approvals.step')} {row.seq} · {row.risk}
                  </p>
                  <div>
                    <p className="mb-1 text-[11px] font-medium">{t('agents.approvals.args')}</p>
                    <pre className="overflow-x-auto rounded-xl bg-muted/50 px-3 py-2 font-mono text-[11px]">
                      {args}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-medium">{t('agents.approvals.diff')}</p>
                    <DiffViewer diffText={row.diff_text ?? ''} />
                  </div>
                  {row.status === 'pending' && row.tool === 'git_commit' && (
                    <CommitScope
                      runId={row.run_id}
                      disabled={decide.isPending || pinAndDecide.isPending}
                      onApprove={paths => decide.mutate({ id: row.id, approved: true, paths })}
                    />
                  )}
                  {row.status === 'pending' && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={decide.isPending || pinAndDecide.isPending}
                        onClick={() => decide.mutate({ id: row.id, approved: true })}
                      >
                        <Check /> {t('agents.approvals.approve')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decide.isPending || pinAndDecide.isPending}
                        onClick={() => decide.mutate({ id: row.id, approved: false })}
                      >
                        <X /> {t('agents.approvals.deny')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={decide.isPending || pinAndDecide.isPending}
                        onClick={() => pinAndDecide.mutate({ id: row.id, tool: row.tool, approved: true })}
                        title={t('agents.approvals.alwaysHint')}
                      >
                        {t('agents.approvals.alwaysApprove')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={decide.isPending || pinAndDecide.isPending}
                        onClick={() => pinAndDecide.mutate({ id: row.id, tool: row.tool, approved: false })}
                        title={t('agents.approvals.alwaysHint')}
                      >
                        {t('agents.approvals.alwaysDeny')}
                      </Button>
                    </div>
                  )}
                  {decide.isError && (
                    <p role="alert" className="text-xs text-destructive">{(decide.error as Error).message}</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="text-sm font-medium">{t('agents.approvals.rulesTitle')}</h3>
          {rules.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">{t('agents.approvals.rulesEmpty')}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {rules.map(rule => (
                <li key={rule.tool} className="flex items-center justify-between gap-2 text-xs">
                  <span>
                    <code className="font-mono">{rule.tool}</code>
                    {' → '}
                    <span className="font-medium">{rule.decision}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={clearRule.isPending}
                    onClick={() => clearRule.mutate(rule.tool)}
                  >
                    {t('agents.approvals.removeRule')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
