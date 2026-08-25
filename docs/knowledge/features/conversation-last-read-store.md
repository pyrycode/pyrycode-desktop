# Conversation last-read store

The renderer's held mark of how far the operator has read into **each** conversation — a count of
[thread timeline](thread-timeline.md) items seen, keyed by `conversationId`, so a future sidebar has
something true to compare a chat's latest activity against. Client-side fiction: the daemon carries no
read cursor at all.

Introduced in [#775](../codebase/775.md), split from #677. Ships dormant — the holder and its read
surface only, no writer, no reader — the same "populated and unread" posture the [conversation activity
store](conversation-activity-store.md) shipped for #747 and the [conversation timeline
holder](conversation-timeline-holder.md) shipped for #755 before their own feeds landed. #776 persists it,
#777 stamps it on open and on each arm arrival, #778 derives the unread predicate from it, #779 clears it
at the pairing boundary, and #676 draws the resulting dot.

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
  wholesale at the pairing boundary by #779; persisted size becomes a real question once #776 lands.
- **Log-free by construction.** No `console.*` on any path — a diagnostic here would carry the untrusted
  conversation id. A read miss and a same-value write are both silent by design.

## Configuration and usage

- File: `src/renderer/src/store/conversationLastReadStore.ts`.
- Singleton: `conversationLastReadStore`. Hook: `useConversationLastReadStore(selector)`.
- Read one conversation: `useConversationLastReadStore(selectLastReadFor(conversationId))`.
- **No writer, no reader, no clear.** Nothing imports this module yet — grepping for
  `recordLastRead`/`selectLastReadFor`/`useConversationLastReadStore` outside this store's own test
  returns nothing. #777 (writer), #778 (reader), #779 (pairing-boundary clear) are still open.

## Edge cases and limitations

- **A recreated timeline slice can restart below a stale mark.** [Conversation timeline
  holder](conversation-timeline-holder.md) evicts at ten slices; an evicted key reads absent, and if
  content later arrives the slice is recreated with `items.length` starting near zero. A held mark of, say,
  `47` against a recreated count of `1` compares as "read," hiding the unread dot until #778 decides
  otherwise. `selectTimelineFor(id) === null` is distinguishable from a present-but-recreated slice, so the
  information needed to do better exists — left as an open question for #778, not solved here.
- **Unbounded in memory, by design, for now.** No cap on distinct conversation ids held. Justified today by
  entry cost (see above); revisit once #776 makes the map survive a restart.
- **`recordLastRead` is named to avoid a collision, not by convention.** [Conversation timeline
  holder](conversation-timeline-holder.md) already exports a nullary `markViewed`, which means something
  unrelated (eviction ranking). `record…` says a value is being written; `mark…` in this directory says it
  is not — code review confirmed this as the right call rather than reopening it.

## Related decisions

- [Conversation activity store](conversation-activity-store.md) — the earliest direct structural precedent
  for this shape: `ReadonlyMap` + copy-on-write + selector-factory, applied to a different per-conversation
  payload.
- [Conversation timeline holder](conversation-timeline-holder.md) — the nearer precedent, including the one
  place this store diverges from it (no bound), and the source of the `items.length` comparand #777/#778
  inherit.
- [Thread timeline](thread-timeline.md) — `TimelineState.items`, the quantity a mark is a sample of; this
  store imports nothing from it directly (see the hard import constraint above).
- [ADR 0007 — Content-free diagnostics by construction](../decisions/0007-content-free-diagnostics-by-construction.md).
- [#775 codebase notes](../codebase/775.md) — the holder's implementation summary, code review, and
  lessons learned.
