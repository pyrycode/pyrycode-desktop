# Conversation timeline holder

The renderer's held copy of **every** conversation's whole timeline — the ordered `items`, `phase`, and
the four chrome scalars a [thread timeline](thread-timeline.md) carries — keyed by `conversationId`
rather than scoped to whichever conversation is open, so leaving a chat and coming back does not throw
its thread away. Bounded at ten and evicted least-recently-**viewed**, the one deliberate divergence from
both of its keyed precedents.

Introduced in [#755](../codebase/755.md), split from #675 alongside #751-#754 (the transport arms that
widened eight `DaemonEvent`s with `conversationId`, all shipped), #756 (the writer), #757 (the clears) and
#758 (the reader cutover). #755 shipped the holder alone — no writer, no reader — the same "populated and
unread" posture the [conversation activity store](conversation-activity-store.md) shipped for #747 before
its own writer/reader landed. [#756](../codebase/756.md) gave it its first writer: both of the timeline's
row-adding writers — the bridge fan-out and the composer's optimistic echo — now fold into this holder as
well as into the flat store, dual-write (Strangler Fig, ADR 0008). Still no reader (#758) and no clears
(#757), so the holder stays invisible from the operator's side despite now carrying live traffic. Not to
be confused with the [conversation timeline store](conversation-timeline-store.md) (`timelineStore.ts`),
the existing **flat**, single-conversation store this one runs alongside — that store keeps serving the
open conversation unchanged; this one is an independent holder, written but not yet read, for every
conversation's thread at once.

## What it does

Holds a whole `TimelineState` per conversation id: the ordered `items`, `phase`, and all four chrome
scalars (`stalled`, `apiRetry`, `compacting`, `localSendPending`) — [thread timeline](thread-timeline.md)'s
existing shape, imported unchanged, with no wrapper entry type. A key **absent** from the map means
"nothing is held for this conversation" — no event has ever arrived, or it was evicted — distinct from a
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
  hook → selector factory bound to one id), field-for-field the same shape as [conversation activity
  store](conversation-activity-store.md) and [background-task roster
  store](background-task-roster-store.md). State is `{ timelines: ReadonlyMap<string, TimelineState> }`.
- **Two write paths, not a reducer over a keyed action union** — a fold and a view-stamp are independent
  operations, so a discriminated-union action set would be ceremony without benefit, and a generic
  `write(id, key, value)` would reintroduce a stringly-typed key beside the one hostile string this store
  exists to contain:
  - `dispatchFor(conversationId, event)` — folds one `ThreadEvent` into that id's slice via the existing
    `reduceTimeline`, creating the slice from `initialTimelineState` when the key is absent (even when the
    fold against that seed is itself a no-op — a fold for a never-opened id must create, not drop). A
    reduce that changes nothing on an already-held key returns the state object itself, so zustand's
    `Object.is` short-circuit fires and no subscriber wakes.
  - `markViewed(conversationId)` — stamps a conversation as most recently viewed. Already-tail is a
    same-object no-churn return (the common case: `activateConversation`'s `onOpen` fires on every row
    click, including a re-click of the already-open row). Present-not-tail moves it. Absent **creates** it
    at the tail, seeded with `initialTimelineState` — load-bearing, not a convenience: see § The eviction
    invariant.
- **The eviction invariant — the map's iteration order *is* the eviction order; the head is always the
  next slice to go.** Three rules maintain it and nothing else re-orders:
  1. A fold into an already-present key replaces its value in place (`Map.set` on an existing key
     preserves position) — this is what makes "written constantly, viewed never" fail to protect a slice.
  2. A fold that **creates** a key inserts it at the **head**, ahead of every slice already held.
  3. `markViewed` moves the key to the **tail**, creating it there if absent.

  The consequence: every never-viewed slice sits ahead of every viewed slice, and viewed slices are
  ordered least-recently-viewed first. The victim is always a never-viewed slice when one exists,
  otherwise the least recently viewed one.

  **Why never-viewed ranks oldest is a security decision.** A noisy or hostile relay fanning frames for
  ids the operator has never opened mints one entry per id. Entering new keys at the tail would let N
  unknown ids evict N of the operator's actually-open threads — the bound becoming the attack's mechanism.
  Entering at the head instead means an unbounded burst of unknown ids displaces **at most one** viewed
  slice, then only evicts its own never-viewed predecessors. Reinforced structurally: `dispatchFor`
  (daemon-driven) can only ever insert at the head; only `markViewed` (renderer-local, reachable only from
  the operator's own activation) can promote to the tail. The protected region of the map is populated by
  operator action alone.

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
- **Read path:** `selectTimelineFor(conversationId)` is the only read surface — a selector *factory*, not
  a whole-map selector. Returns `s.timelines.get(conversationId) ?? null`. `null` is a stable reference,
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
- **The hard import constraint, checkable by grep:** this module's only imports are `zustand/vanilla`,
  `zustand`, and `./threadTimeline`. No `activeConversationStore`, no `./timelineStore`, no
  `src/renderer/src/screens/`. With no reference to the open conversation in scope, the `?? activeConversation`
  fallback banned in prose at the four turn-stream arms (#751-#754) is not something a developer must
  remember to avoid here — it is unavailable.
- **Log-free by construction.** No `console.*` on any path — a diagnostic here would carry not just an
  untrusted `conversationId` but assistant message text. [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md)'s
  content-free rule keeps both out. A read miss and an eviction are both silent by design, not swallowed
  errors. Nothing is persisted, and must not be — a `localStorage` write here would carry conversation
  content across the pairing boundary #757 exists to enforce.

## Configuration and usage

- File: `src/renderer/src/store/conversationTimelineStore.ts`.
- Singleton: `conversationTimelineStore`. Hook: `useConversationTimelineStore(selector)`.
- Read one conversation: `useConversationTimelineStore(selectTimelineFor(conversationId))`.
- **Writer, as of [#756](../codebase/756.md):** `useTimelineBridge`'s fan-out calls `dispatchFor` for
  every one of the eight id-carrying owned arms (`assistantDelta`/`turnEnd`/`turnState`/`toolUse`/
  `toolResult`/`stallDetected`/`apiRetry`/`compacting` — the whole #675 family), keyed by each event's own
  `conversationId`, never the open conversation's; and the composer's optimistic echo
  (`composerSend.ts`) calls it too, keyed by the conversation the message was sent to. Both writers also
  keep writing the flat `timelineStore` unchanged (dual-write). `markViewed` still has no caller, so every
  slice this creates today is never-viewed and enters at the head — see § Edge cases.
- **Still no reader.** Nothing reads `selectTimelineFor` anywhere in the repo outside this store's own
  test — grepping for `selectTimelineFor` / `useConversationTimelineStore` outside this file and test
  still returns nothing. It is not dead code: it is the fourth of a five-ticket chain (#751-#754, #755,
  #756, #757, #758) that lands as a verified no-op from the operator's side until #758 cuts the reader
  over.
- **Clears (not yet built):** #757 will own the pairing-boundary and conversation-deletion clears. This
  map has **no** `connected`-edge clear by design — unlike its two keyed siblings, a timeline must survive
  a reconnect, so growth between handshakes is bounded only by `MAX_RETAINED_TIMELINES`.
- **Reader cutover (not yet built):** #758 will migrate `ConversationScreen` off the flat
  `timelineStore` to this store and wire `markViewed` at the switch seam
  (`activateConversation.ts`, which already takes a timeline dependency).

## Edge cases and limitations

- **No history backfill.** The timeline's only production writers are the live stream and the composer's
  optimistic echo (`activateConversation.ts`) — this store adds no fetch. An evicted slice is simply gone:
  reopening that conversation shows an empty thread that fills from the next live event, exactly the way
  every conversation switch behaves today.
- **Bounds slice count, not slice bytes.** `MAX_RETAINED_TIMELINES` caps how many conversations' threads
  are retained at once; it does not cap the size of any one thread. A hostile daemon inside an already-
  paired session can still grow one thread without limit via `assistantDelta` — today's flat
  `timelineStore` has exactly the same unbounded single thread, so this store multiplies the worst case by
  at most ten rather than introducing a new exposure. A per-slice byte cap, if ever wanted, is a change to
  `reduceTimeline`, not to this store.
- **Ten is a stated, not a derived, number.** The operator's ask is about switching between a handful of
  chats; raising the constant later is a one-literal edit (it is exported specifically so tests assert
  against the name). If ten proves too small in practice given the no-backfill rule above, the fix is a
  backfill ticket, not a bigger constant.
- **Duplicates, not shares, state with [conversation activity store](conversation-activity-store.md).**
  That store already holds `stalled`/`apiRetrying`/`compacting` per conversation; this store's slices hold
  their own copies of the same three facts as part of the full `TimelineState`. Decided, not pending — the
  two stores' per-fact clear semantics span 28 renderer references and are not being unpicked for this
  chain.
- **Reachable-in-fact, not just in principle, since [#756](../codebase/756.md).** Before #756, nothing
  wrote this store, so `MAX_RETAINED_TIMELINES` was a theoretical ceiling. Now that both writers are live,
  a noisy or hostile daemon can mint a slice per unknown conversation id for the first time. The mitigation
  — head-insert eviction — holds unmodified: the bound's cost is still capped at "displaces at most one
  viewed slice," per #755's own hostile-burst coverage; #756 added no new test for it, only the note that
  the scenario is no longer hypothetical.
- **Dormant until #758.** `markViewed` has no caller yet, so today every write to this store enters at the
  head and nothing is ever promoted — every slice #756 creates is never-viewed by construction, and a real
  ceiling isn't exercised end to end until the reader cutover wires the viewed signal.

## Related decisions

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
  page documents `timelineStore.ts`/`timelineBridge.ts`, which keep serving the open conversation
  unchanged through this entire five-ticket chain.
- [Composer send](composer-send.md) — the second row-adding writer #756 folded into this holder, beside
  the bridge fan-out documented on [conversation timeline store](conversation-timeline-store.md).
- [ADR 0007 — Content-free diagnostics by construction](../decisions/0007-content-free-diagnostics-by-construction.md).
- [ADR 0008 — Thread timeline model](../decisions/0008-thread-timeline-model.md).
- [#755 codebase notes](../codebase/755.md) — the holder's implementation summary, code review, and
  lessons learned.
- [#756 codebase notes](../codebase/756.md) — the writer's implementation summary, code review, and
  lessons learned.
