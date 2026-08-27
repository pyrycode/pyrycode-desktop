import { describe, it, expect } from 'vitest'
import { listedInputFields, shellCommandBlock } from './toolBody'

// The expanded body's input treatment is isolated in toolBody.ts for toolHeadline.test.ts's reason:
// vitest runs in the `node` environment (vitest.config.ts:27) with no DOM, so the renderer tier is
// renderToStaticMarkup string assertions and a rule expressed inside ToolRow could only ever be
// asserted through rendered markup. Expressed here, every rule is a value in and a value out.
//
// The markup half — the block's two elements, its position above the list, and the escaping posture —
// lives in ConversationScreen.test.tsx; this file owns the rules.

describe('shellCommandBlock', () => {
  it('returns a Bash calls command verbatim', () => {
    expect(
      shellCommandBlock({
        name: 'Bash',
        input: { description: 'Check the tree', command: 'git status --short && git diff --stat' }
      })
    ).toBe('git status --short && git diff --stat')
  })

  it('returns null for a Bash call carrying no command key', () => {
    expect(shellCommandBlock({ name: 'Bash', input: { description: 'Check the tree' } })).toBeNull()
  })

  it('returns null for an empty-string command — the empty-block guard, at the source', () => {
    // AC3 asks for no empty code block. The null is where that becomes structural: the call site's
    // `!== null` guard then cannot draw a bordered box with nothing in it.
    expect(shellCommandBlock({ name: 'Bash', input: { command: '' } })).toBeNull()
  })

  it('returns null for BashOutput even though it carries both fields', () => {
    // The ===-not-startsWith proof. BashOutput is a real tool name and is not a shell call; it keeps
    // the general treatment, which is what the headline rule's own `===` already gets for free.
    expect(
      shellCommandBlock({
        name: 'BashOutput',
        input: { description: 'Read the buffer', command: 'bash_1' }
      })
    ).toBeNull()
  })

  it('returns null for any other tool carrying a command field', () => {
    for (const name of ['Read', 'Edit', 'mcp__figma__get_design_context']) {
      expect(shellCommandBlock({ name, input: { command: 'rm -rf /' } })).toBeNull()
    }
  })

  it('returns null when the input map is absent entirely', () => {
    expect(shellCommandBlock({ name: 'Bash' })).toBeNull()
  })
})

describe('listedInputFields', () => {
  it('drops description and command from a Bash call and keeps every other field', () => {
    expect(
      listedInputFields({
        name: 'Bash',
        input: { description: 'Check the tree', command: 'git status', timeout: '120000' }
      })
    ).toEqual([['timeout', '120000']])
  })

  it('keeps both fields for BashOutput, in arrival order', () => {
    expect(
      listedInputFields({
        name: 'BashOutput',
        input: { description: 'Read the buffer', command: 'bash_1' }
      })
    ).toEqual([
      ['description', 'Read the buffer'],
      ['command', 'bash_1']
    ])
  })

  it('returns nothing at all for a Bash call whose only fields are the two carved out', () => {
    // The design's Fields-off case: a description + command call has nothing left to list.
    expect(
      listedInputFields({ name: 'Bash', input: { description: 'Check the tree', command: 'git status' } })
    ).toEqual([])
  })

  it('collapses an absent and an empty map, for a Bash name and a non-Bash one alike', () => {
    expect(listedInputFields({ name: 'Bash' })).toEqual([])
    expect(listedInputFields({ name: 'Bash', input: {} })).toEqual([])
    expect(listedInputFields({ name: 'read_file' })).toEqual([])
    expect(listedInputFields({ name: 'read_file', input: {} })).toEqual([])
  })

  it('never re-sorts the entries', () => {
    // Keys inserted NON-alphabetically. A .sort() anywhere in the filter would invert this order.
    expect(
      listedInputFields({
        name: 'Bash',
        input: { zulu: 'v_zulu', alpha: 'v_alpha', mike: 'v_mike' }
      })
    ).toEqual([
      ['zulu', 'v_zulu'],
      ['alpha', 'v_alpha'],
      ['mike', 'v_mike']
    ])
  })

  it('keeps a Bash field whose name merely starts with or contains a carved-out one', () => {
    // The guard against a startsWith / substring membership test, which would silently eat real
    // fields. The test is exact-name membership and nothing else.
    expect(
      listedInputFields({
        name: 'Bash',
        input: {
          command_timeout: '5',
          commands: 'a; b',
          description_url: 'https://example.test',
          command: 'ls'
        }
      })
    ).toEqual([
      ['command_timeout', '5'],
      ['commands', 'a; b'],
      ['description_url', 'https://example.test']
    ])
  })
})
