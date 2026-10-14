import type { RendererDiagnosticEvent } from '@shared/ipc/diagnostics'
import { exitActiveConversation, type ExitActiveConversationDeps } from './exitActiveConversation'

export interface ConfirmConversationDeletedDeps extends ExitActiveConversationDeps {
  /** Flush accepted frame folds before reading the retained slice's explicit owner. */
  getTimelineServerId: (conversationId: string) => string | undefined
  log: (event: RendererDiagnosticEvent) => void
}

/** A confirmed removal invalidates its owned view independently of which chat is on screen. */
export function confirmConversationDeleted(
  deps: ConfirmConversationDeletedDeps,
  conversationId: string,
  serverId: string | null | undefined
): void {
  if (typeof serverId !== 'string') {
    deps.log({ event: 'conversation-deletion', code: 'unattributed' })
    return
  }
  if (deps.getTimelineServerId(conversationId) !== serverId) {
    deps.log({ event: 'conversation-deletion', code: 'unowned' })
    return
  }
  if (deps.getActiveConversation()?.id === conversationId) {
    exitActiveConversation(deps, conversationId)
    deps.log({ event: 'conversation-deletion', code: 'active-cleared' })
  } else {
    deps.clearTimelineFor(conversationId)
    deps.log({ event: 'conversation-deletion', code: 'inactive-cleared' })
  }
}
