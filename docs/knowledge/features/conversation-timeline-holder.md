# Conversation timeline holder

The retained legacy `conversationTimelineStore`: whole `TimelineState` slices keyed by
conversation ID, bounded at ten with least-recently-viewed ordering. Its standalone methods and
producer tests remain for #2030. Production content uses the host/conversation/epoch-scoped
[daemon item store](thread-item-store.md) through [thread runtime](thread-runtime.md), without
this holder's ten-slice eviction policy or any legacy presentation fallback.

\#2023 removed legacy timeline presentation. #2028 removed navigation's resets, creation,
`markViewed` and clears; #2029 separately retired renderer saved IO. When captured selected
coordinates do not match, the shell still reads a slice's explicit owner for confirmed-deletion
admission, flushing pending legacy folds first.
Retained producer APIs below describe legacy behavior, not the current pane's content lifecycle.
Shared `ThreadEvent`, `TimelineState` and presentation declarations remain in place.

## What it does

Holds a whole `TimelineState` per conversation id: the ordered `items`, `phase`,
`stalled`, `apiRetry`, `compacting`, `localSendPending`, `thinkingTokens` and optional
`latestTurnEnd` and `sessionError`. The `ConversationSlice` wrapper also holds
history-request state, the prepend count, live/history join keys, supplying `serverId`, local-read status
and explicit restored host/coverage evidence. Successful `coverage` lives separately
from pending/failed `history`, so retries retain the last successful cursor. A key **absent** from the map means
"nothing is held for this conversation" — no event has ever arrived, or it was cleared or evicted —
distinct from a
**present, empty** slice ("observed; nothing in the thread yet"). `selectTimelineFor` preserves that
distinction rather than collapsing it, the same three-way reading [background-task roster
store](background-task-roster-store.md)'s `selectRosterFor` established and [conversation activity
store](conversation-activity-store.md)'s `selectActivityFor` reused.

Retention is bounded at `MAX_RETAINED_TIMELINES = 10`, evicting the conversation least recently
**viewed** — not least recently written — whenever a write would exceed the bound. A conversation running
in the background is written to constantly and viewed never; evicting on write order would throw away
exactly the thread the operator stepped away from.

## How it works

- **Shape:** the house four-part store (`zustand/vanilla` DI factory → app-wide singleton → `useStore`
  hook → selector factory bound to one id), following [conversation activity
  store](conversation-activity-store.md) and [background-task roster
  store](background-task-roster-store.md). State is `{ timelines: ReadonlyMap<string, ConversationSlice> }`.
- **Core write paths use named methods, not a keyed action union** — a fold, a view-stamp and two
  clears are independent operations, so a discriminated-union action set would be ceremony without
  benefit, and a generic `write(id, key, value)` would reintroduce a stringly-typed key beside the one
  hostile string this store exists to contain:
  - `dispatchFor(conversationId, event)` — folds one `ThreadEvent` into that id's slice via the existing
    `reduceTimeline`, creating the slice from `initialTimelineState` when the key is absent (even when the
    fold against that seed is itself a no-op). The exception is `toolProgress`: an absent key
    returns the original store state. Client-owned `sessionErrorCleared` also creates no
    absent slice and preserves host/local-read ownership. A heartbeat can only update
    a retained call; creating an empty slice could otherwise evict a retained conversation without adding a row.
    See [live tool progress](conversation-timeline-store.md#live-tool-progress). A
    reduce that changes nothing on an already-held key returns the state object itself, so zustand's
    `Object.is` short-circuit fires and no subscriber wakes.
  - `dispatchLocalEcho(serverId, conversationId, userText)` — folds a composer echo
    using the host resolved by the current send gate. Retains only explicitly
    same-host content and clears local-read status, invalidating pending completion.
    This lets connected reopening reuse the echo without admitting unowned rows.
  - `markLocalSendQueued(conversationId, queued: readonly QueuedItem[])`
    ([#1725](https://github.com/pyrycode/pyrycode-desktop/issues/1725)) — applies the pure
    `markLocalSendQueued` from [thread timeline](thread-timeline-internals.md#the-reducer) to a held
    slice's newest-send indicator and local echo correlation/release facts. An absent key is a same-object no-op — unlike `dispatchFor`, this
    action never creates a slice, since a `queue_state` snapshot naming no held conversation has
    nothing to mark. Called from the [queue bridge](queue-store.md#the-data-path-srcrenderersrcstorequeuebridgets)'s
    `QueueData` snapshot callback, right after `queueStore.setBacklog`, so the same frame that updates
    the queued-backlog rows also lets the open send window know the daemon has the message.
    The trusted `receiptHost()` must match a known held `serverId` before either binding or release;
    a foreign-host snapshot leaves the full state unchanged. Missing origins retain compatibility.
    Queue snapshots remain in `queueStore`; see [local settlement](thread-timeline-internals.md#queued-own-echo-settlement).
  - `markViewed(conversationId)` — stamps a conversation as most recently viewed. Already-tail is a
    same-object no-churn return. Navigation no longer calls it. Present-not-tail moves it. Absent
    **creates** it at the tail, seeded with `initialTimelineState` — load-bearing, not a convenience: see § The eviction
    invariant.
  - `clearAllTimelines()` — the retained whole-map clear, unwired from pairing navigation in
    #2028. Nullary by design, so
    "takes no conversation id at all" is a `tsc` guarantee rather than a test. Drops every retained slice;
    returns the state object unchanged when the map is already empty.
  - `clearTimelineFor(conversationId)` — the retained single-key clear. #2028 removed its
    active-exit, inactive-deletion and per-server navigation callers. Drops exactly that key
    by `delete` rather than by overwriting with an empty slice, so the id reads absent afterwards; every
    other slice stays the same held object. Returns the state object unchanged when the key is already
    absent.
- **The eviction invariant — the map's iteration order *is* the eviction order; the head is always the
  next slice to go.** Three rules maintain it and nothing else re-orders:
  1. A fold into an already-present key replaces its value in place (`Map.set` on an existing key
     preserves position) — this is what makes "written constantly, viewed never" fail to protect a slice.
  2. A fold that **creates** a key inserts it at the **head**, ahead of every slice already held.
  3. `markViewed` moves the key to the **tail**, creating it there if absent.
     On-demand `beginLocalTimelineRead` also installs its pending slice at the tail.

  Neither [#757](../codebase/757.md) clear is an exception: `Map.prototype.delete` preserves the position
  of every remaining entry, so a removal re-orders nothing, and dropping the whole map leaves nothing left
  to order.

  The consequence: every never-viewed slice sits ahead of every viewed slice, and viewed slices are
  ordered least-recently-viewed first. The victim is always a never-viewed slice when one exists,
  otherwise the least recently viewed one.

  **Why never-viewed ranks oldest is a security decision.** A noisy or hostile relay fanning frames for
  ids the operator has never opened mints one entry per id. Entering new keys at the tail would let N
  unknown ids evict N of the operator's actually-open threads — the bound becoming the attack's mechanism.
  Entering at the head instead means an unbounded burst of unknown ids displaces **at most one** viewed
  slice, then only evicts its own never-viewed predecessors. The structural half of that is unchanged:
  `dispatchFor` (daemon-driven) can only ever insert at the head and never promotes, so the head-insert
  rule holds for the frame fan-out exactly as stated.

  Navigation no longer promotes keys: #2028 removed activation's `markViewed` call and creation's
  `initializeCreatedTimeline`. A retained method's tail-insert behavior must not be mistaken for
  production navigation policy. Standalone tests still cover the ordering algorithm until #2030.

  Ordering data comes **only** from write and view sequence — never from the id's own value. No sorting,
  comparing, normalizing, lowercasing, trimming or length-checking of keys anywhere; a lexicographic sort
  would hand a hostile id (`''` sorts first) the choice of which conversation dies.
- **The head-insert rebuild.** `Map` has no insert-at-head primitive, so `withNewSliceAtHead` rebuilds: a
  fresh map with the new key set first, then every survivor copied in iteration order (evicting the
  current head first, before the insert, so a newcomer can never be its own victim). This reads like the
  map-spread the hard security header forbids but is not it — the prohibition is about materializing the
  map into an **object** (`Object.fromEntries`, a spread into `{}`, `JSON.stringify`); `new Map(iterable)`
  uses `Map.prototype.set` semantics throughout, so a hostile key like `'__proto__'` stays an ordinary own
  entry across the rebuild. `withSliceAtTail` does the same rebuild discipline for a move-or-create at the
  tail. Every survivor in both rebuilds is copied **by reference**, so a write for one conversation leaves
  every other conversation's slice `Object.is`-identical to what it held before — a component watching a
  different conversation does not re-render.
- **Timeline read path:** `selectTimelineFor(conversationId)` is a selector *factory*, not
  a whole-map selector. Returns `s.timelines.get(conversationId)?.timeline ?? null`. `null` is a stable reference,
  so no `EMPTY_*` constant is hoisted and no fresh object is built per call. There is deliberately no
  `selectAllTimelines` and no re-export of `selectItems`/`selectPhase`/the chrome selectors — a caller
  branches on `null`, then applies the existing `threadTimeline` selectors to the slice it got back.
- **Hostile keys:** `ReadonlyMap` is mandated over `Record<string, …>` specifically so `'__proto__'`,
  `'constructor'` and `''` are ordinary keys by construction rather than by validation —
  `Map.prototype.get`/`.set` never touch the prototype chain. No computed object keys anywhere on either
  write path.
- **The `?? initialTimelineState` collapse is explicitly banned at every read site**, and this store
  can't make that unavailable the way its twin does: `initialTimelineState` is already exported from
  `threadTimeline.ts` for the flat store's own use, so un-exporting it here would be an adjacent refactor
  out of scope. The substitute is three compensating controls: the module-header ban stated outright,
  no re-export of the constant from this module (so a collapse needs a deliberate import from
  `threadTimeline`, not a nearby default), and the AC4 tests asserting the three-way distinction through
  the read surface alone.
- **The import boundary:** Zustand, shared types/history validation and thread-timeline
  helpers are used. No `activeConversationStore`, no `./timelineStore`, no
  `src/renderer/src/screens/`. With no reference to the open conversation in scope, the `?? activeConversation`
  fallback banned in prose at the four turn-stream arms (#751-#754) is not something a developer must
  remember to avoid here — it is unavailable.
- **Log-free by construction.** No `console.*` on any path — a diagnostic here would carry not just an
  untrusted `conversationId` but assistant message text. [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md)'s
  content-free rule keeps both out. A read miss and an eviction are both silent by design, not swallowed
  errors. The holder performs no persistence and never writes conversation content
  to renderer web storage. The legacy saved-snapshot writer was separately retired by #2029;
  authoritative item persistence belongs to [chat history](chat-history.md). Clearing or evicting
  a legacy slice does not remove protected saved content.

### Local timeline admission

The standalone `beginLocalTimelineRead` API admits validated saved rows through an explicit
completion handle, not fabricated daemon events. A process-local owner symbol, host and loading
status reject stale success/failure after accepted live/history content, local sends, cancellation,
host replacement, clear or eviction. Notice replacement preserves ownership; settlement retires it
while carrying current sidecars, so a late callback cannot resurrect a cleared notice. Same-host
history request/cursor state survives local-read cancellation.

These are retained API guarantees. #2029 removed renderer legacy saved-IO wiring; production
restoration opens authoritative daemon items through the thread runtime. Saved provenance is not
network capability, and a legacy slice or pending handle cannot authorize production display.
Eviction of a legacy slice never deletes protected disk content.

Creation no longer calls `initializeCreatedTimeline`; the retained method can still establish an
empty host-owned slice for standalone callers/tests. It has no production navigation role.

### Confirmed deletion lifecycle

[Confirmed deletion](paired-shell-conversation-deletion.md#confirmed-deletion-and-host-authority)
compares the main-stamped host with the captured selected host when its conversation matches.
Otherwise it reads the legacy slice's explicit `serverId` after flushing accepted folds. Missing,
unknown or foreign ownership grants no active-exit authority. A queued
foreign-host fold may change the owner during that flush, so the getter cannot be replaced by a
stale snapshot or active-host guess.

\#2028 removed active and inactive legacy clearing. The holder's map and slice references survive
confirmation; only an owned active ID exits and clears active/session/configuration/prompt state.
Inactive confirmation leaves another chat's state and route untouched and emits no
`inactive-cleared` diagnostic. Authoritative item/pending-send/query/read cleanup and protected
removal remain independent, host-qualified boundaries. A missing sidebar row does not prove those
resources were removed; use [runtime lifecycle coverage](thread-runtime.md#navigation-retirement-validation).

### Stopped records and history isolation

Each slice holds its own [latest live stop](thread-timeline-internals.md#stopped-turn-state).
Activity in conversation B cannot clear A's recovery or move A's boundary into B.
The composer reads only the open id's `timeline.latestTurnEnd`; switching views
does not itself end another conversation's recovery lifecycle.

`reduceHistoryPage` returns rows from a scratch fold. `prependHistoryFor` changes
the held items while preserving live state, or seeds an absent timeline with those
items and no recovery. Thus replay can draw an old stopped record without reviving
its composer guidance. Eviction and conversation/pairing clears remove both the
boundary and transient reading with their slice.

## Configuration and usage

- File: `src/renderer/src/store/conversationTimelineStore.ts`.
- Singleton: `conversationTimelineStore`. Hook: `useConversationTimelineStore(selector)`.
- Read one conversation: `useConversationTimelineStore(selectTimelineFor(conversationId))`.
- **Retained producers:** the timeline bridge and legacy composer/queue helpers keep their
  standalone behavior and tests until #2030. Production thread rendering and pending sends use
  the authoritative runtime; retained APIs must not restore a legacy content route.
- **Navigation:** activation, creation, exit, archive, confirmed active/inactive deletion and
  pairing/per-server cleanup neither reset the flat timeline nor create, view-stamp or clear a
  keyed slice. No timeline dependencies remain in the navigation effect objects. The deletion
  ownership getter is deliberately retained as a read-side dependency.
- **Legacy read/restore APIs:** `markViewed`, `initializeCreatedTimeline`, local read handles and
  clear methods remain standalone APIs. #2029's saved-IO retirement is separate from #2028's
  navigation cleanup; method availability does not establish a production caller.
- **Reconnect producer behavior:** `clearSessionErrorsForHost(serverId)` clears only that host's
  legacy notices and retains rows, read ownership and unrelated slice references. The retained
  producer's bound remains `MAX_RETAINED_TIMELINES`.

## Edge cases and limitations

- **Legacy history backfills rows only.** The retained reducer can restore an old stopped boundary,
  but cannot revive its live recovery reading. This is standalone producer behavior; production
  opening/paging is owned by [thread runtime](thread-runtime.md#restore-recovery-and-cleanup).
- **Bounds slice count, not slice bytes.** `MAX_RETAINED_TIMELINES` caps how many conversations' threads
  are retained at once; it does not cap the size of any one thread. A hostile daemon inside an already-
  paired session can still grow one thread without limit via `assistantDelta` — today's flat
  `timelineStore` has exactly the same unbounded single thread, so this store multiplies the worst case by
  at most ten rather than introducing a new exposure. A per-slice byte cap, if ever wanted, is a change to
  `reduceTimeline`, not to this store.
- **Ten is a stated, not a derived, number.** The operator's ask is about switching between a handful of
  chats; raising the constant later is a one-literal edit (it is exported specifically so tests assert
  against the name). History can refill an evicted thread without raising this retention bound.
- **Duplicates, not shares, state with [conversation activity store](conversation-activity-store.md).**
  That store already holds `stalled`/`apiRetrying`/`compacting` per conversation; this store's slices hold
  their own copies of the same three facts as part of the full `TimelineState`. Decided, not pending — the
  two stores' per-fact clear semantics span 28 renderer references and are not being unpicked for this
  chain.
- **Retained producer bounds need standalone coverage.** A burst of unknown IDs inserts at the head,
  displacing at most one viewed legacy slice before evicting its own never-viewed predecessors.
  The algorithm remains covered independently of production navigation.
- **Eviction is a legacy API contract.** Activation no longer promotes a slice at the navigation
  seam. Do not use the holder's iteration order or ten-slice policy to reason about production
  daemon item retention or read authority.

## Related decisions

- [Conversation unread predicate](conversation-unread.md) — #778, a second consumer of `selectTimelineFor`
  formerly alongside the legacy pane: a framework-free predicate, reading this store's output against [conversation last-read
  store](conversation-last-read-store.md)'s mark to answer whether a conversation is unread.
- [Conversation activity store](conversation-activity-store.md) — the direct structural precedent this
  store's shape is copied from rather than re-derived: same `ReadonlyMap` + copy-on-write + selector-
  factory posture, applied to a different per-conversation payload, and the store that first named (and
  declined) the cap this one adopts.
- [Background-task roster store](background-task-roster-store.md) — the earlier `ReadonlyMap` + copy-on-
  write + `?? null` selector precedent both keyed stores above build on, and the other refusal of a cap
  this ticket diverges from.
- [Thread timeline](thread-timeline.md) — `TimelineState`, `ThreadEvent`, and `reduceTimeline`, all
  imported and reused unchanged; this store adds no field to the model and writes no second reducer.
- [Conversation timeline store](conversation-timeline-store.md) — the existing **flat**, single-
  conversation store and bridge this one runs alongside without replacing. Do not confuse the two: that
  page documents `timelineStore.ts`/`timelineBridge.ts`, which stayed dual-written but lost
  `ConversationScreen` as a reader when [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758)
  cut the screen over to this store.
- [Conversation shell](conversation-shell.md) — the authoritative production pane; its legacy
  keyed-holder render route was retired in #2023.
- [Composer send](composer-send.md) — the second row-adding writer #756 folded into this holder, beside
  the bridge fan-out documented on [conversation timeline store](conversation-timeline-store.md).
- [Paired shell](paired-shell-conversation-exits.md) — configuration/active-exit behavior after
  retiring legacy navigation mutations; the deletion ownership getter remains.
- [ADR 0007 — Content-free diagnostics by construction](../decisions/0007-content-free-diagnostics-by-construction.md).
- [ADR 0008 — Thread timeline model](../decisions/0008-thread-timeline-model.md).
- [#755 codebase notes](../codebase/755.md) — the holder's implementation summary, code review, and
  lessons learned.
- [#756 codebase notes](../codebase/756.md) — the writer's implementation summary, code review, and
  lessons learned.
- [#757 codebase notes](../codebase/757.md) — the clears' implementation summary, code review, and
  lessons learned.
