import type { ConversationCreatedPayload } from '@shared/wire/types'

export interface ActivateConversationDeps {
  getActiveConversation: () => (ConversationCreatedPayload & { serverId?: string }) | null
  setActiveConversation: (conversation: ConversationCreatedPayload) => void
  clearSessionId: () => void
  /** Clear configuration, pending settings and prompt reading/write state together. */
  clearRunConfig: () => void
  requestConversationConfig: (conversationId: string) => void
}

/** Refresh every activation; clear session/configuration when the host or active ID changes. */
export function activateConversation(
  deps: ActivateConversationDeps,
  conversation: ConversationCreatedPayload & { serverId?: string }
): void {
  // Read at invocation time so callbacks cannot compare against a stale render snapshot.
  const previous = deps.getActiveConversation()

  if (previous?.id !== conversation.id || previous?.serverId !== conversation.serverId) {
    deps.clearSessionId()
    deps.clearRunConfig()
  }

  deps.setActiveConversation(conversation)
  // A re-open refreshes the payload and configuration without blanking held settings.
  deps.requestConversationConfig(conversation.id)
}
