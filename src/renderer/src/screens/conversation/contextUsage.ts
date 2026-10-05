// #811: the session's context-window usage as a percentage — the ONE computation, framework-free and
// React-free, co-located with the screen (the composerSend.ts idiom). Extracted from the expression that
// lived inline in RunConfigSections' ContextWindowSection, because there are now two surfaces for the
// same number — the run-configuration sheet's gauge and the composer footer's reading — and a second
// clamp beside the first is a drift waiting to happen.
//
// A leaf module with no imports at all, deliberately: it cannot participate in the import cycle
// runConfigLive.ts:20-27 documents, and it is a VIEW derivation rather than store state, so it does not
// belong in runConfigStore.ts (whose own docstring scopes it to state plus read-only selectors).

/**
 * The session's context-window usage as a whole-number percentage, or `null` when no real window size is
 * known. Total over its inputs: every `number` pair returns either `null` or an integer in [0, 100].
 *
 * `null` rather than a number beside a separate `available` boolean — the GUARD is what the two surfaces
 * share, not merely the arithmetic. Two callers cannot disagree about whether a reading exists when the
 * predicate IS the return type.
 *
 * The window guard is the single load-bearing branch, and it collapses three unavailable states into one
 * path: the daemon's `window_tokens === 0` "usage unavailable" signal (a foreground session, or no
 * transcript yet), the not-yet-loaded store default (both callers coalesce `snapshot === null` to 0), and
 * a stray negative. The division runs only inside it, so there is no NaN, no Infinity and no
 * divide-by-zero. The result is clamped to [0, 100] so an over-full session reads 100 and the sheet's
 * fill never overflows its track, and a negative used count reads 0.
 *
 * `Number.isFinite(windowTokens)` closes a hole the shipped clamp had: `used_tokens` / `window_tokens`
 * are parsed by a bare `requireNumber` (inboundMessage.ts:533-534), a `typeof === 'number'` test that
 * range-checks nothing on purpose (:611-622 — a client-invented bound would drop valid future frames, and
 * "the render slice formats the counter defensively instead"). A frame carrying `1e999` for both parses
 * to `Infinity` for both, and `Infinity / Infinity` is `NaN`, which every one of Math.round / Math.max /
 * Math.min propagates — so without this term a daemon could put `Context: NaN%` on the footer and a
 * `width: NaN%` fill in the sheet. There is deliberately NO matching term for `usedTokens`: against a
 * finite, positive window, `Infinity` clamps to an honest 100 and `-Infinity` to an honest 0, so a second
 * guard would be an unreachable, untestable branch.
 */
export function contextUsagePercent(usedTokens: number, windowTokens: number): number | null {
  if (!Number.isFinite(windowTokens) || windowTokens <= 0) return null
  return Math.min(100, Math.max(0, Math.round((usedTokens / windowTokens) * 100)))
}

/**
 * #1062: how full is full enough to say so — amber from 70% and red from 85% since #1728. The reading's
 * severity as a coarse step, named for the ROLE rather than for the colour — `warning` and `error` are
 * exactly the `--color-*` token suffixes and exactly the `.composer__context--*` class modifiers, so the
 * mapping from step to paint is nominal at every layer and a fourth step would be one obvious edit rather
 * than three lookups.
 *
 * Beside `contextUsagePercent` rather than inline at the reading, and not in the stylesheet at all,
 * because the two boundaries are VALUES: a `.ts` + `.test.ts` pair can assert 69 → primary and 70 →
 * warning directly, where a CSS rule could only be asserted through a rendered colour. It is also what
 * leaves the run-configuration sheet's gauge one class away from following the same ladder later — that
 * bar is deliberately still `--color-success` at every value, and #1062 did not change it.
 *
 * ONE DESCENDING LADDER, so each boundary is written exactly once and no gap between the arms is
 * expressible. Inclusive at both: 69 is primary, 70 is warning, 84 is warning, 85 is error. The literals
 * stay literals and are NOT exported as named constants — a test naming the same symbol the ladder is
 * written from would pin nothing, so `contextUsage.test.ts` hard-codes both pairs instead.
 *
 * `number`, not `number | null`: the absent reading is already resolved by `contextUsagePercent`'s return
 * type one line earlier at the only call site, and taking a nullable here would re-open a guard that is
 * deliberately a type rather than a convention. Total over its input all the same — `NaN` fails both
 * comparisons and falls through to `primary`, the same arm the shipped colour has always used — so a
 * second caller cannot find a hole, even though the first one cannot reach one.
 */
export type ContextUsageStep = 'primary' | 'warning' | 'error'

export function contextUsageStep(percent: number): ContextUsageStep {
  if (percent >= 85) return 'error'
  if (percent >= 70) return 'warning'
  return 'primary'
}
