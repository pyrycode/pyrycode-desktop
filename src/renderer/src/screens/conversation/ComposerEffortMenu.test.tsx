import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WireModelOption } from '@shared/wire/types'
import type { ModelListEntry } from '../../store/modelListStore'
import {
  selectDisplayedEffort,
  ComposerEffortMenuView,
  COMPOSER_EFFORT_MENU_LABEL,
  composerEffortMenuModel
} from './ComposerEffortMenu'
import type { RunConfigSnapshot } from '../../store/runConfigStore'
import { createRunSettingsWriteStore } from '../../store/runSettingsWriteStore'
import { ComposerOptionsPanel } from './ComposerOptionsPanel'

// #989: ComposerModelMenu.test.tsx's two halves, one button to the right — the decision as a plain
// function, then the markup. `onSelect` is NOT exercised here: a static render fires no events, so
// nothing in this file can click. The open → pick → set_session_settings proof is
// e2e/composer-effort-menu.spec.ts.
//
// THE FIXTURE LEVELS ARE INVENTED, and that is AC2's "no level list is hardcoded in this repo"
// discharged by construction rather than by an assertion. Seeding the five measured levels would put
// the vocabulary this feature exists to stop re-minting back into the repo, in a file whose whole
// subject is that it must not be there — and it would let a production fallback that offered the real
// five pass unnoticed. Every assertion below is a DERIVATION over these invented arrays, never
// `expect(markup).not.toContain('<a level>')`, which would type the banned literal into the file the
// criterion's own grep reads.

function row(
  over: Partial<WireModelOption> & Pick<WireModelOption, 'value' | 'display_name'>
): WireModelOption {
  return {
    resolved_model: `${over.value}-resolved`,
    effort_levels: [],
    supports_auto_mode: false,
    truncated_fields: null,
    ...over
  }
}

// Mutually non-substring, so a widened match would be visible rather than accidentally right.
const LEVELS: readonly string[] = ['tier-one', 'tier-two', 'tier-three']

// The row the session's model joins, and a second row publishing none — the two readings the daemon
// really sends, in one list.
const GRADED = row({ value: 'graded', display_name: 'Graded tier', effort_levels: [...LEVELS] })
const FLAT = row({ value: 'flat', display_name: 'Flat tier', effort_levels: [] })

const LIST: ModelListEntry = { models: [GRADED, FLAT], droppedModels: 0 }
const EMPTY: ModelListEntry = { models: [], droppedModels: 0 }

const EFFORT = 'tier-two'

const noop = (): void => {}

// ComposerOptionsPanel.test.tsx:59-61 verbatim — count ROWS, so the panel div cannot inflate the count
// and a current row still counts exactly once.
function rowCount(markup: string): number {
  return markup.match(/class="composer-options__item["\s]/g)?.length ?? 0
}

function countOf(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

/** The trigger button's inner markup — what a browser computes the accessible name from. */
function triggerInner(markup: string): string {
  return (
    markup.match(
      /<button[^>]*class="composer__footer-button composer__effort"[^>]*>([\s\S]*?)<\/button>/
    )?.[1] ?? ''
  )
}

function view(models: ModelListEntry | null, model: string, effort: string): string {
  return renderToStaticMarkup(
    <ComposerEffortMenuView models={models} model={model} effort={effort} onSelect={noop} />
  )
}

describe('composerEffortMenuModel', () => {
  // AC1 and AC2 in one shape: the label is the session's effort VERBATIM (no lookup, no relabelling —
  // claude's own control displays these byte-identical to the machine values), the entries are the
  // matched row's levels, and the current one is that same string.
  it('labels the trigger with the session effort and offers the matched row levels (AC1, AC2)', () => {
    expect(composerEffortMenuModel(LIST, GRADED.value, EFFORT)).toStrictEqual({
      label: EFFORT,
      currentId: EFFORT,
      options: LEVELS.map((level) => ({ id: level, label: level }))
    })
  })

  // Exactly the published levels, one per entry, in the daemon's order, id === label === level — as a
  // derivation over the seeded array, so a fourth level inherits the guard and no real level is typed.
  it('offers exactly the published levels, in order, id = label = level (AC2)', () => {
    const menu = composerEffortMenuModel(LIST, GRADED.value, EFFORT)
    expect(menu?.options.map((o) => o.id)).toStrictEqual([...LEVELS])
    expect(menu?.options.map((o) => o.label)).toStrictEqual([...LEVELS])
    expect(menu?.options).toHaveLength(LEVELS.length)
  })

  // AC3's THREE nothing-to-offer readings, which the wire contract collapses into one `[]` and this
  // control therefore renders as one arm. `toStrictEqual` is what pins "AND NEVER A FALLBACK": any
  // synthesised vocabulary fails here, in the exact case an absent list would tempt one.
  it.each([
    ['no frame has arrived', null, GRADED.value],
    ['the daemon published no rows at all', EMPTY, GRADED.value],
    ['the session model matches no published row', LIST, 'unpublished'],
    ['the matched row publishes an empty list', LIST, FLAT.value]
  ])('offers nothing but still labels the trigger when %s (AC3)', (_why, models, model) => {
    expect(composerEffortMenuModel(models as ModelListEntry | null, model, EFFORT)).toStrictEqual({
      label: EFFORT,
      currentId: EFFORT,
      options: []
    })
  })

  // The model join is EXACT EQUALITY on `value` through publishedRowFor — four claims rather than one,
  // because a sloppy includes/toLowerCase/trim passes a single-case test. A near-miss offers nothing;
  // it must never resolve to a neighbouring row's levels.
  it.each([
    ['a case fold', 'GRADED'],
    ['a prefix', 'grade'],
    ['a superstring', 'graded-resolved'],
    ['surrounding whitespace', ' graded ']
  ])('resolves no levels from %s of a published value (AC3)', (_why, model) => {
    expect(composerEffortMenuModel(LIST, model, EFFORT)?.options).toStrictEqual([])
  })

  it.each([
    ['a matched row publishing none', LIST, FLAT.value],
    ['no list at all', null, GRADED.value]
  ])('keeps an unselected read-only label with %s', (_why, models, model) => {
    expect(composerEffortMenuModel(models as ModelListEntry | null, model, '')).toMatchObject({ label: 'Effort', currentId: '', options: [] })
  })

  // An effort appearing in no published level still offers the levels and marks NONE — the panel's
  // existing no-special-case branch, the same one a stale model id already takes. Not an error, and not
  // a reason to withhold the menu: the daemon may publish a narrowed list for a session already running
  // a level outside it.
  it('offers the levels and marks none when the session effort is in no published level (AC2)', () => {
    const menu = composerEffortMenuModel(LIST, GRADED.value, 'tier-nine')
    expect(menu?.options.map((o) => o.id)).toStrictEqual([...LEVELS])
    expect(menu?.currentId).toBe('tier-nine')
  })

  // Claude may legitimately publish a repeated level (RunConfigSections' EffortSection keys by array
  // index for exactly this reason). The shared panel keys on `option.id`, so a repeat is a duplicate
  // React key — carried anyway: AC2's "exactly the published levels" outranks a tidier list, both
  // entries submit the identical string, and no prop may be added to the panel. Pinned so a later
  // dedupe has to argue with a test rather than look like a cleanup.
  it('carries a repeated published level twice rather than deduping it (AC2)', () => {
    const list: ModelListEntry = {
      models: [row({ value: 'graded', display_name: 'D', effort_levels: ['dup', 'dup'] })],
      droppedModels: 0
    }
    const menu = composerEffortMenuModel(list, 'graded', 'dup')
    expect(menu?.options.map((o) => o.id)).toStrictEqual(['dup', 'dup'])
    expect(menu?.currentId).toBe('dup')
  })
})

describe('ComposerEffortMenuView', () => {
  it('renders the footer trigger inside a composer-options anchor, closed (AC1)', () => {
    const markup = view(LIST, GRADED.value, EFFORT)
    expect(markup).toContain('class="composer-options-anchor"')
    expect(markup).toContain('class="composer__footer-button composer__effort"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('composer-options__item')
    expect(markup).not.toContain('role="menu"')
  })

  // AC1's label through the markup, and its bound: the value sits in its OWN element, which is what
  // carries the max-width and the ellipsis that stop a hostile published level pushing the context
  // reading out of a row with a hard 20px height. A bare text child could not be bounded.
  it('draws the session effort verbatim in its own bounded element (AC1)', () => {
    expect(view(LIST, GRADED.value, EFFORT)).toContain(
      `<span class="composer__effort-label">${EFFORT}</span>`
    )
  })

  // The trigger's accessible name is computed from its contents (no aria-label — see the view), so the
  // chevron must stay out of it. It also protects the e2e locator, which has no client-owned constant
  // to fall back on.
  it('hides the chevron from the accessible name', () => {
    const inner = triggerInner(view(LIST, GRADED.value, EFFORT))
    expect(inner).toContain('composer__effort-icon')
    expect(inner).toContain('aria-hidden="true"')
    expect(inner.replace(/<svg[\s\S]*?<\/svg>/g, '').trim()).toBe(
      `<span class="composer__effort-label">${EFFORT}</span>`
    )
  })

  // THE PANEL'S NAME IS CLIENT-OWNED and is NOT the trigger's visible text: this label is
  // claude-authored, and aria-label is an ATTRIBUTE — a sink CLAUDE.md's daemon-text ruling forbids
  // outright. Asserted as the absence of every seeded daemon string from every attribute position,
  // which also covers `title`, `data-*` and any future attribute this trigger grows.
  it('names the menu with a client-owned constant and puts no daemon text in an attribute', () => {
    const markup = view(LIST, GRADED.value, EFFORT)
    expect(COMPOSER_EFFORT_MENU_LABEL).toBe('Effort')
    for (const attr of markup.match(/[a-z-]+="[^"]*"/g) ?? []) {
      for (const level of LEVELS) expect(attr).not.toContain(level)
      for (const seeded of LIST.models) expect(attr).not.toContain(seeded.value)
    }
  })

  // AC3: present, but it opens no panel — and not an operable trigger over an empty one. It announces
  // no popup, has no role, no tabindex and no <button> at all, and the chevron goes with the
  // interactivity it claims. The WHOLE markup is asserted, so a synthesised entry, a stray attribute or
  // a fallback vocabulary all fail here.
  it.each([
    ['no frame has arrived', null, GRADED.value],
    ['the daemon published no rows at all', EMPTY, GRADED.value],
    ['the session model matches no published row', LIST, 'unpublished'],
    ['the matched row publishes an empty list', LIST, FLAT.value]
  ])('renders an inert label, announcing no popup, when %s (AC3)', (_why, models, model) => {
    const markup = view(models as ModelListEntry | null, model, EFFORT)
    expect(markup).toBe(
      `<span class="composer__footer-button"><span class="composer__effort-label">${EFFORT}</span></span>`
    )
    expect(markup).not.toContain('aria-haspopup')
    expect(markup).not.toContain('composer-options-anchor')
    expect(markup).not.toContain('composer__effort-icon')
  })

  it('offers an unset effort without marking any published level', () => {
    const menu = composerEffortMenuModel(LIST, GRADED.value, '')
    expect(menu).toStrictEqual({
      label: 'Effort', currentId: '',
      options: [
        { id: 'tier-one', label: 'tier-one' },
        { id: 'tier-two', label: 'tier-two' },
        { id: 'tier-three', label: 'tier-three' }
      ]
    })
    expect(view(LIST, GRADED.value, '')).toContain('aria-haspopup="menu"')
    expect(view(LIST, GRADED.value, '')).toContain('>Effort</span>')
    const markup = renderToStaticMarkup(
      <ComposerOptionsPanel options={menu?.options ?? []} currentId={menu?.currentId ?? null}
        onSelect={noop} ariaLabel="Effort" focusedIndex={0} />
    )
    expect(rowCount(markup)).toBe(3)
    expect(markup).not.toContain('aria-current="true"')
  })

  // The levels reach the SHARED panel: this menu's own static render cannot show an open panel
  // (useState(false)), so they are fed to the panel directly — ComposerModelMenu.test.tsx's idiom.
  it('feeds the published levels to the shared panel with the session effort marked (AC2)', () => {
    const menu = composerEffortMenuModel(LIST, GRADED.value, EFFORT)
    const markup = renderToStaticMarkup(
      <ComposerOptionsPanel
        options={menu?.options ?? []}
        currentId={menu?.currentId ?? null}
        onSelect={noop}
        ariaLabel={COMPOSER_EFFORT_MENU_LABEL}
        focusedIndex={0}
      />
    )
    expect(rowCount(markup)).toBe(LEVELS.length)
    for (const level of LEVELS) expect(markup).toContain(`>${level}<`)
    expect(countOf(markup, 'aria-current')).toBe(1)
    expect(markup).toContain(`aria-current="true">${EFFORT}<`)
  })

  // The other half of the marking rule: an effort in no published level marks nothing, through that
  // same branch. Exact equality is load-bearing here for EffortSection's reason — `high` is a substring
  // of `xhigh` and a row publishes both, so a widened comparison would mark two rows.
  it('marks no row when the session effort is in no published level (AC2)', () => {
    const menu = composerEffortMenuModel(LIST, GRADED.value, 'tier-nine')
    const markup = renderToStaticMarkup(
      <ComposerOptionsPanel
        options={menu?.options ?? []}
        currentId={menu?.currentId ?? null}
        onSelect={noop}
        ariaLabel={COMPOSER_EFFORT_MENU_LABEL}
        focusedIndex={0}
      />
    )
    expect(rowCount(markup)).toBe(LEVELS.length)
    expect(countOf(markup, 'aria-current')).toBe(0)
  })
})

// #1168: the session model '' — the wire contract's inherited daemon default, explicitly not absent —
// which the daemon publishes as an ordinary row valued `default`. It matched no row before this slice,
// so an unconfigured chat drew the inert label above permanently. The JOIN re-points; the trigger, the
// label, the marking and both arms are the ones already asserted above.
describe('composerEffortMenuModel / View — the inherited-default session (#1168)', () => {
  // The row value is TYPED rather than imported: the module keeps that constant private on purpose, so
  // a changed value must fail here rather than be followed. The DISPLAY strings stay invented, the
  // sibling files' rule, and the levels stay mutually non-substring with GRADED's.
  const INHERITED = row({
    value: 'default',
    display_name: 'Inherited default',
    effort_levels: ['calm', 'urgent']
  })
  const INHERITED_LEVELS = INHERITED.effort_levels
  // Both readings in one list, so each case below picks its row by the MODEL it joins on. GRADED sits
  // beside it and must never be what an empty model resolves to.
  const WITH_INHERITED: ModelListEntry = { models: [GRADED, INHERITED, FLAT], droppedModels: 0 }

  it('resolves that row levels for an empty model, label and marking unchanged (AC1)', () => {
    expect(composerEffortMenuModel(WITH_INHERITED, '', EFFORT)).toStrictEqual({
      label: EFFORT,
      currentId: EFFORT,
      options: INHERITED_LEVELS.map((level) => ({ id: level, label: level }))
    })
  })

  it('resolves THAT row, never a neighbouring published one (AC1)', () => {
    const options = composerEffortMenuModel(WITH_INHERITED, '', EFFORT)?.options ?? []
    expect(options.map((each) => each.id)).toStrictEqual([...INHERITED_LEVELS])
    for (const level of LEVELS) expect(options.map((each) => each.id)).not.toContain(level)
  })

  // The arm FLIP, as markup: the openable menu where an inert span stands today. The two arms render
  // structurally different elements, which is the only way a repo that cannot click observes this.
  it('draws the openable menu where it drew an inert label (AC1)', () => {
    const markup = view(WITH_INHERITED, '', EFFORT)
    expect(markup).toContain('class="composer-options-anchor"')
    expect(markup).toContain('class="composer__footer-button composer__effort"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('composer__effort-icon')
    expect(markup).toContain(`<span class="composer__effort-label">${EFFORT}</span>`)
  })

  // AC2: the offers-nothing arm is the SHIPPED one, reached with a different input — no new element and
  // no sentence of its own. The whole markup is asserted, as the AC3 arm above is.
  it('stays inert when the inherited-default row publishes no levels (AC2)', () => {
    const list: ModelListEntry = {
      models: [GRADED, row({ value: 'default', display_name: 'Inherited default' })],
      droppedModels: 0
    }
    expect(composerEffortMenuModel(list, '', EFFORT)?.options).toStrictEqual([])
    expect(view(list, '', EFFORT)).toBe(
      `<span class="composer__footer-button"><span class="composer__effort-label">${EFFORT}</span></span>`
    )
  })

  // AC3: no inherited-default row published, or no frame at all, and the rendering is today's. LIST
  // publishes three levels on a row an empty model must not fall back to.
  it.each([
    ['no frame has arrived', null],
    ['the daemon published no rows at all', EMPTY],
    ['no inherited-default row is published', LIST]
  ])('offers nothing and stays inert when %s (AC3)', (_why, models) => {
    expect(composerEffortMenuModel(models as ModelListEntry | null, '', EFFORT)).toStrictEqual({
      label: EFFORT,
      currentId: EFFORT,
      options: []
    })
    expect(view(models as ModelListEntry | null, '', EFFORT)).not.toContain('aria-haspopup')
  })

  // AC3: the empty model is the ONLY input taking the new branch — a trim, case fold, prefix or
  // substring introduced on this path fails here rather than passing quietly.
  it.each([' ', '  ', 'DEFAULT', 'Default', 'defaul', 'default-x', ' default', 'default '])(
    'takes the new branch for the empty model alone, never for %j (AC3)',
    (model) => {
      expect(composerEffortMenuModel(WITH_INHERITED, model, EFFORT)?.options).toStrictEqual([])
    }
  )

  it('offers the inherited model levels when effort is unset', () => {
    expect(composerEffortMenuModel(WITH_INHERITED, '', '')?.options.map(o => o.id))
      .toStrictEqual([...INHERITED_LEVELS])
    expect(view(WITH_INHERITED, '', '')).toContain('>Effort</span>')
    expect(view(WITH_INHERITED, '', '')).toContain('aria-haspopup="menu"')
  })
})


describe('applied effort presentation', () => {
  it.each([undefined, null, ''])('keeps %j unselected with a static explanation', effort => {
    const html = renderToStaticMarkup(<ComposerEffortMenuView model={GRADED.value} models={LIST} effort={effort} onSelect={noop} />)
    expect(html).toContain('>Effort</span>')
    expect(html).toContain(effort === null ? 'Claude reports no model effort parameter.' : 'Claude default; applied effort is unavailable.')
    expect(composerEffortMenuModel(LIST, GRADED.value, effort)?.currentId).toBe('')
  })
})


it('shows applied readings over saved and confirmed choices, with pending-only rollback', () => {
  const store = createRunSettingsWriteStore()
  const writes = store.getState()
  const snapshot: RunConfigSnapshot = { model: GRADED.value, effort: 'saved', effectiveEffort: 'applied',
    yolo: false, permissionMode: 'default', usedTokens: 0, windowTokens: 0 }
  const reading = () => selectDisplayedEffort(snapshot, store.getState())
  writes.dispatch({ type: 'changeDispatched', changeId: 'old', change: { field: 'effort', value: 'confirmed' } })
  writes.dispatch({ type: 'settingsConfirmed', changeId: 'old' })
  expect(reading()).toBe('applied')
  writes.dispatch({ type: 'changeDispatched', changeId: 'new', change: { field: 'effort', value: 'pending' } })
  expect(reading()).toBe('pending')
  writes.dispatch({ type: 'settingsRejected', changeId: 'new' })
  expect(reading()).toBe('applied')
  expect(selectDisplayedEffort({ ...snapshot, effectiveEffort: null }, store.getState())).toBeNull()
  writes.dispatch({ type: 'conversationSwitched' })
  expect(selectDisplayedEffort(null, store.getState())).toBeUndefined()
})


it.each([undefined, ''])('keeps a confirmed choice when the applied reading is %s', effectiveEffort => {
  const store = createRunSettingsWriteStore()
  const snapshot: RunConfigSnapshot = { model: GRADED.value, effort: '', effectiveEffort,
    yolo: false, permissionMode: 'default', usedTokens: 0, windowTokens: 0 }
  const dispatch = store.getState().dispatch
  dispatch({ type: 'changeDispatched', changeId: 'pick', change: { field: 'effort', value: EFFORT } })
  expect(selectDisplayedEffort(snapshot, store.getState())).toBe(EFFORT)
  dispatch({ type: 'settingsConfirmed', changeId: 'pick' })
  expect(selectDisplayedEffort(snapshot, store.getState())).toBe(EFFORT)
  const refreshed = { ...snapshot, effort: EFFORT }
  expect(selectDisplayedEffort(refreshed, store.getState())).toBe(EFFORT)

  dispatch({ type: 'changeDispatched', changeId: 'refused', change: { field: 'effort', value: LEVELS[0] } })
  dispatch({ type: 'settingsRejected', changeId: 'refused' })
  expect(selectDisplayedEffort(refreshed, store.getState())).toBe(EFFORT)
  dispatch({ type: 'conversationSwitched' })
  expect(selectDisplayedEffort(null, store.getState())).toBeUndefined()
  // Reopening the chat restores the server's saved choice without a client override.
  expect(selectDisplayedEffort(refreshed, store.getState())).toBe(EFFORT)
  expect(selectDisplayedEffort({ ...refreshed, effectiveEffort: LEVELS[0] }, store.getState())).toBe(LEVELS[0])
  expect(selectDisplayedEffort({ ...refreshed, effectiveEffort: null }, store.getState())).toBeNull()
})

it('describes a selected value without claiming an applied reading', () => {
  const html = renderToStaticMarkup(<ComposerEffortMenuView
    model={GRADED.value} effort={EFFORT} models={LIST} onSelect={noop} selectedOnly
  />)
  expect(html).toContain(EFFORT)
  expect(html).toContain('title="Selected effort; applied effort is unavailable."')
})

it('escapes an applied reading without putting it in any attribute', () => {
  const hostile = '<img src=x onerror=alert(1)>'
  const html = view(LIST, GRADED.value, hostile)
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  expect(html).not.toContain('<img')
  for (const attribute of html.match(/[a-z-]+="[^"]*"/g) ?? []) expect(attribute).not.toContain(hostile)
})
