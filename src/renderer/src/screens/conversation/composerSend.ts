// The composer's submit logic — framework-free and React-free, co-located with the screen
// and mirroring pairingState.ts / messageViewModel.ts: the effects are injected so the helper
// is a pure, deterministic function tested with plain spies (no React, no store, no Electron).
// The React container (ConversationScreen's Composer) is thin glue over this.
import { sendMessageCommand, type RendererCommand } from '@shared/ipc/commands'
import type { SendMessagePayload } from '@shared/wire/types'
import type { SessionAction } from '../../store/sessionStore'

/**
 * The single active conversation for this milestone. There is no conversation-selection surface
 * yet (the message list is empty until the first message; HelloAckPayload carries no conversation
 * id), so a stable constant is the correct source. This is the one place a future
 * conversation-selection ticket replaces. The daemon treats `conversation_id` as opaque and echoes
 * back whatever it is sent.
 */
export const MILESTONE_CONVERSATION_ID = 'default'

/**
 * The three effects submitMessage performs, injected so the helper stays pure and deterministic in
 * tests. `newMessageId` is `crypto.randomUUID()` in the container; tests inject a stub.
 */
export interface ComposerSendDeps {
  sendCommand: (command: RendererCommand) => void
  dispatch: (action: SessionAction) => void
  newMessageId: () => string
}

/**
 * Submit the composer's current text. Returns `true` when a message was sent (the container clears
 * the input on `true`), `false` for whitespace-only input (no effect).
 *
 * One `message_id` is minted here and reused for both the wire command and the store echo, so the
 * daemon's later echo of the same id dedupes against the optimistic copy (AC3). The send is guarded
 * (AC4): a bridge failure is swallowed, never propagated. The optimistic echo is dispatched
 * regardless of the send outcome — "optimistic" means show-immediately, and this milestone has no
 * send-failure UI surface.
 */
export function submitMessage(text: string, deps: ComposerSendDeps): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false

  const message_id = deps.newMessageId()

  const payload: SendMessagePayload = {
    conversation_id: MILESTONE_CONVERSATION_ID,
    message_id,
    text: trimmed
  }

  try {
    deps.sendCommand(sendMessageCommand(payload))
  } catch (error) {
    // AC4: a send-bridge failure must not crash the window. The optimistic echo still posts.
    console.error('composer send failed', error)
  }

  deps.dispatch({
    type: 'messageSent',
    message: {
      conversation_id: MILESTONE_CONVERSATION_ID,
      message_id,
      role: 'user',
      text: trimmed
    }
  })

  return true
}
