import type { SessionAction } from './store/sessionStore'
import type { ModalEvent } from './store/modalPrompts'

export interface ClearPairingScopedStateDeps {
  clearActiveConversation: () => void
  clearSessionId: () => void
  clearAnnouncedModel: () => void
  clearSessionFacts: () => void
  clearMcpStatus: () => void
  clearAllSlashCommandLists: () => void
  clearAllModelLists: () => void
  clearAllConversations: () => void
  dispatchModal: (event: ModalEvent) => void
  clearAllActivity: () => void
  clearAllUsageLimits: () => void
  clearAllReportedContext: () => void
  dispatchSession: (action: SessionAction) => void
}

/** Clear pairing-scoped live and configuration state. */
export function clearPairingScopedState(deps: ClearPairingScopedStateDeps): void {
  deps.clearActiveConversation()
  deps.clearSessionId()
  deps.clearAnnouncedModel()
  deps.clearSessionFacts()
  deps.clearMcpStatus()
  deps.clearAllSlashCommandLists()
  deps.clearAllModelLists()
  deps.clearAllConversations()
  deps.dispatchModal({ type: 'reset' })
  deps.clearAllActivity()
  deps.clearAllUsageLimits()
  deps.clearAllReportedContext()
  deps.dispatchSession({ type: 'reset' })
}
