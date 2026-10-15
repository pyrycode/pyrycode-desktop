import type { ConversationListOrigin } from './store/conversationListStore'
import {
  conversationListStore,
  selectExclusiveConversationIdsFor
} from './store/conversationListStore'
import { activeConversationStore } from './store/activeConversationStore'
import { conversationLastReadStore } from './store/conversationLastReadStore'
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
  clearLastReadFor: (conversationIds: ReadonlySet<string>) => void
}

/** Read exclusive departed IDs before removing their list slot; persist read-mark cleanup last. */
export function clearServerScopedState(
  deps: ClearServerScopedStateDeps,
  serverId: string
): void {
  const departed = deps.getDepartedConversationIds(serverId)
  deps.clearConversationsFor(serverId)

  for (const conversationId of departed) {
    exitActiveConversation(deps, conversationId)
  }
  deps.clearLastReadFor(departed)
}

export const serverScopedClearDeps: Omit<ClearServerScopedStateDeps, 'navigateToList'> = {
  // Snapshot exclusivity before clearing the list; use the client-held departing host ID.
  getDepartedConversationIds: (serverId: ConversationListOrigin) =>
    selectExclusiveConversationIdsFor(serverId)(conversationListStore.getState()),
  clearConversationsFor: (serverId) =>
    conversationListStore.getState().clearConversationsFor(serverId),
  clearLastReadFor: (conversationIds) =>
    conversationLastReadStore.getState().clearLastReadFor(conversationIds),
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
