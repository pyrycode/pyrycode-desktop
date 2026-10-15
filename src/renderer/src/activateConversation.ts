import type { ConversationCreatedPayload } from '@shared/wire/types'

export interface ActivateConversationDeps {
  getActiveConversation: () => ConversationCreatedPayload | null
  setActiveConversation: (conversation: ConversationCreatedPayload) => void
  clearSessionId: () => void
  /** Clear configuration, pending settings and prompt reading/write state together. */
  clearRunConfig: () => void
  requestConversationConfig: (conversationId: string) => void
}

/** Refresh every activation; clear session/configuration only when the active ID changes. */
export function activateConversation(
  deps: ActivateConversationDeps,
  conversation: ConversationCreatedPayload
): void {
  // Read at invocation time so callbacks cannot compare against a stale render snapshot.
  const previous = deps.getActiveConversation()

  if (previous?.id !== conversation.id) {
    deps.clearSessionId()
    deps.clearRunConfig()
  }

  deps.setActiveConversation(conversation)
  // A re-open refreshes the payload and configuration without blanking held settings.
  deps.requestConversationConfig(conversation.id)
}
