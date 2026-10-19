import { useReadPublication } from './conversationReadPublisher'

/** Publish authoritative committed-visible-content read evidence while the shell is mounted. */
export function useConversationLastRead(): void {
  useReadPublication()
}
