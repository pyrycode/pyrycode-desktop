import { conversationListStore, useConversationListStore, selectConversations } from '../../store/conversationListStore'
import { sessionStore, useSessionStore } from '../../store/sessionStore'
import { serverIdForOpenConversation } from './unpairAction'

export function usePromptResponseAvailability(conversationId: string | null): boolean {
  const rows = useConversationListStore(selectConversations)
  const serverId = serverIdForOpenConversation(rows, conversationId)
  return useSessionStore(s => serverId !== null && s.statuses.get(serverId)?.type === 'connected')
}

// Read immediately before the response helper, which also resolves local prompt/pick state.
export function canRespondToPromptNow(conversationId: string | null): boolean {
  const serverId = serverIdForOpenConversation(selectConversations(conversationListStore.getState()), conversationId)
  const available = serverId !== null && sessionStore.getState().statuses.get(serverId)?.type === 'connected'
  if (typeof window !== 'undefined') {
    window.pyry?.sendDiagnostic?.({ event: 'prompt-response-availability', code: available ? 'connected' : 'unavailable' })
  }
  return available
}
