import type { StoreApi } from 'zustand/vanilla'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { RunConfigStore } from '../../store/runConfigStore'
import type { RunSettingsWriteStore } from '../../store/runSettingsWriteStore'
import { toRunConfigSnapshot } from './runConfigSnapshot'

/** Owns confirmation freshness; write acknowledgements never become display readings. */
export function subscribeConfirmedRunConfig(deps: {
  onDaemonEvent: (listener: (event: StampedDaemonEvent) => void) => () => void
  getContext: () => { conversationId: string | null; serverId: string | null }
  subscribeContext: (listener: () => void) => () => void
  writes: StoreApi<RunSettingsWriteStore>
  config: StoreApi<RunConfigStore>
  setSessionId: (id: string) => void
  refresh: () => void
  log: (code: string) => void
}): () => void {
  let context = deps.getContext()
  let expectedSession: string | null = null
  let resetting = false
  const pending = new Map<string, string>()
  let target: string | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let awaiting = false
  const stop = () => { clearInterval(timer); timer = undefined; target = null }
  const invalidate = () => {
    stop(); pending.clear(); expectedSession = null; resetting = false
    const snapshot = deps.config.getState().snapshot
    if (snapshot !== null) deps.config.getState().setSnapshot({ ...snapshot, permissionMode: '' })
    deps.log('invalidated')
  }
  const offContext = deps.subscribeContext(() => {
    const next = deps.getContext()
    if (next.conversationId !== context.conversationId || next.serverId !== context.serverId) {
      context = next
      invalidate()
    }
  })
  // Capture dispatch before either event subscriber removes the pending write.
  const offWrites = deps.writes.subscribe((next, previous) => {
    for (const [id, change] of next.pending) {
      if (change.field === 'permissionMode' && !previous.pending.has(id)) pending.set(id, change.value)
    }
  })
  const offEvents = deps.onDaemonEvent(event => {
    if (!context.conversationId || !context.serverId || event.serverId !== context.serverId) return
    if (event.type === 'connected') { invalidate(); return }
    if (event.type === 'resetting' && event.conversationId === context.conversationId) {
      invalidate(); resetting = event.active
      if (!resetting) deps.refresh()
      return
    }
    if (event.type === 'sessionTransition' && event.conversationId === context.conversationId) {
      invalidate(); expectedSession = event.newSessionId
      deps.setSessionId(event.newSessionId)
      deps.refresh()
      return
    }
    if (event.type === 'runConfigReceived') {
      if (resetting || event.conversationId !== context.conversationId ||
          (expectedSession !== null && event.sessionId !== '' && event.sessionId !== expectedSession)) return
      const snapshot = toRunConfigSnapshot(event)
      if (snapshot === null) return
      deps.config.getState().setSnapshot(snapshot)
      deps.setSessionId(event.sessionId)
      awaiting = false
      if (target !== null && event.permissionMode === target) {
        stop()
        deps.log('confirmed')
      }
    } else if (event.type === 'sessionSettingsUpdated' || event.type === 'sessionSettingsRejected') {
      const requested = pending.get(event.changeId)
      if (requested === undefined || resetting) return
      pending.delete(event.changeId)
      stop()
      deps.log(event.type === 'sessionSettingsUpdated' ? 'acknowledged' : 'rejected')
      if (event.type === 'sessionSettingsUpdated') {
        target = requested
        const deadline = Date.now() + 15_000
        timer = setInterval(() => {
          if (Date.now() >= deadline) { stop(); deps.log('unconfirmed'); return }
          // Wait for a reply before retrying: slow round trips must not supersede themselves.
          if (!awaiting) { awaiting = true; deps.refresh() }
        }, 500)
      }
      awaiting = true
      deps.refresh()
    }
  })
  return () => { stop(); offEvents(); offWrites(); offContext() }
}
