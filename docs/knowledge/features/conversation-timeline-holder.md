# Conversation timeline holder

The renderer's held copy of **every** conversation's whole timeline — the ordered `items`, `phase`, and
the four chrome scalars a [thread timeline](thread-timeline.md) carries — keyed by `conversationId`
rather than scoped to whichever conversation is open, so leaving a chat and coming back does not throw
its thread away. Bounded at ten and evicted least-recently-**viewed**, the one deliberate divergence from
both of its keyed precedents.

Introduced in [#755](../codebase/755.md), split from #675 alongside #751-#754 (the transport arms that
widened eight `DaemonEvent`s with `conversationId`, all shipped), #756 (the writer), #757 (the clears) and
#758 (the reader cutover, shipped). #755 shipped the holder alone — no writer, no reader — the same
"populated and unread" posture the [conversation activity store](conversation-activity-store.md) shipped
for #747 before its own writer/reader landed. [#756](../codebase/756.md) gave it its first writer: both of
the timeline's row-adding writers — the bridge fan-out and the composer's optimistic echo — now fold into
this holder as well as into the flat store, dual-write (Strangler Fig, ADR 0008). [#757](../codebase/757.md)
gave it its first clears — the whole map dropped at the pairing boundary, one slice dropped when the
operator's open conversation is deleted out from under them — wired at the same two edges that already
reset the flat store. [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758) gave it its first
reader: `ConversationScreen` now renders the open conversation's own slice from this holder, so the holder
is no longer invisible from the operator's side. Not to be confused with the [conversation timeline
store](conversation-timeline-store.md) (`timelineStore.ts`), the existing **flat**, single-conversation
store this one runs alongside — that store is still dual-written (the bridge fan-out and the composer's
echo both still fold into it) but is no longer read by `ConversationScreen`; this one is the independent
holder that now carries every retained conversation's thread and is the sole render source for the chat
pane.

[#786](https://github.com/pyrycode/pyrycode-desktop/issues/786) gave `markViewed` — the one write path
still shipping unwired — its first production caller, at the activation seam (`activateConversation.ts`,
constructed once in `PairedShell.tsx`; see [Paired shell § The view
stamp](paired-shell.md#the-view-stamp-activateconversationts-786)). This is what **arms** the ten-slice
eviction bound in production: until then every slice was never-viewed and eviction silently degraded to
first-write order. #758 remains the reader cutover, now depending on this rather than performing it.

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
- **Four named write paths, not a reducer over a keyed action union** — a fold, a view-stamp and two
  clears are independent operations, so a discriminated-union action set would be ceremony without
  benefit, and a generic `write(id, key, value)` would reintroduce a stringly-typed key beside the one
  hostile string this store exists to contain:
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
  - `clearAllTimelines()` — [#757](../codebase/757.md)'s pairing-boundary clear. Nullary by design, so
    "takes no conversation id at all" is a `tsc` guarantee rather than a test. Drops every retained slice;
    returns the state object unchanged when the map is already empty.
  - `clearTimelineFor(conversationId)` — [#757](../codebase/757.md)'s single-conversation clear, fired
    when that conversation is deleted or archived out from under the operator. Drops exactly that key,
    by `delete` rather than by overwriting with an empty slice, so the id reads absent afterwards; every
    other slice stays the same held object. Returns the state object unchanged when the key is already
    absent.
- **The eviction invariant — the map's iteration order *is* the eviction order; the head is always the
  next slice to go.** Three rules maintain it and nothing else re-orders:
  1. A fold into an already-present key replaces its value in place (`Map.set` on an existing key
     preserves position) — this is what makes "written constantly, viewed never" fail to protect a slice.
  2. A fold that **creates** a key inserts it at the **head**, ahead of every slice already held.
  3. `markViewed` moves the key to the **tail**, creating it there if absent.

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

  **What is not true, and was before [#786](https://github.com/pyrycode/pyrycode-desktop/issues/786):**
  that only the operator can move a key to the tail. `markViewed`'s one call site is the activation seam
  (`activateConversation.ts`, see [Paired shell § The view
  stamp](paired-shell.md#the-view-stamp-activateconversationts-786)), and of the three paths that reach it
  two are the operator's own — a row click and a re-click of the row already open — while the third is the
  daemon's own `conversationCreated` confirmation, which `useConversationCreatedNav` activates on
  ungated. The tail is therefore **not** an operator-only region: a compromised paired daemon emitting N
  `conversationCreated` frames mints N tail entries, each evicting the head, and can displace **every**
  viewed slice rather than the at-most-one the head-insert rule bounds its own fan-out to. Accepted rather
  than gated, on the actor: that is the paired daemon inside the Noise session, which on this same path
  already resets the flat `timelineStore`, clears the session id and re-keys the pane, and already owns
  the entire content stream. The relay is content-blind and outside the session, so it cannot mint a
  `conversationCreated` at all.

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
  keep writing the flat `timelineStore` unchanged (dual-write). **`markViewed` gained its first caller in
  [#786](https://github.com/pyrycode/pyrycode-desktop/issues/786)** — wired at the activation seam — so
  eviction ordering is now armed in production rather than degrading to first-write order; see § Edge
  cases.
- **Reader, as of [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758):** `ConversationScreen`
  binds `selectTimelineFor(openConversationId)` through a `useMemo`-stable selector factory
  (`selectOpenTimelineFor`, exported from `ConversationScreen.tsx` for its own unit tests), keyed off
  `activeConversationStore`'s id. See [Conversation shell § The open-conversation reader
  cutover](conversation-shell.md#the-open-conversation-reader-cutover-758).
- **Clears, as of [#757](../codebase/757.md):** `clearAllTimelines()` — nullary, drops every retained
  slice — is wired into `clearPairingScopedState`, the shared helper both pairing-ending paths (unpair,
  pair-another-server) already call. `clearTimelineFor(conversationId)` — drops exactly one slice, every
  other conversation's held object untouched — is wired into `exitActiveConversation`, fired when the
  conversation on screen was deleted or archived out from under the operator. Both sit immediately after
  each helper's pre-existing flat `dispatchTimeline({ type: 'reset' })` call, the same dual-write position
  #756 established for the two writers. Both **delete** rather than overwrite with an empty slice, so a
  cleared id reads absent through `selectTimelineFor`, not present-and-empty; both return the state object
  unchanged on a no-op (already-empty map, already-absent key), which is what keeps
  `clearPairingScopedState`'s idempotence claim true. This map still has **no** `connected`-edge clear by
  design — unlike its two keyed siblings, a timeline must survive a reconnect, so growth between
  handshakes is bounded only by `MAX_RETAINED_TIMELINES`.
- **Reader cutover, shipped in [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758):**
  `ConversationScreen`'s seven reads of the flat `timelineStore` (six selectors on the container plus
  `InterruptControl`'s own `selectPhase`) collapsed into one subscription to this store's
  `selectTimelineFor(openConversationId)`. `activateConversation`'s flat-store reset still fires on every
  switch; it now fires into a store nothing renders from. `markViewed` was already wired at the switch
  seam (`activateConversation.ts`) by
  [#786](https://github.com/pyrycode/pyrycode-desktop/issues/786), so every open conversation already had
  a slice by the time #758 needed one to read.

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
- **Eviction ranking armed in production since [#786](https://github.com/pyrycode/pyrycode-desktop/issues/786); rendered since [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758).**
  `markViewed` gained its first caller at the activation seam; a slice is now promoted to the tail every
  time the operator opens (or re-opens) its conversation, so the least-recently-viewed eviction policy
  actually holds rather than degrading to first-write order. #758 gave the holder its first reader, so a
  slice surviving eviction is now the operative fact behind AC2 ("switching away and back shows the thread
  as it now stands"), not just an internal ranking with no visible consequence — including the ranking's
  widened trust boundary (see § The eviction invariant, above).

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
  page documents `timelineStore.ts`/`timelineBridge.ts`, which stayed dual-written but lost
  `ConversationScreen` as a reader when [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758)
  cut the screen over to this store.
- [Conversation shell](conversation-shell.md) — `ConversationScreen`, this store's first and (as of
  [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758)) only reader. See
  [§ The open-conversation reader cutover](conversation-shell.md#the-open-conversation-reader-cutover-758).
- [Composer send](composer-send.md) — the second row-adding writer #756 folded into this holder, beside
  the bridge fan-out documented on [conversation timeline store](conversation-timeline-store.md).
- [Paired shell](paired-shell.md) — `clearPairingScopedState` and `exitActiveConversation`, the two pure
  helpers [#757](../codebase/757.md) wires the new clears into, and where they run inside `PairedShell`'s
  nav flow; `activateConversation`, the pure helper
  [#786](https://github.com/pyrycode/pyrycode-desktop/issues/786) wires `markViewed` into — see
  [§ The view stamp](paired-shell.md#the-view-stamp-activateconversationts-786) for the ordering rationale
  (outside the id-change gate, after `setActiveConversation`).
- [ADR 0007 — Content-free diagnostics by construction](../decisions/0007-content-free-diagnostics-by-construction.md).
- [ADR 0008 — Thread timeline model](../decisions/0008-thread-timeline-model.md).
- [#755 codebase notes](../codebase/755.md) — the holder's implementation summary, code review, and
  lessons learned.
- [#756 codebase notes](../codebase/756.md) — the writer's implementation summary, code review, and
  lessons learned.
- [#757 codebase notes](../codebase/757.md) — the clears' implementation summary, code review, and
  lessons learned.
