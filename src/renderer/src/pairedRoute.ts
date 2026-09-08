// The paired region's inner navigation model — the second-level router under App's `conversation`
// route. Framework-free and React-free, co-located with PairedShell and mirroring appRoute.ts /
// pairingState.ts: a bare string-union route plus a total, pure transition reducer, tested with no
// React, store, or Electron. PairedShell is the thin container (a useReducer) over this.

/**
 * The views of the paired region: the channel `list` (home), a single conversation `thread`, the
 * `settings` scaffold (#333), `pairServer` — the existing pairing flow re-opened from inside the paired
 * app to switch to a different daemon (#152) — and the `archive` screen scaffold (#347). Extensible by
 * construction — each was added as one union member, not a rewrite (AC1). Mirrors AppRoute's bare string
 * union.
 */
export type PairedRoute = 'list' | 'thread' | 'settings' | 'pairServer' | 'archive'

/**
 * The sealed nav-event union driving transitions (CLAUDE.md's discriminated-union convention). `open`
 * pushes the active conversation's thread; `openSettings` opens the Settings screen (#333);
 * `openArchive` opens the Archive screen (#347); `back` returns to the list. The three pair-server arms
 * (#152) are the entry (`openPairServer`) and the two pairing exits: `pairServerCancelled`
 * (non-destructive, back to wherever pairing was launched from, #1303) and `pairServerPaired` (done,
 * home to the new server's list, AC3). Each new navigation event is an added arm, forced by the
 * assertNever exhaustiveness guard below.
 *
 * #1303 GAVE `pairServerCancelled` THE ONE PAYLOAD IN THIS UNION, and until then this docblock could say
 * "the Settings entry" because Settings was the only one. It is not: the Channels and Chats section
 * headers each carry a plus that opens the same flow, so cancel's destination stopped being a constant
 * and became "the surface pairing was launched from" — Settings from the Settings row, the sidebar view
 * the operator left from either plus. See the arm below for why the origin rides the event rather than
 * being remembered here.
 */
export type PairedNav =
  | { type: 'open' }
  | { type: 'openSettings' }
  | { type: 'openArchive' }
  | { type: 'back' }
  | { type: 'openPairServer' }
  | { type: 'pairServerCancelled'; returnTo: PairedRoute }
  | { type: 'pairServerPaired' }

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
    case 'openArchive':
      return 'archive'
    case 'back':
      return 'list'
    case 'openPairServer':
      return 'pairServer'
    case 'pairServerCancelled':
      // AC4: cancel returns to where pairing was launched, NOT the list — a distinct destination from a
      // completed pair, so it is its own arm and cannot reuse the absolute `back`. #1303 turned that
      // destination from the `'settings'` literal it was into the event's own field, because a second
      // entry point (the section-header plus) made it origin-dependent. The RULE is unchanged and is the
      // one cancel has always honoured from Settings; only the number of surfaces it can name grew.
      //
      // THE ORIGIN RIDES THE EVENT BECAUSE THIS REDUCER CANNOT KNOW IT. By the time cancel fires,
      // `current` is `'pairServer'`, which says nothing about where the operator came from; remembering
      // it here would mean making the reducer stateful — a `{ route, origin }` pair threading through
      // every transition and every read — to carry one value that exactly one arm consumes. The
      // container records it instead, from the route it was on when the flow opened (`PairedShell`'s
      // `pairServerReturn`).
      //
      // TYPED AS THE WHOLE `PairedRoute` AND NOT A NARROWER ORIGIN UNION. Only `list`, `thread` and
      // `settings` are reachable, and they are reachable BY CONSTRUCTION rather than by type: the sole
      // writer records the current route at `openPairServer`, which can only fire from a surface that
      // renders an entry, and neither the pairing screen (which replaces the whole shell) nor the archive
      // screen renders one. A narrower union would buy that guarantee back at the cost of a total
      // narrowing function in the container whose fallback arm is unreachable — dead code needing a test
      // that cannot be motivated.
      return nav.returnTo
    case 'pairServerPaired':
      // AC3: a successful pair goes home to the new server's channel list, not "back" to settings —
      // semantically "done, go home", and forward-safe if `back` ever becomes stack-aware.
      return 'list'
    default:
      return assertNever(nav)
  }
}
