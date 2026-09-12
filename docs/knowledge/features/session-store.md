# Session store

The renderer's single source of truth for the active session: its connection status and its conversation message list, in one Zustand store, mutated only through a sealed action union. It is the state foundation the connect-send-stream milestone binds onto — the [conversation shell](conversation-shell.md) renders it, the typed channel dispatches into it.

Introduced in [#2](../codebase/2.md). Lives at `src/renderer/src/store/sessionStore.ts`. Pure renderer state — no IPC, no preload bridge, no transport, no import from `src/main/`. Both sides are now bound: the [daemon-event bridge](daemon-event-bridge.md) ([#19](../codebase/19.md) — "#3" in this store's older doc comments, pre-renumber) translates each `DaemonEvent` to a `SessionAction` and dispatches it here (write side); the [conversation shell](conversation-shell.md) reads `selectMessages` into the thread ([#69](../codebase/69.md) — "#12" in older comments, pre-renumber), rendering streamed replies as they land. See [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) for why it is shaped this way.

## What it does

Holds three facets of one session as one state object:

- **`status`** — a `ConnectionStatus` discriminated union on `type`: `disconnected` (initial), `connecting` (dialing + Noise handshake), `connected` (carries the wire `HelloAckPayload`), `error` (carries a `ConnectionError`). The **most recently written** status across every connection — app-wide, not per-server.
- **`statuses`** — since [#1133](#one-slot-per-server-since-1133), a `ReadonlyMap<StatusOrigin, ConnectionStatus>`: the same status values, filed one slot per server.
- **`messages`** — an ordered, read-only `readonly MessagePayload[]` of the active conversation, in arrival order.

State changes **only** through a dispatched `SessionAction`. Components read via selectors and dispatch actions; there is no two-way binding and no exposed setter.

## How it works

### State shape and actions

```ts
interface SessionState {
  status: ConnectionStatus                               // most recently written, across every server
  statuses: ReadonlyMap<StatusOrigin, ConnectionStatus>   // one slot per server (#1133)
  messages: readonly MessagePayload[]                     // wire MessagePayload, reused verbatim
}

type SessionAction =
  | { type: 'connecting'; serverId?: string | null }
  | { type: 'connected'; ack: HelloAckPayload; serverId?: string | null }
  | { type: 'disconnected'; serverId?: string | null }
  | { type: 'failed'; error: ConnectionError; serverId?: string | null }
  | { type: 'messageReceived'; message: MessagePayload }             // ← one `message` envelope
  | { type: 'messagesReceived'; messages: readonly MessagePayload[] } // ← one `message_chunk` batch
  | { type: 'messageSent'; message: MessagePayload }                  // ← a local optimistic echo (#66)
  | { type: 'reset' }                                                 // ← back to initialSessionState (#166; dispatched from clearPairingScopedState.ts since #531)
```

The four status arms' `serverId` is **optional**, since [#1133](#one-slot-per-server-since-1133): every pre-existing arg-less status dispatch — in tests and in `clearPairingScopedState` — keeps compiling and behaving exactly as before, filing under the unstamped slot.

The first two message actions mirror the two wire envelope types 1:1, so #3's translation is obvious; `messageSent` ([#66](../codebase/66.md)) is a **locally-composed** echo dispatched by the composer, given a distinct name to document intent (not a daemon delivery) though its reducer body is identical. `message_chunk` is a **batch of complete messages** (backfill), not partial-token streaming — the reducer appends whole messages; there is no per-`message_id` token accumulator.

`ConnectionError` (`{ code, message, retryable }`) is a renderer-owned shape for
connection failures. Main classifies wire errors and transport failures into
client-owned codes and copy; raw daemon error text is not copied across IPC.
The connection banner selects fixed copy from the code, never `error.message`.

### The reducer

`reduceSession(state, action): SessionState` is a **pure, exported** function — no mutation, returns fresh state — and the primary unit under test.

| action | effect |
|---|---|
| `connecting` / `connected` / `disconnected` / `failed` | set `status` to the target **and** file it into `statuses` under `action.serverId` (#1133); `messages` untouched |
| `messageReceived` | append one via `appendUnique` (dedupe by `message_id`) |
| `messagesReceived` | append batch via `appendUnique`, in order |
| `messageSent` | append one optimistic echo via `appendUnique` (#66); identical body to `messageReceived` |
| `reset` | return `initialSessionState` — clears **all three** facets, `statuses` included, in one step (#166, widened #1133) |

Invariants it holds:

- **Status and messages are orthogonal.** Status actions never touch `messages`; message actions never touch `status` or `statuses`. No status action clears history.
- **Unconditional set, no transition guards.** Each status action sets its target regardless of the current status. Ordering is the caller's (#3's) responsibility.
- **Purity.** Input state, its `messages` array and its `statuses` map are never mutated; every append allocates a new array, every status write allocates a new map (`new Map(state.statuses)` then `set`, via a module-local `withStatus` helper). Results are built from `state.status`/`state.statuses`/`state.messages` explicitly (no `...state` spread), keeping `reduceSession` a clean `SessionState → SessionState` function independent of the store's `dispatch` field.
- **Exhaustiveness.** A `default` arm calls `assertNever(action: never)` — a compile-time error if a `SessionAction` variant is added without a reducer case. (Compile-time only; no runtime reject branch.)

### One slot per server, since #1133

`status` alone reports whichever connection changed most recently and nothing about the others. Since
[#1117](daemon-connection-routing.md) the registry dials one connection per paired server, and on a
healthy connection the next status change is never — so a second server's leg could read wrong for the
life of the window. `statuses` fixes that by filing every status write into its own slot as well as the
shared cell: `withStatus` writes the *same* `ConnectionStatus` object reference to both places, so
`selectStatus` and `selectStatusFor(origin)` can never disagree about the connection that just moved,
and an untouched server's slot comes back by reference (no re-render for a component watching it).

`status` remains the most-recently-written compatibility cell. Host and thread decisions use
`statuses`: the sidebar's `HostConnectionDotsControl` selects its own `serverId`, while
`ConversationScreen`'s `useOpenConnectionStatus` resolves the open conversation against the
client-stamped conversation list, then selects that server's slot. The composer send gate, connection
banner and repair/error slot all use this hook. Missing, unstamped or ambiguous attribution, or an
unreported slot, renders as disconnected; another host's status is never a fallback. The refusal
Switch back handler also rechecks the open host's connected state at interaction time.

A healthy B must keep its composer usable when A rejects pairing afterward. Neither the last-written
cell nor an "any host connected" fold can answer whether a particular conversation can send.
`e2e/host-row-per-server.spec.ts` waits for B's **daemon** to settle offline before asserting A's
editable input, enabled Send, absent error/repair UI and unchanged dots. A relay-dot change alone
can precede the daemon failure and let those absence assertions pass too early.

Automatic recovery is a different decision: `automaticRecoveryTarget` in `PairedShell.tsx` reads
only slots named by the current `ServerInfoState.servers` list. Any connected saved host prevents
automatic opening; any connecting or unreported host defers it. Once every saved host has settled,
the first `error` with code `pairing-rejected` in saved order is the target. Disconnected and generic
error states alone do not trigger recovery. Stale map entries for removed hosts, including a connected
one, have no vote. Keep `selectStatusFor`'s `undefined` result intact for this decision: the sidebar's
offline-looking launch dot is a display fallback, not evidence that the host has settled.
See [routing](paired-shell-routing.md#host-recovery-and-navigation-lifetime) for outage suppression.

Rejection preservation belongs to [the daemon connection](daemon-connection.md#pairing-rejection-lifetime),
not this unconditional reducer. An exact decoded `auth.invalid_token` yields the client-owned
`pairing-rejected` category and the notice: "Your pairing has expired or is no longer valid. Enter a
new pairing code to reconnect." The connection retains that reason through later generic send/close
failures and clears its latch on a valid handshake. A reconnect or credential replacement for A cannot
clear B's rejection. The decoder and connection unit tests cover exact classification, private-text
exclusion, the rejection/send/close sequence, reconnect reset and independent connections.

`StatusOrigin = string | null | undefined` is the renderer-side twin of
[`liveWindow.ts`'s same-named type](live-window.md#one-slot-per-server-since-1121) (main-side, #1121,
the precedent this ticket mirrors) — same three cases, same reasoning, kept as two separate copies
because the renderer may not import `src/main/`. A third consumer of the shape did appear — #1134,
[the relay-link store's own keying](relay-link-store.md#one-slot-per-server-since-1134) — and still
declined a `src/shared/` lift: the lift's value is unifying all three declarations, and the third,
`liveWindow.ts`, sits in `src/main/`, which #1134 didn't touch. The blocker is the main-side edit, not
the consumer count, so the domain stays a third honest copy (`RelayLinkOrigin`) rather than a shared
type with one holdout:

- a **string** — one slot per paired server;
- a **present `null`** — `connectionRegistry`'s not-paired stand-in, dialled like any other connection;
- **absent** (`undefined`) — no origin at all; unreachable in production, reachable only from a test
  that dispatches a bare action literal. Recording it instead of dropping it keeps the reducer total.

The index is a `Map`, never a bare object — `ServerOrigin`'s header in `shared/ipc/events.ts` rules
this for any consumer that indexes by the id, since a `__proto__` id would otherwise write through
`Object.prototype`. The origin is read **only** from [#1068](daemon-event-bridge.md)'s stamp, in the
bridge's `originOf` — never from a payload field, in particular never from `connected`'s
`ack.server_id`, which is a distinct, daemon-supplied value a hostile or confused daemon could set to
another server's id. See [Daemon-event bridge](daemon-event-bridge.md) for `originOf` itself.

### Store, singleton, hook, selectors

```ts
createSessionStore(init = initialSessionState, observe?)  // vanilla createStore — one isolated instance per test (DI seam)
sessionStore                                                // app-wide singleton — the "one source of truth"
useSessionStore(selector)                                   // React binding: useStore(sessionStore, selector)
selectStatus(s) / selectMessages(s)                          // the app-wide / message read surface
selectStatusFor(origin)(s)                                   // one server's slot (#1133), or undefined if unheard-from
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
   message / hello_ack / error     reduceSession (pure)         useSessionStore(selectStatusFor(serverId))
```

Narrow-slice selection means a status change does not re-render the thread and an append does not re-render the status row: `selectMessages` returns the **same array reference** until an append creates a new one, so Zustand's default `Object.is` equality skips the unrelated re-render.

## Configuration and usage

- **Import surface for #3** (dispatch): `import { sessionStore, type SessionAction } from '@renderer/store/sessionStore'`, then `sessionStore.getState().dispatch(action)` per received envelope.
- **Import surface for the read side:** host-specific readers use `useSessionStore(selectStatusFor(serverId))`. `selectStatus` remains available for the compatibility cell; it cannot identify an open conversation's connection.
- **The adapter seam (realized in [#69](../codebase/69.md)):** the store holds wire `MessagePayload` (`role: 'user'|'assistant'`, `message_id`, `text`); the shell's `Message` view model uses `type: 'user'|'daemon'`, `id`, `text`. `ConversationScreen` maps each payload through `toMessageViewModel` (`role: 'assistant'` → `'daemon'`, `message_id` → `id`, `conversation_id` dropped) at the store-read boundary — keeping the store's wire types drift-free per ADR 0004. See [conversation-shell](conversation-shell.md).

## Edge cases and limitations

- **Dedupe by `message_id`.** Every append routes through `appendUnique` (added in #27): a message whose `message_id` the store already holds is skipped in place (arrival order preserved), and the array reference is returned unchanged when nothing new is added, so a pure duplicate does not churn selectors. This covers `message_chunk` backfill overlap and — since [#66](../codebase/66.md) — the optimistic-send → daemon-echo case (the same-`message_id` echo drops against the local copy).
- **History is never cleared by a status action.** A fresh `connecting`/`disconnected` leaves `messages` intact (status and messages are orthogonal). The one action that *does* clear both facets is `reset` ([#166](../codebase/166.md)) — a distinct, explicit mutation for when a pairing ends, not a side effect of any connection-status transition. The shared `clearPairingScopedState` helper dispatches it when explicit removal ends the last pairing. Adding another host or repairing an existing one ends no pairing and does not clear this state.
- **`reset` clears only this store's three facets — it is not the whole pairing-scoped clear.** Before [#179](../codebase/179.md) moved the visible thread onto `timelineStore.items`, resetting `sessionStore` alone was sufficient to hide a previous pairing's conversation. It no longer is: `reset` says nothing about the timeline rows, the active conversation, or the daemon session id, all of which latch independently. [`clearPairingScopedState`](paired-shell-routing.md#the-pure-view--container-pairedshelltsx) ([#531](../codebase/531.md)) owns the full four-store set this action is one member of.
- **Single active conversation.** `MessagePayload` carries `conversation_id`, but #2 appends all messages to one list; multi-conversation routing is out of scope.
- **Optimistic send (realized in [#66](../codebase/66.md)).** The composer's own-message echo dispatches the dedicated `messageSent` action, appending a wire `MessagePayload { role: 'user' }` through `appendUnique`. Carrying the **same `message_id`** sent on the wire is what lets the daemon's later echo dedupe against the optimistic copy instead of double-posting. See [Composer send](composer-send.md).
- **Synchronous only.** The store does no async work, no I/O, no subscriptions to tear down; #3/#4 own the channel, cancellation, and teardown and call `dispatch` synchronously.
- **Recovery preserves state.** Opening, cancelling and completing a same-host re-pair do not dispatch `reset` or erase held conversations. The shell subscribes to `statuses` for automatic recovery; individual host and conversation controls select one slot. Explicit removal remains in Settings.

## Related

- [ADR 0004 — Renderer session store: reducer + sealed actions + wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md)
- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the #19 seam that translates `DaemonEvent`s and dispatches them into this store; its `originOf` (#1133) is the only place the per-server `serverId` on a status action is derived, from #1068's stamp
- [Live window](live-window.md#one-slot-per-server-since-1121) — #1121, the main-side precedent for the same `Map<StatusOrigin, …>` shape, applied to the reopened-window status cache
- [Relay-link store](relay-link-store.md#one-slot-per-server-since-1134) — #1134, the third application of this shape: the relay leg the same host row reads next to this one, keyed by its own `RelayLinkOrigin` rather than an import of `StatusOrigin`
- [Conversation shell](conversation-shell.md) — its composer, connection banner and repair slot read the open host's connection status
- [Composer send](composer-send.md) — dispatches the `messageSent` optimistic-echo action into this store ([#66](../codebase/66.md))
- [Unpair channel](unpair-channel.md) — the main-side bridge whose `ok` result triggers the pairing-ended clear ([#173](../codebase/173.md)); `runUnpair` itself no longer dispatches `reset` directly as of [#531](../codebase/531.md)
- [Paired shell](paired-shell.md) — `clearPairingScopedState` ([#531](../codebase/531.md)), the shared helper `reset` is dispatched through; unpair alone since [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141) — pairing another server adds a server rather than ending one, and stopped clearing anything
- [Renderer→main diagnostics channel](diagnostics-channel.md) / [#134 codebase notes](../codebase/134.md) — the optional `observe` seam that logs every transition as a content-free record
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md) · [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md)
- [#2 codebase notes](../codebase/2.md) · [#166 codebase notes](../codebase/166.md) · Spec: `docs/specs/architecture/2-connection-and-conversation-state-store.md`
