import { useMemo } from 'react'
import { useConversationActionAvailability } from './conversationActionAvailability'
import { ComposerOptionsMenu, type ComposerOptionsPanelOption } from './ComposerOptionsPanel'
import { markUnavailableActions } from './composerActionAvailability'
import {
  useSlashCommandListStore,
  selectSlashCommandListFor,
  type SlashCommandListEntry
} from '../../store/slashCommandListStore'

// #680: the composer footer's Actions menu — the FIRST live host of the shared options panel, which
// #838 (surface), #839 (placement) and #840 (opening, keyboard, dismissal) all shipped dormant. It owns
// exactly three things: its entries, what picking one does, and the trigger's label and appearance.
// Everything else — the <button>, aria-haspopup, aria-expanded, the toggle, roving focus, Escape,
// outside-click and focus return — is ComposerOptionsMenu's, per the boundary that file states at
// :121-126. If this menu ever wants a new prop on that component, STOP and say so on the issue: four
// consumers share it.
//
// Its own file rather than ConversationScreen.tsx (~2700 lines and a declared merge hot-spot) — the
// ComposerOptionsPanel.tsx:10-14 reasoning verbatim. #682 (permission mode) and #683 (model and effort)
// are two more footer menus of this exact shape queued behind it; three tickets each appending seventy
// lines to the same file is three merge conflicts. This file is the precedent they follow. It adds no
// CSS import: its styles live in conversation.css, whose single importer is ConversationScreen.tsx:13.

// The three commands, in the order the design lists them — and THE ID IS THE COMMAND, sent verbatim as
// ordinary message text.
//
// `ComposerOptionsPanelOption` splits `id` from `label` because #683 shows `Opus 5` for `claude-opus-5`:
// the id is the wire/model value behind the row. A command menu has no such value — the command string
// IS the identity — so collapsing them is the honest shape, not a shortcut. It buys three things: the
// array passes STRAIGHT into `options` with no .map() on every render and no parallel array to drift;
// `onSelect(id)` is `onCommand(id)` with no lookup, therefore no unreachable `undefined` arm to write,
// test or `!`-assert; and AC2's mapping cannot be got wrong, because nothing sits between the picked row
// and the sent text. Do NOT add a `command` field, a lookup or a ComposerActionId union.
//
// This needs NO daemon change and NO wire change: claude intercepts a message whose text begins with a
// slash and runs it as a command rather than passing it to the model (measured 2026-08-21 against claude
// 2.1.220). An absent `/knowledge-capture` comes back as a synthetic "Unknown command" assistant reply at
// zero turns and zero cost — a correct, visible, harmless outcome that #680 deliberately did not detect
// or guard. #681 now greys such an entry out from the daemon's published `slash_command_list`; the array
// below is still the CLIENT'S OWN and is never mutated or rebuilt from that list — the marking is derived
// per render by `markUnavailableActions`.
// #1218 NARROWED WHAT THIS ARRAY IS, WITHOUT CHANGING A BYTE OF IT. Everything above still holds — of
// these three entries — and the array is still the client's own, never rebuilt from a published list.
// What it is no longer is the whole menu: the fourth row below is a CONTROL FRAME rather than a slash
// command, so it lives in its own constant and `composerActionRows` composes the two. Add a slash
// command here; add a control action there. See that constant for why the split is the shape rather
// than a `command` field, a lookup or an id union.
export const COMPOSER_ACTIONS: readonly ComposerOptionsPanelOption[] = [
  { id: '/clear', label: 'Reset session' },
  { id: '/compact', label: 'Compact session' },
  { id: '/knowledge-capture', label: 'Knowledge capture' }
]

/**
 * #1218 — New session, and it is the FIRST entry in this menu that is not a slash command. It asks the
 * daemon to kill claude and spawn a fresh one under a new id, so every stored setting applies at the
 * spawn; `sendNewSession` is what it dispatches. Routing it through the message-text path the three
 * above take would send the literal string "New session" to claude, which is why the menu now holds two
 * kinds of entry and why the id below is NOT the command.
 *
 * A SECOND ARRAY RATHER THAN A FOURTH MEMBER OF THE ONE ABOVE, and that is the whole of AC3. An entry
 * this menu draws is greyed out when the conversation's published `slash_command_list` is complete and
 * does not name it — `markUnavailableActions` strips one leading slash and matches a published `name`
 * or alias, so `new-session` would match nothing and be greyed out in EVERY workspace with a complete
 * list, a failure that ships looking correct. Keeping it out of that function's ARGUMENT is what makes
 * it unreachable rather than carved out: there is no "except this one" branch inside the availability
 * module to get backwards, and that module's rule stays true of every entry it is given. Do NOT merge
 * the two arrays back into one; `ComposerActionsMenu.test.tsx` is the detector if anyone tries.
 *
 * THE ID IS NOT A COMMAND and carries no leading slash, deliberately twice over: it is what
 * `composerActionRows`'s consumers route on, and it is disjoint from every `COMPOSER_ACTIONS` id, which
 * is what makes `ComposerActionsMenuView`'s two-arm dispatch total. Both properties are pinned by a test
 * rather than left to inspection.
 *
 * THE LABEL CARRIES THE WHOLE DISTINCTION FROM `Reset session`, because it is the only field the shared
 * panel draws — one visible field per row and no description, the #934 product decision that
 * `ComposerOptionsPanel` records, and adding a description field to a surface four menus share is not
 * this ticket's. So the row says in words that claude is restarted. It is a client-owned constant like
 * `COMPOSER_ACTIONS_LABEL`, it is a LOAD-BEARING e2e LOCATOR, and no workspace string may ever reach it.
 */
export const NEW_SESSION_ACTION: ComposerOptionsPanelOption = {
  id: 'new-session',
  label: 'New session (restarts claude)'
}

/**
 * The rows this menu draws, in order, marked — the whole "which entries, and which of them are greyed
 * out" decision in one place, so the view holds none of it.
 *
 * The control entry is APPENDED LAST rather than placed beside `Reset session`. #1218's "beside Reset
 * session" names the surface this action lives on (its Context calls the Actions menu an interim home,
 * with the channel-settings header the eventual one), and the distinction between the two rows is
 * carried by the label, which is the AC's own next clause. Appending keeps the three marked commands one
 * contiguous block and this composition a single splice-free expression.
 *
 * It returns a FRESH ARRAY every render, where `markUnavailableActions` returns its input by reference
 * when nothing is unavailable. Nothing consumes that identity: `useComposerOptionsClamp`'s deps are
 * `[active]` precisely so no effect depends on `options`, and no component in this chain is memoised.
 * The by-reference property is unchanged for that function's own callers.
 */
export function composerActionRows(
  menu: SlashCommandListEntry | null
): readonly ComposerOptionsPanelOption[] {
  return [...markUnavailableActions(COMPOSER_ACTIONS, menu), NEW_SESSION_ACTION]
}

// A module-level client-owned constant, following SEND_LABEL / INTERRUPT_LABEL
// (ConversationScreen.tsx:2042-2052) — and it inherits their warning: e2e/composer-actions.spec.ts
// locates the trigger by this exact string, so IT IS A LOAD-BEARING LOCATOR AND MAY NOT BE REWORDED
// without updating that spec. It names the trigger AND the role="menu" panel: two roles, one accessible
// name, which Playwright and assistive tech both disambiguate by role. (Figma's text node reads
// `Actions ` with a trailing space; that is a design artifact.)
export const COMPOSER_ACTIONS_LABEL = 'Actions'

// Figma 115:3677's `chevron-up-solid-full`, exported verbatim at 8x4 in an 8x4 viewBox. It points UP and
// does NOT flip on open: the design draws one state, and reading ComposerOptionsMenu's `open` flag would
// mean a new prop on the surface four tickets share. An up chevron at rest is honest anyway — the panel
// opens upward. The export's fill="#32628D" is the LIGHT scheme's primary and is dropped for
// currentColor, so the glyph inherits the button's --color-primary (desktop is dark-only, ADR 0003; the
// standing .composer-status / .status-row rule).
const CHEVRON_PATH =
  'M3.59822 0.146303C3.82044 -0.0482491 4.18133 -0.0482491 4.40356 0.146303L7.81689 3.13463C8.03911 3.32918 8.03911 3.64514 7.81689 3.83969C7.59467 4.03424 7.23378 4.03424 7.01156 3.83969L4 1.20311L0.988445 3.83813C0.766222 4.03268 0.405333 4.03268 0.183111 3.83813C-0.0391111 3.64358 -0.0391111 3.32763 0.183111 3.13307L3.59644 0.144747L3.59822 0.146303Z'

/**
 * The Actions trigger and its menu — the PURE VIEW half since #681, props in and markup out, with no
 * store read, no `window.pyry` and no state of its own, so it server-renders directly under the repo's
 * `node` vitest environment. Every prop is required, the "a view that cannot answer is a bug" rule
 * (ConversationScreen.tsx:2033), and `menu` states the unknown reading as `null` rather than by omission.
 *
 * The container hides this menu when the owning host is unavailable. Its callbacks also
 * recheck current host availability before dispatch.
 */
export function ComposerActionsMenuView({
  menu,
  onCommand,
  onNewSession
}: {
  menu: SlashCommandListEntry | null
  onCommand: (command: string) => void
  // #1218 — the control arm, and REQUIRED like every other prop here ("a view that cannot answer is a
  // bug"). It takes NO argument: the screen closes over the same `activeConversationId` it already
  // closes over for `sendText`, which is what stops the send and the restart ever naming different
  // chats. This menu reports the pick and nothing more.
  onNewSession: () => void
}): JSX.Element {
  return (
    <ComposerOptionsMenu
      options={composerActionRows(menu)}
      // A list of actions, not a choice: no row wears aria-current. The panel already handles this
      // through the same branch a non-matching id takes (ComposerOptionsPanel.tsx:32-35).
      currentId={null}
      // #1218 — the two-arm dispatch, and the ONE place the menu's second kind of entry is felt. It is
      // an equality test against one client-owned constant rather than a lookup, a table or an id
      // union: the id is disjoint from every command id (pinned by a test), so the `else` arm is
      // exactly "a slash command" and `onCommand(id)` stays the unchanged straight-through call it was.
      onSelect={(id) => (id === NEW_SESSION_ACTION.id ? onNewSession() : onCommand(id))}
      ariaLabel={COMPOSER_ACTIONS_LABEL}
      triggerContent={
        <>
          {/* #1107 — the word is in a <span> so it can ELLIPSIZE. Under the row's shrink policy every
              footer control gives width when the row is narrow, and a bare text node is an anonymous flex
              item: it cannot be selected, so it cannot carry a truncation chain, so it refuses to shrink
              and pushes the chevron out of the button's clip instead — measured at the 800px minimum, this
              trigger was the only one of the four to lose its glyph. The element takes no max-width, unlike
              its three siblings: their labels are daemon-authored and need a bound, this one is a
              client-owned constant with nothing to bound. */}
          <span className="composer__actions-label">{COMPOSER_ACTIONS_LABEL}</span>
          {/* aria-hidden is load-bearing: the container puts no aria-label on the trigger (WCAG 2.5.3
              label-in-name), so the button's accessible name is computed from its contents, and an
              exposed <svg> could perturb the exact `Actions` string the e2e locator matches. */}
          <svg
            className="composer__actions-icon"
            viewBox="0 0 8 4"
            width="8"
            height="4"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d={CHEVRON_PATH} />
          </svg>
        </>
      }
      // A two-class mix since #988 lifted the shared footer-button treatment out of this rule on its
      // second consumer (the .button-small shape): the block carries the reset, the type and the colour,
      // and .composer__actions is left with `cursor: pointer` alone. Five shipped assertions bind to the
      // exact `class=` run this produces — see ComposerActionsMenu.test.tsx and ConversationScreen.test.tsx.
      triggerClassName="composer__footer-button composer__actions"
    />
  )
}

/**
 * The store-bound container (#681) — the `ComposerModelMenu` / `ComposerEffortMenu` shape on the same
 * footer row, in a leaf so a published menu arriving re-renders this control rather than the textarea and
 * the send button beside it.
 *
 * `conversationId` arrives as a PROP rather than as a second store read, the settled house idiom: the
 * composer already subscribes to `activeConversationId`, so the prop costs no subscription.
 *
 * A useMemo-stable selector per id — a fresh closure each render would churn the subscription. A null
 * conversation selects nothing THROUGH THE SAME PATH, with no invented key and no second branch
 * downstream, and `null` is a stable reference. The selector is narrow-slice by construction: a frame for
 * a DIFFERENT conversation produces a new map whose `get(id)` returns the same entry object, so `Object.is`
 * holds and this component does not re-render.
 */
export function ComposerActionsMenu({
  conversationId,
  onCommand,
  onNewSession
}: {
  conversationId: string | null
  onCommand: (command: string) => void
  onNewSession: () => void
}): JSX.Element | null {
  const available = useConversationActionAvailability(conversationId)
  const selectMenu = useMemo(
    () => (conversationId === null ? () => null : selectSlashCommandListFor(conversationId)),
    [conversationId]
  )
  const menu = useSlashCommandListStore(selectMenu)
  if (!available) return null

  return (
    <ComposerActionsMenuView menu={menu} onCommand={onCommand} onNewSession={onNewSession} />
  )
}
