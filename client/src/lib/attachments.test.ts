import { describe, it, expect } from 'vitest'
import {
  MAX_IMAGE_EDGE,
  attachmentImages,
  classifyFile,
  composeText,
  dataUrlBytes,
  detectMention,
  docsContextMessage,
  fenceLanguage,
  filterMentionDocs,
  fitWithin,
  inlineTextAttachment,
  toMessageContent,
  type Attachment,
} from './attachments'

/** What PlaygroundPage sends: the composed text plus its image data URIs. */
const contentFor = (text: string, attachments: Attachment[] = []) =>
  toMessageContent(composeText(text, attachments), attachmentImages(attachments))

const png = (name = 'shot.png'): Attachment => ({
  id: name, kind: 'image', name, dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
})

describe('classifyFile', () => {
  it('accepts the four image types the composer offers', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(classifyFile({ name: 'a.bin', type })).toBe('image')
    }
  })

  it('accepts text-like files by extension even when the browser reports no MIME type', () => {
    for (const name of ['notes.txt', 'README.md', 'rows.csv', 'rows.tsv', 'body.json', 'server.log']) {
      expect(classifyFile({ name, type: '' })).toBe('text')
    }
  })

  it('rejects the document formats left for the follow-up', () => {
    expect(classifyFile({ name: 'book.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBeNull()
    expect(classifyFile({ name: 'paper.pdf', type: 'application/pdf' })).toBeNull()
    expect(classifyFile({ name: 'archive.zip', type: 'application/zip' })).toBeNull()
    expect(classifyFile({ name: 'clip.mp4', type: 'video/mp4' })).toBeNull()
  })
})

describe('fitWithin', () => {
  it('never scales up', () => {
    expect(fitWithin(320, 200)).toEqual({ width: 320, height: 200 })
  })

  it('caps the longest edge and preserves the aspect ratio', () => {
    expect(fitWithin(4000, 2000)).toEqual({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE / 2 })
    expect(fitWithin(2000, 4000)).toEqual({ width: MAX_IMAGE_EDGE / 2, height: MAX_IMAGE_EDGE })
  })
})

describe('inlineTextAttachment', () => {
  it('labels the block with the filename and a language hint', () => {
    expect(fenceLanguage('rows.csv')).toBe('csv')
    expect(inlineTextAttachment('rows.csv', 'a,b\n1,2')).toBe('rows.csv:\n```csv\na,b\n1,2\n```')
  })

  it('widens the fence so a markdown file cannot break out of it', () => {
    const inlined = inlineTextAttachment('doc.md', 'text\n```js\ncode()\n```')
    expect(inlined.startsWith('doc.md:\n````markdown\n')).toBe(true)
    expect(inlined.endsWith('\n````')).toBe(true)
  })
})

describe('message content', () => {
  it('stays a plain string when nothing is attached', () => {
    expect(contentFor('hello')).toBe('hello')
    expect(contentFor('hello', [])).toBe('hello')
  })

  it('inlines text files into the string, still without an array envelope', () => {
    expect(contentFor('summarize', [
      { id: '1', kind: 'text', name: 'notes.txt', text: 'line one' },
    ])).toBe('summarize\n\nnotes.txt:\n```text\nline one\n```')
  })

  it('emits the OpenAI multimodal array once an image is attached', () => {
    expect(contentFor('what is this?', [png()])).toEqual([
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
    ])
  })

  it('omits the text part when the message is images only', () => {
    expect(contentFor('   ', [png()])).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
    ])
  })

  it('keeps every image, in attach order, alongside inlined text files', () => {
    const content = contentFor('compare', [
      png('a.png'),
      { id: 't', kind: 'text', name: 'notes.md', text: 'ctx' },
      png('b.png'),
    ]) as Exclude<ReturnType<typeof contentFor>, string>
    expect(content.map(p => p.type)).toEqual(['text', 'image_url', 'image_url'])
    expect((content[0] as { text: string }).text).toBe('compare\n\nnotes.md:\n```markdown\nctx\n```')
  })

  it('drops images that never finished encoding', () => {
    expect(contentFor('hi', [{ id: 'x', kind: 'image', name: 'x.png' }])).toBe('hi')
  })

  it('rebuilds history turns from the stored text + image URIs', () => {
    // How PlaygroundPage replays earlier turns: the transcript keeps the text
    // and the data URIs, and the request envelope is rebuilt from them.
    expect(toMessageContent('earlier turn', ['data:image/jpeg;base64,zz'])).toEqual([
      { type: 'text', text: 'earlier turn' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,zz' } },
    ])
    expect(toMessageContent('plain turn')).toBe('plain turn')
  })
})

describe('dataUrlBytes', () => {
  it('measures the decoded payload, not the URI', () => {
    // 4 base64 chars per 3 bytes; the "data:...;base64," prefix is excluded.
    expect(dataUrlBytes(`data:image/png;base64,${'A'.repeat(400)}`)).toBe(300)
  })
})

describe('doc attachments', () => {
  const doc: Attachment = { id: 'd', kind: 'doc', name: 'Guide', project: 'acme', url: 'https://x.test/g' }

  it('leaves the user text and image parts untouched (docs resolve to system context)', () => {
    expect(composeText('hello', [doc])).toBe('hello')
    expect(attachmentImages([doc])).toEqual([])
  })
})

describe('detectMention', () => {
  it('finds an open token before the caret', () => {
    expect(detectMention('hello @wid')).toEqual({ anchor: 6, query: 'wid' })
    expect(detectMention('@')).toEqual({ anchor: 0, query: '' })
    expect(detectMention('(@api/v2')).toEqual({ anchor: 1, query: 'api/v2' })
  })

  it('rejects closed tokens and emails', () => {
    expect(detectMention('hello @wid ')).toBeNull()
    expect(detectMention('mail me@example.com')).toBeNull()
    expect(detectMention('no token here')).toBeNull()
    expect(detectMention('')).toBeNull()
  })
})

describe('filterMentionDocs', () => {
  const docs = [
    { project_key: 'acme', source_url: 'https://x.test/guide', title: 'Widget Guide', chunks: 12, updated_at: '' },
    { project_key: 'acme', source_url: 'https://x.test/api', title: 'API Reference', chunks: 40, updated_at: '' },
    { project_key: 'other', source_url: 'https://y.test/notes', title: 'Notes', chunks: 3, updated_at: '' },
  ]

  it('matches title, url, and project, biggest first', () => {
    expect(filterMentionDocs(docs, '')).toHaveLength(3)
    expect(filterMentionDocs(docs, '')[0].title).toBe('API Reference')
    expect(filterMentionDocs(docs, 'widget')).toEqual([docs[0]])
    expect(filterMentionDocs(docs, 'y.test')).toEqual([docs[2]])
    expect(filterMentionDocs(docs, 'other')).toEqual([docs[2]])
    expect(filterMentionDocs(docs, 'missing')).toEqual([])
  })
})

describe('docsContextMessage', () => {
  it('renders chunks with section heads', () => {
    const out = docsContextMessage([
      { id: 1, project_key: 'a', source_url: 'u', title: 'Guide', chunk_index: 0, section: 'Auth', content: 'Use tokens.' },
      { id: 2, project_key: 'a', source_url: 'u', title: '', chunk_index: 1, section: '', content: 'More.' },
    ])
    expect(out).toContain('Relevant docs')
    expect(out).toContain('### Guide — Auth')
    expect(out).toContain('Use tokens.')
    expect(out).toContain('### u')
  })
})
