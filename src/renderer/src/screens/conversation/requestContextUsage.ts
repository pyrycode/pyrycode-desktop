import type { RendererCommand } from '@shared/ipc/commands'

/** Ask once; main owns send diagnostics and the passive bridge receives any reply. */
export function requestContextUsage(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string | null
): void {
  if (!conversationId) return
  sendCommand({ type: 'requestContextUsage', payload: { conversation_id: conversationId } })
}
