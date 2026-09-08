// The "this ONE pairing has ended" clear (#1196) — framework-free and React-free, co-located with
// PairedShell's other pure helpers `clearPairingScopedState.ts`, `exitActiveConversation.ts` and
// `activateConversation.ts`, and mirroring them exactly: the effects are injected so the helper is a
// pure, deterministic function tested with plain spies (no React, no store, no Electron).
//
// THE SIBLING OF `clearPairingScopedState`, ONE NOTCH IN. That helper answers "the pairing ended" and
// drops thirteen stores whole; this one answers "ONE of several paired machines is gone" and drops only
// what that machine authored, because everything else on screen still belongs to a daemon the operator
// is still connected to. Both are owed, on different paths, and `runUnpairServer` picks between them by
// the only fact that separates them: whether any record remains.
//
// Until this landed, the per-server path reached NEITHER. `runUnpairServer` ran the whole-app clear when
// the erase emptied the collection and nothing at all otherwise, so forgetting one of two servers left
// every slice the departed daemon authored on screen — since #1070 its conversation rows render under no
// host row at all, in the `unattributed` run, because the sidebar draws its subtrees from
// `serverInfoStore` (which the unpair refreshes) while the rows come from the app-wide UNION across
// `conversationListStore`'s slots (which nothing dropped).
//
// WHAT MAKES DROPPING ONLY THIS MACHINE'S STATE SAFE is stated in `clearPairingScopedState`'s docblock
// and is worth repeating here because this helper is the one that depends on it: the daemon mints
// conversation ids as UUIDv4 from the system random source, so a later server cannot reuse an earlier
// one's ids and no surviving slice can be read under a stranger's key. The one place that property is
// NOT trusted is the departed id set itself — see `getDepartedConversationIds` below.
import type { ConversationListOrigin } from './store/conversationListStore'
import {
  conversationListStore,
  selectExclusiveConversationIdsFor
} from './store/conversationListStore'
import { activeConversationStore } from './store/activeConversationStore'
import { conversationLastReadStore } from './store/conversationLastReadStore'
import { conversationTimelineStore } from './store/conversationTimelineStore'
import { runConfigStore } from './store/runConfigStore'
import { runSettingsWriteStore } from './store/runSettingsWriteStore'
import { sessionIdStore } from './store/sessionIdStore'
import { systemPromptStore } from './store/systemPromptStore'
import { systemPromptWriteStore } from './store/systemPromptWriteStore'
import { timelineStore } from './store/timelineStore'
import { exitActiveConversation, type ExitActiveConversationDeps } from './exitActiveConversation'

/**
 * `exitActiveConversation`'s seven effects — inherited rather than restated, because AC3's decision IS
 * that helper's decision — plus the three this clear adds:
 *
 *  - `getDepartedConversationIds` — which conversations the departing machine owns, and ONLY those.
 *  - `clearConversationsFor`      — `conversationListStore`'s #1196 keyed drop of that server's rows.
 *  - `clearLastReadFor`           — `conversationLastReadStore`'s #1197 keyed drop of those
 *                                   conversations' read marks. The ONLY member of this set that reaches
 *                                   outside memory, which is what pins where it is called from.
 *
 * IT EXTENDS `ExitActiveConversationDeps` rather than duplicating its members, which is what makes
 * "AC3 is exitActiveConversation, applied to a set" a fact about the TYPE rather than a claim in a
 * comment: a member added there arrives here, and the two clear sets cannot drift.
 *
 * `getDepartedConversationIds` is deliberately NOT named after `selectConversationIdsFor`, the shared
 * "which conversations belong to this server" answer the three reconnect-reset bridges ride. The
 * production wiring below binds it to the STRICTER `selectExclusiveConversationIdsFor`, and the
 * difference is a security property, not a detail: these ids are the DEPARTING DAEMON's own, listed in
 * its `conversationsReceived` reply, so a confused or hostile paired daemon can name another machine's
 * conversations and — fed to a thread clear unfiltered — turn "forget machine A" into "destroy machine
 * B's retained threads and close the chat the operator is reading on B", with no backfill in either
 * timeline store to bring them back. The name says "departed", the wiring says how that is decided, and
 * the parameter name is what a future caller must satisfy.
 */
export interface ClearServerScopedStateDeps extends ExitActiveConversationDeps {
  getDepartedConversationIds: (serverId: string) => ReadonlySet<string>
  clearConversationsFor: (serverId: string) => void
  /**
   * #1197: drop the last-read marks of the departed conversations, and only those. It rides the set
   * `getDepartedConversationIds` already computed rather than taking a read of its own, so the
   * exclusivity property argued for above covers this destruction too — marks have no backfill any more
   * than threads do, so the same answer is owed. `ReadonlySet<string>` rather than an iterable, because
   * a bare `string` satisfies `Iterable<string>` and a caller handing over one id would clear one mark
   * per character with no type error.
   */
  clearLastReadFor: (conversationIds: ReadonlySet<string>) => void
}

/**
 * Drop every piece of renderer state authored by ONE departed server — its conversation rows, every one
 * of its conversations' retained threads, and, when the chat on screen is one of them, that chat itself
 * along with the daemon session id and the run configuration behind it.
 *
 * Called from ONE place — `runUnpairServer`'s `else` arm, so both unpair paths (the Settings row's
 * per-server Unpair and the composer's Re-pair) get it from the same implementation, and the last-server
 * path never reaches it because that arm runs the whole-app clear instead.
 *
 * THE ONE ORDERING CONSTRAINT, and it is the only way this can silently half-work: the ids are read
 * BEFORE the list slot is dropped. They are reachable only through that slot, and the exclusivity filter
 * behind them additionally needs every OTHER slot still in place to know what another machine claims.
 * Read afterwards, the set is empty, every thread and the open chat survive — and AC1 still passes on
 * its own, so no row-count assertion would catch it. The test pins this on call ORDER rather than
 * trusting this paragraph.
 *
 * THE TWO CLEARS IN THE LOOP ARE DIFFERENT ACTS, and that is AC2 versus AC3. `clearTimelineFor` runs for
 * EVERY departed conversation, because a retained thread is held per conversation whether or not the
 * operator is looking at it, and leaving the background ones held is exactly the residue this ticket
 * exists to remove. `exitActiveConversation` runs for every departed conversation too but DOES something
 * for at most one of them: its gate is the id, matched against the conversation on screen. Delegating
 * that gate rather than re-deriving it keeps exactly one place in the app that decides "this id names
 * the chat the operator is reading", and buys the whole of its clear set — the flat timeline reset, the
 * active conversation, the session id and the run configuration — including the security payload that
 * docblock argues for: a cleared session id makes the Run configuration controls INERT rather than
 * addressing a YOLO / auto-approval write to a session on a machine the operator has just left. The one
 * matching conversation therefore has its timeline cleared twice, once here and once inside the exit;
 * both calls are idempotent, and paying that is cheaper than a second copy of the gate.
 *
 * THE SECOND ORDERING CONSTRAINT, added at #1197, and it is LOOP-shaped where `clearPairingScopedState`'s
 * is flat: `clearLastReadFor` MUST run AFTER the loop has finished, and it is placed last. Two
 * independent reasons, either sufficient:
 *
 *   - THE RE-MINT. Every `clearTimelineFor` in the loop notifies `conversationTimelineStore`'s
 *     subscribers SYNCHRONOUSLY, and among them is #777's bridge, which re-stamps whatever conversation
 *     is open and, finding the slice gone, records a mark of `0` for it — persisting a departed server's
 *     conversation id to disk, where it survives a restart, while every in-memory assertion stays green.
 *     Because that fires on EVERY iteration, a drop placed INSIDE the loop is re-minted by a later one.
 *     After the loop nothing re-fires it: `exitActiveConversation`'s own `clearTimelineFor` runs on a
 *     slice the loop body emptied a line earlier and so returns state by reference, waking no listener,
 *     and this call is the last statement of `runUnpairServer`'s per-server arm. (A still-paired
 *     server's open chat IS legitimately re-stamped during the loop, with its own honest count — its
 *     slice is untouched — and the drop names only departed ids, so it cannot be reached.)
 *   - THE THROW. Every other effect here is an in-memory store write that cannot throw.
 *     `clearLastReadFor` reaches `localStorage`, so it is the only one that can, and mid-body a throw
 *     from it would abort every clear after it — including `clearSessionId`, whose clear is the security
 *     payload described above. Last, a throw aborts nothing. That costs no code and adds no try/catch
 *     for an unobserved failure; it is a free ordering property, and the test pins it by call order
 *     rather than trusting this paragraph.
 *
 * That the marks are the ONLY member of the departed set reaching outside memory is why #1196 held them
 * back for a sibling ticket rather than shipping them with the rest: they are the only one carrying an
 * ordering constraint and a throw path of their own.
 *
 * The marks drop is UNCONDITIONAL — there is deliberately no `departed.size` gate in front of it. The
 * guard belongs in the store, the only place that can answer the question that actually matters ("did
 * any HELD mark leave?"); a gate here would be a second, weaker copy of it, blind to a non-empty id set
 * that names nothing held.
 *
 * Total — no gate of its own, no return value, no throw path of this function's own. Fully synchronous,
 * so on the renderer's single thread no observer can see a half-cleared set and React batches the writes
 * into one commit. A server holding no rows resolves to the shared empty set, loops zero times, and
 * short-circuits both the row drop and the marks drop inside their own stores.
 *
 * Nothing is logged, and that is the same posture `unpairHandler`, `runUnpairServer`,
 * `exitActiveConversation` and `clearPairingScopedState` all hold: a diagnostic here would want the
 * `serverId` or the conversation ids to be useful, which ADR 0007's content-free rule forbids, and there
 * is no observed failure to instrument. Not even a count of what was dropped.
 *
 * WHAT IT DELIBERATELY DOES NOT REACH, so the next ticket need not re-litigate it. `queueStore`'s
 * backlogs, `backgroundTaskRosterStore`'s rosters and `modalPrompts`' outstanding prompts all take a
 * conversation-id set today, so a departed server's are scopeable with the very set computed above —
 * they are out of SCOPE here (#1090's Ask names this ticket's four slices), not out of reach, and the
 * roster is the sharpest of the three, since a held `local_bash` task's `description` is the literal
 * command line claude ran. `conversationLastReadStore` USED TO BE ON THIS LIST as the deliberately
 * separate sibling ticket; #1197 landed it, and it is now the last effect in the body.
 * `sessionIdStore` is an app-wide single slot with no server key at all. `slashCommandListStore`,
 * `modelListStore` and — since #1146 — `announcedModelStore` are keyed by CONVERSATION rather than by
 * server, so their keys are scopeable with the same departed-conversation set computed above and are out
 * of SCOPE here rather than out of reach, exactly like the three named in the paragraph above. #1145 and
 * #1146 closed the two open misattribution bugs by keying, which is a different thing from making a
 * clear server-scopeable and does not oblige this helper to grow a member. Do NOT key a store here to
 * make its clear scopeable.
 */
export function clearServerScopedState(
  deps: ClearServerScopedStateDeps,
  serverId: string
): void {
  // BEFORE the drop below — see the ordering constraint in the docblock. This is the whole of what makes
  // the fix work rather than silently no-op.
  const departed = deps.getDepartedConversationIds(serverId)
  deps.clearConversationsFor(serverId)

  for (const conversationId of departed) {
    // AC2 — every departed conversation's thread, whether or not it is the one on screen.
    deps.clearTimelineFor(conversationId)
    // AC3 — the id gate inside means at most one iteration does anything.
    exitActiveConversation(deps, conversationId)
  }

  // AFTER the loop, never inside it, and last of all — see the second ordering constraint in the
  // docblock. Both halves are load-bearing: inside, a later iteration's thread clear re-mints the
  // departed open chat's `0` through #777's bridge; anywhere but last, a `localStorage` throw from the
  // one effect that reaches outside memory aborts a clear that would otherwise have run.
  deps.clearLastReadFor(departed)
}

/**
 * The store wiring, module scope — and it lives HERE, beside the pure function, rather than at the two
 * call sites. That is the `conversationLastReadDeps` shape rather than PairedShell's, and the reason is
 * that this helper has TWO containers and neither owns the other: `ServerRowControl` in the Settings
 * screen and `ComposerErrorSlotControl` in the conversation screen both reach `runUnpairServer`, and a
 * deps literal at each would be two independent enumerations of one clear set. A drift between them is
 * precisely the half-fix this ticket's AC4 exists to catch, so there is one copy and both sites spread
 * it. Neither container can reach PairedShell's own `exitConversationDeps` — it is module-private there,
 * and there is no store path from a Settings row up to the shell (PairedShell.tsx says so in as many
 * words about `onLastServerUnpaired`).
 *
 * Every member reaches its singleton through `getState()` INSIDE the arrow body — the bridge idiom the
 * three dep objects in PairedShell all use — so nothing is dereferenced at module load, nothing is read
 * during render, and the object closes over no per-render value. Both containers stay server-renderable.
 *
 * `navigateToList` is the one effect that CANNOT live here: it needs the container's own nav, and the
 * two containers legitimately differ (see each call site). The `Omit` makes the missing field explicit
 * rather than leaving a partial object silently typed as complete — `exitConversationDeps`'s posture.
 *
 * `getDepartedConversationIds` binds to `selectExclusiveConversationIdsFor`, NOT to the shared
 * `selectConversationIdsFor` three reconnect bridges ride. That is the security decision, and it is made
 * here because this is the only place that knows the consequence of an over-broad answer is destruction
 * with no backfill rather than a reset that self-heals. The origin passed is a CLIENT-HELD id — the one
 * `runUnpairServer` just erased, read from this client's own paired collection — which is what both
 * selectors' docblocks require of every caller.
 */
export const serverScopedClearDeps: Omit<ClearServerScopedStateDeps, 'navigateToList'> = {
  getDepartedConversationIds: (serverId: ConversationListOrigin) =>
    selectExclusiveConversationIdsFor(serverId)(conversationListStore.getState()),
  clearConversationsFor: (serverId) =>
    conversationListStore.getState().clearConversationsFor(serverId),
  // #1197. The store's OTHER clear stays nullary and untouched: the last-server unpair still routes to
  // `clearPairingScopedState`, so `tsc` goes on enforcing that no daemon-asserted id can steer which
  // marks survive the whole-app boundary. This is a second write path, not a widened first one.
  clearLastReadFor: (conversationIds) =>
    conversationLastReadStore.getState().clearLastReadFor(conversationIds),
  getActiveConversation: () => activeConversationStore.getState().activeConversation,
  dispatchTimeline: (event) => timelineStore.getState().dispatch(event),
  clearTimelineFor: (id) => conversationTimelineStore.getState().clearTimelineFor(id),
  clearActiveConversation: () => activeConversationStore.getState().clearActiveConversation(),
  clearSessionId: () => sessionIdStore.getState().clearSessionId(),
  // The same one act as in PairedShell's `activateDeps` and `exitConversationDeps`, and the three bodies
  // are deliberately identical: a server departing ends the conversation this state describes exactly as
  // a delete, an archive or a switch does. Four `getState()` arrows in one body rather than four
  // members — the snapshot half self-heals in a round trip while the write half never heals at all, so
  // clearing either alone leaves the durable half standing.
  //
  // #1231's system-prompt reading is the third arrow and this is AC3's third seam. It sits between the
  // two on self-healing and below both on tolerable staleness: it re-asserts only on the next
  // activation (nothing pushes this frame unsolicited), and what it would otherwise leave standing is
  // the departed server's chat's operator-authored prompt text, which #1078 will offer for edit rather
  // than merely display. Adding it to all three bodies in one edit is the discipline #1167 named — a
  // store added to one body and not the others is how that ticket's own defect arose.
  //
  // #1250's system-prompt WRITE outcome is the fourth, and it is the least self-healing of the set:
  // nothing asks for it and nothing pushes it, because it records an act the operator performed rather
  // than a value the daemon holds. Left standing past a server's departure it would report a save
  // against a chat this client can no longer reach.
  clearRunConfig: () => {
    runConfigStore.getState().clearSnapshot()
    runSettingsWriteStore.getState().dispatch({ type: 'conversationSwitched' })
    systemPromptStore.getState().clearReading()
    systemPromptWriteStore.getState().dispatch({ type: 'conversationSwitched' })
  }
}
