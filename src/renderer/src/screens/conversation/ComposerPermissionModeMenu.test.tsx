import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WireModelOption } from '@shared/wire/types'
import type { ModelListEntry } from '../../store/modelListStore'
import {
  AUTO_PERMISSION_MODE,
  ComposerPermissionModeMenu,
  ComposerPermissionModeMenuView,
  COMPOSER_PERMISSION_MODE_MENU_LABEL,
  PERMISSION_MODE_LABELS,
  SETTABLE_PERMISSION_MODES,
  composerPermissionModeMenuModel
} from './ComposerPermissionModeMenu'
import { ComposerOptionsPanel } from './ComposerOptionsPanel'
import { runConfigStore } from '../../store/runConfigStore'
import { runSettingsWriteStore } from '../../store/runSettingsWriteStore'
import { sessionIdStore } from '../../store/sessionIdStore'
import { sessionFactsStore } from '../../store/sessionFactsStore'

it('renders only the settings report through pending, acknowledged and unavailable modes', () => {
  vi.spyOn(runConfigStore, 'getInitialState').mockImplementation(runConfigStore.getState)
  vi.spyOn(runSettingsWriteStore, 'getInitialState').mockImplementation(runSettingsWriteStore.getState)
  vi.spyOn(sessionIdStore, 'getInitialState').mockImplementation(sessionIdStore.getState)
  vi.spyOn(sessionFactsStore, 'getInitialState').mockImplementation(sessionFactsStore.getState)
  const snapshot = { model: '', effort: '', yolo: false, permissionMode: 'bypassPermissions', usedTokens: 0, windowTokens: 0 }
  sessionIdStore.getState().setSessionId('resolved')
  sessionFactsStore.getState().setSessionFacts({ conversationId: 'chat', claudeCodeVersion: '', permissionMode: 'default', truncatedFields: null })
  const render = () => renderToStaticMarkup(<ComposerPermissionModeMenu conversationId="chat" />)
  try {
    runConfigStore.getState().setSnapshot(snapshot)
    runSettingsWriteStore.getState().dispatch({ type: 'changeDispatched', changeId: 'pick', change: { field: 'permissionMode', value: 'default' } })
    expect(render()).toContain('Bypass approvals')
    runSettingsWriteStore.getState().dispatch({ type: 'settingsConfirmed', changeId: 'pick' })
    expect(render()).toContain('Bypass approvals')
    runConfigStore.getState().setSnapshot({ ...snapshot, permissionMode: 'plan' })
    expect(render()).toContain('Plan')
    runConfigStore.getState().setSnapshot({ ...snapshot, permissionMode: '' })
    expect(render()).toBe('')
  } finally {
    runConfigStore.getState().clearSnapshot()
    runSettingsWriteStore.getState().dispatch({ type: 'conversationSwitched' })
    sessionIdStore.getState().clearSessionId()
    sessionFactsStore.getState().clearSessionFacts()
    vi.restoreAllMocks()
  }
})

// #682: ComposerEffortMenu.test.tsx's two halves — the decision as a plain function, then the markup.
// `onSelect` is NOT exercised here: a static render fires no events, so nothing in this file can click.
// The open → pick → set_session_settings proof is e2e/composer-permission-mode-menu.spec.ts.
//
// THE FIXTURE MODES ARE THE REAL ONES, and that inverts the sibling files' rule rather than breaking it.
// The effort and model menus invent their fixtures because their vocabularies are the DAEMON's and a
// client-side copy is the bug those tickets exist to prevent. This menu's five entries are a CLIENT-OWNED
// constant — the whole point of the design — so the vocabulary belongs in the repo, and a test that
// invented one would assert nothing about the thing that ships. What is derived rather than typed is every
// COUNT and every membership claim, so a sixth mode inherits the guards.

const BYPASS = 'bypassPermissions'

// The one mode the read half reports and the write half refuses. Held as a const so the entries guard
// below reads as a membership claim rather than as a literal typed beside the list it polices.
const KNOWN_MODES = Object.keys(PERMISSION_MODE_LABELS)

// #1022 — the entries the daemon can never take away, derived rather than typed: a four-name list here
// would be a second copy of the vocabulary, and it would keep passing if the filter dropped the wrong
// mode. This is also AC4's floor — the offered list is never shorter than these four.
const UNCONDITIONAL_MODES = SETTABLE_PERMISSION_MODES.filter((m) => m !== AUTO_PERMISSION_MODE)

// #1022 — the model-list fixtures. The VALUES ARE INVENTED, the sibling files' rule: these are the
// DAEMON's strings, so seeding a measured alias would let a production path that matched on something
// other than exact equality pass unnoticed. Mutually non-substring, so a widened comparison would be
// visible rather than accidentally right.
function row(
  over: Partial<WireModelOption> & Pick<WireModelOption, 'value' | 'display_name'>
): WireModelOption {
  return {
    resolved_model: `${over.value}-resolved`,
    effort_levels: [],
    supports_auto_mode: true,
    truncated_fields: null,
    ...over
  }
}

const REFUSING = row({ value: 'refuser', display_name: 'Refusing pick', supports_auto_mode: false })
const ACCEPTING = row({ value: 'accepter', display_name: 'Accepting pick', supports_auto_mode: true })

// One list carrying both readings, which is what the daemon really sends — so every case below picks
// its row by the MODEL it joins on rather than by which list it was handed.
const LIST: ModelListEntry = { models: [REFUSING, ACCEPTING], droppedModels: 0 }
const EMPTY: ModelListEntry = { models: [], droppedModels: 0 }

const noop = (): void => {}

/** The trigger button's inner markup — what a browser computes the accessible name from. */
function triggerInner(markup: string): string {
  return (
    markup.match(
      /<button[^>]*class="composer__footer-button composer__permission"[^>]*>([\s\S]*?)<\/button>/
    )?.[1] ?? ''
  )
}

// #1022 — the model list and the session's model arrive as TRAILING OPTIONAL parameters, defaulting to
// the reading that was this control's only one until now: no list published, no model known. Every
// shipped case below therefore keeps reading as a one-argument call AND becomes evidence for AC2's
// fail-open rule at the same time, since that default is precisely the unknown reading.
function view(permissionMode: string, models: ModelListEntry | null = null, model = ''): string {
  return renderToStaticMarkup(
    <ComposerPermissionModeMenuView
      model={model}
      permissionMode={permissionMode}
      models={models}
      onSelect={noop}
    />
  )
}

// ComposerOptionsPanel.test.tsx's counter — count ROWS, so the panel div cannot inflate the count and a
// current row still counts exactly once.
function rowCount(markup: string): number {
  return markup.match(/class="composer-options__item["\s]/g)?.length ?? 0
}

function countOf(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

/** A label as it appears IN THE MARKUP, which is not always the label. `Don't ask` renders as
 *  `Don&#x27;ask` — React escapes a text child, which is the security property this whole boundary rests
 *  on, and it applies to the client-owned labels too. Derived from React rather than hand-rolled, so this
 *  file cannot disagree with the renderer about what escaping means. (Playwright is unaffected: it reads
 *  DOM text, not markup, so the e2e locators match the label verbatim.) */
function rendered(text: string): string {
  return renderToStaticMarkup(<>{text}</>)
}

function panel(permissionMode: string, models: ModelListEntry | null = null, model = ''): string {
  const menu = composerPermissionModeMenuModel(models, model, permissionMode)
  return renderToStaticMarkup(
    <ComposerOptionsPanel
      options={menu?.options ?? []}
      currentId={menu?.currentId ?? null}
      onSelect={noop}
      ariaLabel={COMPOSER_PERMISSION_MODE_MENU_LABEL}
      focusedIndex={0}
    />
  )
}

describe('the vocabulary', () => {
  // THE ASYMMETRY, pinned as two counts rather than as prose. The read half reports six modes and the
  // write half accepts five; this control therefore renders six labels and offers five entries. A
  // contributor adding the sixth entry "for symmetry" would be adding a one-click privilege escalation to
  // the footer, and this is the test that stops them.
  it('renders six labels and offers five entries (AC2)', () => {
    expect(KNOWN_MODES).toHaveLength(6)
    expect(SETTABLE_PERMISSION_MODES).toHaveLength(5)
  })

  it('never offers the escalation mode, and still knows how to label it (AC2)', () => {
    expect(SETTABLE_PERMISSION_MODES).not.toContain(BYPASS)
    expect(KNOWN_MODES).toContain(BYPASS)
  })

  // Every settable mode is labelled, so no entry can render its raw camelCase identifier — a derivation
  // over the constant, so a sixth settable mode inherits it.
  it('labels every mode it offers', () => {
    for (const mode of SETTABLE_PERMISSION_MODES) expect(KNOWN_MODES).toContain(mode)
  })
})

describe('permission mode display copy', () => {
  it.each([
    ['default', 'Manual approval'],
    ['acceptEdits', 'Auto-approve edits'],
    ['plan', 'Plan'],
    ['auto', 'Auto approval'],
    ['dontAsk', 'Approved actions only'],
    ['bypassPermissions', 'Bypass approvals']
  ])('names %s by its behaviour in the trigger', (mode, label) => {
    expect(triggerInner(view(mode))).toContain(
      `<span class="composer__permission-label">${label}</span>`
    )
  })

  it('pairs the new menu labels with the existing selectable values', () => {
    const options = [
      { id: 'default', label: 'Manual approval' },
      { id: 'acceptEdits', label: 'Auto-approve edits' },
      { id: 'plan', label: 'Plan' },
      { id: 'auto', label: 'Auto approval' },
      { id: 'dontAsk', label: 'Approved actions only' }
    ]
    expect(composerPermissionModeMenuModel(null, '', 'default')?.options).toEqual(options)
    const markup = panel('default')
    for (const { label } of options) expect(markup).toContain(`>${label}<`)
    expect(markup).not.toContain('Bypass approvals')
  })
})

describe('composerPermissionModeMenuModel', () => {
  // AC1 and AC2 in one shape: the label is the DISPLAY name for the session's mode, the entries are the
  // five settable modes with the machine value as `id`, and the current one is the session's mode itself.
  it('labels the trigger with the display name and offers the five settable modes (AC1, AC2)', () => {
    expect(composerPermissionModeMenuModel(null, '', 'acceptEdits')).toStrictEqual({
      label: PERMISSION_MODE_LABELS.acceptEdits,
      currentId: 'acceptEdits',
      options: SETTABLE_PERMISSION_MODES.map((mode) => ({
        id: mode,
        label: PERMISSION_MODE_LABELS[mode]
      }))
    })
  })

  // The entries never move with the session's mode: same five, same order, whatever is running — which is
  // what makes "exactly the five settable modes" true for the bypass reading too.
  it.each([...SETTABLE_PERMISSION_MODES, BYPASS, 'a-mode-this-client-has-never-heard-of'])(
    'offers the same five entries, in order, while the session runs %s (AC2)',
    (mode) => {
      const menu = composerPermissionModeMenuModel(null, '', mode)
      expect(menu?.options.map((o) => o.id)).toStrictEqual([...SETTABLE_PERMISSION_MODES])
      expect(menu?.options.map((o) => o.id)).not.toContain(BYPASS)
    }
  )

  // AC1's second half. selectEffectiveSettings resolves permissionMode to '' until a run-config snapshot
  // arrives, and the snapshot lands on a turn-end edge, so that window is ordinary app startup rather than
  // an edge case. '' is ALSO the daemon's own "no session was resolved" reading (runConfigStore) — one
  // string, two ways to reach it, one rendering: nothing at all, rather than an empty gap where a label
  // belongs. The model and effort triggers beside it take the same posture.
  it('renders nothing when no mode is known (AC1)', () => {
    expect(composerPermissionModeMenuModel(null, '', '')).toBeNull()
  })

  // AC2's bypass half, at the decision layer. A session sitting in bypass is a real, reachable state — the
  // run-configuration sheet's YOLO toggle puts it there — and this control must name it honestly while
  // offering only what it may send. currentId matching no entry marks nothing through the panel's existing
  // branch: no special case, no null arm, and emphatically not a reason to withhold the menu.
  it('labels a session in bypass and still offers the five (AC2)', () => {
    const menu = composerPermissionModeMenuModel(null, '', BYPASS)
    expect(menu?.label).toBe(PERMISSION_MODE_LABELS[BYPASS])
    expect(menu?.currentId).toBe(BYPASS)
    expect(menu?.options).toHaveLength(SETTABLE_PERMISSION_MODES.length)
  })

  it.each(KNOWN_MODES)('labels %s with its display name (AC1)', (mode) => {
    expect(composerPermissionModeMenuModel(null, '', mode)?.label).toBe(PERMISSION_MODE_LABELS[mode])
  })

  // The reading runConfigSnapshot's own test assigns here: what to DISPLAY for a mode this client does not
  // know. Verbatim — the daemon's value, held as it is, the RunningModelSection posture. No invented name,
  // no coercion to `default`, and no exact-equality slop: a near-miss of a known mode is unknown.
  it.each([
    ['an unrecognised mode', 'ultraPermissive'],
    ['a case fold of a known mode', 'AcceptEdits'],
    ['a superstring of a known mode', 'acceptEditsAndMore'],
    ['surrounding whitespace', ' plan ']
  ])('renders %s verbatim rather than mapping it (AC1)', (_why, mode) => {
    expect(composerPermissionModeMenuModel(null, '', mode)?.label).toBe(mode)
  })

  // THE LOOKUP IS KEYED BY A DAEMON-CONTROLLED STRING, so it must be an own-property read. A bare
  // `LABELS[mode]` returns a function for `constructor` and an object for `__proto__` — neither is
  // undefined, so a `?? mode` fallback does not catch them, and a non-string reaching a JSX child position
  // throws inside React: one field of one daemon frame takes the conversation screen down. The label must
  // be the mode string itself, and the render must survive.
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'reads %s as an unknown mode rather than an inherited property',
    (mode) => {
      expect(composerPermissionModeMenuModel(null, '', mode)?.label).toBe(mode)
      expect(view(mode)).toContain(`<span class="composer__permission-label">${mode}</span>`)
      // #1022 drove the join in beside this lookup, so the guard is re-asserted WITH a matched row
      // present rather than left to the no-list reading: the new code must not have added a second
      // place a daemon-controlled string indexes a plain object.
      expect(composerPermissionModeMenuModel(LIST, REFUSING.value, mode)?.label).toBe(mode)
      expect(view(mode, LIST, REFUSING.value)).toContain(
        `<span class="composer__permission-label">${mode}</span>`
      )
    }
  )
})

// #1022 — the one entry the daemon can take away. `WireModelOption.supports_auto_mode` says whether the
// running model accepts claude's `auto` permission mode; claude refuses it per model. The operator ruled
// on 2026-09-04 that a refused mode is HIDDEN rather than greyed, so the shared panel gains no state and
// this menu simply offers one fewer entry.
//
// THE ASYMMETRY THAT MAKES THIS SAFE, and the reason every assertion below is a derivation: the offered
// list is the client-owned constant MINUS one named mode. It is never computed FROM the row, so the
// worst a hostile flag achieves is removing `auto` — it can neither hide `default` and `plan` nor add
// the escalation. `UNCONDITIONAL_MODES` is derived for exactly that reason; a typed four-name list would
// keep passing if the filter dropped the wrong mode.
describe('the auto mode a model can refuse', () => {
  // The filter names ONE string, and this is what stops a rename from silently disabling it: the mode it
  // removes has to be a mode the menu actually offers.
  it('filters a mode that is really in the settable list', () => {
    expect(SETTABLE_PERMISSION_MODES).toContain(AUTO_PERMISSION_MODE)
    expect(UNCONDITIONAL_MODES).toHaveLength(SETTABLE_PERMISSION_MODES.length - 1)
    expect(UNCONDITIONAL_MODES).not.toContain(AUTO_PERMISSION_MODE)
  })

  // AC1. The other four in their EXISTING order — the filter drops an entry, it does not reorder or
  // rebuild the list.
  it('offers the other four modes in order and no auto entry (AC1)', () => {
    const menu = composerPermissionModeMenuModel(LIST, REFUSING.value, 'plan')
    expect(menu?.options.map((o) => o.id)).toStrictEqual([...UNCONDITIONAL_MODES])
    expect(menu?.options.map((o) => o.label)).toStrictEqual(
      UNCONDITIONAL_MODES.map((mode) => PERMISSION_MODE_LABELS[mode])
    )
  })

  // AC2, as ONE table rather than five tests, because these are one reading: the client does not
  // positively know the model refuses `auto`. Every row here must offer all five, and the last two are
  // the ones a fail-CLOSED implementation would get wrong.
  it.each([
    ['no list has been published for the conversation', null, REFUSING.value],
    ['the published list is empty', EMPTY, REFUSING.value],
    ['the session model matches no published row', LIST, 'a-model-in-no-row'],
    // The truncation shape: the daemon cut this row's `value`, so what it published is a PREFIX of the
    // session's model and exact equality misses. No prefix, substring or case-fold rescue is wanted —
    // a miss is the unknown reading, and the unknown reading offers the mode.
    ['the published value was cut mid-token', LIST, `${REFUSING.value}-full`],
    ['a case fold of the published value', LIST, REFUSING.value.toUpperCase()],
    ['the matched row accepts auto', LIST, ACCEPTING.value]
  ])('offers all five modes when %s (AC2)', (_why, models, model) => {
    const menu = composerPermissionModeMenuModel(models, model, 'plan')
    expect(menu?.options.map((o) => o.id)).toStrictEqual([...SETTABLE_PERMISSION_MODES])
  })

  // The reading no conforming frame produces, and the one that decides the shape of the comparison.
  // `parseModelList`'s requireBoolean throws on a non-boolean and drops the whole frame, so this row
  // cannot arrive through the shipped path — but `WireModelOption`'s docblock records that a frame
  // reached through a bare `as` yields `undefined` for a field the type declares required. The entry
  // must stay OFFERED: only a row SAYING false hides it, and `!row.supports_auto_mode` would instead act
  // on a flag the client never received.
  it('offers auto when the flag is absent rather than false (AC2)', () => {
    const absent = { ...REFUSING, supports_auto_mode: undefined } as unknown as WireModelOption
    const menu = composerPermissionModeMenuModel(
      { models: [absent], droppedModels: 0 },
      absent.value,
      'plan'
    )
    expect(menu?.options.map((o) => o.id)).toStrictEqual([...SETTABLE_PERMISSION_MODES])
  })

  // AC3. Hiding an entry never changes what the TRIGGER says. A session already running `auto` on a
  // model that refuses it is a real, reachable state — the operator may have set it elsewhere, or the
  // model may have changed under a running session — and this control names it honestly while offering
  // only what it may send. Nothing is marked, through the same no-matching-entry branch the bypass
  // reading already uses: no special case, and emphatically not a reason to withhold the menu.
  it('still labels a session running auto on a refusing model, and marks nothing (AC3)', () => {
    const menu = composerPermissionModeMenuModel(LIST, REFUSING.value, AUTO_PERMISSION_MODE)
    expect(menu?.label).toBe(PERMISSION_MODE_LABELS[AUTO_PERMISSION_MODE])
    expect(menu?.currentId).toBe(AUTO_PERMISSION_MODE)
    const markup = panel(AUTO_PERMISSION_MODE, LIST, REFUSING.value)
    expect(rowCount(markup)).toBe(UNCONDITIONAL_MODES.length)
    expect(countOf(markup, 'aria-current')).toBe(0)
    expect(markup).not.toContain(rendered(PERMISSION_MODE_LABELS[AUTO_PERMISSION_MODE]))
    expect(view(AUTO_PERMISSION_MODE, LIST, REFUSING.value)).toContain(
      `<span class="composer__permission-label">${rendered(PERMISSION_MODE_LABELS[AUTO_PERMISSION_MODE])}</span>`
    )
  })

  // AC4's floor, across every row shape at once: this menu still has no nothing-to-offer arm. Its
  // entries are a client-owned vocabulary of which exactly one is conditional, so the list can never
  // fall below four and the trigger can never go inert — which is what still separates this control
  // from both its neighbours, whose entire entry list is the daemon's.
  it.each([
    ['a refusing row', LIST, REFUSING.value],
    ['an accepting row', LIST, ACCEPTING.value],
    ['an empty list', EMPTY, REFUSING.value],
    ['no list at all', null, REFUSING.value]
  ])('keeps an operable trigger and at least four entries with %s (AC4)', (_why, models, model) => {
    const menu = composerPermissionModeMenuModel(models, model, 'plan')
    expect(menu?.options.length).toBeGreaterThanOrEqual(UNCONDITIONAL_MODES.length)
    const markup = view('plan', models, model)
    expect(markup).toContain('class="composer-options-anchor"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('composer__permission-icon')
    // No inert arm was added alongside the filter: the trigger is a <button>, never the bare <span> the
    // model and effort menus fall back to.
    expect(markup).toContain('class="composer__footer-button composer__permission"')
  })

  // The panel-level proof of AC1, through the shared component and with no prop added to it: four rows,
  // the session's mode marked, and the hidden mode's display name absent from the panel entirely.
  it('feeds four rows to the shared panel with the current one marked (AC1)', () => {
    const markup = panel('plan', LIST, REFUSING.value)
    expect(rowCount(markup)).toBe(UNCONDITIONAL_MODES.length)
    for (const mode of UNCONDITIONAL_MODES) {
      expect(markup).toContain(`>${rendered(PERMISSION_MODE_LABELS[mode])}<`)
    }
    expect(markup).not.toContain(rendered(PERMISSION_MODE_LABELS[AUTO_PERMISSION_MODE]))
    expect(countOf(markup, 'aria-current')).toBe(1)
    expect(markup).toContain(`aria-current="true">${rendered(PERMISSION_MODE_LABELS.plan)}<`)
  })
})

describe('ComposerPermissionModeMenuView', () => {
  it('renders the footer trigger inside a composer-options anchor, closed (AC1)', () => {
    const markup = view('plan')
    expect(markup).toContain('class="composer-options-anchor"')
    expect(markup).toContain('class="composer__footer-button composer__permission"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('composer-options__item')
    expect(markup).not.toContain('role="menu"')
  })

  // AC1's label through the markup, and its bound: the value sits in its OWN element, which is what
  // carries the max-width and the ellipsis. The KNOWN arm draws a client-owned constant; the unknown arm
  // above draws daemon text through this same element, which is why the bound is unconditional.
  it('draws the mode in its own bounded element (AC1)', () => {
    expect(view('acceptEdits')).toContain(
      `<span class="composer__permission-label">${rendered(PERMISSION_MODE_LABELS.acceptEdits)}</span>`
    )
  })

  // The trigger's accessible name is computed from its contents (no aria-label — see the view), so the
  // chevron must stay out of it. It also protects the e2e locator, which matches the label exactly.
  it('hides the chevron from the accessible name', () => {
    const inner = triggerInner(view('plan'))
    expect(inner).toContain('composer__permission-icon')
    expect(inner).toContain('aria-hidden="true"')
    expect(inner.replace(/<svg[\s\S]*?<\/svg>/g, '').trim()).toBe(
      `<span class="composer__permission-label">${rendered(PERMISSION_MODE_LABELS.plan)}</span>`
    )
  })

  // THE PANEL'S NAME IS CLIENT-OWNED and is NOT the trigger's visible text. The trigger's label is a
  // client-owned constant on the known arm, but daemon text on the unknown one, and aria-label is an
  // ATTRIBUTE — a sink CLAUDE.md's daemon-text ruling forbids outright. Asserted as the absence of the
  // daemon-reported string from every attribute position, which also covers `title`, `data-*` and any
  // attribute this trigger grows later.
  it('names the menu with a client-owned constant and puts no daemon text in an attribute', () => {
    expect(COMPOSER_PERMISSION_MODE_MENU_LABEL).toBe('Permission mode')
    const reported = 'a-mode-this-client-has-never-heard-of'
    for (const attr of view(reported).match(/[a-z-]+="[^"]*"/g) ?? []) {
      expect(attr).not.toContain(reported)
    }
  })

  it('renders nothing when no mode is known (AC1)', () => {
    expect(view('')).toBe('')
  })

  // THERE IS NO INERT ARM, and that is this control's structural departure from both its neighbours. Their
  // ENTIRE entry list is a daemon-published list that can be absent or empty, so each renders a label that
  // opens nothing; this menu's vocabulary is client-owned and only ONE entry of it is conditional (#1022),
  // so the list never falls below four and there is never nothing to offer. Every mode that renders at all
  // renders an operable trigger — pinned across the whole vocabulary plus the two readings the daemon can
  // invent, so a later "no options" arm has to argue with a test. The same floor is re-asserted over every
  // model-list shape in the auto-mode describe above.
  it.each([...KNOWN_MODES, 'ultraPermissive'])('is operable while the session runs %s (AC2)', (mode) => {
    const markup = view(mode)
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('class="composer-options-anchor"')
    expect(markup).toContain('composer__permission-icon')
  })

  // The entries reach the SHARED panel: this menu's own static render cannot show an open panel
  // (useState(false)), so they are fed to the panel directly — the sibling files' idiom.
  it('feeds the five settable modes to the shared panel with the current one marked (AC2)', () => {
    const markup = panel('plan')
    expect(rowCount(markup)).toBe(SETTABLE_PERMISSION_MODES.length)
    for (const mode of SETTABLE_PERMISSION_MODES) {
      expect(markup).toContain(`>${rendered(PERMISSION_MODE_LABELS[mode])}<`)
    }
    expect(countOf(markup, 'aria-current')).toBe(1)
    expect(markup).toContain(`aria-current="true">${rendered(PERMISSION_MODE_LABELS.plan)}<`)
  })

  // AC2's bypass half through the panel, and the row-level proof that the escalation is not offered: five
  // rows, none marked, and the bypass display name appears nowhere in the panel at all — while the trigger
  // beside it is still naming that very mode.
  it('offers five unmarked rows and no bypass row while the session is in bypass (AC2)', () => {
    const markup = panel(BYPASS)
    expect(rowCount(markup)).toBe(SETTABLE_PERMISSION_MODES.length)
    expect(countOf(markup, 'aria-current')).toBe(0)
    expect(markup).not.toContain(rendered(PERMISSION_MODE_LABELS[BYPASS]))
    expect(view(BYPASS)).toContain(
      `<span class="composer__permission-label">${rendered(PERMISSION_MODE_LABELS[BYPASS])}</span>`
    )
  })

  // The other half of the marking rule, for a mode the client cannot name: five rows, none marked, through
  // the panel's same no-special-case branch.
  it('marks no row when the session runs a mode this client does not know (AC2)', () => {
    const markup = panel('ultraPermissive')
    expect(rowCount(markup)).toBe(SETTABLE_PERMISSION_MODES.length)
    expect(countOf(markup, 'aria-current')).toBe(0)
  })
})

// #1168 — the guard for a change made in a NEIGHBOURING file. That slice re-points the two EFFORT
// surfaces so an empty session model resolves the inherited-default row (`default`), and it deliberately
// does that in its own home rather than inside publishedRowFor — because this menu is one of the callers
// left behind, and it reads `supports_auto_mode` off the row it resolves. Put the branch one layer down
// and every
// inherited-default chat would silently lose its `auto` entry, which no criterion of that ticket names.
// This asserts the placement from the outside, in the file that would pay for getting it wrong.
describe('composerPermissionModeMenuModel — an inherited-default session (#1168)', () => {
  const INHERITED_REFUSING = row({
    value: 'default',
    display_name: 'Inherited default',
    supports_auto_mode: false
  })

  it('still offers auto when the session model is empty and a refusing `default` row is published', () => {
    const list: ModelListEntry = { models: [INHERITED_REFUSING, ACCEPTING], droppedModels: 0 }
    const menu = composerPermissionModeMenuModel(list, '', 'plan')
    expect(menu?.options.map((each) => each.id)).toStrictEqual([...SETTABLE_PERMISSION_MODES])
    expect(menu?.options.map((each) => each.id)).toContain(AUTO_PERMISSION_MODE)
  })

  // The other direction of the same claim: a miss is the UNKNOWN reading and offers everything, so the
  // empty model must keep missing here exactly as it does today.
  it('hides auto only for a session model that NAMES the refusing row', () => {
    const list: ModelListEntry = { models: [INHERITED_REFUSING, ACCEPTING], droppedModels: 0 }
    const named = composerPermissionModeMenuModel(list, INHERITED_REFUSING.value, 'plan')
    expect(named?.options.map((each) => each.id)).not.toContain(AUTO_PERMISSION_MODE)
  })
})
