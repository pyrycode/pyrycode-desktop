# Queue store

The renderer's held copy of each open conversation's queued-message backlog — a dedicated,
unidirectional Zustand store fed by a headless subscription binding that observes the [daemon-event
channel](daemon-event-channel.md)'s `queueState` arm, so the queue render slice ([#294](../codebase/294.md),
shipped) and the reconcile-on-connect slice (#197) can read one source of truth.

Introduced in [#293](../codebase/293.md), split from #145 alongside [#292](../codebase/292.md)
(transport decode, shipped first) / [#294](../codebase/294.md) (render, shipped) / #295 (command,
re-split) / #296 (drop, not yet built). This ticket shipped no visible surface — #294 is its
first consumer. #295 (the drop command) tripped the ≥5-file split gate and was re-split along the
#235/#236 seam into [#299](../codebase/299.md) (wire + builder, shipped) → [#300](../codebase/300.md)
(the `daemonConnection` method + IPC command, shipped — see [dequeue message
envelope](dequeue-message-envelope.md)); #295 itself is closed. #296 (the render affordance that
actually calls the command) is the last remaining slice.

## What it does

Holds each conversation's queued-message backlog — `{ queued_msg_id, text, ts }` rows in enqueue
order — keyed by `conversationId`, and replaces a key's held backlog wholesale on every
`queue_state` snapshot for that conversation: an entry the daemon removed disappears, order follows
the event, and an empty backlog clears the held list to `[]`. Before any snapshot arrives for a
conversation, its backlog reads as empty. Deliberately **not** a [session
store](session-store.md) or [timeline store](conversation-timeline-store.md) facet: `queue_state`
is daemon *state* (SSOT pyrycode #720), not part of claude's turn stream, so it never folds into
`reduceTimeline` and gets its own store instead.

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
}

createQueueStore(init?)                  // vanilla createStore — one isolated instance per test (DI seam)
queueStore                               // app-wide singleton
useQueueStore(selector)                  // narrow-slice React binding: useStore(queueStore, selector)
EMPTY_BACKLOG: readonly QueuedItem[]      // stable [] reference for the "no snapshot yet" default
selectBacklogFor(conversationId)(state)   // selector FACTORY — the primary read surface (#294)
selectBacklogs(state)                    // whole-map read surface, for #197's reconcile pass
```

Keyed by `conversationId`, not a single flat backlog — this is load-bearing, not defensive
speculation. Two pieces of merged evidence force it: (1) `src/shared/ipc/events.ts`'s `queueState`
arm carries `conversationId` specifically *because* the snapshot is replacement-truth and this
store keys by it; (2) daemon #878/#879 (reconcile-on-connect) unicasts one `queue_state` per
non-empty conversation on (re)connect, so several snapshots for *different* conversations can
arrive back-to-back — a flat "hold the last snapshot" slot would let one clobber another.

A **single setter** (`setBacklog`), not a reducer — there is exactly one mutation ("record the
latest snapshot for a conversation"), so a discriminated-union action set would be a one-member
union. Mirrors [`sessionIdStore`](session-id-store.md)'s DI-factory → singleton → hook → selector
structure and [`runSettingsWriteStore`](session-settings-send.md)'s `ReadonlyMap` copy-on-write
idiom: `setBacklog` clones the map, sets the key, and replaces (`const next = new Map(s.backlogs);
next.set(conversationId, queued); set({ backlogs: next })`). `queued` is held **verbatim by
reference** — wire snake_case, no camelCase remap, no coercion, no validation (the
[conversation-list store](conversation-list-store.md) posture; #292 owns the fail-closed decode).
The write is unconditional: an empty `queued: []` sets that key to `[]` (a real replacement — "this
conversation's backlog is now empty") rather than deleting the key; stale-key eviction on reconnect
is left to #197, via `selectBacklogs`.

`selectBacklogFor` is a selector *factory* bound to one `conversationId`, returning
`s.backlogs.get(id) ?? EMPTY_BACKLOG`. This keeps reads narrow-slice-correct: a `setBacklog` for a
*different* conversation produces a new `Map`, but `newMap.get(openId)` returns the *same* array
reference as before, so `Object.is` holds and a component watching `openId` does not re-render.

### The data path (`src/renderer/src/store/queueBridge.ts`)

```ts
translateQueueState(event: DaemonEvent): QueueSnapshot | null
// switch (event.type) { case 'queueState': return { conversationId: event.conversationId, queued: event.queued }; default: return null }

subscribeQueue(onDaemonEvent, setBacklog): () => void
// onDaemonEvent(event => { const s = translateQueueState(event); if (s !== null) setBacklog(s) })
// returns the off-handle (the sessionIdBridge idiom)

QueueData(): null
// headless component, one subscribe effect (deps []), mounted app-level in App.tsx
```

Reactive-only — like [`sessionIdBridge`](session-id-store.md) and unlike
`conversationListBridge`, the daemon pushes `queue_state` unsolicited, so there is no request half:
no command sent, no connected-edge trigger. `translateQueueState` rebuilds a fresh named-field
literal (never `return event`, never a spread — the `modalBridge` idiom), and uses `default: null`,
not `assertNever`: this is the *fourth* independent subscriber on the `onDaemonEvent` channel
(after `daemonEventBridge`, `timelineBridge`, `modalBridge`, which all already no-op `queueState`
from #292), not one of the three typecheck-gating exhaustive bridges. `subscribeQueue` guards on
`snapshot !== null`, not truthiness, so an empty `queued: []` snapshot is never dropped as falsy.

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
- Import surface for #197 (reconcile-on-connect): `selectBacklogs` — the whole-map read, to iterate
  every held backlog and evict ones the daemon didn't refresh on reconnect.
- No component consumes `useQueueStore` yet — exported ahead of its first consumer, the same shape
  every prior store/bridge pair in this codebase has shipped in.

## Edge cases and limitations

- **No two-way binding.** `setBacklog` is invoked only by `subscribeQueue`'s wiring; components
  read exclusively through `selectBacklogFor`/`selectBacklogs`.
- **No coercion or validation of `queued`.** The store trusts #292's fail-closed decode
  completely; `queued_msg_id` arrives as a `number`, `text`/`ts` as opaque strings.
- **`text` is untrusted, client-originated transit content** relayed by a content-blind relay.
  This slice has no DOM sink itself; [#294](../codebase/294.md) (the render consumer) renders it as
  plain text only, via auto-escaped React children — never `innerHTML` / `dangerouslySetInnerHTML`.
- **A conversation that *became* empty won't get a fresh `queue_state` on reconnect**, since the
  daemon only unicasts non-empty backlogs per #878/#879 — a stale non-empty entry can persist in
  this store past a reconnect until something prunes it. This store intentionally keeps every key
  it is told about and does not prune; eviction is #197's job, built on `selectBacklogs`.
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
  store's inbound `queue_state` (the #295 drop command's re-split slices, both shipped); #296 (the
  render affordance, not yet built) is what will actually dispatch a removal against an entry this
  store holds.
- Still blocks #197 (reconcile-on-connect, first consumer of `selectBacklogs`, not yet built).
