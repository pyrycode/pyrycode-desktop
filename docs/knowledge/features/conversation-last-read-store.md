# Conversation last-read store

The retained legacy local item-count map, keyed by `conversationId` and persisted under
`pyry.conversationLastRead`. Production daemon-built threads use host-qualified shown/read versions
and [committed-visible-content publication](conversation-shell.md#authoritative-thread-read-publication).
Missing authoritative metadata never enables a local-count fallback.

[#2028](https://github.com/pyrycode/pyrycode-desktop/issues/2028) removed navigation's count writer,
`stampLastReadFor`, its dependencies and the legacy timeline subscription. `useConversationLastRead`
remains mounted in `PairedShell` and calls only `useReadPublication`. The direct store API,
persistence, legacy unread predicate and pairing/per-server cleanup remain available to other
consumers. Standalone legacy producers/tests stay until #2030; #2029 separately retired renderer
saved IO. Neither ticket changes the authoritative publisher's committed-snapshot requirements.

## What it does

Holds one `LastReadMark` (a plain `number`) per conversation id. A key **absent** from the map means "this
conversation has never been read"; a key present with value `0` means "read, and there was nothing in the
thread at the time" — the two must stay distinct even though navigation no longer stamps them.
`selectLastReadFor` preserves the distinction with `??`, never `||`.

## How it works

- **Authoritative thread publication uses separate supplied evidence.**
  [Thread read publication](conversation-shell.md#authoritative-thread-read-publication) pairs
  immutable committed `readInputs` with completed newest-window/catch-up progress and scoped
  checkpoint/repair/coverage fences. It observes the actual newest shown source row, excluding
  hidden descendants and proxies. It does not use the legacy display IDs below. Route epochs
  invalidate prior pending evidence; reconnect retries only already evidenced targets.
- **The retained legacy observation implementation also requires a committed display.** It has no
  production legacy content route since #2023. `useReadObservation`, mounted in
  `ConversationScreen`, updates a ref with the rendered slice and derived durable target only in a
  layout effect. Stable callbacks read that ref, never an initial captured slice or an uncommitted
  timeline-store snapshot; current list state supplies ownership and read eligibility only. Each
  commit explicitly rechecks observation: a target can advance without any geometry change, so
  resize alone cannot establish publication. The newest user/assistant
  message's trailing edge must be inside the thread viewport between the measured header and input
  borders; the document must be focused and visible, and the Markdown reader closed. Opening,
  receipt and bottom-following alone prove nothing; hidden or queued rows cannot publish.
  Scroll, focus, resize and list changes recheck
  that committed slice. List changes matter because received-read eligibility can arrive after the
  display commits; waiting for another timeline change would leave a visible tail unpublished.
- **Observation setup follows row and mounted-node identity, not streamed slice identity.** A layout
  effect reconciles setup after each commit. The same conversation, numeric newest-message row key,
  pane and thread nodes, and connected tail inside that thread reuse one ResizeObserver, scroll and
  focus listeners, and list subscription. Newest-row discovery searches backwards and stops at the
  first user/assistant item; replacement uses a targeted numeric `data-read-row` selector rather than
  querying all read rows. Durable-target calculation still considers retained contributions below.
  Setup exists even when its initial target is unknown, so independently admitted identity can later
  publish without rediscovery. A changed conversation, key or mounted node disposes replaced setup;
  reader coverage, missing slice/nodes/key and unmount also unsubscribe, remove listeners and
  disconnect all observer targets. Observation watches thread, pane, tail and measured chrome.
- **Only retained display identity supplies a target.** `readTargetFor` requires a contribution
  bound to the newest message's surviving numeric row key, then takes the highest retained row-bound
  ID (including folded deltas/tool patches) and transient display-state ID. The layout commit must
  precede observation. Validated live/replayed `history_entry_id` and independently admitted history
  contributions supply durable IDs; connection/replay IDs, timestamps alone, row counts, optimistic
  echoes, served coverage and list `latest_entry_id` do not. Missing/ambiguous identity cannot advance
  a target, and ID-less replay triggers no identity-recovery fetch. An independently admitted page
  can bind its own durable contribution to that same displayed content; this does not recover or
  assign the replay frame's identity. Ordinary opening/reconnect timeline demand remains owned by
  [the history bridge](conversation-timeline-store-internals.md#the-opening-ask-1259), independently
  of read publication. See [snapshot identity](chat-history.md#retained-display-contributions).
- **Commands are bound to the observed host.** `markConversationRead` requires a nonempty `serverId`
  and exactly `{ conversation_id, up_to }`, with a nonempty conversation ID and non-negative safe
  integer target, including zero. Main validates IPC, resolves the sole current connected claim and
  requires it to match the observed host before sending a fresh allowlisted `mark_conversation_read`
  payload through that connection. Legacy duplicate renderer ownership sends nothing. Thread
  publisher ownership is host-qualified, but main still refuses ambiguous connected claims.
  See [routing](daemon-connection-conversation-routing.md#host-bound-read-routing).
- **Sending does not acknowledge reading.** Only that host/conversation's received daemon mark
  confirms the target. The daemon stores `max(held, min(up_to, latest))`; a clamped reply below the
  target leaves it unconfirmed. Neither command delivery nor a send result clears attention.
- **Pending observations survive navigation and disconnection in memory.** `createReadPublisher`
  coalesces to the highest observed target and consumes an attempt before sending, so repeated delivery,
  renders and effect replay cannot duplicate it. Each host reconnect permits at most one resend of
  that unconfirmed target even while blurred; a newer eligible observation can publish a higher target.
  Send failure, refusal and a lower acknowledgement retain it without an automatic retry loop.
  Confirmation settles it; deletion, host/pairing removal, loss of the read contract or ambiguous/changed
  ownership discards it. A later owner never inherits another host's pending mark. Pending commands
  are never persisted; the local count store below remains a separate retained API.
- **Navigation does not stamp.** The retired route/daemon-backed suppression branches are gone
  with the count writer. Activation, reopening and timeline emission cannot call `recordLastRead`
  through `conversationLastReadBridge`. The direct store API still writes a local count only; it
  cannot publish a daemon read mark or clear authoritative attention.
- **Shape:** the house four-part store (`zustand/vanilla` DI factory → app-wide singleton → `useStore`
  hook → selector factory bound to one id), the same shape as [conversation activity
  store](conversation-activity-store.md) and [conversation timeline
  holder](conversation-timeline-holder.md). State is `{ marks: ReadonlyMap<string, LastReadMark> }`.
- **One named write path:** `recordLastRead(conversationId, itemsSeen)` — copy-on-write replace. A key
  absent from the map is created unconditionally, including a first record of `0`; the guard that decides
  "already recorded" is `s.marks.get(conversationId) === itemsSeen`, `===` against the raw `get` result,
  never a falsy-shaped guard (`!get(id)` or `(get(id) ?? -1) === itemsSeen` both drop a legitimate first
  `0`). A verbatim repeat returns the state object itself so zustand's `Object.is` short-circuit fires and
  no subscriber wakes. Re-recording a different value **replaces**, never accumulates and never
  `Math.max`s — a lower mark must stay recordable, since a conversation whose timeline slice was evicted
  and later recreated restarts its count near zero.
- **Read path:** `selectLastReadFor(conversationId)` is the only read surface — `s.marks.get(id) ?? null`.
  `??`, not `||`, is the whole mechanism: `||` collapses a real mark of `0` into the same `null` a
  never-read conversation produces, with no type error. There is deliberately no whole-map
  `selectAllLastRead` — all three keyed precedents in this family omit their whole-map analogue, and the
  sidebar reads one row at a time.
- **Two clear paths, one per pairing boundary — `clearAllLastRead()` (#779) and `clearLastReadFor(ids)`
  ([#1197](https://github.com/pyrycode/pyrycode-desktop/issues/1197)) — kept as separate write paths on
  purpose, not one signature widened with an optional parameter.** Both are built as `recordLastRead` is:
  guard, persist and return in one expression inside the updater, so no later edit can hoist the write
  above the guard.
  - **`clearAllLastRead()`** answers "the pairing ended" and empties the map. The guard is
    `marks.size === 0`, never a reference check against `initialConversationLastReadState.marks` — since
    #776 an empty store's `marks` is whatever `storage.read()` returned, a **fresh** `Map`, never the
    module constant, so a reference guard would never fire on a clean install and every unpair would
    perform a redundant `localStorage.setItem`. The already-clear arm returns the state object itself, so
    zustand's `Object.is` short-circuit fires and no subscriber wakes; the cleared arm returns the named
    `initialConversationLastReadState` baseline and persists through
    `storage.write(initialConversationLastReadState.marks)` — `write(empty)`, not a port `clear()` (#776
    declined that method; see Persistence below). **Nullary by design, not convenience**: taking no
    `conversationId` means no daemon-asserted id can steer which marks survive the pairing boundary, a
    property `tsc` enforces rather than a test. #1197 keeps this property rather than spending it — it
    ships a *separate* path instead of a parameter on this one, so this stays nullary and `tsc` goes on
    enforcing the whole-app boundary's guarantee.
  - **`clearLastReadFor(conversationIds: ReadonlySet<string>)`** answers "one of several paired machines
    is gone" and drops only that machine's conversations, since the marks of a machine the operator is
    still on are exactly what must survive. The refusal this store's docblock used to carry — no per-id
    clear, because a mark for a conversation that no longer exists is "inert" — held only while the
    whole-app boundary was the only one; it does not hold here, since a departed mark is *persisted* under
    the fixed key and survives not only the unpair but the restart after it, the exact residue #779 exists
    to prevent. Four decisions `tsc` cannot see:
    - the parameter is a `ReadonlySet<string>`, never `Iterable<string>` or `readonly string[]` — a bare
      `string` satisfies `Iterable<string>`, so a caller passing one id instead of a set would compile
      clean and clear one key per *character*;
    - the guard asks **"did anything actually leave?"**, never "is the incoming set empty?" — clone,
      delete each named id, and compare `next.size` against `s.marks.size`; a non-empty set naming
      nothing held is the *common* case (a departed server's conversations need never have been opened),
      and `conversationIds.size === 0` would fire a redundant synchronous `localStorage.setItem` on every
      such unpair;
    - **one write for the whole set**, never a per-id clear called in a loop — the whole map is persisted
      under a single fixed key;
    - the cleared arm returns a fresh `{ marks: next }`, not the named baseline — a scoped drop's result
      is a surviving map, so there is no shared constant to name, and the emptied-everything case needs no
      special arm (a repeat of the same ids finds nothing to remove and returns `s` through the guard).

    The ids reaching this path are the *departing* daemon's own claim, filtered to the exclusive set at
    its single call site rather than trusted verbatim — see [Unpair channel § The two renderer
    callers](unpair-channel.md#the-three-renderer-callers) for `selectExclusiveConversationIdsFor`,
    the same rule used by [conversation list store](conversation-list-store.md#the-per-server-drop-and-its-stricter-sibling-selector-since-1196).
    **Called from `clearServerScopedState` after its departed-ID exit loop**, so all in-memory cleanup completes before the one persistence operation that can throw.
    There is no legacy timeline clear or count subscription to re-mint marks mid-loop.
- **Legacy value shape — a count, not a timestamp or daemon history ID.** The older count design uses
  live timeline growth: the turn-stream IPC arms carry `conversationId` and `turnId` but no time field, `ConversationActivityEntry`
  is four booleans with no arrival marker, and the daemon's own `last_message_ts`/`last_used_at` do not
  move on message arrival. The chosen comparand is `conversationTimelineStore`'s per-conversation
  `items.length` ([thread timeline](thread-timeline.md)), which is fed per conversation since #756 and is
  append-only per keyed slice (`reset` never reaches the keyed store — only the flat one).
- **Hostile keys:** `ReadonlyMap` is mandated over `Record<string, …>`, the same reasoning as its two
  precedents — `Map.prototype.get`/`.set` never touch the prototype chain, so `'__proto__'`, `'constructor'`
  and `''` are ordinary keys by construction. No computed object keys on the write path; no
  `Object.fromEntries`, map-into-object spread, or `JSON.stringify` of the map anywhere.
- **Hard import constraint, checkable by grep:** this module's only imports are `zustand/vanilla` and
  `zustand`. No `./threadTimeline`, no `./conversationTimelineStore`, no `activeConversationStore`, no
  `src/renderer/src/screens/`. With no reference to the open conversation or any timeline in scope,
  the `?? activeConversation` fallback this keyed-store family exists to prevent is unavailable here.
- **No bound, no eviction, no LRU** — the one deliberate divergence from [conversation timeline
  holder](conversation-timeline-holder.md), and the one place that precedent is *not* copied. An entry here
  is one number plus one bounded id string, the cheapest in the family — below [conversation activity
  store](conversation-activity-store.md)'s four booleans and far below [background-task roster
  store](background-task-roster-store.md)'s ~5 KB, both of which already decline a cap. The map is emptied
  wholesale at the pairing boundary by #779. #776's persistence ruled on the size question this raised —
  see the Edge cases entry below — and the answer stayed no: no ceiling, no prune-on-load, no LRU.
- **Persisted since #776**, through an injected `ConversationLastReadStorage` port — mirroring [default-workspace
  store](default-workspace-store.md) (#403) and [push-notification preference
  store](push-notification-preference-store.md) (#408) — defaulting to a real `localStorage`-backed port,
  under the fixed key `pyry.conversationLastRead`. The whole map is encoded as a JSON array of `[id, mark]`
  entries (`encodeLastReadMarks`/`decodeLastReadMarks`), never as an object: that is what keeps the
  untrusted `conversationId` out of any object key space in *either* direction, on top of the `ReadonlyMap`
  keeping it out of memory's key space. `JSON.stringify(map)` itself would silently lose the whole map — a
  `Map`'s entries are not own enumerable properties — and `Object.fromEntries`/a map-into-object
  spread/an `obj[id] = mark` loop would each put the untrusted id back into an object key; because a mark
  is a number, the `__proto__` case of that mistake doesn't pollute anything, it just drops the entry
  silently (the setter no-ops). Hydration happens once, at store construction (`storage.read()`), with no
  explicit load step at any call site. A malformed, absent, or non-conforming blob decodes to an empty map
  — **reject whole, never salvage per entry**, and silently, per the log-free rule below. The write-through
  call sits *inside* `recordLastRead`'s updater, *behind* the same-value guard, not ahead of it as the two
  scalar-preference precedents persist: `appendDelta` grows a streamed reply's tail item in place rather
  than appending, so `items.length` is unchanged across most deltas. The former #777 subscription
  would have persisted once per delta without this guard; direct repeat writes still need it.
- **Testing a hostile key needs the right prototype probe.** `Object.prototype` owns a `__proto__`
  accessor by spec, so `Object.prototype.hasOwnProperty.call(Object.prototype, '__proto__')` is already
  `true` on a pristine realm — asserting it `false` fails on *correct* code. The assertion that actually
  detects pollution is that the own descriptor still carries a `get`/`set` pair (pollution replaces the
  accessor with a plain data property). `someKey`-shaped made-up probes don't have this problem.
- **Log-free by construction.** No `console.*` on any path — a diagnostic here would carry the untrusted
  conversation id or the raw persisted blob. A read miss, a same-value write, and a rejected persisted blob
  are all silent by design.

## Configuration and usage

- File: `src/renderer/src/store/conversationLastReadStore.ts`.
- Singleton: `conversationLastReadStore`, wired over `localStorageConversationLastRead()`. Hook:
  `useConversationLastReadStore(selector)`.
- Read one conversation: `useConversationLastReadStore(selectLastReadFor(conversationId))`.
- Persistence key: `pyry.conversationLastRead` (the app's third `localStorage` key — a shared
  key-namespacing helper was considered and declined; see Related decisions).
- **Publication hook:** `conversationLastReadBridge.ts` exports `useConversationLastRead()`, which
  calls only `useReadPublication()` with its existing paired-shell mount and teardown lifetime.
  It owns no count-stamp helper or legacy store subscription.
- **Whole-app clear:** `clearAllLastRead()` is last in `clearPairingScopedState`, called only when
  the pairing ends. Pairing another host and cancelling preserve held marks. It persists an empty
  map through `storage.write`, without a separate port `clear()` method.
- **Per-server clear:** `clearLastReadFor(ids)` is last in `clearServerScopedState`, after sampling
  exclusive departed IDs, removing the host's list slot and exiting any matching active chat.
  A shared ID claimed by another host survives. Both clears remain last because a storage failure
  must not interrupt other in-memory cleanup; the old subscription re-mint hazard is retired.

## Testing

Navigation/cleanup tests adapt their existing real/spy factories and retain negative assertions
against seeded legacy stores. Tests exclusive to count stamping and its removed subscription are
deleted. Standalone count-store persistence and clear tests remain. Mounted authoritative
publication is covered by both committed-visible-read variants in `thread-items.spec.ts`; all
12 cases and all 15 `thread-activation.spec.ts` cases executed and passed in the
[counted Linux #2028 gate](thread-runtime.md#navigation-retirement-validation): 432 executed,
0 failed, 10 skipped overall. The publication hook's presence matters: deleting the wrapper would
silently remove the retained publisher along with the retired subscription.

Historical legacy publication tests kept connection, replay and durable IDs distinct so a mistaken
identity source could not pass accidentally. The following evidence describes those earlier tests,
not the current production content route or proof that disabled cases still execute.

The [#1844 verifier confirmation](https://github.com/pyrycode/pyrycode-desktop/pull/1884#issuecomment-6050590586)
at `ca1529d7` on 2026-10-08 records 9,587 unit tests executed/passed, 0 failed, 3 skipped, and
357 fake-transport tests executed/passed, 0 failed, 4 skipped. It explicitly confirms every case in
`visible-tail-read.spec.ts` (6 executed/passed, 0 failed, 0 skipped) and `history-on-open.spec.ts`
(5 executed/passed, 0 failed, 0 skipped) was present and passed without retries. No live-Claude result
is claimed; the skips supply no acceptance evidence.

## Edge cases and limitations

- **A recreated legacy timeline slice restarts below a stale mark, and reads as read — decided in
  [#778](conversation-unread.md), not a bug.** [Conversation timeline
  holder](conversation-timeline-holder.md) evicts at ten slices; an evicted key reads absent, and if
  content later arrives the slice is recreated with `items.length` starting near zero. A held mark of, say,
  `47` against a recreated count of `1` compares as "read," hiding the unread dot. `isConversationUnread`
  answers this the direction the ticket states: a missed mark beats a stuck one nobody can clear. Recovering
  it would need a history backfill this app does not have.
- **Unbounded, by design, including across restarts.** No cap on distinct conversation ids held, and
  #776's persistence didn't change that ruling — an entry is one bounded id string plus one small integer,
  on the order of 50 bytes, against a `localStorage` budget in the megabytes (roughly a hundred thousand
  conversations since the last pairing), and the keyspace is bounded by the operator's own opening of
  conversations rather than by anything the daemon can mint. No bound, no prune-on-load, no LRU. #779's
  whole-app pairing-boundary clear and #1197's per-server scoped clear are the only floors.
- **Teardown cannot re-stamp `0`.** #2028 removed both navigation's timeline clears and the
  count subscription that sampled a missing slice during teardown. The old delete/archive re-mint
  edge is closed by retirement. Pairing and per-server local-mark cleanup still persist last to
  contain storage exceptions.
- **`recordLastRead` is named to avoid a collision, not by convention.** [Conversation timeline
  holder](conversation-timeline-holder.md) already exposes `markViewed(conversationId)`, which means something
  unrelated (eviction ranking). `record…` says a value is being written; `mark…` in this directory says it
  is not — code review confirmed this as the right call rather than reopening it.

## Related decisions

- [Conversation unread predicate](conversation-unread.md) — #778, the reader: a framework-free predicate
  over `selectLastReadFor` and [conversation timeline holder](conversation-timeline-holder.md)'s
  `selectTimelineFor`, and the resolution of the recreated-slice edge case above.
- [Conversation activity store](conversation-activity-store.md) — the earliest direct structural precedent
  for this shape: `ReadonlyMap` + copy-on-write + selector-factory, applied to a different per-conversation
  payload.
- [Conversation timeline holder](conversation-timeline-holder.md) — the nearer precedent, including the one
  place this store diverges from it (no bound), and the source of the `items.length` comparand #777/#778
  inherit.
- [Thread timeline](thread-timeline.md) — `TimelineState.items`, the quantity a mark is a sample of; this
  store imports nothing from it directly (see the hard import constraint above).
- [Default-workspace store](default-workspace-store.md) and [push-notification preference
  store](push-notification-preference-store.md) — the two scalar-preference precedents #776's persistence
  copies the port/key/hydrate-then-read shape from, and diverges from on two axes: this store persists a
  keyed map (an encode/decode step over untrusted input, absent from either precedent) and writes through
  behind an existing same-value guard rather than unconditionally.
- [ADR 0007 — Content-free diagnostics by construction](../decisions/0007-content-free-diagnostics-by-construction.md)
  — why the decode's reject path must stay silent rather than logging the untrusted blob.
- [#775 codebase notes](../codebase/775.md) — the holder's implementation summary, code review, and
  lessons learned.
- [Paired shell](paired-shell-conversation-exits.md#the-last-read-stamp-conversationlastreadbridgets-777)
  — the retired stamp and retained authoritative publication mount.
- [Pairing cleanup](paired-shell-pair-server-route.md#activation-and-pairing-cleanup) and
  [per-server cleanup](unpair-channel.md#the-three-renderer-callers) — retained local mark removal,
  exclusive-ID filtering and persistence-last ordering.
- [Conversation list store § The per-server drop](conversation-list-store.md#the-per-server-drop-and-its-stricter-sibling-selector-since-1196)
  — `selectExclusiveConversationIdsFor`, the #1196 sibling filter `clearLastReadFor`'s call site reuses
  rather than duplicates.
- [Paired shell routing](paired-shell-routing.md) — the data-flow diagram showing where
  `clearServerScopedState` (and so `clearLastReadFor`) sits in each per-server unpair path.
