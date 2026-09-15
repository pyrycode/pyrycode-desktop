// #1421: which pair of integers the two context surfaces render — claude's own reading when one has
// arrived for the conversation, the daemon's transcript-derived settings pair when none has. The composer
// footer's reading and the run-configuration sheet's gauge both call it, which is the whole point: the
// guarantee this ticket ships is that the two surfaces cannot disagree for one conversation, and that
// guarantee is a shared FUNCTION rather than two agreeing edits.
//
// A leaf module beside contextUsage.ts, with NO IMPORTS AT ALL — that module's discipline, inherited for
// its reason: it cannot then participate in the import cycle runConfigLive documents, and it is a VIEW
// derivation rather than store state, so it belongs in neither store. The first parameter is the
// structural minimum rather than `ReportedContextReading`, which is what buys the zero-import property; a
// reading satisfies it structurally, and a rename of either field still fails to typecheck at the call
// site.
//
// It is deliberately NOT a percentage and not a step: the clamp, the finiteness guard and the severity
// ladder stay the one computation in contextUsage.ts, and this module only decides which two numbers go
// into it. Claude's own `percentage` field is therefore held by the store and never read here — the wire
// contract says a client that recomputes disagrees with the figure claude reported, and #1421 recomputes
// anyway, on purpose, to keep one clamp across two surfaces (see the ticket).
//
// SECURITY. Two integers in, two integers out. It reads NONE of the reading's claude- or
// workspace-authored strings — no `model`, no category name, no `server_name`, no `path`, no `type` — and
// it never sees the conversation id, which the caller has already spent as a map key. Neither figure is
// range-checked here and neither needs to be: nothing on this path allocates, iterates, sizes or times
// anything from either one, and the only sinks downstream (the gauge's inline width and its
// aria-valuenow) take contextUsagePercent's clamped result, never a raw figure.

/** The pair both surfaces render: the numerator and the denominator of one context-window reading. */
export interface ContextTokens {
  usedTokens: number
  windowTokens: number
}

/**
 * The winning pair for one conversation.
 *
 * THE ONLY BRANCH IS `reported === null`, and that is the design rather than a shortcut. The fallback
 * fires on an ABSENT reading only — never on a present one, whatever it contains. A present reading whose
 * `maxTokens` is `0` is a real (if degenerate) reading claude reported, so it wins, and the unavailable
 * state each surface already ships is then produced downstream by `contextUsagePercent`'s window guard.
 * A `maxTokens > 0` term here would read that zero as an absence and quietly show the transcript figure
 * instead — the exact defect #1421 removes. Making presence the only test is what stops a later edit from
 * reintroducing it silently: there is no second branch to widen.
 *
 * The absent arm coalesces a not-yet-loaded snapshot with `?? 0` — `RunConfigSections`' shipped
 * expression, now written ONCE rather than at each surface — so the missing snapshot and the daemon's
 * `window_tokens === 0` "usage unavailable" signal collapse into the same downstream path.
 *
 * A PAIR, never two separate resolutions: the numerator and the denominator must come from the same
 * source in the same pass, or the gauge's `N% used (X of Y tokens)` triple could be drawn from two
 * different ones. And a FRESHLY BUILT pair on both arms, never the `settings` argument returned by
 * reference: that argument is a `RunConfigSnapshot`, which also carries a daemon-supplied `model`, and
 * rebuilding is what guarantees nothing but two integers leaves a value typed as `ContextTokens`.
 */
export function contextTokenSource(
  reported: { totalTokens: number; maxTokens: number } | null,
  settings: ContextTokens | null
): ContextTokens {
  if (reported !== null) {
    return { usedTokens: reported.totalTokens, windowTokens: reported.maxTokens }
  }
  return { usedTokens: settings?.usedTokens ?? 0, windowTokens: settings?.windowTokens ?? 0 }
}
