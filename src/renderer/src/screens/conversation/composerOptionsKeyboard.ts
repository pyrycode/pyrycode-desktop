// #840 — the composer options panel's keyboard contract, as plain data. Framework-free and DOM-free,
// co-located with the screen like composerSend.ts / composerOptionsPlacement.ts / threadScrollPosition.ts.
//
// WHY IT IS A MODULE RATHER THAN A HANDLER. Nothing in this repo can click: vitest.config.ts sets
// `environment: 'node'`, there is no jsdom and no @testing-library, and the Playwright tiers drive the whole
// app, which has no footer menu button until #680. So the proof has to be ARRANGED. Everything the keyboard
// decides — where focus starts, where each arrow moves it, which key picks and which dismisses — is a total
// function of three values here, where a vitest spec can execute it; what is left in the container is the
// useState, the listeners and the focus calls, thin enough to be correct by inspection.
//
// It is a standalone module rather than private to ComposerOptionsMenu because #694's trigger is the message
// box rather than a button, so it composes ComposerOptionsPanel with this function against the textarea
// itself. The pure decision is the part every consumer shares; the container is not.
//
// composerSend.ts:93-126 is the repo's precedent for exactly this shape — `ComposerKeyEvent` +
// `shouldSubmitOnKeyDown`, the fields destructured off the synthetic event so the decision stays testable
// with no DOM. This is that pattern with a richer return.

import type { ComposerOptionsPanelOption } from './ComposerOptionsPanel'

/**
 * Everything the decision reads about an open panel and the keystroke it just received.
 *
 * A named object rather than three positional arguments, for composerOptionsPlacement.ts:44-52's reason
 * verbatim: `optionCount` and `focusedIndex` are the same type and transpose silently, producing a wrong
 * answer with no type error, and the one call site is a container's key handler — untested reviewed glue
 * under this repo's renderer test posture, so the argument names have to make that glue correct by
 * inspection.
 *
 * `key` is `KeyboardEvent.key` verbatim, never normalised: the unhandled keys have to reach the `ignore`
 * branch as themselves so the caller can tell "not ours" from "handled".
 */
export interface ComposerOptionsKeyInput {
  optionCount: number
  focusedIndex: number
  key: string
}

/**
 * What the keystroke does. A sealed union on `type` (CLAUDE.md), and the four shapes are exhaustive:
 *
 * - `focus` — move focus to `index`; the panel stays open. `index` is always in `[0, optionCount)`.
 * - `pick`  — report `options[index].id` and close. Range-guarded, so that lookup is always addressable.
 * - `dismiss` — close, reporting nothing. It carries no index at all, so no selection can leak out of it.
 * - `ignore` — not ours. The caller must leave the event completely alone, `preventDefault` included.
 */
export type ComposerOptionsKeyOutcome =
  | { type: 'focus'; index: number }
  | { type: 'pick'; index: number }
  | { type: 'dismiss' }
  | { type: 'ignore' }

/**
 * Which row has focus the moment the panel opens: the current option, or the first one when there is none.
 *
 * One expression covers all three cases the panel already distinguishes. A value menu (#682 permission
 * mode, #683 model and effort) opens on what it currently reads, which is where the arrows should be
 * relative to; a command list (#680 Actions, #694's slash commands — `currentId: null`) opens on its first
 * entry; and a STALE id that matches nothing lands on the first entry through the same `-1` branch, no
 * special case and no throw, exactly as ComposerOptionsPanel.tsx:30-32 handles a stale id in the markup.
 *
 * This is the only part of the module that is not plain numbers — it matches on `id`, so it takes the
 * option objects. The import is `import type`, erased at build, so there is no runtime cycle with the panel.
 */
export function initialFocusedOptionIndex(
  options: readonly ComposerOptionsPanelOption[],
  currentId: string | null
): number {
  const at = options.findIndex((option) => option.id === currentId)

  return at === -1 ? 0 : at
}

/**
 * Where a step of `delta` from `focusedIndex` lands, wrapped into `[0, optionCount)`.
 *
 * ARROWS WRAP, deliberately: the ARIA menu pattern specifies it, the panel is a short fully-visible closed
 * ring with no "off the end" affordance drawn, and wrapping puts the last option one keystroke from the top.
 *
 * The doubled modulo is load-bearing twice over. `-1 % 3` is `-1` in JavaScript, so adding the count back
 * before the second `%` is what keeps a wrap off the top addressing a real row rather than none. And the
 * second `%` runs on a non-negative number, which is what rules out `-0` — `Object.is(-0, 0)` is false, so a
 * negative zero would satisfy every range check and still fail a strict comparison at a later call site.
 * A far-out-of-range `focusedIndex` normalises through the same two operations, with no guard of its own.
 */
function wrappedIndex(focusedIndex: number, delta: number, optionCount: number): number {
  return (((focusedIndex + delta) % optionCount) + optionCount) % optionCount
}

/**
 * What one keystroke does to an open panel. Total: it throws for no input, and every `focus` index it
 * emits addresses a real option.
 *
 * `Escape` is answered BEFORE the option-count guard — dismissing an empty panel is still dismissing it.
 * Every other key on an empty panel is ignored: `optionCount === 0` is the caller's own bug (consumers gate
 * on `options.length`), not something to invent a row for.
 *
 * `Enter` is intercepted and `Space` is not, each for its own reason. Enter MUST be intercepted: without the
 * caller's `preventDefault` the focused row's native button activation would fire `onSelect` a second time
 * on top of this `pick` — so routing it through here costs nothing and is what makes "Enter picks the
 * focused option" provable in vitest at all. Space needs no interception: it returns `ignore`, no
 * `preventDefault` runs, and the row's native activation picks it through the `onClick` the panel already
 * wires. Two paths to one outcome, on purpose.
 *
 * `Home`, `End`, `ArrowLeft`, `ArrowRight` and `Tab` are unhandled and fall through to the browser. None is
 * an acceptance criterion; Left/Right belong to a menubar, which does not exist here. Adding Home/End later
 * is two lines and two test cases.
 */
export function resolveComposerOptionsKey(input: ComposerOptionsKeyInput): ComposerOptionsKeyOutcome {
  const { optionCount, focusedIndex, key } = input

  if (key === 'Escape') return { type: 'dismiss' }
  if (optionCount <= 0) return { type: 'ignore' }

  switch (key) {
    case 'ArrowDown':
      return { type: 'focus', index: wrappedIndex(focusedIndex, 1, optionCount) }
    case 'ArrowUp':
      return { type: 'focus', index: wrappedIndex(focusedIndex, -1, optionCount) }
    case 'Enter':
      // Range-guarded rather than clamped: with focus on no row there is nothing under the user's finger
      // to pick, and clamping would pick a row they never saw highlighted. #694's type-ahead narrows the
      // option list while the panel is open, so a left-over focusedIndex is a real shape, not a hypothetical.
      return focusedIndex >= 0 && focusedIndex < optionCount
        ? { type: 'pick', index: focusedIndex }
        : { type: 'ignore' }
    default:
      return { type: 'ignore' }
  }
}
