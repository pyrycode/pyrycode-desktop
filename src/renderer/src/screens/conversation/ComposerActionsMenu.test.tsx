import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ComposerActionsMenuView,
  COMPOSER_ACTIONS,
  COMPOSER_ACTIONS_LABEL,
  NEW_SESSION_ACTION,
  composerActionRows
} from './ComposerActionsMenu'
import { ComposerOptionsPanel, COMPOSER_OPTIONS_UNAVAILABLE_NOTE } from './ComposerOptionsPanel'
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

/** The view as the composer mounts it. Both handlers are inert: a static render fires no events, so
 *  neither the command arm nor #1218's control arm can be reached from this tier. */
function viewMarkup(): string {
  return renderToStaticMarkup(
    <ComposerActionsMenuView menu={null} slashCommands onCommand={noop} onNewSession={noop} />
  )
}

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
  it('holds exactly the two slash entries, in order, with the command as each id (AC1, AC2)', () => {
    expect(COMPOSER_ACTIONS).toStrictEqual([
      { id: '/compact', label: 'Compact session' },
      { id: '/knowledge-capture', label: 'Knowledge capture' }
    ])
  })

  // #1496's AC2, stated directly rather than left to be read off the literal above. `/clear` is the entry
  // the fold REMOVED, and the tempting way to undo the fold is to bring it back beside the control row —
  // or, worse, to give the control row that id so a workspace publishing `clear` keeps it ungreyed. Both
  // read as tidy-ups and both restore the two-reset-path surface Juhana's 2026-09-06 decision rejected.
  it('holds no /clear entry — the fold is structural, not a relabelling (AC2)', () => {
    expect(COMPOSER_ACTIONS.map((action) => action.id)).not.toContain('/clear')
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
    const markup = viewMarkup()
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
    const markup = viewMarkup()
    expect(COMPOSER_ACTIONS_LABEL).toBe('Actions')
    expect(triggerInner(markup)).toContain(COMPOSER_ACTIONS_LABEL)
  })

  // The container deliberately puts NO aria-label on the trigger (WCAG 2.5.3 label-in-name), so the
  // button's accessible name is computed from its contents — which makes the chevron's aria-hidden
  // load-bearing: an exposed <svg> could perturb the exact string the e2e locator matches.
  it('hides the chevron from the accessible name (protects the e2e locator)', () => {
    const inner = triggerInner(viewMarkup())
    expect(inner).toContain('composer__actions-icon')
    expect(inner).toContain('aria-hidden="true"')
    // Strip the glyph and nothing but the label is left to be announced. Since #1107 the word is wrapped
    // in a <span> so it can ellipsize under the footer row's shrink policy, so the survivor is that
    // element rather than the bare string — still an EXACT equality, so a second announced child would
    // redden this the way it always did, and a <span> contributes nothing of its own to the accessible
    // name the e2e locator matches.
    expect(inner.replace(/<svg[\s\S]*?<\/svg>/g, '').trim()).toBe(
      `<span class="composer__actions-label">${COMPOSER_ACTIONS_LABEL}</span>`
    )
  })

  // The entries reach the SHARED panel with no current row — a list of actions, not a choice. The
  // menu's own static render cannot show an open panel (useState(false)), and faking one would be
  // dishonest, so the entries are fed to the panel directly instead. #1218 made the rendered list
  // `composerActionRows(menu)` rather than `COMPOSER_ACTIONS` itself, so this asserts what the menu
  // actually draws rather than one of its two sources. Three rows since #1496 folded the two reset
  // paths into one.
  it('feeds three unmarked rows to the shared panel (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ComposerOptionsPanel
        options={composerActionRows(null, true)}
        currentId={null}
        onSelect={noop}
        ariaLabel={COMPOSER_ACTIONS_LABEL}
        focusedIndex={0}
      />
    )
    expect(rowCount(markup)).toBe(3)
    for (const action of composerActionRows(null, true)) {
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

/** A COMPLETE published menu carrying `compact` and not `knowledge-capture` — the shape a workspace
 *  without the vault's capture command publishes. It names NEITHER the control row NOR `clear` since
 *  #1496, which is what makes it the strongest input for that row's never-greyed property below: a
 *  fixture still publishing `clear` would leave this file green for an implementation that folded the
 *  control row back into `COMPOSER_ACTIONS` under the id `/clear`. */
const WITHOUT_KNOWLEDGE_CAPTURE: SlashCommandListEntry = {
  commands: [command({ name: 'compact' })],
  droppedCommands: 0
}

/** The panel as the Actions menu renders it for a given published menu. #1218 routes it through
 *  `composerActionRows`, the menu's own composition, rather than through `markUnavailableActions`
 *  alone — the marked commands are only two of the three rows the menu draws. */
function panelMarkup(menu: SlashCommandListEntry | null): string {
  return renderToStaticMarkup(
    <ComposerOptionsPanel
      options={composerActionRows(menu, true)}
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

    // Still every row — greying is not hiding. The row keeps role="menuitem" and its place in the
    // roving tabindex; only its activation is gated. Three since #1496 folded the two reset paths.
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

    // Two: the one published command plus the control row, which is never in the marking path at all.
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

// #1218 — the control row, and it is NOT a slash command. The two slash entries are sent verbatim as
// ordinary message text; this one dispatches a `new_session` control frame asking the daemon to kill
// claude and spawn a fresh one. #1496 made it THE conversation's only reset path and moved it FIRST: the
// `/clear` row that used to carry this label is gone, and this row inherited the words. The picking is out
// of reach in this tier (nothing here can click, and vitest runs the `node` environment) and belongs to
// e2e/composer-new-session.spec.ts; what is provable here is the row's presence, its words, its place, and
// the two properties that make the view's two-arm dispatch total and AC3 structural. It sits below the
// #681 fixtures because it reuses them.
describe('NEW_SESSION_ACTION (#1218, folded by #1496)', () => {
  // The label is a client-owned constant AND a load-bearing e2e locator: rewording it here without
  // updating e2e/composer-actions.spec.ts, e2e/composer-new-session.spec.ts,
  // e2e/composer-actions-unavailable.spec.ts and e2e/offline-conversation-actions.spec.ts breaks them,
  // which is the point. Since #1496 it no longer has to say IN WORDS that claude is restarted, because
  // there is no second reset row left to be confused with — the distinction #1218's parenthetical carried
  // is now carried by there being one row.
  it('is labelled Reset session (AC1)', () => {
    expect(NEW_SESSION_ACTION.label).toBe('Reset session')
  })

  // THE TWO PROPERTIES THE DISPATCH RESTS ON. The view routes this one id to `onNewSession` and every
  // other id to `onCommand`, which is total only while this id is none of the commands. And the missing
  // leading slash is the second guard: claude intercepts a message that BEGINS WITH a slash, so were
  // this id ever to reach the message-text path it would arrive as literal prose rather than as a
  // command — visible, not silent.
  it('carries an id that is neither a slash command nor any COMPOSER_ACTIONS id', () => {
    expect(NEW_SESSION_ACTION.id.startsWith('/')).toBe(false)
    expect(COMPOSER_ACTIONS.map((action) => action.id)).not.toContain(NEW_SESSION_ACTION.id)
  })

  // It is the FIRST row since #1496 — AC1's order, Reset session then Compact session then Knowledge
  // capture. The availability-marked block stays contiguous (it is now the tail rather than the head) and
  // the composition stays a single splice-free expression.
  it('renders first, leaving the slash commands in their shipped order (AC1)', () => {
    expect(composerActionRows(null, true)).toStrictEqual([NEW_SESSION_ACTION, ...COMPOSER_ACTIONS])
  })

  // #1218's AC3 AND #1496's AC2, AND THE DETECTOR FOR THE FAILURE MODE THAT SHIPS LOOKING CORRECT.
  // `markUnavailableActions` strips one leading slash and matches a published `name` or alias, so
  // `new-session` would match nothing and be greyed out in EVERY workspace whose published list is
  // complete. It cannot be, because it is never handed to that function — but a later ticket tidying the
  // two arrays into one would undo that silently and the app would still look right. Since #1496 that
  // failure would grey out the conversation's ONLY reset path, and the fixtures below name neither this
  // row nor `clear`, so an implementation that folded it back under the id `/clear` reddens here too.
  // Both COMPLETE readings are covered: a list naming another verb, and claude's positive statement that
  // it accepts nothing at all.
  const COMPLETE_MENUS: readonly [string, SlashCommandListEntry][] = [
    ['a complete list naming neither it nor clear', WITHOUT_KNOWLEDGE_CAPTURE],
    ['a complete but empty published menu', { commands: [], droppedCommands: 0 }]
  ]
  it.each(COMPLETE_MENUS)('is never marked unavailable by %s (AC3)', (_case, menu) => {
    const rows = composerActionRows(menu, true)
    const newSession = rows[0]

    expect(newSession.id).toBe(NEW_SESSION_ACTION.id)
    expect(newSession.unavailable).toBeUndefined()
    // Through the markup as well as through the data, and as a WHOLE attribute run followed by the
    // label: that string exists only for a row wearing the bare base class and carrying no explanation,
    // so it fails if either the modifier or the note ever lands on this row.
    expect(panelMarkup(menu)).toContain(
      `class="composer-options__item">${NEW_SESSION_ACTION.label}</button>`
    )
  })
})

// #1655 — a session whose capability list says it has no slash commands (a Codex session) is offered the
// control row alone: no entry sends a Claude command to it as a prompt. Keyed on the flag, not on whether a
// menu was published, so the answer is the same with or without one.
describe('a session without slash commands (#1655)', () => {
  it.each([
    ['no published menu', null],
    ['a published menu', WITHOUT_KNOWLEDGE_CAPTURE]
  ] as const)('offers only Reset session with %s', (_case, menu) => {
    expect(composerActionRows(menu, false)).toStrictEqual([NEW_SESSION_ACTION])
  })

  it('draws only the Reset session row in the panel', () => {
    const markup = renderToStaticMarkup(
      <ComposerOptionsPanel
        options={composerActionRows(null, false)}
        currentId={null}
        onSelect={noop}
        ariaLabel={COMPOSER_ACTIONS_LABEL}
        focusedIndex={0}
      />
    )
    expect(rowCount(markup)).toBe(1)
    expect(markup).toContain(`>${NEW_SESSION_ACTION.label}<`)
    for (const action of COMPOSER_ACTIONS) expect(markup).not.toContain(`>${action.label}<`)
  })

  it('leaves the trigger unchanged', () => {
    const without = renderToStaticMarkup(
      <ComposerActionsMenuView menu={null} slashCommands={false} onCommand={noop} onNewSession={noop} />
    )
    expect(without).toBe(viewMarkup())
  })
})
