// The "what does each pairing change do" decision (#1141) — framework-free and React-free,
// co-located with PairedShell beside its other pure helpers activateConversation.ts,
// exitActiveConversation.ts, clearPairingScopedState.ts and pairedRoute.ts, and mirroring
// unpairAction.ts / composerSend.ts: the effects are injected so the helper is a pure, deterministic
// function tested with plain spies (no React, no store, no Electron). PairedShell's three
// pairing-change callbacks are thin glue over this.
//
// It exists because the interesting half of this decision is a NEGATIVE. Two of the three changes
// must clear nothing, and until this module those two were proven only by the absence of a call in
// PairedShell's JSX — unobservable here, since `vitest.config.ts` is `environment: 'node'`: renderer
// specs are static server renders with no DOM, no effects and no event handlers, so nothing in this
// repo could ever invoke an inline arrow held in a prop. Lifting the wiring out gives the negative
// somewhere to land, and gives the unpair path's clear-then-navigate ordering its first executable
// assertion since #531 took the one that used to live in unpairAction.test.ts.

/**
 * The three ways a pairing changes from inside the paired shell. A closed union rather than three
 * exported functions, and that is the load-bearing half: the `assertNever` default below makes
 * "does this change clear the pairing-scoped state?" a COMPILE-FORCED question at every future
 * member — the same tripwire shape `ClearPairingScopedStateDeps`' thirteen-key pin uses one layer
 * down. Three separate helpers would let a fourth transition be added beside them with the question
 * never asked, which is precisely how the bug #1141 fixes came to exist.
 *
 *  - `unpaired`                   — the operator forgot the LAST paired server. App flips its route
 *                                   to `pairing` and this shell unmounts.
 *                                   #1162 gave it a SECOND caller and #1163 moved the first one onto
 *                                   the same rule, so BOTH unpair paths — the Settings row's
 *                                   per-server Unpair and the composer's Re-pair — forget one named
 *                                   server and reach this member only when the refreshed collection
 *                                   comes back EMPTY. Forgetting one of several servers ends no
 *                                   pairing the app still has, so it stays inside the shell and never
 *                                   arrives here. The condition lives in `runUnpairServer`, in ONE
 *                                   copy that both paths compose with (`runUnpair` delegates to it),
 *                                   because a caller holding the refreshed list is the only thing
 *                                   that can know the remaining count. This member's contract is
 *                                   therefore unchanged and is now honoured on every path: reaching
 *                                   it means the app is no longer paired to anything, so the clear is
 *                                   owed in full.
 *  - `pairedAnotherServer`        — the operator ADDED a server. `pairServer` → `list` inside this
 *                                   shell; nothing has ended and nothing is left.
 *  - `cancelledPairAnotherServer` — the operator backed out of the pairing dialog. `pairServer` →
 *                                   `settings`; no server was reached at all.
 */
export type PairingChange = 'unpaired' | 'pairedAnotherServer' | 'cancelledPairAnotherServer'

/**
 * The four effects applyPairingChange performs, injected to keep it pure:
 *  - `clearPairingScopedState` — PairedShell's `clearPairingDeps` applied to the shared thirteen-store
 *                                clear. Nullary HERE on purpose: this helper decides WHETHER a change
 *                                clears, never WHAT the clear contains — that set, its ordering
 *                                constraint and its membership rule all stay behind
 *                                `clearPairingScopedState`'s own interface and its own test.
 *  - `navigateToPairingScreen` — App's route flip to `pairing`, which unmounts this shell.
 *  - `navigateToNewServerList` — the `pairServerPaired` nav, landing on the list (#152 AC3).
 *  - `returnToSettings`        — the `pairServerCancelled` nav, back to Settings (#152 AC4).
 *
 * Three separate nav effects rather than one `navigate` the caller pre-binds, because the three
 * destinations are the substance of the decision and not glue: keeping them apart is what lets a
 * test assert that each arm drives exactly ONE of them and leaves the other two untouched, so a
 * cross-wiring of two transitions onto one destination cannot pass unnoticed.
 */
export interface PairingChangeDeps {
  clearPairingScopedState: () => void
  navigateToPairingScreen: () => void
  navigateToNewServerList: () => void
  returnToSettings: () => void
}

/** Compile-time exhaustiveness guard: a new PairingChange member without a case is a type error. The
 *  module-local shape is the renderer's idiom — pairedRoute.ts, threadTimeline.ts, composerSend.ts
 *  and seven more each carry their own, each narrowing its own union. */
function assertNever(change: never): never {
  throw new Error(`Unhandled pairing change: ${JSON.stringify(change)}`)
}

/**
 * Apply the effects `change` owes: clear the pairing-scoped state if — and only if — a pairing
 * actually ENDED, then navigate.
 *
 * Exactly one of the three arms clears, and which one is the whole point. Unpair ends a pairing: the
 * daemon is gone, so every one of the thirteen stores holds state attributed to a machine the
 * operator has left, and `clearPairingScopedState`'s docblock argues each of them at length. The
 * other two changes end NOTHING. Pairing another server ADDS one — since #1117 and #1084 the
 * background process holds one live connection per paired record, so the servers already paired stay
 * paired, stay connected, and keep every conversation, thread, queued item, background task,
 * outstanding prompt and read mark the operator left open on them. Cancelling out of the dialog does
 * not even reach a server.
 *
 * The wipe that used to run on the pair-another path had a stated rationale as well as a scope, and
 * both are gone. It argued that a conversation id is scoped to the server that issued it, so a
 * retained slice could be keyed under an id the new server reuses. It cannot: the daemon mints
 * conversation ids as UUIDv4 from the system random source (`internal/conversations/id.go` in the
 * pyrycode repo, at `7304b79b`), so a second server cannot collide with the first server's keys, and
 * the one store keyed by SERVER rather than by conversation (`conversationListStore`'s `byServer`)
 * gives the new pairing its own slot by construction.
 *
 * Two live controls survive the pair-another transition, and both are sound because BOTH ARE ROUTED
 * BY A CONTENT-ADDRESSED KEY main-side rather than to whichever server was paired last:
 *
 *   - AN OUTSTANDING PERMISSION PROMPT stays answerable. #1140 documents the failure this would be
 *     if the daemon had gone — answering emits a `modal_answer` for a `modalId` the currently paired
 *     daemon never issued — but `answerModal` routes by MODAL ID (`correlations.routeModal`, #1119)
 *     to the connection that raised it, which is still live. Clearing here would be the defect
 *     rather than the fix: it would drop a genuine prompt its daemon is still blocked on, with no
 *     affordance left to unblock it.
 *   - THE SESSION ID stays live, so the Run configuration controls stay operable. That clear is
 *     `clearPairingScopedState`'s security payload — inert controls beat addressing a YOLO or
 *     auto-approval write to a session that only existed on a daemon the user just left — and the
 *     payload is untouched, because the user has left nothing. The store holds the OPEN
 *     conversation's session, pairing another server does not change which conversation is open, and
 *     `setSessionSettings` routes by SESSION ID (`correlations.routeSession`, #1119) to the daemon
 *     that owns it.
 *
 * Clear-then-navigate on the one arm that does both, the ordering every clear helper here documents:
 * no observer may see the pairing screen rendered against the ended pairing's rows, conversation id
 * or session. Fully synchronous, so on the renderer's single thread nothing can interleave and React
 * batches the thirteen writes into the commit that carries the route change. The pinned order is
 * intra-arm only; the three arms are independent of each other.
 *
 * Fail-safe by inheritance, at zero cost: both unpair helpers call their route-flip dep only on
 * `result: 'ok'`, so a failed unpair reaches neither this helper nor the clear, and the screen the
 * operator was on stays up.
 *
 * Total — no gate, no return value, no throw path of its own. Nothing is logged, deliberately: this
 * extends `clearPairingScopedState`'s no-diagnostic property to its caller. The only value a
 * diagnostic here could carry safely is the static change label, ADR 0007's content-free rule
 * forbids the ids that would make it useful, and there is no observed failure to instrument — a
 * count or a label is the first crack in a property that currently holds absolutely.
 */
export function applyPairingChange(deps: PairingChangeDeps, change: PairingChange): void {
  switch (change) {
    case 'unpaired':
      deps.clearPairingScopedState()
      deps.navigateToPairingScreen()
      return
    // NO CLEAR, and the deletion is the ticket (#1141). Adding a server ends no pairing, so there is
    // nothing here to leave behind — everything the thirteen stores hold belongs to servers that are
    // still paired and still connected. The two arms below are identical in that respect and differ
    // only in destination; neither may grow a clear back without the test that forbids it going red.
    case 'pairedAnotherServer':
      deps.navigateToNewServerList()
      return
    case 'cancelledPairAnotherServer':
      deps.returnToSettings()
      return
    default:
      return assertNever(change)
  }
}
