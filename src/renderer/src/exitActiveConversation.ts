// The "the conversation on screen is gone — leave it" decision (#652) — framework-free and React-free,
// co-located with PairedShell beside its other pure helpers activateConversation.ts,
// clearPairingScopedState.ts and pairedRoute.ts, and mirroring unpairAction.ts / composerSend.ts: the
// effects are injected so the helper is a pure, deterministic function tested with plain spies (no React,
// no store, no Electron). PairedShell's delete-confirmation callback is thin glue over this.
import type { ConversationCreatedPayload } from '@shared/wire/types'
import type { ThreadEvent } from './store/threadTimeline'

/**
 * The five effects exitActiveConversation performs, injected to keep it pure:
 *  - `getActiveConversation`   — reads the CURRENTLY active conversation (activeConversationStore).
 *  - `dispatchTimeline`        — timelineStore's dispatch; carries #528's `reset` (a full wipe).
 *  - `clearActiveConversation` — activeConversationStore's #529 clear.
 *  - `clearSessionId`          — sessionIdStore's #529 clear.
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
  clearActiveConversation: () => void
  clearSessionId: () => void
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
 * Channel List rendered against the deleted discussion's thread state. The three clears are independent
 * whole-value writes with no ordering constraint among themselves; only the nav is pinned last. All four
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
 * THREE clears, not clearPairingScopedState's five. That helper additionally resets the session store and
 * clears the announced running model, and neither belongs here: the pairing has NOT ended — the daemon
 * connection is alive and the operator lands on a working Channel List — so resetting the session store
 * would blank a live connection status into a false disconnected state, and the announced model is
 * daemon-scoped, not conversation-scoped (activateConversation clears neither on a conversation switch).
 * The set here is activateConversation's clear branch (timeline `reset` + `clearSessionId`) PLUS
 * `clearActiveConversation`, which that helper excludes only because it immediately re-sets the value
 * (activateConversation.ts:25-27); here there is no successor conversation, so the clear is the point.
 *
 * Stores deliberately left OUT, so the next ticket need not re-litigate them:
 *  - `queueStore` — the backlog is selected by matching the active conversation id, and a null active id
 *    yields the stable empty backlog via the `''` sentinel (ConversationScreen.tsx:1294-1299). No stale
 *    queued row can render, so none can be dropped.
 *  - `announcedModelStore`, `sessionStore` — pairing-scoped, not conversation-scoped (see above).
 *  - `conversationListStore` — #376's re-list already re-authors it off the same event.
 *
 * One intended consequence, the same one activateConversation and clearPairingScopedState document:
 * clearing the session id makes RunConfigSections' `onChange` `undefined`, so the Run configuration
 * controls render INERT. That is the security payload, not a regression — inert beats addressing a YOLO /
 * auto-approval write to a session that belonged to a conversation the daemon has destroyed.
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
  deps.clearActiveConversation()
  deps.clearSessionId()
  deps.navigateToList()
}
