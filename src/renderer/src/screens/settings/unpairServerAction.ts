// The per-server unpair interaction's decision logic (#1162) — framework-free and React-free,
// co-located with the Settings screen and mirroring `unpairAction.ts` / `composerSend.ts`: the
// effects are injected, with a renderer-local history lifecycle notification around the invoke.
// It is tested with plain spies (no React or Electron). The per-row confirm phase stays in
// `ServerRowControl`'s local state, but the erase→refresh→maybe-route branching lives here where a
// server-render test can't drive an async click.
//
// A SIBLING of `runUnpair`, deliberately not a widened version of it. `runUnpair`'s error arm
// dispatches UNPAIR_FAILED_ERROR into the ONE app-wide sessionStore. That was harmless from the
// conversation screen, where a failed unpair meant the only pairing was in doubt; from a Settings row
// it is not, because one server's failed erase would put the whole app into a `failed` session status
// while the OTHER server is connected and its conversation is fine. The constraint is met by the
// TYPE, not by a rule: `UnpairServerDeps` has no `dispatch` member at all, so there is no name in
// this module by which a session-store write could be reached, and a future edit cannot reintroduce
// the degradation without first widening a reviewed interface. Keeping the two apart also leaves
// `runUnpair`'s `unpair` dep nullary, so `ConversationScreen` — its one existing caller — is
// untouched and #1163 can migrate and delete the whole-collection path without unpicking a shared
// dep shape first.
import type { UnpairResult } from '@shared/ipc/unpair'
import type { ServerInfoValue } from '../../store/serverInfoStore'
import { beginChatHistoryRemoval } from '../../store/chatHistoryRemoval'

/**
 * The injected UI effects, in addition to the renderer-local history removal lifecycle:
 *  - `unpairServer`         — window.pyry.unpairServer in the container: erases exactly the named
 *                             record in main, through the per-server channel #1149 shipped.
 *  - `refreshServers`       — re-read the paired collection and write the server-info store,
 *                             resolving to the list it wrote. `loadServerInfo` in the container.
 *  - `onLastServerUnpaired` — the App route flip → `pairing`, reached through the shell's existing
 *                             `applyPairingChange(deps, 'unpaired')`, which clears the thirteen
 *                             pairing-scoped stores before it navigates.
 *  - `clearServerScopedState` — #1196's drop of the state ONE departed server authored: its conversation
 *                             rows, every one of its conversations' retained threads, and the open chat
 *                             when it was one of them. The `else` to the flip above, never a companion
 *                             to it.
 *
 * There is deliberately NO `dispatch` — see the header. Adding one is a design change, not a
 * convenience.
 *
 * `clearServerScopedState` is the member that makes both unpair paths correct from ONE implementation
 * (#1196, AC4). `UnpairDeps extends UnpairServerDeps`, so the composer's Re-pair inherits it rather than
 * re-declaring it, and the alternative — clearing inside `ServerRowControl` — would satisfy every other
 * criterion while leaving the Re-pair path broken. It TAKES THE ID rather than being nullary like
 * `PairingChangeDeps.clearPairingScopedState`, and that is the stronger property here: the server whose
 * state is dropped is by construction the server this helper just erased, rather than whatever the call
 * site happened to close over.
 */
export interface UnpairServerDeps {
  unpairServer: (serverId: string) => Promise<UnpairResult>
  refreshServers: () => Promise<ServerInfoValue[]>
  onLastServerUnpaired: () => void
  clearServerScopedState: (serverId: string) => void
}

/**
 * Forget ONE paired server and report the outcome so the row can reset its confirm phase.
 *
 * Fail-safe by construction, inherited verbatim from `runUnpair`: everything downstream of the erase
 * runs ONLY on `result: 'ok'`. A `result: 'error'` — which #1149 makes indistinguishable across a
 * guard refusal, an id naming no held record, and a `clearServer` throw — or a rejected invoke
 * (handler absent) is coerced to the error path: no refresh, no route flip, no clear. So the list can
 * never claim a server was forgotten while its record may still sit on disk.
 *
 * On success the refreshed list is BOTH halves of the remaining work:
 *
 *  - It is the list refresh AC3 needs. `ServerInfoData` is a one-shot mount fetch and
 *    `serverInfoStore` is deliberately not one of the thirteen stores `clearPairingScopedState`
 *    wipes, so without this re-read the departed row would sit there until Settings was re-entered.
 *    Nothing mutates the held list locally — main is re-asked, so the rows are what main says.
 *  - It is the answer to "do any records remain?", which is what makes the route flip CONDITIONAL.
 *    #1149 refused to widen `UnpairResult` on purpose (a third member would answer "is this id
 *    paired?" for a compromised renderer) and `clearServer`'s `remaining` is deliberately not
 *    returned, so the answer has to come from a read the renderer already has. Using the SAME read
 *    for both means the rendered rows and the route decision can never disagree about how many
 *    servers are left.
 *
 * The one collapse this inherits, stated rather than hidden: `ServerInfo`'s `unavailable` arm covers
 * *nothing paired* AND *the collection could not be read*, and `loadServerInfo` additionally maps a
 * rejected invoke to `[]`. So an empty list here means "no READABLE record remains". That is the
 * right outcome for an unreadable collection — `decodeCollection` treats a malformed collection as
 * absent, so `pairingStatus` already answers *not paired*. For the rejected-invoke case it is a
 * mis-route, but only on a path where the main bridge has vanished after answering an unpair a moment
 * earlier, and it self-corrects on relaunch because `pairingStatus` reads the disk. Distinguishing
 * them would add an impossible-state distinction no other consumer reads — the same test
 * `serverInfoStore` applied when it declined `ServerInfoValue[] | null`.
 *
 * Nothing here is logged. That extends `unpairHandler`'s log-free-by-construction property to its
 * first caller: no `serverId`, no relay URL and no caught object reaches a log line. ADR 0007's
 * content-free rule forbids the ids that would make a diagnostic useful, and there is no observed
 * failure to instrument.
 */
export async function runUnpairServer(
  deps: UnpairServerDeps,
  serverId: string
): Promise<'ok' | 'error'> {
  const settleHistory = beginChatHistoryRemoval(serverId)
  let result: UnpairResult
  try {
    result = await deps.unpairServer(serverId)
  } catch {
    settleHistory(false)
    // A rejected invoke never reaches the window: coerce to the same error outcome as result:error.
    return 'error'
  }

  settleHistory(result.result === 'ok')
  if (result.result !== 'ok') return 'error'

  const remaining = await deps.refreshServers()
  // #1196: an `else`, and both halves of that are load-bearing. Before it, this one line was the ONLY
  // route from either unpair path into renderer state, so forgetting one of several servers cleared
  // nothing at all — the departed machine's conversation rows, its retained threads and its open chat
  // all stayed, and since #1070 its rows render under no host row at all because the sidebar draws its
  // subtrees from the store this function already refreshed. `else` rather than a second statement keeps
  // the last-server path byte-identical: it runs the whole-app clear alone, exactly as it always has,
  // and the two clears can never both fire.
  if (remaining.length === 0) deps.onLastServerUnpaired()
  else deps.clearServerScopedState(serverId)
  return 'ok'
}
