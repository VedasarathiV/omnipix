import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Code2, Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/copy-button'
import { CodeBlock } from '@/components/code-block'
import { useI18n } from '@/i18n'
import type { CodeFile } from '@/lib/artifacts'
import { ARTIFACT_KEY_STEP, ARTIFACT_MIN_WIDTH, clampArtifactWidth, draggedArtifactWidth, maxArtifactWidth } from '@/lib/artifact-panel-size'

// The code pane: the chat's second column, Claude-style. Every fenced block
// in the thread's assistant replies lands here as a file (html/svg keep going
// to the artifact panel instead); the header lists them as chips, the body
// shows the active file highlighted, with copy / download / close.
//
// Sizing mirrors the artifact panel: slide in/out on open/close, a draggable
// left edge (keyboard-resizable), the settled width persisted by the host.

export interface CodePaneProps {
  files: CodeFile[]
  activeId: string | null
  onSelect: (id: string) => void
  /** False plays the exit animation; the host unmounts after it. */
  open: boolean
  width: number
  onWidthChange: (width: number) => void
  /** Called once the user lets go of the handle — the moment to persist. */
  onWidthCommit?: (width: number) => void
  onClose: () => void
  /** Pixels of rails sharing the row; the max width accounts for them. */
  chromeWidth?: number
}

export const CODE_PANE_TRANSITION_MS = 280

export function CodePane({ files, activeId, onSelect, open, width, onWidthChange, onWidthCommit, onClose, chromeWidth = 0 }: CodePaneProps) {
  const { t } = useI18n()
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  // First paint at width 0, then the transition carries it to `width` — that
  // is the slide-in (same two-frame trick as the artifact panel).
  const [mounted, setMounted] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      void boxRef.current?.offsetWidth
      second = requestAnimationFrame(() => setMounted(true))
    })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [])

  const active = files.find(f => f.id === activeId) ?? files[files.length - 1] ?? null

  function download() {
    if (!active) return
    const blob = new Blob([active.code], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = active.filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function onHandleDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* already captured */ }
    drag.current = { startX: e.clientX, startWidth: width }
    setDragging(true)
  }
  function onHandleMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    onWidthChange(draggedArtifactWidth(drag.current.startWidth, drag.current.startX, e.clientX, window.innerWidth, chromeWidth))
  }
  function onHandleUp(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    const { startWidth, startX } = drag.current
    drag.current = null
    setDragging(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    // Commit from the event, not the render-closed width: the last pointermove
    // setState may not have committed before pointerup lands.
    const next = draggedArtifactWidth(startWidth, startX, e.clientX, window.innerWidth, chromeWidth)
    onWidthChange(next)
    onWidthCommit?.(next)
  }
  function onHandleKey(e: KeyboardEvent<HTMLDivElement>) {
    // The handle is on the left edge: ArrowLeft grows the panel.
    const delta = e.key === 'ArrowLeft' ? ARTIFACT_KEY_STEP : e.key === 'ArrowRight' ? -ARTIFACT_KEY_STEP : 0
    if (!delta) return
    e.preventDefault()
    const next = clampArtifactWidth(width + delta, window.innerWidth, chromeWidth)
    onWidthChange(next)
    onWidthCommit?.(next)
  }

  const shown = open && mounted

  return (
    <div
      ref={boxRef}
      className={`relative shrink-0 overflow-hidden ${dragging ? '' : 'transition-[width] ease-out motion-reduce:transition-none'}`}
      style={{ width: shown ? width : 0, transitionDuration: dragging ? undefined : `${CODE_PANE_TRANSITION_MS}ms` }}
      data-testid="code-pane"
      data-open={shown}
      aria-hidden={!open}
      inert={!open}
    >
      <aside
        className="absolute inset-y-0 right-0 flex flex-col border-s bg-card"
        style={{ width }}
        aria-label={t('playground.codeTitle')}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('playground.codeResize')}
          aria-valuenow={Math.round(width)}
          aria-valuemin={ARTIFACT_MIN_WIDTH}
          aria-valuemax={maxArtifactWidth(typeof window === 'undefined' ? 1280 : window.innerWidth, chromeWidth)}
          tabIndex={0}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          onKeyDown={onHandleKey}
          className={`group/handle absolute inset-y-0 -left-1 z-10 w-2.5 cursor-col-resize outline-none focus-visible:bg-ring/30 ${dragging ? 'bg-ring/30' : 'hover:bg-ring/20'}`}
        >
          <div className="absolute inset-y-0 left-1 w-px bg-transparent transition-colors group-hover/handle:bg-ring/60" />
        </div>

        <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <Code2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate" title={active?.filename ?? t('playground.codeTitle')}>
              {active?.filename ?? t('playground.codeTitle')}
            </span>
          </span>
          <div className="ml-auto flex shrink-0 items-center">
            <CopyButton text={active?.code ?? ''} label={t('common.copy')} className="size-8 border-0 bg-transparent" />
            <Button variant="ghost" size="icon-sm" onClick={download} disabled={!active} aria-label={t('playground.codeDownload')} title={t('playground.codeDownload')}>
              <Download className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('playground.codeClose')} title={t('playground.codeClose')}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {files.length > 1 && (
          <div className="flex shrink-0 gap-1 overflow-x-auto border-y px-3 py-1.5" role="tablist" aria-label={t('playground.codeTitle')}>
            {files.map(f => {
              const selected = active?.id === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => onSelect(f.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11px] transition-colors ${
                    selected ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {f.filename}
                </button>
              )
            })}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {active ? (
            <pre key={active.id} className="h-full overflow-auto p-4">
              <CodeBlock code={active.code} language={active.language || undefined} />
            </pre>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t('playground.codeEmpty')}</p>
          )}
        </div>
      </aside>
    </div>
  )
}
