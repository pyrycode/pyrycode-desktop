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
import { conversationTimelineStore } from './conversationTimelineStore'
import { conversationReadRouteStore } from './conversationReadRouteStore'
import { connectThreadLiveProjection } from './threadLiveProjection'
import { subscribeChatHistoryRemoval } from './chatHistoryRemoval'

const key = (host: string, chat: string) => JSON.stringify([host, chat])

/** App composition owns routing; persisted item provenance never grants network capability. */
export function createThreadRuntime(deps: {
  send: (command: RendererCommand) => void
  read: (request: ChatHistoryRequest) => Promise<ChatHistoryResult>
  log: (event: RendererDiagnosticEvent) => void
}) {
  const items = createThreadItemStore({ event: deps.log }), sends = createThreadSendStore(deps.log)
  const state = createStore<{
    routes: ReadonlyMap<string, boolean>; saved: ReadonlySet<string>
    queries: ReadonlyMap<string, ThreadQueryState>
    complete: ReadonlyMap<string, { epoch: string; version: number }>
    restoring: ReadonlySet<string>
  }>(() => ({ routes: new Map(), saved: new Set(), queries: new Map(), complete: new Map(), restoring: new Set() }))
  const links = new Set<string>(), lives = new Map<string, ReturnType<typeof createThreadLiveState>>()
  let disposed = false
  let selected: { host: string; chat: string; generation: symbol; cancel?: () => void } | undefined
  const isThread = (host: string | null, chat: string | null): boolean => host !== null && chat !== null &&
    (state.getState().routes.get(host) ?? state.getState().saved.has(key(host, chat)))
  const live = (host: string, chat: string) => {
    const id = key(host, chat), held = lives.get(id)
    if (held) return held
    const store = createThreadLiveState({ isConnected: h => links.has(h),
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
    query.input({ type: 'sync', serverId: host, conversationId: isThread(host, chat) ? chat : null,
      connected: links.has(host) && state.getState().routes.get(host) === true,
      restorePending: state.getState().restoring.has(key(host, chat)) })
  }
  async function restore(target: NonNullable<typeof selected>): Promise<void> {
    target.cancel?.()
    const generation = Symbol(), id = key(target.host, target.chat)
    target.generation = generation
    state.setState(s => ({ restoring: new Set(s.restoring).add(id) }))
    const authoritative = state.getState().routes.get(target.host) !== false
    const read = readSavedTimeline(authoritative
      ? { threads: items, read: deps.read, log: deps.log }
      : { timelines: conversationTimelineStore, read: deps.read, log: deps.log }, target.host, target.chat)
    target.cancel = read.cancel
    sync()
    await read.done
    if (disposed || selected !== target || target.generation !== generation) return
    if (authoritative && items.getState().snapshot(target.host, target.chat)) {
      state.setState(s => ({ saved: new Set(s.saved).add(id) }))
      const snapshot = items.getState().snapshot(target.host, target.chat)
      if (snapshot) conversationReadRouteStore.getState().select(target.host, target.chat, snapshot.epoch)
    } else if (state.getState().routes.get(target.host) === undefined) {
      const legacy = readSavedTimeline({ timelines: conversationTimelineStore, read: deps.read, log: deps.log }, target.host, target.chat)
      target.cancel = legacy.cancel
      await legacy.done
      if (disposed || selected !== target || target.generation !== generation) return
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
    links.delete(host); query.cancelHost(host)
    const prefix = '[' + JSON.stringify(host) + ','
    for (const [id, store] of lives) if (id.startsWith(prefix)) {
      store.getState().dispatch({ type: 'dispose' }); lives.delete(id)
    }
    items.getState().removeHost(host); sends.getState().removeHost(host)
    conversationReadRouteStore.setState(s => { const hosts = new Map(s.hosts); hosts.delete(host); return { hosts } })
    state.setState(s => {
      const routes = new Map(s.routes); routes.delete(host)
      return { routes, saved: new Set([...s.saved].filter(id => !id.startsWith(prefix))),
        restoring: new Set([...s.restoring].filter(id => !id.startsWith(prefix))),
        queries: new Map([...s.queries].filter(([id]) => !id.startsWith(prefix))),
        complete: new Map([...s.complete].filter(([id]) => !id.startsWith(prefix))) }
    })
  }
  const offRemoval = subscribeChatHistoryRemoval(host => removed => { if (removed) removeHost(host) })
  return {
    items, sends, state, live, isThread,
    submissionOwner(host: string, chat: string): () => boolean {
      const target = selected
      return () => selected === target && target?.host === host && target.chat === chat
    },
    acceptsSession(event: StampedDaemonEvent): boolean {
      const host = event.serverId
      if (threadLiveFamily(event) === null) return true
      if (selected && isThread(selected.host, selected.chat) && 'conversationId' in event && event.conversationId === selected.chat) return false
      if (host === null || state.getState().routes.get(host) !== true) return true
      // Current-session inputs are admitted by live state and projected from the selected host only.
      return false
    },
    summary(host: string, row: Pick<ConversationSummary, 'id' | 'current_session_id'>) {
      if (state.getState().routes.get(host)) live(host, row.id).getState().dispatch({ type: 'summary', serverId: host, summary: row })
    },
    open(host: string, chat: string) {
      selected?.cancel?.()
      if (selected) query.input({ type: 'sync', serverId: selected.host, conversationId: null, connected: links.has(selected.host) })
      const target: NonNullable<typeof selected> = { host, chat, generation: Symbol() }
      selected = target
      return { done: restore(target), cancel() {
        if (selected !== target) return
        target.cancel?.(); selected = undefined
        query.input({ type: 'sync', serverId: host, conversationId: null, connected: links.has(host) })
      } }
    },
    query: (type: 'older' | 'retry', serverId: string) => query.input({ type, serverId }),
    event(event: StampedDaemonEvent) {
      if (disposed || event.serverId === null) return
      const host = event.serverId
      if (event.type === 'connected') {
        const thread = event.ack.capabilities.includes('thread'), previous = state.getState().routes.get(host)
        links.add(host); query.cancelHost(host)
        state.setState(s => ({ routes: new Map(s.routes).set(host, thread) }))
        if (!thread) for (const chat of items.getState().hosts.get(host)?.keys() ?? []) conversationReadRouteStore.getState().select(host, chat, null)
        for (const store of lives.values()) store.getState().dispatch({ type: 'daemon', event })
        if (selected?.host === host && previous !== thread) void restore(selected) // Restore owns cancellation and never rejects.
        else sync()
        deps.log({ event: 'thread-route-selected', code: thread ? 'thread' : 'legacy' })
        return
      }
      if (event.type === 'connecting' || event.type === 'disconnected' || event.type === 'failed') {
        links.delete(host); query.cancelHost(host)
        return
      }
      if (event.type === 'conversationDeleted') { remove(host, event.id); return }
      if (state.getState().routes.get(host) !== true) return
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
    },
    suspend() {
      selected?.cancel?.(); selected = undefined
      for (const host of state.getState().routes.keys()) query.cancelHost(host)
      links.clear()
      for (const store of lives.values()) {
        const binding = store.getState().binding
        if (binding) store.getState().dispatch({ type: 'summary', serverId: binding.serverId, summary: null })
      }
    },
    dispose() {
      disposed = true; selected?.cancel?.(); selected = undefined; query.dispose(); offItems(); offRemoval()
      for (const [host, chats] of items.getState().hosts) for (const chat of chats.keys()) conversationReadRouteStore.getState().select(host, chat, null)
      for (const store of lives.values()) store.getState().dispatch({ type: 'dispose' })
      lives.clear(); links.clear(); items.getState().clearAll(); sends.getState().dispose()
    }
  }
}

export const threadRuntime = createThreadRuntime({ send: command => window.pyry.sendCommand(command),
  read: request => window.pyry.chatHistory(request), log: event => window.pyry.sendDiagnostic(event) })

/** Legacy content subscribers stay complete for old hosts and cannot project thread facts. */
export const onLegacyContentEvent: typeof window.pyry.onDaemonEvent = listener => window.pyry.onDaemonEvent(event => {
  if (event.serverId !== null && threadRuntime.state.getState().routes.get(event.serverId) === true) return
  listener(event)
})

export const onCurrentSessionEvent: typeof window.pyry.onDaemonEvent = listener => window.pyry.onDaemonEvent(event => {
  if (threadRuntime.acceptsSession(event)) listener(event)
})

const useRuntimeEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

export function useThreadRuntime(): void {
  useRuntimeEffect(() => {
    const off = window.pyry.onDaemonEvent(threadRuntime.event)
    const offProjection = connectThreadLiveProjection(threadRuntime)
    return () => { off(); offProjection(); threadRuntime.suspend() }
  }, [])
}
