import type { DaemonEvent } from '../../src/shared/ipc/events'

type Reading = Pick<Extract<DaemonEvent, { type: 'runConfigReceived' }>, 'conversationId' | 'sessionId' | 'permissionMode'> & { ackCount: number }
type Proof = { readings: Reading[]; acks: string[]; turns: string[];
  modals: { conversationId: string; read: boolean; allow: string | null }[];
  tools: { conversationId: string; read: boolean }[]; off: () => void }
type DriveWindow = typeof window & { permissionProof: Proof }


/** Same renderer observer for live and replay; reconnect history cannot add a completion. */
export function installPermissionModeEvidence(): void {
  const proof: Proof = { readings: [], acks: [], turns: [], modals: [], tools: [], off: () => {} }
  const completedItems = new Set<string>()
  proof.off = window.pyry.onDaemonEvent(event => {
    if (event.type === 'runConfigReceived') {
      const { conversationId, sessionId, permissionMode } = event
      proof.readings.push({ conversationId, sessionId, permissionMode, ackCount: proof.acks.length })
    }
    if (event.type === 'sessionSettingsUpdated') proof.acks.push(event.sessionId)
    if (event.type === 'turnEnd') proof.turns.push(event.conversationId!)
    const supplied = event.type === 'threadReply' && event.reply.type === 'thread_items' ? event.reply.payload.items
      : event.type === 'threadUpdate' && event.update.type === 'thread_item_added' ? [event.update.payload.item] : []
    for (const item of supplied) {
      if (item.kind === 'turn_end' && item.parent === undefined && 'conversationId' in event) {
        const epoch = event.type === 'threadReply' ? event.reply.payload.epoch
          : event.type === 'threadUpdate' ? event.update.payload.epoch : ''
        const identity = JSON.stringify([event.serverId, event.conversationId, epoch, item.id])
        if (!completedItems.has(identity)) { completedItems.add(identity); proof.turns.push(event.conversationId!) }
      }
      if (item.kind === 'tool_call' && item.content !== null && typeof item.content === 'object' &&
          !Array.isArray(item.content) && 'name' in item.content && 'conversationId' in event)
        proof.tools.push({ conversationId: event.conversationId!, read: item.content.name === 'Read' })
    }
    if (event.type === 'modalShown' && event.class === 'permission') proof.modals.push({
      // The daemon's title is "Permission required"; its prompt carries the tool name.
      conversationId: event.conversationId, read: event.prompt === 'Read',
      allow: event.options.find(option => option.id === 'allow_once')?.label ?? null
    })
    if (event.type === 'toolUse') proof.tools.push({ conversationId: event.conversationId, read: event.name === 'Read' })
  })
  ;(window as DriveWindow).permissionProof = proof
}
