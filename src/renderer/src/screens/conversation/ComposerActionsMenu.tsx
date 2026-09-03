import { ComposerOptionsMenu, type ComposerOptionsPanelOption } from './ComposerOptionsPanel'

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
// zero turns and zero cost — a correct, visible, harmless outcome that this ticket deliberately does not
// detect or guard. Greying one out is #681, which needs a daemon change first.
export const COMPOSER_ACTIONS: readonly ComposerOptionsPanelOption[] = [
  { id: '/clear', label: 'Reset session' },
  { id: '/compact', label: 'Compact session' },
  { id: '/knowledge-capture', label: 'Knowledge capture' }
]

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
 * The Actions trigger and its menu. One required effect prop — the "a view that cannot answer is a bug"
 * rule (ConversationScreen.tsx:2033) — and no store read, no `window.pyry` and no state of its own.
 *
 * It holds NO `canSend` prop on purpose: AC4's gate is the container's single `sendText`, and a second
 * copy of that gate here is a second copy that can drift. The trigger is never disabled, including while
 * disconnected — AC4 asks that picking send nothing, not that the menu be unopenable, and the state is
 * already said elsewhere: #279's banner at the top of the thread in every non-connected arm, and #797's
 * chip or #963's button in the status row directly above the composer. (Until #968 the composer's own
 * `Not connected` caption said it one row up; that caption is retired, the other two surfaces are not.)
 */
export function ComposerActionsMenu({
  onCommand
}: {
  onCommand: (command: string) => void
}): JSX.Element {
  return (
    <ComposerOptionsMenu
      options={COMPOSER_ACTIONS}
      // A list of actions, not a choice: no row wears aria-current. The panel already handles this
      // through the same branch a non-matching id takes (ComposerOptionsPanel.tsx:32-35).
      currentId={null}
      onSelect={onCommand}
      ariaLabel={COMPOSER_ACTIONS_LABEL}
      triggerContent={
        <>
          {COMPOSER_ACTIONS_LABEL}
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
      triggerClassName="composer__actions"
    />
  )
}
