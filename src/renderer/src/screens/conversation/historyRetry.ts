import type { ConversationSlice, HistoryRequestState } from '../../store/conversationTimelineStore'
import { conversationTimelineStore } from '../../store/conversationTimelineStore'
import { activeConversationStore } from '../../store/activeConversationStore'
import { historyAskDeps, requestOlderHistory, type HistoryAskDeps } from '../../store/historyPageBridge'
import { connectedConversationHostNow } from './conversationActionAvailability'

type HistoryFailure = Extract<HistoryRequestState, { status: 'failed' }>

export function selectHistoryFailure(
  held: ConversationSlice | null | undefined,
  serverId: string | null
): HistoryFailure | null {
  return serverId !== null && held?.serverId === serverId && held.history?.status === 'failed'
    ? held.history : null
}

interface HistoryRetryDeps extends HistoryAskDeps {
  getOpen: () => { id: string } | null
  getConnectedHost: (conversationId: string) => string | null
  getHeld: (conversationId: string) => ConversationSlice | null
  logRequested: () => void
}

/** The captured objects invalidate old actions after navigation or a new settlement. */
export function retryHistoryPage(
  deps: HistoryRetryDeps,
  open: { id: string },
  serverId: string,
  failure: HistoryFailure
): void {
  if (deps.getOpen() !== open || deps.getConnectedHost(open.id) !== serverId) return
  const held = deps.getHeld(open.id)
  if (!failure.retryable || selectHistoryFailure(held, serverId) !== failure ||
      held?.localRead === 'loading' || (held?.coverage?.status === 'received' && held.coverage.atStart)) return
  requestOlderHistory(deps, open.id, true)
  deps.logRequested()
}

export const historyRetryDeps: HistoryRetryDeps = {
  ...historyAskDeps,
  getOpen: () => activeConversationStore.getState().activeConversation,
  getConnectedHost: connectedConversationHostNow,
  getHeld: id => conversationTimelineStore.getState().timelines.get(id) ?? null,
  logRequested: () => window.pyry.sendDiagnostic({ event: 'history-retry', code: 'requested' })
}
