import type { ConversationCreatedPayload } from '@shared/wire/types'

export interface ExitActiveConversationDeps {
  getActiveConversation: () => ConversationCreatedPayload | null
  clearActiveConversation: () => void
  clearSessionId: () => void
  /** Clear configuration, pending settings and prompt reading/write state together. */
  clearRunConfig: () => void
  navigateToList: () => void
}

/** Exit only the matching active chat, clearing its session/configuration before navigation. */
export function exitActiveConversation(
  deps: ExitActiveConversationDeps,
  conversationId: string
): void {
  if (deps.getActiveConversation()?.id !== conversationId) return

  deps.clearActiveConversation()
  deps.clearSessionId()
  deps.clearRunConfig()
  deps.navigateToList()
}
