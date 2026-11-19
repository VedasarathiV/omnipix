import { describe, it, expect } from 'vitest'
import { artifactKindOf, artifactSrcDoc, codeFilename, extractArtifacts, extractCodeFiles, ARTIFACT_SANDBOX } from './artifacts'

const HTML = '<!doctype html>\n<html><head><title>Hello page</title></head><body><h1>Hi</h1></body></html>'

describe('artifactKindOf', () => {
  it('recognises html and svg fences, and untagged fences by their first tag', () => {
    expect(artifactKindOf('html', '<div>x</div>')).toBe('html')
    expect(artifactKindOf('HTML', '<p>x</p>')).toBe('html')
    expect(artifactKindOf('svg', '<svg></svg>')).toBe('svg')
    expect(artifactKindOf('', HTML)).toBe('html')
    expect(artifactKindOf('xml', '<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe('svg')
    expect(artifactKindOf('html', '<svg></svg>')).toBe('svg')
  })
  it('leaves ordinary code alone', () => {
    expect(artifactKindOf('js', 'console.log(1)')).toBeNull()
    expect(artifactKindOf('python', 'print(1)')).toBeNull()
    expect(artifactKindOf('', 'const x = 1')).toBeNull()
    expect(artifactKindOf('jsx', '<div/>')).toBeNull()
  })
})

describe('extractArtifacts', () => {
  it('finds runnable fences in document order with titles and stable ids', () => {
    const md = `Here you go:\n\n\`\`\`html\n${HTML}\n\`\`\`\n\nAnd a script:\n\n\`\`\`js\nalert(1)\n\`\`\`\n\n\`\`\`svg\n<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>\n\`\`\`\n`
    const found = extractArtifacts(md, 3)
    expect(found.map(a => [a.id, a.kind, a.title, a.filename])).toEqual([
      ['3:1', 'html', 'Hello page', 'artifact-1.html'],
      ['3:3', 'svg', null, 'artifact-3.svg'],
    ])
    expect(found[0].code).toBe(HTML)
  })

  it('accepts tilde fences and indented fences, and ignores an unterminated one while streaming', () => {
    expect(extractArtifacts('~~~html\n<p>a</p>\n~~~')).toHaveLength(1)
    expect(extractArtifacts('  ```html\n  <p>a</p>\n  ```')).toHaveLength(1)
    expect(extractArtifacts('```html\n<p>still typing')).toHaveLength(0)
  })

  it('does not treat a fence inside inline text as a block', () => {
    expect(extractArtifacts('Use ```html``` fences.')).toHaveLength(0)
  })
})

describe('artifactSrcDoc', () => {
  it('passes html through and wraps svg in a centring page', () => {
    const [html] = extractArtifacts(`\`\`\`html\n${HTML}\n\`\`\``)
    expect(artifactSrcDoc(html)).toBe(HTML)
    const [svg] = extractArtifacts('```svg\n<svg xmlns="http://www.w3.org/2000/svg"></svg>\n```')
    const doc = artifactSrcDoc(svg)
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc).toContain('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  })
})

describe('sandbox', () => {
  it('never grants the preview the dashboard origin', () => {
    expect(ARTIFACT_SANDBOX).toContain('allow-scripts')
    expect(ARTIFACT_SANDBOX).not.toContain('allow-same-origin')
    expect(ARTIFACT_SANDBOX).not.toContain('allow-top-navigation')
  })
})

describe('extractCodeFiles', () => {
  it('collects non-runnable fences and skips artifacts, in document order', () => {
    const md = 'Here:\n\n```html\n<p>a</p>\n```\n\n```js\nconsole.log(1)\n```\n\n```python\nprint(2)\n```\n'
    const found = extractCodeFiles(md, 3)
    expect(found.map(f => [f.id, f.language, f.filename])).toEqual([
      ['code:3:1', 'js', 'snippet-1.js'],
      ['code:3:2', 'python', 'snippet-2.py'],
    ])
    expect(found[0].code).toBe('console.log(1)')
  })

  it('skips empty fences and still-streaming ones, and tolerates tilde fences', () => {
    expect(extractCodeFiles('```js\n   \n```')).toHaveLength(0)
    expect(extractCodeFiles('```py\nprint(')).toHaveLength(0)
    const tilde = extractCodeFiles('~~~go\npackage main\n~~~')
    expect(tilde).toHaveLength(1)
    expect(tilde[0]).toMatchObject({ language: 'go', code: 'package main', filename: 'snippet-1.go' })
  })

  it('scopes ids per message so files never collide across replies', () => {
    const first = extractCodeFiles('```js\na()\n```', 1)
    const second = extractCodeFiles('```js\na()\n```', 2)
    // Identical bytes, distinct identities — the pane can always tell them apart.
    expect(first[0].id).toBe('code:1:1')
    expect(second[0].id).toBe('code:2:1')
    expect(first[0].code).toBe(second[0].code)
  })

  it('codeFilename maps languages to extensions with a txt fallback', () => {
    expect(codeFilename('TypeScript', 1)).toBe('snippet-1.ts')
    expect(codeFilename('dockerfile', 2)).toBe('Dockerfile')
    expect(codeFilename('', 3)).toBe('snippet-3.txt')
    expect(codeFilename('brainfuck', 4)).toBe('snippet-4.txt')
  })
})
