import { describe, expect, it } from 'vitest'
import { toSpokenText } from './speech'

describe('toSpokenText', () => {
  it('summarizes fenced code blocks instead of reading them', () => {
    const out = toSpokenText('Here:\n```python\nprint(1)\nprint(2)\n```\nDone.')
    expect(out).toContain('python code block, 2 lines.')
    expect(out).not.toContain('print')
    expect(out).not.toContain('```')
  })

  it('drops markdown markup but keeps the words', () => {
    const out = toSpokenText('# Title\n\n**Bold** and *italic* with `code` and [link](http://x).')
    expect(out).toBe('Title\n\nBold and italic with code and link.')
  })

  it('turns lists, quotes, and tables into plain sentences', () => {
    const out = toSpokenText('> quoted\n\n- one\n- two\n\n| a | b |\n| 1 | 2 |')
    expect(out).not.toContain('>')
    expect(out).not.toContain('|')
    expect(out).toContain('one')
    expect(out).toContain('two')
  })

  it('caps length for the TTS request', () => {
    expect(toSpokenText('x'.repeat(5000), 2000)).toHaveLength(2000)
  })

  it('leaves plain text alone', () => {
    expect(toSpokenText('The build passed.')).toBe('The build passed.')
  })
})
