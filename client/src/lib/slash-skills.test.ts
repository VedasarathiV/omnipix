import { describe, expect, it } from 'vitest'
import { parseSlashCommand, slashSkillsMessage } from './slash-skills'

describe('parseSlashCommand', () => {
  it.each([
    ['/planner do the thing', ['planner'], 'do the thing'],
    ['/planner /coder do the thing', ['planner', 'coder'], 'do the thing'],
    ['  /planner do the thing', ['planner'], 'do the thing'],
    ['/planner', ['planner'], ''],
  ])('parses %j', (text, names, rest) => {
    expect(parseSlashCommand(text as string)).toEqual({ names, rest })
  })

  it.each([
    'do the thing',
    '/tmp/list files',
    '/v1/models check',
    'do /planner x',
    '',
  ])('ignores %j', (text) => {
    expect(parseSlashCommand(text)).toBeNull()
  })
})

describe('slashSkillsMessage', () => {
  it('renders invoked skills as system context', () => {
    const out = slashSkillsMessage([
      { name: 'planner', instructions: 'Think first.', enabled: 1 },
    ])
    expect(out).toContain('Invoked skills')
    expect(out).toContain('## planner')
    expect(out).toContain('Think first.')
  })
})
