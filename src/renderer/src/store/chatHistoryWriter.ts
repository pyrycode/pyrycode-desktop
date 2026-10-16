import { useEffect } from 'react'
import { threadRuntime } from './threadRuntime'
import type { StoreApi } from 'zustand/vanilla'
import { parseChatHistorySnapshot, parseChatHistoryRequest, type ChatHistorySnapshot, type ChatHistoryRequest, type ChatHistoryResult } from '@shared/chatHistory'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { RendererDiagnosticEvent } from '@shared/ipc/diagnostics'
import { conversationListStore, type ConversationListStore } from './conversationListStore'
import { subscribeChatHistoryRemoval } from './chatHistoryRemoval'
import type { ThreadItemStore } from './threadItemStore'

type ConversationRemoval = Extract<ChatHistoryRequest, { operation: 'removeConversation' }>
type Snapshot = Extract<ChatHistorySnapshot, { kind: 'list' }>
type Mutation = Extract<ChatHistoryRequest, { operation: 'mutateThread' }>
type Receipt = { type: string; serverId: string | null | undefined }

/** Receipts are synchronous; snapshots and their supplying host are detached before scheduling. */
export function createChatHistoryWriter(deps: {
  threads: Pick<StoreApi<ThreadItemStore>, 'getState' | 'subscribe'>
  lists: Pick<StoreApi<ConversationListStore>, 'getState' | 'subscribe'>
  subscribeEvents?: (listener: (event: StampedDaemonEvent) => void) => () => void
  receipt: () => Receipt | null
  write: (request: ChatHistoryRequest) => Promise<ChatHistoryResult>
  log: (event: RendererDiagnosticEvent) => void
  schedule: (run: () => void) => () => void
}) {
  const pending = new Map<string, Snapshot | ConversationRemoval | Mutation>()
  const seen = new Map<string, string>()
  const saved = new Map<string, string>()
  const deleted = new Map<string, Set<string>>()
  const paused = new Map<string, number>()
  const generations = new Map<string, number>()
  const removals = new Set<Promise<void>>()
  let stopped = false
  let cancel: (() => void) | undefined
  let running: Promise<void> | undefined
  const report = (code: string) => deps.log({ event: 'history-writer-result', code })
  const keyFor = (s: Snapshot) => JSON.stringify([s.serverId, s.kind, null])
  const hasReady = () => [...pending.values()].some(snapshot => !paused.has(snapshot.serverId))
  function capture(value: Snapshot): void {
    const removed = deleted.get(value.serverId)
    if (value.kind === 'list' && removed !== undefined) {
      value = { ...value, conversations: value.conversations.filter(row => !removed.has(row.id)) }
    }
    let snapshot: ChatHistorySnapshot
    try { snapshot = parseChatHistorySnapshot(value) } catch { report('invalid-snapshot'); return }
    if (snapshot.kind !== 'list') return
    const key = keyFor(snapshot)
    const encoded = JSON.stringify(snapshot)
    if (seen.get(key) === encoded) return
    seen.set(key, encoded)
    pending.set(key, snapshot)
    if (cancel === undefined && running === undefined) cancel = deps.schedule(() => { void flush() })
  }

  function merge(previous: Mutation, next: Mutation): Mutation {
    if (previous.change.metadata.epoch !== next.change.metadata.epoch) return next
    const items = new Map(previous.change.items.map(item => [item.id, item]))
    const removeIds = new Set([...previous.change.removeIds, ...next.change.removeIds])
    for (const entry of next.change.items) {
      if ((items.get(entry.id)?.rev ?? -1) <= entry.rev) items.set(entry.id, entry)
      removeIds.delete(entry.id)
    }
    for (const id of next.change.removeIds) items.delete(id)
    const ranges: { start: number; end: number }[] = []
    for (const range of [...previous.change.ranges, ...next.change.ranges].sort((a, b) => a.start - b.start)) {
      const tail = ranges.at(-1)
      if (tail && range.start <= tail.end) tail.end = Math.max(tail.end, range.end)
      else ranges.push({ ...range })
    }
    return { ...next, change: { ...next.change, acceptEpoch: previous.change.acceptEpoch || next.change.acceptEpoch,
      priorProgress: [...previous.change.priorProgress ?? [],
        { metadata: previous.change.metadata, ...(previous.change.completion === undefined ? {} : { completion: previous.change.completion }) },
        ...next.change.priorProgress ?? []],
      items: [...items.values()], removeIds: [...removeIds], ranges } }
  }
  function captureChange(host: string, id: string, slice: ThreadItemStore['hosts'] extends ReadonlyMap<string, ReadonlyMap<string, infer S>> ? S : never): void {
    if (!slice.owned || deleted.get(host)?.has(id)) return
    let request: ChatHistoryRequest
    try { request = parseChatHistoryRequest({ operation: 'mutateThread', serverId: host, conversationId: id, change: slice.owned }) }
    catch { report('invalid-snapshot'); return }
    if (request.operation !== 'mutateThread') return
    const key = JSON.stringify([host, 'daemon-items', id]), prior = pending.get(key)
    const next = prior && 'operation' in prior && prior.operation === 'mutateThread' ? merge(prior, request) : request
    pending.set(key, next)
    if (cancel === undefined && running === undefined) cancel = deps.schedule(() => { void flush() })
  }

  async function drain(): Promise<void> {
    const failed = new Set<string>()
    while (pending.size > 0) {
      const next = [...pending].find(([key, snapshot]) => !failed.has(key) && !paused.has(snapshot.serverId))
      if (next === undefined) break
      const [key, snapshot] = next
      const generation = generations.get(snapshot.serverId)
      pending.delete(key)
      if ('operation' in snapshot && snapshot.operation === 'mutateThread') {
        let ok = false
        try {
          const result = await deps.write(snapshot)
          ok = result.status === 'ok'
          report(result.status === 'error' ? result.code : result.status)
        } catch { report('ipc-failed') }
        if (!ok && generation === generations.get(snapshot.serverId) && !deleted.get(snapshot.serverId)?.has(snapshot.conversationId)) {
          const newer = pending.get(key)
          pending.set(key, newer && 'operation' in newer && newer.operation === 'mutateThread' ? merge(snapshot, newer) : snapshot)
          failed.add(key)
        }
        continue
      }
      if ('operation' in snapshot) {
        try {
          const result = await deps.write(snapshot)
          report(result.status === 'ok' ? 'conversation-removed' : result.status === 'error' ? result.code : 'remove-failed')
        } catch { report('ipc-failed') }
        for (const comparisonKey of [JSON.stringify([snapshot.serverId, 'daemon-items', snapshot.conversationId]),
          JSON.stringify([snapshot.serverId, 'list', null])]) {
          seen.delete(comparisonKey)
          saved.delete(comparisonKey)
        }
        continue
      }
      const encoded = JSON.stringify(snapshot)
      const request: ChatHistoryRequest = { operation: 'replaceList', serverId: snapshot.serverId, snapshot }
      if (saved.get(key) !== encoded) {
        try {
          const result = await deps.write(request)
          if (result.status === 'ok' && generation === generations.get(snapshot.serverId)) saved.set(key, encoded)
          report(result.status === 'error' ? result.code : result.status)
        } catch { report('ipc-failed') }
      }
    }
  }
  function flush(): Promise<void> {
    cancel?.()
    cancel = undefined
    if (running === undefined) running = drain().finally(() => {
      running = undefined
    })
    return running
  }

  const offLists = deps.lists.subscribe((state, previous) => {
    const receipt = deps.receipt()
    if (receipt?.type !== 'conversationsReceived' || typeof receipt.serverId !== 'string') return
    const conversations = state.byServer.get(receipt.serverId)
    if (conversations === undefined || conversations === previous.byServer.get(receipt.serverId)) return
    capture({ version: 1, kind: 'list', serverId: receipt.serverId, conversations: [...conversations] })
  })
  const offThreads = deps.threads.subscribe((state, previous) => {
    for (const [host, conversations] of state.hosts) for (const [id, slice] of conversations) {
      if (slice.owned === previous.hosts.get(host)?.get(id)?.owned || slice.snapshot === slice.restored) continue
      captureChange(host, id, slice)
    }
  })
  const offEvents = deps.subscribeEvents?.(event => {
    if (stopped || event.type !== 'conversationDeleted') return
    const { serverId, id } = event
    if (typeof serverId !== 'string') { report('unknown-ownership'); return }
    const ids = deleted.get(serverId) ?? new Set<string>()
    ids.add(id)
    deleted.set(serverId, ids)
    const key = JSON.stringify([serverId, 'removeConversation', id])
    // Replace buffered item content with a removal in the same serial drain.
    pending.delete(JSON.stringify([serverId, 'daemon-items', id]))
    deps.threads.getState().deleteConversation(serverId, id)
    for (const snapshot of pending.values()) {
      if (!('operation' in snapshot) && snapshot.serverId === serverId && snapshot.kind === 'list') capture(snapshot)
    }
    pending.set(key, { operation: 'removeConversation', serverId, conversationId: id })
    if (cancel === undefined && running === undefined) cancel = deps.schedule(() => { void flush() })
  })
  const offRemoval = subscribeChatHistoryRemoval(serverId => {
    paused.set(serverId, (paused.get(serverId) ?? 0) + 1)
    let done = () => {}
    const settlement = new Promise<void>(resolve => { done = resolve })
    removals.add(settlement)
    return removed => {
      if (removed) {
        deleted.delete(serverId)
        generations.set(serverId, (generations.get(serverId) ?? 0) + 1)
        for (const [key, snapshot] of pending) if (snapshot.serverId === serverId) pending.delete(key)
        for (const key of seen.keys()) {
          // Keys are local tuple encodings, not storage paths or daemon-provided lookup paths.
          if (key.startsWith('[' + JSON.stringify(serverId) + ',')) {
            seen.delete(key)
            saved.delete(key)
          }
        }
        deps.threads.getState().removeHost(serverId)
        report('host-removed')
      }
      const remaining = (paused.get(serverId) ?? 1) - 1
      if (remaining === 0) paused.delete(serverId)
      else paused.set(serverId, remaining)
      removals.delete(settlement)
      done()
      if (!stopped && hasReady() && cancel === undefined && running === undefined) cancel = deps.schedule(() => { void flush() })
    }
  })
  deps.log({ event: 'history-writer-started' })
  return { flush, stop: () => {
    stopped = true
    offLists(); offThreads(); offRemoval(); offEvents?.()
    return Promise.all([...removals]).then(flush)
  } }
}

export function useChatHistoryWriter(): void {
  useEffect(() => {
    const writer = createChatHistoryWriter({ threads: threadRuntime.items, lists: conversationListStore,
      subscribeEvents: window.pyry.onDaemonEvent,
      receipt: window.pyry.chatHistoryReceipt, write: window.pyry.chatHistory, log: window.pyry.sendDiagnostic,
      schedule: (run) => { const timer = setTimeout(run, 200); return () => clearTimeout(timer) } })
    const off = window.pyry.onChatHistoryFlush(writer.stop)
    return () => { off(); void writer.stop() }
  }, [])
}
