# #1121 — The reopened-window status cache holds every server's last status

## Files read

Codegraph is not initialised in this repo (`codegraph_*` returns a hard "CodeGraph not initialized"),
so this reading list was built with Grep and Read instead.

- `src/main/liveWindow.ts` → `createLiveWindow`, `StatusEvent`, `isStatusEvent`, the sink's `send`,
  `replayStatus` — the single production file this ticket changes. The two mutable cells (`current`,
  `lastStatus`) and the sink's deliberately dishonest `isDestroyed` are the design surface.
- `src/main/liveWindow.test.ts` → the `fakeWindow` helper and the two `describe` blocks — every new
  case is written in its idiom (drive through the REAL `emitDaemonEvent`, assert on the returned
  `send` handle, never through `win.webContents`).
- `src/main/emitDaemonEvent.ts` → `emitDaemonEvent`, `bindServerOrigin`, `DaemonEventSink` — the
  guard the recorder must sit above, and the one place a stamp is applied. Its header's "bind exactly
  once per producer / `live.sink` is a bind target, never a producer's sink" is what makes "the event
  reaching the recorder is already stamped" true.
- `src/shared/ipc/events.ts` → `ServerOrigin`, `WithOrigin`, `StampedDaemonEvent` — the origin
  contract. Its header carries the ruling this slice is bound by: *"if a consumer indexes by it, THE
  INDEX IS A `Map`"*, and the `null`-is-present-`undefined`-is-absent distinction the key design turns
  on.
- `src/main/conversationRouter.ts` → `originOf` — the house pattern for reading the stamp off a
  `DaemonEventSink`-typed hole (`in`-guard + `typeof`, never a cast, because a re-declared
  `StampedDaemonEvent` parameter compiles only via method-parameter bivariance). Also `createConversationRouter`'s
  `index`, the existing precedent for a `Map` justified by the same events.ts ruling.
- `src/main/connectionRegistry.ts` → `buildStandIn`, `buildEntry` — where each connection's origin is
  minted (`record.server`), and the not-paired stand-in built with `serverId: null`. This is what makes
  `null` a **live** status origin rather than the merely-hypothetical one the ticket describes.
- `src/main/daemonConnection.ts` → `createDaemonConnection`'s `const sink = bindServerOrigin(deps.sink, deps.serverId)`
  — the binding that stamps all 39 emit sites, the recorder's upstream.
- `src/main/index.ts` → `openWindow`'s `did-finish-load` handler, `downloads`' per-server bind,
  `windowLocalSink` — the one `replayStatus()` call site (unchanged) and the two non-connection
  emitters (neither emits a status member).
- `e2e/window-reopen-converges.spec.ts` → the delivery proof AC5 requires to keep passing unedited.
- `docs/knowledge/features/live-window.md` → the package overview. Its "Edge cases and limitations"
  records that a fifth status member would be silently unrecorded (a NIT, deliberately unfixed); this
  slice does not change that, and does not widen `StatusEvent`.

## Context

Connection state reaches the renderer only as discrete events, and a fresh session store starts at
`{ type: 'disconnected' }`. #519 solved that for one connection by recording the last status event in
`createLiveWindow` and replaying it into a window attached later, which is what makes a macOS
close → dock-reopen converge instead of sitting at "disconnected" forever.

That recorder is a **single cell**. Since #1117 the registry holds one connection per paired server and
each stamps its own origin, so all of them write that one cell and each write overwrites the last: a
reopened window learns the state of whichever connection emitted most recently and nothing about the
others. On a healthy connection the next status change is never, so every other server's sidebar dot
(#1070, fed by #1085) stays wrong for the life of the window. This is a live defect on any machine
paired with more than one server.

The fix is contained: the events already carry their origin (#1068), and the recorder sits downstream
of the binding that applies it. One cell becomes one slot per origin.

No ADR is warranted — this is a widening inside one module, under a ruling
(`ServerOrigin`'s "the index is a `Map`") that is already recorded in `events.ts`.

## Design source

**Figma:** N/A — main-process only. This slice touches no renderer file, no component and no token;
the visible consequence is that the existing sidebar dots read correctly, with no new UI.

## Design

One production file: `src/main/liveWindow.ts`. `LiveWindow`'s four members keep their names, their
signatures and their one call site.

### The index

`let lastStatus: StatusEvent | null` becomes a `Map` keyed by the origin the event arrives carrying:

```ts
type StatusOrigin = string | null | undefined
const statuses = new Map<StatusOrigin, StatusEvent>()
```

A `Map`, never a bare object — `ServerOrigin`'s header rules it for any consumer that indexes by
`serverId`, and this slice is the first main-side consumer to do so. `conversationRouter`'s `index` is
the existing precedent for the same ruling.

The **value** type stays `StatusEvent`, not a stamped variant. The recorder forwards the same object
reference it stored, so the stamp rides along structurally exactly as it does today — the existing
`replays a stamped status with its server origin intact (#1068)` case already pins that, and a stamped
value type would claim a guarantee the sink's `DaemonEvent`-typed parameter cannot give.

### Reading the origin

The sink's `send` parameter is `DaemonEvent` (fixed by `DaemonEventSink`), so the stamp arrives
structurally and not nominally. A module-local `originOf` reads it in `conversationRouter`'s idiom —
an `in`-guard plus a `typeof` check, never a cast, and never a re-declared `StampedDaemonEvent`
parameter (which would compile only through method-parameter bivariance):

```ts
function originOf(event: DaemonEvent): StatusOrigin
```

**Three keys, deliberately, not two.** The ticket asks for this case to be decided rather than fall out
of a cast:

| What arrived | Key | Why |
| --- | --- | --- |
| `serverId: 'srv-a'` | `'srv-a'` | one slot per paired server |
| `serverId: null` | `null` | a **present** null: a producer that went through a binding holding no paired record |
| no `serverId` property | `undefined` | a producer that never went through a binding at all |

`null` and `undefined` stay distinct because `ServerOrigin`'s header draws exactly that distinction
("It is a PRESENT null, never an absent property: `undefined` here would mean an emitter that never
went through a binding at all"), and coalescing them here would erase it in the one place it becomes
observable. Note the ticket understates the `null` case: `connectionRegistry`'s `buildStandIn`
constructs the not-paired stand-in with `serverId: null` and `registry.start()` dials it, so on an
unpaired machine a `failed(not-paired)` genuinely lands in the `null` slot. It is a live origin, not a
reserved one.

`undefined` is reachable only from tests today (every production producer is bound exactly once), but
recording under it keeps the recorder total: an unbound producer's status is replayed rather than
silently dropped, which is the same choice #519 made for the pre-window case. No guard, no
normalisation, no drop.

### Recording and replaying

- `send` — unchanged except for the key: `if (isStatusEvent(event)) statuses.set(originOf(event), event)`,
  then `forward(event)`. Still above #518's guard, still one statement before the forward, so the gap
  case is untouched.
- `replayStatus()` — `for (const status of statuses.values()) forward(status)`. Signature and call site
  unchanged; `openWindow` does not learn how many servers exist.

**Order.** `Map` iteration is insertion order, and re-`set`ting an existing key does **not** move it —
so a server that changes state keeps its original slot, and the replay order is the order the servers
first reported. That is AC2's "stable (insertion) order", and it is a property of `Map` rather than
something this module maintains.

**Retention is unchanged.** `StatusEvent` and `isStatusEvent` are untouched: the same four members,
the same `Extract`, the same hand-enumerated `switch`. What grows is the number of slots, bounded by
the number of distinct origins (one per paired server, plus at most the two non-server keys) — never
by anything a daemon sends.

### What does not change

- `WindowTarget`, `LiveWindow`, `attach`, `sink`, `window`, `forward` — no signature moves, no export
  is added or removed, so there is no consumer cascade (`replayStatus` has exactly one call site).
- The sink's `isDestroyed: () => false` stays, for the reason its own header gives.
- `emitDaemonEvent`, `bindServerOrigin`, `events.ts` — untouched.

## State + concurrency model

One additional mutable cell (`statuses`), replacing one (`lastStatus`); `current` is untouched. No
store, no timer, no listener, no async work, so nothing is added for `will-quit` to tear down and no
cancellation path is needed. Record → guard → send stay consecutive synchronous statements, so the
check-then-act gap #519 ruled out stays ruled out. `replayStatus`'s loop is synchronous with no
`await`, so no entry can be added or replaced mid-iteration.

Growth is bounded by the distinct-origin count, which is bounded by the paired-server count — a
client-held number. Entries are never evicted: a server whose connection is torn down keeps its last
status, which is the correct answer for a reopened window (its final state was `failed` or
`disconnected`, and that is what the window should be told).

## Error handling

No new failure mode. `originOf` is total over `DaemonEvent`: a missing property and a present-but-not-a-
string-or-null value both answer with a key rather than throwing, so no event can fail to be recorded.
`forward` and `emitDaemonEvent` keep their existing guards, so a window destroyed part-way through a
multi-event replay drops the remaining events exactly as it drops a single one today — no partial-state
handling, no try/catch.

## Testing strategy

All of it vitest against fakes in `src/main/liveWindow.test.ts`; the module stays Electron-free. Every
new case drives the REAL `emitDaemonEvent` and asserts on the `send` handle, in the file's existing
idiom. Cases to add, under the AC2 `describe`:

- Two servers, two slots: stamped `connected(srv-a)` then `failed(srv-b)` → replay sends **both**, each
  with its own `serverId` intact. The headline case; fails on the single cell.
- A newer status for one server replaces only that server's slot: `connecting(srv-a)`,
  `connected(srv-b)`, `failed(srv-a)` → replay sends two events, srv-a's being the `failed`.
- Stable insertion order across a replacement: the same sequence asserts srv-a still replays **first**
  — the re-`set` does not move it to the back.
- `null` and unstamped are distinct slots: a `null`-stamped status and a bare-literal status both
  survive → two events, not one.
- The gap case, per server: a status for a second server arriving while no window is live is recorded
  and replays alongside the first server's.
- A stamped non-status event opens no slot: `messageReceived(serverId: 'srv-c')` after one status →
  replay still sends exactly one event.

The existing `records every status member, last write wins` case is kept and its comment extended: its
four bare literals share the `undefined` slot, so it now reads as within-one-origin last-write-wins,
which is the property it always asserted. Its passing unedited is evidence the change is
behaviour-preserving for a single origin.

E2E: none added. `e2e/window-reopen-converges.spec.ts` is the delivery proof and must pass **unedited**
(AC5) — the fake tier pairs one server, so its replay stays a single event.

## Open questions

- Whether an unstamped event should key on `undefined` or be normalised to `null` — **resolved in this
  plan**: `undefined`, its own slot, per `ServerOrigin`'s present-vs-absent distinction.
- Whether entries should ever be evicted (e.g. when a server is unpaired). Not in this slice: no
  eviction hook exists in this module, unpair settles the connection at `failed(not-paired)` which is
  the honest thing to replay, and the growth bound is the paired-server count. If a future ticket wants
  a slot removed on unpair, the seam is `replayStatus`'s owner, not the recorder.

## Security review

**Verdict:** PASS

The substance here is the one the ticket names: this slice is the first main-side consumer to **index
by `serverId`**, so a value that was previously only carried now selects a storage slot. Everything
below is written against that change; the retention story (which event members are held) is unchanged
and is not re-litigated.

**Findings:**

- **[Trust boundaries] No findings — but the load-bearing property must be named, because this slice is
  the first to depend on it.** The key is `serverId`, and its provenance is what makes keying by it
  safe: it is bound at **construction** by `createDaemonConnection`'s `const sink = bindServerOrigin(deps.sink, deps.serverId)`,
  from `connectionRegistry`'s `record.server` — a client-held paired record, never the wire. A hostile
  or on-path relay can inject or reorder frames inside a session, but every event it produces is
  stamped with **that connection's** id, so it cannot write another server's slot. The design therefore
  reads the origin **only** via `originOf` off the stamp, and never from the event payload — in
  particular never from `connected`'s `ack.server_id`, which is a *distinct*, daemon-supplied value
  that `serverInfo.ts` and `ServerOrigin`'s header both already rule out for exactly this reason. Doing
  so would hand a confused daemon the ability to overwrite another server's cached status, which a
  reopened window would then render as that server's state. `originOf` is the single reader, and it is
  `in`-guarded and `typeof`-checked rather than cast, so a non-conforming value lands in a slot rather
  than propagating as a trusted string.
- **[Tokens, secrets, credentials] No findings.** `StatusEvent` and `isStatusEvent` are untouched: the
  same `Extract` over the same four members, so nothing newly becomes retainable. What widens is the
  *count* of retained events — from one to at most one per distinct origin. The only daemon-supplied
  text among them is `failed`'s `ErrorPayload.message`, bounded per slot by the same inbound decode
  limits that bound today's single retained `failed`, and **replaced** rather than accumulated. No
  token, key, pairing payload, or message body is reachable: `bindServerOrigin` is handed a
  `string | null` scalar and never a record, and `messageReceived` is excluded by `isStatusEvent` —
  the existing `does not let a non-status event overwrite the recorded status` case pins that, and a
  new case extends it to stamped non-status events so a `messageReceived` cannot open a slot either.
- **[File / storage operations] No findings, by construction.** Nothing in this module touches disk.
  The relevant risk for a newly-introduced key is that it becomes a path segment or an on-disk cache
  key; it does not — the `Map` lives in main-process memory for the process lifetime and is never
  serialised. This is the same carve-out `index.ts` already states for the debug bundle's filename
  (`serverId` reaches the sink and nothing else).
- **[Inter-process / Electron attack surface] No findings.** No channel, no `contextBridge` member, no
  `ipcMain` handler and no `webPreferences` field is added or changed. `replayStatus()` keeps its
  signature and its single call site — `openWindow`'s `did-finish-load` handler — so it stays
  **main-driven and not renderer-invokable**: a compromised renderer cannot trigger a replay, let alone
  choose what is replayed. The renderer's side of the widening (N status events where one arrived) is
  additive on an existing channel and carries no new shape.
- **[Cryptographic primitives] Not applicable, stated rather than skipped.** No randomness, no
  key material, no comparison against a secret — the only comparison introduced is `Map` key identity
  on a non-secret routing id, which is what `ServerOrigin`'s header classifies it as, so
  `timingSafeEqual` has nothing to protect here.
- **[Network & I/O] Not applicable.** No socket, no request, no timer, no timeout, no reconnect path.
  The module is downstream of every network boundary and holds no reference to the connection at all —
  the property #519 relied on to make "reopening does not re-handshake" structural.
- **[Error messages, logs, telemetry] SHOULD FIX — keep the module log-free in Phase B.** Per-slot
  bookkeeping invites a diagnostic ("recorded status for server X"), and `serverId` would itself be a
  legitimate field to log. It must still not be added here: this module handles **whole events**, so
  any log statement is one edit away from serialising an event and leaking `ErrorPayload.message` (and,
  if the call ever moved above `isStatusEvent`, `MessagePayload.text`) to main-process stdout —
  `emitDaemonEvent`'s header makes log-freedom a property of this path, not a preference. The module
  takes no `diagnosticLog` dependency today and this slice adds none. Checkable: no logging call
  appears in the diff.
- **[Concurrency] No findings.** Everything added is synchronous — no `await`, no timer, no listener,
  so nothing is added for `will-quit` to tear down and no `AbortSignal` is owed. Record → guard → send
  remain consecutive synchronous statements, preserving #519's no-check-then-act-gap property.
  Re-entrancy during `replayStatus`'s `for…of` was considered and is unreachable: `forward` bottoms out
  in `webContents.send`, which posts rather than calling back into the sink, so no entry can be added
  mid-iteration.
- **[Threat model alignment] No findings; two threats named and one deferral.** *Hostile/compromised
  relay* — on-path but content-blind, and structurally unable to influence which slot is written (see
  Trust boundaries); it can at worst cause a server's own slot to hold a stale or forced-`failed`
  status, which is that connection's genuine state and already the pre-existing behaviour. *Unbounded
  memory growth from a hostile daemon* — the classic risk when a `Map` is keyed by remote input, and
  it does not apply: the key space is the set of client-held paired records plus the two non-server
  keys (`null`, `undefined`), so **no daemon can mint a key** and the slot count is bounded by a number
  the operator controls. *Prototype pollution* — closed by the `Map`, which is `ServerOrigin`'s
  standing ruling and this slice's reason for carrying the label; a `Record<string, StatusEvent>` would
  let a `__proto__` id write through `Object.prototype`. **OUT OF SCOPE:** how the renderer attributes N
  replayed statuses to N servers — the per-server session store is #1085, and this slice deliberately
  does not widen for it.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
