# Conversation last-read store

The renderer's held mark of how far the operator has read into **each** conversation — a count of
[thread timeline](thread-timeline.md) items seen, keyed by `conversationId`. This is the legacy
fallback for rows without both daemon read fields. Complete rows use received durable history IDs
through [conversation unread](conversation-unread.md), independently of this local count.

Introduced in [#775](../codebase/775.md), split from #677. Shipped dormant — the holder and its read
surface only, no writer, no reader — the same "populated and unread" posture the [conversation activity
store](conversation-activity-store.md) shipped for #747 and the [conversation timeline
holder](conversation-timeline-holder.md) shipped for #755 before their own feeds landed. #776 then made it
survive a restart. **#777 landed the writer** — see [Configuration and usage](#configuration-and-usage)
below and [Paired shell § The last-read stamp](paired-shell-conversation-exits.md#the-last-read-stamp-conversationlastreadbridgets-777)
for the write path itself. **[#778](conversation-unread.md) landed the reader** — a framework-free predicate
over this store's `selectLastReadFor` and [conversation timeline holder](conversation-timeline-holder.md)'s
`selectTimelineFor`, reading neither via a bound hook here. **#779 clears it at the pairing boundary** — see
[Configuration and usage](#configuration-and-usage) below. **[#1197](https://github.com/pyrycode/pyrycode-desktop/issues/1197)
added a second, scoped clear** for the boundary the pairing does not fully end at — forgetting one of
several paired servers now drops only that server's exclusive marks — see below.

## What it does

Holds one `LastReadMark` (a plain `number`) per conversation id. A key **absent** from the map means "this
conversation has never been read"; a key present with value `0` means "read, and there was nothing in the
thread at the time" — the two must stay distinct, because opening a conversation with an empty timeline
legitimately stamps `0`. `selectLastReadFor` preserves the distinction with `??`, never `||`.

## How it works

- **Daemon publication observes a committed display.** `useReadObservation`, mounted in
  `ConversationScreen`, captures the rendered slice in a layout effect. The newest user/assistant
  message's trailing edge must be inside the thread viewport between the measured header and input
  borders; the document must be focused and visible, and the Markdown reader closed. Opening,
  receipt and bottom-following alone prove nothing. Scroll, focus, resize and list changes recheck
  that committed slice. List changes matter because received-read eligibility can arrive after the
  display commits; waiting for another timeline change would leave a visible tail unpublished.
- **Only retained display identity supplies a target.** `readTargetFor` requires a contribution
  bound to the newest message's surviving numeric row key, then takes the highest retained row-bound
  ID (including folded deltas/tool patches) and transient display-state ID. The layout commit must
  precede observation. Validated live/replayed `history_entry_id` and independently admitted history
  contributions supply durable IDs; connection/replay IDs, timestamps alone, row counts, optimistic
  echoes, served coverage and list `latest_entry_id` do not. Missing/ambiguous identity cannot advance
  a target, and ID-less replay triggers no identity-recovery fetch. See
  [snapshot identity](chat-history.md#retained-display-contributions).
- **Commands are bound to the observed host.** `markConversationRead` requires a nonempty `serverId`
  and exactly `{ conversation_id, up_to }`, with a nonempty conversation ID and non-negative safe
  integer target, including zero. Main validates IPC, resolves the sole current connected claim and
  requires it to match the observed host before sending a fresh allowlisted `mark_conversation_read`
  payload through that connection. Duplicate renderer ownership sends nothing; main refuses ambiguous
  connected claims. See [routing](daemon-connection-conversation-routing.md#host-bound-read-routing).
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
  are never persisted; the local count store below remains the legacy path.
- **Complete daemon rows suppress local stamping.** Both activation and timeline-driven writes call
  `stampLastReadFor`, whose production `isDaemonBacked(id)` dependency reads the current list at
  invocation time. Any matching row with both `read_up_to` and `latest_entry_id` (including zero)
  suppresses the write. The local map is ID-keyed, so a duplicate ID with a complete row on any host
  also suppresses stamping for its legacy peer; selecting only the first match would make protection
  depend on host order. Daemon unread still compares each actual row independently. The store's direct
  `recordLastRead` API remains a local count writer, not a daemon mark publisher. A missing frame
  `history_entry_id` never re-enables local authority for a complete daemon row; legacy rows receive
  no read command and retain count persistence and both clear paths.
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
    callers](unpair-channel.md#the-two-renderer-callers) for `selectExclusiveConversationIdsFor`, the same
    filter [conversation list store](conversation-list-store.md#the-per-server-drop-and-its-stricter-sibling-selector-since-1196)
    applies to the sibling thread drop. **Called from `clearServerScopedState`, and only after its
    departed-conversation loop has finished** — every `clearTimelineFor` inside that loop notifies
    `conversationTimelineStore`'s subscribers synchronously, including #777's bridge, which re-stamps
    whatever chat is open and, finding the slice gone, records a `0` for it; a drop placed *inside* the
    loop would be re-minted by a later iteration. It is also the only effect in that helper's set reaching
    outside memory, so running it last means a `localStorage` throw aborts no other clear. See [Paired
    shell routing](paired-shell-routing.md) for the call site.
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
  `src/renderer/src/screens/`. Sampling `items.length` is #777's job at #777's call site — with no
  reference to the open conversation or any timeline in scope, the `?? activeConversation` fallback this
  keyed-store family exists to prevent is unavailable here, not merely forbidden.
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
  than appending, so `items.length` is unchanged across most deltas, but #777 stamps the open conversation
  on every delta — persisting ahead of the guard would fire one `localStorage.setItem` per delta.
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
- **Writer since #777.** `conversationLastReadBridge.ts` (`src/renderer/src/store/`) is
  `recordLastRead`'s one caller: `activateConversation` invokes the guarded `stampLastReadFor` outside
  the id-change gate — a legacy re-open re-stamps — and
  `useConversationLastRead()`, mounted in `PairedShell`, re-stamps the **open** conversation on every
  `conversationTimelineStore` emission so content landing while it stays open never pushes its count past
  its own local mark. Complete daemon rows skip both writes, including opening without a held
  timeline; incomplete rows retain the old behavior. Persistence under `pyry.conversationLastRead`
  and both pairing/per-server clears remain in place. See [Paired shell § The last-read
  stamp](paired-shell-conversation-exits.md#the-last-read-stamp-conversationlastreadbridgets-777) for the write path,
  including a reachable, deliberately unfixed edge case where the pairing- and conversation-teardown
  clears can persist a spurious `0` over a true mark (below).
  **Reader landed in [#778](conversation-unread.md). Whole-app clear landed in #779** — `clearAllLastRead()`,
  wired as the seventh and last effect of [`clearPairingScopedState`](paired-shell-pair-server-route.md#the-pairserver-route-152),
  called from unpair alone since [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141) retired
  the pair-another-server call site (adding a server ends no pairing, so a still-paired server's read
  marks have nothing to lose). Served by `storage.write(new Map())`, not a dedicated port
  `clear()` (#776 declined that method).
  **Per-server scoped clear landed in [#1197](https://github.com/pyrycode/pyrycode-desktop/issues/1197)** —
  `clearLastReadFor(conversationIds)`, wired as the new `clearLastReadFor` member of `ClearServerScopedStateDeps`
  and bound in `serverScopedClearDeps` (`src/renderer/src/clearServerScopedState.ts`) through
  `conversationLastReadStore.getState().clearLastReadFor`. Called unconditionally as the last statement of
  `clearServerScopedState`, after its per-departed-conversation `exitActiveConversation` loop — see
  [Unpair channel § The two renderer callers](unpair-channel.md#the-two-renderer-callers) and [Paired
  shell routing](paired-shell-routing.md) for both call sites (the composer's Re-pair control and the
  Settings row's per-server Unpair).

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
- **A legacy teardown clear can persist a spurious `0` over a true mark on conversation delete/archive — reachable,
  not fixed. Resolved for both boundaries the pairing can end or narrow at: the whole-app one by #779, the
  per-server one by #1197.** Both `clearPairingScopedState` and `exitActiveConversation` clear
  `conversationTimelineStore` one line before they clear `activeConversationStore` (code review, PR #792),
  and `clearServerScopedState`'s per-departed-conversation loop clears one `conversationTimelineStore` slice
  per iteration. #777's listener is subscribed to that store for as long as `PairedShell` is mounted, so it
  fires mid-teardown (or mid-loop), still sees the torn-down conversation as "open," finds its timeline slice
  already gone, and records `0` — persisted, since this is written through the same `recordLastRead` path
  #776 wraps, and on the per-server path the loop notifies **once per departed conversation**, so a re-mint
  is possible on every iteration, not just once. **`clearPairingScopedState` and `clearServerScopedState`
  both absorb this, the same way**: #779 placed `clearAllLastRead()` last in the whole-app helper's body,
  and #1197 placed `clearLastReadFor(departed)` last in the per-server helper's body — *after* its loop, not
  inside it, since a drop placed inside would be re-minted by a later iteration — so either teardown's
  spurious `0`s are wiped, in memory and on disk, before the helper returns. Both orderings are pinned by a
  dedicated regression test (`invocationCallOrder`, not an end-state assertion — the re-stamp lives in a
  React effect and no test in this repo runs that subscription, so only call order can catch a regression
  here). See [Paired shell § The last-read
  stamp](paired-shell-conversation-exits.md#the-last-read-stamp-conversationlastreadbridgets-777) for the
  whole-app ordering argument and [Unpair channel § The two renderer
  callers](unpair-channel.md#the-two-renderer-callers) for the per-server one.
  **`exitActiveConversation` (deleting or archiving the open conversation) still has no such floor** — that
  helper clears only the one conversation's own state, never the whole map, so archiving or deleting the
  conversation you have 20 rows read into still drops its mark to `0` on the way out, persisted. No AC is
  violated (the mark is still that conversation's honest count at that instant, and the conversation itself
  is gone or filed away, so nothing reads the stale `0` back as meaningful) — recorded here so a future
  ticket narrowing this further knows which half is already closed.
- **`recordLastRead` is named to avoid a collision, not by convention.** [Conversation timeline
  holder](conversation-timeline-holder.md) already exports a nullary `markViewed`, which means something
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
- [Paired shell](paired-shell-conversation-exits.md#the-last-read-stamp-conversationlastreadbridgets-777) — #777's write
  path (`conversationLastReadBridge.ts`), its two restore points, and the teardown-ordering edge case
  above.
- [Paired shell § the `pairServer` route](paired-shell-pair-server-route.md#the-pairserver-route-152) — #779's
  `clearAllLastRead`, wired as `clearPairingScopedState`'s seventh and last effect, and the re-mint
  ordering constraint that placement closes.
- [Unpair channel § The two renderer callers](unpair-channel.md#the-two-renderer-callers) — #1197's
  `clearLastReadFor`, wired as `clearServerScopedState`'s last effect (after its departed-conversation
  loop), the exclusive-id-set filter it rides rather than takes a fresh read of, and both call sites
  (composer Re-pair, Settings-row Unpair).
- [Conversation list store § The per-server drop](conversation-list-store.md#the-per-server-drop-and-its-stricter-sibling-selector-since-1196)
  — `selectExclusiveConversationIdsFor`, the #1196 sibling filter `clearLastReadFor`'s call site reuses
  rather than duplicates.
- [Paired shell routing](paired-shell-routing.md) — the data-flow diagram showing where
  `clearServerScopedState` (and so `clearLastReadFor`) sits in each per-server unpair path.
