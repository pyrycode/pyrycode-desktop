// The renderer translation half of the background↔window bridge: it turns each typed
// daemon event (#18) into the matching session-store action (#2) and feeds it into the
// app-singleton store the UI reads. `translateDaemonEvent` is the pure choke point;
// `useDaemonEventBridge` is its only production caller, wiring the channel into React's
// lifecycle. Nothing here touches keys, sockets, ipcRenderer, or raw frames — it only
// subscribes through the preload bridge and dispatches typed actions.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { sessionStore, type SessionAction } from './sessionStore'

/** Compile-time exhaustiveness guard: a new DaemonEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled daemon event: ${JSON.stringify(event)}`)
}

/**
 * Map one typed daemon event to the session-store action it produces. Total by
 * construction: a new DaemonEvent variant with no case fails to compile (assertNever).
 * Every arm is pass-through except `failed`, which copies the wire ErrorPayload's fields
 * into a fresh store-owned ConnectionError — an explicit copy, not a spread, so the store
 * shape stays immune to ErrorPayload gaining an unrelated field later.
 */
export function translateDaemonEvent(event: DaemonEvent): SessionAction {
  switch (event.type) {
    case 'connecting':
      return { type: 'connecting' }
    case 'connected':
      return { type: 'connected', ack: event.ack }
    case 'disconnected':
      return { type: 'disconnected' }
    case 'failed':
      return {
        type: 'failed',
        error: {
          code: event.error.code,
          message: event.error.message,
          retryable: event.error.retryable
        }
      }
    case 'messageReceived':
      return { type: 'messageReceived', message: event.message }
    case 'messagesReceived':
      return { type: 'messagesReceived', messages: event.messages }
    default:
      return assertNever(event)
  }
}

/**
 * Wire the daemon-event channel into the app-singleton session store for the lifetime of
 * the mounting component. Subscribes on mount, translates each event to a SessionAction and
 * dispatches it into `sessionStore`, and calls the unsubscribe handle on unmount. Returns
 * nothing — it is a side-effecting binding, not a state source (the store is the single
 * source of truth). The effect returns the exact unsubscribe handle from onDaemonEvent, so a
 * StrictMode double-mount nets exactly one live listener.
 */
export function useDaemonEventBridge(): void {
  useEffect(() => {
    const off = window.pyry.onDaemonEvent((event) =>
      sessionStore.getState().dispatch(translateDaemonEvent(event))
    )
    return off
  }, [])
}
