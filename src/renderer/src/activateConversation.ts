// The "make this conversation the active one" decision — framework-free and React-free, co-located
// with PairedShell beside its other pure helper pairedRoute.ts, and mirroring unpairAction.ts /
// composerSend.ts: the effects are injected so the helper is a pure, deterministic function tested
// with plain spies (no React, no store, no Electron). PairedShell's two carrying nav sites are thin
// glue over this.
import type { ConversationCreatedPayload } from '@shared/wire/types'
import type { ThreadEvent } from './store/threadTimeline'

/**
 * The six effects activateConversation performs, injected to keep it pure:
 *  - `getActiveConversation` — reads the CURRENTLY active conversation (activeConversationStore).
 *  - `setActiveConversation` — records the newly activated one (the same store's setter).
 *  - `dispatchTimeline`      — timelineStore's dispatch; carries #528's `reset`.
 *  - `clearSessionId`        — sessionIdStore's #529 clear.
 *  - `stampLastRead`         — #777's last-read stamp for the conversation being opened.
 *  - `markViewed`            — #786's view stamp, conversationTimelineStore's eviction ranking.
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
 * One intended consequence: clearing the session id makes RunConfigSections' `onChange` `undefined`
 * (RunConfigSections.tsx:332-339), so the Run configuration controls render INERT from the switch until
 * the new conversation's `sessionTransition` marker arrives. That is the point, not a regression —
 * inert beats addressing a YOLO / auto-approval write to the previous conversation's running session.
 */
export function activateConversation(
  deps: ActivateConversationDeps,
  conversation: ConversationCreatedPayload
): void {
  const previous = deps.getActiveConversation()

  if (previous?.id !== conversation.id) {
    deps.dispatchTimeline({ type: 'reset' })
    deps.clearSessionId()
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
}
