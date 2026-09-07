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

/**
 * How close to the top fires the history walk's next ask, in CSS pixels (#1260).
 *
 * ⭐ THIS IS NOT A TOLERANCE, and reading it as `AT_BOTTOM_TOLERANCE_PX`'s twin is the one way to get it
 * wrong. That constant is a rounding allowance around an exact position; this one is a deliberate RIM the
 * ask fires from BEFORE the reader reaches the wall, and the reason is a browser behaviour rather than a
 * preference. Chromium suppresses scroll anchoring when a scroller's offset is exactly zero — measured in
 * `thread-scroll-pin.spec.ts`'s #1046 section, which parks at 40% rather than at the top for precisely
 * this reason — and anchoring is the whole mechanism that holds the reader's place when a served page is
 * prepended above them. An ask fired only at the top would therefore fire at the one offset where the
 * mechanism it depends on is off. Do not shrink this to a tolerance.
 *
 * Fenced on three sides rather than chosen freely:
 *
 * - Two of Chromium's ~100px wheel notches, so a reader scrolling back with the wheel enters the band a
 *   frame or more before reaching zero.
 * - An order of magnitude above `AT_BOTTOM_TOLERANCE_PX`, so it reads as proximity rather than as
 *   accumulated sub-pixel error.
 * - A quarter of the app's 800px minimum window height, so it stays a rim rather than a viewport.
 *
 * A reader who lands on exactly zero anyway — a fling, `Home`, a programmatic jump — still asks, and that
 * one page arrives without their place held. That is a KNOWN, stated bound rather than an oversight:
 * closing it needs production code that measures the growth and writes `scrollTop` itself, which is a
 * second mechanism competing with anchoring for the same job.
 */
export const HISTORY_ASK_BAND_PX = 200

/**
 * Is the thread scrolled back to within `HISTORY_ASK_BAND_PX` of its top?
 *
 * ONE comparison against the offset alone, in the shape `isAtBottom` argues for: the elastic overshoot
 * past the top (a negative offset) and the thread too short to scroll (an offset pinned at zero) are both
 * consequences of the same expression rather than branches, so there is no clamp, no `Math.max` and no
 * "can it scroll at all" guard. `<=`, not `<`, so the boundary belongs to the band.
 *
 * It reads NEITHER of the other two metrics, and takes the whole `ThreadScrollMetrics` anyway: the call
 * site measures all three off one node for `isAtBottom` in the same breath, and a second parameter shape
 * would invite a bare number at exactly the site whose named fields exist to make the mapping correct by
 * inspection.
 */
export function isNearTop(metrics: ThreadScrollMetrics): boolean {
  return metrics.scrollOffset <= HISTORY_ASK_BAND_PX
}
