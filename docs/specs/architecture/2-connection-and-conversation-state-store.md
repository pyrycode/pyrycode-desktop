# Spec — Connection and conversation state store (#2)

**Size:** S. One new production file (`sessionStore.ts`), one test file. 5 exported types, ~100 production LOC, 0 existing consumers (greenfield module — nothing binds it yet; #12 binds it to the UI, #3 dispatches into it).

## Files to read first

- `src/shared/wire/types.ts:44-90` — `WireRole`, `MessagePayload`, `MessageChunkPayload`, `HelloAckPayload`, `ErrorPayload`. **The store reuses `MessagePayload` verbatim for stored messages and `HelloAckPayload` for the connected status.** `ConnectionError` (new) mirrors `ErrorPayload` field-for-field. Do not redefine or drift any wire type.
- `src/renderer/src/screens/conversation/placeholderMessages.ts:6-9` — the existing renderer `Message` view model (`type: 'user'|'daemon'`, `id`, `text`). **The store does NOT reuse this** — it holds wire `MessagePayload` (`role: 'user'|'assistant'`, `message_id`, `text`). Read it only to see the eventual #12 adapter seam (`role: 'assistant'` ↔ UI `'daemon'`, `message_id` ↔ `id`). Not touched by this ticket.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:21-31` — how `MessageThread` consumes `Message[]`. The store's `selectMessages` is the seam #12 will bind here. Confirms **#2 does not modify this file.**
- `CLAUDE.md` (repo root) — load-bearing conventions: *Unidirectional state*, *Sealed event shapes on a `type` discriminant*, *Single source of state per store*, *Keep the transport out of the window* (**the store must not import from `src/main/`**), *Test-first*.
- `docs/knowledge/features/conversation-shell.md` — the seams #2/#12 bind into; establishes the store as "one unidirectional source of truth."
- `src/shared/wire/types.test.ts` — the project's vitest style for plain-data tests (`describe`/`it`/`expect`, no DOM). Mirror its shape for the reducer/selector tests.
- `vitest.config.ts` — tests run in `environment: 'node'` with `@shared`/`@renderer` aliases. The pure reducer + vanilla-store tests fit this env with **no jsdom/DOM harness** (the React hook is typecheck-covered, not render-tested).
- `package.json` — `zustand ^5.0.2` is already a dependency. **No new dependency.** Use the v5 vanilla API (`createStore` from `zustand/vanilla`, `useStore` from `zustand`).

> Codegraph is not initialized for this repo (the `.codegraph/` index symlink did not land in the worktree); this reading list was built by hand from the wire types + renderer surface. Noting the gap for the pipeline.

## Context

Ticket #2 is the renderer-side state foundation for the connect-send-stream milestone. It is **pure renderer state**: a single Zustand store holding the active session's connection status and its conversation message list, mutated only through a sealed action union. No IPC, no preload bridge, no transport — those live in #3 (the typed background↔window channel, explicitly *blocked by* this store) and #4. #3 translates daemon envelopes into this store's actions; #12 binds the store into the conversation UI. This ticket ships the store and its unit tests only, testable in isolation before any channel exists.

Design anchor: mobile's "one state object per screen with a sealed event set" (ADR 025, pyrycode). Connection status and the conversation message list are two facets of one session, so they belong in **one** store, not two. The current `src/shared/wire/types.ts` reflects the Phase-1 *coarse* round-trip (`message`, `message_chunk`, `hello_ack`, `error`), which is exactly this milestone's target; the richer interactive types (`assistant_delta`, `turn_state`, modals) from ADR 025 Phase 2/3 are not in the wire types yet and are out of scope.

No `## Figma` section in the ticket and no rendered component in this ticket — the store has no visual surface, so no Design source section applies. The store's visual binding lands in #12.

## Design

### Module layout

One production file: `src/renderer/src/store/sessionStore.ts`. One test file: `src/renderer/src/store/sessionStore.test.ts`. Everything (types, reducer, factory, singleton, hook, selectors) lives in the one production module — #3 imports `{ sessionStore, type SessionAction }` from it; #12 imports `{ useSessionStore, selectMessages, selectStatus }`.

### Key types (contract — discriminated unions on `type`)

Imports use the repo alias: `import type { MessagePayload, HelloAckPayload } from '@shared/wire/types'`.

```ts
/** The active session's connection lifecycle. Discriminated on `type`. */
export type ConnectionStatus =
  | { type: 'disconnected' }
  | { type: 'connecting' }                       // dialing + Noise handshake
  | { type: 'connected'; ack: HelloAckPayload }
  | { type: 'error'; error: ConnectionError }

/** Renderer-owned error record. Structurally mirrors the wire `ErrorPayload`,
 *  but owned by the store so that transport/handshake failures — which have NO
 *  wire ErrorPayload — populate the same shape the UI banner reads. */
export interface ConnectionError {
  code: string        // wire ErrorPayload.code, or 'transport' | 'handshake' for non-wire failures
  message: string     // human-readable, for the banner
  retryable: boolean
}

/** State mutations. Sealed discriminated union on `type`. #3 translates daemon
 *  envelopes into these; nothing mutates state except by dispatching one. */
export type SessionAction =
  | { type: 'connecting' }
  | { type: 'connected'; ack: HelloAckPayload }
  | { type: 'disconnected' }
  | { type: 'failed'; error: ConnectionError }
  | { type: 'messageReceived'; message: MessagePayload }            // one `message` envelope
  | { type: 'messagesReceived'; messages: readonly MessagePayload[] } // one `message_chunk` batch

/** The whole session state. Single source of truth. */
export interface SessionState {
  status: ConnectionStatus
  messages: readonly MessagePayload[]
}

/** Store shape = state + the single mutation entry point. */
export type SessionStore = SessionState & {
  dispatch: (action: SessionAction) => void
}
```

Notes on the choices (architect's calls the ticket delegates):

- **Messages are wire `MessagePayload`, not a new renderer model.** The ticket permits a thin view model "if a rendering concern requires" one — but #2 renders nothing, so there is no rendering concern here. Reusing `MessagePayload` keeps a single source with zero drift and lets #3 dispatch exactly what it parsed off the wire. The `role: 'assistant'` ↔ UI `'daemon'` and `message_id` ↔ `id` mapping is a pure presentation transform that belongs at the #12 component boundary (or #12 updates the CSS to `assistant`), not in the store.
- **`ConnectionError` is a new renderer type, not reused `ErrorPayload`.** It is structurally identical but semantically owned by the store, because not every connection failure arrives as a wire `error` envelope: a silent Noise-handshake failure or a dropped socket (detected in #4's transport) has no `ErrorPayload`. One shared error shape lets both a wire `error` (fields copied across) and a transport failure (synthesized `code: 'transport'`) land in the same `status.error` the UI reads. This is the one justified thin model; the message path deliberately has none.
- **`connected` carries the whole `HelloAckPayload`.** It comes free from #3's `hello_ack` translation and avoids drift; narrow it later if the UI only ever needs `server_id`.
- **Two message actions, mirroring the two wire envelope types.** `messageReceived` ← a `message` envelope; `messagesReceived` ← a `message_chunk` (`MessageChunkPayload.messages`). `message_chunk` is a **batch of complete messages** (backfill), not partial-token streaming — so the reducer appends whole messages; there is no per-`message_id` token accumulator. Keeping the 1:1 mapping to wire envelopes makes #3's translation obvious.

### Reducer (pure, exported, testable in isolation)

`reduceSession(state: SessionState, action: SessionAction): SessionState` — a pure function, no mutation, returns fresh state. This is the unit under test for AC5 (no store, no React, no channel needed). Behavior per action:

| action | effect |
|---|---|
| `connecting` | `status → { type: 'connecting' }` |
| `connected` | `status → { type: 'connected', ack }` |
| `disconnected` | `status → { type: 'disconnected' }` |
| `failed` | `status → { type: 'error', error }` |
| `messageReceived` | `messages → [...messages, message]` (append one) |
| `messagesReceived` | `messages → [...messages, ...messages_batch]` (append batch, in order) |

Invariants the reducer must hold (assert these in tests):

- **Status and messages are orthogonal.** Status actions never touch `messages`; message actions never touch `status`. No status action clears history (reconnect-clears-history is an open question, deferred).
- **Unconditional set, no illegal-transition guards.** Each status action sets its target status regardless of the current one — there is no state-machine rejection layer (zero reject branches). Ordering ("connecting → connected", "connecting → error") is the caller's (#3's) responsibility; the reducer just applies. This is deliberate: no observed need for a transition guard, so none is built.
- **Purity.** The input `state` and its `messages` array are never mutated; every result is a new object with a new `messages` array on append. Build results from `state.status` / `state.messages` explicitly (do **not** `...state`-spread) so `reduceSession` stays a clean `SessionState → SessionState` function independent of the store's extra `dispatch` field.
- **Exhaustiveness.** A `default` branch with an `assertNever(action: never)` helper gives a compile-time error if a `SessionAction` variant is ever added without a reducer arm. (Compile-time only — not a runtime reject branch.)

### Store factory, singleton, hook (recommended Zustand v5 wiring)

Contract sketch — the developer confirms the exact v5 import surface against the installed types (test-first will surface any mismatch):

```ts
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

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

/** Narrow-slice React binding for #12. */
export function useSessionStore<T>(selector: (s: SessionStore) => T): T {
  return useStore(sessionStore, selector)
}
```

- `set((s) => reduceSession(s, action))` — Zustand shallow-merges the returned `{ status, messages }`, so the `dispatch` field is preserved. `reduceSession` reads only `s.status`/`s.messages`, so passing the fuller `SessionStore` is fine.
- The **vanilla `createStore` factory is the DI seam** the pipeline asks for: tests construct an isolated store (or call `reduceSession` directly) with no global state and no React. There is no transport dependency to inject here — that is the whole point of #2.

### Selectors (AC2, AC5)

```ts
export const selectStatus = (s: SessionState): ConnectionStatus => s.status
export const selectMessages = (s: SessionState): readonly MessagePayload[] => s.messages
```

- `messages` is typed `readonly MessagePayload[]` and there is **no exposed setter** — the only mutation path is `dispatch`. That satisfies AC2 ("the array's setter is not exposed to components") and AC3 (no two-way binding) at the type level (`npm run typecheck`).
- Typed over `SessionState` (a structural subset of `SessionStore`), so they compose with both the pure reducer tests and `useSessionStore`.

### Data flow and re-render seams

```
 #3 channel (later)                 sessionStore                 #12 components (later)
 daemon Envelope ──translate──►  dispatch(SessionAction) ──►  useSessionStore(selectMessages) ──► render
   message/hello_ack/error         reduceSession (pure)         useSessionStore(selectStatus)
```

- **Narrow-slice selection.** Components select `selectMessages` or `selectStatus` independently, so a status change does not re-render the thread and an append does not re-render the status row. Zustand's default `Object.is` equality works because `selectMessages` returns the same array reference until an append creates a new one (`selectStatus` similarly). Any *derived* list a component builds must be memoized — the store returns raw slices only.

## State + concurrency model

- **Single Zustand store** (`sessionStore`) is the sole owner of active-session state — no parallel mutable state anywhere. Matches CLAUDE.md "Single source of state per store."
- **Synchronous only.** The store does no async work. #3/#4 own the channel subscription, async iterables, cancellation, and teardown; they call `dispatch` synchronously per received envelope. The reducer appends in call order → AC4's "arrival order" is exactly the order #3 dispatches.
- **No lifecycle/teardown in the store.** The singleton lives for the app's lifetime; there are no subscriptions to cancel here. `createSessionStore()` yields a fresh isolated store per test, so tests share no state.

## Error handling

- Connection failures are modeled as `status: { type: 'error', error: ConnectionError }` via the `failed` action. `ConnectionError` gives the UI `message` (banner text) + `retryable` (retry affordance) + `code`.
- The store performs no I/O, so it has no network/socket/parse failures of its own. #3/#4 catch those and dispatch `failed`: a wire `error` envelope copies its `ErrorPayload` fields across; a transport/handshake failure synthesizes `{ code: 'transport' | 'handshake', message, retryable }`.
- Sealed union ⇒ no malformed action at runtime; the reducer's exhaustive `assertNever` default is a compile-time guard. No runtime throw/reject branches.
- UI surfacing is out of scope for #2 (no component wiring). For the record: #12 reads `selectStatus` and renders a banner when `status.type === 'error'`.

## Testing strategy

`npm test` (vitest, `environment: 'node'` — no DOM harness), plus `npm run typecheck` for the type-level guarantees. Test-first: write these RED before the module exists. Cover the pure `reduceSession` + selectors directly (AC5's "exercise the store directly, no channel/IPC/transport"), with a couple of vanilla-store wiring checks. Scenarios (developer writes the assertions in the wire-test idiom — bullets, not pre-written bodies):

- **Reducer — status transitions:** from `initialSessionState`, `connecting` → `status.type === 'connecting'`; then `connected` → `connected` carrying the exact `ack` (asserts `connecting → connected`). Separately, `connecting` then `failed` → `error` carrying the exact `ConnectionError` (asserts `connecting → error`). `disconnected` from `connected` → `disconnected`.
- **Reducer — message append order:** `messageReceived` appends one; two in sequence preserve arrival order. `messagesReceived` with an N-batch appends all N in order. A batch dispatched after an existing message yields `[existing, ...batch]` (order preserved across action kinds).
- **Reducer — orthogonality:** a message action leaves `status` unchanged; a status action leaves `messages` unchanged (same reference).
- **Reducer — purity:** the input state and its `messages` array are not mutated; the result's `messages` is a new reference on append; the original array is unchanged.
- **Selectors:** `selectStatus`/`selectMessages` return the current slices; `selectMessages` returns the **same reference** across a status-only change (re-render correctness) and a **new reference** after an append.
- **Store wiring:** `createSessionStore()` starts at `initialSessionState`; `store.getState().dispatch(action)` moves `getState()` accordingly; two independent `createSessionStore()` instances don't share state; the `dispatch` reference is stable across updates.
- **Type-level (`npm run typecheck`):** `selectMessages` returns `readonly MessagePayload[]`; only `dispatch` mutates the store (no setter). Optionally an `assertNever` exhaustiveness check that fails to compile if a `SessionAction` arm is dropped.

## Open questions

1. **Duplicate/backfill messages.** `message_chunk` (backfill) can re-deliver messages the store already holds (same `message_id`). #2 appends unconditionally per AC4. Dedupe-by-`message_id` — in #3 or the store — is deferred: no observed need yet; flag when `backfill_since` is wired.
2. **Reconnect and history.** Should a fresh `connecting`/`disconnected` clear `messages`? #2 keeps status and messages orthogonal (no clear). Revisit when #3 implements reconnect/backfill.
3. **`conversation_id` scoping.** `MessagePayload` carries `conversation_id`; #2 assumes a single active conversation and appends all messages. Multi-conversation routing (segment/filter by `conversation_id`) is out of scope; revisit if the UI gains conversation switching.
4. **Optimistic send.** The Composer's send (append the user's own message before the daemon echoes it) will need a dedicated action (e.g. `messageSent`) or reuse of `messageReceived`. Out of scope for #2 (no transport, no composer wiring); the sealed union extends cleanly when that ticket lands.
5. **`connected` payload width.** Carrying the whole `HelloAckPayload` is convenient and drift-free now; narrow to `{ server_id, conn_id }` later only if the UI proves it needs less.
