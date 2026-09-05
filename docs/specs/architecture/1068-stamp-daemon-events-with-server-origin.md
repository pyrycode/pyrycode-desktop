# #1068 — Stamp every daemon event with the server it came from

## Files read

Codegraph is not initialized in this repo (every `mcp__codegraph__*` call fails with "CodeGraph not
initialized"), so the reading list below came from `Grep`/`Read` sweeps of `src/` and the package
overviews. Noted so a later run does not pay the turn again.

- `src/main/emitDaemonEvent.ts` → `DaemonEventSink`, `emitDaemonEvent` — the single outbound path; the
  destroyed-window guard whose stale "32 call sites" comment this ticket corrects.
- `src/shared/ipc/events.ts` → `DaemonEvent`, `DAEMON_EVENT_CHANNEL` — the 43-arm union the new field
  must NOT be added to arm-by-arm.
- `src/main/daemonConnection.ts` → `DaemonConnectionDeps`, `createDaemonConnection` — the deps
  interface that gains the id, and the `const { … sink … } = deps` destructure that is the whole
  binding seam. 39 `emitDaemonEvent(sink, …)` call sites hang off that one local.
- `src/main/liveWindow.ts` → `createLiveWindow`, `LiveWindow.sink`, `WindowTarget`, `isStatusEvent` —
  the process-lifetime sink shared by all three emitters, and the one place an event is *stored* and
  re-sent (`replayStatus`), so the stamp has to survive it.
- `src/main/index.ts` → the `whenReady` composition root: the single `createDaemonConnection` call, the
  debug-bundle orchestrator's injected `emit`, and the `notify` closure's `notificationActivated` emit.
- `src/main/debugBundleDownload.ts` → `DebugBundleDownloadDeps.emit` — takes a `(event: DaemonEvent) =>
  void`, not a sink, which is why this file is NOT touched: the stamp goes in the root's closure.
- `src/main/pairedServerStore.ts` → `PairedServerRecord` (= `QrPayload`) — `server` is the id to stamp
  with; `token` / `server_static_pubkey` are the two fields that must not travel with it.
- `src/shared/ipc/serverInfo.ts` → `ServerInfo` — the standing ruling that `serverId ← record.server`
  and NOT `hello_ack.server_id`, and the containment precedent this ticket follows.
- `src/preload/index.ts` → `onDaemonEvent` — the renderer-facing subscription whose listener type has to
  widen for a bridge to be able to read the field at all.
- `src/shared/wire/types.ts` → `HelloClientPayload.last_seen_ts` — the stale comment the ticket bundles.
- `src/main/daemonConnection.test.ts` → `fakeSink`, `emitted` — `emitted(sink)` is the single funnel every
  one of the file's 82 whole-event `toEqual` assertions reads through (`rejections` / `modalRejections`
  / `folderRejections` all filter its result). That funnel is what keeps this ticket size-S.
- `docs/knowledge/features/live-window.md` — why `live.sink.isDestroyed()` is permanently `false` and
  why the recorder must sit above the #518 guard. Directly constrains where the stamp may go.
- `docs/knowledge/features/daemon-event-channel-plumbing.md` — the emit/subscribe contract and the "one
  and only path" invariant this ticket must not add a second path to.

## Design source

**Figma:** N/A — transport/IPC only. AC5 makes it a renderer no-op ("No bridge behaviour changes"), so
there is nothing visual to reproduce and the visual-fidelity check is intentionally skipped.

## Context

The app can hold one paired server. #1084 wants a registry constructing one `createDaemonConnection`
per stored record, and the blocker is that every event arrives on one channel with no origin on it, so
two live connections would be indistinguishable at the renderer. This ticket ships only the field and
its binding — a no-op the operator cannot see — so the registry has something written against it.

The binding is a *construction dependency*, not an emit-time read: the paired record loads per dial in
`loadDialConfig`, and events fire before it. One connection is bound to one server for its lifetime.

Today the id is `null` on every event in production, and that is correct rather than a stopgap: the
single connection is constructed at launch before any record is read and it *outlives* a re-pair
(`onPaired` calls `reconnect()` on the same connection rather than rebuilding it), so a launch-time
literal would be right at boot and silently mis-attribute every event after the operator pairs a
different machine.

No ADR is warranted. The one ruling this ticket depends on — `serverId ← record.server`, never
`hello_ack.server_id` — is already stated in `src/shared/ipc/serverInfo.ts` and needs no restatement.

### One divergence from the ticket body, stated up front

The body's "Three cases produce null even after #1084" lists `connecting` and `failed('not-paired')`
alongside `notificationActivated`. That reasoning holds only if the id is read from the record at emit
time, which the body's own seam rejects. Under a construction dependency the connection holds its id
*before* it emits anything, so after #1084 both `connecting` and `failed('not-paired')` will carry the
id of the connection that emitted them — which is exactly what makes them useful to a registry. Only
`notificationActivated` is structurally null (no daemon originated it); everything else is null today
solely because today's one connection is constructed with `null`.

This does not weaken AC1: "or null where no paired record was in hand at emit time" is permissive, and
today every event is null regardless.

## Design

### The type: an intersection, not 43 edited arms

`DaemonEvent` keeps all 43 arms untouched. `src/shared/ipc/events.ts` gains the channel-carried type:

```ts
interface ServerOrigin { serverId: string | null }
type WithOrigin<E> = E extends unknown ? E & ServerOrigin : never
export type StampedDaemonEvent = WithOrigin<DaemonEvent>
```

`WithOrigin` is written as a distributive conditional deliberately rather than as the plainer
`DaemonEvent & ServerOrigin`: distribution yields a genuine 43-arm union of stamped members, so
`.type` narrowing and `Extract<…>` behave for downstream consumers exactly as they do on `DaemonEvent`
today. The plain intersection is the fallback if TypeScript objects to the spread (see Open questions).

Two consequences drive the whole rest of the ticket:

- `StampedDaemonEvent` is assignable to `DaemonEvent` — so every existing consumer typed on
  `DaemonEvent` keeps compiling and keeps working, receiving the field as an extra property.
- `DaemonEvent` is NOT assignable to `StampedDaemonEvent` — so the 33 test files that build bare
  `DaemonEvent` literals for bridges are untouched.

### The binding: one stamping sink per emitter

`src/main/emitDaemonEvent.ts` gains one function and nothing else changes shape:

```ts
export function bindServerOrigin(target: DaemonEventSink, serverId: string | null): DaemonEventSink
```

It returns a sink that delegates `isDestroyed()` to `target` and, on `send`, forwards
`{ ...event, serverId }` to `target.webContents.send`. `DaemonEventSink` and `emitDaemonEvent` keep
their `DaemonEvent` parameter types, so the wrapper is a drop-in for the real sink at every consumer
and no call site anywhere changes its shape.

`createDaemonConnection` binds it once, in the deps destructure:

```ts
const sink = bindServerOrigin(deps.sink, deps.serverId)
```

That single line is the entire connection-side change. All 39 `emitDaemonEvent(sink, …)` call sites are
byte-identical afterwards and none of them can name the id, because the local they emit into is the
only thing that holds it. `DaemonConnectionDeps` gains a **required** `serverId: string | null` — required
so #1084 cannot construct a connection that forgets its own identity, and cheap because there are only
four construction sites in the repo.

The root binds it twice more, per consumer rather than once over `live.sink`. Wrapping `live.sink`
itself would stamp all three emitters with one id, which is precisely the shape #1084 cannot use.

- the debug-bundle orchestrator's `emit` — its events come from the connection's daemon; `null` today
  because the root does not hold the id, and #1084 hands the orchestrator its connection's id.
- the `notify` closure's `notificationActivated` — permanently `null`; no daemon originated it.

`debugBundleDownload.ts` is NOT modified: it takes an `emit` function, so the stamp lives in the root's
closure, and its six whole-event assertions stay untouched.

### Data flow

```
39 sites ─► sink (bound: deps.serverId) ─┐
bundle emit ─► sink (bound: null) ───────┼─► live.sink ─► recorder ─► emitDaemonEvent ─► window
notify emit ─► sink (bound: null) ───────┘   (stores the STAMPED event; replay keeps the stamp)
```

`live.sink` sits *downstream* of every stamp, so its status recorder stores an already-stamped event
and `replayStatus()` re-delivers it with its origin intact. `liveWindow.ts` is therefore not modified.

### The renderer edge

`src/preload/index.ts`'s `onDaemonEvent` listener parameter widens from `DaemonEvent` to
`StampedDaemonEvent`, which flows to `window.pyry` through the untouched `index.d.ts`. This is what
makes the field readable at all — without it a bridge would need a cast, and AC5's "bridges may read it
or ignore it" would be false. It cascades into nothing: a bridge parameter typed
`(listener: (event: DaemonEvent) => void) => () => void` still accepts the widened function by
contravariance, so all 27 renderer subscribers and their tests are untouched.

## State + concurrency model

No new state, no async work, no timers, no listeners, nothing to cancel. The stamping sink holds one
immutable closed-over string-or-null and is otherwise stateless; the connection gains one more
`const` bound at construction. Teardown is unchanged — the wrapper owns nothing to tear down.

The one ordering constraint is #518's: `emitDaemonEvent` reads `sink.isDestroyed()` *before* touching
`sink.webContents`, because on a real destroyed `BrowserWindow` the property read is itself the throw.
The wrapper preserves it: its own `webContents` is a plain object whose `send` closure reads
`target.webContents` only when invoked, i.e. only after `emitDaemonEvent` has already cleared the
guard on the wrapper — which delegates to the target. No new unguarded reach at any destroyed window.

The stamp is a non-mutating spread, so an event object a caller still holds is never modified.

## Error handling

Nothing here can fail: no I/O, no parse, no boundary crossing that could reject. The wrapper has no
failure mode to report and adds no branch. Structurally `null` is a first-class value of the field —
never coerced away and never inferred from absence — so a consumer reading `serverId` gets `null`,
not `undefined`, on every event that has no origin.

## Testing strategy

Vitest only (node environment, no DOM); no Playwright spec — the ticket changes no interaction and no
markup.

- `src/main/emitDaemonEvent.test.ts` — new `describe` for `bindServerOrigin`:
  - stamps an event with the bound id, forwarding on `DAEMON_EVENT_CHANNEL` with every original field
    intact;
  - a `null` binding produces `serverId: null` present-and-null, not an absent property;
  - two sinks bound to different ids over the SAME target produce events distinguishable by the field
    alone (AC3's mechanism, proven at the seam);
  - a destroyed target drops the event and never reads `target.webContents` (the #518 guard survives
    the extra hop) — driven with the file's existing throwing-accessor fixture;
  - the caller's event object is not mutated.
- `src/main/daemonConnection.test.ts` — `emitted(sink)` becomes the origin-free projection its declared
  `DaemonEvent[]` return type has always promised (it strips `serverId`), which is why the file's 82
  whole-event `toEqual` assertions need no edit; a new sibling `stampedEvents(sink)` exposes the raw
  channel payloads and the new tests read through it:
  - every event a connection emits carries the injected id (driven across a dial so `connecting`,
    the handshake terminal and an inbound message are all covered);
  - two connections constructed with different ids emit events distinguishable by the field alone
    (AC3, end to end);
  - the default construction (`serverId: null`) stamps `null` rather than omitting the field.
- `src/main/liveWindow.test.ts` — one added test: a stamped status event replays through
  `replayStatus()` into a new window with its `serverId` intact. This is the only place an event is
  stored and re-sent, so it is the only place the stamp could be silently lost.
- Untouched by design and re-run as the regression proof: `debugBundleDownload.test.ts` (its `emit` is
  unstamped at that layer) and every renderer bridge test (bare `DaemonEvent` literals still compile).

Fakes over mocks throughout: the existing `fakeSink` / throwing-accessor fixtures, no `vi.mock`.

## Size check

Five of the six size-S boundaries hold with room: ~550 lines of total written work, 2 new exported
types, ~6 consumer call sites needing simultaneous update (four `createDaemonConnection` constructions,
one test helper, one preload signature), 5 acceptance criteria, 0 reject branches.

**Stated overage: 6 production source files, one over the 5-file boundary.** The sixth is
`src/shared/wire/types.ts`, a four-line comment-only correction the ticket explicitly bundles ("One
stale comment to fix while here") — it lands no behaviour and reddens no gate. On the deliverables
test this ticket has exactly one deliverable, and the five behavioural files are the refiner's own
estimate. Splitting a comment fix into its own ticket is the floor violation the brief names: a slice
with no consumer and nothing checkable. The remaining five files cannot be split from each other
either — the field, its binding and its three emitters have no compiling intermediate state.

## Open questions

1. Does `{ ...event, serverId }` typecheck against the distributive `WithOrigin<DaemonEvent>` when
   `event` is the 43-arm union? Resolve in Phase B: if TypeScript will not distribute the spread, fall
   back to the plain `DaemonEvent & ServerOrigin` intersection, which loses nothing this ticket needs
   (only downstream `Extract<…>` ergonomics) and record the fallback under Revisions.
2. Should `emitDaemonEvent` / `DaemonEventSink` tighten to `StampedDaemonEvent` so an unstamped event
   *cannot* reach the channel by construction? Deferred, deliberately: it forces `liveWindow.ts` plus
   ~18 literal edits across `liveWindow.test.ts` and `emitDaemonEvent.test.ts`, which trips the
   10-call-site fan-out boundary, and no AC asks for it — AC4 asks that all three emitters stamp, which
   the three bindings deliver. Named here as the follow-up hardening so #1084 does not assume it exists.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings on the direction that matters. The field is main-originated and
  travels main → renderer only; nothing inbound carries a server id, so the renderer cannot influence
  it. Its provenance after #1084 is `PairedServerRecord.server` — operator-pasted pairing input already
  validated by `parsePairingPayload` and already crossing on the same provenance as
  `ServerInfo.serverId`, so no new untrusted value reaches the window. Deliberately NOT
  `hello_ack.server_id`: a hostile or confused daemon therefore cannot make its events claim another
  server's identity, which is a security property of the construction-dependency seam and not merely a
  naming convention.
- [Trust boundaries] SHOULD FIX — the field is exactly the kind of value a consumer reaches for as a
  React `key`, a lookup path or a cache key, and #1084 will be tempted to. Phase B must state the
  render/log constraint in `StampedDaemonEvent`'s doc block, matching what the `permissionMode` and
  `model` arms already say: plain text only, never `innerHTML` / `dangerouslySetInnerHTML`, never into
  an attribute or a URL, never a filename or a lookup path. AC5 already forbids keying state on it in
  this slice; the comment is what carries the rule to the slice that will.
- [Tokens, secrets, credentials] No findings — containment is structural, not disciplinary. The
  connection receives a `string | null` scalar, never a `PairedServerRecord`, so `token` and
  `server_static_pubkey` are unreachable from the new path: `emitDaemonEvent.ts` cannot dereference a
  record it is never handed, and the stamping spread copies the *event*, never the record. Phase B must
  make the dependency's doc block name the source (`record.server`) so a later wiring cannot supply the
  token as the id — the two are indistinguishable to the type system.
- [File / storage operations] Not applicable — no filesystem path, no read, no write, no serialisation
  to disk anywhere in the design. The paired-server record is not opened by any file this ticket edits.
- [Inter-process / Electron attack surface] No findings. No new IPC channel, no new `ipcMain` handler
  and no new `contextBridge` method: the preload change is a listener *type* widening on the existing
  receive-only `onDaemonEvent`, granting the renderer zero new capability toward the background
  process. The added property is a `string | null`, so it is structured-clonable and cannot smuggle a
  function, a handle or a `Buffer` across the bridge.
- [Inter-process / Electron attack surface] SHOULD FIX — double-binding is a silent mis-attribution
  trap. `bindServerOrigin(bindServerOrigin(sink, idA), idB)` produces events attributed to `idB`,
  because the outer spread's `serverId` overwrites the inner one with no error. Phase B must state
  "bind exactly once per producer" in the function's doc block. The plan's "stamp per consumer, never
  over `live.sink`" rule already forbids the shape that would produce it.
- [Cryptographic primitives] Not applicable — no randomness, no key, no nonce, no hash, and no
  comparison against a secret. `serverId` is a routing identifier compared (if at all, and not in this
  slice) to another routing identifier, so `timingSafeEqual` has no place here.
- [Network & I/O] No findings — the stamp is applied after decode, main-side, and is read by no
  outbound envelope builder, so it cannot reach the wire. No socket, URL, timeout or frame-size
  decision is touched.
- [Error messages, logs, telemetry] No findings, with one Phase-B constraint that is already the
  module's rule: the stamping wrapper must stay log-free. `emitDaemonEvent.ts` is log-free by
  construction precisely because a `console.log(event)` there would leak `MessagePayload.text` to
  main-process stdout, and the wrapper handles whole events, so it inherits the prohibition verbatim.
  Adding the server id to the diagnostic log is not done here and is not needed by any AC.
- [Concurrency] No findings — no async work, no timer, no listener, no shared mutable state, nothing to
  cancel. The wrapper closes over one immutable value. `live.sink`'s status recorder now retains a
  stamped status event, which adds a bounded non-secret string to main-process memory and changes
  nothing about which members it retains (still the four status members, still no message body).
- [Threat model alignment] OUT OF SCOPE, named rather than assumed: an unstamped emitter added in the
  future would give the renderer `undefined` where the type promises `string | null`, and a consumer
  branching on `=== null` would read it as "has an origin". Nothing is exploitable today — all three
  emitters are bound, and the value is `null` everywhere in production, so no mis-routing is
  representable — and closing it by construction is Open question 2, deferred to the hardening
  follow-up that #1084 should carry. Phase B mitigates it by stating the invariant in
  `emitDaemonEvent.ts`'s header: a producer is handed a `bindServerOrigin` result, never `live.sink`
  itself.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-05
