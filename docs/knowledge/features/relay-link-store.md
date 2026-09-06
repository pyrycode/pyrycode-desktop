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
'daemon-absent'` (`RelayLinkStatus`) — superseded by each new `relayLinkChanged` event, **and**,
since #1134, files that same value into a slot keyed by the server it came from. Every paired
server's `DaemonConnection` emits its own `relayLinkChanged`, so before #1134 the
single cell was last-writer-wins across all of them — one server's relay socket dropping could read
as the whole app's link being down. Models **only the relay-socket leg**: dialing the relay and
completing the Noise handshake are two separate hops, and the daemon-session leg
(`sessionStore.connected`, which fires only after handshake-complete) is already honest on its own —
this store does not duplicate or re-derive it.

Reactive-only, no request half: the daemon *pushes* `relayLinkChanged` unsolicited (the relay
supervisor's own retry/backoff state, not something the renderer asks for), so nothing is
requested and nothing is correlated — the same shape as [`sessionIdStore`](session-id-store.md)
and [`queueStore`](queue-store.md), and smaller than [`conversationListStore`](conversation-list-store.md)
(#208, which requests on the connected-edge).

## How it works

### The store (`src/renderer/src/store/relayLinkStore.ts`)

```ts
export type RelayLinkOrigin = string | null | undefined   // which slot a status is filed under (#1134)

export interface RelayLinkState {
  status: RelayLinkStatus | null                            // unchanged: most recently written, app-wide
  statuses: ReadonlyMap<RelayLinkOrigin, RelayLinkStatus>   // one slot per origin (#1134)
}
export type RelayLinkStore = RelayLinkState & {
  setRelayLinkStatus: (status: RelayLinkStatus, serverId?: string | null) => void
}

createRelayLinkStore(init?)          // vanilla createStore — one isolated instance per test (DI seam)
relayLinkStore                       // app-wide singleton
useRelayLinkStore(selector)           // React binding: useStore(relayLinkStore, selector)
selectRelayLinkStatus(s)              // app-wide read — unchanged name, signature and return type; ZERO production readers since #1199
selectRelayLinkStatusFor(origin)(s)   // one server's slot (#1134); the sidebar's reader since #1199
```

Mirrors `sessionIdStore`'s DI-factory → singleton → hook → selector structure, swapping
`sessionId: string | null` → `status: RelayLinkStatus | null` and, since #1134, adding the `statuses`
facet beside it. `RelayLinkStatus` is imported (`import type`) from `@shared/ipc/events` — the
wire-owned closed union, not a redeclared copy, so a rename of the arm's categories breaks the build
here too. Still a **single setter**, not a reducer: keying does not add a second mutation, so there
remains exactly one mutation ("record the latest category, everywhere it's filed").
`setRelayLinkStatus` replaces the whole `status` unconditionally (most-recent wins, no merge, no
coercion, no validation — the arm already carries the final classified category, #328 drops the raw
relay close code before it crosses IPC) **and** writes the same value into `statuses` under the
origin, in one `set`, so the two read surfaces below can never disagree about the link that just
moved.

`status: null` is the distinct initial not-connected state (AC1) — definitionally none of the
three wire categories, and the same "not yet arrived" sentinel every sibling store uses
(`sessionIdStore`, `conversationListStore`, `queueStore`, `runConfigStore`, `screenSnapshotStore`).
Adding a fabricated fourth string literal (e.g. `'not-connected'`) was considered and rejected — it
would invent a category the wire never emits and diverge from every sibling store's idiom.
`initialRelayLinkState.statuses` is an empty `Map`, so "before any event arrives" needs no special
case: every per-server read starts at `undefined` ("not heard from") the same way the app-wide cell
starts at `null`.

### One slot per server, since #1134

`status` alone reports whichever connection changed most recently and nothing about the others.
Since [#1117](daemon-connection-routing.md) the registry dials one connection per paired server, and
on a healthy relay socket the next status change is never — so a second server's relay leg could read
wrong for the life of the window. `statuses` fixes that by filing every write into its own slot as
well as the shared cell, via a module-local `withSlot(statuses, origin, status)` that copies
copy-on-write (`new Map(held)` then `set`, never a mutation of the map the previous state held) — so
an untouched server's slot comes back by reference and a component watching only that server does not
re-render when a different one changes.

`status` itself is **not** reshaped into the index — it stays the single most-recently-written cell,
byte-for-byte its pre-#1134 behaviour, kept for the initial-frame guarantee it was shipped for (see
below) rather than for a live reader. `HostConnectionDotsControl` was this store's one production reader
until [#1199](https://github.com/pyrycode/pyrycode-desktop/issues/1199) moved it onto
`selectRelayLinkStatusFor`, so `selectRelayLinkStatus` now has **zero** production readers — only its own
tests and `relayLinkBridge.test.ts` reference it. Retiring it is out of scope for #1199 and this doc is
not an argument for keeping it; `sessionStore`'s app-wide twin, `selectStatus`, is **not** in the same
position (it keeps four genuinely app-wide consumers — see [session store](session-store.md)), so do not
retire the pair together on the strength of this one. `ConversationScreen.tsx`'s `relayLeg` takes
`RelayLinkStatus | null` and it is `null` that maps to "Relay Unknown" (#719); a fold ("connected if
any server's link is") was considered and rejected — it would change what the sidebar's relay dot
says today.

This is the same three-case shape as [`sessionStore`'s `StatusOrigin`, applied to the daemon leg
since #1133](session-store.md#one-slot-per-server-since-1133), and as [`liveWindow.ts`'s original,
applied main-side since #1121](live-window.md#one-slot-per-server-since-1121):

- a **string** — one slot per paired server, the point of the keying;
- a **present `null`** — a producer bound while no paired record was in hand. Live on this leg, not
  hypothetical: `connectionRegistry`'s not-paired stand-in is built with `serverId: null` and is
  dialled like any other, so its relay socket's up/down genuinely arrives stamped `null`;
- **absent** (`undefined`) — a producer that never went through a binding. Unreachable in production,
  reachable from the tests, which emit bare event literals. Filing it keeps the write total.

`RelayLinkOrigin` is a **third, deliberately separate** declaration of this domain rather than an
import of `sessionStore`'s `StatusOrigin` or a lift into `src/shared/`. Importing `sessionStore`'s
would make this leg's key domain a dependent of the daemon leg's store module — exactly the coupling
this store's own header argues against (it is deliberately not a `sessionStore` facet). The
`src/shared/` lift was considered too — #1133 left it as an open question once a third consumer of
the shape appeared, and #1134 *is* that third consumer — but it was deferred rather than taken: the
lift's whole value is unifying all three declarations, and the third lives in `src/main/liveWindow.ts`,
which #1134 does not touch. A lift reaching two of three would leave a shared type with one
unexplained holdout, which is worse than three honest copies cross-referencing each other. The
blocker is the main-side edit, not the consumer count, so the lift's natural home is the first ticket
that already touches `liveWindow.ts`. See `docs/specs/architecture/1134-per-server-relay-link-status.md`
§ Open questions.

The index is a `Map`, never a bare object — `ServerOrigin`'s header in `shared/ipc/events.ts` rules
this for any consumer that indexes by the id, since a `__proto__` id would otherwise write through
`Object.prototype`. `liveWindow.ts`, `sessionStore.ts` and `queueStore.ts` are the existing
precedents. Growth is bounded by the distinct-origin count (one per paired server plus at most the
two non-server keys); a daemon cannot influence which key its own event carries, so nothing it sends
can mint a slot. Nothing is evicted: a torn-down server's last relay status is `offline` or
`daemon-absent`, which is exactly what a per-server reader should be told.

**Read-side provenance is a convention, not something the type system enforces**: a caller of
`selectRelayLinkStatusFor(origin)` must pass an id from this client's own paired-server list, never
one taken from a daemon-supplied field — a wire-sourced lookup key would let a confused or hostile
daemon make one host row display another server's relay state. There is no production caller yet
(#1070 is expected to be the first), so this is recorded here for that ticket rather than enforced by
a gate.

**There is no reset path to extend.** `relayLinkStore` is deliberately absent from
`clearPairingScopedState` — the daemon re-asserts relay status unsolicited — so unlike `sessionStore`
there is no whole-store clear that needed to learn about the new index.

### The data path (`src/renderer/src/store/relayLinkBridge.ts`)

Framework-free, effects injected (the `sessionIdBridge`/`queueBridge` idiom), so the whole path
unit-tests with plain spies:

```ts
translateRelayLink(event: DaemonEvent): RelayLinkStatus | null
// relayLinkChanged → event.status verbatim; every other event → null (plain `default`, not
// assertNever — this filter permanently consumes only relayLinkChanged, the sessionIdBridge/
// queueBridge posture for a 4th independent single-arm subscriber). Untouched by #1134: the origin
// rides beside the union rather than inside the arm, so it is read separately, not folded into a
// filter whose whole job is selecting one named field.

originOf(event: DaemonEvent): RelayLinkOrigin   // since #1134
// !('serverId' in event) → undefined (unbound producer); serverId === null → null (not-paired
// stand-in); a string → that string; anything else → undefined. Total by construction, never throws.

subscribeRelayLink(onDaemonEvent, setRelayLinkStatus): () => void
// onDaemonEvent(event => { const status = translateRelayLink(event); if (status !== null) setRelayLinkStatus(status, originOf(event)) })
// — returns the off handle (the daemonEventBridge cleanup idiom). The guard is `!== null`, not
// truthiness, documenting "the sentinel is null" even though all three categories are truthy today.
```

`originOf` reads [#1068](daemon-event-channel-plumbing.md)'s stamp with the same
`in`-guard-plus-`typeof` idiom as `daemonEventBridge.ts`'s own `originOf` (for `sessionStore`) and
`liveWindow.ts`'s main-side original — the fifth copy of this idiom in the tree. Exporting and
reusing `daemonEventBridge.ts`'s instead was considered and rejected: it is module-private, it
returns `sessionStore`'s `StatusOrigin`, and importing it would couple two deliberately independent
single-arm subscribers and drag this leg's key domain back onto the session store.

**The origin is read only from the stamp, never from the payload — and on this arm that is not
merely the preferred source, it is the only one available.** `relayLinkChanged`'s payload is the
closed `RelayLinkStatus` category and nothing else, so there is no `ack.server_id`-shaped alternative
field the way there is on the daemon leg (#1133). A hostile daemon on server A can flap A's own relay
status (it already could) but cannot reach B's slot: the stamp is bound main-side at connection
construction from a client-held paired record, and A's driver events only ever reach A's sink.

### The React binding — `RelayLinkData` (same file)

A headless leaf (`RelayLinkData(): null`) mounted **unconditionally at App level**
(`src/renderer/src/App.tsx`), alongside `<SessionIdData />` / `<QueueData />` /
`<ScreenSnapshotData />` — not scoped to any future two-dot component. A `relayLinkChanged` event
can arrive at any time, including before #330 is ever mounted, so the subscriber must already be
listening. One
`useEffect(() => subscribeRelayLink(window.pyry.onDaemonEvent, (status, serverId) => relayLinkStore.getState().setRelayLinkStatus(status, serverId)), [])`;
`window.pyry` is dereferenced only inside the effect, so it server-renders to empty markup without
a bridge mock (the `SessionIdData` invariant). No request effect, no `useState`/`useRef`/
`useSessionStore` — reactive-only.

### Data flow

```
daemon → relay supervisor + driver → relaySupervisor/noiseRelayDriver events (#328)
  → daemonConnection classifies raw close code → relayLinkChanged{status}   (#328, content-free)
  → window.pyry.onDaemonEvent ─┬─ daemonEventBridge / timelineBridge / modalBridge   (no-op, #328)
                                └─ RelayLinkData (NEW, #329)
                                     → translateRelayLink, originOf (#1134) → setRelayLinkStatus(status, serverId)
                                     → relayLinkStore              [status: last category wins, app-wide
                                                                     statuses: filed under serverId's own slot, #1134]

\#330 (shipped): useRelayLinkStore(selectRelayLinkStatus) → relayLeg(status) → combined with
  daemonLeg(sessionStore's ConnectionStatus) at render time, in ConnectionStatusIndicatorControl
  — this reader is gone since #1199 (below); ConnectionStatusIndicatorControl itself was retired by #962

\#1199 (shipped): useRelayLinkStore(selectRelayLinkStatusFor(serverId)) → HostConnectionDotsControl's
  relay leg, `?? initialRelayLinkState.status` (not `?? null`, so a silent server lands on the store's own
  launch-frame value rather than a restated literal) → the same relayLeg mapping. serverId is the sidebar's
  FIRST paired server; #1070 loops this per row. No whole-map selector ships until #1070 wants one.
```

## Configuration and usage

- **Import surface**, consumed by [#330](../codebase/330.md)'s `ConnectionStatusIndicatorControl`:
  `import { useRelayLinkStore, selectRelayLinkStatus } from '@renderer/store/relayLinkStore'`.
- **Per-server import surface, since #1134, no production consumer yet**:
  `import { selectRelayLinkStatusFor } from '@renderer/store/relayLinkStore'` — returns
  `RelayLinkStatus | undefined`, deliberately not defaulted, so a caller can tell "not heard from"
  apart from a reported link. Call it only with an id from the client's own paired-server list.
- **Mount point:** `src/renderer/src/App.tsx`, `<RelayLinkData />` next to `<SessionIdData />`.
- **No component-facing setter beyond `setRelayLinkStatus`** — it is invoked only by
  `RelayLinkData`'s subscription, never two-way-bound from a component (AC4). Its second,
  since-#1134 `serverId` argument is optional and origin-derived only, never settable by a component.

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
  store keeps its last category for the whole app lifetime; there is no "close" event to reset on, and
  since #1134 that includes every per-server slot — `clearPairingScopedState` does not touch this
  store at all.
- **No whole-map selector.** Nothing in the renderer can enumerate paired servers yet
  (`src/shared/ipc/commands.ts` records that as a shipped fact), so #1134 ships only the keyed store
  and the two read surfaces; a consumer that wants to enumerate slots adds that selector when it has a
  real per-server id list to drive it with (expected: #1070).

## Related

- [Daemon connection](daemon-connection.md) — the `onDriverEvent` classification choke point that
  emits the `relayLinkChanged{status}` arm this store's bridge consumes (#328).
- [Daemon-event bridge](daemon-event-bridge.md) — the `relayLinkChanged` arm's exhaustiveness entry;
  the three existing bridges no-op it (#328), and this store is its first real consumer (#329). Its
  own `originOf` (§ "1. The pure translation") is the sibling copy for the daemon leg, and the reason
  this store's `originOf` (#1134) stays a separate copy rather than an import.
- [Session-id store](session-id-store.md) — the direct structural template this store clones
  (DI-factory → singleton → hook → selector, reactive-only, `null` sentinel), chosen over
  `conversationListStore` because the arm is unsolicited with no request half.
- [Conversation list store](conversation-list-store.md) — the #208 precedent ("a dedicated
  content-free arm gets its own store, not a `sessionStore` facet") both this store and its ticket
  cite, though the request/connected-gate shape itself is *not* mirrored here.
- [Session store](session-store.md#one-slot-per-server-since-1133) — holds the daemon-session leg
  (`ConnectionStatus`) this store deliberately does not model; #330 combines both at render time. Since
  #1133 it keys that leg the same way this store keys the relay leg since #1134 — same three-case
  domain, same `Map`-beside-app-wide-cell shape, both read next to each other by the same host row.
- [Live window](live-window.md#one-slot-per-server-since-1121) — #1121, the main-side original of the
  same three-key domain; the reason `RelayLinkOrigin` stays a third local declaration rather than a
  `src/shared/` lift is that this module is out of #1134's scope.
- [Daemon connection routing](daemon-connection-routing.md) — the #1117 registry change (one
  connection per paired server) that turned the single `status` cell from a simplification into a
  live defect on this leg, same as it did on the daemon leg and in `liveWindow.ts`.
- [Conversation shell](conversation-shell-chrome.md#two-dot-relaypyrycode-connection-status-indicator-330) —
  the two-dot indicator this store's first reader (`ConnectionStatusIndicatorControl`) renders into.
- [#328 codebase notes](../codebase/328.md) — the transport slice that classifies the raw relay
  close code into `RelayLinkStatus` and emits the arm this store consumes.
- [#329 codebase notes](../codebase/329.md) — implementation summary and patterns established.
- [#330 codebase notes](../codebase/330.md) — the two-dot render slice, this store's first reader,
  which decided to leave terminal-state relay-dot presentation unreconciled (by design).
- `docs/specs/architecture/1134-per-server-relay-link-status.md` — the full architecture spec for the
  #1134 keying: the three routes weighed for the key domain's home, the security review (PASS, one
  SHOULD FIX — the read-side provenance convention above), and both open questions.
