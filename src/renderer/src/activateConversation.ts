// The "make this conversation the active one" decision — framework-free and React-free, co-located
// with PairedShell beside its other pure helper pairedRoute.ts, and mirroring unpairAction.ts /
// composerSend.ts: the effects are injected so the helper is a pure, deterministic function tested
// with plain spies (no React, no store, no Electron). PairedShell's two carrying nav sites are thin
// glue over this.
import type { ConversationCreatedPayload } from '@shared/wire/types'
import type { ThreadEvent } from './store/threadTimeline'

/**
 * The eight effects activateConversation performs, injected to keep it pure:
 *  - `getActiveConversation`     — reads the CURRENTLY active conversation (activeConversationStore).
 *  - `setActiveConversation`     — records the newly activated one (the same store's setter).
 *  - `dispatchTimeline`          — timelineStore's dispatch; carries #528's `reset`.
 *  - `clearSessionId`            — sessionIdStore's #529 clear.
 *  - `clearRunConfig`            — #1167's drop of the previous chat's run configuration, all three
 *                                  stores since #1231.
 *  - `stampLastRead`             — #777's last-read stamp for the conversation being opened.
 *  - `markViewed`                — #786's view stamp, conversationTimelineStore's eviction ranking.
 *  - `requestConversationConfig` — #1166's ask for the opened conversation's run configuration and
 *                                  model list.
 *
 * `getActiveConversation` is a GETTER, not a value threaded in by the caller. The previous
 * conversation must be read at invocation time: PairedShell's created-event callback is held in a
 * ref that `useConversationCreatedNav` refreshes in a bare effect (conversationCreatedBridge.ts:84-87),
 * i.e. after commit — so a callback closing over a render-time value would let two `conversationCreated`
 * events landing before that effect runs both compare against the same stale previous, and the second
 * would skip a clear it owed. Reading through the getter closes that gap by construction, and keeps
 * PairedShell from subscribing to the store at all (a subscription would re-render the whole paired
 * subtree on every switch).
 *
 * `clearActiveConversation` (#529) is deliberately NOT among these: it belongs to #531's pairing-ended
 * clear — since #1141 the unpair path alone, pairing another server having stopped clearing anything —
 * and calling it here would wipe the value this path is in the middle of setting.
 */
export interface ActivateConversationDeps {
  getActiveConversation: () => ConversationCreatedPayload | null
  setActiveConversation: (conversation: ConversationCreatedPayload) => void
  dispatchTimeline: (event: ThreadEvent) => void
  clearSessionId: () => void
  /**
   * #1167: drop the run configuration of the conversation being LEFT — `runConfigStore`'s held
   * snapshot and `runSettingsWriteStore`'s pending changes, confirmed overrides and standing
   * rejection — and since #1231 `systemPromptStore`'s held system-prompt reading. All three stores are
   * app-wide singletons keyed by nothing, and every value in them describes one chat's session, so
   * without this the footer of the chat being opened reads the previous one's configuration.
   *
   * ONE member for three stores, not three members — `requestConversationConfig`'s precedent below,
   * verbatim. They are one act ("this chat's run configuration is no longer the one to show"), they
   * always fire together, and none is enough on its own: the snapshot half self-heals in one round
   * trip (#1166 asks, #1176 refuses a reply naming another chat) while the write half never heals at
   * all, because a `set_session_settings` ack carries only a session id and never rewrites a snapshot.
   * Clearing only the store whose staleness is visible first would leave the durable half standing.
   *
   * #1231's third store sits between those two on self-healing and is the worst of the three to leave
   * standing. It re-asserts only on the next activation — `system_prompt` is reply-only, so nothing
   * pushes a correction unsolicited — and what would otherwise stand is the previous chat's
   * operator-authored prompt text, which the editor surface (#1078) offers for EDIT rather than merely
   * displaying. THE SIGNATURE DOES NOT CHANGE: this member stayed `() => void` and gained a third
   * `getState()` arrow in each of its three production bodies, rather than being renamed for the store
   * list it happens to cover.
   *
   * REQUIRED, not optional, for `stampLastRead`'s reason: `activateDeps` is module-private,
   * `vitest.config.ts` is `environment: 'node'` globally, so no test in this repo runs a React effect
   * and the wiring itself is structurally uncoverable. `tsc` is the whole safety net and it only holds
   * if the field is required.
   *
   * CROSS-WIRE NOTE for a reviewer: this and `clearSessionId` are both `() => void`, so a swap of the
   * two compiles AND every `toHaveBeenCalledTimes(1)` assertion passes for both. The defence is the one
   * the three-identical-`(id) => void` members below already rely on: they land in DIFFERENT stores, so
   * with the real stores wired a swap leaves the session id standing and the run configuration held,
   * failing #529's cases and #1167's together (`activateConversation.test.ts`'s `realDeps`).
   */
  clearRunConfig: () => void
  /**
   * #777: record how far the operator has read in the conversation being opened — its own held timeline
   * item count, sampled at this moment (conversationLastReadBridge.ts's `stampLastReadFor`). REQUIRED,
   * not optional: forgetting to wire it is the exact regression it exists to prevent, so it is a compile
   * error at every deps site rather than a silent `undefined`.
   *
   * It takes the id EXPLICITLY rather than reading the open conversation back out of a store, which is
   * what makes it independent of where in the function below it sits and of whether
   * `setActiveConversation` has already run.
   *
   * CROSS-WIRE NOTE for a reviewer: `clearSessionId: () => void` is assignable to this slot, because
   * TypeScript permits a function of fewer parameters. The assertion that catches a swap of the two is
   * "`stampLastRead` was called WITH the conversation's `id`", never a bare `toHaveBeenCalled()`. The
   * other three members are cross-wire-immune under `strictFunctionTypes` — neither
   * `ConversationCreatedPayload` nor `ThreadEvent` is assignable to `string`.
   */
  stampLastRead: (conversationId: string) => void
  /**
   * #786: stamp the conversation being opened as the MOST RECENTLY VIEWED one
   * (conversationTimelineStore's `markViewed`), which is what ranks it last in that store's eviction
   * order. REQUIRED, not optional, for `stampLastRead`'s reason and one more: `activateDeps` is
   * module-private and `vitest.config.ts` is `environment: 'node'` globally, so no test in this repo ever
   * runs a React effect and the wiring itself is structurally uncoverable. `tsc` is the whole safety net,
   * and it only holds if the field is required.
   *
   * It is what ARMS the ten-slice bound in production: with no caller every slice was never-viewed, so
   * eviction degraded to first-write order and discarded exactly the thread the operator stepped away
   * from. `markViewed` also CREATES the slice when the key is absent, which is why opening a conversation
   * before any event for it has arrived leaves one held rather than letting a later event mint one at the
   * head (conversationTimelineStore.ts:284-294).
   *
   * CROSS-WIRE NOTE for a reviewer: this and `stampLastRead` now have IDENTICAL signatures, so swapping
   * them at a deps site compiles AND every `toHaveBeenCalledWith(conversation.id)` assertion still passes
   * for both. What catches a swap is that the two land in DIFFERENT stores: with the real stores wired,
   * one ends up unmarked and the other unpromoted, so #777's mark tests and #786's order tests fail
   * together (activateConversation.test.ts's `realDeps`). No branded type for a two-member wiring object;
   * at the one production site the defence is that the arrow bodies are visibly different and each member
   * name matches the store method it calls.
   */
  markViewed: (conversationId: string) => void
  /**
   * #1166: ask the daemon for the opened conversation's run configuration AND its published model list,
   * one request each — and since #1231 its stored system prompt, a third. It is the counterpart to
   * `clearSessionId` above — that member wipes the address the footer's write controls need, and this
   * one asks for the value that refills it, so a chat that has never had a turn no longer sits blank
   * and inert until one ends.
   *
   * ONE member for three requests, not three members. They are one act — re-ask for what the switch
   * just invalidated — they always fire together, and none is enough for the footer on its own. It also
   * holds this interface at THREE identical `(conversationId: string) => void` members rather than
   * five.
   *
   * #1231's ask is the one whose absence is not merely staleness. The other two frames are ALSO pushed
   * unsolicited, so a missing ask there costs freshness; `system_prompt` is REPLY-ONLY, so with no ask
   * the event never fires at all and its store stays permanently at its not-loaded state. That is why
   * the ask joined this member rather than waiting for a consumer.
   *
   * REQUIRED, not optional, for `stampLastRead`'s and `markViewed`'s reason: `activateDeps` is
   * module-private, `vitest.config.ts` is `environment: 'node'` globally, so no test in this repo runs a
   * React effect and the wiring itself is structurally uncoverable. `tsc` is the whole safety net and it
   * only holds if the field is required.
   *
   * The no-usable-id decision is NOT here. Both senders already refuse a falsy id
   * (`requestRunConfigSnapshot`, `requestModelList`), where a spy can reach the branch, so this function
   * gains no branch of its own and the empty-string case is answered by construction.
   *
   * CROSS-WIRE NOTE for a reviewer: this makes THREE members with the identical
   * `(conversationId: string) => void` signature, so a swap of any two compiles and survives every
   * `toHaveBeenCalledWith(conversation.id)` assertion. The defence is unchanged and still holds at three:
   * they land in three different places, so with the real deps wired a swap leaves one conversation
   * unstamped or unpromoted AND no request sent, failing #777's mark tests, #786's order tests and
   * #1166's request tests together. At the one production site the arrow bodies are visibly different and
   * each member name matches the effect it performs.
   */
  requestConversationConfig: (conversationId: string) => void
}

/**
 * Make `conversation` the active one, clearing the per-conversation context first when — and only
 * when — the active conversation's id actually changes.
 *
 * The gate is the id, NOT the nav event. Three sites dispatch `{ type: 'open' }` and only two carry a
 * conversation: the notification-activated nav (#393) deliberately carries none, because in the
 * single-active model a notification click means "show the conversation that is already active", and
 * `onOpen` fires for every row click including a re-click of the already-active row. The timeline has
 * no history backfill — its only production writers are the live stream (timelineBridge.ts:206) and
 * the composer's optimistic echo (composerSend.ts:67) — so a clear on either of those paths would
 * destroy rows that never come back, a worse bug than the one being fixed.
 *
 * `previous === null` takes the clear branch and earns no special case: `previous?.id` is `undefined`
 * and never equals a real id, and clearing is free — #528's `reset` returns `initialTimelineState` by
 * reference (zero subscriber churn) and `clearSessionId` returns `initialSessionIdState`. No state
 * exists in which rows legitimately belong to a conversation that was never made active.
 *
 * `setActiveConversation` runs unconditionally on BOTH branches, so #448's most-recent-wins contract is
 * untouched: a same-id re-open still refreshes the stored payload, which matters because a row click
 * carries a ConversationSummary with fresher `last_message_ts` / `is_archived` than the held
 * ConversationCreatedPayload (the former is a structural superset of the latter).
 *
 * Clear-then-set, never the reverse: the comparison has to see the PREVIOUS active conversation, and no
 * observer may ever see the new conversation against the previous one's rows. Fully synchronous, so on
 * the renderer's single thread the check-then-act cannot interleave, and React batches the writes into
 * one commit. Total — no return value, no throw path, and nothing to log (a diagnostic carrying the
 * conversation `id`, `name`, or `cwd` would breach ADR 0007's content-free rule for zero observed gain).
 *
 * One intended consequence: clearing the session id makes `RunConfigSections`' `onChange` `undefined`, so
 * the Run configuration controls render INERT from the switch until the new conversation's session id
 * arrives. That is the point, not a regression — inert beats addressing a YOLO / auto-approval write to
 * the previous conversation's running session. #1166 shortened that window rather than removing it: the
 * ask below now goes out in the same move as the clear, so the wait is one round trip instead of "until
 * this conversation's first turn ends".
 *
 * #1167 completes that argument on the READ side, which until then was the half still lying. The
 * controls were inert but still DISPLAYED the previous chat's model, effort, permission mode and YOLO
 * bit, so the operator read one chat's posture against another's thread. Clearing the run configuration
 * with the session id makes them say nothing instead of something false, which is also what makes every
 * control's not-known rendering reachable at all — before it, no chat could fall back to blank once any
 * chat had set something. It widens the same window by one more reading: `usedTokens` / `windowTokens`
 * go with the snapshot, so the footer's context reading unmounts until the new chat's reply lands.
 */
export function activateConversation(
  deps: ActivateConversationDeps,
  conversation: ConversationCreatedPayload
): void {
  const previous = deps.getActiveConversation()

  if (previous?.id !== conversation.id) {
    deps.dispatchTimeline({ type: 'reset' })
    deps.clearSessionId()
    // #1167, INSIDE the gate — that placement IS AC2, and since #1231 it is also that ticket's AC3
    // clause "NOT dropped on a re-open of the chat already open", true by construction here rather
    // than by a new guard. The four effects below run on a re-open by design; this one must not, or a
    // re-click of the row the operator is already reading would blank its footer and cost a round trip
    // to refill what was already correct. It joins the clear branch rather than starting a new one
    // because "the id actually changed" is the same question for all three: the timeline rows, the
    // session id and the run configuration were all authored by the chat being left. Order among the three is free — they are independent whole-value writes over
    // separate stores — but the branch as a whole must precede `requestConversationConfig` below, and
    // being inside the gate puts it there by construction.
    deps.clearRunConfig()
  }

  deps.setActiveConversation(conversation)
  // #777, OUTSIDE the gate on purpose — that placement IS the "re-opening the already-open conversation
  // records a fresh mark" behaviour. `setActiveConversation` already runs unconditionally above because a
  // re-click hands over a fresher payload; the stamp joins it for the same reason and because a re-open
  // of the conversation the operator is already reading is exactly when a fresh mark is owed. AFTER the
  // set, so the store writes run in the order a reader expects: clear → activate → stamp.
  deps.stampLastRead(conversation.id)
  // #786, OUTSIDE the gate for a reason that lives in the store rather than in symmetry with the line
  // above: `markViewed`'s already-the-tail branch is documented as the COMMON case, justified by this very
  // seam (conversationTimelineStore.ts:284-288). Inside the gate that branch would be unreachable — after
  // a real switch the tail is always the PREVIOUS conversation, never the one being opened — leaving a
  // shipped, tested branch dead and its docstring false. Outside is also free: the guard hands back the
  // state object, so no map is cloned and no subscriber wakes.
  //
  // AFTER `setActiveConversation`, and that ordering IS load-bearing. Creating a slice notifies the
  // timeline store's subscribers, among them #777's `useConversationLastRead`, which re-stamps whatever
  // `getOpenConversationId()` reports. Run before the set, that listener would write an unrequested mark
  // for the PREVIOUS conversation. Run after, it re-records the mark `stampLastRead` just wrote, so
  // `recordLastRead`'s `===` guard returns the state object and the cascade terminates at depth 2 with no
  // subscriber woken and no `localStorage` write.
  deps.markViewed(conversation.id)
  // #1166, OUTSIDE the gate because that placement IS the behaviour: "on every activation — including a
  // re-open of the chat that is already open". Both replies replace WHOLE values, so a duplicate costs
  // nothing and needs no gate; the two frames are fire-and-forget, so nothing here can throw or block.
  //
  // LAST, and that ordering is load-bearing in one direction only. `clearSessionId` above wipes the very
  // value the run-configuration reply refills, so the ask must follow it — ahead of it, a reply that
  // happened to land inside the same tick would be blanked by the clear it was sent to repair. Nothing
  // downstream of the request needs the store writes to have completed; putting it last is what makes the
  // dependency on the clear unmistakable rather than incidental.
  deps.requestConversationConfig(conversation.id)
}
