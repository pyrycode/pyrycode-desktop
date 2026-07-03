// The active session's state: connection status + conversation message list, as one
// unidirectional source of truth. Pure renderer state — no IPC, no preload bridge, no
// transport. #3 (the typed background↔window channel) translates daemon envelopes into
// the SessionActions dispatched here; #12 binds the selectors into the conversation UI.
//
// Mirrors mobile's "one state object per screen with a sealed event set" (pyrycode ADR
// 025): connection status and the message list are two facets of one session, so they
// live in one store. Both the status and the action set are discriminated unions on
// `type`, per CLAUDE.md's sealed-event-shapes convention.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { HelloAckPayload, MessagePayload } from '@shared/wire/types'

/** The active session's connection lifecycle. Discriminated on `type`. */
export type ConnectionStatus =
  | { type: 'disconnected' }
  | { type: 'connecting' } // dialing + Noise handshake
  | { type: 'connected'; ack: HelloAckPayload }
  | { type: 'error'; error: ConnectionError }

/**
 * Renderer-owned error record. Structurally mirrors the wire `ErrorPayload`, but owned
 * by the store so that transport/handshake failures — which carry NO wire ErrorPayload —
 * populate the same shape the UI banner reads. A wire `error` envelope copies its fields
 * across; a transport/handshake failure synthesizes `code: 'transport' | 'handshake'`.
 */
export interface ConnectionError {
  code: string // wire ErrorPayload.code, or 'transport' | 'handshake' for non-wire failures
  message: string // human-readable, for the banner
  retryable: boolean
}

/**
 * State mutations. Sealed discriminated union on `type`. #3 translates daemon envelopes
 * into these; nothing mutates state except by dispatching one. The two message actions
 * mirror the two wire envelope types: `messageReceived` ← a `message` envelope,
 * `messagesReceived` ← a `message_chunk` batch (complete messages, not partial tokens).
 */
export type SessionAction =
  | { type: 'connecting' }
  | { type: 'connected'; ack: HelloAckPayload }
  | { type: 'disconnected' }
  | { type: 'failed'; error: ConnectionError }
  | { type: 'messageReceived'; message: MessagePayload }
  | { type: 'messagesReceived'; messages: readonly MessagePayload[] }

/** The whole session state. Single source of truth. */
export interface SessionState {
  status: ConnectionStatus
  messages: readonly MessagePayload[]
}

/** Store shape = state + the single mutation entry point. */
export type SessionStore = SessionState & {
  dispatch: (action: SessionAction) => void
}

/** Compile-time exhaustiveness guard: a new SessionAction arm without a case is a type error. */
function assertNever(action: never): never {
  throw new Error(`Unhandled session action: ${JSON.stringify(action)}`)
}

/**
 * Pure reducer — no mutation, returns fresh state. Status and messages are orthogonal:
 * status actions never touch `messages`, message actions never touch `status`. Each status
 * action sets its target unconditionally; ordering is the caller's (#3's) responsibility.
 */
export function reduceSession(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'connecting':
      return { status: { type: 'connecting' }, messages: state.messages }
    case 'connected':
      return { status: { type: 'connected', ack: action.ack }, messages: state.messages }
    case 'disconnected':
      return { status: { type: 'disconnected' }, messages: state.messages }
    case 'failed':
      return { status: { type: 'error', error: action.error }, messages: state.messages }
    case 'messageReceived':
      return { status: state.status, messages: [...state.messages, action.message] }
    case 'messagesReceived':
      return { status: state.status, messages: [...state.messages, ...action.messages] }
    default:
      return assertNever(action)
  }
}

export const initialSessionState: SessionState = {
  status: { type: 'disconnected' },
  messages: []
}

/** DI-friendly, React-free store — one isolated instance per test. */
export function createSessionStore(init: SessionState = initialSessionState) {
  return createStore<SessionStore>((set) => ({
    ...init,
    dispatch: (action) => set((s) => reduceSession(s, action))
  }))
}

/** App-wide singleton — the "one source of truth" #3 dispatches into and #12 reads. */
export const sessionStore = createSessionStore()

/** Narrow-slice React binding for #12. Selecting a single slice avoids cross-facet re-renders. */
export function useSessionStore<T>(selector: (s: SessionStore) => T): T {
  return useStore(sessionStore, selector)
}

/** Selectors — the only read surface. There is no exposed setter; `dispatch` is the sole mutation path. */
export const selectStatus = (s: SessionState): ConnectionStatus => s.status
export const selectMessages = (s: SessionState): readonly MessagePayload[] => s.messages
