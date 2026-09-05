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
 * Which slot a status is filed under (#1133). THREE kinds of key, and the distinction between the
 * last two is deliberate rather than incidental — `ServerOrigin`'s header in `shared/ipc/events.ts`
 * draws it, and `liveWindow.ts`'s `StatusOrigin` is the same domain applied main-side for the
 * reopened-window cache (#1121). The two copies are deliberate: the renderer may not import from
 * `src/main/`, and lifting the type into `shared/` would need a third consumer to justify it.
 *
 *   - a `string` — one slot per paired server, which is the whole point of the keying;
 *   - `null` — a PRESENT null: a producer bound while no paired record was in hand. Live, not
 *     hypothetical: `connectionRegistry`'s not-paired stand-in is built with `serverId: null` and is
 *     dialled like any other, so its `failed(not-paired)` genuinely arrives;
 *   - `undefined` — no origin at all, meaning a producer that never went through a binding.
 *     Unreachable in production (every producer is bound exactly once), but reachable from the
 *     tests, which dispatch bare literals. Filing it keeps the reducer TOTAL — an unbound
 *     producer's status is recorded rather than silently dropped.
 *
 * Coalescing `undefined` into `null` would erase that distinction in the one place it is observable.
 */
export type StatusOrigin = string | null | undefined

/**
 * State mutations. Sealed discriminated union on `type`. #3 translates daemon envelopes
 * into these; nothing mutates state except by dispatching one. The two message actions
 * mirror the two wire envelope types: `messageReceived` ← a `message` envelope,
 * `messagesReceived` ← a `message_chunk` batch (complete messages, not partial tokens).
 *
 * The four status actions carry the server they speak for (#1133), OPTIONALLY — and the optionality
 * is load-bearing twice over. It makes the absent case a genuine absent property, matching
 * `StatusOrigin`'s three-case domain with no sentinel value; and it leaves every existing
 * `dispatch({ type: 'connecting' })` — in `clearPairingScopedState` and across three test files —
 * compiling and behaving exactly as before, filing under the unstamped slot.
 */
export type SessionAction =
  | { type: 'connecting'; serverId?: string | null }
  | { type: 'connected'; ack: HelloAckPayload; serverId?: string | null }
  | { type: 'disconnected'; serverId?: string | null }
  | { type: 'failed'; error: ConnectionError; serverId?: string | null }
  | { type: 'messageReceived'; message: MessagePayload }
  | { type: 'messagesReceived'; messages: readonly MessagePayload[] }
  // A locally-composed message shown optimistically before the daemon confirms it (#66).
  // Distinct name from `messageReceived` to document intent — a local echo, not a daemon
  // delivery — though the reducer body is identical: append through the same `message_id`
  // dedupe so the daemon's later echo of the same id drops instead of double-posting.
  | { type: 'messageSent'; message: MessagePayload }
  // Return the whole session to its initial state when a pairing ends (#166). Unlike `disconnected`,
  // which deliberately preserves `messages`, this clears BOTH of THIS store's facets: the connection
  // status and the coarse `messages` list. That is its whole scope, and it is narrower than it once
  // read: since #179 the visible thread renders `timelineStore.items`, not `messages`, so this action
  // alone does NOT keep a later re-pair from showing the previous pairing's conversation (#531 — the
  // gap that claim hid). The full pairing-scoped clear set — the timeline rows, the active
  // conversation, the daemon session id and this reset — is owned by `clearPairingScopedState.ts`,
  // which both pairing-change paths run; this action is one of its four members, never the whole job.
  | { type: 'reset' }

/** The whole session state. Single source of truth. */
export interface SessionState {
  /**
   * The MOST RECENTLY WRITTEN status, across every connection — byte-for-byte what this cell has
   * always held, since it was already last-writer-wins the moment #1117 gave the registry one
   * connection per paired server. #1133 keeps it in place rather than re-shaping it into the index
   * below: the app-wide read is what the connection banner, the composer's status row, the sidebar's
   * host-connection dot and the conversation-list connected gate all consume, and a field nothing
   * rewrote is the cheapest possible guarantee that none of them renders differently. A fold
   * ("connected if any server is") was considered and rejected for exactly that reason.
   */
  status: ConnectionStatus
  /**
   * One slot per origin (#1133) — what makes one machine going down read as that machine being
   * down. `status` alone reported whichever connection changed most recently and nothing about the
   * others, and on a healthy connection the next status change is never, so another server's leg
   * could stay wrong for the life of the window.
   *
   * A `Map`, NEVER a bare object. `ServerOrigin`'s docblock in `shared/ipc/events.ts` rules it for
   * any consumer that indexes by the id — a `__proto__` id would write through `Object.prototype` on
   * a `Record<string, …>` — and `liveWindow.ts` and `queueStore.ts` are the existing precedents.
   *
   * Growth is bounded by the distinct-origin count (one per paired server plus at most the two
   * non-server keys), and a daemon cannot influence which key its own event carries, so nothing it
   * sends can mint a slot. Nothing is evicted: a torn-down server's last status is `failed` or
   * `disconnected`, which is exactly what a per-server reader should be told.
   */
  statuses: ReadonlyMap<StatusOrigin, ConnectionStatus>
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
 * Apply one status to both facets at once (#1133): the app-wide most-recently-written cell and the
 * origin's own slot. The SAME object reference goes into both, so `selectStatus` and
 * `selectStatusFor(origin)` can never be caught disagreeing about the connection that just moved.
 *
 * Copy-on-write — `new Map(existing)` then `set`, never a mutation of the incoming map — which is
 * what keeps `reduceSession` pure and what makes an untouched server's slot come back BY REFERENCE,
 * so a component watching that server does not re-render when a different one changes.
 */
function withStatus(
  state: SessionState,
  origin: StatusOrigin,
  status: ConnectionStatus
): SessionState {
  const statuses = new Map(state.statuses)
  statuses.set(origin, status)
  return { status, statuses, messages: state.messages }
}

/**
 * Pure reducer — no mutation, returns fresh state. Status and messages are orthogonal:
 * status actions never touch `messages`, message actions never touch `status` or the per-server
 * index. Each status action sets its target unconditionally; ordering is the caller's (#3's)
 * responsibility. Message actions dedup by `message_id` so backfill overlap does not double-post.
 *
 * Each status action writes TWO places through `withStatus` (#1133): the app-wide cell and the slot
 * named by `action.serverId`. An action with no origin files under the unstamped slot rather than
 * being dropped, which is what keeps the reducer total.
 */
export function reduceSession(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'connecting':
      return withStatus(state, action.serverId, { type: 'connecting' })
    case 'connected':
      return withStatus(state, action.serverId, { type: 'connected', ack: action.ack })
    case 'disconnected':
      return withStatus(state, action.serverId, { type: 'disconnected' })
    case 'failed':
      return withStatus(state, action.serverId, { type: 'error', error: action.error })
    case 'messageReceived':
      return {
        status: state.status,
        statuses: state.statuses,
        messages: appendUnique(state.messages, [action.message])
      }
    case 'messagesReceived':
      return {
        status: state.status,
        statuses: state.statuses,
        messages: appendUnique(state.messages, action.messages)
      }
    case 'messageSent':
      return {
        status: state.status,
        statuses: state.statuses,
        messages: appendUnique(state.messages, [action.message])
      }
    case 'reset':
      // All three facets clear in one step — the per-server index (#1133) along with the two this
      // action has always cleared. `initialSessionState` is a shared const the reducer never
      // mutates (every status write copies the map first), so returning it is safe and makes a
      // second reset a no-op reference (idempotent) — an identity `clearPairingScopedState`
      // documents and this store's own tests assert. Its scope stays app-wide: narrowing a reset to
      // one server is not this ticket.
      return initialSessionState
    default:
      return assertNever(action)
  }
}

/**
 * The empty index every session starts from, so "before any event arrives" needs no special case:
 * the app-wide cell still reads `disconnected` and every per-server read still answers "not heard
 * from". Held by reference across a `reset` rather than rebuilt, and never written in place.
 */
export const initialSessionState: SessionState = {
  status: { type: 'disconnected' },
  statuses: new Map(),
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

/**
 * The APP-WIDE status: the most recently written one, across every connection. Unchanged in name,
 * signature and return type by #1133, which is what leaves its five consumers — the composer status
 * row, the connection banner, the repair control, `HostConnectionDotsControl`'s daemon leg, and
 * `composerSend`'s plain-argument taker — working untouched.
 */
export const selectStatus = (s: SessionState): ConnectionStatus => s.status

/**
 * ONE SERVER's status (#1133) — a selector factory bound to one origin, the `selectBacklogFor` /
 * `selectTimelineFor` / `selectRosterFor` idiom already used across this directory.
 *
 * Returns `undefined` for a server that has reported nothing yet, and DELIBERATELY does not default
 * to `{ type: 'disconnected' }` the way `selectBacklogFor` defaults to an empty list: telling "not
 * heard from" apart from "disconnected" is the whole point of the per-server read, and a default
 * would erase it at the one place a caller could still see the difference.
 *
 * Narrow-slice-correct: a status write for another server produces a new map, but `newMap.get(mine)`
 * returns the SAME `ConnectionStatus` reference → `Object.is` true → no re-render.
 */
export const selectStatusFor =
  (origin: StatusOrigin) =>
  (s: SessionState): ConnectionStatus | undefined =>
    s.statuses.get(origin)
export const selectMessages = (s: SessionState): readonly MessagePayload[] => s.messages
