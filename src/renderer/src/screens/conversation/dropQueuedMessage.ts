// The drop-queued-message effect — framework-free and React-free, co-located with the screen and
// mirroring composerSend.ts / modalResolution.ts: the single effect (the guarded outbound command) is
// injected, so the helper is a pure, deterministic function tested with a plain spy (no React, no store,
// no Electron). The QueuedBacklogControl container is thin glue over this.
//
// This is a strict subset of cancelPrompt: the same guarded send, but NO local dispatch (AC3: no
// optimistic removal — the row disappears only when the daemon's next queue_state snapshot replaces the
// backlog, which the live store subscription renders) and NO camelCase→snake rename (the wire fields are
// already snake_case). Extracted like every sibling guarded send (submitMessage, answerPrompt,
// cancelPrompt, runUnpair) rather than inlined in the container.
import { dequeueMessageCommand, type RendererCommand } from '@shared/ipc/commands'

/**
 * The single effect dropQueuedMessage performs, injected so the helper stays pure and deterministic in
 * tests. `sendCommand` is `window.pyry.sendCommand` in the container.
 */
export interface DropQueuedMessageDeps {
  sendCommand: (command: RendererCommand) => void
}

/**
 * Drop one queued message before it runs (#300's `dequeueMessage`). The ids are already the snake_case
 * wire vocabulary (no rename). Guarded send ONLY — no local dispatch: dropping is not optimistic (AC3),
 * so the queue store is never mutated here; the row is removed by the next `queue_state` replacement
 * snapshot. A bridge failure is swallowed (`console.error`), never propagated — a failed drop must not
 * crash the window (the submitMessage / cancelPrompt AC posture); the row simply remains, which is the
 * honest state (the daemon never received the drop).
 */
export function dropQueuedMessage(
  conversation_id: string,
  queued_msg_id: number,
  deps: DropQueuedMessageDeps
): void {
  try {
    deps.sendCommand(dequeueMessageCommand({ conversation_id, queued_msg_id }))
  } catch (error) {
    // A send-bridge failure must not crash the window. No local clear posts (AC3: no optimistic removal).
    console.error('drop queued message send failed', error)
  }
}
