// The "the conversation on screen is gone — leave it" decision (#652) — framework-free and React-free,
// co-located with PairedShell beside its other pure helpers activateConversation.ts,
// clearPairingScopedState.ts and pairedRoute.ts, and mirroring unpairAction.ts / composerSend.ts: the
// effects are injected so the helper is a pure, deterministic function tested with plain spies (no React,
// no store, no Electron). PairedShell's delete-confirmation callback is thin glue over this.
import type { ConversationCreatedPayload } from '@shared/wire/types'
import type { ThreadEvent } from './store/threadTimeline'

/**
 * The seven effects exitActiveConversation performs, injected to keep it pure:
 *  - `getActiveConversation`   — reads the CURRENTLY active conversation (activeConversationStore).
 *  - `dispatchTimeline`        — timelineStore's dispatch; carries #528's `reset` (a full wipe).
 *  - `clearTimelineFor`        — conversationTimelineStore's #757 single-key clear.
 *  - `clearActiveConversation` — activeConversationStore's #529 clear.
 *  - `clearSessionId`          — sessionIdStore's #529 clear.
 *  - `clearRunConfig`          — #1167's drop of this chat's run configuration, all four stores
 *                                since #1250.
 *  - `navigateToList`          — the container's return-to-the-Channel-List nav.
 *
 * `getActiveConversation` is a GETTER, not a value threaded in by the caller, for the reason
 * activateConversation.ts:16-23 documents: PairedShell's bridge callback is held in a ref that its hook
 * refreshes in a BARE (post-commit) effect, so a callback closing over a render-time value could compare
 * against a stale previous. Reading through the getter closes that gap by construction, and keeps
 * PairedShell from subscribing to the store at all.
 *
 * `navigateToList` is an injected effect rather than a returned boolean because AC4 and AC5 are both
 * statements about navigation NOT happening: putting the nav inside the gated body makes both directly
 * assertable on a spy, where a boolean would push "did it navigate?" into the container glue, which is
 * reviewed rather than tested (PairedShell.test.tsx:7-11).
 */
export interface ExitActiveConversationDeps {
  getActiveConversation: () => ConversationCreatedPayload | null
  dispatchTimeline: (event: ThreadEvent) => void
  clearTimelineFor: (conversationId: string) => void
  clearActiveConversation: () => void
  clearSessionId: () => void
  /**
   * #1167: drop the run configuration of the conversation being left — `runConfigStore`'s held snapshot
   * and `runSettingsWriteStore`'s pending changes, confirmed overrides and standing rejection — since
   * #1231 `systemPromptStore`'s held system-prompt reading, and since #1250
   * `systemPromptWriteStore`'s record of that chat's system-prompt write. ONE member for four stores,
   * the same act stated once, for the reason `ActivateConversationDeps`' counterpart documents at
   * length: the snapshot half self-heals in a round trip while the write half never heals at all, so
   * clearing either alone leaves the durable half standing. The third re-asserts only on the next
   * activation, since `system_prompt` is reply-only and nothing pushes a correction unsolicited; the
   * fourth never re-asserts at all, because it describes an act the operator performed rather than a
   * value the daemon holds.
   *
   * THE SIGNATURE DID NOT CHANGE for #1231 or #1250: this member is still `() => void`, and the three
   * production bodies each gained one further `getState()` arrow per ticket. The member names the ACT,
   * not the store list.
   *
   * CROSS-WIRE NOTE for a reviewer: this makes FOUR nullary `() => void` members on this interface, so
   * any two can be swapped and still compile, and a bare `toHaveBeenCalledTimes(1)` passes for both
   * halves of a swap. The defence is that all four land in different places, so `realDeps` in
   * `exitActiveConversation.test.ts` — which wires the real stores and a real nav spy — fails several
   * cases at once on any swap.
   */
  clearRunConfig: () => void
  navigateToList: () => void
}

/**
 * If `conversationId` names the conversation the thread is showing, drop its per-conversation state and
 * return to the Channel List. A mismatch — or no active conversation at all — is a total no-op.
 *
 * The gate is the id, read at invocation time. `?.` handles the null-active arm with no special case
 * (`undefined` never equals a real id), exactly as activateConversation.ts:74 does. What the gate means
 * is precisely "this id names the conversation on screen" — NOT "this reply answers a delete I issued":
 * daemonConnection.ts:923-932 emits the event unconditionally on decode with no correlation state
 * threaded (#375's deliberate decision, because the `id` is self-sufficient), so no client-side
 * in_reply_to check exists to lean on. The fail-direction is safe — every move below is a clear.
 *
 * AC4's mismatch case is reachable, not theoretical: delete can only be fired from the Channel Info
 * sheet, which is mounted inside the thread, so at request time the two ids always agree — but the
 * operator can go back and open a different discussion while the confirmation is in flight. Without the
 * comparison, a late confirmation would evict a thread that is alive and rendering.
 *
 * Clear, THEN navigate — the ordering both existing clear helpers document: no observer may see the
 * Channel List rendered against the deleted discussion's thread state. The five clears are independent
 * whole-value writes with no ordering constraint among themselves; only the nav is pinned last. All six
 * are synchronous, so on the renderer's single thread the check-then-act cannot interleave and React
 * batches them into one commit.
 *
 * Idempotent by construction: after a successful exit `activeConversation` is `null`, so a second
 * delivery of the same id fails the gate. No flag, no guard.
 *
 * Total — no return value, no throw path, and nothing to log: a diagnostic here would want the
 * conversation `id` to be useful, which ADR 0007's content-free rule forbids, and there is no observed
 * failure to instrument (the activateConversation.ts:60-61 posture).
 *
 * FIVE clears, not clearPairingScopedState's thirteen. That helper additionally resets the session store
 * and clears the announced running model, and neither belongs here: the pairing has NOT ended — the
 * daemon connection is alive and the operator lands on a working Channel List — so resetting the session
 * store would blank a live connection status into a false disconnected state, and the announced model is
 * held per conversation since #1146, so a departed conversation's record is inert rather than stale
 * (activateConversation clears neither on a conversation switch).
 * The keyed clear splits the same way, and that difference is the whole of #757: the pairing ending
 * invalidates EVERY conversation's thread, while a conversation being deleted invalidates that one and
 * leaves the operator's others live and his — so this helper drops one key where that one drops the map.
 * The set here is activateConversation's clear branch (timeline `reset` + `clearSessionId` +
 * `clearRunConfig`) PLUS `clearTimelineFor` and `clearActiveConversation`, the latter excluded there
 * only because it immediately re-sets the value; here there is no successor conversation, so the clear
 * is the point. That the two branches agree member for member is deliberate and worth keeping: both
 * answer the same question — "the conversation this state describes is no longer the one on screen" —
 * and a store added to one and not the other is how #1167's defect arose in the first place.
 *
 * Stores deliberately left OUT, so the next ticket need not re-litigate them:
 *  - `queueStore` — the backlog is selected by matching the active conversation id, and a null active id
 *    yields the stable empty backlog via the `''` sentinel (ConversationScreen.tsx:1294-1299). No stale
 *    queued row can render, so none can be dropped.
 *  - `sessionStore` — pairing-scoped, not conversation-scoped (see above).
 *  - `announcedModelStore` — keyed by conversation since #1146, and it still gains nothing here. A
 *    departed conversation's key is inert once nothing can select it, and the last-server clear still
 *    drops the whole map, so a per-conversation drop would be a second lifetime to keep in agreement
 *    with that one. Scoping a departed SERVER's keys is the migration `clearServerScopedState` parks
 *    alongside `queueStore`, the background-task roster and `modalPrompts` — out of scope, not out of
 *    reach.
 *  - `conversationLastReadStore` — pairing-scoped too (#779 clears it there): a conversation being
 *    deleted or archived leaves the operator's OTHER chats live and their marks meaningful, and the
 *    departing conversation's own mark is inert once nothing can read it.
 *  - `conversationListStore` — #376's re-list already re-authors it off the same event.
 *
 * One intended consequence, the same one activateConversation and clearPairingScopedState document:
 * clearing the session id makes RunConfigSections' `onChange` `undefined`, so the Run configuration
 * controls render INERT. That is the security payload, not a regression — inert beats addressing a YOLO /
 * auto-approval write to a session that belonged to a conversation the daemon has destroyed. #1167 adds
 * the read half: the controls no longer DISPLAY the destroyed conversation's model, effort, permission
 * mode and YOLO bit either, so they say nothing rather than something false about a chat that is gone.
 *
 * `clearPairingScopedState` is deliberately NOT joined by the run-config pair, and #1167 states why so
 * the next ticket need not re-litigate it: an unpair leaves both stores held, but no footer renders
 * until a chat is opened, and that open clears them by construction through activateConversation. A
 * member there would guard state nothing can read.
 *
 * Named for the decision, not the trigger: "if this id is the one on screen, leave it" is the seam #653
 * (the archive half) reuses verbatim with a different triggering event. Nothing archive-shaped is built
 * here.
 */
export function exitActiveConversation(
  deps: ExitActiveConversationDeps,
  conversationId: string
): void {
  if (deps.getActiveConversation()?.id !== conversationId) return

  deps.dispatchTimeline({ type: 'reset' })
  // Immediately after the flat reset, the dual-write idiom the two row-adding writers already use
  // (composerSend.ts:82 then :88, timelineBridge.ts:347 then :349): one fact expressed against two
  // stores. The argument, not `getActiveConversation()!.id` — past the gate the two are the same
  // string, so the getter is not called twice and the banned non-null assertion never arises.
  deps.clearTimelineFor(conversationId)
  deps.clearActiveConversation()
  deps.clearSessionId()
  // #1167 — beside `clearSessionId` because the two are the same move on the two halves of the Run
  // configuration surface: that one drops the ADDRESS its controls write to, this one drops the VALUES
  // they display. Position among the clears is free; only the nav below is pinned last.
  deps.clearRunConfig()
  deps.navigateToList()
}
