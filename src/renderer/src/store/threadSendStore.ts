import { createStore } from 'zustand/vanilla'
import type { ThreadSnapshot } from './threadItemStore'
import type { LocalSendPending, ThreadEvent, ThreadItem } from './threadTimeline'

export interface PendingThreadSend {
  readonly key: number
  readonly deviceId: string | null
  readonly messageId: string
  readonly item: Extract<ThreadItem, { kind: 'userText' }>
  readonly delivery?: 'waiting' | 'not-sent'
}
type Scope = { pending: readonly PendingThreadSend[]; localSendPending: LocalSendPending | null;
  newest?: { deviceId: string | null; messageId: string; accepted?: { epoch: string; id: number } } }
const empty: Scope = { pending: [], localSendPending: null }
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A damaged enclosing record cannot establish identity or an action target. */
export function usableThreadField(source: Record<string, unknown>, path: string): unknown {
  let value: unknown = source
  const parts = path.split('.')
  for (const [index, key] of parts.entries()) {
    if (!record(value)) return undefined
    for (const marker of ['truncated_fields', 'dropped_fields']) {
      const fields = value[marker]
      if (fields == null) continue
      if (!Array.isArray(fields) || !fields.every(field => typeof field === 'string') ||
          fields.includes(key) || fields.includes(parts.slice(index).join('.'))) return undefined
    }
    value = value[key]
  }
  return value
}
function matches(source: ThreadSnapshot['items'][number], send: Scope['newest']): boolean {
  if (!send || !send.deviceId || !send.messageId || source.kind !== 'user_message') return false
  const device = usableThreadField(source, 'content.device_id'), message = usableThreadField(source, 'content.message_id')
  return typeof device === 'string' && device.length > 0 && device === send.deviceId &&
    typeof message === 'string' && message.length > 0 && message === send.messageId
}

/** Supplied-input only; #1908 owns authenticated identity, subscriptions and capability selection. */
export function createThreadSendStore(log?: (event: { event: string; code: string }) => void) {
  let disposed = false
  let nextKey = 0
  const observe = (code: string) => { try { log?.({ event: 'thread-send', code }) } catch { /* Observe only. */ } }
  return createStore<{
    revision: number
    select: (host: string, chat: string) => Scope
    retain: (host: string, chat: string, deviceId: string | null, event: Extract<ThreadEvent, { type: 'userText' }>) => void
    feedback: (host: string, chat: string, event: Extract<ThreadEvent, { type: 'messageDelivery' }>) => void
    settle: (snapshot: ThreadSnapshot) => void
    deleteConversation: (host: string, chat: string) => void
    removeHost: (host: string) => void
    dispose: () => void
  }>((set, get) => {
    const scopes = new Map<string, Map<string, Scope>>()
    const select = (host: string, chat: string): Scope => scopes.get(host)?.get(chat) ?? empty
    const publish = (host: string, chat: string, scope: Scope) => {
      const chats = scopes.get(host) ?? new Map<string, Scope>()
      chats.set(chat, scope); scopes.set(host, chats)
      set({ revision: get().revision + 1 })
    }
    const api = {
      revision: 0,
      select,
      retain(host: string, chat: string, deviceId: string | null, event: Extract<ThreadEvent, { type: 'userText' }>) {
        if (disposed || !event.messageId) return
        const messageId = event.messageId, before = select(host, chat)
        const item: PendingThreadSend['item'] = { kind: 'userText', text: event.text, createdAt: event.createdAt,
          attachments: event.attachments, messageId }
        publish(host, chat, { pending: [...before.pending, { key: nextKey++, deviceId, messageId, item }],
          newest: { deviceId, messageId }, localSendPending: { messageId, queued: false } })
        observe('pending')
      },
      feedback(host: string, chat: string, event: Extract<ThreadEvent, { type: 'messageDelivery' }>) {
        const before = select(host, chat)
        if (disposed || !before.pending.some(row => row.messageId === event.messageId)) return
        const delivery = event.status === 'written' ? undefined : event.status
        publish(host, chat, { ...before, pending: before.pending.map(row => row.messageId === event.messageId
          ? { ...row, delivery } : row), localSendPending: before.newest?.messageId === event.messageId
            ? event.status === 'not-sent' ? null : { messageId: event.messageId, queued: false } : before.localSendPending })
        observe(event.status)
      },
      settle(snapshot: ThreadSnapshot) {
        if (disposed) return
        const before = select(snapshot.hostId, snapshot.conversationId)
        const pending = before.pending.filter(send => !snapshot.items.some(item => matches(item, send)))
        const owned = before.newest?.accepted
        const accepted = owned?.epoch === snapshot.epoch
          ? snapshot.items.find(item => item.id === owned.id && item.kind === 'user_message')
          : snapshot.items.find(item => matches(item, before.newest))
        const localSendPending = accepted ? accepted.shown === true && accepted.active === true && accepted.status === 'queued'
          ? { messageId: before.newest?.messageId ?? '', queued: true } : null
          : owned && owned.epoch !== snapshot.epoch ? null : before.localSendPending
        const newest = accepted && before.newest ? { ...before.newest, accepted: { epoch: snapshot.epoch, id: accepted.id } } : before.newest
        if (pending.length === before.pending.length && localSendPending?.queued === before.localSendPending?.queued &&
            (localSendPending === null) === (before.localSendPending === null) &&
            newest?.accepted?.epoch === owned?.epoch && newest?.accepted?.id === owned?.id) return
        publish(snapshot.hostId, snapshot.conversationId, { ...before, pending, localSendPending, newest })
        observe(accepted?.status === 'queued' ? 'accepted-queued' : 'settled')
      },
      deleteConversation(host: string, chat: string) {
        if (!scopes.get(host)?.delete(chat)) return
        set({ revision: get().revision + 1 })
      },
      removeHost(host: string) {
        if (!scopes.delete(host)) return
        set({ revision: get().revision + 1 })
      },
      dispose() { disposed = true; scopes.clear(); set({ revision: get().revision + 1 }) }
    }
    return api
  })
}
