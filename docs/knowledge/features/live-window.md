# Live window

The composition root's single indirection for "which `BrowserWindow` is current." On macOS the app
survives its window being closed (`window-all-closed` quits only on non-darwin) and the daemon
connection keeps running, so nothing in the root may capture a `BrowserWindow` reference once and hand
it to every window-bound consumer — the moment the window is closed, every captured reference goes
stale, and a dock-reopened replacement is invisible to all of them. [#518](../codebase/518.md) made
every reach into a stale reference safe (a no-op instead of a crash); [#519](../codebase/519.md) is
what makes a reopened window actually work, by routing everything through this module instead of a
raw window reference.

## What it does

`createLiveWindow(): LiveWindow` (`src/main/liveWindow.ts`) returns two faces plus two operations:

```ts
export type WindowTarget = DaemonEventSink & FocusableWindow & ActivatableWindow

export interface LiveWindow {
  attach(window: WindowTarget): void
  readonly sink: DaemonEventSink
  readonly window: FocusableWindow & ActivatableWindow
  replayStatus(): void
}
```

- **`sink`** — the process-lifetime channel handed to the [daemon connection](daemon-connection.md)
  and the [debug-bundle orchestrator](debug-bundle-orchestrator.md). Records the last of the four
  connection-status [`DaemonEvent`](daemon-event-channel.md) members
  (`connecting`/`connected`/`failed`/`disconnected`) **per server** (\#1121), then forwards every event
  one hop down through `emitDaemonEvent`.
- **`window`** — the current-window stand-in for [push notifications](push-notifications.md)' focus
  query and click activation.
- **`attach(window)`** — makes `window` the current one. Assignment only: does not clear any recorded
  status (connection state is independent of windows — surviving the gap is what makes convergence
  correct) and does not replay (the renderer hasn't subscribed yet at attach time, which is window
  creation).
- **`replayStatus()`** — re-delivers every server's last recorded status event into the current window,
  each with its own `serverId` intact, in the order the servers first reported (\#1121). No-op if
  nothing has been recorded (the first window's path).

Exactly two mutable cells, both plain fields (the current window, a `Map` of per-origin status). No
store, no timer, no listener, no async work — every read is a call-time query, so the answer is correct
regardless of when the window was destroyed relative to the last event, and there is no
check-then-act gap.

## One slot per server, since #1121

The recorder shipped in #519 as a single cell — correct for the one-connection world it was built in.
Since #1117 (see [Daemon connection routing](daemon-connection-routing.md)) the registry holds one
connection per paired server, and every one of them wrote that same cell: a reopened window learned the
state of whichever connection emitted most recently and nothing about the others, and on a healthy
connection the next status change is never — so every other server's sidebar dot (#1070) stayed wrong
for the life of the window. This was a live defect on any machine paired with more than one server, not
a prospective one.

The fix widens the cell into `Map<StatusOrigin, StatusEvent>`, keyed by the origin
[#1068](daemon-event-channel-plumbing.md) already stamps onto every event before it reaches the sink.
`StatusOrigin` is `string | null | undefined`, and the recorder is the first main-side consumer to index
by `serverId` — so the index is a `Map`, never a bare object, per `ServerOrigin`'s standing ruling in
`src/shared/ipc/events.ts` (a `__proto__` id would otherwise write through `Object.prototype`).
`conversationRouter`'s `index` ([Daemon connection routing](daemon-connection-routing.md)) is the
existing precedent for the same ruling.

Three keys, deliberately, not two:

- a **string** — one slot per paired server, the point of the widening;
- a **present `null`** — a producer bound while holding no paired record. Live, not hypothetical:
  `connectionRegistry`'s not-paired stand-in is built with `serverId: null` and is dialled like any
  other connection, so its `failed(not-paired)` genuinely lands here;
- **absent** (`undefined`) — a producer that never went through a binding at all. Unreachable in
  production (every producer is bound exactly once), but reachable from tests, which emit bare
  literals; recording it keeps the recorder total rather than silently dropping an unbound status.

`null` and `undefined` stay distinct rather than being coalesced, because that is the one place
`ServerOrigin`'s present-null-vs-absent-property distinction becomes observable in a running consumer.
The origin is read only from the stamp (a module-local `originOf`, the same `in`-guard-plus-`typeof`
idiom as `conversationRouter`'s), never from a payload field such as `connected`'s `ack.server_id` — a
distinct, daemon-supplied value that would let a confused daemon overwrite another server's cached
status if it were trusted instead.

`Map` iteration is insertion order, and re-`set`ting an existing key does not move it — so replay order
is the order the servers first reported, and a server that changes state keeps its original slot. That
is a property of `Map` itself, not something the module maintains. Growth is bounded by the number of
distinct origins (one per paired server, plus at most the two non-server keys), never by anything a
daemon sends, and nothing is ever evicted: a torn-down server's last status is `failed` or
`disconnected`, which is exactly what a reopened window should be told.

Retention is otherwise unchanged: `StatusEvent` and `isStatusEvent` still enumerate the same four
members by hand, so a stamped `messageReceived` still opens no slot and `MessagePayload.text` still
never reaches this module's memory.

## Why two faces with opposite `isDestroyed()` contracts

This is the one non-obvious decision in the module, and it's forced rather than chosen.

`sink.isDestroyed()` is **always `false`**. The recorder must sit *above* [#518](../codebase/518.md)'s
destroyed-window guard: if the sink answered honestly, an event emitted while no window exists would
return early inside `emitDaemonEvent` and never be recorded, so a status change during the
closed-window gap would be missed — `replayStatus()` would then deliver a **stale** value into the new
window. Not theoretical: [#504](../codebase/504.md)'s unpair teardown settles permanently at
`failed(not-paired)` with no further event ever; a window reopened afterward would be told `connected`
and would keep saying so forever. Replaying a stale status is worse than replaying none. So the sink
is not a window pretending to be one — it's the process-lifetime channel *to* whatever window is
current, and it drops one hop down through `emitDaemonEvent`, keeping that guard load-bearing rather
than dead code.

`window.isDestroyed()` is **honest** — `true` when nothing has been attached, or the attached window
reports destroyed. `windowHasFocus`/`activateWindow` (see [push notifications](push-notifications.md))
decide whether to act by asking `isDestroyed()` first, so here the truthful "there is no window right
now" is exactly what's wanted: a closed window cannot hold focus (so a notification still fires), and
a click with no window stays the total no-op #518 made it.

`WindowTarget = DaemonEventSink & FocusableWindow & ActivatableWindow` is the answer to a question
[#518](../codebase/518.md) left open — whether these three structural interfaces collapse into one now
that a live-window holder exists. They don't; they **intersect**, here, in the one module that needs
all three at once. Merging them would force every leaf consumer to depend on members it doesn't use
and widen four existing sink test fixtures for no gain — so no interface changed and no fixture
cascaded.

## Wiring: one call site, one load handler

`src/main/index.ts` holds no `BrowserWindow` reference at all — the composition root's former
`const mainWindow = createWindow()` became `const live = createLiveWindow()`, constructed before the
[daemon connection](daemon-connection.md) (which captures `live.sink` at construction). Window
creation moved into a root-local `openWindow()`, called once for the first window and again from the
`activate` handler (which used to discard its replacement window outright):

```ts
const openWindow = (): void => {
  const window = createWindow()
  live.attach(window)
  window.webContents.on('did-finish-load', () => {
    live.replayStatus() // no-op on the first window: nothing recorded yet
    connection.start()  // idempotent (daemonConnection.ts:1477-1482)
  })
}
```

One uniform path for every window — no "is this the first one?" branch. The first window has nothing
recorded and dials; every later (reopened, or dev-HMR-reloaded) window replays its status and
`start()` no-ops. `reconnect()` is never called from this path — it tears the session down and
re-dials, which would kill a streaming turn; `start()`'s idempotence is what makes replay-then-start
safe everywhere. The listener is `.on`, not the prior `.once`: safe because of that same idempotence,
and it additionally converges a window that reloads without closing (Cmd-R, dev HMR).

Attach happens at window **creation**, not at load: between the two, the new window is already
current, so a notification click landing in that gap activates it correctly. Daemon events arriving in
that same gap are forwarded into a renderer that hasn't subscribed yet and are dropped — identical to
the very first window's pre-existing behaviour, and the reason `start()` waits for the load at all.
Status isn't among those losses: `replayStatus()` runs at the load, after the gap closes.

## Edge cases and limitations

- **Recovering non-status daemon events dropped while no window existed is explicitly out of
  scope.** A turn streaming through the closed-window gap still loses its deltas on reopen; only
  connection *status* converges. The seam for a future fix, if one is ever filed, is `replayStatus()`.
  Recorded in [#518](../codebase/518.md)'s carried-forward gaps and [#519](../codebase/519.md)'s scope
  boundary.
- **A fifth connection-status `DaemonEvent` member would be silently unrecorded.** `StatusEvent`'s
  `Extract<…>` and `isStatusEvent`'s `switch` both enumerate the four members by hand with
  `default: return false` — adding a member wouldn't fail to compile the way *removing* one would.
  Flagged in code review as a NIT, not fixed: no fifth member exists or is planned, and adding
  `assertNever` here would diverge from house style (only the three renderer bridges carry it).
- **Relay-link status does not converge on reopen.** `relayLinkStore`'s initial `status: null` is only
  set by `relayLinkChanged`, so a reopened window's relay-status banner sits at the unknown sentinel
  until the next relay transition. Squarely inside the "dropped events are not recovered" exclusion;
  `null` is an honest unknown, not a false "connected".
- **`replayStatus()` is indistinguishable from a live connect**, by design. A fresh window's stores are
  empty, so a replayed `connected` is that window's first `connected` and drives exactly what a real
  one would — including [`conversationListBridge`](daemon-event-channel.md)'s rising-edge conversation
  request. Costs no renderer code, and duplicate-request fan-out can't happen because at most one
  window exists at a time.
- **No `'closed'` listener, no cached destroyed flag.** Every `isDestroyed()` read is a call-time
  query on the attached window itself — the same discipline `windowHasFocus`/`activateWindow` already
  used pre-#519, applied here to avoid a second source of truth that could disagree with the object.

## Related

- [#519 codebase notes](../codebase/519.md) — implementation summary, the code-review MUST FIX/rework
  cycle over AC2's delivery-timing proof, and patterns/lessons.
- [#518 codebase notes](../codebase/518.md) — the destroyed-window guard this module's sink and window
  face both forward through; its open question 3 (do the three interfaces collapse?) is answered here.
- [#504 codebase notes](../codebase/504.md) — the unpair teardown that makes "the sink must never
  report itself destroyed" a concrete requirement rather than a hypothetical.
- [Daemon connection](daemon-connection.md) — the connection's `deps.sink` is `live.sink`; its
  `start()` idempotence is what the replay-then-start load handler relies on. Since #1068 the
  connection's actual emit target is `bindServerOrigin(live.sink, deps.serverId)`, a wrapper the
  connection builds itself — `live.sink` remains the bind *target*, and this module (and its status
  recorder) sit downstream of that wrapper, storing and replaying already-stamped events.
- [Push notifications](push-notifications.md) — the `notify` closure's focus query and click
  activation route through `live.window`/`live.sink`; since #1068 its `notificationActivated` emit goes
  through its own `bindServerOrigin(live.sink, null)`, permanently `null` because no daemon originates
  the event.
- [Debug-bundle orchestrator](debug-bundle-orchestrator.md) — its injected `emit` now closes over a
  `bindServerOrigin(live.sink, …)` wrapper bound at the composition root (#1068), not over `live.sink`
  directly — see [Daemon-event channel plumbing](daemon-event-channel-plumbing.md) for why each of the
  three emitters gets its own binding rather than one shared wrap of `live.sink`.
- [Daemon connection routing](daemon-connection-routing.md) — the connection registry (#1117) that
  turned the single-cell recorder into a live defect, and `conversationRouter`'s `index`, the existing
  `Map`-keyed-by-`serverId` precedent this module's per-server recorder (#1121) follows.
- `docs/specs/architecture/519-live-window-indirection.md` — the full architecture spec, including the
  security review (PASS, nine categories) and rejected alternatives (a `DaemonConnection` state
  accessor, a renderer-facing invoke channel, event buffering, a `'closed'` listener).
- `docs/specs/architecture/1121-per-server-status-cache.md` — the #1121 architecture spec: the
  three-key design (`string` / present `null` / absent), the security review naming `serverId`'s
  provenance as the load-bearing trust property, and the rejected alternative of eviction on unpair.
- [Session store](session-store.md#one-slot-per-server-since-1133) — #1133, the renderer-side second
  application of this module's `StatusOrigin` shape: a `statuses: Map<StatusOrigin, ConnectionStatus>`
  beside the store's existing app-wide `status` cell, following the same three-key domain and the same
  stamp-only-origin rule. Two separate copies of the type, not a shared one — the renderer may not
  import `src/main/`.
