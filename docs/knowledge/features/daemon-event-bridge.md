# Daemon-event bridge (renderer)

The **renderer translation half** of the background→window bridge: a pure function that maps each typed daemon event to a session-store action, and a thin React hook that pipes the [daemon-event channel](daemon-event-channel.md) into the [session store](session-store.md). It is the connective tissue that lets the window render connection status and streamed messages from the store alone — the seam the store's own doc-comment reserves (*"translates daemon envelopes into the SessionActions dispatched here"*).

Introduced in [#19](../codebase/19.md). Lives at `src/renderer/src/store/daemonEventBridge.ts`, beside the session store. It consumes what #18 (the `DaemonEvent` union + `window.pyry.onDaemonEvent`) and #2 (`SessionAction` + the app-singleton `sessionStore`) already export, and touches nothing in `src/main` or `src/preload`. No transport is wired yet — nothing emits on the channel — but the receive-and-dispatch path is now complete end to end.

## What it does

Turns each `DaemonEvent` arriving from the background process into the matching `SessionAction` and dispatches it into the one store the UI reads. Two exported symbols:

- **`translateDaemonEvent(event: DaemonEvent): SessionAction`** — the pure choke point. Total by construction over the sealed union.
- **`useDaemonEventBridge(): void`** — the only production caller. A side-effecting binding that subscribes on mount, dispatches translated actions into `sessionStore`, and unsubscribes on unmount.

## How it works

### 1. The pure translation (`translateDaemonEvent`)

A `switch (event.type)` over all six `DaemonEvent` arms with a `default: return assertNever(event)` exhaustiveness guard (a module-local 3-line copy of `sessionStore.ts`'s pattern — kept local rather than widening the store's public surface).

| `DaemonEvent` arm | `SessionAction` produced | conversion |
|---|---|---|
| `connecting` | `{ type: 'connecting' }` | — |
| `connected` | `{ type: 'connected', ack }` | `HelloAckPayload` passed **by reference** |
| `disconnected` | `{ type: 'disconnected' }` | — |
| `failed` | `{ type: 'failed', error: { code, message, retryable } }` | **explicit three-field copy** of the wire `ErrorPayload` into a fresh store-owned `ConnectionError` |
| `messageReceived` | `{ type: 'messageReceived', message }` | `MessagePayload` passed **by reference** |
| `messagesReceived` | `{ type: 'messagesReceived', messages }` | `readonly MessagePayload[]` passed **by reference** |

`DaemonEvent` was deliberately shaped in #18 with the same member and field names as `SessionAction`, so five of six arms are pass-through. The **only** non-identity arm is `failed`: `DaemonEvent.failed` carries the wire `ErrorPayload`, `SessionAction.failed` the store-owned `ConnectionError`. They are structurally identical (`{ code, message, retryable }`) but nominally distinct per layer, so the translation copies the three fields into a fresh object rather than spreading — keeping the store shape immune to `ErrorPayload` gaining an unrelated field later. See [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) for why `ConnectionError` is a store-owned model distinct from the wire type.

**Exhaustiveness is the AC1 guarantee.** Adding a 7th `DaemonEvent` member with no `case` makes `event` non-`never` at the `default`, so `assertNever(event)` fails `npm run typecheck`. That type error *is* "adding a variant with no mapping is a compile-time error."

**No mutation, no side effects, no logging.** Pure `DaemonEvent → SessionAction`. A `console.log(event)` here would leak `MessagePayload.text` (message bodies) to the DevTools console — the same standing guardrail as #18's emit helper.

### 2. The subscription hook (`useDaemonEventBridge`)

A single `useEffect(() => { … }, [])` (empty deps — subscribe once per mount):

```ts
useEffect(() => {
  const off = window.pyry.onDaemonEvent((event) =>
    sessionStore.getState().dispatch(translateDaemonEvent(event))
  )
  return off   // effect cleanup IS the unsubscribe handle from onDaemonEvent
}, [])
```

- Dispatch goes to the **app-singleton** `sessionStore` (`sessionStore.getState().dispatch`) — the "one source of truth" #12 will read — not a per-hook store.
- The effect **returns the unsubscribe handle verbatim**, so teardown removes exactly the listener it registered. Under `React.StrictMode` (which `main.tsx` wraps `App` in), dev double-invokes the effect: subscribe A → cleanup unsubscribes A → subscribe B. Because #18's `onDaemonEvent` removes the *exact* handler it added, the net result is **exactly one** live listener — no duplicated dispatch, no doubled message append. A body that ignored the returned handle would leak a listener per remount and double every `messageReceived`.
- The hook reads nothing from `window` beyond `onDaemonEvent`; it never touches `ipcRenderer`, raw frames, keys, or the transport.

### 3. Wiring site (`src/renderer/src/App.tsx`)

`useDaemonEventBridge()` is called once at the top of `App()`, the renderer composition root (mounted once by `main.tsx`), so the subscription's practical lifetime is the app's. Nothing else in `App.tsx` changed.

### Data flow

```
 #18 preload bridge            useDaemonEventBridge (#19)                          store (#2)
 webContents.send ──IPC──►  window.pyry.onDaemonEvent(cb) ──►  translateDaemonEvent ──►  sessionStore.dispatch
 DAEMON_EVENT_CHANNEL       cb(event: DaemonEvent)              (DaemonEvent→SessionAction)  reduceSession → state
                            useEffect cleanup: off()            failed: ErrorPayload→ConnectionError
```

`translateDaemonEvent` is the single pure choke point; the hook is its only production caller. The renderer reads status/messages **only** through `sessionStore` this feeds — it never re-parses frames or holds transport state.

## Configuration and usage

- **Dispatch is synchronous.** `onDaemonEvent`'s callback runs synchronously on IPC delivery; `translate` + `dispatch` + `reduceSession` are all synchronous and pure. No timers, no async iteration — the transport (#4/#7) owns those upstream.
- **Call the hook in exactly one place.** Each `useDaemonEventBridge()` registers its own listener; App calls it once. A second mounting consumer would dispatch every event once per listener.
- **Imports** (renderer side, `@shared` alias resolves): `translateDaemonEvent` imports `type { DaemonEvent } from '@shared/ipc/events'` and `sessionStore` + `type { SessionAction }` from `./sessionStore`.

## Edge cases and limitations

- **No runtime validation at the boundary.** The producer is our own trusted main process delivering already-validated `DaemonEvent`s (validated upstream in #5/#10 before the event crosses the bridge). Per evidence-based-fix, no `zod`-style guard is added — it would defend against a bug, not an attacker, and a compromised main process is already game-over.
- **`window.pyry` is assumed present.** In the Electron renderer the preload runs before the window script, so `window.pyry` is always defined when `App` mounts. If a future test renders `<App />` in jsdom without the preload, the effect throws — stub `window.pyry` or inject the bridge at that point (no such test exists yet).
- **No backfill dedupe.** `messagesReceived` dispatches unconditionally; a re-delivered backfill batch with repeated `message_id`s would double-append (inherited from [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md)). Owned by whichever ticket wires reconnect. This bridge faithfully translates whatever the channel delivers.
- **Translation cannot fail on well-typed input** — it is a total mapping over a sealed union; the `assertNever` arm is unreachable at runtime for a valid `DaemonEvent` and exists solely as the compile-time totality guard.

## Related

- [Daemon-event channel](daemon-event-channel.md) — the `DaemonEvent` union + `onDaemonEvent` subscription this consumes (#18)
- [Session store](session-store.md) — the `SessionAction` write surface + app-singleton `sessionStore` this dispatches into (#2)
- [ADR 0004 — Renderer session store: reducer + sealed actions + wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the `failed → ErrorPayload → ConnectionError` seam
- [#19 codebase notes](../codebase/19.md) · Spec: `docs/specs/architecture/19-translate-daemon-events-to-session-actions.md`
