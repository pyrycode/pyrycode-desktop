import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ComposerPermissionModeMenuView,
  COMPOSER_PERMISSION_MODE_MENU_LABEL,
  PERMISSION_MODE_LABELS,
  SETTABLE_PERMISSION_MODES,
  composerPermissionModeMenuModel
} from './ComposerPermissionModeMenu'
import { ComposerOptionsPanel } from './ComposerOptionsPanel'

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

const noop = (): void => {}

/** The trigger button's inner markup — what a browser computes the accessible name from. */
function triggerInner(markup: string): string {
  return (
    markup.match(
      /<button[^>]*class="composer__footer-button composer__permission"[^>]*>([\s\S]*?)<\/button>/
    )?.[1] ?? ''
  )
}

function view(permissionMode: string): string {
  return renderToStaticMarkup(
    <ComposerPermissionModeMenuView permissionMode={permissionMode} onSelect={noop} />
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

function panel(permissionMode: string): string {
  const menu = composerPermissionModeMenuModel(permissionMode)
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

describe('composerPermissionModeMenuModel', () => {
  // AC1 and AC2 in one shape: the label is the DISPLAY name for the session's mode, the entries are the
  // five settable modes with the machine value as `id`, and the current one is the session's mode itself.
  it('labels the trigger with the display name and offers the five settable modes (AC1, AC2)', () => {
    expect(composerPermissionModeMenuModel('acceptEdits')).toStrictEqual({
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
      const menu = composerPermissionModeMenuModel(mode)
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
    expect(composerPermissionModeMenuModel('')).toBeNull()
  })

  // AC2's bypass half, at the decision layer. A session sitting in bypass is a real, reachable state — the
  // run-configuration sheet's YOLO toggle puts it there — and this control must name it honestly while
  // offering only what it may send. currentId matching no entry marks nothing through the panel's existing
  // branch: no special case, no null arm, and emphatically not a reason to withhold the menu.
  it('labels a session in bypass and still offers the five (AC2)', () => {
    const menu = composerPermissionModeMenuModel(BYPASS)
    expect(menu?.label).toBe(PERMISSION_MODE_LABELS[BYPASS])
    expect(menu?.currentId).toBe(BYPASS)
    expect(menu?.options).toHaveLength(SETTABLE_PERMISSION_MODES.length)
  })

  it.each(KNOWN_MODES)('labels %s with its display name (AC1)', (mode) => {
    expect(composerPermissionModeMenuModel(mode)?.label).toBe(PERMISSION_MODE_LABELS[mode])
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
    expect(composerPermissionModeMenuModel(mode)?.label).toBe(mode)
  })

  // THE LOOKUP IS KEYED BY A DAEMON-CONTROLLED STRING, so it must be an own-property read. A bare
  // `LABELS[mode]` returns a function for `constructor` and an object for `__proto__` — neither is
  // undefined, so a `?? mode` fallback does not catch them, and a non-string reaching a JSX child position
  // throws inside React: one field of one daemon frame takes the conversation screen down. The label must
  // be the mode string itself, and the render must survive.
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'reads %s as an unknown mode rather than an inherited property',
    (mode) => {
      expect(composerPermissionModeMenuModel(mode)?.label).toBe(mode)
      expect(view(mode)).toContain(`<span class="composer__permission-label">${mode}</span>`)
    }
  )
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
  // entries are a daemon-published list that can be absent or empty, so each renders a label that opens
  // nothing; these entries are a client-owned constant, so there is never nothing to offer. Every mode
  // that renders at all renders an operable trigger — pinned across the whole vocabulary plus the two
  // readings the daemon can invent, so a later "no options" arm has to argue with a test.
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
