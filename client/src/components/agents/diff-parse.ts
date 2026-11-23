export interface DiffLine {
  kind: 'context' | 'add' | 'del' | 'hunk'
  text: string
}

/** Parse a unified diff into renderable lines. Non-diff text renders as context. */
export function parseDiff(diffText: string): DiffLine[] {
  return diffText.split('\n').map(text => {
    if (text.startsWith('@@')) return { kind: 'hunk', text }
    if (text.startsWith('+') && !text.startsWith('+++')) return { kind: 'add', text: text.slice(1) }
    if (text.startsWith('-') && !text.startsWith('---')) return { kind: 'del', text: text.slice(1) }
    if (text.startsWith('+++') || text.startsWith('---')) return { kind: 'hunk', text }
    return { kind: 'context', text: text.startsWith(' ') ? text.slice(1) : text }
  })
}
