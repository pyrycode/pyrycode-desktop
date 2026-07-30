// The "make this conversation the active one" decision — framework-free and React-free, co-located
// with PairedShell beside its other pure helper pairedRoute.ts, and mirroring unpairAction.ts /
// composerSend.ts: the effects are injected so the helper is a pure, deterministic function tested
// with plain spies (no React, no store, no Electron). PairedShell's two carrying nav sites are thin
// glue over this.
import type { ConversationCreatedPayload } from '@shared/wire/types'
import type { ThreadEvent } from './store/threadTimeline'

/**
 * The four effects activateConversation performs, injected to keep it pure:
 *  - `getActiveConversation` — reads the CURRENTLY active conversation (activeConversationStore).
 *  - `setActiveConversation` — records the newly activated one (the same store's setter).
 *  - `dispatchTimeline`      — timelineStore's dispatch; carries #528's `reset`.
 *  - `clearSessionId`        — sessionIdStore's #529 clear.
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
 * `clearActiveConversation` (#529) is deliberately NOT among these: it belongs to #531 (unpair /
 * pair-another-server), and calling it here would wipe the value this path is in the middle of setting.
 */
export interface ActivateConversationDeps {
  getActiveConversation: () => ConversationCreatedPayload | null
  setActiveConversation: (conversation: ConversationCreatedPayload) => void
  dispatchTimeline: (event: ThreadEvent) => void
  clearSessionId: () => void
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
}
