# Session store

The renderer's single source of truth for the active session: its connection status and its conversation message list, in one Zustand store, mutated only through a sealed action union. It is the state foundation the connect-send-stream milestone binds onto — the [conversation shell](conversation-shell.md) renders it, the typed channel dispatches into it.

Introduced in [#2](../codebase/2.md). Lives at `src/renderer/src/store/sessionStore.ts`. Pure renderer state — no IPC, no preload bridge, no transport, no import from `src/main/`. Both sides are now bound: the [daemon-event bridge](daemon-event-bridge.md) ([#19](../codebase/19.md) — "#3" in this store's older doc comments, pre-renumber) translates each `DaemonEvent` to a `SessionAction` and dispatches it here (write side); the [conversation shell](conversation-shell.md) reads `selectMessages` into the thread ([#69](../codebase/69.md) — "#12" in older comments, pre-renumber), rendering streamed replies as they land. See [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) for why it is shaped this way.

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
  | { type: 'messageSent'; message: MessagePayload }                  // ← a local optimistic echo (#66)
  | { type: 'reset' }                                                 // ← back to initialSessionState (#166; dispatched from clearPairingScopedState.ts since #531)
```

The first two message actions mirror the two wire envelope types 1:1, so #3's translation is obvious; `messageSent` ([#66](../codebase/66.md)) is a **locally-composed** echo dispatched by the composer, given a distinct name to document intent (not a daemon delivery) though its reducer body is identical. `message_chunk` is a **batch of complete messages** (backfill), not partial-token streaming — the reducer appends whole messages; there is no per-`message_id` token accumulator.

`ConnectionError` (`{ code, message, retryable }`) is a renderer-owned mirror of the wire `ErrorPayload`. It exists so that failures with **no** wire `ErrorPayload` — a silent Noise-handshake failure, a dropped socket — synthesize `code: 'transport' | 'handshake'` and land in the same `status.error` shape the UI banner reads. A wire `error` envelope simply copies its fields across.

### The reducer

`reduceSession(state, action): SessionState` is a **pure, exported** function — no mutation, returns fresh state — and the primary unit under test.

| action | effect |
|---|---|
| `connecting` / `connected` / `disconnected` / `failed` | set `status` to the target; `messages` untouched |
| `messageReceived` | append one via `appendUnique` (dedupe by `message_id`) |
| `messagesReceived` | append batch via `appendUnique`, in order |
| `messageSent` | append one optimistic echo via `appendUnique` (#66); identical body to `messageReceived` |
| `reset` | return `initialSessionState` — clears **both** `status` and `messages` in one step (#166) |

Invariants it holds:

- **Status and messages are orthogonal.** Status actions never touch `messages`; message actions never touch `status`. No status action clears history.
- **Unconditional set, no transition guards.** Each status action sets its target regardless of the current status. Ordering is the caller's (#3's) responsibility.
- **Purity.** Input state and its `messages` array are never mutated; every append allocates a new array. Results are built from `state.status`/`state.messages` explicitly (no `...state` spread), keeping `reduceSession` a clean `SessionState → SessionState` function independent of the store's `dispatch` field.
- **Exhaustiveness.** A `default` arm calls `assertNever(action: never)` — a compile-time error if a `SessionAction` variant is added without a reducer case. (Compile-time only; no runtime reject branch.)

### Store, singleton, hook, selectors

```ts
createSessionStore(init = initialSessionState, observe?)  // vanilla createStore — one isolated instance per test (DI seam)
sessionStore                                                // app-wide singleton — the "one source of truth"
useSessionStore(selector)                                   // React binding: useStore(sessionStore, selector)
selectStatus(s) / selectMessages(s)                          // the only read surface
```

`dispatch` is wired as `set((s) => reduceSession(s, action))` — Zustand shallow-merges the returned `{ status, messages }`, preserving the `dispatch` field (its reference stays stable across updates). The vanilla `createSessionStore` factory is the DI seam AC5 asks for: tests build an isolated store, or call `reduceSession` directly, with no global state and no React.

### Diagnostics observer ([#134](../codebase/134.md))

`createSessionStore` takes an optional trailing `observe?: TransitionObserver` (`(action, state) => void`), invoked synchronously inside `dispatch` right after `set` — `get()` at that point already reflects the reduced state, since Zustand's `set` is synchronous. `dispatch` becomes:

```ts
dispatch: (action) => {
  set((s) => reduceSession(s, action))
  observe?.(action, get())
}
```

The app singleton wires it to `logSessionTransition` from the co-located `sessionDiagnostics.ts` (not inlined here, so this file keeps its documented purity — "no IPC, no preload bridge, no transport"); every isolated test store built via bare `createSessionStore()` stays observer-free. `observe` is a passive read of the post-reduce state — it never mutates state, alters accepted actions, or changes the unidirectional flow. Appended *after* `init` (not prepended), so every existing arg-less caller stayed source-compatible — zero edit fan-out. See [Renderer→main diagnostics channel](diagnostics-channel.md) for what the observer sends and why `dispatch`, not `.subscribe`, is the only seam that catches every transition (including a same-state dedup and the composer's local `messageSent` echo).

### Data flow

```
 #3 channel (later)                 sessionStore                 #12 components (later)
 daemon Envelope ──translate──►  dispatch(SessionAction) ──►  useSessionStore(selectMessages) ──► render
   message / hello_ack / error     reduceSession (pure)         useSessionStore(selectStatus)
```

Narrow-slice selection means a status change does not re-render the thread and an append does not re-render the status row: `selectMessages` returns the **same array reference** until an append creates a new one, so Zustand's default `Object.is` equality skips the unrelated re-render.

## Configuration and usage

- **Import surface for #3** (dispatch): `import { sessionStore, type SessionAction } from '@renderer/store/sessionStore'`, then `sessionStore.getState().dispatch(action)` per received envelope.
- **Import surface for the read side** (realized in [#69](../codebase/69.md)): `import { useSessionStore, selectMessages, selectStatus } from '@renderer/store/sessionStore'`.
- **The adapter seam (realized in [#69](../codebase/69.md)):** the store holds wire `MessagePayload` (`role: 'user'|'assistant'`, `message_id`, `text`); the shell's `Message` view model uses `type: 'user'|'daemon'`, `id`, `text`. `ConversationScreen` maps each payload through `toMessageViewModel` (`role: 'assistant'` → `'daemon'`, `message_id` → `id`, `conversation_id` dropped) at the store-read boundary — keeping the store's wire types drift-free per ADR 0004. See [conversation-shell](conversation-shell.md).

## Edge cases and limitations

- **Dedupe by `message_id`.** Every append routes through `appendUnique` (added in #27): a message whose `message_id` the store already holds is skipped in place (arrival order preserved), and the array reference is returned unchanged when nothing new is added, so a pure duplicate does not churn selectors. This covers `message_chunk` backfill overlap and — since [#66](../codebase/66.md) — the optimistic-send → daemon-echo case (the same-`message_id` echo drops against the local copy).
- **History is never cleared by a status action.** A fresh `connecting`/`disconnected` leaves `messages` intact (status and messages are orthogonal). Reconnect-clears-history is still an open question for #3's reconnect/backfill work. The one action that *does* clear both facets is `reset` ([#166](../codebase/166.md)) — a distinct, explicit mutation for when a pairing ends, not a side effect of any connection-status transition. Since [#531](../codebase/531.md), both paths that end a pairing (unpair, pair-another-server) dispatch it via the shared `clearPairingScopedState` helper — it moved out of `unpairAction.ts`, which used to be its sole caller, so the pair-another path stopped being the one path that left this store stale.
- **`reset` clears only this store's two facets — it is not the whole pairing-scoped clear.** Before [#179](../codebase/179.md) moved the visible thread onto `timelineStore.items`, resetting `sessionStore` alone was sufficient to hide a previous pairing's conversation. It no longer is: `reset` says nothing about the timeline rows, the active conversation, or the daemon session id, all of which latch independently. [`clearPairingScopedState`](paired-shell.md#the-pure-view--container-pairedshelltsx) ([#531](../codebase/531.md)) owns the full four-store set this action is one member of.
- **Single active conversation.** `MessagePayload` carries `conversation_id`, but #2 appends all messages to one list; multi-conversation routing is out of scope.
- **Optimistic send (realized in [#66](../codebase/66.md)).** The composer's own-message echo dispatches the dedicated `messageSent` action, appending a wire `MessagePayload { role: 'user' }` through `appendUnique`. Carrying the **same `message_id`** sent on the wire is what lets the daemon's later echo dedupe against the optimistic copy instead of double-posting. See [Composer send](composer-send.md).
- **Synchronous only.** The store does no async work, no I/O, no subscriptions to tear down; #3/#4 own the channel, cancellation, and teardown and call `dispatch` synchronously.

## Related

- [ADR 0004 — Renderer session store: reducer + sealed actions + wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md)
- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the #19 seam that translates `DaemonEvent`s and dispatches them into this store
- [Conversation shell](conversation-shell.md) — the surface that reads `selectMessages` into the thread (bound in [#69](../codebase/69.md)); its unpair control dispatches `reset` ([#166](../codebase/166.md))
- [Composer send](composer-send.md) — dispatches the `messageSent` optimistic-echo action into this store ([#66](../codebase/66.md))
- [Unpair channel](unpair-channel.md) — the main-side bridge whose `ok` result triggers the pairing-ended clear ([#173](../codebase/173.md)); `runUnpair` itself no longer dispatches `reset` directly as of [#531](../codebase/531.md)
- [Paired shell](paired-shell.md) — `clearPairingScopedState` ([#531](../codebase/531.md)), the shared helper both pairing-ending paths (unpair, pair-another-server) now dispatch `reset` through
- [Renderer→main diagnostics channel](diagnostics-channel.md) / [#134 codebase notes](../codebase/134.md) — the optional `observe` seam that logs every transition as a content-free record
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md) · [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md)
- [#2 codebase notes](../codebase/2.md) · [#166 codebase notes](../codebase/166.md) · Spec: `docs/specs/architecture/2-connection-and-conversation-state-store.md`
