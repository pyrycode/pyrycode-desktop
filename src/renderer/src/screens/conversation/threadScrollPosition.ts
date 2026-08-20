// The at-bottom test for the thread scroll region — framework-free and React-free, co-located with the
// screen like composerSend.ts / dropQueuedMessage.ts / messageViewModel.ts. It performs no effects, so
// unlike those it takes no injected deps: it is a total function of three numbers.
//
// Why it lives on its own, unreferenced: this is the one genuinely unit-testable piece of the
// follow-the-conversation feature (#599's split). Everything downstream — the ref, the scroll listener,
// the re-assert after the list changes (#601) — is DOM and effect work that the renderer's test layer
// cannot execute (vitest runs in the `node` environment, so renderer tests are renderToStaticMarkup
// string assertions: effects never run and there is no scrollTop to read). Isolating the arithmetic here
// gives the feature a tested core before any of it touches the DOM. It ships dormant BY DESIGN — #601
// adds the caller; do not add one here to "prove it works", the sibling test proves it.

/**
 * The three scroll metrics the at-bottom test reads, as plain numbers — no DOM node, no React, no store.
 * `scrollOffset` carries the DOM's own convention without its vocabulary: it grows downward from zero.
 *
 * Named fields rather than three positional numbers on purpose: same-typed positionals transpose
 * silently, and the transposition that matters (`clientHeight` ↔ `scrollHeight`) would produce a wrong
 * answer with no type error. The call site is #601's scroll handler, which is untested reviewed glue
 * under the renderer's test posture, so the argument names have to make that glue correct by inspection.
 */
export interface ThreadScrollMetrics {
  scrollOffset: number
  viewportHeight: number
  contentHeight: number
}

/**
 * How close to the bottom still counts as at the bottom, in CSS pixels. Fenced on both sides by
 * behaviour, not chosen freely:
 *
 * - Above sub-pixel error. Each metric's error is under 1px, but three feed the comparison and the
 *   integer-vs-fractional split between them is engine-dependent (`scrollHeight`/`clientHeight` are
 *   rounded, `scrollTop` is fractional), so the accumulated error is realistically ~1–2px at a high
 *   device pixel ratio or under zoom. 4 clears that with headroom.
 * - Well below one line of message text (`--text-body-medium-line` is 20px). At 4px the band is a fifth
 *   of a line, so it can never swallow a deliberate one-line scroll-away.
 *
 * There is no mobile value to mirror: mobile reverses the layout and tests an exact index
 * (`ThreadScreen.kt:249-256`), so it carries no pixel tolerance at all. This is a desktop-only invention
 * forced by the DOM.
 */
export const AT_BOTTOM_TOLERANCE_PX = 4

/**
 * Is the thread scrolled to the bottom, within `AT_BOTTOM_TOLERANCE_PX`?
 *
 * ONE comparison, deliberately — the distance from the bottom against the tolerance. Every case is a
 * consequence of that quantity's value rather than a branch of its own: it is exactly the tolerance at
 * the boundary, zero at the true bottom, negative on an elastic overshoot (`scrollOffset` plus
 * `viewportHeight` running past `contentHeight`), and negative or zero whenever the content is no taller
 * than the viewport — the short thread that cannot scroll, which pins from its first message. So no
 * clamp, no `Math.max`, and no "can it scroll at all" guard: each would add a branch nothing can
 * exercise. `<=`, not `<`: a distance equal to the tolerance reads as at-bottom.
 *
 * If a case turns up that genuinely needs a second branch, that is a signal the criteria are wrong —
 * route back rather than guarding around them.
 */
export function isAtBottom(metrics: ThreadScrollMetrics): boolean {
  const distanceFromBottom =
    metrics.contentHeight - (metrics.scrollOffset + metrics.viewportHeight)

  return distanceFromBottom <= AT_BOTTOM_TOLERANCE_PX
}
