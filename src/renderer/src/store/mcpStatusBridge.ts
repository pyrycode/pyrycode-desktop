import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { mcpStatusStore } from './mcpStatusStore'

export function subscribeMcpStatus(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  record: (snapshot: Omit<Extract<DaemonEvent, { type: 'mcpStatus' }>, 'type'>) => void
): () => void {
  return onDaemonEvent((event) => {
    if (event.type !== 'mcpStatus') return
    record({ conversationId: event.conversationId, servers: event.servers, droppedServers: event.droppedServers })
  })
}

// Mounted for the app's lifetime so a report lands while the Channel info sheet is closed.
export function McpStatusData(): null {
  useEffect(() => subscribeMcpStatus(
    window.pyry.onDaemonEvent,
    mcpStatusStore.getState().setMcpStatus
  ), [])
  return null
}
