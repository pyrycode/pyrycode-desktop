# Queue store

The renderer's held copy of each open conversation's queued-message backlog — a dedicated,
unidirectional Zustand store fed by a headless subscription binding that observes the [daemon-event
channel](daemon-event-channel.md)'s `queueState` arm, so the queue render slice ([#294](../codebase/294.md),
shipped) and the reconcile-on-connect slice ([#197](../codebase/197.md), shipped) read one source of
truth.

Introduced in [#293](../codebase/293.md), split from #145 alongside [#292](../codebase/292.md)
(transport decode, shipped first) / [#294](../codebase/294.md) (render, shipped) / #295 (command,
re-split) / [#296](../codebase/296.md) (drop, shipped). This ticket shipped no visible surface —
\#294 is its first consumer. #295 (the drop command) tripped the ≥5-file split gate and was
re-split along the #235/#236 seam into [#299](../codebase/299.md) (wire + builder, shipped) →
[#300](../codebase/300.md) (the `daemonConnection` method + IPC command, shipped — see [dequeue
message envelope](dequeue-message-envelope.md)); #295 itself is closed. #296 (the render
affordance that actually calls the command) shipped, and [#197](../codebase/197.md) (reconnect
reconcile) shipped next — the queue family (#292/#293/#294/#299/#300/#296/#197) was then complete
end to end, for a single app-wide connection. Two more tickets have since narrowed that reset:
[#1117](daemon-connection-routing.md) gave the app one connection per paired server, which turned
\#197's whole-map reset into a cross-server bug, and
[#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138) fixed it by scoping the reset to
the reconnecting server and giving the store a second, independent boundary clear for when a
pairing itself ends.

## What it does

Holds each conversation's queued-message backlog — `{ queued_msg_id, text, ts }` rows in enqueue
order — keyed by `conversationId`, and replaces a key's held backlog wholesale on every
`queue_state` snapshot for that conversation: an entry the daemon removed disappears, order follows
the event, and an empty backlog clears the held list to `[]`. Before any snapshot arrives for a
conversation, its backlog reads as empty. Deliberately **not** a [session
store](session-store.md) or [timeline store](conversation-timeline-store.md) facet: `queue_state`
is daemon *state* (SSOT pyrycode #720), not part of claude's turn stream, so it never folds into
`reduceTimeline` and gets its own store instead.

On every relay (re)handshake the store also resets: the daemon has no session resume, so a
reconnect brings the client to current truth by re-sending one `queue_state` snapshot per
**non-empty** conversation (pyrycode/pyrycode#878/#879) — a conversation that fully drained while
the client was away gets no re-send at all. [#197](../codebase/197.md) (shipped) closed that gap by
clearing the whole `backlogs` map on the `connected` daemon edge and letting the re-sends repopulate
it through the unchanged `setBacklog` path — the queue twin of [#415](../codebase/415.md)'s modal
`outstanding` reconnect reset. Since [#1117](daemon-connection-routing.md) the app holds one
connection per paired server, so a whole-map reset on that edge discarded every *other* connected
server's backlogs too, with nothing to put them back — only the reconnecting server re-sends.
[#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138) scoped the reset to the
reconnecting server's own conversations, sourced from the [server-keyed conversation
list](conversation-list-store.md#one-slot-per-server-since-1086), and — because that scoping
retired the argument that kept this store out of the pairing-boundary clear (see § Edge cases) —
added a second, nullary, whole-map clear for when a pairing itself ends.

## How it works

### The store (`src/renderer/src/store/queueStore.ts`)

```ts
export interface QueueSnapshot {
  conversationId: string
  queued: readonly QueuedItem[]
}
export interface QueueState {
  backlogs: ReadonlyMap<string, readonly QueuedItem[]>   // key absent = no snapshot seen yet
}
export type QueueStore = QueueState & {
  setBacklog: (snapshot: QueueSnapshot) => void
  resetBacklogsFor: (conversationIds: ReadonlySet<string>) => void   // reconnect edge, scoped (#197, scoped by #1138)
  clearAllBacklogs: () => void                                      // pairing-boundary drop, nullary (#1138)
}

createQueueStore(init?)                  // vanilla createStore — one isolated instance per test (DI seam)
queueStore                               // app-wide singleton
useQueueStore(selector)                  // narrow-slice React binding: useStore(queueStore, selector)
EMPTY_BACKLOG: readonly QueuedItem[]      // stable [] reference for the "no snapshot yet" default
selectBacklogFor(conversationId)(state)   // selector FACTORY — the primary read surface (#294)
selectBacklogs(state)                    // whole-map read surface; added "for #197" but ended up with
                                          // no production consumer once #197 shipped a wholesale clear
                                          // instead of a per-key eviction loop — see Edge cases, below
```

Keyed by `conversationId`, not a single flat backlog — this is load-bearing, not defensive
speculation. Two pieces of merged evidence force it: (1) `src/shared/ipc/events.ts`'s `queueState`
arm carries `conversationId` specifically *because* the snapshot is replacement-truth and this
store keys by it; (2) daemon #878/#879 (reconcile-on-connect) unicasts one `queue_state` per
non-empty conversation on (re)connect, so several snapshots for *different* conversations can
arrive back-to-back — a flat "hold the last snapshot" slot would let one clobber another.

**Three named setters** (`setBacklog`, `resetBacklogsFor`, `clearAllBacklogs`), not a reducer — #293
shipped the first, [#197](../codebase/197.md) added a second (`resetBacklogs`, nullary at the time),
and #1138 both scoped that second setter to a `ReadonlySet<string>` input and added the third; three
operations still don't justify a discriminated-union action set. Mirrors
[`sessionIdStore`](session-id-store.md)'s DI-factory → singleton → hook → selector structure and
[`runSettingsWriteStore`](session-settings-send.md)'s `ReadonlyMap` copy-on-write idiom: `setBacklog`
clones the map, sets the key, and replaces (`const next = new Map(s.backlogs);
next.set(conversationId, queued); set({ backlogs: next })`). `queued` is held **verbatim by
reference** — wire snake_case, no camelCase remap, no coercion, no validation (the
[conversation-list store](conversation-list-store.md) posture; #292 owns the fail-closed decode).
The write is unconditional: an empty `queued: []` sets that key to `[]` (a real replacement — "this
conversation's backlog is now empty") rather than deleting the key.

`resetBacklogsFor` (#197, scoped by [#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138))
is the reconnect-edge reset. #197 shipped it nullary, clearing the **whole** map — `set({ backlogs:
new Map() })` — on the argument that the app had exactly one connection, so `connected` meant "the
app's connection came back". [#1117](daemon-connection-routing.md) gave the app one connection per
paired server, which turned that argument false: `connected` now means "*this* server's connection
came back", and clearing the whole map on it discarded every other connected server's backlogs with
nothing to restore them. #1138 re-typed the setter to take the reconnecting server's own
conversation ids (`ReadonlySet<string>`, resolved by the caller — see § The data path) and changed
its body to iterate the **held** keys, not the id set, deleting only the ones that are members:

```ts
resetBacklogsFor: (conversationIds) =>
  set((s) => {
    const doomed = [...s.backlogs.keys()].filter((id) => conversationIds.has(id))
    if (doomed.length === 0) return s
    const next = new Map(s.backlogs)
    for (const id of doomed) next.delete(id)
    return { backlogs: next }
  })
```

Work is bounded by what this store holds, not by the server's conversation count. Copy-on-write
like `setBacklog`, and every surviving slot comes back **by reference**, so a component watching a
conversation the reset didn't touch sees `Object.is` true and does not re-render. The `size === 0`
short-circuit generalises to "no held key is listed": the state object is handed straight back, so
zustand's `Object.is` fires and a first connect, an all-drained reconnect, and a reconnect of a
server holding nothing here all wake no listener — the [#415](../codebase/415.md) empty-slice
no-op twin. A backlog whose conversation is in **no** server's list — including an orphan left by a
conversation that no longer exists anywhere — survives every scoped reset; this is the accepted
consequence of scoping by the list, pinned by a test rather than left to drift wider later.

`clearAllBacklogs` ([#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138)) is the
**pairing-boundary** drop — unrelated to any `connected` edge, called only from
[`clearPairingScopedState`](paired-shell.md#related). It is nullary, the `clearAllModelLists` /
`clearAllConversations` shape: no daemon-supplied conversation id or server origin can steer which
backlogs survive a boundary the operator crossed deliberately, which matters here because a queued
item's `text` is untrusted daemon-relayed content. It returns `initialQueueState` by reference and
carries the same subscriber short-circuit on `size === 0`. See § Edge cases for why scoping
`resetBacklogsFor` made this setter necessary rather than optional.

`selectBacklogFor` is a selector *factory* bound to one `conversationId`, returning
`s.backlogs.get(id) ?? EMPTY_BACKLOG`. This keeps reads narrow-slice-correct: a `setBacklog` for a
*different* conversation produces a new `Map`, but `newMap.get(openId)` returns the *same* array
reference as before, so `Object.is` holds and a component watching `openId` does not re-render.

### The data path (`src/renderer/src/store/queueBridge.ts`)

```ts
translateQueueState(event: DaemonEvent): QueueSnapshot | null
// switch (event.type) { case 'queueState': return { conversationId: event.conversationId, queued: event.queued }; default: return null }

originOf(event: DaemonEvent): ConversationListOrigin   // since #1138 — reads #1068's stamp, never event.ack

subscribeQueue(onDaemonEvent, setBacklog, resetBacklogsForServer): () => void
// onDaemonEvent(event => {
//   if (event.type === 'connected') { resetBacklogsForServer(originOf(event)); return }
//   const s = translateQueueState(event); if (s !== null) setBacklog(s)
// })
// returns the off-handle (the sessionIdBridge idiom)

QueueData(): null
// headless component, one subscribe effect (deps []), mounted app-level in App.tsx
// the composition root: resolves origin -> conversation ids via conversationListStore, THEN calls
// queueStore.getState().resetBacklogsFor(ids) — see below
```

Reactive-only for the snapshot write — like [`sessionIdBridge`](session-id-store.md) and unlike
`conversationListBridge`, the daemon pushes `queue_state` unsolicited, so there is no request half:
no command sent to trigger it. `translateQueueState` rebuilds a fresh named-field literal (never
`return event`, never a spread — the `modalBridge` idiom), stays pure, and uses `default: null`, not
`assertNever`: this is the *fourth* independent subscriber on the `onDaemonEvent` channel (after
`daemonEventBridge`, `timelineBridge`, `modalBridge`, which all already no-op `queueState` from
\#292), not one of the three typecheck-gating exhaustive bridges. `subscribeQueue` guards on
`snapshot !== null`, not truthiness, so an empty `queued: []` snapshot is never dropped as falsy.

The listener's other branch, the `connected`-edge reset ([#197](../codebase/197.md)), is
deliberately **not** folded into `translateQueueState` — it lives as a leading check in
`subscribeQueue` itself, reading only `event.type` and, since #1138, the stamp. This keeps the
translator a pure `queueState`→snapshot filter (pinned by a test asserting `connected` maps to
`null` through it) and is the one structural difference from #415's modal-bridge twin, which routes
`connected` through its translator as a new `ModalEvent` union member instead — the modal bridge
already had a reducer-style event union to extend; the queue bridge doesn't, so the reset takes the
cheaper listener-branch shape rather than inventing one.

**`originOf` ([#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138))** is a module-private
copy of the idiom `relayLinkBridge.ts`, `conversationListBridge.ts` and `daemonEventBridge.ts` each
already carry — an `in`-guarded, `typeof`-checked read of #1068's stamp, never a cast and never
`event.ack`. A copy, not an import: importing one of the three would couple two deliberately
independent single-arm subscribers. Reads the origin **only** from the stamp: the `connected` arm
also carries the daemon's own `ack.server_id`, a distinct value the daemon chose, and the stamp is
bound main-side at construction from a paired record this client holds, so a hostile or confused
daemon cannot make its own reconnect clear another server's backlogs.

The bridge itself never touches `conversationListStore` — it hands the raw `ConversationListOrigin`
across, so `queueBridge.test.ts` keeps driving `resetBacklogsFor`'s call site with a plain spy.
Turning an origin into the conversation ids to drop is `QueueData`'s job, the one place the two
store singletons meet:

```ts
(origin) =>
  queueStore
    .getState()
    .resetBacklogsFor(selectConversationIdsFor(origin)(conversationListStore.getState()))
```

using [`selectConversationIdsFor`](conversation-list-store.md#one-slot-per-server-since-1086), #1086's
shared per-server id resolution — landed once in `conversationListStore` rather than restated in each
of the three bridges that need it (this one; #1139's background-task rosters; #1140's outstanding
modal prompts, both not yet shipped). The list is read at **reset time**, inside the same effect, not
cached at subscribe time: on a first connect the server's slot holds no list yet (the
`list_conversations` request rides the same `connected` edge), so the resolution is empty and nothing
is dropped; on a reconnect the slot still holds the previous episode's rows, since only
`clearAllConversations` at a pairing boundary empties it, so the reconnecting server's conversations
are already known before its re-sends arrive. Nothing can interleave between the read and the write —
both stores are written from the same synchronous daemon-event dispatch, with no `await` between them.

`QueueData` derefs `window.pyry` only inside its effect, never during render, so it server-renders
to `''` without a bridge mock — the `SessionIdData` invariant.

### Data flow

```
App mount → <QueueData/> (app-level, fourth headless sibling)
  → subscribe effect: window.pyry.onDaemonEvent → subscribeQueue (live immediately, no request)

daemon → queue_state frame → parseQueueStatePayload → queueState DaemonEvent [#292]
  → DAEMON_EVENT_CHANNEL → subscribeQueue listener
    → translateQueueState → { conversationId, queued } (or null → skip)
    → queueStore.setBacklog(snapshot)   [replacement-truth, per conversationId key]
  → selectBacklogFor(openId) / useQueueStore   (read by #294)

relay (re)handshake → daemonConnection.ts emits connected DaemonEvent, before any re-send [#197]
  → DAEMON_EVENT_CHANNEL (in-order) → subscribeQueue listener
    → originOf(event) → ConversationListOrigin (#1068's stamp, never event.ack)   [#1138]
    → selectConversationIdsFor(origin)(conversationListStore.getState())   [#1086, this server's ids]
    → queueStore.resetBacklogsFor(ids)   [only the listed keys dropped, or same-ref no-op if none match]
  → (then, per non-empty conversation) daemon re-sends queue_state → the flow above repopulates it

pairing ends (unpair, or pair-another-server) → clearPairingScopedState()   [#1138]
  → queueStore.clearAllBacklogs()   [every server's backlogs dropped, or same-ref no-op if already empty]
```

## Configuration and usage

- Mounted app-level in `src/renderer/src/App.tsx`, as a fourth headless sibling alongside
  `<ConversationListData/>` / `<SessionIdData/>` / `<RunSettingsWriteData/>` — one stable,
  app-lifetime listener with no subscribe/unsubscribe churn as the route flips, because a
  `queue_state` marker can arrive before #294's render slice is ever mounted, and several can
  arrive back-to-back for different conversations (#878/#879).
- Import surface for #294 (shipped): `import { useQueueStore, selectBacklogFor } from
  '../../store/queueStore'`, consumed in `ConversationScreen.tsx`. #294 did **not** source "which
  conversation is open" from nav/route state at first — this store deliberately does not own that
  concern, and the architecture spec explicitly ruled out adding nav plumbing for this slice. #294
  shipped binding `selectBacklogFor` to `MILESTONE_CONVERSATION_ID` (from `composerSend.ts`, the
  same id the composer sent under) at module scope, once, for the single-active-conversation
  milestone; #448 replaced that with a real nav-sourced id, rekeying the selector onto
  `activeConversationStore`'s open conversation id as the milestone predicted. The reader itself
  then moved once more: #294/#448 read it inside a dedicated `QueuedBacklogControl` container with
  its own subscription, and [#1009](https://github.com/pyrycode/pyrycode-desktop/issues/1009)
  deleted that container and hoisted the read into `ConversationScreen` itself (`useMemo`-stable
  `selectBacklogFor(openConversationId ?? '')`) — the region's mount and growth needed to be a
  render of the screen, not of an independent leaf, for the thread scroll pin's re-assert to see
  them. See [Conversation shell § Thread scroll
  pin](conversation-shell.md#thread-scroll-pin-601-built-on-the-dormant-isatbottom-helper-from-600).
- [#197](../codebase/197.md) (shipped, reconcile-on-connect) does **not** use `selectBacklogs` as
  #293 anticipated — it clears via `resetBacklogsFor` instead of iterating it, so `selectBacklogs`
  still shipped with no production caller (see Edge cases, below).
- [#296](../codebase/296.md) (shipped) reads this store only indirectly — its drop affordance never
  touches `useQueueStore`/`selectBacklogFor` itself; it fires `dequeueMessageCommand` and lets the
  existing #294 subscription remove the row once the daemon's next `queue_state` snapshot arrives.
- `clearAllBacklogs` ([#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138)) is invoked
  only from `clearPairingScopedState` (`src/renderer/src/clearPairingScopedState.ts`, wired in
  `PairedShell.tsx`'s `clearPairingDeps` beside `clearAllConversations`), never from a bridge arm or
  directly from a component. See [Paired shell § Related](paired-shell.md#related).

## Edge cases and limitations

- **No two-way binding.** `setBacklog` is invoked only by `subscribeQueue`'s wiring; components
  read exclusively through `selectBacklogFor`/`selectBacklogs`.
- **No coercion or validation of `queued`.** The store trusts #292's fail-closed decode
  completely; `queued_msg_id` arrives as a `number`, `text`/`ts` as opaque strings.
- **`text` is untrusted, client-originated transit content** relayed by a content-blind relay.
  This slice has no DOM sink itself; [#294](../codebase/294.md) (the render consumer) renders it as
  plain text only, via auto-escaped React children — never `innerHTML` / `dangerouslySetInnerHTML`.
- **A conversation that *became* empty gets no fresh `queue_state` on reconnect** — the daemon only
  unicasts non-empty backlogs per #878/#879. Resolved by [#197](../codebase/197.md): the store
  clears the reconnecting server's `backlogs` entries on the `connected` edge (originally the whole
  map; scoped by [#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138), see § How it
  works), so a conversation with no re-send simply reads `EMPTY_BACKLOG` after the reconnect rather
  than surfacing a stale pre-drop entry.
- **A backlog whose conversation appears in no server's held list is left alone by every scoped
  reset** ([#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138)) — the accepted
  consequence of scoping the reconnect edge by the conversation list rather than by anything wider,
  pinned by a dedicated test so a later widening of the scope is a deliberate change.
- **Scoping the reconnect reset retired the argument that kept this store out of
  `clearPairingScopedState`.** #197's whole-map reset meant a re-pairing's first `connected` blanked
  every latched backlog on its way past, so a dedicated pairing-boundary clear would have been dead
  code — the same self-healing argument `clearPairingScopedState.ts`'s header still made for this
  store through #1086. Once #1138 scoped that reset to the reconnecting server's own conversations,
  the new pairing's first `connected` instead resolves an *empty* conversation list and drops
  nothing — and because the daemon re-sends `queue_state` only for a non-empty conversation, a
  conversation that drained while unpaired is never re-asserted. Its stale pre-drop backlog would
  otherwise render indefinitely, reachable again on a re-pair to the same box since conversation ids
  are daemon-side — exactly the bug #197 shipped to fix, reintroduced at the pairing boundary. #1138
  closed it with `clearAllBacklogs` (see § How it works), the same sequence
  [`conversationListStore`'s AC5](conversation-list-store.md#edge-cases-and-limitations) ran through
  one ticket earlier: a store's exclusion from `clearPairingScopedState` is a claim about a
  *different* mechanism keeping it fresh, and that claim can go stale without anyone touching the
  store itself — re-run the discriminator whenever a store already named there changes how its own
  reconnect reset works.
- **`selectBacklogs` (the whole-map read) has no production consumer.** #293 added it "explicitly
  for #197", anticipating a per-key eviction loop; the as-shipped #197 design clears the map
  wholesale instead and never calls it. Left in place (still exported, still tested) per CLAUDE.md's
  don't-touch-adjacent-code rule — retiring it, or fixing its now-stale "iterates held backlogs to
  clear stale ones" doc comment, is an open, non-blocking follow-up (flagged in #197's code review).
- **`QueueData`'s effect timing is not unit-tested** — mirrors the `SessionIdData` precedent: a
  bare component's effect lifecycle (deps/StrictMode) is untestable without a React renderer. The
  pure `translateQueueState`/`subscribeQueue` helpers carry all the testable logic, plus two seam
  tests driving a real `createQueueStore()` end-to-end.

## Related

- [Daemon-event channel](daemon-event-channel.md) / [#292 codebase notes](../codebase/292.md) — the
  transport half this store consumes (`queueState` event, `QueuedItem` wire type); shipped first,
  unchanged by this ticket.
- [Conversation list store](conversation-list-store.md) / [#208 codebase
  notes](../codebase/208.md) — the store-shape precedent for holding wire rows verbatim
  (snake_case, no remap) and the null-vs-`[]` distinction pushed to the read boundary.
- [Session-id store](session-id-store.md) — the DI-factory → singleton → hook → selector
  structure and the reactive-only, no-request-half bridge shape this ticket mirrors field-for-field
  (adapted from a bare string to a keyed map).
- [Session settings send](session-settings-send.md) — the `ReadonlyMap` copy-on-write idiom this
  store's `setBacklog` reuses (mirrored for `Map` handling only, not the reducer that idiom lives
  inside there).
- [#293 codebase notes](../codebase/293.md) — implementation summary and patterns established.
- [#294 codebase notes](../codebase/294.md) — the queue render slice, first consumer of
  `useQueueStore`/`selectBacklogFor` (shipped).
- [Dequeue message envelope](dequeue-message-envelope.md) / [#299 codebase notes](../codebase/299.md)
  / [#300 codebase notes](../codebase/300.md) — the outbound wire+builder+command counterpart to this
  store's inbound `queue_state` (the #295 drop command's re-split slices, both shipped).
- [#296 codebase notes](../codebase/296.md) — the drop affordance (shipped) that dispatches a removal
  against an entry this store holds; the row leaves only when this store's existing subscription
  processes the daemon's next `queue_state` snapshot, never via a direct store mutation.
- [#197 codebase notes](../codebase/197.md) — the reconcile-on-connect reset (originally
  `resetBacklogs`, a nullary whole-map clear + the `connected`-edge branch in `subscribeQueue`),
  shipped; completed the queue family end to end for a single app-wide connection, before
  [#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138) scoped it.
- [#415 codebase notes](../codebase/415.md) — the modal-store twin of #197's original reset; same
  reset contract (bare trigger, one slice cleared, same-reference no-op when already empty), applied
  through a translator arm there vs. a listener branch here, since the modal bridge already had an
  event union to extend and the queue bridge doesn't. `modalBridge` has the same per-server-scoping
  defect #1138 fixed here — out of scope for #1138 and untracked; see the note on #1089.
- [Real-claude liveness e2e](real-claude-liveness-e2e.md) / [#446 codebase notes](../codebase/446.md) —
  the real-stack (real daemon + real claude) liveness net over this store's inbound `queue_state` path
  and the [dequeue message envelope](dequeue-message-envelope.md) drop path, proving both against a
  genuinely running turn rather than a scripted `daemon.pushFrame`.
- [Daemon connection routing](daemon-connection-routing.md) — the #1117 registry change (one
  connection per paired server) that turned #197's whole-map reconnect reset from a simplification
  into a live cross-server bug, fixed by #1138.
- [Conversation list store](conversation-list-store.md#one-slot-per-server-since-1086) /
  `docs/specs/architecture/1086-conversation-list-keyed-by-server.md` — the server-keyed conversation
  list and `selectConversationIdsFor`, #1138's source of "which conversations belong to the
  reconnecting server". The same resolution is meant for #1139's background-task rosters and #1140's
  outstanding modal prompts (both not yet shipped), which is why it lives there rather than being
  restated in this bridge.
- [Paired shell § Related](paired-shell.md#related) — `clearAllBacklogs`, the eleventh member of
  `clearPairingScopedState`'s dep set (#1138).
- `docs/specs/architecture/1138-queue-backlog-reconnect-reset-scoped-to-server.md` — the full
  architecture spec: the key-domain ruling on `ConversationListOrigin`'s three cases, and a
  `## Revisions` entry recording the mid-flight design change to `clearAllBacklogs` after a first
  security-review pass missed the pairing boundary and a second, revised pass caught it.
