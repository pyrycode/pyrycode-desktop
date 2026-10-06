import { isComposerMessageId } from '../shared/ipc/diagnostics'
import type { DiagnosticLog } from './diagnosticLog'
import type { SendOutcome, SendDropReason } from './transport/sendObservation'

type DropReason = SendDropReason | 'bridge-failed' | 'route-refused' | 'user-cancel-request'
export interface MessageLifecycle {
  queued(id: string, conversation: string): void
  sending(id: string, conversation: string, host: string | null): ((outcome: SendOutcome) => void) | undefined
  acknowledge(host: string | null, conversation: string, ids: readonly (string | undefined)[]): void
  drop(id: string, conversation: string, reason: DropReason): void
  cancel(id: string, conversation: string): void
}

/** Bounded diagnostic memory, independent of delivery and daemon queue ownership. */
export function createMessageLifecycle(log: DiagnosticLog): MessageLifecycle {
  const held = new Map<string, {
    id: string
    conversation: string
    host?: string | null
    sent: boolean
    acknowledged: boolean
    dropped: boolean
    cancelled: boolean
  }>()
  function record(event: string, id: string, code?: DropReason, connectionId?: string): void {
    try {
      log.event({ event, messageId: id, code, connectionId })
    } catch {
      // Observe only: even an injected logger failure must not change delivery.
    }
  }
  function drop(id: string, conversation: string, reason: DropReason): void {
    const item = held.get(id)
    if (!item || item.conversation !== conversation || item.dropped) return
    item.dropped = true
    record('message-dropped', item.id, reason)
  }
  return {
    queued(id, conversation) {
      if (!isComposerMessageId(id) || held.has(id)) return
      if (held.size >= 1024) {
        const oldest = held.keys().next()
        if (!oldest.done) held.delete(oldest.value) // Retirement is not a delivery claim.
      }
      held.set(id, { id, conversation, sent: false, acknowledged: false, dropped: false, cancelled: false })
      record('message-queued', id)
    },
    sending(id, conversation, host) {
      const item = held.get(id)
      if (!item || item.conversation !== conversation || item.dropped || item.host !== undefined) return undefined
      item.host = host
      return outcome => {
        if (held.get(id) !== item || item.dropped) return
        if (outcome.type === 'dropped') {
          drop(id, conversation, outcome.reason)
          return
        }
        if (item.sent) return
        item.sent = true
        record('message-sent', item.id, undefined, outcome.connectionId)
      }
    },
    acknowledge(host, conversation, ids) {
      for (const id of ids) {
        if (id === undefined || id === '') continue
        const item = held.get(id)
        if (!item || item.host === undefined || item.host !== host || item.conversation !== conversation || item.dropped || item.acknowledged) continue
        item.acknowledged = true
        record('message-acknowledged', item.id)
      }
    },
    drop,
    cancel(id, conversation) {
      const item = held.get(id)
      if (!item || item.conversation !== conversation || item.cancelled || item.dropped) return
      item.cancelled = true
      record('message-dropped', item.id, 'user-cancel-request')
    }
  }
}
