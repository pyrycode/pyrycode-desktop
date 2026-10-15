import { useEffect, useLayoutEffect } from 'react'
import { createStore } from 'zustand/vanilla'
import type { ChatHistoryRequest, ChatHistoryResult } from '@shared/chatHistory'
import type { RendererCommand } from '@shared/ipc/commands'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { RendererDiagnosticEvent } from '@shared/ipc/diagnostics'
import type { ConversationSummary } from '@shared/wire/types'
import { createThreadItemStore } from './threadItemStore'
import { createThreadSendStore } from './threadSendStore'
import { createThreadLiveState, threadLiveFamily } from './threadLiveState'
import { createThreadQueryCoordinator, type ThreadQueryState } from './threadQueryCoordinator'
import { readSavedTimeline } from './savedTimelineRestorer'
import { conversationReadRouteStore } from './conversationReadRouteStore'
import { connectThreadLiveProjection } from './threadLiveProjection'
import { subscribeChatHistoryRemoval } from './chatHistoryRemoval'

const key = (host: string, chat: string) => JSON.stringify([host, chat])

/** Coalesces streamed text appends until the next animation frame (#1887 on the thread route). */
export interface ThreadFrameScheduler {
  request: (callback: () => void) => number
  cancel: (handle: number) => void
}

/**
 * App composition for the daemon-built thread, the only conversation route (#1908). Every paired host
 * is a thread host: one whose accepted handshake lacked `thread` never connects (main reports it as
 * update-required), so it is never linked and never queried. Persisted item provenance chooses offline
 * display only and never grants network capability.
 */
export function createThreadRuntime(deps: {
  send: (command: RendererCommand) => void
  read: (request: ChatHistoryRequest) => Promise<ChatHistoryResult>
  log: (event: RendererDiagnosticEvent) => void
  /** Absent keeps every event synchronous, which the factory tests rely on. */
  frame?: ThreadFrameScheduler
}) {
  const items = createThreadItemStore({ event: deps.log }), sends = createThreadSendStore(deps.log)
  const state = createStore<{
    /** Hosts whose current connection completed an accepted `thread` handshake. */
    linked: ReadonlySet<string>; saved: ReadonlySet<string>
    queries: ReadonlyMap<string, ThreadQueryState>
    complete: ReadonlyMap<string, { epoch: string; version: number }>
    restoring: ReadonlySet<string>
  }>(() => ({ linked: new Set(), saved: new Set(), queries: new Map(), complete: new Map(), restoring: new Set() }))
  const lives = new Map<string, ReturnType<typeof createThreadLiveState>>()
  const isLinked = (host: string): boolean => state.getState().linked.has(host)
  const setLinked = (host: string, linked: boolean): void => {
    if (isLinked(host) === linked) return
    state.setState(s => { const next = new Set(s.linked); if (linked) next.add(host); else next.delete(host); return { linked: next } })
  }
  let disposed = false
  let held: StampedDaemonEvent[] = [], frameHandle: number | undefined
  let selected: { host: string; chat: string; generation: symbol; cancel?: () => void } | undefined
  // There is no legacy route: any selected host and conversation draws through the item view.
  const isThread = (host: string | null, chat: string | null): boolean => host !== null && chat !== null
  const live = (host: string, chat: string) => {
    const id = key(host, chat), held = lives.get(id)
    if (held) return held
    const store = createThreadLiveState({ isConnected: isLinked,
      sendResponse: (serverId, command) => deps.send({ ...command, serverId }), log: { event: deps.log } })
    lives.set(id, store)
    return store
  }
  const query = createThreadQueryCoordinator({ store: items, sendCommand: deps.send,
    requestId: () => crypto.randomUUID(), log: { event: deps.log },
    onState(host, chat, value) {
      state.setState(s => ({ queries: new Map(s.queries).set(key(host, chat), value) }))
    },
    onComplete(host, chat, epoch, version) {
      state.setState(s => ({ complete: new Map(s.complete).set(key(host, chat), { epoch, version }) }))
    } })
  function sync(): void {
    if (!selected) return
    const { host, chat } = selected
    query.input({ type: 'sync', serverId: host, conversationId: chat, connected: isLinked(host),
      restorePending: state.getState().restoring.has(key(host, chat)) })
  }
  async function restore(target: NonNullable<typeof selected>): Promise<void> {
    target.cancel?.()
    const generation = Symbol(), id = key(target.host, target.chat)
    target.generation = generation
    state.setState(s => ({ restoring: new Set(s.restoring).add(id) }))
    // Only the protected authoritative format is read; a saved legacy timeline is never drawn.
    const read = readSavedTimeline({ threads: items, read: deps.read, log: deps.log }, target.host, target.chat)
    target.cancel = read.cancel
    sync()
    await read.done
    if (disposed || selected !== target || target.generation !== generation) return
    const snapshot = items.getState().snapshot(target.host, target.chat)
    if (snapshot) {
      state.setState(s => ({ saved: new Set(s.saved).add(id) }))
      conversationReadRouteStore.getState().select(target.host, target.chat, snapshot.epoch)
    }
    state.setState(s => { const restoring = new Set(s.restoring); restoring.delete(id); return { restoring } })
    sync()
  }
  const offItems = items.subscribe(() => {
    for (const [host, chats] of items.getState().hosts) for (const chat of chats.keys()) {
      const snapshot = items.getState().snapshot(host, chat)
      if (!snapshot || !isThread(host, chat)) continue
      sends.getState().settle(snapshot)
      if (conversationReadRouteStore.getState().epochFor(host, chat) !== snapshot.epoch)
        conversationReadRouteStore.getState().select(host, chat, snapshot.epoch)
    }
  })
  function remove(host: string, chat: string): void {
    if (selected?.host === host && selected.chat === chat) { selected.cancel?.(); selected = undefined; query.cancelHost(host) }
    items.getState().deleteConversation(host, chat); sends.getState().deleteConversation(host, chat)
    lives.get(key(host, chat))?.getState().dispatch({ type: 'dispose' }); lives.delete(key(host, chat))
    conversationReadRouteStore.getState().select(host, chat, null)
    state.setState(s => {
      const complete = new Map(s.complete), saved = new Set(s.saved), queries = new Map(s.queries), restoring = new Set(s.restoring)
      complete.delete(key(host, chat)); saved.delete(key(host, chat)); queries.delete(key(host, chat))
      restoring.delete(key(host, chat))
      return { complete, saved, queries, restoring }
    })
  }
  function removeHost(host: string): void {
    if (selected?.host === host) { selected.cancel?.(); selected = undefined }
    query.cancelHost(host)
    const prefix = '[' + JSON.stringify(host) + ','
    for (const [id, store] of lives) if (id.startsWith(prefix)) {
      store.getState().dispatch({ type: 'dispose' }); lives.delete(id)
    }
    items.getState().removeHost(host); sends.getState().removeHost(host)
    conversationReadRouteStore.setState(s => { const hosts = new Map(s.hosts); hosts.delete(host); return { hosts } })
    state.setState(s => {
      const linked = new Set(s.linked); linked.delete(host)
      return { linked, saved: new Set([...s.saved].filter(id => !id.startsWith(prefix))),
        restoring: new Set([...s.restoring].filter(id => !id.startsWith(prefix))),
        queries: new Map([...s.queries].filter(([id]) => !id.startsWith(prefix))),
        complete: new Map([...s.complete].filter(([id]) => !id.startsWith(prefix))) }
    })
  }
  const offRemoval = subscribeChatHistoryRemoval(host => removed => { if (removed) removeHost(host) })
  return {
    items, sends, state, live, isThread,
    acceptsLifecycle(event: StampedDaemonEvent): boolean {
      if (this.acceptsSession(event)) return true
      if (!selected || event.serverId !== selected.host) return false
      const binding = lives.get(key(selected.host, selected.chat))?.getState().binding
      // Each contextBridge listener receives its own clone; object identity cannot prove admission.
      if (!binding?.sessionId || event.envelopeSessionId !== binding.sessionId) return false
      return 'conversationId' in event ? event.conversationId === binding.conversationId
        : event.type === 'sessionSettingsUpdated' && event.sessionId === binding.sessionId
    },
    submissionOwner(host: string, chat: string): () => boolean {
      const target = selected
      return () => selected === target && target?.host === host && target.chat === chat
    },
    acceptsSession(event: StampedDaemonEvent): boolean {
      // Current-session inputs from a paired host are admitted by live state and projected from the
      // selected host only; an unattributed event has no host to bind and keeps its existing reader.
      return threadLiveFamily(event) === null || event.serverId === null
    },
    summary(host: string, row: Pick<ConversationSummary, 'id' | 'current_session_id'>) {
      if (isLinked(host)) live(host, row.id).getState().dispatch({ type: 'summary', serverId: host, summary: row })
    },
    open(host: string, chat: string) {
      selected?.cancel?.()
      if (selected) query.input({ type: 'sync', serverId: selected.host, conversationId: null, connected: isLinked(selected.host) })
      const target: NonNullable<typeof selected> = { host, chat, generation: Symbol() }
      selected = target
      return { done: restore(target), cancel() {
        if (selected !== target) return
        target.cancel?.(); selected = undefined
        query.input({ type: 'sync', serverId: host, conversationId: null, connected: isLinked(host) })
      } }
    },
    query: (type: 'older' | 'retry', serverId: string) => query.input({ type, serverId }),
    event(event: StampedDaemonEvent) {
      if (disposed || event.serverId === null) return
      if (deps.frame && event.type === 'threadUpdate' && event.update.type === 'thread_text_append') {
        // An uninterrupted append burst publishes on the next frame, in arrival order with its own
        // host and conversation; the first append schedules it and later ones never postpone it.
        held.push(event)
        if (frameHandle === undefined) frameHandle = deps.frame.request(() => { frameHandle = undefined; flush() })
        return
      }
      // Any other event is an ordering boundary: earlier appends apply first.
      flush()
      handle(event)
    },
    suspend() {
      flush()
      selected?.cancel?.(); selected = undefined
      for (const host of state.getState().linked) query.cancelHost(host)
      state.setState({ linked: new Set() })
      for (const store of lives.values()) {
        const binding = store.getState().binding
        if (binding) store.getState().dispatch({ type: 'summary', serverId: binding.serverId, summary: null })
      }
    },
    dispose() {
      disposed = true
      if (frameHandle !== undefined) deps.frame?.cancel(frameHandle)
      frameHandle = undefined; held = []
      selected?.cancel?.(); selected = undefined; query.dispose(); offItems(); offRemoval()
      for (const [host, chats] of items.getState().hosts) for (const chat of chats.keys()) conversationReadRouteStore.getState().select(host, chat, null)
      for (const store of lives.values()) store.getState().dispatch({ type: 'dispose' })
      lives.clear(); state.setState({ linked: new Set() }); items.getState().clearAll(); sends.getState().dispose()
    }
  }
  function flush(): void {
    if (frameHandle !== undefined) { deps.frame?.cancel(frameHandle); frameHandle = undefined }
    const batch = held
    held = []
    for (const event of batch) handle(event)
  }
  function handle(event: StampedDaemonEvent): void {
    if (disposed || event.serverId === null) return
    const host = event.serverId
    if (event.type === 'connected') {
      query.cancelHost(host)
      // Main reports a handshake without `thread` as update-required; a stray one links nothing.
      const thread = event.ack.capabilities.includes('thread')
      setLinked(host, thread)
      if (!thread) return
      for (const store of lives.values()) store.getState().dispatch({ type: 'daemon', event })
      sync()
      deps.log({ event: 'thread-route-selected', code: 'thread' })
      return
    }
    if (event.type === 'connecting' || event.type === 'disconnected' || event.type === 'failed') {
      setLinked(host, false); query.cancelHost(host)
      return
    }
    if (event.type === 'conversationDeleted') { remove(host, event.id); return }
    if (!isLinked(host)) return
    if (event.type === 'conversationsReceived') {
      for (const store of lives.values()) {
        const binding = store.getState().binding
        if (binding?.serverId === host && !event.conversations.some(row => row.id === binding.conversationId))
          store.getState().dispatch({ type: 'summary', serverId: host, summary: null })
      }
      for (const row of event.conversations) live(host, row.id).getState().dispatch({ type: 'summary', serverId: host, summary: row })
      return
    }
    if (event.type === 'threadReply' || event.type === 'threadUpdate' || event.type === 'threadQueryFailed' || event.type === 'threadRepairNeeded') {
      query.input({ type: 'daemon', event }); return
    }
    if (event.type === 'messageDelivery') sends.getState().feedback(host, event.conversationId, event)
    for (const store of lives.values()) store.getState().dispatch({ type: 'daemon', event })
  }
}
export const threadRuntime = createThreadRuntime({ send: command => window.pyry.sendCommand(command),
  read: request => window.pyry.chatHistory(request), log: event => window.pyry.sendDiagnostic(event),
  frame: { request: callback => window.requestAnimationFrame(callback), cancel: handle => window.cancelAnimationFrame(handle) } })

/**
 * The legacy content writers are unhooked from the production route (#1908): every paired host is a
 * thread host, so no host's events reach them. Deleting them is #2020.
 */
export const onLegacyContentEvent: typeof window.pyry.onDaemonEvent = listener => window.pyry.onDaemonEvent(event => {
  if (event.serverId === null) listener(event)
})

export const onCurrentSessionEvent: typeof window.pyry.onDaemonEvent = listener => window.pyry.onDaemonEvent(event => {
  if (threadRuntime.acceptsSession(event)) listener(event)
})

/** Lifecycle consumers may observe admitted thread facts without becoming metadata writers. */
export const onSessionLifecycleEvent: typeof window.pyry.onDaemonEvent = listener => window.pyry.onDaemonEvent(event => {
  if (threadRuntime.acceptsLifecycle(event)) listener(event)
})

const useRuntimeEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

export function useThreadRuntime(): void {
  useRuntimeEffect(() => {
    const off = window.pyry.onDaemonEvent(threadRuntime.event)
    const offProjection = connectThreadLiveProjection(threadRuntime)
    return () => { off(); offProjection(); threadRuntime.suspend() }
  }, [])
}
