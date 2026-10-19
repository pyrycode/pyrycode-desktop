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
type QueuedMutation = { serverId: string; head: MutationNode; tail: MutationNode }
type MutationNode = { request: Mutation; steps: Generator<Mutation>; ready?: IteratorResult<Mutation>; next?: MutationNode }
type Receipt = { type: string; serverId: string | null | undefined }

// The final progress observation counts too. Every submitted request is independently valid.
function* mutationSteps(request: Mutation): Generator<Mutation> {
  const c = request.change, prior = c.priorProgress ?? []
  if (c.items.length + c.removeIds.length + c.ranges.length + prior.length + 1 <= 32) {
    yield request
    return
  }
  const neutral = { hostId: c.metadata.hostId, conversationId: c.metadata.conversationId,
    epoch: c.metadata.epoch, version: c.metadata.version, checkpoint: 0, uncommittedVersion: 0, repair: null }
  const base = { acceptEpoch: c.acceptEpoch, ...(c.resetId === undefined ? {} : { resetId: c.resetId }),
    metadata: neutral, items: [], removeIds: [], ranges: [] }
  for (let i = 0; i < c.removeIds.length; i += 31)
    yield { ...request, change: { ...base, removeIds: c.removeIds.slice(i, i + 31) } }
  for (let i = 0; i < c.items.length; i += 31)
    yield { ...request, change: { ...base, items: c.items.slice(i, i + 31) } }
  for (let i = 0; i < c.ranges.length; i += 31)
    yield { ...request, change: { ...base, ranges: c.ranges.slice(i, i + 31) } }
  for (let i = 0; i < prior.length; i += 32) {
    const observations = prior.slice(i, i + 32), last = observations.pop()
    if (last) yield { ...request, change: { ...base, ...last, priorProgress: observations } }
  }
  yield { ...request, change: { ...base, metadata: c.metadata,
    ...(c.completion === undefined ? {} : { completion: c.completion }),
    ...(c.availability === undefined ? {} : { availability: c.availability }) } }
}

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
  const pending = new Map<string, Snapshot | ConversationRemoval | QueuedMutation>()
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

  function captureChange(host: string, id: string, slice: ThreadItemStore['hosts'] extends ReadonlyMap<string, ReadonlyMap<string, infer S>> ? S : never): void {
    if (!slice.owned || deleted.get(host)?.has(id)) return
    // Owned changes are immutable detached store values. Validation is bounded at submission.
    const request: Mutation = { operation: 'mutateThread', serverId: host, conversationId: id, change: slice.owned }
    const node: MutationNode = { request, steps: mutationSteps(request) }
    const key = JSON.stringify([host, 'daemon-items', id]), prior = pending.get(key)
    if (prior && 'head' in prior && prior.tail.request.change.metadata.epoch === request.change.metadata.epoch &&
      (request.change.resetId === undefined || prior.tail.request.change.resetId === request.change.resetId)) {
      prior.tail.next = node
      prior.tail = node
    } else pending.set(key, { serverId: host, head: node, tail: node })
    if (cancel === undefined && running === undefined) cancel = deps.schedule(() => { void flush() })
  }

  async function drain(): Promise<void> {
    const failed = new Set<string>()
    while (pending.size > 0) {
      const next = Array.from(pending).find(([key, snapshot]) => !failed.has(key) && !paused.has(snapshot.serverId))
      if (next === undefined) break
      const [key, snapshot] = next
      const generation = generations.get(snapshot.serverId)
      if ('head' in snapshot) {
        const node = snapshot.head
        node.ready ??= node.steps.next()
        if (node.ready.done) {
          if (node.next) snapshot.head = node.next
          else pending.delete(key)
          continue
        }
        let ok = false
        let request: ChatHistoryRequest
        try { request = parseChatHistoryRequest(node.ready.value) }
        catch { report('invalid-snapshot'); failed.add(key); continue }
        try {
          const result = await deps.write(request)
          ok = result.status === 'ok'
          report(result.status === 'error' ? result.code : result.status)
        } catch { report('ipc-failed') }
        if (pending.get(key) === snapshot && generation === generations.get(snapshot.serverId)) {
          if (ok) node.ready = undefined
        }
        if (!ok) failed.add(key)
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        continue
      }
      pending.delete(key)
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
      if ('kind' in snapshot && snapshot.serverId === serverId && snapshot.kind === 'list') capture(snapshot)
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
