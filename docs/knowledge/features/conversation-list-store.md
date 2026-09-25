# Conversation list store

The renderer's held received or locally restored conversation lists — a dedicated, unidirectional
Zustand store fed by a subscription binding that observes the [conversation list
fetch](conversation-list-fetch.md)'s `conversationsReceived` event and drives the initial
`list_conversations` request, so the Channel List screen (#141), the create-discussion affordance
(#142), and every future list / navigation / archive feature can read one source of truth.

Introduced in [#208](../codebase/208.md), the store half of the conversation-list foundation
(mirror mobile #312), split from and blocked by [#139](../codebase/139.md) (the transport half,
shipped as PR #209). This ticket shipped no visible surface — #141 is its first consumer.

**Keyed by server since #1086** — the third store in the multi-server-keying family, after
[the session store](session-store.md#one-slot-per-server-since-1133) (#1085) and
[the relay-link store](relay-link-store.md#one-slot-per-server-since-1134) (#1134). See
§ "One slot per server, since #1086" below for how this store's shape had to diverge from both
precedents.

## What it does

Requests a fresh `conversations` list for each connected host on mount and on each host's transition
to `connected`, always with an explicit `serverId`. Mutation events refresh only their emitting host.
The arriving rows stay in a read-only store until the next list for that server arrives. Since #1086
this is per-server, not whole-store: each `conversationsReceived` replaces only the slot of the server it was
stamped with, no merge and no dedupe within a slot, and the flat read every consumer sees is a
**union across every server's slot**. Deliberately **not** a [session store](session-store.md) facet:
a list update never touches connection/messages state and vice versa, so a list arrival re-renders
only components selecting this slice.

## How it works

### The store (`src/renderer/src/store/conversationListStore.ts`)

```ts
export type ConversationListOrigin = string | null | undefined   // which slot a reply is filed under (#1086)

export interface ServerConversationSummary extends ConversationSummary {
  readonly serverId: ConversationListOrigin
}

export interface ConversationListState {
  conversations: readonly ServerConversationSummary[] | null      // the UNION across servers, precomputed
  byServer: ReadonlyMap<ConversationListOrigin, readonly ServerConversationSummary[]>
}
export type ConversationListStore = ConversationListState & {
  localListReads: ReadonlyMap<string, 'loading' | 'loaded' | 'failed'>
  beginLocalListRead: (serverId: string) => {
    complete: (rows: readonly ConversationSummary[]) => void
    fail: () => void
    cancel: () => void
  } | null
  setConversations: (conversations: readonly ConversationSummary[], serverId?: string | null) => void
  clearAllConversations: () => void   // the pairing-boundary drop (#1086, AC5) — nullary
  clearConversationsFor: (serverId: string) => void   // the per-server drop (#1196), see below
}

createConversationListStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
conversationListStore                  // app-wide singleton
useConversationListStore(selector)     // narrow-slice React binding: useStore(conversationListStore, selector)
selectConversations(state)             // the flat union — unchanged name and `| null`
selectConversationsFor(origin)(state)  // one server's slot (#1086), defaulting a missing one to `null`
selectConversationIdsFor(origin)(state) // one server's conversation ids as a Set (#1138), see below
selectExclusiveConversationIdsFor(origin)(state) // origin's ids claimed by NO other slot (#1196), see below
selectConversationAgentFor(origin, conversationId)(state) // Claude or Codex for one row (#1649), see below
EMPTY_CONVERSATION_IDS: ReadonlySet<string>  // stable empty-Set reference both selectors above return
```

Mirrors [`runConfigStore`](run-config-store.md)'s DI-factory → singleton → hook → selector structure
verbatim, including the `null` "not yet loaded" sentinel — an empty array (`[]`) is a real, loaded
"zero conversations" state, never coerced to or from `null`. Received lists use `setConversations`; saved lists use
`beginLocalListRead` without a fabricated received event. Its per-host token rejects
late success and failure after received data, clears or cancellation. Missing/empty
local success installs `[]`; failure leaves the slot absent. These local changes
never authorize persistence or establish connection state. See
[restoration admission](chat-history.md#received-state-admission-and-ownership).
Rows are held **verbatim
in wire snake_case** with exactly one client-owned property added beside them: no parallel camelCase
renderer type, no per-field remap — unlike `runConfigSnapshot`'s `used_tokens → usedTokens`, this
reuses `ConversationSummary` directly (`ServerConversationSummary extends` it) so the slice needs
zero per-field transform and stays drift-free against the mobile wire contract, and `serverId` rides
beside the wire fields rather than folded into any of them. No derivations are baked in — no `kind`
enum, no "unnamed" flag, no relative-time formatting: "discussion vs channel" derives from the raw
`is_promoted` flag and "unnamed" is the literal `name === null`, both at #141's read boundary, not
here.

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

**The stamp must win over the row.** `setConversations` builds each stamped row as `{ ...row,
serverId }` — spread first, stamp last. Written the other way round, a daemon that returned a
`serverId` key on a conversation row would overwrite the client's stamp and file its rows under
another server's slot — exactly the confusion the stamp exists to prevent. Today that is unreachable
because `parseConversationSummary` (`src/main/transport/inboundMessage.ts`) is a closed
reconstruction — seven named fields into a fresh literal, unknown keys never copied through — so the
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

### Which agent runs a conversation, since #1649

[#1649](https://github.com/pyrycode/pyrycode-desktop/issues/1649) decoded and held an optional `agent`
on each row (`ConversationSummary.agent?: WireAgent`, held through `agentFromWire` — see [Model-list
wire types](model-list-wire-types.md) for the shared helper and its `WireModelOption.agent`/`family`
twins), and `selectConversationAgentFor(origin, conversationId)` is the one read surface for it:

```ts
export const selectConversationAgentFor =
  (origin: ConversationListOrigin, conversationId: string) =>
  (s: ConversationListState): WireAgent =>
    agentFromWire(selectConversationsFor(origin)(s)?.find((row) => row.id === conversationId)?.agent)
```

Built on `selectConversationsFor`, not a second read of `byServer` — the
[`pushNotifyBridge`](push-notifications.md) precedent (`byServer.get(origin)?.find(...)`) for a
single-row, server-scoped lookup, and it inherits that selector's "call it with a client-held id" rule:
a same-id row filed under another paired server's slot is never read, so a conversation id collision
across two paired machines cannot leak one server's agent tag onto another's row. `agentFromWire`
collapses three cases to one answer — an absent `agent`, an unknown id, and an unloaded slot (`null`
from `selectConversationsFor`) all read `'claude'` — so the caller never branches on "do I have an
answer yet," only on "which agent." Unlike `selectExclusiveConversationIdsFor`, this **is** a
`useConversationListStore` read surface: it returns a primitive (`WireAgent`), not a fresh `Set` per
call, so a component can subscribe to it directly without memoizing the result itself.

[#1651](composer-model-menu.md#per-agent-filtering-1651) is the second consumer: `RunConfigSections.tsx`'s
`useConversationAgent` hook resolves the owning host itself (`serverIdForOpenConversation`, the same
resolution `useSessionSettingsConnected` uses) and reads this selector from it, rather than adding a
second per-conversation agent lookup that could disagree with this one.

### The data path (`src/renderer/src/store/conversationListBridge.ts`)

```ts
translateConversationsEvent(event: DaemonEvent): readonly ConversationSummary[] | null
// switch (event.type) { case 'conversationsReceived': return event.conversations; default: return null }

originOf(event: DaemonEvent): ConversationListOrigin   // since #1086
// !('serverId' in event) → undefined; serverId === null → null; a string → that string;
// anything else → undefined. Total by construction, never throws.

requestConversationList(sendCommand: (c: RendererCommand) => void, serverId: string): void
// sendCommand({ type: 'requestConversations', serverId })

subscribeConnectedConversationLists(store, sendCommand): () => void
// Subscribe to sessionStore.statuses, then inspect its current snapshot.
// Request each newly connected nonempty string identity; return the unsubscribe handle.

subscribeConversations(onDaemonEvent, setConversations, refreshOnChange): () => void
// onDaemonEvent(event => {
//   const list = translateConversationsEvent(event); if (list !== null) setConversations(list, originOf(event))
//   const serverId = originOf(event)
//   if (shouldRefreshList(event) && typeof serverId === 'string' && serverId.length > 0)
//     refreshOnChange(serverId)
// })
// returns the off-handle (the subscribeRunConfig idiom)

shouldRefreshList(event: DaemonEvent): boolean
// event.type === 'conversationUpdated' || event.type === 'conversationDeleted' ||
// event.type === 'conversationCreated' || event.type === 'workspaceUpdated' — a plain boolean, not a
// type guard: the payload (id/name/cwd, and workspaceUpdated's path/label) is never consulted (#275,
// widened #376, widened #515, widened #1288). Renamed from isConversationUpdated when #376 added the
// second arm — one predicate answering "should this event re-request the list?", not N isX predicates
// OR'd at the call site.

ConversationListData(): null
// Headless component, one mount effect ([]): install event listener, then status observer;
// clean up both on unmount.
```

`translateConversationsEvent` uses a **soft** `default: null`, not `assertNever` — the deliberate
`toRunConfigSnapshot` precedent: this path permanently consumes only `conversationsReceived`, so a
third `assertNever` on the `DaemonEvent` channel (alongside `daemonEventBridge` and
`timelineBridge`) would make every future arm a compile error in three files without benefit. A
rename of the owned arm is still caught — a `case` label that no longer overlaps the union is a type
error regardless. Unlike [`translateTimelineEvent`](conversation-timeline-store-internals.md#the-translator--binding-srcrenderersrcstoretimelinebridgets),
this returns `event.conversations` directly: selecting one named field is a filter, not a rename, so
no fresh-literal reconstruction is needed.

`subscribeConversations` guards on `list !== null`, not `if (list)` — an empty array is truthy
either way, but the explicit `!== null` makes "an empty list still writes (loaded-zero, not
not-loaded)" unmistakable to a reviewer.

`originOf` is read only from #1068's event-level stamp, never from the reply's rows — the read-side
twin of `setConversations`'s spread-then-stamp order. It is an `in`-guarded, `typeof`-checked access
rather than a cast, and a fifth copy of the idiom rather than an import of `relayLinkBridge.ts`'s or
`daemonEventBridge.ts`'s own `originOf`: both return a different module's key type, and importing
either would couple this deliberately independent subscriber to that store's key domain. Widening the
listener's parameter to `StampedDaemonEvent` was also rejected — this module's own tests build bare
`DaemonEvent` literals, and `ServerOrigin.serverId` being required would make a bare event
non-assignable.

All four mutation arms pass only a nonempty string from that main-stamped origin to
`refreshOnChange(serverId)`. Missing, null, non-string and empty origins cause no request; there is
no payload-derived destination or unaddressed fallback, even with a single saved host. The mutation
itself writes no rows: the authoritative list reply replaces only its origin's slot. Lifecycle
diagnostics use only the static `conversation-list` event and `requested` / `invalid-origin` codes.

**A testing trap this ticket surfaced: `toEqual` ignores an `undefined`-valued property.** Every
pre-existing bridge assertion of the form `expect(setConversations).toHaveBeenCalledWith(list)` (or
`toEqual(list)` on a captured row) kept passing once rows carried `serverId: undefined` — green, but
not because the stamp was verified. A test that actually wants to prove the stamp took must either
read `row.serverId` explicitly or drive an event stamped with a real, non-`undefined` origin. This is
worth re-checking on any future ticket that adds an optional property to an existing row or event
type: a green run on the old assertions proves nothing about the new field.

The useful counterpart: a spy's **arity** reddens where its behavior doesn't. Every pre-existing
`toHaveBeenCalledWith(list)` on `setConversations` failed once the call site started passing
`(list, originOf(event))`, forcing each existing test to state which slot a bare, unstamped event
files under. That is a real tripwire on a signature change like this one; on a ticket where the
assertion's arity is only incidental, the same failure would read as noise and invite loosening to
`expect.anything()` rather than fixing the assertion.

`ConversationListData` owns one mount effect. It installs `subscribeConversations` before
`subscribeConnectedConversationLists`, so the reply listener is ready before any initial request.
Cleanup removes the status subscription and then the daemon listener. Each new subscription loads
the currently connected hosts again; this includes a remount. Bridge access stays inside the effect,
so the component still server-renders to empty markup without a window mock.

`subscribeConnectedConversationLists` observes the vanilla store synchronously rather than a
React-selected global connected flag. A second host can connect while the first stays connected,
and a disconnect/reconnect pair can occur between React renders; neither may be lost to a boolean
that stayed true. The helper subscribes before reading the current snapshot and keeps a Set of
connected, nonempty string identities. It replaces that Set **before sending requests**, preventing
synchronous callbacks from requesting the same edge again. Disconnected or removed slots leave the
Set, rearming only those hosts. This subscription does not clear lists or cause a React render.

### Data flow

```
App mount → <ConversationListData/> (app-level, sibling of AppView)
  → window.pyry.onDaemonEvent → subscribeConversations (live before requests)
  → subscribeConnectedConversationLists(sessionStore, window.pyry.sendCommand)
    → current connected hosts, then each host's transition to connected
    → requestConversationList(window.pyry.sendCommand, serverId)
    → {type:'requestConversations', serverId}
    → COMMAND_CHANNEL → onCommand → servers.route(serverId)?.requestConversations()
    → buildListConversations on the selected connection

daemon → conversations frame → parseInboundMessage → conversationsReceived DaemonEvent [#139]
  → DAEMON_EVENT_CHANNEL → subscribeConversations listener
    → translateConversationsEvent → rows (or null → skip); originOf(event) → serverId   [#1086]
    → conversationListStore.setConversations(rows, serverId)   [replaces only that server's slot]
    → byServer written copy-on-write, conversations re-flattened as the UNION, same `set`   [#1086]
  → selectConversations (union) / selectConversationsFor(serverId) / useConversationListStore
    (read by #141; per-server read expected first from #1070)

last paired server forgotten
  → clearPairingScopedState → deps.clearAllConversations() → conversationListStore.clearAllConversations()
    → conversations: null, byServer: new Map()   [every server's slot dropped, not just the departed one]

daemon → conversation_updated / conversation_deleted / conversation_created / workspace_updated
  → typed event with main-stamped serverId → DAEMON_EVENT_CHANNEL → subscribeConversations
    → shouldRefreshList(event) → true; originOf(event) → nonempty string or skip request
    → refreshOnChange(serverId) → requestConversationList(window.pyry.sendCommand, serverId)
    → … re-enters the addressed request/reply flow above
    → authoritative reply replaces that host's rows, including creates, deletes and workspace labels
```

## Configuration and usage

- Mounted app-level in `src/renderer/src/App.tsx`, alongside `useDaemonEventBridge()`, as a sibling
  of `<AppView/>` inside a fragment — stable, app-lifetime event and status subscriptions with no
  subscribe/unsubscribe churn as the route flips, because the list must stay live for #141's Channel
  List regardless of which screen is shown.
- Import surface for #141/#142: `import { useConversationListStore, selectConversations } from
  '@renderer/store/conversationListStore'`.
- The Channel List, Archive screen and conversation connection controls read
  `useConversationListStore(selectConversations)`.
- **Per-server import surface, since #1086, no production consumer yet**:
  `import { selectConversationsFor } from '@renderer/store/conversationListStore'` — returns
  `readonly ServerConversationSummary[] | null`, defaulting a missing slot to `null` (the store's own
  not-loaded sentinel, since a loaded-empty server is `[]` rather than `null`). Call it only with an
  id from this client's own paired-server list, never a daemon-supplied field — the read-side twin of
  the write-side stamp rule above. Expected first consumer: #1070's per-server grouping.
- **`selectConversationIdsFor` import surface, since #1138**: `import { selectConversationIdsFor } from
  '@renderer/store/conversationListStore'`, called from `queueBridge.ts`'s `QueueData` composition
  root against `conversationListStore.getState()` at reconnect-reset time — see [queue
  store](queue-store.md#the-data-path-srcrenderersrcstorequeuebridgets). Three further consumers have
  since landed, each at the same reset-time composition root rather than subscribe time:
  `backgroundTaskRosterBridge.ts` (#1139), `modalBridge.ts` (#1140), and
  `conversationActivityBridge.ts`'s `ConversationActivityData` (#1145) — see [conversation activity
  store](conversation-activity-store.md#configuration-and-usage).
- `clearAllConversations` is invoked only by `clearPairingScopedState` (via `PairedShell.tsx`'s
  `clearPairingDeps`), never two-way-bound from a component — see § AC5 below.
- **`clearConversationsFor` / `selectExclusiveConversationIdsFor` import surface, since #1196**: both are
  invoked only from `clearServerScopedState.ts`'s `serverScopedClearDeps`
  ([Unpair channel § The two renderer callers](unpair-channel.md#the-two-renderer-callers)), reached from
  `runUnpairServer`'s non-last-server arm. Neither is two-way-bound from a component.

## Edge cases and limitations

- **Connection requests are per host, since [#1363](https://github.com/pyrycode/pyrycode-desktop/issues/1363).**
  Mount requests every currently connected host. A newly connected host gets its own addressed
  request even while another remains connected; repeated connected notifications do not duplicate it.
  Disconnecting or removing a status slot rearms that host, so reconnecting refreshes only its list.
  Connection transitions leave all held rows intact, and the reply replaces only its stamped slot.
  A request lost during a disconnect can recover on the next connect; there is no retry timer.
- **Mutation refresh requires a valid origin.** `conversationCreated`, `conversationUpdated`,
  `conversationDeleted` and `workspaceUpdated` each refresh only the host in the main-stamped
  `serverId`. Missing, null, non-string and empty origins produce no refresh, regardless of payload
  fields. This validation is stricter than list-reply storage, which still accepts diagnostic
  null/undefined slots. The main router continues to refuse ambiguous unaddressed commands; having
  only one connected host among several saved hosts does not make an unaddressed request safe.
  Connection-request deduplication does not coalesce separate mutation events.
- **The once-deferred "richer refresh policy" — intra-connection re-requests on a
  `conversation_updated` broadcast — landed in [#275](../codebase/275.md).** A promote (#274),
  rename, or archive fans out `conversation_updated`; `subscribeConversations`'s third param,
  `refreshOnChange`, re-requests the list on that event so the affected row's flip (e.g.
  `is_promoted`) lands without a reconnect. No coalescing of rapid successive updates — each fires
  its own re-request — deferred as an optimization, not required for correctness.
- **A permanent delete is not a `conversation_updated` broadcast, so it needed its own trigger arm —
  landed in [#376](../codebase/376.md).** Unlike archive/unarchive/promote/rename, a
  `delete_conversation` is confirmed with a distinct, *correlated* `conversation_deleted{id}` reply
  and **no broadcast** ([conversation delete](conversation-delete.md), #375). `isConversationUpdated`
  was renamed to `shouldRefreshList` and widened to also match `conversationDeleted` — one predicate
  covering both "a conversation changed" arms, rather than a second `isX` predicate OR'd at the call
  site. The trigger never inspects the event's `id`, so it fires the same re-request whether or not
  the deleted id is present in the current list; the deleted row's absence from the fresh
  `conversationsReceived` reply is what actually removes it — no local remove-by-id path exists.
- **A create was the last gap, and stayed open for a full release cycle before [#515](../codebase/515.md)
  closed it.** `create_conversation` is, like delete, a *correlated* reply with no broadcast — but unlike
  delete it went unnoticed at #376 time and shipped with only two arms, so a FAB-created discussion stayed
  invisible in the Channel List until an unrelated rename/archive/promote/delete or a reconnect. #515 added
  the third `shouldRefreshList` arm, `event.type === 'conversationCreated'`. No optimistic insert: the
  5-field `ConversationCreatedPayload` ([conversation create](conversation-create.md), #241) carries
  neither `is_archived` nor `last_message_ts`, so fabricating a row locally would either invent those
  fields or force this store to grow a per-row setter it deliberately doesn't have — re-requesting keeps
  the daemon authoritative and reuses the existing `conversationsReceived → setConversations` seam
  unchanged. Being a correlated reply, the refresh is **creator-only**: a second client's list stays stale
  until its own next mutation, which needs a daemon-side broadcast to fix and is out of scope.
- **A bare workspace rename is not a `conversation_updated` broadcast, so it needed its own trigger arm
  — landed in [#1288](https://github.com/pyrycode/pyrycode-desktop/issues/1288).** `conversation_updated`
  fans out on a *conversation* mutation (promote/rename/archive/change-workspace); renaming a workspace
  touches no conversation, so before this ticket the sidebar kept a stale label for a rename performed
  from another client until an unrelated mutation or a reconnect happened to re-list it. `workspace_updated`
  closes that gap — correlated by `in_reply_to` to whoever asked for the rename (the outbound verb,
  [#1289](https://github.com/pyrycode/pyrycode-desktop/issues/1289), has since shipped; its sender, the
  Edit-workspace dialog #1180, has not) and pushed unsolicited to every other connected client, both
  shapes decoding and re-listing identically. **`shouldRefreshList`
  never reads `path` or `label`, and that is a security property here, not only a shape preference**:
  patching a row's label straight from this frame would put untrusted daemon text on screen bypassing the
  `conversations` reply's own decode — the same reasoning [channel list](channel-list.md)'s § Workspace
  grouping states for why the label rides in on the re-list rather than the broadcast's own payload.
  `conversationListBridge.test.ts` pins `setConversations` called **zero** times for a `workspaceUpdated`
  event, so a future "just patch the row" shortcut reddens a gate instead of shipping quietly. Like
  the other three mutation arms, its re-list targets only the frame's main-stamped origin.
- **No correlation, no request tracking.** Any `conversationsReceived` that arrives — solicited or
  not — is written unconditionally into its stamped slot; safe because only the authenticated daemon
  can produce one (see [conversation list fetch § Correlation is deliberately
  absent](conversation-list-fetch.md#correlation-is-deliberately-absent)).
- **§ AC5 — cleared at the pairing boundary, since #1086, and this is the one regression keying
  introduces.** This store was excluded from `clearPairingScopedState` from #531 onward, on the
  argument that it self-heals: the mount-time `list_conversations` request re-lists, and the old
  whole-array replace overwrote everything regardless of which daemon answered. **Keying removes that
  self-heal** — the new pairing's reply now lands in the new server's slot, the departed server's slot
  is never written again, and the union keeps rendering its rows: a silent stale-data leak across a
  pairing boundary, attributing a departed machine's conversations to the operator's current session.
  `clearAllConversations` closes it as the tenth, nullary member of `ClearPairingScopedStateDeps`
  (`src/renderer/src/clearPairingScopedState.ts`, wired in `PairedShell.tsx`'s `clearPairingDeps`, so
  the unpair path drops it without a call-site edit; pairing another server stopped reaching this helper
  at all as of [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141)). Nullary for the same
  reason `clearAllModelLists`/`clearAllSlashCommandLists` are: no daemon-supplied conversation id may
  steer which server's rows survive the boundary. Idempotent via the subscriber short-circuit — an
  already-clear store hands back the same state object, so a redundant clear wakes no listener — not
  the side-effect guard `clearAllLastRead` needs, since this clear reaches nothing outside memory and
  cannot throw. This clear stays whole-set: it fires only when the **last** paired server is forgotten
  (pairing another server no longer reaches it at all, since
  [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141) — the new server's reply lands in its
  own `byServer` slot without disturbing the others). **Per-server eviction — forgetting one of several
  paired machines — shipped in [#1196](https://github.com/pyrycode/pyrycode-desktop/issues/1196)** as
  `clearConversationsFor`, § "The per-server drop" above; the two clears can never both fire, since
  `runUnpairServer` picks between them on whether any record remains.
- **A store's exclusion from `clearPairingScopedState` is a claim about mechanisms elsewhere, and it
  can go stale without anyone touching the store.** `clearPairingScopedState.ts`'s docblock names the
  discriminator as "does a reconnect to the SAME daemon need to clear it?" — this store's answer
  flipped from "no, it self-heals" to "yes" purely because keying changed what a reconnect's reply
  overwrites, not because anything about the clear itself changed. Re-run that discriminator, rather
  than trust the exclusion list, whenever a store already named there is keyed by server.
- **No reply / list never arrives.** The slice stays `null` forever; #141 renders its own loading
  affordance. Out of scope here.
- **`cwd` is untrusted daemon-supplied opaque display text**, carried forward from #139's security
  review. This slice only stores and reads it as a string — no filesystem use. Any later "open
  workspace" feature (#141 or beyond) that resolves `cwd` into a real path **must** boundary-check it
  (`path.resolve` + known-root prefix) before any filesystem access.
- **Static renders do not run the subscription effect.** The injected
  `subscribeConnectedConversationLists` tests exercise mount snapshots, independent connection and
  reconnect edges, duplicate notifications, invalid slots, retained lists and cleanup. The four-arm
  mutation matrix proves origin-scoped requests despite misleading payload identities. The actual
  app mount and request/reply wiring need the [two-server browser fixture](e2e-harness.md#two-server-launches).
  In that path, the authoritative row also lets `serverIdForOpenConversation` resolve the new chat's
  host for the connection warning and Send state; a successful create alone does not establish it.

## Related

- [Conversation list fetch](conversation-list-fetch.md) / [#139 codebase notes](../codebase/139.md)
  — the transport half this store consumes (`conversationsReceived` event, `requestConversations`
  command, `ConversationSummary` wire type); shipped first, unchanged by this ticket.
- [Run configuration store](run-config-store.md) / [#187 codebase notes](../codebase/187.md) — the
  store-shape and data-path precedent this ticket mirrors verbatim (single-setter form).
- [Conversation timeline store](conversation-timeline-store.md) / [#202 codebase
  notes](../codebase/202.md) — the sibling store+bridge slice from the same era; a real-reducer form
  with a hard `assertNever` filter and a hook binding, contrasted with this ticket's single-setter
  form, soft `default: null` filter, and component binding.
- [Session store](session-store.md) / [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md)
  — the store this one deliberately stays orthogonal to (no connection/messages state crosses over).
- [#208 codebase notes](../codebase/208.md) — implementation summary and patterns established.
- [Channel List home screen](channel-list.md) (#141) — the first consumer of
  `useConversationListStore`/`selectConversations`. The [new-discussion FAB](new-discussion-fab.md)
  (#242) reads the daemon's `conversationCreated` event through its own, independent bridge (it only
  navigates, sends no command); since [#515](../codebase/515.md) this store's `subscribeConversations`
  also reacts to the same event on its own subscription, so the two never cross-fire and exactly one
  `list_conversations` re-request goes out per create.
- [Conversation promote (transport)](conversation-promote.md) / [#273 codebase
  notes](../codebase/273.md) — the `conversationUpdated` broadcast this store's `refreshOnChange`
  reacts to; [#275 codebase notes](../codebase/275.md) — implementation summary and patterns for the
  re-request trigger.
- [Conversation delete (transport)](conversation-delete.md) / [#375 codebase
  notes](../codebase/375.md) — the `conversationDeleted` correlated reply this store's
  `refreshOnChange` also reacts to since #376; [#376 codebase notes](../codebase/376.md) —
  implementation summary and patterns for the `isConversationUpdated → shouldRefreshList` widening.
- [Conversation create (transport)](conversation-create.md) / [#241 codebase
  notes](../codebase/241.md) — the `conversationCreated` correlated reply this store's
  `refreshOnChange` also reacts to since #515; [#515 codebase notes](../codebase/515.md) —
  implementation summary and patterns for the third `shouldRefreshList` arm, and the fixed
  Channel-List-missing-a-new-discussion staleness bug.
- [E2E test harness](e2e-harness.md) — documents "Gap A" (#440/#451/#452), the e2e-visible symptom of
  this staleness, and its comment-only reconciliation once #515 closed it.
- [Session store](session-store.md#one-slot-per-server-since-1133) (#1085) and [relay-link
  store](relay-link-store.md#one-slot-per-server-since-1134) (#1134) — the first two stores in the
  multi-server-keying family; both left their app-wide field last-writer-wins with a per-server `Map`
  beside it and evicted nothing. This store is the third and the one that could not copy that shape,
  since its app-wide read is a union rather than a single most-recent value.
- [Daemon connection routing](daemon-connection-routing.md) — the #1117 registry change (one
  connection per paired server) that turned last-writer-wins from a simplification into a live defect
  on this store, the same way it did on the other two.
- `docs/specs/architecture/1086-conversation-list-keyed-by-server.md` — the full architecture spec:
  the key-domain and ordering rulings, the AC5 pairing-boundary analysis, and the security review
  (PASS, one SHOULD FIX — the stamp's spread-then-stamp order, folded in above).
- [Queue store](queue-store.md) / [#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138)
  — first consumer of `selectConversationIdsFor` (§ The shared "which conversations belong to this
  server" resolution, above): scopes the queue-backlog reconnect reset to the reconnecting server's
  own conversations. Also the first store to repeat this store's own AC5 sequence — scoping a
  reconnect reset retired the self-healing argument that kept `queueStore` out of
  `clearPairingScopedState`, the same way keying this store's `conversations` field did.
- [Unpair channel](unpair-channel.md#the-two-renderer-callers) /
  [#1196](https://github.com/pyrycode/pyrycode-desktop/issues/1196) — the per-server unpair path this
  store's `clearConversationsFor` and `selectExclusiveConversationIdsFor` exist for; the same ticket that
  closed this document's own long-standing "later ticket's" note under § AC5.
- [Channel List home screen § Workspace grouping](channel-list.md) /
  [#1287](https://github.com/pyrycode/pyrycode-desktop/issues/1287) — the daemon-held `workspace_label`
  this store's re-list makes live; `docs/specs/architecture/1288-inbound-workspace-updated-relist.md` —
  the full design and security review for the `workspaceUpdated` trigger arm, including why it carries no
  `inReplyTo` and why patching a row from its fields would be a security regression, not just a shortcut.
- [Daemon event channel — the sealed union: per-member history](daemon-event-channel-sealed-union-history.md)
  — the `workspaceUpdated` `DaemonEvent` member's own entry: field-by-field trust tiers and the four
  compile-forced no-op bridge arms. [Inbound message decode — extension history](inbound-message-decode-history.md)
  — the `workspace_updated` decode half, `parseWorkspaceUpdatedPayload`.
