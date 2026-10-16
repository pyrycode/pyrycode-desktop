import type { ConversationListOrigin } from './store/conversationListStore'
import {
  conversationListStore,
  selectExclusiveConversationIdsFor
} from './store/conversationListStore'
import { activeConversationStore } from './store/activeConversationStore'
import { runConfigStore } from './store/runConfigStore'
import { runSettingsWriteStore } from './store/runSettingsWriteStore'
import { sessionIdStore } from './store/sessionIdStore'
import { systemPromptStore } from './store/systemPromptStore'
import { systemPromptWriteStore } from './store/systemPromptWriteStore'
import { exitActiveConversation, type ExitActiveConversationDeps } from './exitActiveConversation'

export interface ClearServerScopedStateDeps extends ExitActiveConversationDeps {
  /** Exclusive IDs only: another paired host's claim must survive this host's departure. */
  getDepartedConversationIds: (serverId: string) => ReadonlySet<string>
  clearConversationsFor: (serverId: string) => void
}

/** Read exclusive departed IDs before removing their list slot. */
export function clearServerScopedState(
  deps: ClearServerScopedStateDeps,
  serverId: string
): void {
  const departed = deps.getDepartedConversationIds(serverId)
  deps.clearConversationsFor(serverId)

  for (const conversationId of departed) {
    exitActiveConversation(deps, conversationId)
  }
}

export const serverScopedClearDeps: Omit<ClearServerScopedStateDeps, 'navigateToList'> = {
  // Snapshot exclusivity before clearing the list; use the client-held departing host ID.
  getDepartedConversationIds: (serverId: ConversationListOrigin) =>
    selectExclusiveConversationIdsFor(serverId)(conversationListStore.getState()),
  clearConversationsFor: (serverId) =>
    conversationListStore.getState().clearConversationsFor(serverId),
  getActiveConversation: () => activeConversationStore.getState().activeConversation,
  clearActiveConversation: () => activeConversationStore.getState().clearActiveConversation(),
  clearSessionId: () => sessionIdStore.getState().clearSessionId(),
  clearRunConfig: () => {
    runConfigStore.getState().clearSnapshot()
    runSettingsWriteStore.getState().dispatch({ type: 'conversationSwitched' })
    systemPromptStore.getState().clearReading()
    systemPromptWriteStore.getState().dispatch({ type: 'conversationSwitched' })
  }
}
