import { conversationListStore, useConversationListStore, selectConversations } from '../../store/conversationListStore'
import { sessionStore, useSessionStore } from '../../store/sessionStore'
import { serverIdForOpenConversation } from './unpairAction'
import { activeConversationStore, useActiveConversationStore } from '../../store/activeConversationStore'
import type { RendererCommand } from '@shared/ipc/commands'
import { sessionIdStore } from '../../store/sessionIdStore'

/** Capture matching selected coordinates at dispatch; explicit background/prompt owners win. */
export function sendConversationCommand(command: RendererCommand, owningHost?: string | null): void {
  if (owningHost === null) return
  if (owningHost !== undefined && command.serverId === undefined) {
    window.pyry.sendCommand({ ...command, serverId: owningHost }); return
  }
  const active = activeConversationStore.getState().activeConversation
  if (command.serverId === undefined && active && 'serverId' in active && typeof active.serverId === 'string' &&
      'payload' in command && (('conversation_id' in command.payload && command.payload.conversation_id === active.id) ||
        (command.type === 'setSessionSettings' && command.payload.session_id === sessionIdStore.getState().sessionId))) {
    window.pyry.sendCommand({ ...command, serverId: active.serverId })
  } else window.pyry.sendCommand(command)
}

export function useConversationActionAvailability(conversationId: string | null, hostId?: string): boolean {
  const selectedHost = useActiveHost(conversationId)
  const serverId = useConversationListStore(s => hostId ?? selectedHost ?? serverIdForOpenConversation(selectConversations(s), conversationId))
  return useSessionStore(s => serverId !== null && s.statuses.get(serverId)?.type === 'connected')
}

// Resolve again immediately before dispatch, before any optimistic state changes.
export function connectedConversationHostNow(conversationId: string | null, hostId?: string): string | null {
  const serverId = hostId ?? activeHost(conversationId) ?? serverIdForOpenConversation(selectConversations(conversationListStore.getState()), conversationId)
  const connected = serverId !== null && sessionStore.getState().statuses.get(serverId)?.type === 'connected'
  if (typeof window !== 'undefined') {
    window.pyry?.sendDiagnostic?.({ event: 'conversation-action-availability', code: connected ? 'connected' : 'unavailable' })
  }
  return connected ? serverId : null
}

function activeHost(conversationId: string | null): string | undefined {
  const active = activeConversationStore.getState().activeConversation
  return active?.id === conversationId && 'serverId' in active && typeof active.serverId === 'string' ? active.serverId : undefined
}
function useActiveHost(conversationId: string | null): string | undefined {
  return useActiveConversationStore(s => s.activeConversation?.id === conversationId &&
    'serverId' in s.activeConversation && typeof s.activeConversation.serverId === 'string' ? s.activeConversation.serverId : undefined)
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
