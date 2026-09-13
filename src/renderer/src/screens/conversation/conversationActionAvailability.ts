import { conversationListStore, useConversationListStore, selectConversations } from '../../store/conversationListStore'
import { sessionStore, useSessionStore } from '../../store/sessionStore'
import { serverIdForOpenConversation } from './unpairAction'
import { activeConversationStore } from '../../store/activeConversationStore'

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

/** Complete connected creation initialization after the authoritative list arrives, never on reconnect. */
export function initializeCreatedConversationAfterList(
  conversationId: string,
  serverId: string | undefined,
  initialize: (conversationId: string) => void
): () => void {
  const lists = conversationListStore.getState()
  if (!serverId || sessionStore.getState().statuses.get(serverId)?.type !== 'connected' ||
    lists.conversations?.some(row => row.id === conversationId)) return () => {}

  const previousRows = lists.byServer.get(serverId)
  const cleanups: (() => void)[] = []
  const cancel = (): void => { cleanups.splice(0).forEach(off => off()) }
  cleanups.push(conversationListStore.subscribe(state => {
    if (state.byServer.get(serverId) === previousRows) return
    // Consume the first owner-list reply even when absent or ambiguous. No later replay.
    cancel()
    if (activeConversationStore.getState().activeConversation?.id === conversationId &&
      connectedConversationHostNow(conversationId) === serverId) initialize(conversationId)
  }))
  cleanups.push(sessionStore.subscribe(state => {
    if (state.statuses.get(serverId)?.type !== 'connected') cancel()
  }))
  cleanups.push(activeConversationStore.subscribe(state => {
    if (state.activeConversation?.id !== conversationId) cancel()
  }))
  return cancel
}
