import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createRunSettingsWriteStore,
  selectPendingFields,
  type RunSettingsWriteEvent
} from '../../store/runSettingsWriteStore'
import { RunConfigView, RunConfigSections } from './RunConfigSections'

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

describe('RunConfigView — Model', () => {
  it('marks the Opus row selected for the short alias "opus"; Sonnet/Haiku unmarked', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="opus" effort="" yolo={false} {...NO_USAGE} />)
    expect(segmentFor(markup, 'run-config__model-row', 'Opus 4.7')).toContain('Current model')
    expect(segmentFor(markup, 'run-config__model-row', 'Sonnet 4.6')).not.toContain('Current model')
    expect(segmentFor(markup, 'run-config__model-row', 'Haiku 4.5')).not.toContain('Current model')
    // Exactly one row is marked.
    expect(markup.match(/Current model/g)?.length).toBe(1)
  })

  it('marks Opus for a full id "claude-opus-4-7" (family substring match, not exact equality)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView model="claude-opus-4-7" effort="" yolo={false} {...NO_USAGE} />
    )
    expect(segmentFor(markup, 'run-config__model-row', 'Opus 4.7')).toContain('Current model')
    expect(markup.match(/Current model/g)?.length).toBe(1)
  })

  it('marks the Sonnet row for "sonnet"', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="sonnet" effort="" yolo={false} {...NO_USAGE} />)
    expect(segmentFor(markup, 'run-config__model-row', 'Sonnet 4.6')).toContain('Current model')
    expect(markup.match(/Current model/g)?.length).toBe(1)
  })

  it('marks the Haiku row for "haiku"', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="haiku" effort="" yolo={false} {...NO_USAGE} />)
    expect(segmentFor(markup, 'run-config__model-row', 'Haiku 4.5')).toContain('Current model')
    expect(markup.match(/Current model/g)?.length).toBe(1)
  })

  // #590 — the Fable family. `entry.family` is ONE field with TWO uses: the token handed to onSelect
  // and the token matchedFamily substring-matches the daemon's model against. So rendering with the
  // bare alias and observing the row marked exercises the same literal the row submits — the
  // round-trip proof, without a click the `node` env cannot fire.
  it('marks the Fable row for the resolved id "claude-fable-5" (AC2)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView model="claude-fable-5" effort="" yolo={false} {...NO_USAGE} />
    )
    expect(segmentFor(markup, 'run-config__model-row', 'Fable 5')).toContain('Current model')
    expect(markup.match(/Current model/g)?.length).toBe(1)
  })

  it('marks that same row for the bare alias "fable" — the token the row submits (AC3)', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="fable" effort="" yolo={false} {...NO_USAGE} />)
    expect(segmentFor(markup, 'run-config__model-row', 'Fable 5')).toContain('Current model')
    expect(markup.match(/Current model/g)?.length).toBe(1)
  })

  it('steals no existing match — each sibling vector still marks its own single row (AC4)', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['opus', 'Opus 4.7'],
      ['sonnet', 'Sonnet 4.6'],
      ['haiku', 'Haiku 4.5'],
      ['claude-opus-5', 'Opus 4.7'],
      ['claude-sonnet-4-6', 'Sonnet 4.6']
    ]
    for (const [model, row] of cases) {
      const markup = renderToStaticMarkup(<RunConfigView model={model} effort="" yolo={false} {...NO_USAGE} />)
      expect(segmentFor(markup, 'run-config__model-row', row)).toContain('Current model')
      expect(segmentFor(markup, 'run-config__model-row', 'Fable 5')).not.toContain('Current model')
      expect(markup.match(/Current model/g)?.length).toBe(1)
    }
  })

  // Per-row, via segmentFor: the whole-markup role="button" assertion in the interactive-toggle block
  // is satisfied by the other three rows and proves nothing about this one. Fable sits third of four,
  // so its chunk is bounded by the Haiku row — the inert case is a tight negative, not an open-ended
  // tail that would swallow the effort segments and the YOLO switch.
  it('is operable on the same terms as its siblings, and inert without a handler (AC5)', () => {
    const props = { model: 'fable', effort: '', yolo: false, ...NO_USAGE } as const
    const operable = segmentFor(
      renderToStaticMarkup(<RunConfigView {...props} onChange={(): void => undefined} />),
      'run-config__model-row',
      'Fable 5'
    )
    expect(operable).toContain('role="button"')
    expect(operable).toContain('tabindex="0"')
    const inert = segmentFor(
      renderToStaticMarkup(<RunConfigView {...props} />),
      'run-config__model-row',
      'Fable 5'
    )
    expect(inert).not.toContain('role="button"')
    expect(inert).not.toContain('tabindex')
  })

  it('marks no row for the empty model (AC4 default) or an unrecognized model', () => {
    for (const model of ['', 'some-unknown-model']) {
      const markup = renderToStaticMarkup(<RunConfigView model={model} effort="" yolo={false} {...NO_USAGE} />)
      expect(markup).not.toContain('Current model')
    }
  })

  it('always renders all four names and descriptors, matched or not', () => {
    for (const model of ['opus', '', 'gibberish']) {
      const markup = renderToStaticMarkup(<RunConfigView model={model} effort="" yolo={false} {...NO_USAGE} />)
      for (const text of [
        'Opus 4.7',
        'best for complex work',
        'Sonnet 4.6',
        'faster, cheaper',
        'Fable 5',
        'newest in the Fable family',
        'Haiku 4.5',
        'fastest'
      ]) {
        expect(markup).toContain(text)
      }
    }
  })
})

describe('RunConfigView — Effort', () => {
  it('marks exactly the current level with aria-current, the rest unmarked', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const markup = renderToStaticMarkup(<RunConfigView model="" effort={level} yolo={false} {...NO_USAGE} />)
      expect(segmentFor(markup, 'run-config__effort-segment', `>${level}<`)).toContain(
        'aria-current="true"'
      )
      expect(markup.match(/aria-current="true"/g)?.length).toBe(1)
    }
  })

  it('marks no segment for the empty effort (AC4 default) or an unknown value', () => {
    for (const effort of ['', 'turbo']) {
      const markup = renderToStaticMarkup(<RunConfigView model="" effort={effort} yolo={false} {...NO_USAGE} />)
      expect(markup).not.toContain('aria-current')
    }
  })

  it('always renders all five level labels', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="" effort="" yolo={false} {...NO_USAGE} />)
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(markup).toContain(`>${level}<`)
    }
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
      <RunConfigView model="opus" effort="high" yolo={false} {...NO_USAGE} onChange={noop} />
    )
    // Model rows and effort segments gain the operable affordance.
    expect(markup).toContain('role="button"')
    expect(markup).toContain('tabindex="0"')
    // The YOLO switch drops aria-readonly and becomes operable (AC3).
    expect(markup).toContain('role="switch"')
    expect(markup).not.toContain('aria-readonly')
    // Selection still reflects the passed values exactly as #188.
    expect(segmentFor(markup, 'run-config__model-row', 'Opus 4.7')).toContain('Current model')
    expect(segmentFor(markup, 'run-config__effort-segment', '>high<')).toContain('aria-current="true"')
  })

  it('stays inert (identical to #188) when onChange is absent (AC5)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView model="opus" effort="high" yolo={true} {...NO_USAGE} />
    )
    // No handler ⇒ literally today's read-only markup: no operable affordance, switch reads-only.
    expect(markup).not.toContain('role="button"')
    expect(markup).not.toContain('tabindex')
    expect(markup).toContain('aria-readonly="true"')
    // Selection markers unchanged.
    expect(segmentFor(markup, 'run-config__model-row', 'Opus 4.7')).toContain('Current model')
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
  const NONE = { model: false, effort: false, yolo: false } as const

  it('marks the model group only, when a model change is in flight (AC1/AC3)', () => {
    const markup = renderToStaticMarkup(<RunConfigView {...base} pending={{ ...NONE, model: true }} />)
    expect(markup.match(/aria-busy="true"/g)?.length).toBe(1)
    expect(tagWithClass(markup, 'run-config__model-list')).toContain('aria-busy="true"')
  })

  it('marks the effort group — the group, not an individual segment (AC1/AC3)', () => {
    const markup = renderToStaticMarkup(<RunConfigView {...base} pending={{ ...NONE, effort: true }} />)
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
      <RunConfigView {...base} pending={{ model: true, effort: false, yolo: true }} />
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
        onChange={(): void => undefined}
        pending={{ model: true, effort: true, yolo: true }}
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
        model="opus"
        effort="high"
        yolo={true}
        pending={{ model: true, effort: true, yolo: true }}
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

  it('names the row an exactly-equal identifier resolves to (AC1)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} announced={{ model: 'opus', truncated: false }} />
    )
    expect(markup).toContain(value('Opus 4.7'))
    expect(markup).not.toContain(UNKNOWN)
    // Naming the row IS "identifies that row": no second selection marker joins the list, which is what
    // keeps the six 'Current model' count assertions (and the page-wide e2e count) honest.
    expect(markup).not.toContain('Current model')
  })

  it('resolves every catalog token to its own display name (AC1)', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['opus', 'Opus 4.7'],
      ['sonnet', 'Sonnet 4.6'],
      ['fable', 'Fable 5'],
      ['haiku', 'Haiku 4.5']
    ]
    for (const [model, name] of cases) {
      const markup = renderToStaticMarkup(
        <RunConfigView {...base} announced={{ model, truncated: false }} />
      )
      expect(markup).toContain(value(name))
    }
  })

  it('misses on a case-folded or padded token and renders it verbatim (AC1/AC2)', () => {
    // The assertion that fails if anyone reintroduces toLowerCase or trim.
    for (const model of ['Opus', 'OPUS', ' opus']) {
      const markup = renderToStaticMarkup(
        <RunConfigView {...base} announced={{ model, truncated: false }} />
      )
      expect(markup).toContain(value(model))
      expect(markup).not.toContain(value('Opus 4.7'))
    }
  })

  it('misses on a superstring of a token — never matchedFamily substring matching (AC1/AC2)', () => {
    // The assertion that fails if anyone swaps the exact lookup for the override's matchedFamily.
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} announced={{ model: 'claude-opus-4-7', truncated: false }} />
    )
    expect(markup).toContain(value('claude-opus-4-7'))
    expect(markup).not.toContain(value('Opus 4.7'))
    expect(markup).not.toContain('Current model')
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
    // MISSING would let a daemon suppress its own cut report by sending a value equal to a catalog token.
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} announced={{ model: 'opus', truncated: true }} />
    )
    expect(markup).toContain(value('Opus 4.7'))
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
      <RunConfigView {...base} model="opus" announced={{ model: 'claude-unknown-9', truncated: false }} />
    )
    // The override still marks its own row, exactly as today, and the running surface adds no marker.
    expect(markup.match(/Current model/g)?.length).toBe(1)
    expect(markup).toContain(value('claude-unknown-9'))
  })
})

describe('RunConfigSections (container)', () => {
  it('server-renders the AC4 default without touching window.pyry', () => {
    // useStore reads getInitialState() (snapshot:null) under server render, so the container always
    // renders the coalesced default — the real opening frame before a snapshot arrives. No bridge is
    // dereferenced during render, so no window.pyry mock is needed.
    let markup = ''
    expect(() => {
      markup = renderToStaticMarkup(<RunConfigSections />)
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
    // The static catalog + labels still render.
    expect(markup).toContain('Opus 4.7')
    expect(markup).toContain('>low<')
    // #560: the fourth store read is wired and still needs no bridge mock — under server render zustand
    // reads getInitialState() (announced: null), so the container renders the not-yet-known state.
    expect(markup).toContain('Running model not yet known')
  })
})
