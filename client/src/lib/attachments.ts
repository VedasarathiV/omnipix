// Playground file attachments (#325). Three kinds, on purpose:
//
//   - images (png/jpeg/webp/gif) → downscaled in the browser and sent as an
//     OpenAI `image_url` data-URI content part, which the server already
//     accepts and routes to a vision-capable model (server/src/lib/content.ts).
//   - text-like files (txt/md/csv/tsv/json/log) → inlined into the message text
//     as a fenced block labelled with the filename.
//   - pdf → text extracted server-side (POST /api/uploads/parse-pdf), then
//     inlined exactly like a text file.
//
// Spreadsheets and Word docs (xlsx/docx) are still NOT handled: their text
// needs a parser nobody has wired up yet, so they stay loudly rejected.
//
import { apiFetch } from './api'
// The caps below exist because every request leaves through a FREE-TIER
// provider: base64 images inflate the prompt ~33%, and free tiers have small
// per-request body limits and tight token budgets. They are intentionally
// conservative — a 1024px edge is enough for a model to read a screenshot.

/** Longest edge, in pixels, an attached image is downscaled to. */
export const MAX_IMAGE_EDGE = 1024
/** Cap for one encoded image data URI (~1.2 MB ≈ 0.9 MB of pixels). */
export const MAX_IMAGE_BYTES = 1_200_000
/** Cap for all images on a single message. */
export const MAX_TOTAL_IMAGE_BYTES = 3_000_000
/** Cap for one text-like file, before inlining it into the prompt. */
export const MAX_TEXT_BYTES = 128_000
/** Cap for one PDF upload — mirrors the server's 5MB parse limit. */
export const MAX_PDF_BYTES = 5 * 1024 * 1024
/** Attachments allowed on a single message. */
export const MAX_ATTACHMENTS = 5

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log']
export const PDF_EXTENSIONS = ['pdf']
// Source files @file completion may offer. Drops/uploads stay limited to
// TEXT_EXTENSIONS (MIME sniffing is unreliable for code), but workspace
// files come from disk with trustworthy names, and the reader refuses
// binaries server-side anyway.
export const CODE_EXTENSIONS = [
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts',
  'py', 'pyi', 'go', 'rs', 'java', 'kt', 'kts', 'rb', 'php',
  'c', 'h', 'cpp', 'hpp', 'cc', 'swift', 'sh', 'bash', 'zsh',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'vue', 'svelte',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'sql', 'graphql', 'gql',
]

/** `accept` for the file input — mirrors what classifyFile() lets through. */
export const ACCEPT_ATTRIBUTE = [...IMAGE_MIME_TYPES, ...TEXT_EXTENSIONS.map(e => `.${e}`), ...PDF_EXTENSIONS.map(e => `.${e}`)].join(',')

export type AttachmentKind = 'image' | 'text' | 'doc' | 'pdf'

export interface Attachment {
  id: string
  kind: AttachmentKind
  name: string
  /** Downscaled data URI — images only. */
  dataUrl?: string
  /** Decoded UTF-8 contents — text-like files only. */
  text?: string
  /** Ingested-doc locator — doc attachments only. */
  project?: string
  url?: string
}

/** An ingested doc row, as GET /api/memories/docs returns it. */
export interface IngestedDoc {
  project_key: string
  source_url: string
  title: string
  chunks: number
  updated_at: string
}

export interface DocChunk {
  id: number
  project_key: string
  source_url: string
  title: string
  chunk_index: number
  section: string
  content: string
}

/** OpenAI multimodal content parts, exactly as the proxy expects them. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

// Type sniffing is extension-first because browsers report inconsistent MIME
// types for text-like files (empty string for .md, application/vnd.ms-excel for
// .csv on Windows). Anything we don't recognize is rejected loudly rather than
// guessed at.
export function classifyFile(file: { name: string; type?: string }): AttachmentKind | null {
  const type = (file.type ?? '').toLowerCase()
  if (IMAGE_MIME_TYPES.includes(type)) return 'image'
  const ext = fileExtension(file.name)
  if (type === 'application/pdf' || PDF_EXTENSIONS.includes(ext)) return 'pdf'
  if (TEXT_EXTENSIONS.includes(ext)) return 'text'
  if (!type && ext === '') return null
  if (type.startsWith('text/')) return 'text'
  if (type === 'application/json') return 'text'
  return null
}

/** Scale (w, h) down so the longest edge is at most `maxEdge`; never scales up. */
export function fitWithin(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

const FENCE_LANGUAGE: Record<string, string> = {
  md: 'markdown', markdown: 'markdown', json: 'json', csv: 'csv', tsv: 'tsv', log: 'text', txt: 'text', pdf: 'text',
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', mjs: 'javascript', cjs: 'javascript',
  mts: 'typescript', cts: 'typescript', py: 'python', pyi: 'python', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', kts: 'kotlin', rb: 'ruby', php: 'php', c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp', swift: 'swift', sh: 'bash', bash: 'bash', zsh: 'zsh',
  css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', xml: 'xml',
  vue: 'vue', svelte: 'svelte', yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini',
  cfg: 'ini', conf: 'ini', env: 'text', sql: 'sql', graphql: 'graphql', gql: 'graphql',
}

/** True for files @file completion may offer: text-like or source code. */
export function isMentionableFile(name: string): boolean {
  if (classifyFile({ name }) === 'text') return true
  return CODE_EXTENSIONS.includes(fileExtension(name))
}

export function fenceLanguage(name: string): string {
  return FENCE_LANGUAGE[fileExtension(name)] ?? 'text'
}

// ── @-mentions ───────────────────────────────────────────────────────────────
// Typing @ in the composer opens a picker over ingested docs (+ attach-file).
// The token is the @ plus the word being typed; selecting a doc pins a doc
// attachment and deletes the token, so the sent text stays clean.

export interface MentionToken {
  /** Caret-relative start index of the @. */
  anchor: number
  /** Text after the @ (the filter query). */
  query: string
}

/** Find an open @-token immediately before the caret. Null when none. */
export function detectMention(textBeforeCaret: string): MentionToken | null {
  const match = /(?:^|[\s(])@([\w./-]*)$/.exec(textBeforeCaret)
  if (!match) return null
  const at = textBeforeCaret.lastIndexOf('@')
  return { anchor: at, query: match[1] }
}

/** Docs matching the mention query (title, URL, or project), most-chunked first. */
export function filterMentionDocs(docs: IngestedDoc[], query: string, limit = 6): IngestedDoc[] {
  const q = query.trim().toLowerCase()
  const hits = q
    ? docs.filter(d =>
      d.title.toLowerCase().includes(q) ||
      d.source_url.toLowerCase().includes(q) ||
      d.project_key.toLowerCase().includes(q))
    : [...docs]
  return hits.sort((a, b) => b.chunks - a.chunks).slice(0, limit)
}

/**
 * Workspace files matching the mention query, basename-first: an exact
 * basename hit outranks a directory-path hit, and shorter paths outrank
 * deeper ones. Subsequence (fuzzy) matching so `rdme` still finds README.
 */
export function filterMentionFiles(files: string[], query: string, limit = 6): string[] {
  const q = query.trim().toLowerCase()
  const fuzzy = (hay: string): boolean => {
    let i = 0
    for (const ch of hay.toLowerCase()) {
      if (ch === q[i]) i += 1
      if (i === q.length) return true
    }
    return q.length === 0
  }
  const scored = (q ? files.filter(f => fuzzy(f.split('/').pop() ?? f) || fuzzy(f)) : [...files])
    .map(f => {
      const base = (f.split('/').pop() ?? f).toLowerCase()
      const exact = q && base === q ? 0 : base.startsWith(q) ? 1 : base.includes(q) ? 2 : 3
      return { f, exact, len: f.length }
    })
  return scored.sort((a, b) => a.exact - b.exact || a.len - b.len).slice(0, limit).map(s => s.f)
}

/** Render recalled doc chunks as the system context pinned mentions inject. */
export function docsContextMessage(chunks: DocChunk[]): string {
  const blocks = chunks.map(c => {
    const head = c.section ? `${c.title || c.source_url} — ${c.section}` : (c.title || c.source_url)
    return `### ${head}\n${c.content}`
  })
  return `Relevant docs for the @-mentioned sources (quote rather than paraphrase when precision matters):\n${blocks.join('\n\n')}`
}

// Inlined as a fenced block so the model sees the filename AND a boundary; the
// fence is widened past any run of backticks inside the file so pasted markdown
// can't break out of it.
export function inlineTextAttachment(name: string, text: string): string {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map(m => m[0].length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${name}:\n${fence}${fenceLanguage(name)}\n${text.replace(/\s+$/, '')}\n${fence}`
}

/**
 * The user-visible message text: what was typed, followed by one fenced block
 * per text-like attachment. Text files live in the prompt itself, so the chat
 * transcript shows exactly what the model was given.
 */
export function composeText(text: string, attachments: Attachment[] = []): string {
  return [
    text.trim(),
    ...attachments.filter(a => a.kind === 'text' || a.kind === 'pdf').map(a => inlineTextAttachment(a.name, a.text ?? '')),
  ].filter(Boolean).join('\n\n')
}

/** The data URIs of the attachments that made it through image encoding. */
export function attachmentImages(attachments: Attachment[] = []): string[] {
  return attachments.flatMap(a => (a.kind === 'image' && a.dataUrl ? [a.dataUrl] : []))
}

export interface SplitMessage {
  /** What the user typed (may be ''). */
  text: string
  /** Inlined attachment blocks, in order. */
  attachments: { name: string; body: string }[]
}

/**
 * Inverse of composeText for display: split a sent message back into typed
 * text plus attachment blocks. Only blocks in the exact writer shape
 * (`name:` + fence … fence) split off — user-typed code fences stay inline,
 * because they never carry the `name:` header line.
 */
export function splitMessageAttachments(content: string): SplitMessage {
  const attachments: { name: string; body: string }[] = []
  const pattern = /(?:^|\n\n)([^`\n][^\n]*):\n(`{3,})[^\n]*\n([\s\S]*?)\n\2(?=\n\n|$)/g
  let text = content
  let m: RegExpExecArray | null
  // Collect from the end so earlier indices stay valid; the first block's
  // start marks where the typed text ends. Names must look like files
  // (extension dot or path slash) so a user-typed "note:" + fence never
  // collapses — writer names are always filenames or `folder/`.
  const blocks: { index: number; name: string; body: string; end: number }[] = []
  while ((m = pattern.exec(content)) !== null) {
    const name = m[1].trim()
    if (!/[./]/.test(name)) continue
    blocks.push({ index: m.index, name, body: m[3], end: m.index + m[0].length })
  }
  if (blocks.length > 0) {
    text = content.slice(0, blocks[0].index)
    for (const b of blocks) attachments.push({ name: b.name, body: b.body })
  }
  return { text, attachments }
}

/**
 * Build the `content` field for a message. Stays a plain string when there are
 * no images (the shape the Playground has always sent); becomes the OpenAI
 * multimodal array as soon as one image is attached — which is exactly what
 * server/src/lib/content.ts normalizes and what the vision router keys on.
 */
export function toMessageContent(text: string, images: string[] = []): string | ContentPart[] {
  if (images.length === 0) return text
  return [
    ...(text ? [{ type: 'text' as const, text }] : []),
    ...images.map(url => ({ type: 'image_url' as const, image_url: { url } })),
  ]
}

/** Approximate decoded byte size of a data URI (base64 is 4 chars per 3 bytes). */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  const payload = comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
  return Math.floor((payload.length * 3) / 4)
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${Math.round(bytes / 100_000) / 10} MB`
  return `${Math.round(bytes / 1000)} KB`
}

// ── Browser-only readers ────────────────────────────────────────────────────
// Kept in this module so the Playground page stays a view: everything below
// touches the DOM (canvas/FileReader) and is exercised by hand, while the pure
// helpers above carry the unit tests.

export type AttachmentErrorReason = 'unsupported' | 'too-large' | 'unreadable'

export class AttachmentError extends Error {
  reason: AttachmentErrorReason

  constructor(reason: AttachmentErrorReason, message?: string) {
    super(message ?? reason)
    this.reason = reason
  }
}

async function encode(canvas: HTMLCanvasElement, sourceType: string): Promise<string> {
  // PNG/WebP sources keep an alpha-preserving encode first; if that lands over
  // the per-image cap we fall back to progressively cheaper JPEG (a flattened
  // screenshot is far better than a rejected attachment).
  const attempts: [string, number | undefined][] = sourceType === 'image/png' || sourceType === 'image/webp'
    ? [['image/png', undefined], ['image/jpeg', 0.82], ['image/jpeg', 0.6]]
    : [['image/jpeg', 0.82], ['image/jpeg', 0.6]]
  let last = ''
  for (const [type, quality] of attempts) {
    last = canvas.toDataURL(type, quality)
    if (dataUrlBytes(last) <= MAX_IMAGE_BYTES) return last
  }
  throw new AttachmentError('too-large')
}

/** Downscale an image file to MAX_IMAGE_EDGE and return it as a data URI. */
export async function readImageAttachment(file: File): Promise<string> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new AttachmentError('unreadable')
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new AttachmentError('unreadable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  return encode(canvas, (file.type ?? '').toLowerCase())
}

/** Read a text-like file, rejecting anything over MAX_TEXT_BYTES. */
export async function readTextAttachment(file: File): Promise<string> {
  if (file.size > MAX_TEXT_BYTES) throw new AttachmentError('too-large')
  try {
    return await file.text()
  } catch {
    throw new AttachmentError('unreadable')
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Extract a PDF's text through the server (POST /api/uploads/parse-pdf) so
 * the client ships no PDF engine. The caller inlines the result like a text
 * file. Server rejections (scanned image, corrupt file) arrive as the thrown
 * Error's message, ready to toast verbatim.
 */
export async function parsePdfAttachment(file: File): Promise<string> {
  if (file.size > MAX_PDF_BYTES || file.size === 0) throw new AttachmentError('too-large')
  let dataUrl: string
  try {
    dataUrl = await readAsDataUrl(file)
  } catch {
    throw new AttachmentError('unreadable')
  }
  const comma = dataUrl.indexOf(',')
  const dataBase64 = comma === -1 ? '' : dataUrl.slice(comma + 1)
  if (!dataBase64) throw new AttachmentError('unreadable')
  const res = await apiFetch<{ text: string; truncated: boolean; pages?: number }>('/api/uploads/parse-pdf', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, dataBase64 }),
  })
  return res.text
}
