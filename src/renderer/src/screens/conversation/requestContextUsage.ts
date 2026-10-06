import type { RendererCommand } from '@shared/ipc/commands'
import type { StoreApi } from 'zustand/vanilla'
import type { ConversationActivityStore } from '../../store/conversationActivityStore'

/** Ask once; main owns send diagnostics and the passive bridge receives any reply. */
export function requestContextUsage(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string | null
): void {
  if (!conversationId) return
  sendCommand({ type: 'requestContextUsage', payload: { conversation_id: conversationId } })
}

/** Observe completion per conversation; eviction and reconnect clears are not completions. */
export function subscribeResetContextUsage(
  activities: Pick<StoreApi<ConversationActivityStore>, 'subscribe'>,
  sendCommand: (command: RendererCommand) => void
): () => void {
  return activities.subscribe((state, previous) => {
    for (const [id, activity] of state.entries) {
      if (previous.entries.get(id)?.resetting === true && !activity.resetting) {
        requestContextUsage(sendCommand, id)
      }
    }
  })
}
