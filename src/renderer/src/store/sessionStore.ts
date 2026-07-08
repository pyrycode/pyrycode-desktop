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
import { logSessionTransition } from './sessionDiagnostics'

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
  // A locally-composed message shown optimistically before the daemon confirms it (#66).
  // Distinct name from `messageReceived` to document intent — a local echo, not a daemon
  // delivery — though the reducer body is identical: append through the same `message_id`
  // dedupe so the daemon's later echo of the same id drops instead of double-posting.
  | { type: 'messageSent'; message: MessagePayload }
  // Return the whole session to its initial state on unpair (#166). Unlike `disconnected`, which
  // deliberately preserves `messages`, this clears BOTH facets so a later re-pair never shows the
  // previous pairing's conversation.
  | { type: 'reset' }

/** The whole session state. Single source of truth. */
export interface SessionState {
  status: ConnectionStatus
  messages: readonly MessagePayload[]
}

/** Store shape = state + the single mutation entry point. */
export type SessionStore = SessionState & {
  dispatch: (action: SessionAction) => void
}

/**
 * A passive post-reduce observer of every dispatched action — the store's one instrumentation seam
 * (#134). Invoked synchronously inside `dispatch` after `set`, with the action and the resulting
 * state. It must not mutate state, alter the data flow, or throw; it exists only to emit
 * diagnostics. Optional, so a test store stays observer-free.
 */
export type TransitionObserver = (action: SessionAction, state: SessionState) => void

/** Compile-time exhaustiveness guard: a new SessionAction arm without a case is a type error. */
function assertNever(action: never): never {
  throw new Error(`Unhandled session action: ${JSON.stringify(action)}`)
}

/**
 * Append messages the store does not already hold, keyed by `message_id` (the wire names a
 * per-message id precisely so a client can drop duplicates). Reconnect backfill, driven by the
 * hello `last_seen_ts` cursor, can re-deliver a message already stored; deduping here keeps the
 * thread from showing it twice. Arrival order is preserved and a duplicate is skipped in place,
 * never reordered. Returns the same array reference when nothing new is added, so a pure
 * duplicate does not churn selectors.
 */
function appendUnique(
  existing: readonly MessagePayload[],
  incoming: readonly MessagePayload[]
): readonly MessagePayload[] {
  const seen = new Set(existing.map((m) => m.message_id))
  const added: MessagePayload[] = []
  for (const message of incoming) {
    if (seen.has(message.message_id)) continue
    seen.add(message.message_id)
    added.push(message)
  }
  return added.length === 0 ? existing : [...existing, ...added]
}

/**
 * Pure reducer — no mutation, returns fresh state. Status and messages are orthogonal:
 * status actions never touch `messages`, message actions never touch `status`. Each status
 * action sets its target unconditionally; ordering is the caller's (#3's) responsibility.
 * Message actions dedup by `message_id` so backfill overlap does not double-post.
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
      return { status: state.status, messages: appendUnique(state.messages, [action.message]) }
    case 'messagesReceived':
      return { status: state.status, messages: appendUnique(state.messages, action.messages) }
    case 'messageSent':
      return { status: state.status, messages: appendUnique(state.messages, [action.message]) }
    case 'reset':
      // Both facets clear in one step. `initialSessionState` is an immutable shared const, so
      // returning it is safe and makes a second reset a no-op reference (idempotent).
      return initialSessionState
    default:
      return assertNever(action)
  }
}

export const initialSessionState: SessionState = {
  status: { type: 'disconnected' },
  messages: []
}

/**
 * DI-friendly, React-free store — one isolated instance per test. `observe`, when supplied, is
 * called after each reduce with the action and the resulting (post-reduce) state; the app singleton
 * wires it to the diagnostics logger while test stores omit it. Appended after `init` so the
 * arg-less callers stay source-compatible.
 */
export function createSessionStore(
  init: SessionState = initialSessionState,
  observe?: TransitionObserver
) {
  return createStore<SessionStore>((set, get) => ({
    ...init,
    dispatch: (action) => {
      set((s) => reduceSession(s, action))
      // `set` is synchronous in zustand, so `get()` already reflects the reduced state.
      observe?.(action, get())
    }
  }))
}

/** App-wide singleton — the "one source of truth" #3 dispatches into and #12 reads. Its dispatch is
 *  observed by the diagnostics logger (#134); isolated test stores created via createSessionStore()
 *  are not. */
export const sessionStore = createSessionStore(initialSessionState, logSessionTransition)

/** Narrow-slice React binding for #12. Selecting a single slice avoids cross-facet re-renders. */
export function useSessionStore<T>(selector: (s: SessionStore) => T): T {
  return useStore(sessionStore, selector)
}

/** Selectors — the only read surface. There is no exposed setter; `dispatch` is the sole mutation path. */
export const selectStatus = (s: SessionState): ConnectionStatus => s.status
export const selectMessages = (s: SessionState): readonly MessagePayload[] => s.messages
