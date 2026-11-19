import { BookOpenText, Paperclip } from 'lucide-react'
import { useI18n } from '@/i18n'
import type { IngestedDoc } from '@/lib/attachments'

// The @-mention picker: ingested docs filtered by the half-typed token, plus
// an attach-file row. Rendered above the composer while a token is open;
// selection is by click or keyboard (the page owns the key handling).

export interface MentionPickerProps {
  docs: IngestedDoc[]
  /** Flat-list cursor: 0..docs.length-1 are docs, docs.length is attach-file. */
  activeIndex: number
  onSelectDoc: (doc: IngestedDoc) => void
  onAttachFile: () => void
  onHover: (index: number) => void
}

export function MentionPicker({ docs, activeIndex, onSelectDoc, onAttachFile, onHover }: MentionPickerProps) {
  const { t } = useI18n()
  return (
    <div
      role="listbox"
      aria-label={t('playground.mentionLabel')}
      className="mb-2 overflow-hidden rounded-xl border bg-background shadow-lg"
    >
      {docs.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t('playground.mentionNoDocs')}</p>
      )}
      {docs.map((doc, i) => (
        <button
          key={`${doc.project_key}${doc.source_url}`}
          type="button"
          role="option"
          aria-selected={activeIndex === i}
          onMouseEnter={() => onHover(i)}
          onClick={() => onSelectDoc(doc)}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${activeIndex === i ? 'bg-muted' : ''}`}
        >
          <BookOpenText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {doc.title || doc.source_url}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {doc.project_key} · {t('playground.mentionChunks', { count: doc.chunks })}
          </span>
        </button>
      ))}
      <button
        type="button"
        role="option"
        aria-selected={activeIndex === docs.length}
        onMouseEnter={() => onHover(docs.length)}
        onClick={onAttachFile}
        className={`flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs ${activeIndex === docs.length ? 'bg-muted' : ''}`}
      >
        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{t('playground.mentionAttachFile')}</span>
      </button>
    </div>
  )
}
