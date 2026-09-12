import { conversationListStore, useConversationListStore, selectConversations } from '../../store/conversationListStore'
import { sessionStore, useSessionStore } from '../../store/sessionStore'
import { serverIdForOpenConversation } from './unpairAction'

export function useConversationActionAvailability(conversationId: string | null): boolean {
  const rows = useConversationListStore(selectConversations)
  const serverId = serverIdForOpenConversation(rows, conversationId)
  return useSessionStore(s => serverId !== null && s.statuses.get(serverId)?.type === 'connected')
}

// Resolve again immediately before dispatch, before any optimistic state changes.
export function connectedConversationHostNow(conversationId: string | null): string | null {
  const serverId = serverIdForOpenConversation(selectConversations(conversationListStore.getState()), conversationId)
  const connected = serverId !== null && sessionStore.getState().statuses.get(serverId)?.type === 'connected'
  if (typeof window !== 'undefined') {
    window.pyry?.sendDiagnostic?.({ event: 'conversation-action-availability', code: connected ? 'connected' : 'unavailable' })
  }
  return connected ? serverId : null
}
