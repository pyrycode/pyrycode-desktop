import { useEffect, useLayoutEffect } from 'react'
import { createStore } from 'zustand/vanilla'
import type { ChatHistoryRequest, ChatHistoryResult } from '@shared/chatHistory'
import type { RendererCommand } from '@shared/ipc/commands'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { RendererDiagnosticEvent } from '@shared/ipc/diagnostics'
import type { ConversationSummary } from '@shared/wire/types'
import { createThreadItemStore } from './threadItemStore'
import { createThreadSendStore } from './threadSendStore'
import { createThreadLiveState, selectThreadReadings, threadLiveFamily } from './threadLiveState'
import { createThreadQueryCoordinator, type ThreadQueryState } from './threadQueryCoordinator'
import { readSavedTimeline } from './savedTimelineRestorer'
import { conversationReadRouteStore } from './conversationReadRouteStore'
import { connectThreadLiveProjection } from './threadLiveProjection'
import { subscribeChatHistoryRemoval } from './chatHistoryRemoval'
import { replySuggestionStore } from './replySuggestionStore'
import { createThreadTaskStops } from '../screens/conversation/threadTaskPresentation'
import { createThreadRefusalActions, threadComposerReports } from '../screens/conversation/threadComposerReports'

const key = (host: string, chat: string) => JSON.stringify([host, chat])
const MAX_DRAIN = 128
const conversationOf = (event: StampedDaemonEvent): string | undefined => event.type === 'conversationDeleted'
  ? event.id : 'conversationId' in event ? event.conversationId : event.envelopeConversationId ?? undefined

/** Frame opportunity, raced against a timer so a hidden window still makes progress. */
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
  const refusals = createThreadRefusalActions(), taskStops = createThreadTaskStops()
  const state = createStore<{
    /** Hosts whose current connection completed an accepted `thread` handshake. */
    liveRevision: number; linked: ReadonlySet<string>; saved: ReadonlySet<string>
    queries: ReadonlyMap<string, ThreadQueryState>
    localQueries: ReadonlyMap<string, ThreadQueryState>
    complete: ReadonlyMap<string, { epoch: string; version: number }>
    restoring: ReadonlySet<string>
  }>(() => ({ liveRevision: 0, linked: new Set(), saved: new Set(), queries: new Map(), localQueries: new Map(), complete: new Map(), restoring: new Set() }))
  const lives = new Map<string, ReturnType<typeof createThreadLiveState>>()
  const isLinked = (host: string): boolean => state.getState().linked.has(host)
  const setLinked = (host: string, linked: boolean): void => {
    if (isLinked(host) === linked) return
    state.setState(s => { const next = new Set(s.linked); if (linked) next.add(host); else next.delete(host); return { linked: next } })
  }
  let disposed = false
  const owners = new Map<string, { generation?: symbol }>()
  const listeners = new Set<(event: StampedDaemonEvent) => void>()
  const emit = (event: StampedDaemonEvent) => { for (const listener of listeners) listener(event) }
  let held: { event: StampedDaemonEvent; owner?: { generation?: symbol } }[] = [], frameHandle: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined, scheduled: symbol | undefined
  let selected: { host: string; chat: string; generation: symbol; cancel?: () => void; configurationRefreshSession?: string;
    local?: { generation: symbol; cancel: () => void } } | undefined
  function localState(host: string, chat: string, value: ThreadQueryState): void {
    state.setState(s => ({ localQueries: new Map(s.localQueries).set(key(host, chat), value) }))
  }
  function cancelLocal(): void {
    if (!selected) return
    selected.local?.cancel(); selected.local = undefined
    localState(selected.host, selected.chat, { type: 'idle' })
  }
  function demandLocal(type: 'older' | 'retry', host: string): boolean {
    const target = selected
    if (disposed || !target || target.host !== host) return false
    const slice = items.getState().hosts.get(host)?.get(target.chat)
    const status = state.getState().localQueries.get(key(host, target.chat))
    if (target.local || state.getState().restoring.has(key(host, target.chat))) return false
    if (type === 'retry' && status?.type !== 'failed') { query.input({ type, serverId: host }); return isLinked(host) }
    if (status?.type === 'failed' && type !== 'retry') return false
    if (!slice?.residency || slice.residency.traversal === null) { query.input({ type, serverId: host }); return isLinked(host) }
    const continuation = slice.residency.traversal
    const read = readSavedTimeline({ threads: items, read: deps.read, log: deps.log }, host, target.chat,
      continuation === undefined ? { operation: 'newestThreadPage' } : { operation: 'beforeThreadPage', continuation,
        ...(slice.residency.recovery === undefined ? {} : { recovery: slice.residency.recovery }) })
    const job = { generation: slice.generation, cancel: read.cancel }
    target.local = job; localState(host, target.chat, { type: 'loading', purpose: 'older' })
    // Selection and store lifecycle jointly own both admission and failure presentation.
    void read.done.then(code => {
      if (disposed || selected !== target || target.local !== job ||
        items.getState().hosts.get(host)?.get(target.chat)?.generation !== job.generation) return
      target.local = undefined
      localState(host, target.chat, code === 'stored' || code === undefined ? { type: 'idle' }
        : { type: 'failed', purpose: 'older', reason: code, retryable: true })
    })
    return true
  }
  // There is no legacy route: any selected host and conversation draws through the item view.
  const isThread = (host: string | null, chat: string | null): boolean => host !== null && chat !== null
  const live = (host: string, chat: string) => {
    const id = key(host, chat), held = lives.get(id)
    if (held) return held
    const store = createThreadLiveState({ isConnected: isLinked,
      sendResponse: (serverId, command) => deps.send({ ...command, serverId }), log: { event: deps.log } })
    store.subscribe((next, previous) => {
      state.setState(s => ({ liveRevision: s.liveRevision + 1 }))
      if (next.binding?.sessionId !== previous.binding?.sessionId) {
        const transition: StampedDaemonEvent = { type: 'sessionTransition', serverId: host, conversationId: chat,
          newSessionId: next.binding?.sessionId ?? '', reason: 'clear', workspaceCwd: null, occurredAt: '' }
        replySuggestionStore.getState().receive(transition)
      }
      for (const type of ['replySuggestion', 'turnState'] as const) {
        const reading = selectThreadReadings(next, type)[0]
        if (reading && reading !== selectThreadReadings(previous, type)[0]) replySuggestionStore.getState().receive(reading)
      }
    })
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
  const offItems = items.subscribe((next, previous) => {
    if (selected?.local && items.getState().hosts.get(selected.host)?.get(selected.chat)?.generation !== selected.local.generation)
      cancelLocal()
    for (const [host, chats] of next.hosts) for (const chat of chats.keys()) {
      if (chats.get(chat) === previous.hosts.get(host)?.get(chat)) continue
      const snapshot = items.getState().snapshot(host, chat)
      if (!snapshot || !isThread(host, chat)) continue
      sends.getState().settle(snapshot); taskStops.getState().settle(snapshot)
      observeReports(host, chat)
      if (conversationReadRouteStore.getState().epochFor(host, chat) !== snapshot.epoch)
        conversationReadRouteStore.getState().select(host, chat, snapshot.epoch)
    }
  })
  function observeReports(host: string, chat: string): void {
    const snapshot = items.getState().snapshot(host, chat)
    const session = lives.get(key(host, chat))?.getState().binding?.sessionId ?? null
    const offer = snapshot && threadComposerReports(snapshot, session).refusal
    if (offer) refusals.getState().observe(offer)
  }
  function remove(host: string, chat: string): void {
    retire(host, chat)
    if (selected?.host === host && selected.chat === chat) { cancelLocal(); selected.cancel?.(); selected = undefined; query.cancelHost(host) }
    items.getState().deleteConversation(host, chat); sends.getState().deleteConversation(host, chat); refusals.getState().remove(host, chat); taskStops.getState().remove(host, chat)
    lives.get(key(host, chat))?.getState().dispatch({ type: 'dispose' }); lives.delete(key(host, chat))
    conversationReadRouteStore.getState().select(host, chat, null)
    state.setState(s => {
      const complete = new Map(s.complete), saved = new Set(s.saved), queries = new Map(s.queries), restoring = new Set(s.restoring), localQueries = new Map(s.localQueries)
      complete.delete(key(host, chat)); saved.delete(key(host, chat)); queries.delete(key(host, chat))
      restoring.delete(key(host, chat))
      localQueries.delete(key(host, chat))
      return { complete, saved, queries, restoring, localQueries }
    })
  }
  function removeHost(host: string): void {
    retire(host)
    if (selected?.host === host) { cancelLocal(); selected.cancel?.(); selected = undefined }
    query.cancelHost(host)
    const prefix = '[' + JSON.stringify(host) + ','
    for (const [id, store] of lives) if (id.startsWith(prefix)) {
      store.getState().dispatch({ type: 'dispose' }); lives.delete(id)
    }
    items.getState().removeHost(host); sends.getState().removeHost(host); refusals.getState().remove(host); taskStops.getState().remove(host)
    conversationReadRouteStore.setState(s => { const hosts = new Map(s.hosts); hosts.delete(host); return { hosts } })
    state.setState(s => {
      const linked = new Set(s.linked); linked.delete(host)
      return { linked, saved: new Set([...s.saved].filter(id => !id.startsWith(prefix))),
        restoring: new Set([...s.restoring].filter(id => !id.startsWith(prefix))),
        queries: new Map([...s.queries].filter(([id]) => !id.startsWith(prefix))),
        localQueries: new Map([...s.localQueries].filter(([id]) => !id.startsWith(prefix))),
        complete: new Map([...s.complete].filter(([id]) => !id.startsWith(prefix))) }
    })
  }
  const offRemoval = subscribeChatHistoryRemoval(host => removed => { if (removed) removeHost(host) })
  return {
    items, sends, refusals, taskStops, state, live, isThread,
    subscribe(listener: (event: StampedDaemonEvent) => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    acceptsLifecycle(event: StampedDaemonEvent): boolean {
      if (this.acceptsSession(event)) return true
      if (!selected || event.serverId !== selected.host) return false
      const binding = lives.get(key(selected.host, selected.chat))?.getState().binding
      // Each contextBridge listener receives its own clone; object identity cannot prove admission.
      if (binding && event.envelopeConversationId !== undefined) return event.envelopeConversationId === binding.conversationId &&
        (!('conversationId' in event) || event.conversationId === binding.conversationId)
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
      observeReports(host, row.id)
    },
    open(host: string, chat: string) {
      if (selected) retire(selected.host, selected.chat)
      cancelLocal()
      selected?.cancel?.()
      if (selected) query.input({ type: 'sync', serverId: selected.host, conversationId: null, connected: isLinked(selected.host) })
      const target: NonNullable<typeof selected> = { host, chat, generation: Symbol() }
      selected = target
      return { done: restore(target), cancel() {
        if (selected !== target) return
        retire(host, chat)
        cancelLocal()
        target.cancel?.(); selected = undefined
        query.input({ type: 'sync', serverId: host, conversationId: null, connected: isLinked(host) })
      } }
    },
    query: demandLocal,
    event(event: StampedDaemonEvent) {
      if (disposed || event.serverId === null) return
      if (deps.frame && (event.type === 'threadUpdate' || held.length > 0)) {
        // Keep received attribution and FIFO ordering, including control boundaries. Receipt never
        // drains synchronously: each scheduled task has a finite application budget.
        let owner: { generation?: symbol } | undefined
        const chat = conversationOf(event)
        if (chat !== undefined) {
          const id = key(event.serverId, chat)
          const generation = items.getState().hosts.get(event.serverId)?.get(chat)?.generation
          owner = owners.get(id)
          if (!owner || (owner.generation !== undefined && owner.generation !== generation) ||
              event.type === 'threadReply' && event.reply.type === 'thread_reset') {
            owner = { generation }; owners.set(id, owner)
            if (event.type === 'threadReply' && event.reply.type === 'thread_reset') owner.generation = undefined
          }
        }
        held.push({ event, owner })
        schedule()
        return
      }
      handle(event)
      emit(event)
    },
    suspend() {
      retire()
      cancelLocal()
      selected?.cancel?.(); selected = undefined
      for (const host of state.getState().linked) query.cancelHost(host)
      state.setState({ linked: new Set() })
      for (const store of lives.values()) {
        const binding = store.getState().binding
        if (binding) store.getState().dispatch({ type: 'summary', serverId: binding.serverId, summary: null })
      }
    },
    dispose() {
      cancelLocal()
      disposed = true
      listeners.clear()
      retire()
      selected?.cancel?.(); selected = undefined; query.dispose(); offItems(); offRemoval()
      for (const [host, chats] of items.getState().hosts) for (const chat of chats.keys()) conversationReadRouteStore.getState().select(host, chat, null)
      for (const store of lives.values()) store.getState().dispatch({ type: 'dispose' })
      lives.clear(); state.setState({ linked: new Set(), localQueries: new Map() }); items.getState().clearAll(); sends.getState().dispose()
    }
  }
  function unschedule(): void {
    scheduled = undefined
    if (frameHandle !== undefined) deps.frame?.cancel(frameHandle)
    clearTimeout(timer); timer = undefined; frameHandle = undefined
  }
  function retire(host?: string, chat?: string): void {
    held = host === undefined ? [] : held.filter(({ event }) => event.serverId !== host ||
      chat !== undefined && conversationOf(event) !== chat)
    for (const id of owners.keys()) if (host === undefined || id === key(host, chat ?? '') ||
        chat === undefined && id.startsWith('[' + JSON.stringify(host) + ',')) owners.delete(id)
    unschedule()
    if (held.length) schedule()
  }
  function schedule(continuation = false): void {
    if (scheduled || disposed || !held.length) return
    const token = Symbol()
    scheduled = token
    const drain = () => {
      if (disposed || scheduled !== token) return
      unschedule()
      let remaining = MAX_DRAIN
      while (held.length && remaining > 0) {
        if (held[0].event.type === 'threadUpdate') {
          const applied: StampedDaemonEvent[] = []
          query.batch(() => {
            while (remaining > 0 && held[0]?.event.type === 'threadUpdate') {
              const entry = held.shift()
              if (entry) { remaining--; apply(entry, applied) }
            }
          })
          for (const event of applied) emit(event)
        } else {
          const entry = held.shift()
          if (entry) { remaining--; apply(entry) }
        }
      }
      // A chain of animation frames can starve input/timers while React commits long threads.
      // Continuations must return through the task queue before doing any more application work.
      schedule(true)
    }
    if (!continuation) frameHandle = deps.frame?.request(drain)
    timer = setTimeout(drain, continuation ? 0 : 50)
  }
  function apply({ event, owner }: (typeof held)[number], applied?: StampedDaemonEvent[]): void {
    const chat = conversationOf(event)
    if (owner && event.serverId !== null && chat !== undefined) {
      const host = event.serverId
      const generation = () => items.getState().hosts.get(host)?.get(chat)?.generation
      if (owner.generation !== undefined && owner.generation !== generation() &&
          !(event.type === 'conversationDeleted' && generation() === undefined)) return
      handle(event)
      owner.generation = generation()
    } else handle(event)
    if (applied) applied.push(event)
    else emit(event)
  }
  function handle(event: StampedDaemonEvent): void {
    if (disposed || event.serverId === null) return
    refusals.getState().event(event); taskStops.getState().event(event)
    const host = event.serverId
    if (event.type === 'connected') {
      replySuggestionStore.getState().receive(event)
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
    if (event.type === 'modalAnswerRejected') {
      for (const store of lives.values()) store.getState().dispatch({ type: 'daemon', event })
      return
    }
    if (event.type === 'messageDelivery') { sends.getState().feedback(host, event.conversationId, event); return }
    if (!isLinked(host)) return
    if (event.type === 'conversationsReceived') {
      for (const store of lives.values()) {
        const binding = store.getState().binding
        if (binding?.serverId === host && !event.conversations.some(row => row.id === binding.conversationId))
          store.getState().dispatch({ type: 'summary', serverId: host, summary: null })
      }
      for (const row of event.conversations) {
        live(host, row.id).getState().dispatch({ type: 'summary', serverId: host, summary: row })
        observeReports(host, row.id)
      }
      return
    }
    if (event.type === 'threadReply' || event.type === 'threadUpdate' || event.type === 'threadQueryFailed' || event.type === 'threadRepairNeeded') {
      query.input({ type: 'daemon', event }); return
    }
    const opening = selected?.host === host ? selected : undefined
    const selectedLive = opening && lives.get(key(host, opening.chat))
    const previousSettings = selectedLive && selectThreadReadings(selectedLive.getState(), 'runConfigReceived')[0]
    for (const store of lives.values()) {
      store.getState().dispatch({ type: 'daemon', event })
      if (event.type === 'sessionError' && selectThreadReadings(store.getState(), 'sessionError').includes(event))
        sends.getState().endFeedback(host, event.conversationId)
    }
    // Child activation withdraws the prior configuration and vocabulary before
    // publishing current transient state. Revalidate both once for the selected
    // bound session in this opening. An absent initial reply never triggers a
    // request, and repeated withdrawals cannot create a retry loop.
    if (opening && selectedLive && previousSettings && event.type === 'sessionStateCleared' &&
        event.family === 'session_settings' && event.envelopeConversationId === opening.chat &&
        typeof event.envelopeSessionId === 'string' && event.envelopeSessionId !== '' &&
        event.envelopeSessionId === selectedLive.getState().binding?.sessionId &&
        opening.configurationRefreshSession !== event.envelopeSessionId &&
        selectThreadReadings(selectedLive.getState(), 'runConfigReceived').length === 0) {
      opening.configurationRefreshSession = event.envelopeSessionId
      try {
        deps.send({ type: 'requestSessionSettings', serverId: host, payload: { conversation_id: opening.chat } })
        deps.send({ type: 'requestModelList', serverId: host, payload: { conversation_id: opening.chat } })
      } catch { deps.log({ event: 'thread-live-state', code: 'configuration-refresh-failed' }) }
    }
  }
}
export const threadRuntime = createThreadRuntime({ send: command => window.pyry.sendCommand(command),
  read: request => window.pyry.chatHistory(request), log: event => window.pyry.sendDiagnostic(event),
  frame: { request: callback => window.requestAnimationFrame(callback), cancel: handle => window.cancelAnimationFrame(handle) } })

/** Unattributed non-content bridges retain their existing event contract. */
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
    const off = window.pyry.onDaemonEvent(threadRuntime.event, true)
    const offProjection = connectThreadLiveProjection(threadRuntime)
    return () => { off(); offProjection(); threadRuntime.suspend() }
  }, [])
}
