// The Re-pair interaction's decision logic — framework-free and React-free, co-located with the
// screen and mirroring composerSend.ts: the effects are injected so the helper is a pure,
// deterministic function tested with plain spies (no React, no store, no Electron). The container's
// ComposerErrorSlotControl is thin glue over this — the click wiring is untested screen-local glue,
// but the ok/error branching lives here where a server-render test can't drive an async click.
//
// #1163 MIGRATED IT ONTO THE PER-SERVER CHANNEL AND DELETED THE WHOLE-COLLECTION ONE. Until then this
// helper called a nullary `unpair()` that erased EVERY paired record, which was correct while there
// was only ever one; since #1069 the store holds several and since #1117 a live connection sits behind
// each, so recovering server A's dead connection also forgot server B and dropped its connection. The
// Re-pair control now names the server whose conversation is open and forgets only that one.
//
// It DELEGATES the erase→refresh→maybe-flip sequence to `runUnpairServer` rather than restating it.
// That sequence is where AC2 lives — the route flip is conditional on the REFRESHED collection coming
// back empty, because that helper's caller is the only one that can know the count (#1149 refused to
// widen `UnpairResult` with a "how many are left" field, deliberately: a third member would answer "is
// this id paired?" for a compromised renderer). Two copies of that rule could drift, and a drift on
// this path is exactly the failure the ticket exists to prevent, so there is one copy and this module
// composes with it.
//
// What it adds on top is ONE thing: the session-store dispatch on the error path. That is the whole
// reason the two helpers are separate rather than one widened function — `UnpairServerDeps` has no
// `dispatch` member at all, so a Settings row's failed erase structurally cannot put the app into a
// `failed` session status while another server is connected and its conversation is fine. Passing a
// structurally wider dep bag INTO that helper does not weaken that: TypeScript gives a callee only
// what its parameter type declares, so `runUnpairServer`'s body still has no name for a session write.
import type { SessionAction } from '../../store/sessionStore'
import type { ServerConversationSummary } from '../../store/conversationListStore'
import { runUnpairServer, type UnpairServerDeps } from '../settings/unpairServerAction'

/**
 * `runUnpairServer`'s three injected effects plus the one this path adds:
 *  - `unpairServer`         — window.pyry.unpairServer in the container: erases exactly the named
 *                             record in main, through the per-server channel #1149 shipped.
 *  - `refreshServers`       — re-read the paired collection and write the server-info store, resolving
 *                             to the list it wrote; it is both the list refresh and the answer to "do
 *                             any records remain?".
 *  - `onLastServerUnpaired` — the App route flip → 'pairing', reached through the shell's existing
 *                             `applyPairingChange(deps, 'unpaired')`, which clears the thirteen
 *                             pairing-scoped stores before it navigates. Named for its CONDITION: it
 *                             fires only when the erase left nothing paired.
 *  - `dispatch`             — the session store dispatch: {failed} on error. Error-path only since
 *                             #531, and the one member `UnpairServerDeps` deliberately lacks.
 */
export interface UnpairDeps extends UnpairServerDeps {
  dispatch: (action: SessionAction) => void
}

/**
 * #167's AC5 synthesized failure, reusing the existing ConnectionError shape so the composer's error
 * affordance surfaces it verbatim. `composerAvailability` maps ANY `error` status to a disabled send and
 * nothing else — it does not read `.message`, and since #968 it returns no string at all — so `message`
 * populates the store shape for a future banner only. `code: 'unpair'` distinguishes the source in
 * diagnostics, and `shouldOfferRepair` excludes it, so a failed Re-pair degrades to the plain chip
 * rather than an endlessly re-armable button.
 */
const UNPAIR_FAILED_ERROR = {
  code: 'unpair',
  message: 'Could not forget this pairing.',
  retryable: false
} as const

/**
 * WHICH SERVER THE OPEN CONVERSATION BELONGS TO — a pure lookup over `conversationListStore`'s flat,
 * stamped rows (#1163). `null` whenever the open conversation cannot be attributed to exactly one
 * server, which `runUnpair` turns into "erase nothing and report failure".
 *
 * NOT DERIVED FROM `sessionStore`'s flat `status`, which is what this control reads for its own
 * rendering: that cell is documented as the most recently written status ACROSS EVERY CONNECTION,
 * last-writer-wins by design, so on a two-server setup it can be describing the other machine. The
 * row stamp is the right source because it is bound MAIN-SIDE by `bindServerOrigin` from the
 * connection the event arrived on — it is this client's own attribution, never a wire field a daemon
 * could set.
 *
 * IT REFUSES AN AMBIGUOUS MATCH — `filter` and a length check, never `find`. The conversation id being
 * matched on IS the daemon's, and the store holds every server's rows in one list (`ChannelList`
 * already keys rows by `c.id` alone), so two servers reporting the same conversation id is a
 * condition the app does not otherwise prevent. A `find` would resolve it to whichever row was stamped
 * first, letting a confused or hostile daemon steer a Re-pair pressed on one machine into forgetting
 * another. The comparison costs nothing and turns a wrong-server erase into a no-op.
 *
 * `ConversationListOrigin` is `string | null | undefined`, so the stamp is narrowed to a string here
 * rather than assumed: an unstamped row names no machine.
 *
 * It lives beside its caller rather than in the store — one consumer is an import, two is a home
 * (`conversationLastReadBridge`'s rule) — which also keeps every decision this interaction makes
 * inside one pure module a unit test can drive end to end.
 */
export function serverIdForOpenConversation(
  rows: readonly ServerConversationSummary[] | null,
  openConversationId: string | null
): string | null {
  if (rows === null || openConversationId === null) return null
  const matches = rows.filter((r) => r.id === openConversationId)
  if (matches.length !== 1) return null
  const serverId = matches[0].serverId
  return typeof serverId === 'string' ? serverId : null
}

/**
 * Forget the server whose conversation is open and report the outcome.
 *
 * Fail-safe by construction on every arm. A `serverId` of `null` — the caller could not attribute the
 * open conversation to exactly one server — returns the error outcome WITHOUT invoking anything, so
 * "nothing was erased" is a fact about this function rather than about the handler's `matched` check
 * one round trip away. Everything else is inherited verbatim from `runUnpairServer`: a `result:
 * 'error'` (which #1149 makes indistinguishable across a guard refusal, an id naming no held record,
 * and a `clearServer` throw) or a rejected invoke means no refresh, no route flip, no clear, and the
 * operator stays on the conversation screen.
 *
 * The dispatch is deliberately error-path only. #531 moved the success-path clear out of here: the
 * `ok` branch's contract is exactly "flip the route via `onLastServerUnpaired` IF nothing is left
 * paired", whose PairedShell wrapper runs the shared `clearPairingScopedState` before App re-routes.
 * Keeping a duplicate reset here would give the session store two owners on one path, and the one that
 * is not in the shared helper is invisible to the test that enumerates the set.
 *
 * Nothing here is logged — no `serverId`, no caught object. That extends `unpairHandler`'s
 * log-free-by-construction property across the bridge, and ADR 0007's content-free rule forbids the
 * ids that would make a diagnostic useful anyway.
 */
export async function runUnpair(deps: UnpairDeps, serverId: string | null): Promise<'ok' | 'error'> {
  if (serverId === null) {
    deps.dispatch({ type: 'failed', error: UNPAIR_FAILED_ERROR })
    return 'error'
  }

  const outcome = await runUnpairServer(deps, serverId)
  if (outcome === 'error') deps.dispatch({ type: 'failed', error: UNPAIR_FAILED_ERROR })
  return outcome
}
