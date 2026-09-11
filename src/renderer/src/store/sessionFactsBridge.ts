import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { sessionFactsStore } from './sessionFactsStore'

export function subscribeSessionFacts(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  record: (snapshot: Omit<Extract<DaemonEvent, { type: 'sessionFacts' }>, 'type'>) => void
): () => void {
  return onDaemonEvent((event) => {
    if (event.type !== 'sessionFacts') return
    record({
      conversationId: event.conversationId,
      claudeCodeVersion: event.claudeCodeVersion,
      permissionMode: event.permissionMode,
      truncatedFields: event.truncatedFields
    })
  })
}

export function SessionFactsData(): null {
  useEffect(() => subscribeSessionFacts(
    window.pyry.onDaemonEvent,
    sessionFactsStore.getState().setSessionFacts
  ), [])
  return null
}
