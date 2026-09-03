import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WireModelOption } from '@shared/wire/types'
import type { ModelListEntry } from '../../store/modelListStore'
import {
  ComposerModelMenuView,
  COMPOSER_MODEL_MENU_LABEL,
  composerModelMenuModel
} from './ComposerModelMenu'
import { ComposerOptionsPanel } from './ComposerOptionsPanel'

// #988: two halves, both reachable under this repo's `node` vitest environment — the
// ComposerActionsMenu.test.tsx shape, with the DECISION half moved from a plain array to a plain
// function because this menu's entries are the daemon's rather than the client's.
//
// `onSelect` is NOT exercised here: a static render fires no events, so nothing in this file can click.
// The open → pick → set_session_settings proof is e2e/composer-model-menu.spec.ts.
//
// THE FIXTURE ROWS ARE INVENTED IDENTITIES, and that is AC2's "nothing hardcoded" discharged rather than
// dodged. A fixture naming a real family would let a production bug that derived a label from a family
// token pass unnoticed, and it would also put the very literals the criterion polices into the repo. Every
// assertion below is a DERIVATION over these rows — their display names, in their order, by count — never
// `expect(markup).not.toContain('<some model name>')`, which would type the banned string into the file
// the criterion's own grep reads.

function row(over: Partial<WireModelOption> & Pick<WireModelOption, 'value' | 'display_name'>): WireModelOption {
  return {
    resolved_model: `${over.value}-resolved`,
    effort_levels: [],
    supports_auto_mode: false,
    truncated_fields: null,
    ...over
  }
}

const ROWS: readonly WireModelOption[] = [
  row({ value: 'alpha', display_name: 'Alpha tier' }),
  row({ value: 'beta[1m]', display_name: 'Beta tier' }),
  row({ value: 'gamma', display_name: 'Gamma tier' })
]

const LIST: ModelListEntry = { models: ROWS, droppedModels: 0 }
const EMPTY: ModelListEntry = { models: [], droppedModels: 0 }

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
      /<button[^>]*class="composer__footer-button composer__model"[^>]*>([\s\S]*?)<\/button>/
    )?.[1] ?? ''
  )
}

function view(models: ModelListEntry | null, model: string): string {
  return renderToStaticMarkup(
    <ComposerModelMenuView models={models} model={model} onSelect={noop} />
  )
}

describe('composerModelMenuModel', () => {
  // AC1's whole match rule, as data: exact equality on `value`, and the display name of the row it hit.
  it('labels the trigger with the matched row display name and marks that row (AC1, AC2)', () => {
    expect(composerModelMenuModel(LIST, 'beta[1m]')).toStrictEqual({
      label: 'Beta tier',
      currentId: 'beta[1m]',
      options: ROWS.map((r) => ({ id: r.value, label: r.display_name }))
    })
  })

  // The entries are EXACTLY the published rows, one per entry, in the daemon's order — asserted as a
  // derivation over the seeded array, so a fourth row inherits the guard and no model name is typed here.
  it('offers exactly the published rows, in order, id = value and label = display name (AC2)', () => {
    const menu = composerModelMenuModel(LIST, 'alpha')
    expect(menu?.options.map((o) => o.label)).toStrictEqual(ROWS.map((r) => r.display_name))
    expect(menu?.options.map((o) => o.id)).toStrictEqual(ROWS.map((r) => r.value))
    expect(menu?.options).toHaveLength(ROWS.length)
  })

  // A MISS IS ORDINARY: the verbatim fallback, RunningModelSection's posture. Four near-misses, because
  // "exact equality with no substring, prefix or case-folding match" is four claims rather than one, and a
  // sloppy `includes`/`toLowerCase`/`trim` would pass a single-case test.
  it.each([
    ['a case fold', 'ALPHA'],
    ['a prefix', 'alph'],
    ['a superstring', 'alpha-resolved'],
    ['surrounding whitespace', ' alpha ']
  ])('falls back to the model value verbatim on %s (AC1)', (_why, model) => {
    const menu = composerModelMenuModel(LIST, model)
    expect(menu?.label).toBe(model)
    expect(menu?.currentId).toBeNull()
  })

  // A matched row whose display name is empty is a HIT, not a miss: the daemon published that name and
  // `row ? row.display_name : model` is the RunningModelSection expression that keeps it one. The `??`
  // form would silently print the value instead.
  it('keeps an empty published display name rather than falling back to the value', () => {
    const list: ModelListEntry = { models: [row({ value: 'alpha', display_name: '' })], droppedModels: 0 }
    expect(composerModelMenuModel(list, 'alpha')?.label).toBe('')
  })

  // AC4's two inputs, kept apart by the store and NOT collapsed here: both yield no options, and the
  // label still reads the session's model. `options: []` is what the view renders inert — it never
  // reaches ComposerOptionsMenu, which would open an empty panel.
  it.each([
    ['no frame has arrived', null],
    ['the daemon published an empty list', EMPTY]
  ])('offers nothing but still labels the trigger when %s (AC4)', (_why, models) => {
    expect(composerModelMenuModel(models as ModelListEntry | null, 'alpha')).toStrictEqual({
      label: 'alpha',
      currentId: null,
      options: []
    })
  })

  // The one rendering no AC names: before the daemon answers request_session_settings the effective model
  // is '' (selectEffectiveSettings' final fallback), and there is no name to draw. ContextUsageControl's
  // posture for its own unavailable reading, and #811's no-placeholder rule.
  it('returns null when the session model is not known', () => {
    expect(composerModelMenuModel(LIST, '')).toBeNull()
    expect(composerModelMenuModel(null, '')).toBeNull()
  })

  // Claude may legitimately publish two rows sharing a `value` (RunConfigSections.tsx:303-307). Both are
  // carried and both mark: AC2's "exactly the published rows" outranks the tidier list. Pinned so a later
  // dedupe has to argue with a test rather than look like a cleanup.
  it('carries two rows sharing a value rather than deduping them (AC2)', () => {
    const list: ModelListEntry = {
      models: [row({ value: 'alpha', display_name: 'First' }), row({ value: 'alpha', display_name: 'Second' })],
      droppedModels: 0
    }
    const menu = composerModelMenuModel(list, 'alpha')
    expect(menu?.options.map((o) => o.label)).toStrictEqual(['First', 'Second'])
    expect(menu?.currentId).toBe('alpha')
  })
})

describe('ComposerModelMenuView', () => {
  it('renders the footer trigger inside a composer-options anchor, closed (AC1)', () => {
    const markup = view(LIST, 'alpha')
    expect(markup).toContain('class="composer-options-anchor"')
    expect(markup).toContain('class="composer__footer-button composer__model"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('composer-options__item')
    expect(markup).not.toContain('role="menu"')
  })

  // AC1's label, through the markup — and AC1's SECOND SENTENCE: the label sits in its own element, which
  // is what carries the max-width and the ellipsis that stop a long published name pushing the context
  // reading out of a row with a hard 20px height. A bare text child could not be bounded.
  it('draws the matched display name in its own bounded element (AC1)', () => {
    const markup = view(LIST, 'gamma')
    expect(markup).toContain('<span class="composer__model-label">Gamma tier</span>')
  })

  // The trigger's accessible name is computed from its contents (no aria-label — see the view), so the
  // chevron must stay out of it. ComposerActionsMenu's reasoning, and here it also protects the e2e
  // locator, which has no client-owned constant to fall back on.
  it('hides the chevron from the accessible name', () => {
    const inner = triggerInner(view(LIST, 'alpha'))
    expect(inner).toContain('composer__model-icon')
    expect(inner).toContain('aria-hidden="true"')
    expect(inner.replace(/<svg[\s\S]*?<\/svg>/g, '').trim()).toBe(
      '<span class="composer__model-label">Alpha tier</span>'
    )
  })

  // THE PANEL'S NAME IS CLIENT-OWNED and is NOT the trigger's visible text, unlike ComposerActionsMenu's:
  // this label is claude-authored, and aria-label is an attribute — a sink CLAUDE.md's daemon-text ruling
  // forbids outright. Asserted as an absence of the daemon string from every attribute position.
  it('names the menu with a client-owned constant and puts no daemon text in an attribute', () => {
    const markup = view(LIST, 'alpha')
    expect(COMPOSER_MODEL_MENU_LABEL).toBe('Model')
    expect(markup).not.toContain('aria-label="Alpha tier"')
    for (const attr of markup.match(/[a-z-]+="[^"]*"/g) ?? []) {
      for (const seeded of ROWS) {
        expect(attr).not.toContain(seeded.display_name)
        expect(attr).not.toContain(seeded.value)
      }
    }
  })

  // AC4: not an operable trigger over an empty panel. It announces no popup, has no role, no tabindex and
  // no <button> at all — the sheet's own operable-vs-inert idiom one layer down. The chevron goes with the
  // interactivity it claims.
  it.each([
    ['no frame has arrived', null],
    ['the daemon published an empty list', EMPTY]
  ])('renders an inert label, announcing no popup, when %s (AC4)', (_why, models) => {
    const markup = view(models as ModelListEntry | null, 'alpha')
    expect(markup).toBe(
      '<span class="composer__footer-button"><span class="composer__model-label">alpha</span></span>'
    )
    expect(markup).not.toContain('aria-haspopup')
    expect(markup).not.toContain('composer-options-anchor')
    expect(markup).not.toContain('composer__model-icon')
  })

  it('renders nothing when the session model is not known', () => {
    expect(view(LIST, '')).toBe('')
  })

  // The rows reach the SHARED panel: the menu's own static render cannot show an open panel
  // (useState(false)), so the entries are fed to the panel directly — ComposerActionsMenu.test.tsx's
  // idiom. The MARKING is the half that differs from that menu: this is a choice, not a list of actions.
  it('feeds the published rows to the shared panel with the matched row marked (AC2)', () => {
    const menu = composerModelMenuModel(LIST, 'beta[1m]')
    const markup = renderToStaticMarkup(
      <ComposerOptionsPanel
        options={menu?.options ?? []}
        currentId={menu?.currentId ?? null}
        onSelect={noop}
        ariaLabel={COMPOSER_MODEL_MENU_LABEL}
        focusedIndex={0}
      />
    )
    expect(rowCount(markup)).toBe(ROWS.length)
    for (const seeded of ROWS) expect(markup).toContain(`>${seeded.display_name}<`)
    // Exactly one row is the current one, and it is the matched one.
    expect(countOf(markup, 'aria-current')).toBe(1)
    expect(markup).toContain('aria-current="true">Beta tier<')
  })
})
