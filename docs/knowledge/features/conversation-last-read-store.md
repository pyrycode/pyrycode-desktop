# Conversation last-read store

The renderer's held mark of how far the operator has read into **each** conversation — a count of
[thread timeline](thread-timeline.md) items seen, keyed by `conversationId`, so a future sidebar has
something true to compare a chat's latest activity against. Client-side fiction: the daemon carries no
read cursor at all.

Introduced in [#775](../codebase/775.md), split from #677. Shipped dormant — the holder and its read
surface only, no writer, no reader — the same "populated and unread" posture the [conversation activity
store](conversation-activity-store.md) shipped for #747 and the [conversation timeline
holder](conversation-timeline-holder.md) shipped for #755 before their own feeds landed. #776 then made it
survive a restart. **#777 landed the writer** — see [Configuration and usage](#configuration-and-usage)
below and [Paired shell § The last-read stamp](paired-shell.md#the-last-read-stamp-conversationlastreadbridgets-777)
for the write path itself. **[#778](conversation-unread.md) landed the reader** — a framework-free predicate
over this store's `selectLastReadFor` and [conversation timeline holder](conversation-timeline-holder.md)'s
`selectTimelineFor`, reading neither via a bound hook here. **#779 clears it at the pairing boundary** — see
[Configuration and usage](#configuration-and-usage) below. #676, drawing the resulting dot, is still open.

## What it does

Holds one `LastReadMark` (a plain `number`) per conversation id. A key **absent** from the map means "this
conversation has never been read"; a key present with value `0` means "read, and there was nothing in the
thread at the time" — the two must stay distinct, because opening a conversation with an empty timeline
legitimately stamps `0`. `selectLastReadFor` preserves the distinction with `??`, never `||`.

## How it works

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
- **One clear path, `clearAllLastRead()` (#779), the pairing boundary.** Built as `recordLastRead` is: guard,
  persist and return in one expression inside the updater, so no later edit can hoist the write above the
  guard. The guard is `marks.size === 0`, never a reference check against
  `initialConversationLastReadState.marks` — since #776 an empty store's `marks` is whatever `storage.read()`
  returned, a **fresh** `Map`, never the module constant, so a reference guard would never fire on a clean
  install and every unpair would perform a redundant `localStorage.setItem`. The already-clear arm returns
  the state object itself, so zustand's `Object.is` short-circuit fires and no subscriber wakes; the cleared
  arm returns the named `initialConversationLastReadState` baseline and persists through
  `storage.write(initialConversationLastReadState.marks)` — `write(empty)`, not a port `clear()` (#776
  declined that method; see Persistence below). **Nullary by design, not convenience**: taking no
  `conversationId` means no daemon-asserted id can steer which marks survive the pairing boundary, a
  property `tsc` enforces rather than a test. No paired `clearLastReadFor(id)` — a mark for a conversation
  that no longer exists is inert, so a per-id clear would ship an unused write path.
- **Value shape — a count, not a timestamp.** No timestamp exists anywhere the renderer can reach: the
  turn-stream IPC arms carry `conversationId` and `turnId` but no time field, `ConversationActivityEntry`
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
  `recordLastRead`'s one caller: `activateConversation` stamps the conversation being opened
  (`stampLastReadFor`, called unconditionally, outside the id-change gate — a re-open re-stamps), and
  `useConversationLastRead()`, mounted in `PairedShell`, re-stamps the **open** conversation on every
  `conversationTimelineStore` emission so content landing while it stays open never pushes its count past
  its own mark. See [Paired shell § The last-read
  stamp](paired-shell.md#the-last-read-stamp-conversationlastreadbridgets-777) for the write path,
  including a reachable, deliberately unfixed edge case where the pairing- and conversation-teardown
  clears can persist a spurious `0` over a true mark (below).
  **Reader landed in [#778](conversation-unread.md). Clear landed in #779** — `clearAllLastRead()`, wired as
  the seventh and last effect of [`clearPairingScopedState`](paired-shell.md#the-pairserver-route-152),
  called from both paths that end a pairing. Served by `storage.write(new Map())`, not a dedicated port
  `clear()` (#776 declined that method).

## Edge cases and limitations

- **A recreated timeline slice restarts below a stale mark, and reads as read — decided in
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
  pairing-boundary clear remains the only floor.
- **A teardown clear can persist a spurious `0` over a true mark on conversation delete/archive — reachable,
  not fixed. Resolved for the pairing-end path by #779.** Both `clearPairingScopedState` and
  `exitActiveConversation` clear `conversationTimelineStore` one line before they clear
  `activeConversationStore` (code review, PR #792). #777's listener is subscribed to the former for as long
  as `PairedShell` is mounted, so it fires mid-teardown, still sees the conversation being torn down as
  "open," finds its timeline slice already gone, and records `0` — persisted, since this is written through
  the same `recordLastRead` path #776 wraps. **`clearPairingScopedState` now absorbs this**: #779 placed
  `clearAllLastRead()` last in that helper's body precisely because of this re-mint, so a pairing-ending
  teardown's spurious `0` is wiped — in memory and on disk — before the helper returns, with a dedicated
  regression test proving it. See [Paired shell § The last-read
  stamp](paired-shell.md#the-last-read-stamp-conversationlastreadbridgets-777) for the ordering argument.
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
- [Paired shell](paired-shell.md#the-last-read-stamp-conversationlastreadbridgets-777) — #777's write
  path (`conversationLastReadBridge.ts`), its two restore points, and the teardown-ordering edge case
  above.
- [Paired shell § the `pairServer` route](paired-shell.md#the-pairserver-route-152) — #779's
  `clearAllLastRead`, wired as `clearPairingScopedState`'s seventh and last effect, and the re-mint
  ordering constraint that placement closes.
