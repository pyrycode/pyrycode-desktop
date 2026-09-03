import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WireModelOption } from '@shared/wire/types'
import type { ModelListEntry } from '../../store/modelListStore'
import {
  ComposerEffortMenuView,
  COMPOSER_EFFORT_MENU_LABEL,
  composerEffortMenuModel
} from './ComposerEffortMenu'
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

  // AC1's second half, and the posture #988 shipped for the identical case one button to the left.
  // selectEffectiveSettings resolves effort to '' until a run-config snapshot arrives, and that lands on
  // a turn-end edge — ordinary app startup, not an edge case. Nothing is drawn rather than an empty gap.
  // The SHEET takes the opposite posture on this same field for its own reasons; it is not carried over.
  it.each([
    ['a matched row publishing levels', LIST, GRADED.value],
    ['a matched row publishing none', LIST, FLAT.value],
    ['no list at all', null, GRADED.value]
  ])('renders nothing when the session effort is not known, with %s (AC1)', (_why, models, model) => {
    expect(composerEffortMenuModel(models as ModelListEntry | null, model, '')).toBeNull()
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

  it('renders nothing when the session effort is not known', () => {
    expect(view(LIST, GRADED.value, '')).toBe('')
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
