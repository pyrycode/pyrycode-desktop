// The drop-queued-message effect — framework-free and React-free, co-located with the screen and
// mirroring composerSend.ts / modalResolution.ts: the effects (the guarded outbound command and the two
// timeline writes) are injected, so the helper is a pure, deterministic function tested with plain spies
// (no React, no store, no Electron). Its caller is the `onDropQueued` closure `ConversationScreen` binds
// onto `Timeline` — thin glue over this, and since #1009 written inline at that mount rather than in a
// container of its own. It hung on the separate `QueuedBacklog` view until #1214 folded the queued rows
// into the thread; nothing about this helper's contract changed with it, including the two positional
// values it takes.
//
// ⭐ #1213 SPLIT THIS HELPER'S POSTURE IN TWO, and the split is what the ticket is. Until now this was a
// strict subset of cancelPrompt — the same guarded send and NO local dispatch, because #296 AC3 made the
// drop non-optimistic on purpose. That ruling still stands for the QUEUED ROW: the daemon owns the
// backlog, so the row disappears only when the next queue_state snapshot replaces it. It does NOT
// transfer to the TIMELINE ECHO, which the daemon never authored — `submitMessage` writes that echo
// optimistically before any acknowledgement, so this window undoing its own optimistic write at the click
// is symmetric rather than a new claim. Three reasons the echo goes here and not on a later snapshot:
//
//  1. It is this window's own record. #296's ruling is about who owns the fact, and nobody but this
//     window owns the echo.
//  2. There is nothing to wait for. `dequeue_message` has no reject path — an out-of-range id is a
//     daemon-side no-op — so no frame ever confirms or refuses the drop.
//  3. The only snapshot-based alternative is a backlog DIFF, and a backlog also shrinks when the daemon
//     DRAINS it. A diff-driven removal would delete the echo of every message that ran normally, which is
//     a worse lie than the one being fixed. Doing it without a diff would need a pending-drop ledger held
//     across an async boundary and expired on a timeout nobody has a value for.
//
// The cost, stated plainly: a drop the daemon ignores leaves this window's transcript missing a row the
// daemon still holds, until the next snapshot re-draws the queued row (it cannot restore the echo). That
// is bounded to display and strictly better than today's permanent delivered-looking lie.
//
// STILL NO camelCase→snake rename on the wire ids (they are already snake_case), and still extracted like
// every sibling guarded send (submitMessage, answerPrompt, cancelPrompt, runUnpair) rather than inlined.
import { dequeueMessageCommand, type RendererCommand } from '@shared/ipc/commands'
import type { ThreadEvent } from '../../store/threadTimeline'

/**
 * The effects dropQueuedMessage performs, injected so the helper stays pure and deterministic in tests.
 * `sendCommand` is `window.pyry.sendCommand` in the container.
 *
 * `dispatch` and `dispatchFor` (#1213) are the two timeline writes — the flat `timelineStore` and the
 * keyed `conversationTimelineStore` — and they are the exact pair `submitMessage` wrote the echo through
 * (#756). Both are REQUIRED, following `ComposerSendDeps.dispatchFor` and not its optional `now`: this
 * deps object has one production call site plus this module's own spec, far below the ten-call-site
 * boundary that made a required field expensive there, so requiring them costs a handful of mechanical
 * test edits and buys a compile error for "forgot to wire it". A removal that reached only one store
 * would leave the other holding the lie, and switching conversations would bring it back.
 */
export interface DropQueuedMessageDeps {
  sendCommand: (command: RendererCommand) => void
  dispatch: (event: ThreadEvent) => void
  dispatchFor: (conversationId: string, event: ThreadEvent) => void
}

/**
 * Drop one queued message before it runs (#300's `dequeueMessage`), and take its timeline echo with it
 * (#1213). The ids are already the snake_case wire vocabulary (no rename).
 *
 * `message_id` is the correlation key pyrycode#2092 put on every `queue_state` item: the id of the
 * `send_message` that produced the row, which for a message THIS window sent is the id `submitMessage`
 * minted and kept on the echo. It is UNTRUSTED — another client's value, relayed by a content-blind relay
 * — and is used for strict string equality only, never as a lookup path, a cache key or a filename.
 *
 * ⭐ THE EMPTY-ID RULE LIVES HERE, at the single producer of `dropUserText`, and nowhere else. An absent
 * or empty id correlates with NOTHING (AC1): the drop still goes — the row must leave the backlog even
 * against a pre-#2092 daemon — and no echo is removed, rather than the wrong one being guessed at. The
 * reducer arm carries a plain `messageId: string` and adds no second guard, because `undefined === ''`
 * is false and so an id-less echo is already unreachable from there.
 *
 * The removal is GATED ON THE SEND ACTUALLY GOING. A bridge failure is swallowed (`console.error`, no id
 * and no text), never propagated — a failed drop must not crash the window (the submitMessage /
 * cancelPrompt AC posture) — and it also suppresses the removal: the daemon received nothing, so the
 * message is still queued and will still run, and its echo is still true. This is where the echo parts
 * company with `submitMessage`'s, which posts even on a failed send: showing a message the operator typed
 * is optimism, while hiding one the daemon still holds would be a claim about the daemon.
 */
export function dropQueuedMessage(
  conversation_id: string,
  queued_msg_id: number,
  message_id: string | undefined,
  deps: DropQueuedMessageDeps
): void {
  try {
    deps.sendCommand(dequeueMessageCommand({ conversation_id, queued_msg_id }))
  } catch (error) {
    // A send-bridge failure must not crash the window, and it leaves the thread exactly as it was: the
    // daemon never heard the drop, so the message is still queued and its echo is still honest.
    console.error('drop queued message send failed', error)
    return
  }

  if (message_id === undefined || message_id === '') return

  // Built ONCE and handed to both write paths (the submitMessage discipline). Sharing one `ThreadEvent`
  // reference across the two stores is safe because `reduceTimeline` is pure and always builds fresh
  // arrays. The keyed write is folded under the conversation the drop was issued against, which is the
  // same conversation the echo was written to — this window can only drop a row it is looking at.
  const removal: ThreadEvent = { type: 'dropUserText', messageId: message_id }
  deps.dispatch(removal)
  deps.dispatchFor(conversation_id, removal)
}
