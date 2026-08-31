import { describe, it, expect } from 'vitest'
import type { ToolHeadlineSource } from './toolHeadline'
import { PATH_FIELDS, PREFERRED_FIELDS, toolHeadline, toolHeadlineRuns } from './toolHeadline'

// The picker is isolated in toolHeadline.ts precisely so it can be tested here: vitest runs in the
// `node` environment (vitest.config.ts:27) with no DOM, so the renderer tier is renderToStaticMarkup
// string assertions and a rule expressed inside ToolRow could only ever be asserted through rendered
// markup. Expressed here, every one of the four rules is a string literal in, a string literal out,
// with no mock, spy or fixture — shortenPath.test.ts's shape.
//
// The markup half (the run actually swapping inside the chip, and the escaping posture) lives in
// ConversationScreen.test.tsx; this file owns the rules.

describe('PREFERRED_FIELDS / PATH_FIELDS', () => {
  it('probes the eight rule-2 names in the measured order', () => {
    // Measured over 11336 real tool calls, 2026-08-21. Pinned as data, the KEPT_SEGMENTS precedent:
    // reordering this list is a deliberate change to the picker, not a refactor.
    expect(PREFERRED_FIELDS).toEqual([
      'file_path',
      'path',
      'notebook_path',
      'command',
      'pattern',
      'url',
      'query',
      'description'
    ])
  })

  it('shortens exactly the three path-named fields', () => {
    // Declared independently of PREFERRED_FIELDS even though the three coincide with its head: a
    // preference ORDER and a path-ness PREDICATE are two unrelated facts, and deriving one from the
    // other would let a future reorder silently change what gets shortened.
    expect(PATH_FIELDS).toEqual(['file_path', 'path', 'notebook_path'])
  })
})

describe('toolHeadline — rule 1, Bash', () => {
  it('takes a Bash description ahead of its command', () => {
    expect(
      toolHeadline({
        name: 'Bash',
        inputSummary: 'SUMMARY',
        input: { command: 'ls -la src', description: 'List the source folder' }
      })
    ).toBe('List the source folder')
  })

  it('falls through to the command when a Bash call carries no description at all', () => {
    // The load-bearing case: 1397 of 6459 measured Bash calls carry no `description`, so a headline
    // keyed on `description` alone would render blank on 22% of shell calls.
    expect(
      toolHeadline({ name: 'Bash', inputSummary: 'SUMMARY', input: { command: 'ls -la src' } })
    ).toBe('ls -la src')
  })

  it('falls through to the command when a Bash description is empty', () => {
    expect(
      toolHeadline({
        name: 'Bash',
        inputSummary: 'SUMMARY',
        input: { command: 'ls -la src', description: '' }
      })
    ).toBe('ls -la src')
  })

  it('does not apply the Bash override to BashOutput', () => {
    // `===`, never `startsWith`: BashOutput is a real tool name and takes rule 2, where `command`
    // outranks `description` rather than the other way round.
    expect(
      toolHeadline({
        name: 'BashOutput',
        inputSummary: 'SUMMARY',
        input: { command: 'ls -la src', description: 'List the source folder' }
      })
    ).toBe('ls -la src')
  })

  it('falls through to rule 2 when a Bash call carries neither description nor command', () => {
    // Rule 1 is a precedence OVERRIDE for one tool name, not a branch that ends the chain — which is
    // what makes "the headline is never blank" structural rather than a case-by-case property.
    expect(
      toolHeadline({ name: 'Bash', inputSummary: 'SUMMARY', input: { pattern: 'TODO' } })
    ).toBe('TODO')
  })
})

describe('toolHeadline — rule 2, the fixed list', () => {
  it('takes file_path ahead of a command in the same map', () => {
    expect(
      toolHeadline({
        name: 'Edit',
        inputSummary: 'SUMMARY',
        input: { command: 'ls -la src', file_path: 'schema.ts' }
      })
    ).toBe('schema.ts')
  })

  it('takes path when file_path is absent', () => {
    expect(
      toolHeadline({ name: 'Glob', inputSummary: 'SUMMARY', input: { path: 'src/renderer' } })
    ).toBe('src/renderer')
  })

  it('takes notebook_path when both file_path and path are absent', () => {
    expect(
      toolHeadline({
        name: 'NotebookEdit',
        inputSummary: 'SUMMARY',
        input: { notebook_path: 'analysis.ipynb' }
      })
    ).toBe('analysis.ipynb')
  })

  it('takes a later name when no earlier one is present', () => {
    expect(
      toolHeadline({ name: 'Grep', inputSummary: 'SUMMARY', input: { pattern: 'TODO' } })
    ).toBe('TODO')
    expect(
      toolHeadline({ name: 'WebFetch', inputSummary: 'SUMMARY', input: { url: 'example.com/a' } })
    ).toBe('example.com/a')
    expect(
      toolHeadline({ name: 'WebSearch', inputSummary: 'SUMMARY', input: { query: 'noise ik' } })
    ).toBe('noise ik')
  })

  it('skips an empty file_path for the next non-empty name', () => {
    // Present-and-empty is not present. `!== ''` on every rung, not just on rule 1's.
    expect(
      toolHeadline({
        name: 'Edit',
        inputSummary: 'SUMMARY',
        input: { command: 'ls -la src', file_path: '' }
      })
    ).toBe('ls -la src')
  })

  it('skips a field whose key is absent from the map rather than reading it as a value', () => {
    // The central trap: tsconfig.web.json sets `strict` and nothing else, so noUncheckedIndexedAccess
    // is OFF and `input['file_path']` types as `string` while being `undefined` at runtime. A rung
    // testing only `!== ''` would select undefined and draw the name beside a blank run.
    expect(
      toolHeadline({ name: 'Read', inputSummary: 'SUMMARY', input: { offset: '120' } })
    ).toBe('120')
  })
})

describe('toolHeadline — rule 3, the MCP catch-all', () => {
  it('takes the first line-break-free value when no rule-2 name is present', () => {
    // What makes MCP tools work: their inputs use names no fixed list would guess.
    expect(
      toolHeadline({
        name: 'mcp__codegraph__codegraph_callers',
        inputSummary: 'SUMMARY',
        input: { symbol: 'RelayConnection' }
      })
    ).toBe('RelayConnection')
  })

  it('skips a multi-line value for the next single-line one', () => {
    expect(
      toolHeadline({
        name: 'mcp__x__y',
        inputSummary: 'SUMMARY',
        input: { body: 'line one\nline two', nodeId: '16-28' }
      })
    ).toBe('16-28')
  })

  it('skips a carriage-return value too', () => {
    expect(
      toolHeadline({
        name: 'mcp__x__y',
        inputSummary: 'SUMMARY',
        input: { body: 'line one\r\nline two', nodeId: '16-28' }
      })
    ).toBe('16-28')
  })

  it('skips an empty value for the next non-empty one', () => {
    // The blank-headline hole: an empty value contains no line break, so a rule 3 testing only for
    // line breaks would select it.
    expect(
      toolHeadline({ name: 'mcp__x__y', inputSummary: 'SUMMARY', input: { a: '', b: 'kept' } })
    ).toBe('kept')
  })

  it('falls through to inputSummary when every value is multi-line', () => {
    expect(
      toolHeadline({
        name: 'mcp__x__y',
        inputSummary: 'SUMMARY',
        input: { a: 'one\ntwo', b: 'three\nfour' }
      })
    ).toBe('SUMMARY')
  })

  it('lands on a non-string JSON value in its compact string form', () => {
    // Every value is already a string daemon-side: a JSON string arrives decoded, every other JSON
    // type arrives as its compact form. An ACCEPTED MISS, pinned so it is not mistaken for a defect —
    // #706's expanded field list is what covers the picker's misses.
    expect(toolHeadline({ name: 'mcp__x__y', inputSummary: 'SUMMARY', input: { flag: 'true' } })).toBe(
      'true'
    )
  })
})

describe('toolHeadline — rule 4, the fallback', () => {
  it('renders inputSummary when input is absent', () => {
    // A pre-pyrycode#1678 daemon. Asserted on the VALUE, never `'input' in source`: #643 sets the key
    // unconditionally and the IPC bridge is a structured clone, which preserves a property holding
    // `undefined` rather than dropping it.
    expect(toolHeadline({ name: 'read_file', inputSummary: 'SUMMARY' })).toBe('SUMMARY')
    expect(toolHeadline({ name: 'read_file', inputSummary: 'SUMMARY', input: undefined })).toBe(
      'SUMMARY'
    )
  })

  it('renders inputSummary for an empty input map, identically to an absent one', () => {
    // #643 keeps the two distinct AT THE ITEM on purpose (absent = old daemon, {} = this daemon sent
    // no fields for this call). Rules 1-3 have nothing to look at in either case, so the distinction
    // is deliberately not surfaced in the row.
    expect(toolHeadline({ name: 'read_file', inputSummary: 'SUMMARY', input: {} })).toBe('SUMMARY')
  })

  it('renders an empty inputSummary as empty rather than inventing copy', () => {
    // Today's behaviour for the same input — the row draws the name alone. Not a regression this
    // slice introduces, and not a case worth a client-owned placeholder.
    expect(toolHeadline({ name: 'read_file', inputSummary: '', input: {} })).toBe('')
  })
})

describe('toolHeadline — shortening', () => {
  it('shortens a deep file_path', () => {
    expect(
      toolHeadline({
        name: 'Edit',
        inputSummary: 'SUMMARY',
        input: { file_path: 'src/renderer/src/screens/conversation/ConversationScreen.tsx' }
      })
    ).toBe('.../src/screens/conversation/ConversationScreen.tsx')
  })

  it('shortens a deep path and a deep notebook_path', () => {
    expect(
      toolHeadline({ name: 'Glob', inputSummary: 'SUMMARY', input: { path: 'a/b/c/d/e.txt' } })
    ).toBe('.../b/c/d/e.txt')
    expect(
      toolHeadline({
        name: 'NotebookEdit',
        inputSummary: 'SUMMARY',
        input: { notebook_path: 'a/b/c/d/e.ipynb' }
      })
    ).toBe('.../b/c/d/e.ipynb')
  })

  it('leaves a Bash command line unshortened however many separators it carries', () => {
    // Path rules must not be applied to a command line: shortenPath splits on `/` and prefixes
    // `.../`, which would mangle this into something that reads like a path and is not one.
    const command = 'grep -r foo src/renderer/src/screens/conversation'
    expect(toolHeadline({ name: 'Bash', inputSummary: 'SUMMARY', input: { command } })).toBe(command)
  })

  it('leaves a Bash description unshortened', () => {
    const description = 'a/b/c/d/e/f'
    expect(
      toolHeadline({ name: 'Bash', inputSummary: 'SUMMARY', input: { command: 'ls', description } })
    ).toBe(description)
  })

  it('leaves a pattern and a url unshortened', () => {
    const pattern = 'src/renderer/src/screens/conversation/.*'
    expect(toolHeadline({ name: 'Grep', inputSummary: 'SUMMARY', input: { pattern } })).toBe(pattern)
    const url = 'https://example.com/a/b/c/d/e'
    expect(toolHeadline({ name: 'WebFetch', inputSummary: 'SUMMARY', input: { url } })).toBe(url)
  })

  it('leaves a query and a non-Bash command unshortened', () => {
    const query = 'a/b/c/d/e/f'
    expect(toolHeadline({ name: 'WebSearch', inputSummary: 'SUMMARY', input: { query } })).toBe(query)
    const command = 'a/b/c/d/e/f'
    expect(toolHeadline({ name: 'BashOutput', inputSummary: 'SUMMARY', input: { command } })).toBe(
      command
    )
  })

  it('leaves a rule-3 value unshortened even when it looks like a path', () => {
    // The shortening decision is keyed on the FIELD NAME, and no arbitrary MCP field name is one of
    // the three.
    const value = 'a/b/c/d/e/f.txt'
    expect(toolHeadline({ name: 'mcp__x__y', inputSummary: 'SUMMARY', input: { blob: value } })).toBe(
      value
    )
  })

  it('leaves inputSummary unshortened', () => {
    const summary = 'a/b/c/d/e/f.txt · 184 lines'
    expect(toolHeadline({ name: 'read_file', inputSummary: summary })).toBe(summary)
  })
})

// #855 — WHICH of the header's two runs the picked text lands in. Every block above is unedited and
// stays green: the picker is unchanged, and this file's own diff being additive is the evidence for it.
// The routing is a second reader of the same rules, never a second copy of them.
describe('toolHeadlineRuns — the shell call cases', () => {
  it('gives a described shell call the subject alone, no lead at all', () => {
    // The `command` beside it is load-bearing rather than scenery: it proves the description WINS
    // rather than merely being present, which is rule 1's own order read through the router.
    expect(
      toolHeadlineRuns({
        name: 'Bash',
        inputSummary: 'SUMMARY',
        input: { command: 'ls -la src', description: 'List the source folder' }
      })
    ).toEqual({ lead: null, subject: 'List the source folder' })
  })

  it('gives an undescribed shell call the lead alone, no subject at all', () => {
    // 11.2% of shell calls, measured over 58199. On these the command is not a substitute for the
    // headline — it is the row's whole visible content.
    expect(
      toolHeadlineRuns({ name: 'Bash', inputSummary: 'SUMMARY', input: { command: 'ls -la src' } })
    ).toEqual({ lead: 'ls -la src', subject: null })
  })

  it('treats an empty description as absent and hands the lead to the command', () => {
    // `firstNonEmpty`'s `!== ''` reaching the router. Without it the row would draw a blank subject
    // and no lead — a visibly empty header.
    expect(
      toolHeadlineRuns({
        name: 'Bash',
        inputSummary: 'SUMMARY',
        input: { command: 'ls -la src', description: '' }
      })
    ).toEqual({ lead: 'ls -la src', subject: null })
  })

  it('keeps todays shape for a shell call whose input map is absent (AC4)', () => {
    expect(toolHeadlineRuns({ name: 'Bash', inputSummary: 'SUMMARY' })).toEqual({
      lead: 'Bash',
      subject: 'SUMMARY'
    })
  })

  it('keeps todays shape for an empty input map too, identically to an absent one', () => {
    expect(toolHeadlineRuns({ name: 'Bash', inputSummary: 'SUMMARY', input: {} })).toEqual({
      lead: 'Bash',
      subject: 'SUMMARY'
    })
  })

  it('falls all the way through for a shell call carrying neither field', () => {
    // The gap the ticket's table does not spell out, resolved by FALLING THROUGH to the general shape
    // rather than by a fourth branch: rule 1 selects nothing, rule 3 lands on the one value there is.
    expect(
      toolHeadlineRuns({ name: 'Bash', inputSummary: 'SUMMARY', input: { timeout: '5' } })
    ).toEqual({ lead: 'Bash', subject: '5' })
  })

  it('leaves BashOutput on the general shape though it carries a command', () => {
    // The load-bearing negative: it is the name a `startsWith` test would wrongly catch, it really
    // carries a `command` field, and stripping its tool name off the row would be a regression.
    expect(
      toolHeadlineRuns({
        name: 'BashOutput',
        inputSummary: 'SUMMARY',
        input: { command: 'ls -la src' }
      })
    ).toEqual({ lead: 'BashOutput', subject: 'ls -la src' })
  })
})

describe('toolHeadlineRuns — every other call, unchanged', () => {
  it('keeps the tool name on a non-shell call that carries a description', () => {
    // THE CENTRAL RULING AS A TEST. `description` is not exclusive to shell calls — subagent launches
    // carry one on all 208 corpus calls and task creation on 97.5% of 121 — so a router keyed on the
    // PICKED KEY instead of the TOOL would return `{ lead: null }` here and strip the name off those
    // rows. The switch is on the tool, and the key test lives inside it.
    expect(
      toolHeadlineRuns({
        name: 'Task',
        inputSummary: 'SUMMARY',
        input: { description: 'Review the spec' }
      })
    ).toEqual({ lead: 'Task', subject: 'Review the spec' })
    expect(
      toolHeadlineRuns({
        name: 'mcp__linear__create_issue',
        inputSummary: 'SUMMARY',
        input: { description: 'Ship the row' }
      })
    ).toEqual({ lead: 'mcp__linear__create_issue', subject: 'Ship the row' })
  })

  it('still shortens a path tool through the untouched picker (AC3)', () => {
    expect(
      toolHeadlineRuns({
        name: 'Edit',
        inputSummary: 'SUMMARY',
        input: { file_path: 'src/renderer/src/screens/conversation/ConversationScreen.tsx' }
      })
    ).toEqual({ lead: 'Edit', subject: '.../src/screens/conversation/ConversationScreen.tsx' })
  })

  it('keeps a search and a long-tail tool on both runs (AC3)', () => {
    expect(
      toolHeadlineRuns({ name: 'Grep', inputSummary: 'SUMMARY', input: { pattern: 'TODO' } })
    ).toEqual({ lead: 'Grep', subject: 'TODO' })
    expect(
      toolHeadlineRuns({
        name: 'mcp__codegraph__codegraph_callers',
        inputSummary: 'SUMMARY',
        input: { symbol: 'RelayConnection' }
      })
    ).toEqual({ lead: 'mcp__codegraph__codegraph_callers', subject: 'RelayConnection' })
  })

  it('draws SOMETHING on every source, and defers to the picker on every non-shell one', () => {
    // The structural pair, and the machine-checked form of "the general case is today's shape
    // VERBATIM" — the subject is not re-derived here, it IS `toolHeadline(source)`.
    const sources: ToolHeadlineSource[] = [
      { name: 'read_file', inputSummary: 'SUMMARY' },
      { name: 'read_file', inputSummary: '', input: {} },
      { name: 'Bash', inputSummary: 'SUMMARY' },
      { name: 'Bash', inputSummary: 'SUMMARY', input: { description: 'D' } },
      { name: 'Bash', inputSummary: 'SUMMARY', input: { command: 'C' } },
      { name: 'Bash', inputSummary: 'SUMMARY', input: { timeout: '5' } },
      { name: 'BashOutput', inputSummary: 'SUMMARY', input: { command: 'C' } },
      { name: 'Edit', inputSummary: 'SUMMARY', input: { file_path: 'a/b/c/d/e.ts' } },
      { name: 'mcp__x__y', inputSummary: 'SUMMARY', input: { a: 'one\ntwo' } }
    ]
    for (const source of sources) {
      const runs = toolHeadlineRuns(source)
      expect(runs.lead === null && runs.subject === null).toBe(false)
      if (source.name !== 'Bash') {
        expect(runs).toEqual({ lead: source.name, subject: toolHeadline(source) })
      }
    }
  })
})
