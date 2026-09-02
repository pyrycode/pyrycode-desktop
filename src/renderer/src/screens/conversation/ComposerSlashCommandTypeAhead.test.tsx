import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WireSlashCommand } from '@shared/wire/types'
import {
  SLASH_COMMAND_TYPE_AHEAD_LABEL,
  SlashCommandTypeAheadPanel,
  slashCommandTypeAheadOptions,
  slashCommandTypeAheadStateFor,
  useSlashCommandTypeAhead
} from './ComposerSlashCommandTypeAhead'

// #940: the type-ahead's mount, proved in the tier that can prove it. vitest.config.ts sets
// `environment: 'node'` and there is no jsdom and no @testing-library, so nothing here can type, arrow or
// press Enter — every transition is e2e/slash-command-type-ahead.spec.ts's. What IS here is everything
// the mount DECIDES: the per-text interaction state, the row → option mapping, and the rendered markup,
// each a total function or a pure view a server render executes directly (the ComposerOptionsPanel.test
// posture).
//
// The container smoke at the foot is the exception and it is deliberate: it is the only place the
// `entry?.commands ?? null` JOIN — this slice's one hazardous line — is executed at all.

const noop = (): void => {}

/** A wire row with every field present, defaults first so an override always wins (the
 *  `Partial<…>`-spread ordering trap: a field's only source must not be the optional spread). */
function command(overrides: Partial<WireSlashCommand> & { name: string }): WireSlashCommand {
  return {
    argument_hint: '',
    description: '',
    aliases: [],
    truncated_fields: null,
    ...overrides
  }
}

const CLEAR = command({ name: 'clear', description: 'Clear conversation history and free up context' })
const MODEL = command({
  name: 'model',
  // Angle brackets on purpose: a hint is workspace-authored too, so this doubles as an escaping probe.
  argument_hint: '<model>',
  description: 'Set the AI model for Claude Code'
})

function renderPanel(
  rows: readonly WireSlashCommand[],
  highlightedIndex: number,
  onPick: (index: number) => void = noop
): string {
  return renderToStaticMarkup(
    <SlashCommandTypeAheadPanel rows={rows} highlightedIndex={highlightedIndex} onPick={onPick} />
  )
}

function countOf(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

describe('slashCommandTypeAheadStateFor', () => {
  const held = { text: '/cl', highlightedIndex: 2, dismissed: true }

  it('hands back the HELD cell, by reference, while the text is unchanged', () => {
    expect(slashCommandTypeAheadStateFor(held, '/cl')).toBe(held)
  })

  it('resets the highlight to the first row when the text changes — the narrowing answer', () => {
    expect(slashCommandTypeAheadStateFor(held, '/cle')).toStrictEqual({
      text: '/cle',
      highlightedIndex: 0,
      dismissed: false
    })
  })

  it('re-opens a dismissed panel on the next edit, and only on an edit', () => {
    // Escape wrote `dismissed` against '/cl', so '/cl' stays closed…
    expect(slashCommandTypeAheadStateFor(held, '/cl').dismissed).toBe(true)
    // …and one more character re-opens it. Deleting back to '/c' does too: any change, either direction.
    expect(slashCommandTypeAheadStateFor(held, '/cla').dismissed).toBe(false)
    expect(slashCommandTypeAheadStateFor(held, '/c').dismissed).toBe(false)
  })
})

describe('slashCommandTypeAheadOptions', () => {
  it('labels a row with its canonical name under a leading slash', () => {
    expect(slashCommandTypeAheadOptions([CLEAR])[0].label).toBe('/clear')
  })

  it('follows the name with the argument hint when there is one, and with nothing when there is not', () => {
    const [clear, model] = slashCommandTypeAheadOptions([CLEAR, MODEL])
    expect(clear.label).toBe('/clear')
    expect(model.label).toBe('/model <model>')
  })

  it('carries the description NOWHERE — the option has exactly an id and a label', () => {
    // #934's decision: a row is the name and its hint. Asserted on the option's whole key set rather than
    // on `description === undefined`, because the point is that no field carries the string onward under
    // any name — this is the last place it could have.
    const options = slashCommandTypeAheadOptions([CLEAR])
    expect(Object.keys(options[0]).sort()).toStrictEqual(['id', 'label'])
  })

  it('identifies a row by its INDEX, never by its name — two rows may share one', () => {
    // A duplicate name is reachable (workspace-authored text, no uniqueness anywhere on the wire), and as
    // a React key it is a collision while as an id it is an ambiguous pick. The index is neither.
    const options = slashCommandTypeAheadOptions([CLEAR, command({ name: 'clear' })])
    expect(options.map((option) => option.id)).toStrictEqual(['0', '1'])
    expect(new Set(options.map((option) => option.id)).size).toBe(2)
  })
})

describe('SlashCommandTypeAheadPanel', () => {
  it('renders NOTHING for an empty row list — the closed state, through the one encoding (AC1)', () => {
    // `[]` is truthy, so the gate has to be `rows.length > 0`. A `rows.length &&` gate renders a bare `0`
    // and a `rows &&` gate renders the whole panel; both are visible here as a non-empty string.
    expect(renderPanel([], 0)).toBe('')
  })

  it('renders one row per command, carrying the name and its hint and NOTHING ELSE (AC2)', () => {
    const markup = renderPanel([CLEAR, MODEL], 0)

    expect(countOf(markup, 'class="composer-options__item')).toBe(2)
    // The label is the button's sole child, exactly as the four footer consumers' rows are — the row
    // markup this ticket leaves behind is byte-for-byte the shipped one.
    expect(markup).toContain('>/clear</button>')
    expect(markup).toContain('>/model &lt;model&gt;</button>')
    // And the description reaches no sink: not as text, not as an attribute, not at all (#934).
    expect(markup).not.toContain('Clear conversation history')
    expect(markup).not.toContain('Set the AI model')
  })

  it('opens on the shared panel surface, named for a type-ahead rather than a menu', () => {
    expect(renderPanel([CLEAR], 0)).toContain(
      `<div class="composer-options" role="menu" aria-label="${SLASH_COMMAND_TYPE_AHEAD_LABEL}">`
    )
  })

  it('marks the highlighted row alone, through the shipped current-row branch (AC3)', () => {
    const markup = renderPanel([CLEAR, MODEL], 1)

    expect(countOf(markup, 'aria-current="true"')).toBe(1)
    expect(countOf(markup, 'composer-options__item--current')).toBe(1)
    // The marked row is the SECOND one — the modifier and the label travel together.
    expect(markup).toMatch(/composer-options__item--current"[^>]*>\/model/)
  })

  it('keeps every row out of the tab order — focus never leaves the message box', () => {
    const markup = renderPanel([CLEAR, MODEL], 0)

    expect(countOf(markup, 'tabindex="-1"')).toBe(2)
    expect(countOf(markup, 'tabindex="0"')).toBe(0)
  })

  it('escapes the workspace-authored text it DOES render — the name and the argument hint', () => {
    // Both fields ride in one label, and both are written by whoever wrote the repository claude runs in.
    const hostile = command({
      name: '<img src=x onerror="alert(1)">',
      argument_hint: '<script>alert(2)</script>'
    })
    const markup = renderPanel([hostile], 0)

    expect(markup).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(markup).toContain('&lt;script&gt;')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('<script')
    // A bare not.toContain('src=') would pass vacuously; this matches the `="` only an HTML sink produces.
    expect(markup).not.toMatch(/\son[a-z]+="/i)
    expect(markup).not.toContain('alert(1)"')
  })

  it('lets a workspace-authored DESCRIPTION reach no DOM sink at all (#934)', () => {
    // The stronger property the decision to hide descriptions buys: not "escaped", but absent. Probed with
    // a string that would be visible however it leaked — as text, inside an attribute, or as the newline
    // that is the one sub-0x20 byte measured across the capture's four string fields.
    const hostile = command({
      name: 'memory',
      description: '<img src=x onerror="alert(1)">\nsecond line'
    })
    const markup = renderPanel([hostile], 0)

    expect(markup).toContain('/memory')
    expect(markup).not.toContain('img')
    expect(markup).not.toContain('alert')
    expect(markup).not.toContain('second line')
    expect(markup).not.toContain('\n')
  })
})

// THE MENU IS SEEDED AT THE STORE'S CREATION, and that is not a stylistic choice. Under a server render
// zustand answers `useStore` from `getServerSnapshot`, which it binds to the state captured when the store
// was CREATED — so `setSlashCommandList(…)` followed by `renderToStaticMarkup` renders the INITIAL state
// and every assertion here would pass or fail against an empty map. Only the `useSlashCommandListStore`
// binding is overridden, onto a per-file instance; `selectSlashCommandListFor` stays the real one, which
// is what keeps this a test of the join rather than of a stand-in.
vi.mock('../../store/slashCommandListStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/slashCommandListStore')>()
  const { useStore } = await import('zustand')
  // Built inline rather than from the file's fixtures: a vi.mock factory is hoisted above them.
  const row = (name: string, description: string): WireSlashCommand => ({
    name,
    argument_hint: '',
    description,
    aliases: [],
    truncated_fields: null
  })
  const instance = actual.createSlashCommandListStore({
    menus: new Map([
      // A published menu, an EMPTY published menu, and — by absence — a conversation no frame arrived for.
      ['conv-1', { commands: [row('clear', 'Clear history'), row('model', 'Set the model')], droppedCommands: 0 }],
      ['conv-empty', { commands: [], droppedCommands: 0 }]
    ])
  })
  return {
    ...actual,
    slashCommandListStore: instance,
    useSlashCommandListStore: <T,>(
      selector: (s: import('../../store/slashCommandListStore').SlashCommandListStore) => T
    ): T => useStore(instance, selector)
  }
})

describe('useSlashCommandTypeAhead — the join', () => {
  function Host({
    text,
    conversationId
  }: {
    text: string
    conversationId: string | null
  }): JSX.Element {
    const typeAhead = useSlashCommandTypeAhead({ text, conversationId, onComplete: noop })
    return <div ref={typeAhead.anchorRef}>{typeAhead.panel}</div>
  }

  it('opens on the published list for THIS conversation', () => {
    const markup = renderToStaticMarkup(<Host text="/cl" conversationId="conv-1" />)

    expect(markup).toContain('composer-options')
    expect(markup).toContain('/clear')
    // Filtered, not merely mounted: `/cl` matches one of the two seeded rows.
    expect(markup).not.toContain('/model')
  })

  it('renders nothing when the text is not a slash fragment', () => {
    expect(renderToStaticMarkup(<Host text="hello" conversationId="conv-1" />)).not.toContain(
      'composer-options'
    )
  })

  it('renders nothing for a conversation whose list has not arrived, and for no conversation at all', () => {
    // `null` from the selector is a NORMAL permanent state (best-effort delivery), never an error, and a
    // null conversation id reaches the same answer without an invented key.
    expect(renderToStaticMarkup(<Host text="/cl" conversationId="conv-2" />)).not.toContain(
      'composer-options'
    )
    expect(renderToStaticMarkup(<Host text="/cl" conversationId={null} />)).not.toContain(
      'composer-options'
    )
  })

  it('renders nothing when claude published an empty menu', () => {
    expect(renderToStaticMarkup(<Host text="/" conversationId="conv-empty" />)).not.toContain(
      'composer-options'
    )
  })
})
