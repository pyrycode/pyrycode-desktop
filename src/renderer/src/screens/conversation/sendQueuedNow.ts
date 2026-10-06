// The Send now effect (#1726) — framework-free and React-free, beside dropQueuedMessage.ts and in its
// injected-effects shape, so it is tested with a plain spy. Its caller is the `onSendQueuedNow` closure
// ConversationScreen binds onto Timeline.
//
// ⭐ UNLIKE dropQueuedMessage IT WRITES NOTHING TO THE TIMELINE. A drop takes the window's optimistic
// echo with it because the message will never run; Send now delivers the message, so the echo stays
// true. The row keeps its queued treatment until the daemon's next `queue_state` omits it, and the
// daemon's user `message` push for it is folded onto the same row by the existing `message_id` dedupe.
import { sendQueuedNowCommand, type RendererCommand } from '@shared/ipc/commands'

/** The one effect, injected: `window.pyry.sendCommand` in the container. */
export interface SendQueuedNowDeps {
  sendCommand: (command: RendererCommand) => void
}

/**
 * Ask the daemon to deliver one queued message into the running turn. `queued_msg_id` comes from an
 * untrusted `queue_state` and is passed through verbatim — the daemon no-ops an unknown id. A bridge
 * failure is swallowed (`console.error`, no ids, no text) so the window does not crash; the daemon heard
 * nothing, so the row simply stays queued and drains normally.
 */
export function sendQueuedNow(
  conversation_id: string,
  queued_msg_id: number,
  deps: SendQueuedNowDeps
): void {
  try {
    deps.sendCommand(sendQueuedNowCommand({ conversation_id, queued_msg_id }))
  } catch (error) {
    console.error('send queued message now failed', error)
  }
}
