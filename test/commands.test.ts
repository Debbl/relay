import { describe, expect, it } from 'vitest'
import { parseCommand } from '../src/commands'

describe('parseCommand', () => {
  it('parses /new plan', () => {
    expect(parseCommand('/new plan')).toEqual({
      type: 'new',
      mode: 'plan',
    })
  })

  it('parses /mode default', () => {
    expect(parseCommand('/mode default')).toEqual({
      type: 'mode',
      mode: 'default',
    })
  })

  it('parses /projects', () => {
    expect(parseCommand('/projects')).toEqual({
      type: 'projects',
    })
  })

  it('returns invalid for bad mode', () => {
    const result = parseCommand('/mode unknown')
    expect(result.type).toBe('invalid')
  })

  it('returns invalid for empty command', () => {
    const result = parseCommand('   ')
    expect(result.type).toBe('invalid')
  })

  it('treats normal text as prompt', () => {
    expect(parseCommand('hello codex')).toEqual({
      type: 'prompt',
      prompt: 'hello codex',
    })
  })
})
