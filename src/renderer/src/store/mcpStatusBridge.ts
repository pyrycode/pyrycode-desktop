import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { mcpStatusStore } from './mcpStatusStore'

export function subscribeMcpStatus(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  record: (snapshot: Omit<Extract<DaemonEvent, { type: 'mcpStatus' }>, 'type'>) => void,
  markUnavailable: (conversationId: string) => void,
  markReconnectRefused: (conversationId: string) => void,
  markToggleRefused: (conversationId: string) => void
): () => void {
  return onDaemonEvent((event) => {
    if (event.type === 'mcpStatus') {
      record({ conversationId: event.conversationId, servers: event.servers, droppedServers: event.droppedServers })
    } else if (event.type === 'mcpStatusRequestRejected' && event.reason === 'mcp-status-unavailable') {
      // `conversationId` is the id this app asked about (main's correlation). An unclassified refusal
      // is a client or daemon fault with nothing for the operator to read, so it changes nothing.
      markUnavailable(event.conversationId)
    } else if (event.type === 'mcpReconnectRejected') {
      // Main's recorded id for its own send. The refusal names no cause, so neither does the mark.
      markReconnectRefused(event.conversationId)
    } else if (event.type === 'mcpToggleRejected') {
      // The same rules for the toggle's refusal, kept on its own mark.
      markToggleRefused(event.conversationId)
    }
  })
}

// Mounted for the app's lifetime so a report lands while the Channel info sheet is closed.
export function McpStatusData(): null {
  useEffect(() => subscribeMcpStatus(
    window.pyry.onDaemonEvent,
    mcpStatusStore.getState().setMcpStatus,
    mcpStatusStore.getState().markMcpStatusUnavailable,
    mcpStatusStore.getState().markMcpReconnectRefused,
    mcpStatusStore.getState().markMcpToggleRefused
  ), [])
  return null
}
