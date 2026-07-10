// The paired region's inner navigation model — the second-level router under App's `conversation`
// route. Framework-free and React-free, co-located with PairedShell and mirroring appRoute.ts /
// pairingState.ts: a bare string-union route plus a total, pure transition reducer, tested with no
// React, store, or Electron. PairedShell is the thin container (a useReducer) over this.

/**
 * The two views of the paired region today: the channel `list` (home) and a single conversation
 * `thread`. Extensible by construction — a future Settings or Archive view is an added union member,
 * not a rewrite (AC1). Mirrors AppRoute's bare string union.
 */
export type PairedRoute = 'list' | 'thread'

/**
 * The sealed nav-event union driving transitions (CLAUDE.md's discriminated-union convention). `open`
 * pushes the active conversation's thread; `back` returns to the list. A future navigation event (e.g.
 * `openSettings`) is an added arm, forced by the assertNever exhaustiveness guard below.
 */
export type PairedNav = { type: 'open' } | { type: 'back' }

/** Compile-time exhaustiveness guard: a new PairedNav arm without a case is a type error. */
function assertNever(nav: never): never {
  throw new Error(`Unhandled paired nav: ${JSON.stringify(nav)}`)
}

/**
 * The (state, event) => state transition — the useReducer shape (ADR 0006). `current` is unreferenced
 * today (both transitions are absolute — `open` always lands on `thread`, `back` always on `list`),
 * but kept in the signature so a future stack-aware `back` (settings/archive → list vs. thread → list)
 * is an added arm, not a signature rewrite. Both transitions are idempotent: `open` from `thread`
 * stays `thread`, `back` from `list` (home) stays `list`. (`noUnusedParameters` is off in both
 * tsconfigs, so the unreferenced `current` is not a compile error.)
 */
export function nextPairedRoute(current: PairedRoute, nav: PairedNav): PairedRoute {
  switch (nav.type) {
    case 'open':
      return 'thread'
    case 'back':
      return 'list'
    default:
      return assertNever(nav)
  }
}
