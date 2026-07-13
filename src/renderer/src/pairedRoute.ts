// The paired region's inner navigation model — the second-level router under App's `conversation`
// route. Framework-free and React-free, co-located with PairedShell and mirroring appRoute.ts /
// pairingState.ts: a bare string-union route plus a total, pure transition reducer, tested with no
// React, store, or Electron. PairedShell is the thin container (a useReducer) over this.

/**
 * The views of the paired region: the channel `list` (home), a single conversation `thread`, and the
 * `settings` scaffold (#333). Extensible by construction — `settings` was added as one union member, not
 * a rewrite (AC1); a further Archive view would be the same. Mirrors AppRoute's bare string union.
 */
export type PairedRoute = 'list' | 'thread' | 'settings'

/**
 * The sealed nav-event union driving transitions (CLAUDE.md's discriminated-union convention). `open`
 * pushes the active conversation's thread; `openSettings` opens the Settings screen (#333); `back`
 * returns to the list. Each new navigation event is an added arm, forced by the assertNever
 * exhaustiveness guard below.
 */
export type PairedNav = { type: 'open' } | { type: 'openSettings' } | { type: 'back' }

/** Compile-time exhaustiveness guard: a new PairedNav arm without a case is a type error. */
function assertNever(nav: never): never {
  throw new Error(`Unhandled paired nav: ${JSON.stringify(nav)}`)
}

/**
 * The (state, event) => state transition — the useReducer shape (ADR 0006). `current` is unreferenced
 * today (all transitions are absolute — `open` always lands on `thread`, `openSettings` on `settings`,
 * `back` always on `list`), but kept in the signature so a future stack-aware `back` (settings/archive →
 * list vs. thread → list) is an added arm, not a signature rewrite. Settings → home reuses this absolute
 * `back` (#333, AC3). Transitions are idempotent: `open` from `thread` stays `thread`, `back` from
 * `list` (home) stays `list`. (`noUnusedParameters` is off in both tsconfigs, so the unreferenced
 * `current` is not a compile error.)
 */
export function nextPairedRoute(current: PairedRoute, nav: PairedNav): PairedRoute {
  switch (nav.type) {
    case 'open':
      return 'thread'
    case 'openSettings':
      return 'settings'
    case 'back':
      return 'list'
    default:
      return assertNever(nav)
  }
}
