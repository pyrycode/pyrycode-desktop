# Queue store

The renderer's held copy of each open conversation's queued-message backlog — a dedicated,
unidirectional Zustand store fed by a headless subscription binding that observes the [daemon-event
channel](daemon-event-channel.md)'s `queueState` arm, so the queue render slice ([#294](../codebase/294.md),
shipped) and the reconcile-on-connect slice ([#197](../codebase/197.md), shipped) read one source of
truth.

Introduced in [#293](../codebase/293.md), split from #145 alongside [#292](../codebase/292.md)
(transport decode, shipped first) / [#294](../codebase/294.md) (render, shipped) / #295 (command,
re-split) / [#296](../codebase/296.md) (drop, shipped). This ticket shipped no visible surface —
#294 is its first consumer. #295 (the drop command) tripped the ≥5-file split gate and was
re-split along the #235/#236 seam into [#299](../codebase/299.md) (wire + builder, shipped) →
[#300](../codebase/300.md) (the `daemonConnection` method + IPC command, shipped — see [dequeue
message envelope](dequeue-message-envelope.md)); #295 itself is closed. #296 (the render
affordance that actually calls the command) shipped, and [#197](../codebase/197.md) (reconnect
reconcile) shipped last — the queue family (#292/#293/#294/#299/#300/#296/#197) is now complete
end to end.

## What it does

Holds each conversation's queued-message backlog — `{ queued_msg_id, text, ts }` rows in enqueue
order — keyed by `conversationId`, and replaces a key's held backlog wholesale on every
`queue_state` snapshot for that conversation: an entry the daemon removed disappears, order follows
the event, and an empty backlog clears the held list to `[]`. Before any snapshot arrives for a
conversation, its backlog reads as empty. Deliberately **not** a [session
store](session-store.md) or [timeline store](conversation-timeline-store.md) facet: `queue_state`
is daemon *state* (SSOT pyrycode #720), not part of claude's turn stream, so it never folds into
`reduceTimeline` and gets its own store instead.

On every relay (re)handshake the store also resets wholesale: the daemon has no session resume, so
a reconnect brings the client to current truth by re-sending one `queue_state` snapshot per
**non-empty** conversation (pyrycode/pyrycode#878/#879) — a conversation that fully drained while
the client was away gets no re-send at all. [#197](../codebase/197.md) (shipped) closes that gap by
clearing the whole `backlogs` map on the `connected` daemon edge and letting the re-sends repopulate
it through the unchanged `setBacklog` path — the queue twin of [#415](../codebase/415.md)'s modal
`outstanding` reconnect reset.

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
  resetBacklogs: () => void            // clears the whole map on reconnect (#197)
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

**Two named setters** (`setBacklog`, `resetBacklogs`), not a reducer — #293 shipped the one and
[#197](../codebase/197.md) added the second; two operations don't justify a discriminated-union
action set. Mirrors [`sessionIdStore`](session-id-store.md)'s DI-factory → singleton → hook →
selector structure and [`runSettingsWriteStore`](session-settings-send.md)'s `ReadonlyMap`
copy-on-write idiom: `setBacklog` clones the map, sets the key, and replaces (`const next = new
Map(s.backlogs); next.set(conversationId, queued); set({ backlogs: next })`). `queued` is held
**verbatim by reference** — wire snake_case, no camelCase remap, no coercion, no validation (the
[conversation-list store](conversation-list-store.md) posture; #292 owns the fail-closed decode).
The write is unconditional: an empty `queued: []` sets that key to `[]` (a real replacement — "this
conversation's backlog is now empty") rather than deleting the key.

`resetBacklogs` ([#197](../codebase/197.md)) clears the **whole** map wholesale — `set({ backlogs:
new Map() })` — rather than evicting keys one at a time. Because an absent key already reads
`EMPTY_BACKLOG` (below), clearing the whole map *is* "every held backlog is now empty"; no per-key
loop, no read of `selectBacklogs`. Returns the same state reference when the map is already empty
(`s.backlogs.size === 0 ? s : ...`) so zustand's `Object.is` short-circuits and a first connect or an
all-drained reconnect churns no listeners — the [#415](../codebase/415.md) empty-slice no-op twin.

`selectBacklogFor` is a selector *factory* bound to one `conversationId`, returning
`s.backlogs.get(id) ?? EMPTY_BACKLOG`. This keeps reads narrow-slice-correct: a `setBacklog` for a
*different* conversation produces a new `Map`, but `newMap.get(openId)` returns the *same* array
reference as before, so `Object.is` holds and a component watching `openId` does not re-render.

### The data path (`src/renderer/src/store/queueBridge.ts`)

```ts
translateQueueState(event: DaemonEvent): QueueSnapshot | null
// switch (event.type) { case 'queueState': return { conversationId: event.conversationId, queued: event.queued }; default: return null }

subscribeQueue(onDaemonEvent, setBacklog, resetBacklogs): () => void
// onDaemonEvent(event => {
//   if (event.type === 'connected') { resetBacklogs(); return }
//   const s = translateQueueState(event); if (s !== null) setBacklog(s)
// })
// returns the off-handle (the sessionIdBridge idiom)

QueueData(): null
// headless component, one subscribe effect (deps []), mounted app-level in App.tsx
```

Reactive-only for the snapshot write — like [`sessionIdBridge`](session-id-store.md) and unlike
`conversationListBridge`, the daemon pushes `queue_state` unsolicited, so there is no request half:
no command sent to trigger it. `translateQueueState` rebuilds a fresh named-field literal (never
`return event`, never a spread — the `modalBridge` idiom), stays pure, and uses `default: null`, not
`assertNever`: this is the *fourth* independent subscriber on the `onDaemonEvent` channel (after
`daemonEventBridge`, `timelineBridge`, `modalBridge`, which all already no-op `queueState` from
#292), not one of the three typecheck-gating exhaustive bridges. `subscribeQueue` guards on
`snapshot !== null`, not truthiness, so an empty `queued: []` snapshot is never dropped as falsy.

The listener's other branch, the `connected`-edge reset ([#197](../codebase/197.md)), is
deliberately **not** folded into `translateQueueState` — it lives as a leading check in
`subscribeQueue` itself, reading only `event.type`. This keeps the translator a pure
`queueState`→snapshot filter (pinned by a test asserting `connected` maps to `null` through it) and
is the one structural difference from #415's modal-bridge twin, which routes `connected` through its
translator as a new `ModalEvent` union member instead — the modal bridge already had a
reducer-style event union to extend; the queue bridge doesn't, so the reset takes the cheaper
listener-branch shape rather than inventing one.

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
    → resetBacklogs()   [whole map cleared, or same-ref no-op if already empty]
  → (then, per non-empty conversation) daemon re-sends queue_state → the flow above repopulates it
```

## Configuration and usage

- Mounted app-level in `src/renderer/src/App.tsx`, as a fourth headless sibling alongside
  `<ConversationListData/>` / `<SessionIdData/>` / `<RunSettingsWriteData/>` — one stable,
  app-lifetime listener with no subscribe/unsubscribe churn as the route flips, because a
  `queue_state` marker can arrive before #294's render slice is ever mounted, and several can
  arrive back-to-back for different conversations (#878/#879).
- Import surface for #294 (shipped): `import { useQueueStore, selectBacklogFor } from
  '../../store/queueStore'`, consumed in `ConversationScreen.tsx`. #294 did **not** source "which
  conversation is open" from nav/route state — this store deliberately does not own that concern,
  and the architecture spec explicitly ruled out adding nav plumbing for this slice. Instead #294
  binds `selectBacklogFor` to `MILESTONE_CONVERSATION_ID` (from `composerSend.ts`, the same id the
  composer sends under) at module scope, once, for the single-active-conversation milestone; a
  future conversation-selection ticket is expected to replace this with a real nav-sourced id.
- [#197](../codebase/197.md) (shipped, reconcile-on-connect) does **not** use `selectBacklogs` as
  #293 anticipated — it clears the whole map wholesale via `resetBacklogs` instead of iterating it,
  so `selectBacklogs` shipped with no production caller (see Edge cases, below).
- [#296](../codebase/296.md) (shipped) reads this store only indirectly — its drop affordance never
  touches `useQueueStore`/`selectBacklogFor` itself; it fires `dequeueMessageCommand` and lets the
  existing #294 subscription remove the row once the daemon's next `queue_state` snapshot arrives.

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
  clears its whole `backlogs` map on the `connected` edge, so a conversation with no re-send simply
  reads `EMPTY_BACKLOG` after the reconnect rather than surfacing a stale pre-drop entry.
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
- [#197 codebase notes](../codebase/197.md) — the reconcile-on-connect reset (`resetBacklogs` +
  the `connected`-edge branch in `subscribeQueue`), shipped; completes the queue family end to end.
- [#415 codebase notes](../codebase/415.md) — the modal-store twin of #197's reset; same reset
  contract (bare trigger, one slice cleared, same-reference no-op when already empty), applied
  through a translator arm there vs. a listener branch here, since the modal bridge already had an
  event union to extend and the queue bridge doesn't.
- [Real-claude liveness e2e](real-claude-liveness-e2e.md) / [#446 codebase notes](../codebase/446.md) —
  the real-stack (real daemon + real claude) liveness net over this store's inbound `queue_state` path
  and the [dequeue message envelope](dequeue-message-envelope.md) drop path, proving both against a
  genuinely running turn rather than a scripted `daemon.pushFrame`.
