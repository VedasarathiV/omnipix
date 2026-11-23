import { useMemo } from 'react'
import { useI18n } from '@/i18n'
import { parseDiff, type DiffLine } from './diff-parse'

const LINE_STYLES: Record<DiffLine['kind'], string> = {
  context: 'text-muted-foreground',
  add: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  del: 'bg-destructive/10 text-destructive',
  hunk: 'bg-primary/10 font-medium text-primary',
}

const LINE_PREFIX: Record<DiffLine['kind'], string> = {
  context: ' ',
  add: '+',
  del: '-',
  hunk: '',
}

/**
 * Unified-diff viewer for approval requests. Green/red here are semantic —
 * added/removed lines — which is exactly what the palette reserves them for.
 */
export function DiffViewer({ diffText }: { diffText: string }) {
  const { t } = useI18n()
  const lines = useMemo(() => parseDiff(diffText), [diffText])
  if (!diffText.trim()) {
    return <p className="text-xs text-muted-foreground">{t('agents.approvals.noDiff')}</p>
  }
  return (
    <pre className="overflow-x-auto rounded-xl border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className={`px-1 whitespace-pre-wrap break-words ${LINE_STYLES[line.kind]}`}>
          {line.kind !== 'hunk' && <span className="mr-1 inline-block w-3 shrink-0 opacity-60">{LINE_PREFIX[line.kind]}</span>}
          {line.text || ' '}
        </div>
      ))}
    </pre>
  )
}
