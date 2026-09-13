type RemovalListener = (serverId: string) => (removed: boolean) => void
const listeners = new Set<RemovalListener>()

/** Renderer-local lifecycle bus; only explicit unpair publishes, never repair or connection loss. */
export function subscribeChatHistoryRemoval(listener: RemovalListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function beginChatHistoryRemoval(serverId: string): (removed: boolean) => void {
  const settlements = [...listeners].map(listener => listener(serverId))
  let settled = false
  return removed => {
    if (settled) return
    settled = true
    for (const settle of settlements) settle(removed)
  }
}
