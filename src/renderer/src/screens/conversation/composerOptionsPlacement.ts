// #839 — the right-edge clamp for the composer footer's options panel. Framework-free and React-free,
// co-located with the screen like threadScrollPosition.ts / composerSend.ts / contextUsage.ts. It performs
// no effects, so like threadScrollPosition it takes no injected deps: a total function of three numbers.
//
// The ticket splits along one line, and the split is the design. AC1 (the panel opens upward) and AC2 (its
// left edge sits 12px left of its button's, putting the labels in line) are PURE CSS — `.composer-options`
// is absolutely positioned against a `.composer-options-anchor` wrapper with `bottom: 100%` and a negative
// `left`, measuring nothing. AC3 — never render outside the window — is the one piece that genuinely needs
// arithmetic, and it lives here where the `node` vitest environment can prove it. That is the ticket's
// "keep the measuring at the edge and the arithmetic out of it" applied literally.
//
// It ships DORMANT BY DESIGN. Nothing calls it today: there is no footer menu button to open the panel
// from — #680 Actions, #682 permission mode, #683 model and effort, #685 attach and #694's slash-command
// type-ahead are all queued behind this — so the caller's shape depends on facts those tickets own. Do not
// add a caller here to "prove it works"; the sibling test proves it, exactly as threadScrollPosition.ts
// shipped ahead of #601.
//
// HOW A CONSUMER WIRES IT, so the first one reads the recipe from the code rather than re-deriving it:
//
//   <div className="composer-options-anchor" ref={anchorRef}
//        style={{ '--composer-options-shift': `${shiftPx}px` } as CSSProperties}>
//     <button type="button" …>Max</button>
//     {open && <ComposerOptionsPanel … />}
//   </div>
//
// On open, in a useLayoutEffect (before paint, so no unclamped frame is ever visible), read
// `anchorRef.current.getBoundingClientRect().left`, the panel's `offsetWidth` and `window.innerWidth`, pass
// them here, and write the result onto the anchor's `--composer-options-shift`. Re-run on `resize`. The
// panel mounts at its resting position and the effect corrects it, so the common case is a no-op shift of 0.
//
// The custom property is set on the ANCHOR, not on the panel: inheritance carries it down, which is what
// lets placement be applied without widening #838's four-prop surface or forwarding a ref into the panel.
// The value MUST carry a unit — a bare number makes the whole `left` declaration invalid at
// computed-value time, dropping the panel to `left: auto` and its static position. That is a CSS rule this
// module cannot defend against, which is why it is stated here.
//
// Measuring `panelWidth` needs a handle on the panel element. #840 added one: `ComposerOptionsPanel` takes
// an optional `panelRef`, and `ComposerOptionsMenu` already holds a ref on it to move focus with. So the
// first consumer measures through that ref rather than reaching through the anchor with `querySelector` —
// the wiring above is all that is left to write. The ref arrived for focus, not for measurement; sharing it
// is a bonus, and #840 deliberately did not wire the clamp, since no anchor has a real x-position until a
// real footer button gives it one.

/**
 * The three measurements the clamp reads, as plain numbers — no DOM node, no React, no store. All in CSS
 * pixels, in window coordinates, fractions welcome.
 *
 * Named fields rather than three positional numbers on purpose — threadScrollPosition.ts:16-20's reasoning
 * verbatim: same-typed positionals transpose silently, and the transposition that matters here
 * (`panelWidth` ↔ `windowWidth`) produces a wrong answer with no type error. The call site is a consumer's
 * layout effect, which is untested reviewed glue under the renderer's test posture, so the argument names
 * have to make that glue correct by inspection.
 *
 * `anchorLeft`, not the panel's own measured left. Reconstructing the resting left from the anchor costs
 * one duplicated constant (below), but it keeps every input IDEMPOTENT UNDER THE SHIFT: the anchor does
 * not move when the panel shifts and the panel's width does not change, so re-running the effect on a
 * resize reads the same numbers and converges. Measuring the panel's shifted left instead would need a
 * reset-measure-apply dance at the one place in this feature that has no test — put the robustness where
 * the proof is absent.
 *
 * `windowWidth` is the WINDOW's right edge, deliberately, not the chat pane's. At the 800px minimum the
 * pane's right edge is 780 (800 minus `.paired-shell`'s 20px padding) while the window's is 800, so a
 * clamped panel may overhang that 20px gutter. Three reasons: AC3 names the window; the gutter is
 * `.paired-shell`'s own empty backdrop, so nothing is occluded, and the sidebar is on the other side; and
 * `window.innerWidth` is a plain property read, where clamping to the pane would mean measuring
 * `.conversation`'s rect or hard-coding the shell's padding into this screen — more work at the untested
 * edge, and a new coupling, to buy a cosmetic 20px. If a visual review ever reads the overhang as wrong,
 * the correction is confined to what a consumer passes here; the function, the CSS and the tests stand.
 */
export interface ComposerOptionsPlacementMetrics {
  anchorLeft: number
  panelWidth: number
  windowWidth: number
}

/**
 * How far a row's label sits in from the panel's left edge, in CSS pixels — and therefore how far LEFT of
 * its button the panel's own left edge sits, which is the whole of AC2.
 *
 * This mirrors `.composer-options__item { padding: 0 var(--space-3) }` (conversation.css, #838). The two
 * are ONE quantity seen from two sides: the row inset the panel negates so an option's label lands
 * horizontally flush with its footer button's label (the operator's instruction, 2026-08-22). If that
 * padding ever moves, this must move with it or the labels drift apart.
 *
 * There is no detector for that cross-file coupling — #838's standing prohibition is that no test reads
 * `conversation.css` as text — so it is carried by paired comments (the stylesheet's `left` rule says the
 * same thing from its side) plus the pinning test, exactly as `AT_BOTTOM_TOLERANCE_PX` is.
 */
export const COMPOSER_OPTIONS_LABEL_INSET_PX = 12

/**
 * How far LEFT the panel must be pulled from its resting position to stay inside the window, in CSS pixels.
 * Zero whenever it already fits, which is the common case.
 *
 * ONE `Math.max`, deliberately — the overflow past the window's right edge, floored at zero. Every case is
 * a consequence of that quantity's value rather than a branch of its own: negative and floored to 0 for a
 * panel with room to spare, exactly 0 for one whose resting right edge lands on the window edge (so the
 * boundary is not nudged by a pixel), and 0 for a zero-width panel, which cannot overflow from a reachable
 * anchor. No throw, no guard.
 *
 * No LEFT clamp, and no second branch: the sidebar is `flex: 0 0 400px` and never shrinks
 * (pairedShell.css:43), so the leftmost footer button's left edge is 20 + 400 + 20 + 12 + 16 = 468 at
 * EVERY window width and the panel's leftmost resting edge is 456. The left edge is unreachable by
 * construction, and a guard for it would be an untestable branch defending an unobservable failure.
 *
 * No rounding: `getBoundingClientRect()` returns fractions and CSS lengths accept them, so rounding here
 * would be a silent half-pixel drift with nothing asking for it.
 */
export function composerOptionsShiftPx(metrics: ComposerOptionsPlacementMetrics): number {
  const restingLeft = metrics.anchorLeft - COMPOSER_OPTIONS_LABEL_INSET_PX
  const overflowPastWindow = restingLeft + metrics.panelWidth - metrics.windowWidth

  return Math.max(0, overflowPastWindow)
}
