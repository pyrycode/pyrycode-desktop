# Session store

The renderer's single source of truth for the active session: its connection status and its conversation message list, in one Zustand store, mutated only through a sealed action union. It is the state foundation the connect-send-stream milestone binds onto — the [conversation shell](conversation-shell.md) renders it, the typed channel dispatches into it.

Introduced in [#2](../codebase/2.md). Lives at `src/renderer/src/store/sessionStore.ts`. Pure renderer state — no IPC, no preload bridge, no transport, no import from `src/main/`. Nothing binds it yet: #3 (the typed background↔window channel) dispatches into it, #12 binds its selectors into the UI. See [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) for why it is shaped this way.

## What it does

Holds two facets of one session as one state object:

- **`status`** — a `ConnectionStatus` discriminated union on `type`: `disconnected` (initial), `connecting` (dialing + Noise handshake), `connected` (carries the wire `HelloAckPayload`), `error` (carries a `ConnectionError`).
- **`messages`** — an ordered, read-only `readonly MessagePayload[]` of the active conversation, in arrival order.

State changes **only** through a dispatched `SessionAction`. Components read via selectors and dispatch actions; there is no two-way binding and no exposed setter.

## How it works

### State shape and actions

```ts
interface SessionState {
  status: ConnectionStatus
  messages: readonly MessagePayload[]   // wire MessagePayload, reused verbatim
}

type SessionAction =
  | { type: 'connecting' }
  | { type: 'connected'; ack: HelloAckPayload }
  | { type: 'disconnected' }
  | { type: 'failed'; error: ConnectionError }
  | { type: 'messageReceived'; message: MessagePayload }             // ← one `message` envelope
  | { type: 'messagesReceived'; messages: readonly MessagePayload[] } // ← one `message_chunk` batch
```

The two message actions mirror the two wire envelope types 1:1, so #3's translation is obvious. `message_chunk` is a **batch of complete messages** (backfill), not partial-token streaming — the reducer appends whole messages; there is no per-`message_id` token accumulator.

`ConnectionError` (`{ code, message, retryable }`) is a renderer-owned mirror of the wire `ErrorPayload`. It exists so that failures with **no** wire `ErrorPayload` — a silent Noise-handshake failure, a dropped socket — synthesize `code: 'transport' | 'handshake'` and land in the same `status.error` shape the UI banner reads. A wire `error` envelope simply copies its fields across.

### The reducer

`reduceSession(state, action): SessionState` is a **pure, exported** function — no mutation, returns fresh state — and the primary unit under test.

| action | effect |
|---|---|
| `connecting` / `connected` / `disconnected` / `failed` | set `status` to the target; `messages` untouched |
| `messageReceived` | `messages → [...messages, message]` (append one) |
| `messagesReceived` | `messages → [...messages, ...batch]` (append batch, in order) |

Invariants it holds:

- **Status and messages are orthogonal.** Status actions never touch `messages`; message actions never touch `status`. No status action clears history.
- **Unconditional set, no transition guards.** Each status action sets its target regardless of the current status. Ordering is the caller's (#3's) responsibility.
- **Purity.** Input state and its `messages` array are never mutated; every append allocates a new array. Results are built from `state.status`/`state.messages` explicitly (no `...state` spread), keeping `reduceSession` a clean `SessionState → SessionState` function independent of the store's `dispatch` field.
- **Exhaustiveness.** A `default` arm calls `assertNever(action: never)` — a compile-time error if a `SessionAction` variant is added without a reducer case. (Compile-time only; no runtime reject branch.)

### Store, singleton, hook, selectors

```ts
createSessionStore(init = initialSessionState)  // vanilla createStore — one isolated instance per test (DI seam)
sessionStore                                     // app-wide singleton — the "one source of truth"
useSessionStore(selector)                        // React binding: useStore(sessionStore, selector)
selectStatus(s) / selectMessages(s)              // the only read surface
```

`dispatch` is wired as `set((s) => reduceSession(s, action))` — Zustand shallow-merges the returned `{ status, messages }`, preserving the `dispatch` field (its reference stays stable across updates). The vanilla `createSessionStore` factory is the DI seam AC5 asks for: tests build an isolated store, or call `reduceSession` directly, with no global state and no React.

### Data flow

```
 #3 channel (later)                 sessionStore                 #12 components (later)
 daemon Envelope ──translate──►  dispatch(SessionAction) ──►  useSessionStore(selectMessages) ──► render
   message / hello_ack / error     reduceSession (pure)         useSessionStore(selectStatus)
```

Narrow-slice selection means a status change does not re-render the thread and an append does not re-render the status row: `selectMessages` returns the **same array reference** until an append creates a new one, so Zustand's default `Object.is` equality skips the unrelated re-render.

## Configuration and usage

- **Import surface for #3** (dispatch): `import { sessionStore, type SessionAction } from '@renderer/store/sessionStore'`, then `sessionStore.getState().dispatch(action)` per received envelope.
- **Import surface for #12** (read): `import { useSessionStore, selectMessages, selectStatus } from '@renderer/store/sessionStore'`.
- **The #12 adapter seam:** the store holds wire `MessagePayload` (`role: 'user'|'assistant'`, `message_id`, `text`); the shell's `Message` view model uses `type: 'user'|'daemon'`, `id`, `text`. #12 adapts `role: 'assistant'` → `'daemon'` and `message_id` → `id` at the component boundary (or updates `conversation.css` to key off `assistant`). See [conversation-shell](conversation-shell.md).

## Edge cases and limitations

- **No dedupe.** `message_chunk` backfill can re-deliver a message the store already holds (same `message_id`); #2 appends unconditionally. Dedupe is deferred to when `backfill_since` is wired.
- **History is never cleared.** A fresh `connecting`/`disconnected` leaves `messages` intact (status and messages are orthogonal). Reconnect-clears-history is an open question for #3's reconnect/backfill work.
- **Single active conversation.** `MessagePayload` carries `conversation_id`, but #2 appends all messages to one list; multi-conversation routing is out of scope.
- **No optimistic send.** The composer's own-message echo will need a dedicated action (or reuse of `messageReceived`) when transport lands; the sealed union extends cleanly.
- **Synchronous only.** The store does no async work, no I/O, no subscriptions to tear down; #3/#4 own the channel, cancellation, and teardown and call `dispatch` synchronously.

## Related

- [ADR 0004 — Renderer session store: reducer + sealed actions + wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md)
- [Conversation shell](conversation-shell.md) — the surface #12 binds these selectors into
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md) · [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md)
- [#2 codebase notes](../codebase/2.md) · Spec: `docs/specs/architecture/2-connection-and-conversation-state-store.md`
