import { useEffect } from 'react'
import { agentSwitchStore } from './agentSwitchStore'
import { activeConversationStore } from './activeConversationStore'
import { conversationListStore } from './conversationListStore'
import { sessionStore } from './sessionStore'
import { serverInfoStore } from './serverInfoStore'

/** Observe outcomes even when the conversation pane is unmounted. */
export function AgentSwitchData(): null {
  useEffect(() => {
    const dispatch = agentSwitchStore.getState().dispatch
    const reconcile = () => dispatch({ type: 'reconcile' })
    const offs = [
      window.pyry.onDaemonEvent(event => dispatch({ type: 'outcome', event })),
      activeConversationStore.subscribe(reconcile),
      conversationListStore.subscribe(reconcile),
      sessionStore.subscribe(reconcile),
      serverInfoStore.subscribe((next, previous) => {
        for (const server of previous.servers) {
          if (!next.servers.some(s => s.serverId === server.serverId)) {
            dispatch({ type: 'hostRemoved', serverId: server.serverId })
          }
        }
      })
    ]
    reconcile()
    return () => { for (const off of offs) off() }
  }, [])
  return null
}
