import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createRunSettingsWriteStore,
  selectPendingFields,
  type RunSettingsWriteEvent
} from '../../store/runSettingsWriteStore'
import type { ModelListEntry, ModelListState } from '../../store/modelListStore'
import type { WireModelOption } from '@shared/wire/types'
import { RunConfigView, RunConfigSections, changeConnectedSetting } from './RunConfigSections'
import { conversationListStore } from '../../store/conversationListStore'
import { sessionStore, type ConnectionStatus } from '../../store/sessionStore'
import { sessionIdStore } from '../../store/sessionIdStore'
import { runSettingsWriteStore, type SettingsChange } from '../../store/runSettingsWriteStore'

it('rechecks a saved selection against current ownership and status before any optimistic write', () => {
  const previous = [conversationListStore.getState(), sessionStore.getState(), sessionIdStore.getState(), runSettingsWriteStore.getState()] as const
  const sendCommand = vi.fn()
  vi.stubGlobal('window', { pyry: { sendCommand, sendDiagnostic: vi.fn() } })
  const row = { id: 'chat', name: 'Chat', cwd: '/fake', workspace_label: null,
    is_promoted: false, is_archived: false, last_message_ts: '', last_used_at: '', serverId: 'owner' }
  const changes: SettingsChange[] = [
    { field: 'model', value: 'sonnet' }, { field: 'effort', value: 'high' },
    { field: 'permissionMode', value: 'plan' }, { field: 'yolo', value: true }
  ]
  const savedSelections = changes.map(change => () => changeConnectedSetting('chat', change))
  const connected: ConnectionStatus = { type: 'connected', ack: { protocol_version: '1', server_id: 'test-server', conn_id: 'test-connection', capabilities: [] } }
  try {
    sessionIdStore.getState().setSessionId('session')
    conversationListStore.setState({ conversations: [row] })
    for (const status of [undefined, { type: 'connecting' }, { type: 'disconnected' },
      { type: 'error', error: { code: 'transport', message: 'Offline', retryable: true } }] as const) {
      const statuses = new Map<string, ConnectionStatus>([['other', connected]])
      if (status) statuses.set('owner', status)
      sessionStore.setState({ status: connected, statuses })
      for (const select of savedSelections) select()
      expect(sendCommand).not.toHaveBeenCalled()
      expect(runSettingsWriteStore.getState()).toBe(previous[3])
    }
    sessionStore.setState({ statuses: new Map([['owner', connected]]) })
    for (const rows of [[], [{ ...row, serverId: undefined }], [row, { ...row, serverId: 'other' }]]) {
      conversationListStore.setState({ conversations: rows })
      for (const select of savedSelections) select()
      expect(sendCommand).not.toHaveBeenCalled()
      expect(runSettingsWriteStore.getState()).toBe(previous[3])
    }
    conversationListStore.setState({ conversations: [row] })
    savedSelections[0]()
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'setSessionSettings', payload: { session_id: 'session', model: 'sonnet' },
      changeId: expect.any(String)
    })
  } finally {
    conversationListStore.setState(previous[0], true)
    sessionStore.setState(previous[1], true)
    sessionIdStore.setState(previous[2], true)
    runSettingsWriteStore.setState(previous[3], true)
    vi.unstubAllGlobals()
  }
})

// #975: the published rows the sheet now renders. A local builder rather than a shared fixture — the
// six-field row is the wire shape and every test below varies one field of it.
function modelRow(
  overrides: Partial<WireModelOption> & { value: string; display_name: string }
): WireModelOption {
  return {
    resolved_model: '',
    effort_levels: [],
    supports_auto_mode: false,
    truncated_fields: null,
    ...overrides
  }
}

// Display names chosen MUTUALLY NON-SUBSTRING, which is what keeps segmentFor's chunking and the
// 'Current model' count assertions meaningful now that the labels are daemon-authored rather than the
// catalog's. None of them contains 'Current model' or any other client-owned literal this file asserts
// on. The values cover the three measured shapes — a literal, a bracketed variant, a bare alias — and
// deliberately include one that is a SUBSTRING of another row's resolved_model, so a substring matcher
// reintroduced anywhere on this path fails a test rather than passing quietly.
//
// #976: each row also publishes its OWN effort levels, and the three sets are deliberately different
// so one fixture serves all three of the Effort section's readings. Row 0's levels are not
// reasoning-effort levels claude has ever published, which is what makes a surviving hardcoded
// constant fail rather than coincide; row 1 carries the `high`/`xhigh` pair the substring guard needs;
// row 2 publishes NONE, which is the live-measured Haiku shape and AC2's fixture.
const PUBLISHED_ROWS: readonly WireModelOption[] = [
  modelRow({
    value: 'default',
    display_name: 'Recommended pick',
    resolved_model: 'claude-sonnet-5',
    effort_levels: ['brisk', 'thorough']
  }),
  modelRow({
    value: 'opus[1m]',
    display_name: 'Wide context',
    resolved_model: 'claude-opus-5',
    effort_levels: ['high', 'xhigh', 'max']
  }),
  modelRow({
    value: 'haiku',
    display_name: 'Quick tier',
    resolved_model: 'claude-haiku-4-5-20251001',
    effort_levels: []
  })
]

const PUBLISHED: ModelListEntry = { models: PUBLISHED_ROWS, droppedModels: 0 }

// The two non-populated readings the store deliberately keeps apart, as this view receives them.
const NO_FRAME = null
const CLAUDE_OFFERED_NOTHING: ModelListEntry = { models: [], droppedModels: 0 }

const MODELS_UNKNOWN = 'Model list not yet known'
const MODELS_EMPTY = 'No models offered'
const EFFORT_EMPTY = 'No effort levels offered'
const CUT = 'Truncated by the daemon'

// No DOM harness (jsdom/Testing Library) — mirrors LogDataSection.test.tsx. RunConfigView is pure
// (model/effort/yolo + the two usage figures in, markup out), so a server-rendered string proves each
// visible state; the container is exercised only for "server-renders the AC4 default without touching
// window.pyry" (zustand v5's useStore reads getInitialState() = snapshot:null under server render, so
// the populated states are unreachable there and are proven on the pure view instead).

// The Model/Effort/YOLO cases don't exercise the Context window gauge, so they pass the "unavailable"
// usage pair (windowTokens: 0); the Context window block below varies the two figures explicitly.
const NO_USAGE = { usedTokens: 0, windowTokens: 0 } as const

// The run of markup belonging to the sibling element whose class value is `className` and that
// contains `needle`. Sibling elements are delimited by the repeated class token, so this isolates a
// single Model row / Effort segment to assert its own selection marker without cross-row bleed.
function segmentFor(markup: string, className: string, needle: string): string {
  return markup.split(className).find((chunk) => chunk.includes(needle)) ?? ''
}

// The OPENING TAG of the element whose class list STARTS with `className` — so one element's own
// attributes can be asserted without a descendant's bleeding in. The class token must be followed by a
// quote or a space, which is what keeps `run-config__switch` from matching `run-config__switch-knob`
// and `run-config__effort` from matching `run-config__effort-segment`, while still matching the
// two-token `run-config__switch run-config__switch--on`.
function tagWithClass(markup: string, className: string): string {
  return markup.match(new RegExp(`<[a-z]+ class="${className}( [^"]*)?"[^>]*>`))?.[0] ?? ''
}

// True when the element opened by `openTag` is CLOSED BEFORE `needle` appears — i.e. `needle` is a
// sibling, not a descendant. Every element between the section wrappers and the rejection line is a
// <div>, so counting opens against closes over the run between them is exact: balanced ⇒ the wrapper
// returned to depth 0 before the needle.
function closedBefore(markup: string, openTag: string, needle: string): boolean {
  const from = markup.indexOf(openTag)
  const to = markup.indexOf(needle)
  if (from < 0 || to <= from) return false
  const run = markup.slice(from, to)
  return (run.match(/<div/g)?.length ?? 0) === (run.match(/<\/div>/g)?.length ?? 0)
}

// #975: the rows ARE the published entries. The catalog, its family tokens, its hand-written
// descriptors and the matchedFamily substring matcher are gone, so every assertion here is a claim
// about daemon data reaching a pixel unchanged rather than about client-owned content.
describe('RunConfigView — Model rows from the published list (#975)', () => {
  const base = { model: '', effort: '', yolo: false, ...NO_USAGE } as const

  it('renders one row per published entry, in the daemon order, labelled with display_name (AC1)', () => {
    const markup = renderToStaticMarkup(<RunConfigView {...base} models={PUBLISHED} />)
    expect(markup.match(/run-config__model-row/g)?.length).toBe(3)
    // Published ORDER, not merely presence: the three labels appear in the order the frame carried.
    const positions = PUBLISHED_ROWS.map((row) => markup.indexOf(row.display_name))
    expect(positions.every((at) => at >= 0)).toBe(true)
    expect([...positions]).toEqual([...positions].sort((a, b) => a - b))
    // Exactly as many name elements as published entries — the guard that no client-owned row survives
    // alongside them. Stated as a count rather than as a list of the deleted labels, so this file keeps
    // no model name of its own either.
    expect(markup.match(/run-config__model-name/g)?.length).toBe(PUBLISHED_ROWS.length)
  })

  it('marks the row whose value is EXACTLY the current model, and only that row (AC2)', () => {
    for (const row of PUBLISHED_ROWS) {
      const markup = renderToStaticMarkup(<RunConfigView {...base} model={row.value} models={PUBLISHED} />)
      expect(segmentFor(markup, 'run-config__model-row', row.display_name)).toContain('Current model')
      expect(markup.match(/Current model/g)?.length).toBe(1)
    }
  })

  it('round-trips: the value a row submits re-selects that same row (AC2/AC3)', () => {
    // The `node` environment cannot fire the click, so the round-trip is proven by construction: the
    // row hands onSelect its own `value`, and rendering with that same string back as the effective
    // model — which is what the optimistic overlay holds — must mark the row it came from.
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} models={PUBLISHED} onChange={(): void => undefined} />
    )
    expect(markup).toContain('role="button"')
    for (const row of PUBLISHED_ROWS) {
      const reselected = renderToStaticMarkup(
        <RunConfigView {...base} model={row.value} models={PUBLISHED} />
      )
      expect(segmentFor(reselected, 'run-config__model-row', row.display_name)).toContain('Current model')
    }
  })

  it('matches by equality ONLY — no substring, prefix or case fold anywhere (AC2)', () => {
    // Each vector is a near miss of the 'haiku' row: its own resolved_model (a superstring), a padded
    // and a case-folded form, a prefix, and a bare unrelated string. Any of the matchers this slice
    // deletes would mark a row for at least one of them.
    for (const model of [
      'claude-haiku-4-5-20251001',
      'HAIKU',
      ' haiku',
      'haik',
      'haiku-plus',
      'opus',
      'some-unknown-model',
      ''
    ]) {
      const markup = renderToStaticMarkup(<RunConfigView {...base} model={model} models={PUBLISHED} />)
      expect(markup).not.toContain('Current model')
    }
  })

  it('shows the concrete identifier the value resolves to on the second line (AC4)', () => {
    const markup = renderToStaticMarkup(<RunConfigView {...base} models={PUBLISHED} />)
    for (const row of PUBLISHED_ROWS) {
      expect(markup).toContain(`<p class="run-config__model-descriptor">${row.resolved_model}</p>`)
    }
  })

  it('renders an unresolved (empty) identifier as a present, empty line rather than none', () => {
    const models: ModelListEntry = {
      models: [modelRow({ value: 'default', display_name: 'Recommended pick' })],
      droppedModels: 0
    }
    const markup = renderToStaticMarkup(<RunConfigView {...base} models={models} />)
    expect(markup).toContain('<p class="run-config__model-descriptor"></p>')
  })

  it('keeps rows operable on handler presence, inert without one (AC5)', () => {
    const operable = renderToStaticMarkup(
      <RunConfigView {...base} models={PUBLISHED} onChange={(): void => undefined} />
    )
    const row = segmentFor(operable, 'run-config__model-row', 'Wide context')
    expect(row).toContain('role="button"')
    expect(row).toContain('tabindex="0"')
    const inert = segmentFor(
      renderToStaticMarkup(<RunConfigView {...base} models={PUBLISHED} />),
      'run-config__model-row',
      'Wide context'
    )
    expect(inert).not.toContain('role="button"')
    expect(inert).not.toContain('tabindex')
  })
})

// #975 AC5: the store's two non-populated readings are DIFFERENT SENTENCES here, not one shared empty
// state — collapsing them would erase the distinction one layer above where the store established it.
describe('RunConfigView — Model, the two non-populated readings (#975)', () => {
  const base = { model: '', effort: '', yolo: false, ...NO_USAGE } as const

  it('reads not-yet-known when no frame has arrived, for null and for an omitted prop', () => {
    for (const markup of [
      renderToStaticMarkup(<RunConfigView {...base} models={NO_FRAME} />),
      renderToStaticMarkup(<RunConfigView {...base} />)
    ]) {
      expect(markup).toContain(MODELS_UNKNOWN)
      expect(markup).not.toContain(MODELS_EMPTY)
      // No empty control and no stale menu: not one row element renders.
      expect(markup).not.toContain('run-config__model-row')
      expect(markup).not.toContain('Current model')
    }
  })

  it('renders byte-identical markup for an explicit null and an omitted prop', () => {
    expect(renderToStaticMarkup(<RunConfigView {...base} models={NO_FRAME} />)).toBe(
      renderToStaticMarkup(<RunConfigView {...base} />)
    )
  })

  it('states positively that claude offered nothing for a published empty list', () => {
    const markup = renderToStaticMarkup(<RunConfigView {...base} models={CLAUDE_OFFERED_NOTHING} />)
    expect(markup).toContain(MODELS_EMPTY)
    expect(markup).not.toContain(MODELS_UNKNOWN)
    expect(markup).not.toContain('run-config__model-row')
  })

  it('keeps the two readings distinguishable — different copy AND different elements', () => {
    const unknown = renderToStaticMarkup(<RunConfigView {...base} models={NO_FRAME} />)
    const empty = renderToStaticMarkup(<RunConfigView {...base} models={CLAUDE_OFFERED_NOTHING} />)
    expect(unknown).not.toBe(empty)
    expect(unknown).toContain('run-config__model-unknown')
    expect(unknown).not.toContain('run-config__model-empty')
    expect(empty).toContain('run-config__model-empty')
    expect(empty).not.toContain('run-config__model-unknown')
  })
})

// #975 AC6: the frame carries TWO truncation reports and neither may be collapsed into the other. A
// sheet surfacing one and dropping the other presents a cut list as complete.
describe('RunConfigView — Model truncation reports (#975)', () => {
  const base = { model: '', effort: '', yolo: false, ...NO_USAGE } as const
  const cutRow = modelRow({
    value: 'claude-fable-5',
    display_name: 'Cut label',
    resolved_model: 'claude-fable-5-x',
    truncated_fields: ['value']
  })
  const cleanRow = modelRow({ value: 'haiku', display_name: 'Quick tier' })

  it('marks a row the daemon reports cut, in its own sibling element (AC6)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} models={{ models: [cutRow], droppedModels: 0 }} />
    )
    // Adjacent siblings: the daemon-supplied descriptor CLOSES before the sheet's own words open, so
    // client copy is never inside a daemon-authored node.
    expect(markup).toContain(
      `<p class="run-config__model-descriptor">${cutRow.resolved_model}</p>` +
        `<p class="run-config__model-cut">${CUT}</p>`
    )
  })

  it('marks no row when nothing was cut — null and [] say the same thing (AC6)', () => {
    for (const truncated_fields of [null, []]) {
      const markup = renderToStaticMarkup(
        <RunConfigView
          {...base}
          models={{ models: [modelRow({ ...cleanRow, truncated_fields })], droppedModels: 0 }}
        />
      )
      expect(markup).not.toContain('run-config__model-cut')
      expect(markup).not.toContain(CUT)
    }
  })

  it('marks only the cut row, never the whole list (AC6)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} models={{ models: [cutRow, cleanRow], droppedModels: 0 }} />
    )
    expect(markup.match(/run-config__model-cut/g)?.length).toBe(1)
    expect(segmentFor(markup, 'run-config__model-row', 'Quick tier')).not.toContain(CUT)
  })

  it('cannot have a cut claim forged by a label ending in the same words (AC6)', () => {
    const forged = modelRow({ value: 'x', display_name: `Sneaky ${CUT}` })
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} models={{ models: [forged], droppedModels: 0 }} />
    )
    // The words appear inside the daemon's own node, verbatim — but the sheet's marker ELEMENT does
    // not exist. Structural on purpose: not.toContain(CUT) would fail on a CORRECT render here.
    expect(markup).toContain(`<p class="run-config__model-name">${forged.display_name}</p>`)
    expect(markup).not.toContain('run-config__model-cut')
  })

  it('says the list is incomplete when the frame reports rows dropped wholesale (AC6)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} models={{ models: [cleanRow], droppedModels: 2 }} />
    )
    expect(markup).toContain('run-config__model-partial')
    expect(markup).toContain('2 not shown')
  })

  it('reports drops on the offered-nothing branch too — the count belongs to the entry (AC6)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} models={{ models: [], droppedModels: 3 }} />
    )
    expect(markup).toContain('3 not shown')
    expect(markup).toContain(MODELS_EMPTY)
  })

  it('reports nothing — and prints no bare zero — when droppedModels is 0 (AC6)', () => {
    const markup = renderToStaticMarkup(<RunConfigView {...base} models={PUBLISHED} />)
    expect(markup).not.toContain('run-config__model-partial')
    expect(markup).not.toContain('not shown')
    // `{entry.droppedModels && …}` would render the number 0 as a text node.
    expect(markup).not.toMatch(/>0</)
  })

  it('surfaces BOTH reports at once — neither collapses into the other (AC6)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} models={{ models: [cutRow, cleanRow], droppedModels: 4 }} />
    )
    expect(markup).toContain('4 not shown')
    expect(markup).toContain('run-config__model-cut')
  })
})

// #975: every row string is claude-authored text that crossed the subprocess trust boundary. The
// daemon bounds it and does not sanitize it, so this file is the render boundary that owes the
// escaping.
describe('RunConfigView — Model rows render daemon text inertly (#975)', () => {
  const base = { model: '', effort: '', yolo: false, ...NO_USAGE } as const

  it('escapes hostile row text into text nodes and forges no attribute or URL', () => {
    for (const hostile of [
      '<img src=x onerror="alert(1)">',
      'javascript:alert(1)',
      '" onmouseover="x',
      '[31mred',
      '__proto__'
    ]) {
      const markup = renderToStaticMarkup(
        <RunConfigView
          {...base}
          models={{
            models: [modelRow({ value: hostile, display_name: hostile, resolved_model: hostile })],
            droppedModels: 0
          }}
        />
      )
      // Attribute-shaped guards, NEVER not.toContain('onerror=') — that substring survives a CORRECT
      // render, since React escapes markup metacharacters rather than arbitrary text.
      expect(markup).not.toContain('<img')
      expect(markup).not.toContain('src="')
      expect(markup).not.toContain('href="')
      expect(markup).not.toMatch(/\son[a-z]+="/)
    }
  })

  it('escapes markup metacharacters into the name and descriptor elements', () => {
    const hostile = '<img src=x onerror="alert(1)">'
    const escaped = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
    const markup = renderToStaticMarkup(
      <RunConfigView
        {...base}
        models={{
          models: [modelRow({ value: 'v', display_name: hostile, resolved_model: hostile })],
          droppedModels: 0
        }}
      />
    )
    expect(markup).toContain(`<p class="run-config__model-name">${escaped}</p>`)
    expect(markup).toContain(`<p class="run-config__model-descriptor">${escaped}</p>`)
  })

  it('puts no daemon string in a key, an attribute or any other non-text position', () => {
    // The row's whole opening tag carries only client-owned attributes; the daemon's strings appear
    // exclusively as element CHILDREN. React never serialises `key`, so a display_name key would be
    // invisible here — the positive guard is that the tag holds nothing daemon-authored at all.
    const markup = renderToStaticMarkup(
      <RunConfigView
        {...base}
        models={{
          models: [modelRow({ value: 'sentinel-value', display_name: 'sentinel-name' })],
          droppedModels: 0
        }}
        onChange={(): void => undefined}
      />
    )
    const tag = tagWithClass(markup, 'run-config__model-row')
    expect(tag).not.toContain('sentinel-value')
    expect(tag).not.toContain('sentinel-name')
  })
})

// #976: the segments ARE the selected model's published levels. EFFORT_LEVELS — the hardcoded five —
// is gone, so every assertion here is a claim about daemon data reaching a pixel unchanged. The row is
// resolved from the SESSION's model by exact equality on `value`, the same rule the Model section marks
// a row selected by, and there is no fallback anywhere: an unmatched model offers NOTHING rather than
// the old five, which is the single failure AC3 exists to forbid.
describe('RunConfigView — Effort segments from the published levels (#976)', () => {
  const base = { model: '', effort: '', yolo: false, ...NO_USAGE } as const
  // The row with the richest set, and the one carrying the high/xhigh pair.
  const WIDE = PUBLISHED_ROWS[1]
  const OFFERS_NONE = PUBLISHED_ROWS[2]
  const entryFor = (row: WireModelOption): ModelListEntry => ({ models: [row], droppedModels: 0 })
  const cutRow = (levels: string[]): WireModelOption =>
    modelRow({
      value: 'cut',
      display_name: 'Cut row',
      effort_levels: levels,
      truncated_fields: ['effort_levels']
    })

  it('renders one segment per published level of the selected row, in published order (AC1)', () => {
    for (const row of [PUBLISHED_ROWS[0], WIDE]) {
      const markup = renderToStaticMarkup(
        <RunConfigView {...base} model={row.value} models={PUBLISHED} />
      )
      // A COUNT, never a list of the five deleted literals: stating it as a list would re-type the
      // banned vocabulary into the very file that polices its removal.
      expect(markup.match(/run-config__effort-segment/g)?.length).toBe(row.effort_levels.length)
      const positions = row.effort_levels.map((level) => markup.indexOf(`>${level}<`))
      expect(positions.every((at) => at >= 0)).toBe(true)
      expect([...positions]).toEqual([...positions].sort((a, b) => a - b))
    }
  })

  it('follows the SELECTED model — a different row offers a different set (AC1)', () => {
    const first = renderToStaticMarkup(
      <RunConfigView {...base} model={PUBLISHED_ROWS[0].value} models={PUBLISHED} />
    )
    const second = renderToStaticMarkup(<RunConfigView {...base} model={WIDE.value} models={PUBLISHED} />)
    expect(first).toContain(`>${PUBLISHED_ROWS[0].effort_levels[0]}<`)
    expect(first).not.toContain(`>${WIDE.effort_levels[0]}<`)
    expect(second).toContain(`>${WIDE.effort_levels[0]}<`)
    expect(second).not.toContain(`>${PUBLISHED_ROWS[0].effort_levels[0]}<`)
  })

  it('marks the level EXACTLY equal to the session effort, and only that one (AC4)', () => {
    for (const level of WIDE.effort_levels) {
      const markup = renderToStaticMarkup(
        <RunConfigView {...base} model={WIDE.value} effort={level} models={PUBLISHED} />
      )
      expect(segmentFor(markup, 'run-config__effort-segment', `>${level}<`)).toContain(
        'aria-current="true"'
      )
      expect(markup.match(/aria-current="true"/g)?.length).toBe(1)
    }
  })

  it('marks nothing for the empty effort or a level this row does not publish (AC4)', () => {
    for (const effort of ['', 'medium']) {
      const markup = renderToStaticMarkup(
        <RunConfigView {...base} model={WIDE.value} effort={effort} models={PUBLISHED} />
      )
      expect(markup).not.toContain('aria-current')
    }
  })

  it('does not mark `high` when the session effort is `xhigh` (the substring guard, AC4)', () => {
    // The assertion that fails if a substring, prefix or case-folding matcher is ever introduced on
    // this path — `high` is a substring of `xhigh` and the row publishes both.
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} model={WIDE.value} effort="xhigh" models={PUBLISHED} />
    )
    expect(segmentFor(markup, 'run-config__effort-segment', '>high<')).not.toContain('aria-current')
    expect(segmentFor(markup, 'run-config__effort-segment', '>xhigh<')).toContain('aria-current="true"')
    expect(markup.match(/aria-current="true"/g)?.length).toBe(1)
  })

  it('offers no segment and shows the current effort as text until a row is matched (AC3)', () => {
    // Three ways in and ONE rendering: no prop, the null reading, and a list whose rows the session
    // model matches none of. The client has been told no level is accepted in every case.
    const cases = [{}, { models: NO_FRAME }, { models: PUBLISHED }]
    for (const extra of cases) {
      const markup = renderToStaticMarkup(
        <RunConfigView {...base} model="matches-no-published-row" effort="high" {...extra} />
      )
      expect(markup).not.toContain('run-config__effort-segment')
      expect(markup).toContain('class="run-config__effort-current">high<')
      // Not the model-offers-none sentence: the sheet has not been told this model offers none.
      expect(markup).not.toContain(EFFORT_EMPTY)
    }
  })

  it('says the model offers none when it publishes an empty list with nothing cut (AC2)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} model={OFFERS_NONE.value} effort="high" models={PUBLISHED} />
    )
    expect(markup).toContain(EFFORT_EMPTY)
    // No segments, no disabled strip, and not AC3's line either — this is a positive statement about
    // the model rather than an absence of information.
    expect(markup).not.toContain('run-config__effort-segment')
    expect(markup).not.toContain('run-config__effort-current')
  })

  it('reads an empty list beside a reported cut as UNKNOWN, never as none (AC2/AC3)', () => {
    // The wire contract's MUST: a `truncated_fields` naming `effort_levels` is the ONLY signal
    // separating "cut to nothing" from "this model exposes no effort control", because absent, null
    // and empty all arrive as the same `[]`. Read as *none*, a cut list silently removes an effort
    // control the model actually supports.
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} model="cut" effort="high" models={entryFor(cutRow([]))} />
    )
    expect(markup).not.toContain(EFFORT_EMPTY)
    expect(markup).toContain('class="run-config__effort-current">high<')
    expect(markup).not.toContain('run-config__effort-segment')
    expect(markup).toContain(`class="run-config__effort-cut">${CUT}<`)
  })

  it('still offers a shortened list, marked cut rather than presented as complete', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} model="cut" effort="high" models={entryFor(cutRow(['high']))} />
    )
    expect(markup.match(/run-config__effort-segment/g)?.length).toBe(1)
    expect(markup).toContain(`class="run-config__effort-cut">${CUT}<`)
  })

  it('reads the cut report PER FIELD — another field named leaves the offers-none reading (AC2)', () => {
    const row = modelRow({
      value: 'cut',
      display_name: 'Cut row',
      effort_levels: [],
      truncated_fields: ['display_name']
    })
    const markup = renderToStaticMarkup(<RunConfigView {...base} model="cut" models={entryFor(row)} />)
    expect(markup).toContain(EFFORT_EMPTY)
    expect(markup).not.toContain('run-config__effort-cut')
  })

  it('renders hostile level text as inert escaped text', () => {
    const row = modelRow({
      value: 'hostile',
      display_name: 'Hostile row',
      effort_levels: ['<img src=x onerror="alert(1)">']
    })
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} model="hostile" models={entryFor(row)} onChange={(): void => undefined} />
    )
    // Attribute-SHAPED guards. `not.toContain('onerror=')` would pass vacuously: an escaped render
    // keeps every character of the string and only the delimiters change.
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('src="')
    expect(markup).not.toContain('href="')
    expect(markup).not.toMatch(/\son[a-z]+="/)
  })

  it('puts no published level in a key, an attribute or any other non-text position', () => {
    // React never serialises `key`, so a level-keyed list would be invisible here — the positive guard
    // is that the segment's whole opening tag holds nothing daemon-authored at all.
    const row = modelRow({
      value: 'sentinel-model',
      display_name: 'Sentinel row',
      effort_levels: ['sentinel-level']
    })
    const markup = renderToStaticMarkup(
      <RunConfigView
        {...base}
        model="sentinel-model"
        models={entryFor(row)}
        onChange={(): void => undefined}
      />
    )
    expect(tagWithClass(markup, 'run-config__effort-segment')).not.toContain('sentinel-level')
    expect(markup).toContain('>sentinel-level<')
  })

  it('marks the group in EVERY reading, never a segment, with the alert still a sibling', () => {
    // An effort change can be in flight when the section has nothing to offer — the operator picks a
    // level, then a model_list frame or a model change empties the levels — so a pending effort stays
    // marked in all three readings, and the rejection line stays OUTSIDE the busy wrapper in each.
    const cases = [
      { model: WIDE.value, models: PUBLISHED },
      { model: OFFERS_NONE.value, models: PUBLISHED },
      { model: 'matches-no-published-row', models: PUBLISHED }
    ]
    for (const each of cases) {
      const markup = renderToStaticMarkup(
        <RunConfigView
          {...base}
          {...each}
          errorField="effort"
          pending={{ model: false, effort: true, yolo: false, permissionMode: false }}
        />
      )
      const wrapper = tagWithClass(markup, 'run-config__effort')
      expect(wrapper).toContain('aria-busy="true"')
      expect(tagWithClass(markup, 'run-config__effort-segment')).not.toContain('aria-busy')
      expect(markup).toContain('role="alert"')
      expect(closedBefore(markup, wrapper, 'role="alert"')).toBe(true)
    }
  })

  it('makes a segment operable only when a handler is present', () => {
    const operable = renderToStaticMarkup(
      <RunConfigView
        {...base}
        model={WIDE.value}
        models={PUBLISHED}
        onChange={(): void => undefined}
      />
    )
    const segment = tagWithClass(operable, 'run-config__effort-segment')
    expect(segment).toContain('role="button"')
    expect(segment).toContain('tabindex="0"')
    const inert = renderToStaticMarkup(<RunConfigView {...base} model={WIDE.value} models={PUBLISHED} />)
    expect(tagWithClass(inert, 'run-config__effort-segment')).not.toContain('role="button"')
  })
})

// #1168: the SESSION MODEL '' case, which the wire contract calls the inherited daemon default and
// explicitly NOT absent, and which the daemon publishes as an ordinary row valued `default`. Before this
// slice `''` matched no row, so an unconfigured session took the UNKNOWN arm permanently — the common
// case, measured live, and a false statement besides, since the model that chat runs at does publish
// levels. The JOIN re-points and nothing else does: every reading asserted below is one this section
// could already produce, reached with a different input.
describe('RunConfigView — Effort on an inherited-default session (#1168)', () => {
  const base = { model: '', effort: '', yolo: false, ...NO_USAGE } as const
  // PUBLISHED_ROWS[0] IS the inherited-default row, seeded as `default` before this slice existed, which
  // is why this file needs no new list fixture for the AC1 case.
  const INHERITED_DEFAULT = PUBLISHED_ROWS[0]
  const NOT_DEFAULT = PUBLISHED_ROWS[1]
  const entryFor = (row: WireModelOption): ModelListEntry => ({ models: [row], droppedModels: 0 })
  // The row value is TYPED here rather than imported from the module. The constant is deliberately
  // module-private, so changing it must fail a test rather than be followed silently by one.
  const defaultRow = (over: Partial<WireModelOption>): WireModelOption =>
    modelRow({ value: 'default', display_name: 'Inherited default', ...over })

  it('offers the inherited-default row levels, in published order, marking the effort (AC1)', () => {
    const level = INHERITED_DEFAULT.effort_levels[0]
    const markup = renderToStaticMarkup(<RunConfigView {...base} effort={level} models={PUBLISHED} />)
    expect(markup.match(/run-config__effort-segment/g)?.length).toBe(
      INHERITED_DEFAULT.effort_levels.length
    )
    const positions = INHERITED_DEFAULT.effort_levels.map((each) => markup.indexOf(`>${each}<`))
    expect(positions.every((at) => at >= 0)).toBe(true)
    expect([...positions]).toEqual([...positions].sort((a, b) => a - b))
    expect(segmentFor(markup, 'run-config__effort-segment', `>${level}<`)).toContain(
      'aria-current="true"'
    )
    expect(markup.match(/aria-current="true"/g)?.length).toBe(1)
    // The UNKNOWN arm is GONE rather than joined — the two are alternatives of one branch, and a menu
    // beside a dead label would be the invented arm AC2 forbids.
    expect(markup).not.toContain('run-config__effort-current')
  })

  it('offers THAT row and never a neighbouring one (AC1)', () => {
    const markup = renderToStaticMarkup(<RunConfigView {...base} models={PUBLISHED} />)
    expect(markup).toContain(`>${INHERITED_DEFAULT.effort_levels[0]}<`)
    expect(markup).not.toContain(`>${NOT_DEFAULT.effort_levels[0]}<`)
  })

  it('moves to the offers-none sentence when that row publishes no levels (AC2)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} effort="high" models={entryFor(defaultRow({ effort_levels: [] }))} />
    )
    expect(markup).toContain(EFFORT_EMPTY)
    expect(markup).not.toContain('run-config__effort-segment')
    expect(markup).not.toContain('run-config__effort-current')
  })

  it('reads a cut level list on that row as UNKNOWN, with the shipped cut marker (AC2)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView
        {...base}
        effort="high"
        models={entryFor(defaultRow({ effort_levels: [], truncated_fields: ['effort_levels'] }))}
      />
    )
    expect(markup).not.toContain(EFFORT_EMPTY)
    expect(markup).toContain('class="run-config__effort-current">high<')
    expect(markup).not.toContain('run-config__effort-segment')
    expect(markup).toContain(`class="run-config__effort-cut">${CUT}<`)
  })

  it('still offers a shortened list on that row, marked cut rather than complete (AC2)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView
        {...base}
        effort="high"
        models={entryFor(defaultRow({ effort_levels: ['high'], truncated_fields: ['effort_levels'] }))}
      />
    )
    expect(markup.match(/run-config__effort-segment/g)?.length).toBe(1)
    expect(markup).toContain(`class="run-config__effort-cut">${CUT}<`)
  })

  // AC3's first half. THREE ways to have no inherited-default row and ONE rendering — today's. The third
  // case is the one that fails if the empty model ever falls back to some other published row rather
  // than to the one constant: that list publishes three levels and must still offer none.
  it('draws exactly today rendering with no inherited-default row published (AC3)', () => {
    for (const extra of [{}, { models: NO_FRAME }, { models: entryFor(NOT_DEFAULT) }]) {
      const markup = renderToStaticMarkup(<RunConfigView {...base} effort="high" {...extra} />)
      expect(markup).not.toContain('run-config__effort-segment')
      expect(markup).toContain('class="run-config__effort-current">high<')
      expect(markup).not.toContain(EFFORT_EMPTY)
    }
  })

  // AC3's second half: the empty model is the ONLY input taking the new branch. A trim, case fold,
  // prefix or substring introduced anywhere on this path fails here rather than passing quietly.
  it.each([' ', '  ', 'DEFAULT', 'Default', 'defaul', 'default-x', ' default', 'default '])(
    'takes the new branch for the empty model alone, never for %j (AC3)',
    (model) => {
      const markup = renderToStaticMarkup(
        <RunConfigView {...base} model={model} effort="high" models={PUBLISHED} />
      )
      expect(markup).not.toContain('run-config__effort-segment')
      expect(markup).toContain('class="run-config__effort-current">high<')
    }
  )

  // AC4, and the sharpest guard in the file: the running-model line joins what claude ANNOUNCED, a
  // different string answering a different question. An announcement of '' is a real one the daemon
  // emitted and renders verbatim as a present, empty line. Were the empty-model branch put inside
  // publishedRowFor, this line would start printing the inherited-default row's display name.
  it('leaves the running-model line joining the announced identifier (AC4)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} announced={{ model: '', truncated: false }} models={PUBLISHED} />
    )
    expect(markup).toContain('<p class="run-config__running-value"></p>')
    // Scoped to the running-value ELEMENT: that display name legitimately renders in its own Model row,
    // so a bare not.toContain would fail on a correct render.
    expect(markup).not.toContain(`run-config__running-value">${INHERITED_DEFAULT.display_name}`)
  })

  // AC4: the Model rows mark by the SESSION's model through the unchanged helper, so an unconfigured
  // session still marks nothing — the sheet does not start claiming a model was picked.
  it('leaves the Model rows marking nothing on an inherited-default session (AC4)', () => {
    const markup = renderToStaticMarkup(<RunConfigView {...base} models={PUBLISHED} />)
    expect(markup).not.toContain('Current model')
  })
})

describe('RunConfigView — YOLO', () => {
  it('reflects yolo:true as an on switch (aria-checked="true")', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="" effort="" yolo={true} {...NO_USAGE} />)
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-checked="true"')
    // Read-only: the switch advertises it does not accept input.
    expect(markup).toContain('aria-readonly="true"')
  })

  it('reflects yolo:false as an off switch (aria-checked="false")', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="" effort="" yolo={false} {...NO_USAGE} />)
    expect(markup).toContain('aria-checked="false"')
  })

  it('renders the row title and caption in both states', () => {
    for (const yolo of [true, false]) {
      const markup = renderToStaticMarkup(<RunConfigView model="" effort="" yolo={yolo} {...NO_USAGE} />)
      expect(markup).toContain('Auto-accept tool calls')
      expect(markup).toContain('Claude runs commands without asking for confirmation. Use carefully.')
    }
  })
})

describe('RunConfigView — Context window', () => {
  // The four other sections are exercised above; these props supply a neutral base so each case
  // varies only the two usage figures.
  const base = { model: '', effort: '', yolo: false }

  it('renders the usage line, a progressbar, and a proportional fill when window > 0', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} usedTokens={146000} windowTokens={200000} />
    )
    expect(markup).toContain('73% used (146K of 200K tokens)')
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('aria-valuenow="73"')
    // renderToStaticMarkup serializes the inline fill width as style="width:73%".
    expect(markup).toContain('width:73%')
  })

  it('reflects a newer, smaller snapshot after a compaction (AC4)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} usedTokens={20000} windowTokens={200000} />
    )
    expect(markup).toContain('10% used (20K of 200K tokens)')
    expect(markup).toContain('width:10%')
  })

  it('rounds the percentage to the nearest integer', () => {
    // 45000 / 200000 = 22.5% → rounds to 23%.
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} usedTokens={45000} windowTokens={200000} />
    )
    expect(markup).toContain('23% used (45K of 200K tokens)')
  })

  it('shows a raw count under 1000 tokens (no "K" abbreviation)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} usedTokens={500} windowTokens={200000} />
    )
    expect(markup).toContain('0% used (500 of 200K tokens)')
  })

  it('clamps an over-full session to 100% so the bar never overflows its track (AC5)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} usedTokens={210000} windowTokens={200000} />
    )
    expect(markup).toContain('100% used')
    expect(markup).toContain('width:100%')
  })

  it('shows an unavailable state — never a broken bar/NaN/divide-by-zero — when window is 0 (AC5)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} usedTokens={146000} windowTokens={0} />
    )
    expect(markup).not.toContain('% used')
    expect(markup).not.toContain('role="progressbar"')
    expect(markup).not.toContain('NaN')
    expect(markup).not.toContain('undefined')
    expect(markup).not.toContain('Infinity')
    expect(markup).toContain('Context usage unavailable')
  })

  it('always renders the header and the verbatim explainer, available or not (Figma 20:155)', () => {
    for (const windowTokens of [0, 200000]) {
      const markup = renderToStaticMarkup(
        <RunConfigView {...base} usedTokens={146000} windowTokens={windowTokens} />
      )
      expect(markup).toContain('Context window')
      // renderToStaticMarkup escapes the apostrophe in "claude's" to &#x27; in the serialized markup.
      expect(markup).toContain(
        'When full, oldest messages get dropped from claude&#x27;s view ' +
          '(delimiter still shows; old messages stay in your scroll).'
      )
    }
  })
})

// #257: the interactive toggle — the SAME view is inert (#188's read-only markup) with no `onChange`
// and operable with one. The `node` env cannot fire clicks, so these assert the operable AFFORDANCE in
// the markup (role/tabindex, dropped aria-readonly); the click → submit behaviour is covered by
// runSettingsControls.test.ts. Selection markers must still reflect the passed values either way.
describe('RunConfigView — interactive toggle (#257)', () => {
  const noop = (): void => undefined

  it('makes rows/segments/switch operable when onChange is present (AC1/2/3)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView
        model="opus[1m]"
        effort="high"
        yolo={false}
        {...NO_USAGE}
        models={PUBLISHED}
        onChange={noop}
      />
    )
    // Model rows and effort segments gain the operable affordance.
    expect(markup).toContain('role="button"')
    expect(markup).toContain('tabindex="0"')
    // The YOLO switch drops aria-readonly and becomes operable (AC3).
    expect(markup).toContain('role="switch"')
    expect(markup).not.toContain('aria-readonly')
    // Selection still reflects the passed values exactly as #188. #976: the model is the row that
    // publishes `high`, because a segment exists only when the selected row published it.
    expect(segmentFor(markup, 'run-config__model-row', 'Wide context')).toContain('Current model')
    expect(segmentFor(markup, 'run-config__effort-segment', '>high<')).toContain('aria-current="true"')
  })

  it('stays inert (identical to #188) when onChange is absent (AC5)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView model="opus[1m]" effort="high" yolo={true} {...NO_USAGE} models={PUBLISHED} />
    )
    // No handler ⇒ literally today's read-only markup: no operable affordance, switch reads-only.
    expect(markup).not.toContain('role="button"')
    expect(markup).not.toContain('tabindex')
    expect(markup).toContain('aria-readonly="true"')
    // Selection markers unchanged.
    expect(segmentFor(markup, 'run-config__model-row', 'Wide context')).toContain('Current model')
    expect(markup).toContain('aria-checked="true"')
  })
})

// #257: the AC4 error surface — a rejected change surfaces a field-scoped role="alert" line whose copy
// is derived from the field (#269 strips the daemon message). At most one section shows an error at a
// time (the store holds one `error` field). Design-doc-sourced: there is no Figma error frame.
describe('RunConfigView — error surface (#257 AC4)', () => {
  const base = { model: '', effort: '', yolo: false, ...NO_USAGE } as const

  it('renders the field-scoped alert for the rejected field only', () => {
    const cases: Array<[NonNullable<Parameters<typeof RunConfigView>[0]['errorField']>, string, string[]]> =
      [
        ['model', 'Could not change the model', ['Could not change the effort', 'Could not change auto-accept']],
        ['effort', 'Could not change the effort', ['Could not change the model', 'Could not change auto-accept']],
        ['yolo', 'Could not change auto-accept', ['Could not change the model', 'Could not change the effort']]
      ]
    for (const [field, expected, absent] of cases) {
      const markup = renderToStaticMarkup(<RunConfigView {...base} errorField={field} />)
      expect(markup).toContain('role="alert"')
      expect(markup).toContain(expected)
      for (const other of absent) expect(markup).not.toContain(other)
    }
  })

  it('renders no error markup when errorField is null or omitted', () => {
    for (const markup of [
      renderToStaticMarkup(<RunConfigView {...base} errorField={null} />),
      renderToStaticMarkup(<RunConfigView {...base} />)
    ]) {
      expect(markup).not.toContain('role="alert"')
      expect(markup).not.toContain('Could not change')
    }
  })
})

// #558: the in-flight marker — an unconfirmed change must not render identically to a settled one. The
// source is #256's selectPendingFields: three INDEPENDENT booleans (the store's `pending` is keyed by
// changeId so two fields can be outstanding at once), never an errorField-shaped single field. The
// marker is aria-busy on the element that OWNS each field's controls — one attribute serving as both
// the a11y marker and the CSS hook (the aria-current idiom), omitted rather than rendered "false".
// These assert the attribute's PLACEMENT, not merely its presence: placement is what keeps #269's
// role="alert" rejection line out of the busy subtree (an aria-busy ancestor would suppress it).
describe('RunConfigView — pending marker (#558)', () => {
  const base = { model: '', effort: '', yolo: false, ...NO_USAGE } as const
  const NONE = { model: false, effort: false, yolo: false, permissionMode: false } as const

  it('marks the model group only, when a model change is in flight (AC1/AC3)', () => {
    const markup = renderToStaticMarkup(<RunConfigView {...base} pending={{ ...NONE, model: true }} />)
    expect(markup.match(/aria-busy="true"/g)?.length).toBe(1)
    expect(tagWithClass(markup, 'run-config__model-list')).toContain('aria-busy="true"')
  })

  it('marks the effort group — the group, not an individual segment (AC1/AC3)', () => {
    // #976: a fixture that actually publishes levels, so the segment half of this assertion has
    // something to be true about rather than passing vacuously on an empty group.
    const markup = renderToStaticMarkup(
      <RunConfigView
        {...base}
        model="opus[1m]"
        models={PUBLISHED}
        pending={{ ...NONE, effort: true }}
      />
    )
    expect(markup.match(/aria-busy="true"/g)?.length).toBe(1)
    expect(tagWithClass(markup, 'run-config__effort')).toContain('aria-busy="true"')
    expect(tagWithClass(markup, 'run-config__effort-segment')).not.toContain('aria-busy')
  })

  it('marks the switch itself, leaving role/aria-checked untouched (AC1/AC2)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} yolo={true} pending={{ ...NONE, yolo: true }} />
    )
    expect(markup.match(/aria-busy="true"/g)?.length).toBe(1)
    const tag = tagWithClass(markup, 'run-config__switch')
    expect(tag).toContain('aria-busy="true"')
    expect(tag).toContain('role="switch"')
    expect(tag).toContain('aria-checked="true"')
  })

  it('marks two fields at once, independently (AC3 — the simultaneous case)', () => {
    // Two outstanding changes to DIFFERENT fields: the store tells them apart by changeId, so both
    // controls are marked and the untouched one is not. A single `pendingField | null` prop — the
    // errorField shape — could not express this.
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} pending={{ model: true, effort: false, yolo: true, permissionMode: false }} />
    )
    expect(markup.match(/aria-busy="true"/g)?.length).toBe(2)
    expect(tagWithClass(markup, 'run-config__model-list')).toContain('aria-busy="true"')
    expect(tagWithClass(markup, 'run-config__switch')).toContain('aria-busy="true"')
    expect(tagWithClass(markup, 'run-config__effort')).not.toContain('aria-busy')
  })

  it('renders exactly today markup with nothing in flight, prop given or omitted (AC5)', () => {
    const allFalse = renderToStaticMarkup(<RunConfigView {...base} pending={NONE} />)
    const omitted = renderToStaticMarkup(<RunConfigView {...base} />)
    // Omitted, never aria-busy="false": a rendered "false" would already be a markup change.
    expect(allFalse).not.toContain('aria-busy')
    expect(omitted).not.toContain('aria-busy')
    expect(allFalse).toBe(omitted)
  })

  it('leaves a marked control fully operable — the busy half only, never disabled (AC3)', () => {
    // LogDataSection pairs aria-busy with `disabled`; taking that half would contradict the store's
    // deliberate last-write-wins for rapid same-field changes.
    const markup = renderToStaticMarkup(
      <RunConfigView
        {...base}
        model="opus[1m]"
        models={PUBLISHED}
        onChange={(): void => undefined}
        pending={{ model: true, effort: true, yolo: true, permissionMode: false }}
      />
    )
    expect(markup).toContain('role="button"')
    expect(markup).toContain('tabindex="0"')
    expect(markup).not.toContain('aria-readonly')
    expect(markup).not.toContain('disabled')
  })

  it('alters no existing accessible name or selection marker (AC2)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView
        {...base}
        model="opus[1m]"
        effort="high"
        yolo={true}
        models={PUBLISHED}
        pending={{ model: true, effort: true, yolo: true, permissionMode: false }}
      />
    )
    expect(markup.match(/aria-label="Current model"/g)?.length).toBe(1)
    expect(markup).toContain('aria-label="Auto-accept tool calls"')
    expect(markup.match(/aria-current="true"/g)?.length).toBe(1)
    expect(markup).toContain('aria-checked="true"')
  })

  it('never encloses the rejection alert — the marked wrapper closes before it', () => {
    // The #269 alert must still be announced on the very field the operator was told is in flight; an
    // aria-busy ANCESTOR would instruct assistive technology to withhold it.
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} errorField="model" pending={{ ...NONE, model: true }} />
    )
    const wrapper = tagWithClass(markup, 'run-config__model-list')
    // Assert the wrapper was found and is the marked one first — otherwise closedBefore would be
    // measuring from offset 0 and could pass vacuously.
    expect(wrapper).toContain('aria-busy="true"')
    expect(markup).toContain('role="alert"')
    expect(closedBefore(markup, wrapper, 'role="alert"')).toBe(true)
  })

  it('marks a read-only control too — the marking is independent of operability (AC5)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} pending={{ ...NONE, yolo: true }} />
    )
    expect(tagWithClass(markup, 'run-config__switch')).toContain('aria-busy="true"')
    expect(markup).toContain('aria-readonly="true"')
    expect(markup).not.toContain('role="button"')
  })

  it('clears through the existing pending deletion on confirm, reject and reconnect (AC4)', () => {
    // Composed against the real store: there is no second representation of pending state to clear —
    // all three paths converge on the reducer deleting the pending marker.
    const changeId = 'change-1'
    const clearing: readonly RunSettingsWriteEvent[] = [
      { type: 'settingsConfirmed', changeId },
      { type: 'settingsRejected', changeId },
      { type: 'reconnected' }
    ]
    for (const event of clearing) {
      const store = createRunSettingsWriteStore()
      store.getState().dispatch({
        type: 'changeDispatched',
        changeId,
        change: { field: 'model', value: 'opus' }
      })
      const inFlight = renderToStaticMarkup(
        <RunConfigView {...base} pending={selectPendingFields(store.getState())} />
      )
      expect(inFlight).toContain('aria-busy="true"')

      store.getState().dispatch(event)
      const settled = renderToStaticMarkup(
        <RunConfigView {...base} pending={selectPendingFields(store.getState())} />
      )
      expect(settled).not.toContain('aria-busy')
    }
  })
})

// #560: the running-model surface — what claude ANNOUNCED (#587 decodes it, #588 holds it), rendered
// beside the Model rows, which keep showing the daemon's persisted OVERRIDE. Read-only: the view
// dispatches nothing derived from the announcement, so these assert markup only.
//
// The prop is OPTIONAL and its absence IS the not-yet-known state. That is what keeps every render site
// above compiling and passing unmodified — and why the unknown copy renders in all of them, so it must
// collide with none of their assertions ('Current model', aria-*, role=*, '% used', 'Could not change').
//
// The value is asserted as an EXACT SERIALIZED ELEMENT because AC2 is literally "character for
// character": a `toContain(model)` would also pass if the identifier were trimmed into a neighbouring
// node, and would say nothing about which element received it.
describe('RunConfigView — running model (#560)', () => {
  const base = { model: '', effort: '', yolo: false, ...NO_USAGE } as const
  const UNKNOWN = 'Running model not yet known'
  const CUT = 'Truncated by the daemon'
  const value = (text: string): string => `<p class="run-config__running-value">${text}</p>`
  const cut = `<p class="run-config__running-cut">${CUT}</p>`

  it('states that the running model is not yet known before any announcement (AC4)', () => {
    const markup = renderToStaticMarkup(<RunConfigView {...base} />)
    expect(markup).toContain('<p class="status-sheet__section-header">Running model</p>')
    expect(markup).toContain(UNKNOWN)
    // No value element AT ALL — not a blank one — and no cut marker.
    expect(markup).not.toContain('run-config__running-value')
    expect(markup).not.toContain('run-config__running-cut')
  })

  it('renders byte-identical markup for an explicit null and an omitted prop (AC4)', () => {
    expect(renderToStaticMarkup(<RunConfigView {...base} announced={null} />)).toBe(
      renderToStaticMarkup(<RunConfigView {...base} />)
    )
  })

  // #975 re-anchors this lookup on the PUBLISHED rows: the catalog it used to read is deleted, so the
  // join is now an exact equality against a row's `value`, rendering that row's display_name.
  it('names the published row an exactly-equal identifier resolves to (AC1)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} models={PUBLISHED} announced={{ model: 'haiku', truncated: false }} />
    )
    expect(markup).toContain(value('Quick tier'))
    expect(markup).not.toContain(UNKNOWN)
    // Naming the row IS "identifies that row": no second selection marker joins the list, which is what
    // keeps the 'Current model' count assertions (and the page-wide e2e count) honest.
    expect(markup).not.toContain('Current model')
  })

  it('resolves every published value to its own display name (AC1)', () => {
    for (const row of PUBLISHED_ROWS) {
      const markup = renderToStaticMarkup(
        <RunConfigView {...base} models={PUBLISHED} announced={{ model: row.value, truncated: false }} />
      )
      expect(markup).toContain(value(row.display_name))
    }
  })

  it('resolves nothing at all when no list has arrived — the verbatim path (AC1)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} models={NO_FRAME} announced={{ model: 'haiku', truncated: false }} />
    )
    expect(markup).toContain(value('haiku'))
    expect(markup).not.toContain(value('Quick tier'))
  })

  it('misses on a case-folded or padded value and renders it verbatim (AC1/AC2)', () => {
    // The assertion that fails if anyone reintroduces toLowerCase or trim.
    for (const model of ['Haiku', 'HAIKU', ' haiku']) {
      const markup = renderToStaticMarkup(
        <RunConfigView {...base} models={PUBLISHED} announced={{ model, truncated: false }} />
      )
      expect(markup).toContain(value(model))
      expect(markup).not.toContain(value('Quick tier'))
    }
  })

  it('misses on a superstring of a published value — never substring matching (AC1/AC2)', () => {
    // The re-anchored exactness guard #975 inherits from the deleted matchedFamily test: an announced
    // identifier that merely CONTAINS a published `value` must not resolve to that row's display name.
    // `claude-haiku-4-5` contains the published `haiku` and equals no row's `value`, so the exact
    // lookup misses and the identifier renders verbatim; any substring matcher would resolve it.
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} models={PUBLISHED} announced={{ model: 'claude-haiku-4-5', truncated: false }} />
    )
    expect(markup).toContain(value('claude-haiku-4-5'))
    expect(markup).not.toContain(value('Quick tier'))
    expect(markup).not.toContain('Current model')
  })

  it('does not join on resolved_model — that field is displayed, never matched (AC1)', () => {
    // The Quick tier row publishes `claude-haiku-4-5-20251001` as its resolved_model, and an
    // announcement carrying exactly that must still miss: the join key is `value` and nothing else.
    const markup = renderToStaticMarkup(
      <RunConfigView
        {...base}
        models={PUBLISHED}
        announced={{ model: 'claude-haiku-4-5-20251001', truncated: false }}
      />
    )
    expect(markup).toContain(value('claude-haiku-4-5-20251001'))
    expect(markup).not.toContain(value('Quick tier'))
  })

  it('renders a full unrecognized identifier character for character (AC2)', () => {
    const model = 'claude-haiku-4-5-20251001'
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} announced={{ model, truncated: false }} />
    )
    expect(markup).toContain(value(model))
    expect(markup).not.toContain(UNKNOWN)
  })

  it('renders an announced empty identifier as a present, empty value — never not-yet-known', () => {
    // `{ model: '' }` is a real announcement a non-conforming daemon can emit; collapsing it into the
    // null sentinel would erase the store's deliberate null-vs-'' distinction one layer above.
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} announced={{ model: '', truncated: false }} />
    )
    expect(markup).toContain(value(''))
    expect(markup).not.toContain(UNKNOWN)
  })

  it('marks a cut identifier with its own sibling element (AC3)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} announced={{ model: 'claude-opus-4-', truncated: true }} />
    )
    // Adjacent siblings: the value element CLOSES before the marker opens, so the sheet's own words are
    // never inside the daemon-supplied node. Asserting the pair as one serialized run is the whole
    // structural claim — an incomplete identifier is distinguishable in the markup from a complete one
    // the sheet merely did not recognise.
    expect(markup).toContain(`${value('claude-opus-4-')}${cut}`)
  })

  it('renders no cut marker when nothing was cut (AC3)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} announced={{ model: 'claude-opus-4-7', truncated: false }} />
    )
    expect(markup).not.toContain('run-config__running-cut')
    expect(markup).not.toContain(CUT)
  })

  it('reports a cut independently of whether the identifier resolved', () => {
    // The flag is the daemon reporting on the identifier it delivered. Gating the marker on the lookup
    // MISSING would let a daemon suppress its own cut report by sending a value equal to a published one.
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} models={PUBLISHED} announced={{ model: 'haiku', truncated: true }} />
    )
    expect(markup).toContain(value('Quick tier'))
    expect(markup).toContain(cut)
  })

  it('cannot have its cut claim forged by an identifier ending in the same words (AC3)', () => {
    const model = `claude-x ${CUT}`
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} announced={{ model, truncated: false }} />
    )
    // The words appear — inside the daemon's own node, verbatim — but the sheet's marker ELEMENT does
    // not exist. Structural on purpose: `not.toContain(CUT)` would fail on a CORRECT render here.
    expect(markup).toContain(value(model))
    expect(markup).not.toContain('run-config__running-cut')
  })

  it('renders a hostile identifier as inert escaped text (AC5)', () => {
    for (const model of [
      '<img src=x onerror="alert(1)">',
      'javascript:alert(1)',
      '" onmouseover="x',
      '\u001b[31mred\u0007'
    ]) {
      const markup = renderToStaticMarkup(
        <RunConfigView {...base} announced={{ model, truncated: false }} />
      )
      // Attribute-shaped guards, NEVER not.toContain('onerror=') / ('src=') / ('javascript:') — those
      // substrings survive a CORRECT render (React escapes markup metacharacters, not arbitrary text),
      // so they would pass vacuously. renderToStaticMarkup always quotes attribute values and escapes
      // the quote, so no attribute and no URL can be forged out of escaped text.
      expect(markup).not.toContain('<img')
      expect(markup).not.toContain('src="')
      expect(markup).not.toContain('href="')
      expect(markup).not.toMatch(/\son[a-z]+="/)
    }
  })

  it('escapes markup metacharacters into the value element (AC5)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView
        {...base}
        announced={{ model: '<img src=x onerror="alert(1)">', truncated: false }}
      />
    )
    expect(markup).toContain(value('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'))
  })

  it('passes control characters and terminal escapes through verbatim (AC2/AC5)', () => {
    // Written as \u escapes in SOURCE — a typed control byte lands raw in the file. Nothing on this path
    // strips them, which is the contract: the identifier is held verbatim, and a control character in a
    // DOM text node is inert in a browser renderer.
    const model = '\u001b[31mred\u0007'
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} announced={{ model, truncated: false }} />
    )
    expect(markup).toContain(value(model))
  })

  it('leaves the override marking alone — the two surfaces are independent', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView
        {...base}
        model="haiku"
        models={PUBLISHED}
        announced={{ model: 'claude-unknown-9', truncated: false }}
      />
    )
    // The override still marks its own row, exactly as today, and the running surface adds no marker.
    expect(markup.match(/Current model/g)?.length).toBe(1)
    expect(markup).toContain(value('claude-unknown-9'))
  })
})

// #975: the container's own gate. Seeding a zustand singleton is INVISIBLE to renderToStaticMarkup —
// the server renderer reads the state captured at store CREATION — so the seed goes in as the
// factory's init and the module is mocked with ONLY the hook binding overridden, keeping the real
// selectors. That is possible because modelListStore exports the factory, the hook and the selector
// separately.
// vi.hoisted, because vi.mock's factory is lifted above every module-level binding and would otherwise
// read this id before initialisation.
const { SEEDED_CONVERSATION_ID } = vi.hoisted(() => ({ SEEDED_CONVERSATION_ID: 'conv-975' }))

vi.mock('../../store/modelListStore', async (importActual) => {
  const actual = await importActual<typeof import('../../store/modelListStore')>()
  const { useStore } = await import('zustand')
  const seeded: ModelListState = {
    lists: new Map([
      [
        SEEDED_CONVERSATION_ID,
        {
          models: [
            {
              value: 'seeded-value',
              display_name: 'Seeded label',
              resolved_model: 'seeded-resolved',
              effort_levels: [],
              supports_auto_mode: false,
              truncated_fields: null
            }
          ],
          droppedModels: 0
        }
      ]
    ])
  }
  const store = actual.createModelListStore(seeded)
  return {
    ...actual,
    useModelListStore: <T,>(selector: (s: ReturnType<typeof store.getState>) => T): T =>
      useStore(store, selector)
  }
})

describe('RunConfigSections (container)', () => {
  it('renders the list published for the conversation it was given (#975)', () => {
    const markup = renderToStaticMarkup(<RunConfigSections conversationId={SEEDED_CONVERSATION_ID} />)
    expect(markup).toContain('Seeded label')
    expect(markup).toContain('seeded-resolved')
    expect(markup).not.toContain(MODELS_UNKNOWN)
  })

  it('reads not-yet-known for another conversation and for no conversation (#975)', () => {
    // The trap this test exists for: the container used to have only a session id in scope, which keys
    // NOTHING in the model-list map — reaching for it compiles clean and renders this branch forever.
    for (const conversationId of ['some-other-conversation', null]) {
      const markup = renderToStaticMarkup(<RunConfigSections conversationId={conversationId} />)
      expect(markup).toContain(MODELS_UNKNOWN)
      expect(markup).not.toContain('Seeded label')
    }
  })

  it('server-renders the AC4 default without touching window.pyry', () => {
    // useStore reads getInitialState() (snapshot:null) under server render, so the container always
    // renders the coalesced default — the real opening frame before a snapshot arrives. No bridge is
    // dereferenced during render, so no window.pyry mock is needed.
    let markup = ''
    expect(() => {
      markup = renderToStaticMarkup(<RunConfigSections conversationId={null} />)
    }).not.toThrow()
    // AC4 default: no radio filled, no segment marked, switch off.
    expect(markup).not.toContain('Current model')
    expect(markup).not.toContain('aria-current')
    expect(markup).toContain('aria-checked="false"')
    // AC5: under SSR sessionId is null ⇒ no onChange ⇒ the controls are inert — the switch stays
    // read-only and no operable affordance renders (identical to #188).
    expect(markup).toContain('aria-readonly="true"')
    expect(markup).not.toContain('role="button"')
    // No standing rejection on the opening frame — and nothing in flight either (#558).
    expect(markup).not.toContain('role="alert"')
    expect(markup).not.toContain('aria-busy')
    // The null-snapshot default (windowTokens: 0) collapses into the same unavailable branch as the
    // daemon's window_tokens == 0 signal — no % used, no NaN, no divide-by-zero (AC5).
    expect(markup).not.toContain('% used')
    expect(markup).not.toContain('NaN')
    expect(markup).toContain('Context usage unavailable')
    // #975: with no conversation in scope the Model section reads not-yet-known and renders no row.
    expect(markup).toContain(MODELS_UNKNOWN)
    expect(markup).not.toContain('run-config__model-row')
    // #976: and the Effort section matches no published row, so it offers NO segment and shows the
    // session's effort value — '' on the opening frame — as text. A five-segment strip here would be
    // the hardcoded vocabulary surviving.
    expect(markup).not.toContain('run-config__effort-segment')
    expect(markup).toContain('class="run-config__effort-current"></p>')
    // #560: the fourth store read is wired and still needs no bridge mock — under server render zustand
    // reads getInitialState() (announced: null), so the container renders the not-yet-known state.
    expect(markup).toContain('Running model not yet known')
  })
})
