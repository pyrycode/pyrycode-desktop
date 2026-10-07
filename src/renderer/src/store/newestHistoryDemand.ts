import { requestHistoryPage, type HistoryAskDeps } from './historyPageBridge'

/** Navigation identity and connection edges create demand; settlement only releases it. */
export function createNewestHistoryDemand(deps: HistoryAskDeps) {
  let current: { serverId: string; conversationId: string } | null = null
  let wasConnected = false
  let pending = false
  return {
    sync(target: { serverId: string; conversationId: string } | null, connected: boolean): void {
      const changed = target?.serverId !== current?.serverId || target?.conversationId !== current?.conversationId
      if (changed) pending = target !== null && connected
      else if (connected && !wasConnected && target !== null) pending = true
      if (!connected || target === null) pending = false
      current = target
      wasConnected = connected
      if (!pending || target === null) return
      const held = deps.getHeld(target.conversationId)
      if (held?.localRead === 'loading' || held?.history?.status === 'requested') return
      // Consume before marking requested: that store write synchronously notifies our subscriber.
      pending = false
      requestHistoryPage(deps, target.conversationId, '', 'newest')
    }
  }
}
