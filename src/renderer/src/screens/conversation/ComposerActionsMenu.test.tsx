import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ComposerActionsMenu,
  COMPOSER_ACTIONS,
  COMPOSER_ACTIONS_LABEL
} from './ComposerActionsMenu'
import { ComposerOptionsPanel } from './ComposerOptionsPanel'

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

/** The trigger button's inner markup — what a browser computes the accessible name from. */
function triggerInner(markup: string): string {
  return markup.match(/<button[^>]*class="composer__actions"[^>]*>([\s\S]*?)<\/button>/)?.[1] ?? ''
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

describe('ComposerActionsMenu', () => {
  it('renders the footer trigger inside a composer-options anchor, closed (AC1)', () => {
    const markup = renderToStaticMarkup(<ComposerActionsMenu onCommand={noop} />)
    expect(markup).toContain('class="composer-options-anchor"')
    expect(markup).toContain('class="composer__actions"')
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
    const markup = renderToStaticMarkup(<ComposerActionsMenu onCommand={noop} />)
    expect(COMPOSER_ACTIONS_LABEL).toBe('Actions')
    expect(triggerInner(markup)).toContain(COMPOSER_ACTIONS_LABEL)
  })

  // The container deliberately puts NO aria-label on the trigger (WCAG 2.5.3 label-in-name), so the
  // button's accessible name is computed from its contents — which makes the chevron's aria-hidden
  // load-bearing: an exposed <svg> could perturb the exact string the e2e locator matches.
  it('hides the chevron from the accessible name (protects the e2e locator)', () => {
    const inner = triggerInner(renderToStaticMarkup(<ComposerActionsMenu onCommand={noop} />))
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
