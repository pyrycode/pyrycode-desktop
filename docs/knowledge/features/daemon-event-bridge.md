# Daemon-event bridge (renderer)

The **renderer translation half** of the background→window bridge: a pure function that maps each typed daemon event to a session-store action, and a thin React hook that pipes the [daemon-event channel](daemon-event-channel.md) into the [session store](session-store.md). It is the connective tissue that lets the window render connection status and streamed messages from the store alone — the seam the store's own doc-comment reserves (*"translates daemon envelopes into the SessionActions dispatched here"*).

Introduced in [#19](../codebase/19.md). Lives at `src/renderer/src/store/daemonEventBridge.ts`, beside the session store. It consumes what #18 (the `DaemonEvent` union + `window.pyry.onDaemonEvent`) and #2 (`SessionAction` + the app-singleton `sessionStore`) already export, and touches nothing in `src/main` or `src/preload`. No transport is wired yet — nothing emits on the channel — but the receive-and-dispatch path is now complete end to end.

[#168](../codebase/168.md) widened `translateDaemonEvent`'s return type to `SessionAction | null` to tolerate three new `DaemonEvent` members (`debugBundleProgress`/`debugBundleSaved`/`debugBundleFailed`) that drive **no** session-store action — see § Tolerating events with no store action below. This module is the **only** exhaustive `DaemonEvent` consumer, so it is the one file any additive `DaemonEvent` change is forced to touch.

[#180](../codebase/180.md) (the [screen snapshot fetch](screen-snapshot-fetch.md)) added a fourth
no-store-action member, `snapshotReceived`, and is the concrete case study for that forced touch: the
ticket's own spec claimed "the renderer needs zero change," which held for the generic preload
channels but not for this exhaustive switch — see its "Lessons learned" in [#180 codebase
notes](../codebase/180.md). [#187](../codebase/187.md) landed the consumer this arm was reserved for
— see [Run configuration store](run-config-store.md).

[#199](../codebase/199.md) added a fifth and sixth no-store-action member, `assistantDelta` /
`turnEnd` — the transport slice of the structured-stream render vertical. Unlike `snapshotReceived`,
both carry real content (`text` is the render payload) across IPC; this bridge still maps them to
`null` because their consumer is the renderer *timeline* bridge, [#202](../codebase/202.md)'s
[conversation timeline store](conversation-timeline-store.md) — a second, independent
`assertNever`-guarded switch over the same `DaemonEvent` union that owns exactly these two arms and
returns `null` for the rest, the mirror image of this file's switch.

[#139](../codebase/139.md) added a seventh no-store-action member, `conversationsReceived` — the
[conversation list fetch](conversation-list-fetch.md) feature's reply. Like `assistantDelta`/
`turnEnd`, it carries real content (the full `ConversationSummary[]`) across IPC unminimised; this
bridge still maps it to `null` because its consumer is the conversation-list store
[#208](https://github.com/pyrycode/pyrycode-desktop/issues/208), not the session store.

[#214](../codebase/214.md) added an eighth no-store-action member, `turnState` — the coarse
turn-lifecycle scalar of the same v2 stream `assistantDelta`/`turnEnd` belong to. Like those two, its
consumer is the [conversation timeline store](conversation-timeline-store.md)'s bridge, not the
session store; this file's `translateDaemonEvent` still just returns `null`. First `DaemonEvent` arm
added since [#202](../codebase/202.md) shipped the timeline bridge, so it is also the first arm this
bridge and that one both had to add a case for at once.

## What it does

Turns each `DaemonEvent` arriving from the background process into the matching `SessionAction` (or `null`, for events the session store doesn't model) and dispatches non-null results into the one store the UI reads. Two exported symbols:

- **`translateDaemonEvent(event: DaemonEvent): SessionAction | null`** — the pure choke point. Total by construction over the sealed union; `null` is a real, non-error return value for events with no store-side effect.
- **`useDaemonEventBridge(): void`** — the only production caller. A side-effecting binding that subscribes on mount, dispatches translated actions into `sessionStore` (skipping `null`), and unsubscribes on unmount.

## How it works

### 1. The pure translation (`translateDaemonEvent`)

A `switch (event.type)` over all fourteen `DaemonEvent` arms with a `default: return assertNever(event)` exhaustiveness guard (a module-local 3-line copy of `sessionStore.ts`'s pattern — kept local rather than widening the store's public surface).

| `DaemonEvent` arm | `SessionAction` produced | conversion |
|---|---|---|
| `connecting` | `{ type: 'connecting' }` | — |
| `connected` | `{ type: 'connected', ack }` | `HelloAckPayload` passed **by reference** |
| `disconnected` | `{ type: 'disconnected' }` | — |
| `failed` | `{ type: 'failed', error: { code, message, retryable } }` | **explicit three-field copy** of the wire `ErrorPayload` into a fresh store-owned `ConnectionError` |
| `messageReceived` | `{ type: 'messageReceived', message }` | `MessagePayload` passed **by reference** |
| `messagesReceived` | `{ type: 'messagesReceived', messages }` | `readonly MessagePayload[]` passed **by reference** |
| `debugBundleProgress` | `null` | consumed by the download UI (#72), not the session store |
| `debugBundleSaved` | `null` | consumed by the download UI (#72), not the session store |
| `debugBundleFailed` | `null` | consumed by the download UI (#72), not the session store |
| `snapshotReceived` | `null` | consumed by the [Run configuration store](run-config-store.md)'s data path (#187), not the session store |
| `assistantDelta` | `null` | consumed by the [conversation timeline store](conversation-timeline-store.md)'s bridge (#202), not the session store — present only for exhaustiveness (#199) |
| `turnEnd` | `null` | consumed by the [conversation timeline store](conversation-timeline-store.md)'s bridge (#202), not the session store — present only for exhaustiveness (#199) |
| `conversationsReceived` | `null` | consumed by the conversation-list store (#208), not the session store — present only for exhaustiveness (#139) |
| `turnState` | `null` | consumed by the [conversation timeline store](conversation-timeline-store.md)'s bridge (#202), not the session store — present only for exhaustiveness (#214) |

`DaemonEvent` was deliberately shaped in #18 with the same member and field names as `SessionAction`, so the six session-lifecycle arms are pass-through. The **only** non-identity session arm is `failed`: `DaemonEvent.failed` carries the wire `ErrorPayload`, `SessionAction.failed` the store-owned `ConnectionError`. They are structurally identical (`{ code, message, retryable }`) but nominally distinct per layer, so the translation copies the three fields into a fresh object rather than spreading — keeping the store shape immune to `ErrorPayload` gaining an unrelated field later. See [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) for why `ConnectionError` is a store-owned model distinct from the wire type. The three debug-bundle arms ([#168](../codebase/168.md)) are grouped fall-through cases returning `null` — see § Tolerating events with no store action.

**Exhaustiveness is the AC1 guarantee.** Adding a 10th `DaemonEvent` member with no `case` makes `event` non-`never` at the `default`, so `assertNever(event)` fails `npm run typecheck`. That type error *is* "adding a variant with no mapping is a compile-time error." [#168](../codebase/168.md) proved this in practice: adding three members to `DaemonEvent` broke this switch until matching cases landed — the forced consequence the ticket's spec called out up front.

**No mutation, no side effects, no logging.** Pure `DaemonEvent → SessionAction | null`. A `console.log(event)` here would leak `MessagePayload.text` (message bodies) to the DevTools console — the same standing guardrail as #18's emit helper.

### Tolerating events with no store action ([#168](../codebase/168.md))

Not every `DaemonEvent` drives session-store state. The three debug-bundle members report progress and results the download UI consumes directly (over the same `onDaemonEvent` subscription, outside this bridge) — the session store has no concept of a download in progress. Rather than invent a no-op `SessionAction` member (which would force `sessionStore`'s own reducer to grow a dead arm just to satisfy *its* exhaustiveness), `translateDaemonEvent`'s return type absorbs the "no action" case directly as `SessionAction | null`, and the sole call site skips the dispatch on `null`:

```ts
case 'debugBundleProgress':
case 'debugBundleSaved':
case 'debugBundleFailed':
  // No session-store action: the download UI (#72) consumes these, not the session store.
  return null
```

This keeps `DaemonEvent` and `SessionAction` as two **independently** exhaustive unions rather than forcing them into permanent 1:1 correspondence — a `DaemonEvent` member is free to exist purely for a non-store consumer, as long as this bridge's switch has a case (even a `null`-returning one) for it. The `assertNever` default arm is unchanged and stays load-bearing: a *tenth* variant with no case, `null` or otherwise, is still a compile error.

### 2. The subscription hook (`useDaemonEventBridge`)

A single `useEffect(() => { … }, [])` (empty deps — subscribe once per mount):

```ts
useEffect(() => {
  const off = window.pyry.onDaemonEvent((event) => {
    const action = translateDaemonEvent(event)
    // Debug-bundle events translate to `null` (no session-store action) — skip the dispatch.
    if (action) sessionStore.getState().dispatch(action)
  })
  return off   // effect cleanup IS the unsubscribe handle from onDaemonEvent
}, [])
```

Before [#168](../codebase/168.md) this dispatched `translateDaemonEvent(event)` unconditionally — safe when the return type was always a `SessionAction`, but `dispatch` doesn't accept `null`, so the widened return type forced this explicit skip.

- Dispatch goes to the **app-singleton** `sessionStore` (`sessionStore.getState().dispatch`) — the "one source of truth" #12 will read — not a per-hook store.
- The effect **returns the unsubscribe handle verbatim**, so teardown removes exactly the listener it registered. Under `React.StrictMode` (which `main.tsx` wraps `App` in), dev double-invokes the effect: subscribe A → cleanup unsubscribes A → subscribe B. Because #18's `onDaemonEvent` removes the *exact* handler it added, the net result is **exactly one** live listener — no duplicated dispatch, no doubled message append. A body that ignored the returned handle would leak a listener per remount and double every `messageReceived`.
- The hook reads nothing from `window` beyond `onDaemonEvent`; it never touches `ipcRenderer`, raw frames, keys, or the transport.

### 3. Wiring site (`src/renderer/src/App.tsx`)

`useDaemonEventBridge()` is called once at the top of `App()`, the renderer composition root (mounted once by `main.tsx`), so the subscription's practical lifetime is the app's. Nothing else in `App.tsx` changed.

### Data flow

```
 #18 preload bridge            useDaemonEventBridge (#19)                          store (#2)
 webContents.send ──IPC──►  window.pyry.onDaemonEvent(cb) ──►  translateDaemonEvent ──►  if (action) sessionStore.dispatch
 DAEMON_EVENT_CHANNEL       cb(event: DaemonEvent)              (DaemonEvent→SessionAction|null)  reduceSession → state
                            useEffect cleanup: off()            failed: ErrorPayload→ConnectionError
                                                                 debugBundle*: → null (skipped, #168)
```

`translateDaemonEvent` is the single pure choke point; the hook is its only production caller. The renderer reads status/messages **only** through `sessionStore` this feeds — it never re-parses frames or holds transport state. The three debug-bundle events pass through `onDaemonEvent` like any other event but are filtered out before `dispatch` — a consumer that wants them (#72) subscribes to `window.pyry.onDaemonEvent` directly, alongside this bridge, not through the store.

## Configuration and usage

- **Dispatch is synchronous.** `onDaemonEvent`'s callback runs synchronously on IPC delivery; `translate` + `dispatch` + `reduceSession` are all synchronous and pure. No timers, no async iteration — the transport (#4/#7) owns those upstream.
- **Call the hook in exactly one place.** Each `useDaemonEventBridge()` registers its own listener; App calls it once. A second mounting consumer would dispatch every event once per listener.
- **Imports** (renderer side, `@shared` alias resolves): `translateDaemonEvent` imports `type { DaemonEvent } from '@shared/ipc/events'` and `sessionStore` + `type { SessionAction }` from `./sessionStore`.

## Edge cases and limitations

- **No runtime validation at the boundary.** The producer is our own trusted main process delivering already-validated `DaemonEvent`s (validated upstream in #5/#10 before the event crosses the bridge). Per evidence-based-fix, no `zod`-style guard is added — it would defend against a bug, not an attacker, and a compromised main process is already game-over.
- **`window.pyry` is assumed present.** In the Electron renderer the preload runs before the window script, so `window.pyry` is always defined when `App` mounts. If a future test renders `<App />` in jsdom without the preload, the effect throws — stub `window.pyry` or inject the bridge at that point (no such test exists yet).
- **No backfill dedupe.** `messagesReceived` dispatches unconditionally; a re-delivered backfill batch with repeated `message_id`s would double-append (inherited from [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md)). Owned by whichever ticket wires reconnect. This bridge faithfully translates whatever the channel delivers.
- **Translation cannot fail on well-typed input** — it is a total mapping over a sealed union; the `assertNever` arm is unreachable at runtime for a valid `DaemonEvent` and exists solely as the compile-time totality guard.
- **A future `DaemonEvent` member still forces a touch-up here, `null`-returning or not.** [#168](../codebase/168.md) confirmed this module is the *only* exhaustive `DaemonEvent` consumer in the renderer — `App.tsx`/`PairingScreen.tsx` just call the hook, and `sessionStore.ts`'s own `SessionAction` exhaustiveness is untouched by events that map to `null`. Any ticket adding a `DaemonEvent` member should expect exactly this file to need a new `case`, whether or not the new event drives store state.

## Related

- [Daemon-event channel](daemon-event-channel.md) — the `DaemonEvent` union + `onDaemonEvent` subscription this consumes (#18); gained three no-store-action members in [#168](../codebase/168.md)
- [Session store](session-store.md) — the `SessionAction` write surface + app-singleton `sessionStore` this dispatches into (#2)
- [Command channel](command-channel.md) / [#168](../codebase/168.md) — the mirror-image `requestDebugBundle` command that triggers the download the three tolerated events report on
- [Screen snapshot fetch](screen-snapshot-fetch.md) / [#180](../codebase/180.md) — the `snapshotReceived` member this bridge tolerates as a fourth `null`-returning case, and the concrete "renderer needs zero change" correction
- [Thread timeline (conversation model)](thread-timeline.md) / [#199](../codebase/199.md) — the `assistantDelta`/`turnEnd` members this bridge tolerates as a fifth and sixth `null`-returning case; both carry real content (unlike the four members above) but still map to `null` here because their consumer is [#202](../codebase/202.md)'s [conversation timeline store](conversation-timeline-store.md), not this session-store bridge
- [Conversation list fetch](conversation-list-fetch.md) / [#139](../codebase/139.md) — the `conversationsReceived` member this bridge tolerates as a seventh `null`-returning case; consumed by the conversation-list store [#208](https://github.com/pyrycode/pyrycode-desktop/issues/208), not this session-store bridge
- [Conversation timeline store](conversation-timeline-store.md) / [#214](../codebase/214.md) — the `turnState` member this bridge tolerates as an eighth `null`-returning case; the third arm the timeline bridge owns, alongside `assistantDelta`/`turnEnd`
- [ADR 0004 — Renderer session store: reducer + sealed actions + wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the `failed → ErrorPayload → ConnectionError` seam
- [#19 codebase notes](../codebase/19.md) · Spec: `docs/specs/architecture/19-translate-daemon-events-to-session-actions.md` · [#168 codebase notes](../codebase/168.md) · Spec: `docs/specs/architecture/168-debug-bundle-ipc-contract.md`
