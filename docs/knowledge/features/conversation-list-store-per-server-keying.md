# Conversation list store — per-server keying

Split out of [Conversation list store](conversation-list-store.md) to stay under the package-overview
size cap. Covers the `byServer` map, the flattened union, the two reconnect-reset selectors and the
per-server unpair drop — the mechanics behind [that document's § "One slot per server, since
\#1086"](conversation-list-store.md#one-slot-per-server-since-1086) summary.

### One slot per server, since #1086

Since [#1117](daemon-connection-routing.md) the registry dials one connection per paired server. With
two servers both connected, each answering its own `list_conversations` request, the single
`conversations` array was last-writer-wins — the second reply overwrote the first and the sidebar
showed whichever server answered last, with no field on a row to even tell the two sets apart.

**This is the one store in the family that could not leave its app-wide field last-writer-wins.**
[The session store](session-store.md#one-slot-per-server-since-1133) and
[the relay-link store](relay-link-store.md#one-slot-per-server-since-1134) both hung a per-server
`Map` beside an untouched, still-last-writer-wins app-wide cell — neither needed to evict anything,
because their single reader renders one machine's status at a time. Here a list showing only one
server's rows **is** the bug being fixed, so `conversations` becomes a **union** recomputed from the
map on every write: `flattenByServer` returns `null` for an empty map and otherwise concatenates
every slot's rows, sorted by `compareOrigins`, into one array. A union reads every slot, which is
exactly why a stale slot — one from a server whose pairing has since ended — would stay visible
forever without a clear; see § AC5 below.

`ConversationListOrigin` is the same three-case domain as `RelayLinkOrigin` and `StatusOrigin`, a
**fourth** separate declaration rather than an import of either or a lift into `src/shared/` — the
lift cannot reach `liveWindow.ts`'s copy without editing `src/main/`, out of this ticket's scope, and
a shared type reaching three of four is worse than four honest, cross-referenced copies. Deferred,
unchanged from #1134's own open question:

- a **string** — one slot per paired server;
- a **present `null`** — a producer bound while no paired record was in hand;
- **absent** (`undefined`) — a producer that never went through a binding, unreachable in production,
  reachable from tests. Filing it (rather than dropping it) is what keeps the write **total**.

`byServer` is a `Map`, never a bare object — `ServerOrigin`'s docblock in `shared/ipc/events.ts`
rules this for any consumer indexing by the id, since a `__proto__` id would otherwise write through
`Object.prototype`. Growth is bounded by the distinct-origin count (one per paired server plus at
most the two non-server keys); a daemon cannot influence which key its own event carries, so nothing
it sends can mint a slot.

**Cross-server order is by server id, ascending, code-unit** — not `localeCompare`, since an id is
opaque and a locale-sensitive comparator would make the sidebar's order depend on the machine's
locale. `Map` insertion order was considered and rejected: it is technically stable across writes,
but *which* server answered first is an arrival race, so two launches of the same app could order the
sidebar differently. The two non-string origins sort after every string, `null` before `undefined` —
ranked rather than coerced so the comparator stays total, with `null` (bound, no paired record)
placed closer to a real server than `undefined` (never bound), since both are diagnostic- or
test-reachable rather than sidebar-facing and a real server's position must not depend on whether an
exceptional slot happens to exist. **Within a server, wire order is preserved** — the daemon is the
source of truth for ordering, so the stamp and the concatenation never re-sort rows; with one server
the flat read is therefore exactly today's list, in today's order, plus the stamp.

**The stamp must win over the row.** `setConversations` spreads the row, reconciles its read mark,
then writes `serverId` last. Written the other way round, a daemon that returned a
`serverId` key on a conversation row would overwrite the client's stamp and file its rows under
another server's slot — exactly the confusion the stamp exists to prevent. Today that is unreachable
because `parseConversationSummary` (`src/main/transport/inboundMessage.ts`) is a closed
reconstruction of allowlisted fields into a fresh literal, unknown keys never copied through — so the
decoder is the deterministic guarantee and the spread order is the free second fabric. Flagged
SHOULD FIX in #1086's security review specifically so a later tidy-up does not reorder it.

`setConversations`'s `serverId` argument is **optional**, the `setRelayLinkStatus` property: it makes
the absent case a genuine absent argument matching the three-case domain with no sentinel value, and
it leaves an origin-less call filing under the unstamped slot rather than being dropped. The write is
read **inside** the `set` updater rather than through `getState()` outside it (the `modelListStore`
idiom), so two replies arriving back-to-back cannot interleave — zustand runs the updater
synchronously against current state, closing the only check-then-act shape on this path. Untouched
slots come back **by reference** (copy-on-write: `new Map(held)` then `set`, never a mutation of the
map already handed out), so a component watching only one server does not re-render when a different
one's slot changes.

### The shared "which conversations belong to this server" resolution, since #1138

[#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138) added `selectConversationIdsFor`
beside `selectConversationsFor` — the renderer's one answer to "which conversations belong to this
server", landed here once rather than restated in each of the (up to) three bridges that need to
scope a reconnect reset by it: #1138 itself (queued backlogs), #1139 (background-task rosters, not
yet shipped) and #1140 (outstanding modal prompts, not yet shipped). It is a thin projection over
`selectConversationsFor`, not a second read of `byServer`, so that selector's "call it with a
client-held id, never a daemon-supplied one" rule is carried forward by construction rather than
restated:

```ts
export const EMPTY_CONVERSATION_IDS: ReadonlySet<string> = new Set()

export const selectConversationIdsFor =
  (origin: ConversationListOrigin) =>
  (s: ConversationListState): ReadonlySet<string> => {
    const rows = selectConversationsFor(origin)(s)
    if (rows === null || rows.length === 0) return EMPTY_CONVERSATION_IDS
    return new Set(rows.map((row) => row.id))
  }
```

`selectConversationsFor` answers `null` for a slot holding no list yet and `[]` for a server that
reported zero conversations; every known consumer of this resolution treats both as "drop nothing",
so both collapse to the one `EMPTY_CONVERSATION_IDS` reference rather than exposing a three-state API
with no reader. A `Set`, never a bare object keyed by id, for the same reason `byServer` is a `Map`:
`ServerOrigin`'s docblock rules it for any consumer indexing by a daemon-adjacent id (these
`ConversationSummary.id` values are the daemon's), and a consumer's inner loop is a membership test
per key it already holds.

**Not a `useConversationListStore` read surface.** A non-empty result is a fresh `Set` built on every
call, so it has no referential stability and would churn re-renders if subscribed to; every consumer
calls it once, inside a daemon-event handler, against `getState()` — see [queue store § The data
path](queue-store.md) for the shape.

`EMPTY_CONVERSATION_IDS` is a shared singleton, the `EMPTY_BACKLOG` idiom applied here: `Object.freeze`
does not stop `Set.prototype.add`, so the type is the only guard against a caller mutating it, and no
consumer has cause to.

### The per-server drop, and its stricter sibling selector, since #1196

Per-server unpair now exists in the renderer — [#1196](https://github.com/pyrycode/pyrycode-desktop/issues/1196)
closed the gap this document used to name as "a later ticket's" (§ AC5 below). `clearConversationsFor`
is the keyed sibling of `clearAllConversations`: copy-on-write (`new Map(held)`, `delete`), the union
recomputed through the same `flattenByServer` in the same `set`, every surviving slot handed back by
reference so a component watching another server does not re-render, and the same subscriber
short-circuit — a key with neither rows nor local read state hands the state object
straight back. Both clear methods invalidate pending local read tokens and remove
the corresponding `localListReads` entries, even before rows arrive. Dropping the *only* held slot
flattens to `conversations: null` (not-loaded), the honest read for a surviving server that has not
replied yet, never a false loaded-empty. **Typed `string`, not `ConversationListOrigin`** — narrower
than the store's key domain on purpose, since only a paired server can be forgotten, so the `null`
(bound, no record) and `undefined` (never bound) slots are unreachable from this entry point by the
type. Call it only with a **client-held** id — the one `runUnpairServer` just erased — never a
daemon-supplied one; that is `selectConversationsFor`'s own read-side rule, carried to the write side.

`selectExclusiveConversationIdsFor(origin)` is a **sibling** of `selectConversationIdsFor`, not a
widening of it — the two must answer different questions. `selectConversationIdsFor` is the shared
"which conversations belong to this server" read three reconnect-reset bridges (#1138, #1139, #1140)
ride, where an over-broad answer costs a reset that self-heals. On the unpair path the departed
conversation ids are the one **daemon-supplied** input: they are whatever the departing server listed
in its own `conversationsReceived` reply, and nothing stops a confused or hostile paired daemon from
listing ids that belong to *another* paired machine. Fed to a thread clear unfiltered, that turns
"forget machine A" into "destroy machine B's retained threads and close the chat the operator is
reading on B" — destructive, with no backfill in either timeline store. `selectExclusiveConversationIdsFor`
answers the ids held for `origin` that appear under **no other slot**, so a claimed id is simply not
dropped:

```ts
export const selectExclusiveConversationIdsFor =
  (origin: ConversationListOrigin) =>
  (s: ConversationListState): ReadonlySet<string> => {
    const rows = selectConversationsFor(origin)(s)
    if (rows === null || rows.length === 0) return EMPTY_CONVERSATION_IDS
    const claimedElsewhere = new Set<string>()
    for (const [key, kept] of s.byServer) {
      if (key === origin) continue
      for (const row of kept) claimedElsewhere.add(row.id)
    }
    const exclusive = rows.filter((r) => !claimedElsewhere.has(r.id)).map((r) => r.id)
    return exclusive.length === 0 ? EMPTY_CONVERSATION_IDS : new Set(exclusive)
  }
```

This is `serverIdForOpenConversation`'s shipped ambiguity refusal ([Unpair channel § The two renderer
callers](unpair-channel.md#the-two-renderer-callers)) applied to a set rather than a single id — that
function also refuses an ambiguous match with `filter` and a length check rather than `find`. It costs
nothing against an honest daemon: conversation ids are UUIDv4 from the system random source, so a real
collision cannot occur and the exclusive set equals the full set. Called from exactly one place,
[`clearServerScopedState`](unpair-channel.md#the-two-renderer-callers)'s `serverScopedClearDeps`, and —
like its sibling — not a `useConversationListStore` read surface (a non-empty result is a fresh `Set`
per call).

## Related

- [Conversation list store](conversation-list-store.md) — the parent overview: what the store does,
  received read/pin state, the data path and configuration.
