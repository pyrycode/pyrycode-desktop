import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ComposerActionsMenuView,
  COMPOSER_ACTIONS,
  COMPOSER_ACTIONS_LABEL
} from './ComposerActionsMenu'
import { ComposerOptionsPanel, COMPOSER_OPTIONS_UNAVAILABLE_NOTE } from './ComposerOptionsPanel'
import { markUnavailableActions } from './composerActionAvailability'
import type { SlashCommandListEntry } from '../../store/slashCommandListStore'
import type { WireSlashCommand } from '@shared/wire/types'

// #680: two halves, both reachable under this repo's `node` vitest environment. The MAPPING half is
// plain data — `COMPOSER_ACTIONS` is an array a spec executes directly, which is the whole reason the
// command string IS the option id. The MARKUP half is renderToStaticMarkup, following
// ComposerOptionsPanel.test.tsx's idiom (its rowCount helper is copied below rather than re-derived).
//
// `onCommand` is NOT exercised here: a static render fires no events, so nothing in this file can click.
// The open→pick→command-in-the-thread proof is e2e/composer-actions.spec.ts, the Playwright fake tier —
// the in-app interaction proof #840 deferred to this ticket.

const noop = (): void => {}

// Count ROWS specifically — ComposerOptionsPanel.test.tsx:59-61 verbatim, so the panel div does not
// inflate the count and a current row (which this menu never has) would still count exactly once.
function rowCount(markup: string): number {
  return markup.match(/class="composer-options__item["\s]/g)?.length ?? 0
}

function countOf(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

// #988 lifted the shared treatment out of .composer__actions, so the trigger wears a two-class mix and
// this file's whole-attribute-run matches move with it. Kept as one constant: the class run is asserted
// from three places below, and three copies of a string that changes together is three chances to update
// two of them.
const TRIGGER_CLASS_RUN = 'class="composer__footer-button composer__actions"'

/** The trigger button's inner markup — what a browser computes the accessible name from. */
function triggerInner(markup: string): string {
  const inner = markup.match(
    new RegExp(`<button[^>]*${TRIGGER_CLASS_RUN}[^>]*>([\\s\\S]*?)</button>`)
  )?.[1]
  // A miss returns undefined, and an empty string would make every consumer's `toContain` pass VACUOUSLY
  // — the exact failure #988 found at ConversationScreen.test.tsx's sibling extractor when the class run
  // changed under it. Fail here instead, where the reason is legible.
  if (inner === undefined) throw new Error(`no trigger matching ${TRIGGER_CLASS_RUN} in the markup`)
  return inner
}

describe('COMPOSER_ACTIONS', () => {
  // ONE assertion over the whole array, so a reordering, a relabelling or a typo in either column fails
  // here rather than in a screenshot. The id is the command sent verbatim as message text; the label is
  // the visible row.
  it('holds exactly the three entries, in order, with the command as each id (AC1, AC2)', () => {
    expect(COMPOSER_ACTIONS).toStrictEqual([
      { id: '/clear', label: 'Reset session' },
      { id: '/compact', label: 'Compact session' },
      { id: '/knowledge-capture', label: 'Knowledge capture' }
    ])
  })

  // The property the entire feature rests on: claude intercepts a message whose text BEGINS WITH A SLASH
  // and runs it as a command rather than passing it to the model (measured 2026-08-21 against claude
  // 2.1.220). Asserted over the array rather than per entry, so a fourth entry inherits the guard.
  it('sends every entry as a slash command', () => {
    expect(COMPOSER_ACTIONS.every((action) => action.id.startsWith('/'))).toBe(true)
  })

  // The panel's stated `key` contract (ComposerOptionsPanel.tsx:22-24: unique by caller contract, no
  // runtime guard).
  it('has pairwise-unique ids', () => {
    expect(new Set(COMPOSER_ACTIONS.map((action) => action.id)).size).toBe(COMPOSER_ACTIONS.length)
  })
})

describe('ComposerActionsMenuView', () => {
  it('renders the footer trigger inside a composer-options anchor, closed (AC1)', () => {
    const markup = renderToStaticMarkup(<ComposerActionsMenuView menu={null} onCommand={noop} />)
    expect(markup).toContain('class="composer-options-anchor"')
    expect(markup).toContain(TRIGGER_CLASS_RUN)
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('aria-expanded="false"')
    // Closed at mount is ComposerOptionsMenu's useState(false) seen from outside: no panel, no rows.
    expect(markup).not.toContain('composer-options__item')
    expect(markup).not.toContain('role="menu"')
  })

  // COMPOSER_ACTIONS_LABEL is the trigger's visible text AND — once the e2e spec locates by it — a
  // LOAD-BEARING e2e LOCATOR that may not be reworded without updating e2e/composer-actions.spec.ts
  // (the SEND_LABEL / INTERRUPT_LABEL warning, ConversationScreen.tsx:2042-2050).
  it('names the trigger with the client-owned Actions label', () => {
    const markup = renderToStaticMarkup(<ComposerActionsMenuView menu={null} onCommand={noop} />)
    expect(COMPOSER_ACTIONS_LABEL).toBe('Actions')
    expect(triggerInner(markup)).toContain(COMPOSER_ACTIONS_LABEL)
  })

  // The container deliberately puts NO aria-label on the trigger (WCAG 2.5.3 label-in-name), so the
  // button's accessible name is computed from its contents — which makes the chevron's aria-hidden
  // load-bearing: an exposed <svg> could perturb the exact string the e2e locator matches.
  it('hides the chevron from the accessible name (protects the e2e locator)', () => {
    const inner = triggerInner(renderToStaticMarkup(<ComposerActionsMenuView menu={null} onCommand={noop} />))
    expect(inner).toContain('composer__actions-icon')
    expect(inner).toContain('aria-hidden="true"')
    // Strip the glyph and nothing but the label is left to be announced.
    expect(inner.replace(/<svg[\s\S]*?<\/svg>/g, '').trim()).toBe(COMPOSER_ACTIONS_LABEL)
  })

  // The three entries reach the SHARED panel with no current row — a list of actions, not a choice. The
  // menu's own static render cannot show an open panel (useState(false)), and faking one would be
  // dishonest, so the entries are fed to the panel directly instead.
  it('feeds three unmarked rows to the shared panel (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ComposerOptionsPanel
        options={COMPOSER_ACTIONS}
        currentId={null}
        onSelect={noop}
        ariaLabel={COMPOSER_ACTIONS_LABEL}
        focusedIndex={0}
      />
    )
    expect(rowCount(markup)).toBe(3)
    for (const action of COMPOSER_ACTIONS) {
      expect(markup).toContain(`>${action.label}<`)
    }
    expect(countOf(markup, 'aria-current')).toBe(0)
    expect(markup).not.toContain('composer-options__item--current')
  })
})

// #681 — the affordance, end to end from a store entry to markup. The DECISION's own cases are data and
// live in composerActionAvailability.test.ts; what is proved here is that the decision reaches a pixel and
// that an available row is untouched by it. Interaction (picking sends nothing) is structurally out of
// reach in this tier and is e2e/composer-actions-unavailable.spec.ts's.
function command(overrides: Partial<WireSlashCommand> & { name: string }): WireSlashCommand {
  return { argument_hint: '', description: '', aliases: [], truncated_fields: null, ...overrides }
}

/** A COMPLETE published menu carrying `clear` and `compact` and not `knowledge-capture` — the shape a
 *  workspace without the vault's capture command publishes. */
const WITHOUT_KNOWLEDGE_CAPTURE: SlashCommandListEntry = {
  commands: [command({ name: 'clear' }), command({ name: 'compact' })],
  droppedCommands: 0
}

/** The panel as the Actions menu renders it for a given published menu. */
function panelMarkup(menu: SlashCommandListEntry | null): string {
  return renderToStaticMarkup(
    <ComposerOptionsPanel
      options={markUnavailableActions(COMPOSER_ACTIONS, menu)}
      currentId={null}
      onSelect={noop}
      ariaLabel={COMPOSER_ACTIONS_LABEL}
      focusedIndex={0}
    />
  )
}

describe('the unavailable row (#681)', () => {
  it('greys the one entry a complete list does not publish (AC1, AC4)', () => {
    const markup = panelMarkup(WITHOUT_KNOWLEDGE_CAPTURE)

    // Still three rows — greying is not hiding. The row keeps role="menuitem" and its place in the
    // roving tabindex; only its activation is gated.
    expect(rowCount(markup)).toBe(3)
    expect(countOf(markup, 'aria-disabled="true"')).toBe(1)
    // The WHOLE class run, so a modifier worn without its base would fail here.
    expect(
      countOf(markup, 'class="composer-options__item composer-options__item--unavailable"')
    ).toBe(1)
    // AC4: announced with a reason, on the greyed row and nowhere else.
    expect(countOf(markup, COMPOSER_OPTIONS_UNAVAILABLE_NOTE)).toBe(1)
    expect(markup).toContain(
      `>Knowledge capture<span class="composer-options__unavailable-note">${COMPOSER_OPTIONS_UNAVAILABLE_NOTE}</span>`
    )
  })

  // AC2 at the markup boundary. `null` is the state a slow daemon, a dropped frame or a daemon older than
  // the forwarding change leaves the app in, and it must render exactly what #680 shipped.
  it('renders every row untouched while availability is unknown (AC2, AC5)', () => {
    const markup = panelMarkup(null)

    expect(markup).toBe(panelMarkup({ commands: [], droppedCommands: 4 }))
    expect(rowCount(markup)).toBe(3)
    expect(markup).not.toContain('aria-disabled')
    expect(markup).not.toContain('--unavailable')
    expect(markup).not.toContain(COMPOSER_OPTIONS_UNAVAILABLE_NOTE)
    // AC5's guard from this side: the available row's attribute run is byte-for-byte what it was.
    expect(countOf(markup, 'class="composer-options__item">')).toBe(3)
  })

  // The available rows in a MIXED panel are byte-identical to the ones in an all-available panel — the
  // property AC5 asks of the four other consumers, asserted where a regression would actually land.
  it('leaves an available row byte-identical beside a greyed one (AC5)', () => {
    const markup = panelMarkup(WITHOUT_KNOWLEDGE_CAPTURE)

    expect(countOf(markup, 'class="composer-options__item">')).toBe(2)
    expect(markup).toContain('>Reset session</button>')
    expect(markup).toContain('>Compact session</button>')
  })

  // NO WORKSPACE-AUTHORED STRING REACHES THE EXPLANATION (AC4). Pinned as a literal because the constant
  // is the whole guarantee: a future edit that interpolated a published `name` into it would put
  // untrusted text into the row's accessible name, and this is the assertion that would fail.
  it('explains with a client-owned constant', () => {
    expect(COMPOSER_OPTIONS_UNAVAILABLE_NOTE).toBe('(unavailable in this workspace)')
  })
})
