# Relay-link store

The renderer's held copy of the **relay-socket leg's** link status — a dedicated, unidirectional
Zustand store fed by a headless subscription binding, read by the two-dot connection indicator
([#330](../codebase/330.md)) independently of the daemon-session leg already in the [session
store](session-store.md)'s `ConnectionStatus`.

Introduced in [#329](../codebase/329.md), the renderer-side retention half of the two-dot indicator
family split from [#149](../codebase/149.md): [#328](../codebase/328.md) (transport) → this ticket
(store + bridge) → [#330](../codebase/330.md) (render, shipped). Consumes the `relayLinkChanged`
`DaemonEvent` arm #328 shipped. This store delivered no visible surface of its own until #330's
`ConnectionStatusIndicatorControl` became its first reader — the same posture
[`runConfigStore`](run-config-store.md) had before #188 and [`sessionIdStore`](session-id-store.md)
had before #257.

## What it does

Retains the most recently arrived relay-link category — `'connected' | 'offline' |
'daemon-absent'` (`RelayLinkStatus`) — superseded by each new `relayLinkChanged` event. Models
**only the relay-socket leg**: dialing the relay and completing the Noise handshake are two
separate hops, and the daemon-session leg (`sessionStore.connected`, which fires only after
handshake-complete) is already honest on its own — this store does not duplicate or re-derive it.

Reactive-only, no request half: the daemon *pushes* `relayLinkChanged` unsolicited (the relay
supervisor's own retry/backoff state, not something the renderer asks for), so nothing is
requested and nothing is correlated — the same shape as [`sessionIdStore`](session-id-store.md)
and [`queueStore`](queue-store.md), and smaller than [`conversationListStore`](conversation-list-store.md)
(#208, which requests on the connected-edge).

## How it works

### The store (`src/renderer/src/store/relayLinkStore.ts`)

```ts
export interface RelayLinkState { status: RelayLinkStatus | null }   // null = not-connected yet
export type RelayLinkStore = RelayLinkState & { setRelayLinkStatus: (status: RelayLinkStatus) => void }

createRelayLinkStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
relayLinkStore                  // app-wide singleton
useRelayLinkStore(selector)      // React binding: useStore(relayLinkStore, selector)
selectRelayLinkStatus(s)         // the only read surface
```

Mirrors `sessionIdStore`'s DI-factory → singleton → hook → selector structure exactly, swapping
`sessionId: string | null` → `status: RelayLinkStatus | null`. `RelayLinkStatus` is imported
(`import type`) from `@shared/ipc/events` — the wire-owned closed union, not a redeclared copy, so
a rename of the arm's categories breaks the build here too. A **single setter**, not a reducer:
there is exactly one mutation ("record the latest category"). `setRelayLinkStatus` replaces the
whole `status` unconditionally (most-recent wins, no merge, no coercion, no validation) — the arm
already carries the final classified category (#328 drops the raw relay close code before it
crosses IPC).

`status: null` is the distinct initial not-connected state (AC1) — definitionally none of the
three wire categories, and the same "not yet arrived" sentinel every sibling store uses
(`sessionIdStore`, `conversationListStore`, `queueStore`, `runConfigStore`, `screenSnapshotStore`).
Adding a fabricated fourth string literal (e.g. `'not-connected'`) was considered and rejected — it
would invent a category the wire never emits and diverge from every sibling store's idiom.

### The data path (`src/renderer/src/store/relayLinkBridge.ts`)

Framework-free, effects injected (the `sessionIdBridge`/`queueBridge` idiom), so the whole path
unit-tests with plain spies:

```ts
translateRelayLink(event: DaemonEvent): RelayLinkStatus | null
// relayLinkChanged → event.status verbatim; every other event → null (plain `default`, not
// assertNever — this filter permanently consumes only relayLinkChanged, the sessionIdBridge/
// queueBridge posture for a 4th independent single-arm subscriber).

subscribeRelayLink(onDaemonEvent, setRelayLinkStatus): () => void
// onDaemonEvent(event => { const status = translateRelayLink(event); if (status !== null) setRelayLinkStatus(status) })
// — returns the off handle (the daemonEventBridge cleanup idiom). The guard is `!== null`, not
// truthiness, documenting "the sentinel is null" even though all three categories are truthy today.
```

### The React binding — `RelayLinkData` (same file)

A headless leaf (`RelayLinkData(): null`) mounted **unconditionally at App level**
(`src/renderer/src/App.tsx`), alongside `<SessionIdData />` / `<QueueData />` /
`<ScreenSnapshotData />` — not scoped to any future two-dot component. A `relayLinkChanged` event
can arrive at any time, including before #330 is ever mounted, so the subscriber must already be
listening. One
`useEffect(() => subscribeRelayLink(window.pyry.onDaemonEvent, status => relayLinkStore.getState().setRelayLinkStatus(status)), [])`;
`window.pyry` is dereferenced only inside the effect, so it server-renders to empty markup without
a bridge mock (the `SessionIdData` invariant). No request effect, no `useState`/`useRef`/
`useSessionStore` — reactive-only.

### Data flow

```
daemon → relay supervisor + driver → relaySupervisor/noiseRelayDriver events (#328)
  → daemonConnection classifies raw close code → relayLinkChanged{status}   (#328, content-free)
  → window.pyry.onDaemonEvent ─┬─ daemonEventBridge / timelineBridge / modalBridge   (no-op, #328)
                                └─ RelayLinkData (NEW, #329)
                                     → translateRelayLink → setRelayLinkStatus
                                     → relayLinkStore                              [last category wins]

\#330 (shipped): useRelayLinkStore(selectRelayLinkStatus) → relayLeg(status) → combined with
  daemonLeg(sessionStore's ConnectionStatus) at render time, in ConnectionStatusIndicatorControl
```

## Configuration and usage

- **Import surface**, consumed by [#330](../codebase/330.md)'s `ConnectionStatusIndicatorControl`:
  `import { useRelayLinkStore, selectRelayLinkStatus } from '@renderer/store/relayLinkStore'`.
- **Mount point:** `src/renderer/src/App.tsx`, `<RelayLinkData />` next to `<SessionIdData />`.
- **No component-facing setter beyond `setRelayLinkStatus`** — it is invoked only by
  `RelayLinkData`'s subscription, never two-way-bound from a component (AC4).

## Edge cases and limitations

- **Deliberately does not model the daemon-session leg.** `sessionStore.ConnectionStatus` already
  reports the combined status honestly (`connected` only after handshake-complete); folding it into
  this store would duplicate state across two sources of truth. [#330](../codebase/330.md) reads
  both stores and combines them at render time via its `relayLeg`/`daemonLeg` mapping functions.
- **No terminal-state handling.** A fatal session close (`4401`/`4421`/`4426`) is a session-level
  rejection delivered *through* a relay that was reachable — per #328's forward decision, it does
  **not** emit a `relayLinkChanged` event, so this store's `status` is left at its last value
  (likely stale `'connected'`) while `sessionStore` transitions to `failed`. [#330](../codebase/330.md)
  decided **not** to reconcile this: the relay dot legitimately renders up while the daemon dot
  renders down — the two legs never cross-reference, by design.
- **No reconnect-countdown category.** The relay supervisor exposes no remaining-backoff value, so
  there is no honest way to emit a "reconnecting in Ns" status; `events.ts` names this as future
  work, not built.
- **No correlation, no reset.** Nothing is requested, so there is nothing to time out or retry — the
  store keeps its last category for the whole app lifetime; there is no "close" event to reset on.

## Related

- [Daemon connection](daemon-connection.md) — the `onDriverEvent` classification choke point that
  emits the `relayLinkChanged{status}` arm this store's bridge consumes (#328).
- [Daemon-event bridge](daemon-event-bridge.md) — the `relayLinkChanged` arm's exhaustiveness entry;
  the three existing bridges no-op it (#328), and this store is its first real consumer (#329).
- [Session-id store](session-id-store.md) — the direct structural template this store clones
  (DI-factory → singleton → hook → selector, reactive-only, `null` sentinel), chosen over
  `conversationListStore` because the arm is unsolicited with no request half.
- [Conversation list store](conversation-list-store.md) — the #208 precedent ("a dedicated
  content-free arm gets its own store, not a `sessionStore` facet") both this store and its ticket
  cite, though the request/connected-gate shape itself is *not* mirrored here.
- [Session store](session-store.md) — holds the daemon-session leg (`ConnectionStatus`) this store
  deliberately does not model; #330 combines both at render time.
- [Conversation shell](conversation-shell.md#two-dot-relaypyrycode-connection-status-indicator-330) —
  the two-dot indicator this store's first reader (`ConnectionStatusIndicatorControl`) renders into.
- [#328 codebase notes](../codebase/328.md) — the transport slice that classifies the raw relay
  close code into `RelayLinkStatus` and emits the arm this store consumes.
- [#329 codebase notes](../codebase/329.md) — implementation summary and patterns established.
- [#330 codebase notes](../codebase/330.md) — the two-dot render slice, this store's first reader,
  which decided to leave terminal-state relay-dot presentation unreconciled (by design).
