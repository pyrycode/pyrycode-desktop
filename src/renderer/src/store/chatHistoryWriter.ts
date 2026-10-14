import { useEffect } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { parseChatHistorySnapshot, type ChatHistorySnapshot, type ChatHistoryRequest, type ChatHistoryResult } from '@shared/chatHistory'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { RendererDiagnosticEvent } from '@shared/ipc/diagnostics'
import { conversationListStore, type ConversationListStore } from './conversationListStore'
import { conversationTimelineStore, type ConversationTimelineStore } from './conversationTimelineStore'
import { subscribeChatHistoryRemoval } from './chatHistoryRemoval'
import type { ThreadItem } from './threadTimeline'
import type { ThreadItemStore } from './threadItemStore'

type ConversationRemoval = Extract<ChatHistoryRequest, { operation: 'removeConversation' }>
type TimelineSnapshot = Extract<ChatHistorySnapshot, { kind: 'timeline' }>
type Receipt = { type: string; serverId: string | null | undefined }

/** #1621: an offered file is live-only (the wire cannot resupply it), so it is never saved. */
function isDurable(item: ThreadItem): item is Exclude<ThreadItem, { kind: 'attachmentOffer' }> {
  return item.kind !== 'attachmentOffer'
}
type Observation = { owner: string | null; coverage: TimelineSnapshot['coverage'] }

/** Receipts are synchronous; snapshots and their supplying host are detached before scheduling. */
export function createChatHistoryWriter(deps: {
  threads?: Pick<StoreApi<ThreadItemStore>, 'getState' | 'subscribe'>
  lists: Pick<StoreApi<ConversationListStore>, 'getState' | 'subscribe'>
  timelines: Pick<StoreApi<ConversationTimelineStore>, 'getState' | 'subscribe'>
  subscribeTimelineWrites?: (listener: (state: ConversationTimelineStore, previous: ConversationTimelineStore,
    origin?: string | null) => void) => () => void
  flushTimeline?: () => void
  subscribeEvents?: (listener: (event: StampedDaemonEvent) => void) => () => void
  receipt: () => Receipt | null
  write: (request: ChatHistoryRequest) => Promise<ChatHistoryResult>
  log: (event: RendererDiagnosticEvent) => void
  schedule: (run: () => void) => () => void
}) {
  const pending = new Map<string, ChatHistorySnapshot | ConversationRemoval>()
  const seen = new Map<string, string>()
  const saved = new Map<string, string>()
  const observations = new Map<string, Observation>()
  const deleted = new Map<string, Set<string>>()
  const localEchoes = new WeakSet<object>()
  const paused = new Map<string, number>()
  const generations = new Map<string, number>()
  const removals = new Set<Promise<void>>()
  let stopped = false
  let cancel: (() => void) | undefined
  let running: Promise<void> | undefined
  const report = (code: string) => deps.log({ event: 'history-writer-result', code })
  const keyFor = (s: ChatHistorySnapshot) => JSON.stringify([s.serverId, s.kind,
    s.kind !== 'list' ? s.conversationId : null])
  const hasReady = () => [...pending.values()].some(snapshot => !paused.has(snapshot.serverId))
  function forgetComparison(id: string): void {
    const owner = observations.get(id)?.owner
    if (typeof owner !== 'string') return
    const key = JSON.stringify([owner, 'timeline', id])
    seen.delete(key)
    saved.delete(key)
  }

  function capture(value: ChatHistorySnapshot): void {
    const removed = deleted.get(value.serverId)
    if (value.kind !== 'list' && removed?.has(value.conversationId)) return
    if (value.kind === 'list' && removed !== undefined) {
      value = { ...value, conversations: value.conversations.filter(row => !removed.has(row.id)) }
    }
    let snapshot: ChatHistorySnapshot
    try { snapshot = parseChatHistorySnapshot(value) } catch { report('invalid-snapshot'); return }
    const key = keyFor(snapshot)
    const encoded = JSON.stringify(snapshot)
    if (seen.get(key) === encoded) return
    seen.set(key, encoded)
    pending.set(key, snapshot)
    if (cancel === undefined && running === undefined) cancel = deps.schedule(() => { void flush() })
  }

  async function drain(): Promise<void> {
    while (pending.size > 0) {
      const next = [...pending].find(([, snapshot]) => !paused.has(snapshot.serverId))
      if (next === undefined) break
      const [key, snapshot] = next
      const generation = generations.get(snapshot.serverId)
      pending.delete(key)
      if ('operation' in snapshot) {
        try {
          const result = await deps.write(snapshot)
          report(result.status === 'ok' ? 'conversation-removed' : result.status === 'error' ? result.code : 'remove-failed')
        } catch { report('ipc-failed') }
        for (const comparisonKey of [key, JSON.stringify([snapshot.serverId, 'list', null])]) {
          seen.delete(comparisonKey)
          saved.delete(comparisonKey)
        }
        continue
      }
      const encoded = JSON.stringify(snapshot)
      const request: ChatHistoryRequest = snapshot.kind === 'list'
        ? { operation: 'replaceList', serverId: snapshot.serverId, snapshot }
        : snapshot.kind === 'daemon-items'
          ? { operation: 'replaceThread', serverId: snapshot.serverId, conversationId: snapshot.conversationId, snapshot }
        : { operation: 'replaceTimeline', serverId: snapshot.serverId, conversationId: snapshot.conversationId, snapshot }
      if (saved.get(key) !== encoded) {
        try {
          const result = await deps.write(request)
          if (result.status === 'ok' && generation === generations.get(snapshot.serverId)) saved.set(key, encoded)
          report(result.status === 'error' ? result.code : result.status)
        } catch { report('ipc-failed') }
      }
      // Deduplication follows held state; evicted content survives only as long as its write needs it.
      if (generation === generations.get(snapshot.serverId) && snapshot.kind === 'timeline' &&
          observations.get(snapshot.conversationId)?.owner !== snapshot.serverId && !pending.has(key)) {
        seen.delete(key)
        saved.delete(key)
      }
    }
  }
  function flush(): Promise<void> {
    cancel?.()
    cancel = undefined
    if (running === undefined) running = drain().finally(() => {
      running = undefined
      if (hasReady()) return flush()
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
  const offTimelines = (deps.subscribeTimelineWrites ?? deps.timelines.subscribe)((state: ConversationTimelineStore,
    previous: ConversationTimelineStore, origin?: string | null) => {
    for (const id of previous.timelines.keys()) {
      if (!state.timelines.has(id)) {
        forgetComparison(id)
        observations.delete(id)
      }
    }
    for (const [id, slice] of state.timelines) {
      const before = previous.timelines.get(id)
      if (slice === before) continue
      if (slice.localRead === 'loading') {
        forgetComparison(id)
        observations.delete(id)
        continue
      }
      if (slice.restored !== undefined && slice.restored !== before?.restored && slice.localRead === 'loaded') {
        forgetComparison(id)
        observations.set(id, { owner: slice.restored.serverId, coverage: slice.restored.coverage })
        continue
      }
      const items = slice.timeline.items
      const previousItems = before?.timeline.items ?? []
      const changed = items !== previousItems
      // An explicit null is an accepted unstamped delivery, never a later receipt's authority.
      const receipt = origin === undefined ? deps.receipt() : { type: 'assistantDelta', serverId: origin }
      const tail = items[items.length - 1]
      const echo = receipt === null && slice.timeline.localSendPending !== null && tail?.kind === 'userText' &&
        tail.messageId !== undefined && items.length === previousItems.length + 1 &&
        previousItems.every((item, index) => item === items[index])
      // removeUserEcho removes one row; restored arrays cannot confer local echo identity.
      const droppedIndex = receipt === null && previousItems.length === items.length + 1
        ? previousItems.findIndex((item, index) => item !== items[index]) : -1
      const dropped = previousItems[droppedIndex]
      const droppedEcho = dropped?.kind === 'userText' && dropped.messageId !== undefined &&
        dropped.messageId !== '' && localEchoes.has(dropped) &&
        slice.history === before?.history && slice.prependedRows === before?.prependedRows &&
        items.every((item, index) => item === previousItems[index < droppedIndex ? index : index + 1])
      const evidenceOnly = receipt === null && !changed && observations.get(id)?.owner === slice.serverId &&
        typeof slice.serverId === 'string' && (slice.gaps !== before?.gaps || slice.newestCursor !== before?.newestCursor)
      if (receipt === null && !echo && !droppedEcho && !evidenceOnly) {
        // A direct restoration is not a receipt. Its existing rows have no observed supplying host.
        if (changed && items.length > 0) {
          forgetComparison(id)
          observations.set(id, { owner: null, coverage: { status: 'unknown' } })
        }
        continue
      }
      if (!changed && slice.history === before?.history && slice.served === before?.served && slice.display === before?.display && slice.gaps === before?.gaps && slice.newestCursor === before?.newestCursor) continue
      if (items.length === 0 && slice.history?.status !== 'loaded' && !droppedEcho && !evidenceOnly) continue
      const claims = [...deps.lists.getState().byServer].filter(([, rows]) => rows.some((row) => row.id === id))
      // receivedSlice clears rows and coverage only when replacing an explicitly stamped host.
      // Stamping previously unowned content retains it and cannot release an unknown observation.
      const replacedHost = receipt !== null && typeof receipt.serverId === 'string' &&
        before?.serverId !== undefined && before.serverId !== receipt.serverId && slice.serverId === receipt.serverId
      if (replacedHost) {
        forgetComparison(id)
        observations.delete(id)
      }
      const held = observations.get(id)
      const supplied = receipt === null
        ? ((droppedEcho || evidenceOnly) ? held?.owner : claims.length === 1 ? claims[0][0] : null) : receipt.serverId
      const owner = typeof supplied === 'string' &&
        (receipt !== null || claims.every(([host]) => host === supplied)) &&
        (held === undefined ? previousItems.length === 0 || replacedHost : held.owner === supplied) ? supplied : null
      if (owner === null) forgetComparison(id)
      const coverage: TimelineSnapshot['coverage'] = slice.history?.status === 'loaded'
        ? slice.coverage ?? { status: 'received', cursor: slice.history.cursor, atStart: slice.history.atStart }
        : held?.coverage ?? { status: 'unknown' }
      observations.set(id, { owner, coverage })
      if (owner === null) { report('unknown-ownership'); continue }
      if (echo) localEchoes.add(tail)
      const durableKeys = new Set((slice.timeline.rowKeys ?? []).filter((_, index) => isDurable(items[index])))
      capture({ version: 1, kind: 'timeline', serverId: owner, conversationId: id,
        items: items.filter(isDurable), prependedRows: slice.prependedRows, coverage,
        served: slice.served, gaps: slice.gaps, newestCursor: slice.newestCursor,
        display: slice.display?.filter(d => d.rowKey === undefined || durableKeys.has(d.rowKey)),
        rowIdentity: {
          rowKeys: (slice.timeline.rowKeys ?? items.map((_, index) => index - slice.prependedRows))
            .filter((_, index) => isDurable(items[index])),
          nextRowKey: slice.timeline.nextRowKey ?? items.length - slice.prependedRows
        } })
    }
  })
  const offThreads = deps.threads?.subscribe((state, previous) => {
    for (const [host, conversations] of previous.hosts) {
      for (const id of conversations.keys()) if (!state.hosts.get(host)?.has(id)) {
        const key = JSON.stringify([host, 'daemon-items', id])
        pending.delete(key); seen.delete(key); saved.delete(key)
      }
    }
    for (const [host, conversations] of state.hosts) for (const [id, slice] of conversations) {
      if (slice.snapshot === previous.hosts.get(host)?.get(id)?.snapshot || slice.snapshot === slice.restored) continue
      capture({ version: 1, kind: 'daemon-items', serverId: host, conversationId: id, thread: slice.snapshot })
    }
  })
  const offEvents = deps.subscribeEvents?.(event => {
    if (stopped || event.type !== 'conversationDeleted') return
    const { serverId, id } = event
    if (typeof serverId !== 'string') { report('unknown-ownership'); return }
    const ids = deleted.get(serverId) ?? new Set<string>()
    ids.add(id)
    deleted.set(serverId, ids)
    const key = JSON.stringify([serverId, 'timeline', id])
    // Replace buffered timeline content with a removal in the same serial drain.
    pending.delete(key)
    pending.delete(JSON.stringify([serverId, 'daemon-items', id]))
    deps.threads?.getState().deleteConversation(serverId, id)
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
        // The latest list can omit retained timelines. Drop actual host-owned slices so
        // a new receipt after re-pair cannot inherit erased rows or unknown ownership.
        for (const [id, slice] of deps.timelines.getState().timelines) {
          if (slice.serverId === serverId) {
            deps.timelines.getState().clearTimelineFor(id)
            observations.delete(id)
          }
        }
        for (const [id, observation] of observations) {
          if (observation.owner === serverId) observations.set(id, { owner: null, coverage: { status: 'unknown' } })
        }
        deps.threads?.getState().removeHost(serverId)
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
    // Window close can precede the next frame; capture accepted deliveries before detaching.
    if (!stopped) deps.flushTimeline?.()
    stopped = true
    offLists(); offTimelines(); offThreads?.(); offRemoval(); offEvents?.()
    return Promise.all([...removals]).then(flush)
  } }
}

export function useChatHistoryWriter(): void {
  useEffect(() => {
    const writer = createChatHistoryWriter({ lists: conversationListStore, timelines: conversationTimelineStore,
      subscribeTimelineWrites: conversationTimelineStore.subscribeTimelineWrites,
      flushTimeline: conversationTimelineStore.flushTimeline,
      subscribeEvents: window.pyry.onDaemonEvent,
      receipt: window.pyry.chatHistoryReceipt, write: window.pyry.chatHistory, log: window.pyry.sendDiagnostic,
      schedule: (run) => { const timer = setTimeout(run, 200); return () => clearTimeout(timer) } })
    const off = window.pyry.onChatHistoryFlush(writer.stop)
    return () => { off(); void writer.stop() }
  }, [])
}
