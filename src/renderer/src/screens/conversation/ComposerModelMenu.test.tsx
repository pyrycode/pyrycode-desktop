import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WireModelOption } from '@shared/wire/types'
import type { ModelListEntry } from '../../store/modelListStore'
import {
  ComposerModelMenuView,
  COMPOSER_MODEL_MENU_LABEL,
  composerModelMenuModel,
  composerModelRowLabel,
  COMPOSER_MODEL_DEFAULT_LABEL,
  type ComposerModelLayers
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
//
// #1095 MAKES THAT DISCIPLINE MORE LOAD-BEARING, NOT LESS, and the reason is worth stating because the
// obvious reading is the opposite one. This file now derives a FAMILY from daemon text, so the bug the
// invented identities guard against has inverted: it is no longer "a label derived from a family token"
// but "a label derived only for families the client has heard of". An allow-list bug is caught by an
// INVENTED family and hidden by a real one. So the shapes #1095's AC1 enumerates are asserted below with
// invented tokens carrying each shape (`claude-alpha-5`, `claude-alpha-5[1m]`, `claude-alpha-4-5-20251001`,
// `alpha[1m]`, `alpha`) rather than with the real identifiers the criterion spells them in.
//
// `default` is the ONE real literal in this file, and it is not a family name: it is the daemon's own word
// for its inherited default, already seeded here by #1168's block at the bottom.

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

// #1095 — the families the rows above derive to, STATED BY HAND rather than by calling the production
// rule back on itself: a test that re-implements the derivation proves only that it matches itself. Every
// options assertion below indexes this in step with ROWS, so a fourth row has to name its own family here.
//
// The trigger's families for these three rows are the SAME three, because `row()` builds each
// `resolved_model` as the value plus a suffix and a suffix cannot change a leading run of letters. That is
// why the source-chain ORDER needs rows of its own further down — these three cannot tell the two
// sources apart.
const ROW_FAMILIES = ['Alpha', 'Beta', 'Gamma'] as const

const LIST: ModelListEntry = { models: ROWS, droppedModels: 0 }
const EMPTY: ModelListEntry = { models: [], droppedModels: 0 }

const noop = (): void => {}

// #1053 — the three layers, with the ones a case is not exercising left EMPTY, which is this control's
// "nothing at this layer". Every layered case below names only the layers it is about, so a fourth layer
// would not silently change what any of them asserts.
function layers(over: Partial<ComposerModelLayers> = {}): ComposerModelLayers {
  return { picked: '', announced: '', stored: '', ...over }
}

// The snapshot's stored choice ALONE — the single input #988's rules were written against, so every
// assertion it pinned still reads as the sentence it was written as.
//
// #1495 WIDENED IT TO CARRY THE NULL, and the DEFAULT above deliberately stayed `''`: every case written
// before this ticket means "a snapshot arrived and named no model", which is the reading `''` has always
// had here and the one #1423's branch answers. The new reading — no snapshot at all — is spelled out at
// each of its call sites rather than defaulted into, so no existing case changed meaning silently.
function stored(model: string | null): ComposerModelLayers {
  return layers({ stored: model })
}

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

/** The stored-choice-only render — #988's shape, kept so every view assertion it wrote is untouched. */
function view(models: ModelListEntry | null, model: string): string {
  return viewLayers(models, stored(model))
}

function viewLayers(models: ModelListEntry | null, over: ComposerModelLayers): string {
  return renderToStaticMarkup(
    <ComposerModelMenuView models={models} layers={over} onSelect={noop} />
  )
}

describe('composerModelMenuModel', () => {
  // AC1's whole match rule, as data: exact equality on `value`, and — since #1095 — the FAMILY derived
  // from the row it hit rather than that row's display name. The MATCH itself is untouched: `currentId`
  // is still the raw `value`, and the lookup still runs on the raw string.
  it('labels the trigger with the matched row family and marks that row (AC1, AC2)', () => {
    expect(composerModelMenuModel(LIST, stored('beta[1m]'))).toStrictEqual({
      label: 'Beta',
      currentId: 'beta[1m]',
      options: ROWS.map((r, i) => ({ id: r.value, label: ROW_FAMILIES[i] }))
    })
  })

  // The entries are EXACTLY the published rows, one per entry, in the daemon's order — asserted as a
  // derivation over the seeded array, so a fourth row inherits the guard and no model name is typed here.
  // Since #1095 the label is the family of the row's OWN `value`; `id` is untouched and still the raw
  // `value`, which is what keeps the write byte-identical.
  it('offers exactly the published rows, in order, id = value and label = its family (AC2, AC3)', () => {
    const menu = composerModelMenuModel(LIST, stored('alpha'))
    expect(menu?.options.map((o) => o.label)).toStrictEqual([...ROW_FAMILIES])
    expect(menu?.options.map((o) => o.id)).toStrictEqual(ROWS.map((r) => r.value))
    expect(menu?.options).toHaveLength(ROWS.length)
  })

  // A MISS IS ORDINARY. Four near-misses, because "exact equality with no substring, prefix, case-folding
  // or trimming match" is four claims rather than one, and a sloppy `includes`/`toLowerCase`/`trim` would
  // pass a single-case test.
  //
  // #1095 SPLIT WHAT THIS CASE ASSERTS IN TWO, and only one half moved. The MATCHING claim is
  // `currentId === null` and it is untouched — the join still runs on the raw string, and no case fold or
  // trim was added anywhere near it. The LABEL is now derived from the shown string, and it reads that
  // string back unchanged only in the two arms where the derivation is the identity or yields nothing:
  // `ALPHA` keeps its own tail (the rule upper-cases the first letter and holds the rest as claude sent
  // them, so there is no DOWN-fold), and ` alpha ` has no leading ASCII letter at all so it takes the
  // verbatim fallback.
  it.each([
    ['a case fold', 'ALPHA', 'ALPHA'],
    ['a prefix', 'alph', 'Alph'],
    ['a superstring', 'alpha-resolved', 'Alpha'],
    ['surrounding whitespace', ' alpha ', ' alpha ']
  ])('matches no row on %s, labelling from the shown string (AC1)', (_why, model, label) => {
    const menu = composerModelMenuModel(LIST, stored(model))
    expect(menu?.label).toBe(label)
    expect(menu?.currentId).toBeNull()
  })

  // A matched row whose display name is empty is a HIT, not a miss: the daemon published that name and
  // `row ? row.display_name : model` is the RunningModelSection expression that keeps it one. The `??`
  // form would silently print the value instead.
  //
  // #1095 left that expression in place UNDER the derivation as AC4's fallback, so reaching it now takes a
  // row from which no family derives at all — neither field may have a leading ASCII letter. `<unmeasured>`
  // is the literal the captured fixture actually carries on four of its five rows.
  it('keeps an empty published display name rather than falling back to the value', () => {
    const list: ModelListEntry = {
      models: [row({ value: '5', display_name: '', resolved_model: '<unmeasured>' })],
      droppedModels: 0
    }
    expect(composerModelMenuModel(list, stored('5'))?.label).toBe('')
  })

  // AC4's two inputs, kept apart by the store and NOT collapsed here: both yield no options, and the
  // label still reads the session's model. `options: []` is what the view renders inert — it never
  // reaches ComposerOptionsMenu, which would open an empty panel.
  it.each([
    ['no frame has arrived', null],
    ['the daemon published an empty list', EMPTY]
  ])('offers nothing but still labels the trigger when %s (AC4)', (_why, models) => {
    expect(composerModelMenuModel(models as ModelListEntry | null, stored('alpha'))).toStrictEqual({
      label: 'Alpha',
      currentId: null,
      options: []
    })
  })

  // The one rendering no AC names: before the daemon answers request_session_settings the effective model
  // is '' (selectEffectiveSettings' final fallback), and there is no name to draw. ContextUsageControl's
  // posture for its own unavailable reading, and #811's no-placeholder rule.
  //
  // #1423 MADE THE CRITERION CONDITIONAL and this is now its second arm rather than its only one: an
  // empty model resolves the inherited-default row, so nothing is drawn only when there is no such row to
  // resolve. All three of those readings are seeded here — a list without one, no frame at all, and an
  // empty published list — and none of them may start drawing a label with no name behind it.
  it('returns null when no layer has anything and no inherited-default row is published', () => {
    expect(composerModelMenuModel(LIST, layers())).toBeNull()
    expect(composerModelMenuModel(null, layers())).toBeNull()
    expect(composerModelMenuModel(EMPTY, layers())).toBeNull()
  })

  // Claude may legitimately publish two rows sharing a `value` (RunConfigSections.tsx:303-307). Both are
  // carried and both mark: AC2's "exactly the published rows" outranks the tidier list. Pinned so a later
  // dedupe has to argue with a test rather than look like a cleanup.
  it('carries two rows sharing a value rather than deduping them (AC2)', () => {
    const list: ModelListEntry = {
      models: [row({ value: 'alpha', display_name: 'First' }), row({ value: 'alpha', display_name: 'Second' })],
      droppedModels: 0
    }
    const menu = composerModelMenuModel(list, stored('alpha'))
    expect(menu?.options.map((o) => o.label)).toStrictEqual(['Alpha', 'Alpha'])
    expect(menu?.currentId).toBe('alpha')
  })

  // #1095 AC3's own collision case, and it is NOT the one above: two rows with DIFFERENT values that
  // derive to the same family. Both are shown — the derivation is a display rule and may not dedupe, drop
  // or disambiguate — and each still submits its OWN value, which is the half a "tidy the duplicates"
  // change would silently break. The ids are what the panel hands back to `onSelect`.
  it('shows two rows deriving to one family, each still submitting its own value (AC3)', () => {
    const list: ModelListEntry = {
      models: [
        row({ value: 'alpha', display_name: 'Plain' }),
        row({ value: 'alpha[1m]', display_name: 'Wide' })
      ],
      droppedModels: 0
    }
    const menu = composerModelMenuModel(list, stored('alpha'))
    expect(menu?.options).toStrictEqual([
      { id: 'alpha', label: 'Alpha' },
      { id: 'alpha[1m]', label: 'Alpha' }
    ])
  })

  // #1053 AC1 — the state this ticket exists for: a session on the daemon's inherited default carries no
  // choice at any client layer, and before this the control drew nothing at all. The announcement joins
  // the published rows through the SAME rule the session's model joins them by, so a hit shows the row's
  // display name. Nothing is marked: the session's model is still unset, which is AC5's half of this case.
  it('labels the trigger with the announced model when nothing was chosen (AC1)', () => {
    expect(composerModelMenuModel(LIST, layers({ announced: 'gamma' }))).toStrictEqual({
      label: 'Gamma',
      currentId: null,
      options: ROWS.map((r, i) => ({ id: r.value, label: ROW_FAMILIES[i] }))
    })
  })

  // A MISS IS ORDINARY here too, and it is the COMMON case: claude echoes an identifier at least as
  // specific as the one it was given, so an announced identifier need not appear in any published row.
  // #1095 is the reason that stopped mattering to the operator — a miss no longer puts a dated identifier
  // on the row, it derives the same family a hit would.
  it('derives the family of an announced model that matches no published row (AC1)', () => {
    const menu = composerModelMenuModel(LIST, layers({ announced: 'alpha-resolved' }))
    expect(menu?.label).toBe('Alpha')
    expect(menu?.currentId).toBeNull()
  })

  // AC2 AND AC5 IN ONE ASSERTION, and they are the pair a single-string implementation cannot satisfy:
  // the LABEL is the announcement (what is actually running) while the MARKED ROW stays the session's
  // stored choice (what the daemon is set to). Two different questions, two different lookups.
  it('shows the announcement over a disagreeing stored choice, still marking the stored one (AC2, AC5)', () => {
    const menu = composerModelMenuModel(LIST, layers({ announced: 'gamma', stored: 'alpha' }))
    expect(menu?.label).toBe('Gamma')
    expect(menu?.currentId).toBe('alpha')
  })

  // AC3 — a pick outranks both, and the REVERT is the same rule read backwards: dropping the pending
  // record (which is what a rejection does) leaves exactly the second case here, so the label returns to
  // what it showed before the pick. There is no rollback branch to test because there is no rollback
  // branch: the layering IS the rollback.
  it('lets a pick outrank the announcement and returns to it when the pick is dropped (AC3)', () => {
    const picked = layers({ picked: 'beta[1m]', announced: 'gamma', stored: 'alpha' })
    expect(composerModelMenuModel(LIST, picked)?.label).toBe('Beta')
    expect(composerModelMenuModel(LIST, picked)?.currentId).toBe('beta[1m]')
    expect(composerModelMenuModel(LIST, { ...picked, picked: '' })?.label).toBe('Gamma')
  })

  // AC4 — nothing at any layer. An announcement whose model is the EMPTY STRING is a real, degenerate
  // announcement the store holds verbatim rather than collapsing to null; this control cannot draw the
  // distinction, and AC4 states the equivalence itself. The store's null-vs-'' contract is untouched
  // where it was established.
  // AC4's two inputs — no announcement, and an announcement whose model is '' — are ONE input here: the
  // container collapses both to '' because this control has no rendering that could tell them apart, and
  // the criterion names them in a single clause. Asserting them as two arms would be two identical cases
  // in one outcome slot, so the equivalence is stated instead. The `null` half rides through the mounted
  // container in ConversationScreen.test.tsx, where the store sits at its not-yet-announced default and
  // the label is still the session's own model.
  it('draws nothing when no layer has anything to show (AC4)', () => {
    expect(composerModelMenuModel(LIST, layers({ announced: '' }))).toBeNull()
    expect(composerModelMenuModel(LIST, layers({ picked: '', announced: '', stored: '' }))).toBeNull()
  })
})

// #1095 — the family rule and the two source chains it feeds. Driven through `composerModelMenuModel`
// rather than through an export of its own: the derivation has no caller outside this file, and the two
// chains are the only thing worth pinning about it.
describe('composerModelMenuModel — the family rule (#1095)', () => {
  // AC1's shapes, each carried by an INVENTED family so the file's own no-allow-list guard stays live —
  // see the header. Read as a table: strip one leading `claude-`, take the leading run of ASCII letters,
  // upper-case the first and hold the rest as claude sent them. The trailing junk each shape carries —
  // a version, a date, a bracketed context marker, or all three — is what the operator stops seeing.
  //
  // No list is published on this arm, so every input is a MISS and the shown string is the only source.
  it.each([
    ['a prefixed version', 'claude-alpha-5', 'Alpha'],
    ['a prefixed version with a context marker', 'claude-alpha-5[1m]', 'Alpha'],
    ['a prefixed dated identifier', 'claude-alpha-4-5-20251001', 'Alpha'],
    ['a prefixed multi-part version', 'claude-alpha-5-1', 'Alpha'],
    ['a bare alias with a context marker', 'alpha[1m]', 'Alpha'],
    ['a bare alias', 'alpha', 'Alpha'],
    ["the daemon's own inherited-default word", 'default', 'Default'],
    ['a family this client has never heard of', 'claude-newname-6', 'Newname']
  ])('derives the family from %s', (_shape, announced, family) => {
    expect(composerModelMenuModel(null, layers({ announced }))?.label).toBe(family)
  })

  // ONLY ONE leading `claude-` is stripped. A second one is ordinary text and becomes the family, which is
  // the rule answering honestly rather than looping — pinned so a `replaceAll`/`while` rewrite has to
  // argue with a test.
  it('strips exactly one leading claude- prefix', () => {
    expect(composerModelMenuModel(null, layers({ announced: 'claude-claude-alpha-5' }))?.label).toBe(
      'Claude'
    )
  })

  // AC1's "no other case fold": the first letter is upper-cased and the REST is held as claude sent it, so
  // an already-upper tail survives and a mid-string capital is not touched. A `toLowerCase()` anywhere on
  // this path fails both arms.
  it.each([
    ['an upper-case tail', 'aLPHA', 'ALPHA'],
    ['an already-capitalised head', 'Alpha', 'Alpha']
  ])('upper-cases only the first letter, holding the rest verbatim (%s)', (_why, announced, family) => {
    expect(composerModelMenuModel(null, layers({ announced }))?.label).toBe(family)
  })

  // AC4's arm on the trigger's MISS side: no leading ASCII letters anywhere means today's behaviour, the
  // shown string verbatim. Unicode is deliberately out — a non-ASCII head takes this same fallback, which
  // is why `ø` sits beside a digit and a bracket here rather than deriving anything.
  it.each([
    ['a digit head', '5-alpha'],
    ['a bracket head', '<unmeasured>'],
    ['a non-ASCII head', 'ømega-5'],
    ['nothing after the prefix', 'claude-'],
    ['a lone separator', '-']
  ])('falls back to the shown string verbatim on %s (AC4)', (_why, announced) => {
    expect(composerModelMenuModel(null, layers({ announced }))?.label).toBe(announced)
  })

  // AC2's SOURCE CHAIN, and the case the base fixture cannot express: a hit whose two fields name
  // DIFFERENT families. `resolved_model` wins, because the trigger's job is to name what RUNS. Its row
  // still wears its own `value`'s family, which is AC3 read off the same fixture — one row, two answers,
  // and an implementation reading one field for both fails here whichever field it picks.
  it('prefers the matched row resolved_model over its value on the trigger (AC2, AC3)', () => {
    const list: ModelListEntry = {
      models: [row({ value: 'default', display_name: 'Inherited', resolved_model: 'claude-delta-5' })],
      droppedModels: 0
    }
    const menu = composerModelMenuModel(list, stored('default'))
    expect(menu?.label).toBe('Delta')
    expect(menu?.options).toStrictEqual([{ id: 'default', label: 'Default' }])
  })

  // The chain's SECOND step, and it is an ordinary source rather than a guard against an unseen case:
  // `resolved_model` is not reliably populated, and the captured fixture the WireModelOption docblock
  // cites carries this exact literal on four of its five rows. It yields no family, so the trigger falls
  // through to the row's own `value` — NOT to its display name, which is one step further down.
  it('falls through to the matched row value when resolved_model yields no family (AC2)', () => {
    const list: ModelListEntry = {
      models: [row({ value: 'alpha[1m]', display_name: 'Alpha tier', resolved_model: '<unmeasured>' })],
      droppedModels: 0
    }
    expect(composerModelMenuModel(list, stored('alpha[1m]'))?.label).toBe('Alpha')
  })

  // AC4's arm on the trigger's HIT side, and on a ROW — the two places the fallback is a `display_name`
  // rather than the shown string. Both fields of this row yield nothing, so both readings land on the
  // published prose, which is exactly what they render today.
  it('falls back to the published display name when a matched row yields no family (AC4)', () => {
    const list: ModelListEntry = {
      models: [row({ value: '5[1m]', display_name: 'Numbered tier', resolved_model: '<unmeasured>' })],
      droppedModels: 0
    }
    const menu = composerModelMenuModel(list, stored('5[1m]'))
    expect(menu?.label).toBe('Numbered tier')
    expect(menu?.options).toStrictEqual([{ id: '5[1m]', label: 'Numbered tier' }])
  })

  // A ROW NEVER READS ITS `resolved_model`, which is the half AC3 states as a prohibition rather than a
  // rule. Seeded so the two fields disagree AND the row's own family is the one that would be lost: a row
  // deriving from `resolved_model` would read `Delta` here and the panel would show two rows wearing one
  // label while submitting different values.
  it('never derives a row label from its resolved_model (AC3)', () => {
    const list: ModelListEntry = {
      models: [
        row({ value: 'default', display_name: 'Inherited', resolved_model: 'claude-delta-5' }),
        row({ value: 'delta', display_name: 'Delta tier' })
      ],
      droppedModels: 0
    }
    expect(composerModelMenuModel(list, stored('delta'))?.options.map((o) => o.label)).toStrictEqual([
      'Default',
      'Delta'
    ])
  })

  // The MARKING and the WRITE are untouched by all of the above, asserted together because they are the
  // two things a display change must not reach. `currentId` is the raw published `value`, not a family,
  // and it still comes from the SESSION's model rather than from the announcement (#1053 AC5).
  it('leaves the marking and every option id raw, never a derived family (AC5)', () => {
    const menu = composerModelMenuModel(LIST, layers({ announced: 'gamma', stored: 'beta[1m]' }))
    expect(menu?.currentId).toBe('beta[1m]')
    expect(menu?.options.map((o) => o.id)).toStrictEqual(ROWS.map((r) => r.value))
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
  it('draws the matched row family in its own bounded element (AC1)', () => {
    const markup = view(LIST, 'gamma')
    expect(markup).toContain('<span class="composer__model-label">Gamma</span>')
  })

  // #1053 — the announced label reaches the SAME bounded element, which is the whole reason a long dated
  // identifier clips rather than pushing the context reading out of a row with a hard 20px height. That
  // element and its cap are unchanged by #1095; what changed is that a dated identifier no longer reaches
  // it at all, so the bound now protects only the verbatim fallback.
  //
  // THE ATTRIBUTE ABSENCE IS THE SECURITY HALF and #1095 widened it: the announced string must appear in
  // no attribute, AND neither may the DERIVED label — a new string reaching a text position for the first
  // time, which is exactly the kind of value a careless `title`/`aria-label` addition would leak into an
  // attribute sink. Both are asserted over every attribute in the markup.
  it('draws an announced family in the same bounded element, with neither string in an attribute (AC1)', () => {
    const announced = 'claude-alpha-4-5-20251001'
    const markup = viewLayers(LIST, layers({ announced }))
    expect(markup).toContain('<span class="composer__model-label">Alpha</span>')
    expect(markup).not.toContain(announced)
    for (const attr of markup.match(/[a-z-]+="[^"]*"/g) ?? []) {
      expect(attr).not.toContain(announced)
      expect(attr).not.toContain('Alpha')
    }
  })

  // The trigger's accessible name is computed from its contents (no aria-label — see the view), so the
  // chevron must stay out of it. ComposerActionsMenu's reasoning, and here it also protects the e2e
  // locator, which has no client-owned constant to fall back on.
  it('hides the chevron from the accessible name', () => {
    const inner = triggerInner(view(LIST, 'alpha'))
    expect(inner).toContain('composer__model-icon')
    expect(inner).toContain('aria-hidden="true"')
    expect(inner.replace(/<svg[\s\S]*?<\/svg>/g, '').trim()).toBe(
      '<span class="composer__model-label">Alpha</span>'
    )
  })

  // THE PANEL'S NAME IS CLIENT-OWNED and is NOT the trigger's visible text, unlike ComposerActionsMenu's:
  // this label is claude-authored, and aria-label is an attribute — a sink CLAUDE.md's daemon-text ruling
  // forbids outright. Asserted as an absence of the daemon string from every attribute position.
  //
  // #1095 EXTENDS IT TO THE DERIVED LABELS. Each family is a string this client MINTED from daemon text
  // rather than one the daemon sent, so it is not covered by sweeping the seeded rows — and it is the
  // string most likely to look client-owned enough to be dropped into an attribute by a later change.
  it('names the menu with a client-owned constant and puts no daemon text in an attribute', () => {
    const markup = view(LIST, 'alpha')
    expect(COMPOSER_MODEL_MENU_LABEL).toBe('Model')
    expect(markup).not.toContain('aria-label="Alpha"')
    for (const attr of markup.match(/[a-z-]+="[^"]*"/g) ?? []) {
      for (const seeded of ROWS) {
        expect(attr).not.toContain(seeded.display_name)
        expect(attr).not.toContain(seeded.value)
      }
      for (const family of ROW_FAMILIES) expect(attr).not.toContain(family)
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
      '<span class="composer__footer-button"><span class="composer__model-label">Alpha</span></span>'
    )
    expect(markup).not.toContain('aria-haspopup')
    expect(markup).not.toContain('composer-options-anchor')
    expect(markup).not.toContain('composer__model-icon')
  })

  // #1423's second arm through the markup: with no inherited-default row to resolve, an empty model still
  // draws NOTHING — not an empty label element, and not the inert span AC4 renders for a known model with
  // no rows behind it.
  it('renders nothing when no layer has anything and no inherited-default row is published', () => {
    expect(view(LIST, '')).toBe('')
    expect(viewLayers(null, layers())).toBe('')
  })

  // The rows reach the SHARED panel: the menu's own static render cannot show an open panel
  // (useState(false)), so the entries are fed to the panel directly — ComposerActionsMenu.test.tsx's
  // idiom. The MARKING is the half that differs from that menu: this is a choice, not a list of actions.
  it('feeds the published rows to the shared panel with the matched row marked (AC2)', () => {
    const menu = composerModelMenuModel(LIST, stored('beta[1m]'))
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
    for (const family of ROW_FAMILIES) expect(markup).toContain(`>${family}<`)
    // The published prose is GONE from the panel — the half a derivation that only touched the trigger
    // would leave standing.
    for (const seeded of ROWS) expect(markup).not.toContain(seeded.display_name)
    // Exactly one row is the current one, and it is the matched one.
    expect(countOf(markup, 'aria-current')).toBe(1)
    expect(markup).toContain('aria-current="true">Beta<')
  })
})

// #1168 — the guard for a change made in a NEIGHBOURING file. That slice re-points the two EFFORT
// surfaces so an empty session model resolves the inherited-default row (`default`), in its own home
// rather than inside publishedRowFor — which this file's TWO lookups also call. Placed one layer down,
// the marking below would start claiming the inherited-default row was picked on a chat where nobody
// picked anything, and #1053's answer for this control (LAYERING, never a widened join) would be
// silently overwritten. Whether this trigger should mark that row is a separate question, deliberately
// out of that ticket's scope; this pins that it does not start doing so by accident.
//
// #1423 ANSWERED THAT QUESTION AND THIS BLOCK IS UNCHANGED BY IT, which is the whole reason it was worth
// writing: both cases here carry an ANNOUNCEMENT, so the shown string is never '' and the new branch is
// never reached. What #1423 resolves is the state with NO announcement either — see the block below it.
describe('composerModelMenuModel — an inherited-default session (#1168)', () => {
  const INHERITED = row({ value: 'default', display_name: 'Inherited default' })
  const list: ModelListEntry = { models: [...ROWS, INHERITED], droppedModels: 0 }

  it('marks nothing when picked and stored are both empty, whatever the announcement shows', () => {
    const menu = composerModelMenuModel(list, layers({ announced: 'gamma' }))
    expect(menu?.currentId).toBeNull()
    expect(menu?.label).toBe('Gamma')
  })

  // #1095 moved this label from the identifier verbatim to its family; the CLAIM is unchanged and is about
  // the join, not the text — an unmatched announcement must not resolve the inherited-default row, so the
  // family derives from the announcement itself and nothing is marked.
  it('derives an unmatched announcement from itself rather than resolving the inherited-default row', () => {
    const menu = composerModelMenuModel(list, layers({ announced: 'unpublished-identifier' }))
    expect(menu?.label).toBe('Unpublished')
    expect(menu?.currentId).toBeNull()
  })
})

// #1423 — the state the block above deliberately left alone: no pick, no announcement, no stored choice.
// #1053's rendering table calls that "nothing is known about the model" and draws nothing, and a chat on
// the daemon's inherited default sits there PERMANENTLY. Since pyrycode#2085 a conversation's session is
// minted and bound at creation while the claude child is deferred to the first message, so that is now
// every new chat until it is messaged — which is exactly when someone wants to choose the model.
//
// An empty model is not an absence: the wire contract calls it the inherited daemon default, and the
// daemon publishes an ORDINARY ROW for it. So this resolves THAT row — #1168's `effortRowFor`, the one
// home of the substitution — and the row answers both of this function's lookups, because '' as the shown
// string means every layer is '' and the marking's input is '' too.
describe('composerModelMenuModel — a chat with no explicit model (#1423)', () => {
  const INHERITED = row({ value: 'default', display_name: 'Inherited default' })
  const list: ModelListEntry = { models: [...ROWS, INHERITED], droppedModels: 0 }

  // AC1's decision half, all three claims at once: there IS a model now (not null), it is labelled from
  // the inherited-default row, and that row is the marked one. The options are still exactly the published
  // rows in the daemon's order — the inherited row is one of them and is not lifted, hidden or moved.
  it('labels and marks the inherited-default row when no layer has anything (AC1)', () => {
    const menu = composerModelMenuModel(list, layers())
    expect(menu?.label).toBe('Default')
    expect(menu?.currentId).toBe('default')
    expect(menu?.options.map((o) => o.id)).toStrictEqual([...ROWS.map((r) => r.value), 'default'])
  })

  // THE LABEL COMES THROUGH THE EXISTING SOURCE CHAIN, not from a new rule: the trigger reads the matched
  // row's `resolved_model` first and a ROW still reads its own `value` (#1095 AC3). Seeded so the two
  // disagree, because the shared fixture cannot tell them apart — `row()` builds every `resolved_model` as
  // the value plus a suffix, and a suffix cannot change a leading run of letters.
  it('reads the inherited row resolved_model for the trigger and its value for the row (AC1)', () => {
    const only: ModelListEntry = {
      models: [row({ value: 'default', display_name: 'Inherited default', resolved_model: 'claude-zeta-5' })],
      droppedModels: 0
    }
    const menu = composerModelMenuModel(only, layers())
    expect(menu?.label).toBe('Zeta')
    expect(menu?.options).toStrictEqual([{ id: 'default', label: 'Default' }])
    expect(menu?.currentId).toBe('default')
  })

  // AC2: '' IS THE ONLY INPUT THAT TAKES THE BRANCH. Three near-misses of the daemon's own word, because
  // "exact equality, no trim, no case fold, no prefix" is three claims rather than one — and the failure
  // this guards is a substitution written as anything looser than `model === ''`. Each still renders the
  // ordinary miss (a label, nothing marked), which is what it rendered before this slice.
  it.each([
    ['surrounding whitespace', ' '],
    ['the daemon word capitalised', 'Default'],
    ['a superstring', 'default-x']
  ])('leaves the inherited-default row unresolved on %s (AC2)', (_why, model) => {
    const menu = composerModelMenuModel(list, stored(model))
    expect(menu).not.toBeNull()
    expect(menu?.currentId).toBeNull()
  })

  // AC1's rendering half: the OPENABLE trigger, not the inert span AC4 draws and not nothing. The chevron
  // is the design's "this opens a panel" mark and belongs here for the same reason it is withheld there.
  it('draws the openable trigger rather than nothing (AC1)', () => {
    const markup = viewLayers(list, layers())
    expect(markup).toContain('class="composer__footer-button composer__model"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('<span class="composer__model-label">Default</span>')
    expect(markup).toContain('composer__model-icon')
  })

  // The marking reaches the SHARED panel, fed directly — a static render cannot open one. Exactly one row
  // is current and it is the inherited-default row, which is the half `currentId` alone cannot show.
  it('marks the inherited-default row in the shared panel (AC1)', () => {
    const menu = composerModelMenuModel(list, layers())
    const markup = renderToStaticMarkup(
      <ComposerOptionsPanel
        options={menu?.options ?? []}
        currentId={menu?.currentId ?? null}
        onSelect={noop}
        ariaLabel={COMPOSER_MODEL_MENU_LABEL}
        focusedIndex={0}
      />
    )
    expect(countOf(markup, 'aria-current')).toBe(1)
    expect(markup).toContain('aria-current="true">Default<')
  })
})

// #1495 — the reading the block above could not express, and the one the store has held one layer down
// since #1167: NO SNAPSHOT HAS ARRIVED FOR THIS CHAT. `runConfigStore`'s header calls `snapshot: null` the
// distinct not-yet-loaded state and `clearSnapshot` returns to it on every activation; until this ticket
// the container flattened it into `''`, so "nothing is known" and "the snapshot says the daemon's
// inherited default" reached this function as one input and #1423's branch answered both.
//
// The two readings differ by this one layer and by nothing else, which is why every case here seeds the
// #1423 fixture verbatim: same list, same published inherited-default row, same empty pick and
// announcement. A guard written on anything but the null — a truthiness test, a `== null`, a check moved
// onto `shown` — either stops #1423's branch firing at all or fails to separate the two.
describe('composerModelMenuModel — no snapshot has arrived (#1495)', () => {
  const INHERITED = row({ value: 'default', display_name: 'Inherited default' })
  const list: ModelListEntry = { models: [...ROWS, INHERITED], droppedModels: 0 }

  // AC1, stated against the exact input #1423 draws a label for. The list is HELD — the activation clear
  // never touches `modelListStore`, which is what made the old flattening visible on a switch — so a
  // resolvable inherited-default row is present and must still not be resolved.
  it('draws nothing with no snapshot, even holding a list with an inherited-default row (AC1)', () => {
    expect(composerModelMenuModel(list, stored(null))).toBeNull()
    expect(viewLayers(list, stored(null))).toBe('')
  })

  // AC2, and it is the same fixture one input apart — the pair is the claim, not either half alone. This
  // is #1423's landed rendering unchanged: the label, the marking and the published rows in daemon order.
  it('still resolves the inherited-default row on an explicitly empty model (AC2)', () => {
    const menu = composerModelMenuModel(list, stored(''))
    expect(menu?.label).toBe('Default')
    expect(menu?.currentId).toBe('default')
    expect(menu?.options.map((o) => o.id)).toStrictEqual([...ROWS.map((r) => r.value), 'default'])
  })

  // The guard is on #1423's BRANCH, not on the function: a pick or an announcement still labels over a
  // missing snapshot, and each still marks what it marked before — the pick's own row, and nothing for an
  // announcement (#1053 AC5: the marking is the session's model and never the announcement).
  it('labels from a pick or an announcement over a missing snapshot', () => {
    const announced = composerModelMenuModel(list, layers({ stored: null, announced: 'gamma' }))
    expect(announced?.label).toBe('Gamma')
    expect(announced?.currentId).toBeNull()
    const picked = composerModelMenuModel(list, layers({ stored: null, picked: 'alpha' }))
    expect(picked?.label).toBe('Alpha')
    expect(picked?.currentId).toBe('alpha')
  })

  // The absent rendering is #988's own, reached by the path it already had: with no inherited-default row
  // published, an explicitly empty model draws nothing either, and a missing snapshot is not a second way
  // of getting there that behaves differently. Three list readings, the same as #1423's null case seeds.
  it.each([
    ['a list without an inherited-default row', LIST],
    ['no model_list frame at all', null],
    ['an empty published list', EMPTY]
  ])('draws nothing on %s, snapshot or none', (_why, models) => {
    expect(composerModelMenuModel(models, stored(null))).toBeNull()
    expect(composerModelMenuModel(models, stored(''))).toBeNull()
  })
})

// #1651 — a MERGED list, the shape every conversation receives once `multi_agent` is advertised: the Claude
// rows first, then one Codex row per family. The Codex rows are invented too; each `display_name` differs
// from anything a family rule could derive from its `value` or `resolved_model`, so a client-built name
// cannot pass as the daemon's.
describe('#1651 — the menu offers only the conversation agent\'s rows', () => {
  const CODEX_ROWS: readonly WireModelOption[] = [
    row({ value: 'delta', display_name: 'Vendor Delta face', resolved_model: 'vendor-6-delta', agent: 'codex', family: 'delta' }),
    row({ value: 'epsilon', display_name: 'Vendor Epsilon face', resolved_model: 'vendor-6-epsilon', agent: 'codex', family: 'epsilon' })
  ]
  const CLAUDE_ROWS: readonly WireModelOption[] = [
    row({ value: 'default', display_name: 'Default tier', agent: 'claude' }),
    ...ROWS
  ]
  const MERGED: ModelListEntry = { models: [...CLAUDE_ROWS, ...CODEX_ROWS], droppedModels: 0 }

  it('lists only Claude rows, in the daemon\'s order and with today\'s labels, on a Claude conversation', () => {
    const claude = composerModelMenuModel(MERGED, stored('beta[1m]'), 'claude')
    const untagged = composerModelMenuModel({ models: CLAUDE_ROWS, droppedModels: 0 }, stored('beta[1m]'))
    expect(claude).toEqual(untagged)
    expect(claude?.options.map((o) => o.id)).toEqual(['default', 'alpha', 'beta[1m]', 'gamma'])
    expect(claude?.options.map((o) => o.label)).toEqual(['Default', ...ROW_FAMILIES])
    expect(claude?.label).toBe('Beta')
  })

  it('lists only Codex rows with each display_name verbatim on a Codex conversation', () => {
    const menu = composerModelMenuModel(MERGED, stored('delta'), 'codex')
    expect(menu?.options).toEqual([
      { id: 'delta', label: 'Vendor Delta face' },
      { id: 'epsilon', label: 'Vendor Epsilon face' }
    ])
    // The trigger over a hit is the row's display_name, never a family of its resolved_model.
    expect(menu?.label).toBe('Vendor Delta face')
    expect(menu?.currentId).toBe('delta')
  })

  it('never matches a Claude row from a Codex conversation, or a Codex row from a Claude one', () => {
    expect(composerModelMenuModel(MERGED, stored('alpha'), 'codex')?.currentId).toBeNull()
    expect(composerModelMenuModel(MERGED, stored('delta'), 'claude')?.currentId).toBeNull()
  })

  it('shows a Codex miss verbatim rather than deriving a family from it', () => {
    const menu = composerModelMenuModel(MERGED, layers({ announced: 'vendor-6-delta', stored: 'delta' }), 'codex')
    expect(menu?.label).toBe('vendor-6-delta')
    expect(menu?.currentId).toBe('delta')
  })

  it('reads Default, marks nothing and still offers the Codex rows with no model set', () => {
    const menu = composerModelMenuModel(MERGED, stored(''), 'codex')
    expect(menu).toEqual({
      label: COMPOSER_MODEL_DEFAULT_LABEL,
      currentId: null,
      options: [
        { id: 'delta', label: 'Vendor Delta face' },
        { id: 'epsilon', label: 'Vendor Epsilon face' }
      ]
    })
    const markup = renderToStaticMarkup(
      <ComposerModelMenuView models={MERGED} layers={stored('')} agent="codex" onSelect={noop} />
    )
    expect(triggerInner(markup)).toContain('>Default</span>')
    expect(markup).toContain('aria-haspopup')
    expect(countOf(markup, 'aria-current')).toBe(0)
    // Claude's unset model still resolves the daemon's own `default` row.
    expect(composerModelMenuModel(MERGED, stored(''), 'claude')?.currentId).toBe('default')
  })

  it('draws nothing on a Codex conversation before any snapshot', () => {
    expect(composerModelMenuModel(MERGED, stored(null), 'codex')).toBeNull()
  })

  it('offers nothing on a Codex conversation whose list carries only untagged rows', () => {
    expect(composerModelMenuModel(LIST, stored('alpha'), 'codex')?.options).toEqual([])
  })

  it('labels a row by its own agent', () => {
    expect(composerModelRowLabel(CODEX_ROWS[0])).toBe('Vendor Delta face')
    expect(composerModelRowLabel(ROWS[1])).toBe('Beta')
    expect(composerModelRowLabel(row({ value: '[1m]', display_name: 'Opaque tier' }))).toBe('Opaque tier')
  })
})
