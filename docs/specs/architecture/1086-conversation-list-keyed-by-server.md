# #1086 — the conversation list keyed by server

The third store in the multi-server keying family, after #1085 (session) and #1134 (relay link). Two
connected daemons each answer the `list_conversations` request; today the second reply overwrites the
first and the sidebar shows whichever server answered last. This slice gives the store one set of rows
per server, stamps every row with the server it came from, and turns the app-wide read into a **union**
across servers — which is what separates it from both precedents, and what drags the pairing boundary
(AC5) into scope.

## Files read

- `src/renderer/src/store/conversationListStore.ts` → `ConversationListState`, `setConversations`,
  `selectConversations`, `selectArchivedCount` — the store being keyed. Its header states the
  whole-array replace as deliberate; that sentence is what this ticket rewrites.
- `src/renderer/src/store/relayLinkStore.ts` → `RelayLinkOrigin`, `withSlot`,
  `selectRelayLinkStatusFor`, and the `set` that writes the app-wide cell and the index together — the
  settled shape this follows, and the one place the "nothing is evicted" ruling is written down that
  this ticket cannot copy.
- `src/renderer/src/store/relayLinkBridge.ts` → `originOf` — the read of #1068's stamp, and the
  argument for a per-module copy rather than an import.
- `src/renderer/src/store/conversationListBridge.ts` → `subscribeConversations`,
  `translateConversationsEvent`, `shouldRefreshList`, `ConversationListData` — the sole writer.
- `src/renderer/src/clearPairingScopedState.ts` → `ClearPairingScopedStateDeps`,
  `clearPairingScopedState` — AC5's home. Its docblock currently names this store as self-healing; the
  nullary and ordering rules for a new dep are stated there.
- `src/renderer/src/PairedShell.tsx` → `clearPairingDeps` — the one literal both pairing-change sites
  share.
- `src/renderer/src/store/modelListStore.ts` → `clearAllModelLists` — the nullary whole-map clear this
  copies, including the `size === 0` subscriber short-circuit.
- `src/main/transport/inboundMessage.ts` → `parseConversationSummary`, `parseConversationsPayload` —
  a **closed reconstruction**: seven named fields into a fresh literal, unknown keys not copied
  through. Load-bearing for the security review's finding on the stamp.
- `src/main/conversationRouter.ts` → `record`, `learn` — the main-side sibling that already reads
  `originOf(event)` off a `conversationsReceived` and files per server. Its "last write wins" ruling
  cites this store's own behaviour, so the two must stay in agreement.
- `src/shared/ipc/events.ts` → `ServerOrigin`, `StampedDaemonEvent`, `WithOrigin` — the stamp: an
  intersection beside the union, `Map`-only indexing, "a REPORT, not a control input".
- `src/shared/wire/types.ts` → `ConversationSummary`, `ConversationsPayload` — unchanged by this
  ticket (AC2). Its docblock rules that wire order is the daemon's to decide.
- `src/renderer/src/screens/channels/ChannelList.tsx`, `screens/archive/ArchiveScreen.tsx`,
  `screens/settings/ArchivedCountRow.tsx` → the three readers AC4 requires to keep compiling untouched.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `groupByWorkspace`,
  `partitionByPromotion` — the downstream that #1070 widens, not this ticket.
- `docs/knowledge/features/conversation-list-store.md` → "whole-list replace, no merge, no dedupe" and
  the `null` vs `[]` ruling; the four refresh-trigger arms, none of which this ticket touches.
- `docs/knowledge/features/relay-link-store.md` — the family's page for the keying already shipped.

Codegraph is not initialized in this repo (`CodeGraph not initialized` on every call), so the reading
list came from Grep and Read.

## Design source

**Figma:** N/A — store and data-path only, no rendered surface. The three screens that render these
rows are unchanged by construction (AC4), so the visual-fidelity check is intentionally skipped.

## Context

`setConversations` replaces the whole array. That was correct while exactly one daemon could answer;
since #1117 the registry holds one connection per paired server, and #1068 stamps each event with the
server it came from. Two connected servers now race: whichever answers last owns the list. The row type
carries no server, so nothing downstream could tell the two sets apart even if both were kept.

**What this ticket cannot copy from its two precedents.** #1085 and #1134 both left the app-wide field
as last-writer-wins and hung a per-server index beside it — `relayLinkStore.ts`'s `status` docblock
says the untouched field is "the cheapest possible guarantee" that its one reader renders identically,
and its `statuses` docblock says "Nothing is evicted". Neither is available here: a list showing one
server's rows **is** the bug, so the app-wide read must become a union, and a union reads every slot,
so a stale slot becomes visible. That is the entire reason AC5 exists on this ticket and on neither
sibling.

No ADR is warranted: this applies a settled pattern rather than deciding one. The one genuinely new
ruling — where the two non-string origins sort — is local to this store and pinned by a test here.

## Design

### The row type and the key domain (`conversationListStore.ts`)

```ts
export type ConversationListOrigin = string | null | undefined

export interface ServerConversationSummary extends ConversationSummary {
  readonly serverId: ConversationListOrigin
}
```

`ConversationListOrigin` is `RelayLinkOrigin`'s three-case domain, kept apart for the reason that type's
own docblock gives: a `string` is one paired server; `null` is a producer bound while no paired record
was in hand; `undefined` is a producer that never went through a binding — unreachable in production,
reachable from tests, and filing it is what keeps the write **total**. A fourth declaration rather than
an import, following `relayLinkStore.ts`'s explicit ruling — importing either sibling's would make this
store a dependent of that store's module, and the lift into `src/shared/` stays open for the first
ticket that may also touch `src/main/` (`liveWindow.ts` holds the fourth copy).

`ServerConversationSummary` carries the origin as an **extra property beside** the wire fields, the
same assignability trick #1068 used at the event level: it stays assignable to `ConversationSummary`,
so `partitionByPromotion`, `partitionArchived`, `groupByWorkspace` and the three screen readers compile
untouched (AC4), and #1070 widens the parameter where it needs the server. `ConversationSummary` itself
is not edited (AC2).

### The state

```ts
export interface ConversationListState {
  conversations: readonly ServerConversationSummary[] | null   // the flat union, precomputed
  byServer: ReadonlyMap<ConversationListOrigin, readonly ServerConversationSummary[]>
}

export type ConversationListStore = ConversationListState & {
  setConversations: (rows: readonly ConversationSummary[], serverId?: string | null) => void
  clearAllConversations: () => void
}
```

A `Map`, never a bare object — `ServerOrigin`'s docblock rules it for any consumer that indexes by the
id, because a `__proto__` id would write through `Object.prototype` on a `Record<string, …>`.

The flat union is **stored, not derived at read time**, and written in the same `set` as the map. That
is #1134's `set((s) => ({ status, statuses: withSlot(…) }))` shape, and here it is what makes AC4 true
rather than aspirational: `selectConversations` stays a plain field read, so two reads with no write
between them are `Object.is`-equal by construction. A selector that folded the map on every call would
return a fresh array each time and drive a re-render storm through `useConversationListStore`'s
`Object.is` comparison.

### The write

`setConversations(rows, serverId?)`:

1. stamp — `rows.map((row) => ({ ...row, serverId }))`. **Spread first, then the stamp**, so the
   client-held origin always wins over any same-named key on the row (see § Security review).
2. file — copy-on-write into `byServer` (`new Map(held)` then `set`), never a mutation of the map the
   store already handed out. An untouched server's array comes back by reference, so a component
   watching that server does not re-render when a different one changes (AC4).
3. flatten — recompute the union from the fresh map, in the same `set`.

`serverId` is **optional**, and the optionality is load-bearing exactly as it is on
`setRelayLinkStatus`: it makes the absent case a genuine absent argument matching the three-case
domain with no sentinel value, and it leaves an origin-less call filing under the unstamped slot rather
than being dropped.

Still a **single setter** for the write path — keying adds no second mutation, so the header's
one-member-union argument survives. `clearAllConversations` is a second entry point but not a second
kind of write; it is the pairing-boundary drop, and its nullary signature is the point (§ AC5).

### The flatten, and the order across servers

```ts
function flattenByServer(byServer): readonly ServerConversationSummary[] | null
function compareOrigins(a: ConversationListOrigin, b: ConversationListOrigin): number
```

- **Not-loaded stays not-loaded.** An empty map flattens to `null`; any slot at all flattens to a
  concatenation, which may itself be `[]`. That keeps today's `null` (not yet loaded) versus `[]`
  (loaded, zero conversations) distinction exactly (AC3): with one server, before its reply the read is
  `null`, and after a `[]` reply it is `[]`.
- **Order is by server id, ascending, code-unit.** Not `localeCompare` — an id is opaque and a
  locale-sensitive comparator would make the sidebar's order depend on the machine's locale. Map
  insertion order was considered and rejected: `Map.set` on an existing key does not move it, so
  insertion order is technically stable across writes, but *which* server inserted first is an arrival
  race, so two launches could order the sidebar differently. Sorting by id is the stronger property and
  is what the ticket body rules.
- **The two non-string origins sort after every string**, `null` before `undefined`. Ranked
  (string → 0, null → 1, undefined → 2) rather than coerced, so the comparator is total over the whole
  domain. Rationale: a real paired server's position must not depend on whether an exceptional slot
  happens to exist, and both non-string slots are diagnostic- or test-reachable rather than
  sidebar-facing. `null` (bound, no paired record) sits closer to a server than `undefined` (never
  bound). Pinned by a test rather than left to this paragraph.
- **Within a server, wire order is preserved** — the daemon is the source of truth for ordering
  (`ConversationsPayload`'s docblock), so the stamp `.map` preserves index order and the concatenation
  never re-sorts rows. With one server the flat read is therefore exactly today's list, in today's
  order, plus the stamp (AC3).

Sorting on every write is bounded by the distinct-origin count — one slot per paired server plus at
most the two non-server keys — and a daemon cannot influence which key its own event carries, so
nothing it sends can mint a slot.

### The reads

```ts
selectConversations(s): readonly ServerConversationSummary[] | null          // the union — unchanged name
selectConversationsFor(origin): (s) => readonly ServerConversationSummary[] | null   // new
selectArchivedCount(s): number | null                                        // unchanged, now cross-server
```

`selectConversations` keeps its name and its `| null`; only the element type narrows, which is what
leaves the three readers needing no edit.

`selectConversationsFor` is the `selectRelayLinkStatusFor` / `selectModelListFor` selector-factory
idiom, and the observable form of AC4's second clause. It returns `byServer.get(origin) ?? null`.
It **does** default, where `selectRelayLinkStatusFor` deliberately does not, and the difference is not
an inconsistency: that selector's `undefined` had to stay distinct from a real link *category*, whereas
here `null` is already this store's not-loaded sentinel and no loaded value is ever `null` — a loaded-
empty server is `[]`. So the `?? null` erases nothing and lets #1070 reuse the same loading branch it
already writes for the flat read. `null` is a primitive, so the coalesce costs no referential stability.

**Call it with a client-held id**, never a daemon-supplied one — the read-side twin of the write-side
rule (§ Security review, Trust boundaries).

`selectArchivedCount` is untouched and now counts across servers, which is what the Settings Storage
row should show for an operator running several daemons. Its primitive return means a list write that
does not change the count wakes no re-render.

### The bridge (`conversationListBridge.ts`)

`originOf(event)` — a sixth copy of the stamp read, verbatim from `relayLinkBridge.ts`: an `in`-guarded,
`typeof`-checked access rather than a cast and rather than widening the listener's parameter to
`StampedDaemonEvent`, because this module's own tests build bare `DaemonEvent` literals and
`ServerOrigin.serverId` is required, so a bare event is not assignable. A copy rather than an import for
the reason `relayLinkBridge`'s docblock gives: taking `daemonEventBridge`'s module-private one would
couple two deliberately independent subscribers and drag this store's key domain onto the session store.

`subscribeConversations` gains the origin at the one line that writes:
`if (list !== null) setConversations(list, originOf(event))`. Its `setConversations` parameter widens to
the store's new signature. `translateConversationsEvent` is **left alone** — the origin rides beside
the union, so it is read at the event, not folded into a filter whose whole job is selecting one named
field (`relayLinkBridge`'s ruling, verbatim).

`shouldRefreshList` and the four refresh-trigger arms are untouched. A trigger still re-requests from
every server; making a trigger re-request only from the emitting server is a command with a server id
and belongs to the routing ticket.

`ConversationListData`'s subscribe effect threads the second argument through its inline arrow. Both
effects are otherwise unchanged.

### AC5 — the pairing-boundary clear

`clearAllConversations` becomes the **tenth** key of `ClearPairingScopedStateDeps`, wired in
`PairedShell.tsx`'s `clearPairingDeps` and therefore reached by both pairing-change sites at once —
that interface is the contract both paths share, and adding it at either call site instead is the
per-path divergence #531 exists to prevent.

Two inherited constraints, neither invented here:

- **Nullary.** `clearAllModelLists` and `clearAllSlashCommandLists` take no id for a stated reason: no
  daemon-supplied id may steer which server's state survives a pairing boundary. The argument applies
  verbatim, and here it is sharper than for either — the ids in question are conversation ids from
  a list the departing daemon itself supplied.
- **Idempotent, with the subscriber short-circuit.** The clear hands the state **object** back when the
  store is already clear, so `Object.is(next, state)` fires and a redundant clear wakes no listener at
  all. That is the first of the two jobs `clearPairingScopedState`'s docblock distinguishes; this store
  needs only that one — it reaches nothing outside memory, so it needs no side-effect guard and cannot
  throw. The already-clear test is `conversations === null && byServer.size === 0` (both halves, since
  the DI factory accepts an arbitrary injected state and only the sole write path keeps them derived
  together).

**Placement:** immediately after `clearAllModelLists`, among the free in-memory clears. Position is
free among those; what is not free is that it must precede `clearAllLastRead`, the one effect that can
throw. No re-mint hazard of the #777 kind exists here — nothing subscribes to this store and writes on
change; the three readers only render.

**The docstring is corrected in the same commit as the code.** `clearPairingScopedState.ts`'s header
currently lists `conversationListStore` first among the stores that self-heal and would be dead code
here, on #531's argument that the mount-time `list_conversations` request re-lists and the whole-array
replace overwrites everything. **Keying removes that self-heal**: the new pairing's reply lands in the
new server's slot, the departed server's slot is never written again, and the union keeps rendering its
rows. The discriminator the docblock states — "does a reconnect to the SAME daemon need to clear it?" —
now answers *no* for this store, which is the answer that routes it here rather than to the `connected`
edge. `clearPairingScopedState.test.ts`'s pinned dep-key set reddens on the tenth key by design.

**Per-server unpair does not exist** in the renderer and this ticket does not build toward it: both
pairing-change sites are whole-app, and the main-side `unpairHandler` erases *the* record. AC5 is the
whole-set clear at the boundary that exists today; per-server eviction lands with the ticket that
introduces a per-server unpair.

## State + concurrency model

One store slice, one write path, one clear. No async work, no subscriptions, no timers, no cancellation
path to define — the store is pure in-memory renderer state and the bridge's single listener already
owns its off-handle as the effect cleanup (unchanged).

The map is read **inside** the `set` updater rather than through `getState()` outside it, the
`modelListStore` idiom: zustand runs the updater synchronously against current state, so two replies
arriving back-to-back cannot interleave and there is no check-then-act shape on this path. The whole
write — stamp, file, flatten — is synchronous, so no observer can see a half-updated pair of fields.

Growth is bounded by the distinct-origin count, and `clearAllConversations` returns it to zero at every
pairing change.

## Error handling

No new failure modes. The write is total over the three-case key domain — an unstamped or `null`-stamped
event is filed rather than dropped or thrown on. The bridge's existing `list !== null` guard is
unchanged. Nothing here parses, validates or coerces: the rows are already narrowed main-side by
`parseConversationSummary`, and this store keeps its "no coercion, no validation" posture.

Nothing is logged, and that is deliberate and inherited: a diagnostic here could only carry the
conversation `id`, `name` or `cwd` — untrusted daemon-supplied strings that ADR 0007's content-free
rule forbids in a log — and there is no observed failure to instrument. `clearPairingScopedState`'s
no-diagnostic property is total and this dep does not crack it, not even with a count.

## Testing strategy

Vitest only (node environment, no DOM). No Playwright spec: nothing rendered changes, and the fake tier
drives one server, so it cannot observe a union across two.

**`conversationListStore.test.ts`** — plain-function tests over isolated `createConversationListStore()`
instances:

- two servers' replies both stay in the store; a second reply from A replaces only A's rows (AC1)
- every row read out carries the `serverId` from the argument; a row arriving with a `serverId`-shaped
  key of its own has it overwritten by the stamp (AC2, and the security review's finding)
- the flat read is `null` before any write, `[]` after an all-empty write, and both servers' rows after
  two writes (AC3)
- with one server, the flat read is the wire list in wire order (AC3)
- the cross-server order is by server id ascending, and is unchanged by a later write to either server
  (AC3)
- the two non-string origins sort after the strings, `null` before `undefined` (AC3)
- two reads with no write between them are `Object.is`-equal; a write for A leaves
  `selectConversationsFor('b')` `Object.is`-identical (AC4)
- `selectArchivedCount` counts across servers and still passes `null` through
- `clearAllConversations` returns the store to not-loaded, and on an already-clear store returns the
  state object by reference (AC5)
- DI independence; the injected initial state; setter reference stability

**`conversationListBridge.test.ts`** — injected spies, no React:

- a stamped `conversationsReceived` writes under its server id; two differently-stamped events keep
  both sets (AC1, through the real store)
- a `serverId: null` event files under the null slot; a bare (unstamped) event files under the
  unstamped slot — the write stays total
- the existing filter, refresh-trigger and off-handle tests keep passing unchanged

**`clearPairingScopedState.test.ts`** — the pinned ten-key set, `clearAllConversations` called exactly
once and with no arguments (the call-side half of the nullary rule), and its position before
`clearAllLastRead`.

Fakes over mocks throughout; the real store is wired only where the seam under test is the store's own.

## Open questions

1. **Should the `ConversationListOrigin` / `RelayLinkOrigin` / `StatusOrigin` / `liveWindow.ts`
   quadruplication be lifted into `src/shared/`?** Not here — the lift cannot reach the fourth copy
   without editing `src/main/`, which this ticket excludes, and a shared type with one unexplained
   holdout is worse than four documented copies. #1134's spec left this open on the same reasoning;
   this ticket makes it a fourth data point rather than resolving it. Resolution: deferred, unchanged
   from #1134.
2. **Does `selectArchivedCount` want a per-server form?** No consumer asks for one — the Settings
   Storage row is app-wide by nature. Not added; #1070 or a later Settings ticket can add it beside
   `selectConversationsFor` when something reads it. Resolution: deferred, no code.

## Sizing

Re-counted against this written plan: **4 production source files** (of 5) — `conversationListStore.ts`,
`conversationListBridge.ts`, `clearPairingScopedState.ts`, `PairedShell.tsx`; **2 new exported types**
plus one selector factory (of 5); **3 consumer call sites**, none of which changes (of 10); **5
acceptance criteria** (of 5); **no reject branches** (of 10).

The total-written-work line is expected to land around 850–900 lines against a ceiling of 800 — the
overage the refiner stated, and it is **stated rather than split**, on the floor rule. AC5 is the only
split candidate and its sole consumer is this keying: it exists only because this ticket removes the
self-heal, so splitting it means knowingly shipping a pairing-boundary data leak with its fix in a
sibling. The family's own measured actuals sit in the same band (#1134: 865 lines).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — the stamp must win over the row.** The design's boundary is the
  single expression `{ ...row, serverId }` in `setConversations`: everything left of it is untrusted
  daemon-supplied data, everything right of it carries a client-held origin. The property order is
  load-bearing. Written the other way round — `{ serverId, ...row }` — a daemon that returned a
  `serverId` key on a conversation row would overwrite the client's stamp and file its rows under
  another server's slot, which is exactly the confusion the stamp exists to prevent. Today that is
  unreachable: `parseConversationSummary` is a **closed reconstruction** (seven named fields into a
  fresh literal, unknown keys not copied through), so no daemon key survives decode. That decoder is
  the deterministic guarantee; the spread order is the free second fabric, and it must not be
  reordered by a later tidy-up. Phase B writes it in that order with a comment saying why.
- **[Trust boundaries] No findings — the read side.** `selectConversationsFor` takes a lookup key from
  the caller. The plan states the rule (`§ The reads`): it must be a client-held id from this client's
  own paired-server list, never a daemon-supplied field, or a hostile daemon could make one host row
  display another server's conversations. `ServerOrigin`'s docblock already rules the id "a REPORT, not
  a control input"; no security-relevant behaviour branches on it here — it selects rows for display.
- **[Trust boundaries] No findings — the rows themselves.** `cwd` and `name` stay untrusted
  daemon-supplied opaque display text, held as strings and never resolved into a filesystem path, a
  cache key or a URL. This ticket adds no new consumer of either; the three existing readers render
  them through React's escaping as they already do.
- **[Tokens, secrets, credentials] N/A by design.** This slice touches no token, key or credential.
  The `serverId` is a client-minted local identifier, not a secret, and it never leaves the renderer's
  memory — no `localStorage`, no disk, no IPC send. The one adjacent secret-bearing store,
  `sessionIdStore`, is cleared by the same `clearPairingScopedState` this ticket extends, and its clear
  is untouched.
- **[File / storage operations] N/A by design.** Nothing here reaches disk. `clearAllConversations` is
  explicitly the in-memory-only member of the clear set — the reason it needs the subscriber
  short-circuit but not `clearAllLastRead`'s side-effect guard, and the reason it cannot throw and so
  imposes no ordering constraint of its own beyond preceding the one clear that can.
- **[Inter-process / Electron attack surface] No findings.** No IPC channel, `contextBridge` API or
  window is added or widened. The bridge reads an already-typed, already-decoded event off the existing
  `DAEMON_EVENT_CHANNEL` subscription; the stamp it reads is bound main-side by `bindServerOrigin` from
  a paired record this client holds and is unreachable from the wire. The transport stays out of the
  renderer: no key, socket or raw byte enters this slice.
- **[Cryptographic primitives] N/A by design.** No randomness, hashing, comparison against a secret, or
  Noise surface. The comparator sorts opaque identifiers for display order — `compareOrigins` is
  ordinary `<`/`>`, and no timing-sensitive comparison exists here to want `timingSafeEqual`.
- **[Network & I/O] N/A by design.** No socket, no request, no timeout to set. The refresh triggers are
  untouched, so this ticket adds no new outbound command and cannot change the request rate. A hostile
  relay can still drop or delay the reply; the effect is a slot that stays unwritten, which reads as
  "not heard from" — the same answer as before this ticket.
- **[Error messages, logs, telemetry] No findings, and deliberately nothing added.** The clear stays
  silent (§ Error handling): the only values a diagnostic here could carry are untrusted daemon-supplied
  strings, and even a content-free count is refused, since `clearPairingScopedState`'s no-diagnostic
  property is total. No error message in this slice interpolates a row field or an origin.
- **[Concurrency] No findings.** No async work is launched, so there is nothing to cancel and no
  `AbortSignal` to thread. The one check-then-act shape available — read the map, then write it — is
  closed by reading inside the `set` updater rather than through `getState()`, so two replies arriving
  back-to-back cannot interleave. The bridge's listener lifecycle is unchanged and still returns its
  off-handle as the effect cleanup.
- **[Threat model alignment] MUST-name, addressed — stale rows across a pairing boundary.** This is the
  one threat the ticket *introduces* and it is AC5's whole reason for existing on this ticket. Keying
  removes #531's self-heal, so without the clear a departed server's conversations would keep rendering
  under a new pairing: a silent cross-pairing data leak of untrusted text attributed to the wrong
  machine, visible and clickable. Addressed in-scope by the tenth dep, reached by both pairing-change
  paths, with the pinned key-set test as the tripwire. **Explicitly out of scope and named:** per-server
  eviction on a per-server unpair (no such affordance exists in the renderer — it lands with the ticket
  that introduces one), and per-server request routing (a command carrying a server id — the routing
  ticket, not here). **Hostile daemon response:** handled upstream by
  `parseConversationSummary`'s fail-closed narrowing, unchanged; the row count per reply is bounded by
  `MAX_PLAINTEXT_BYTES` before any parse, and the slot count by the paired-server count, so a flooding
  daemon costs one bounded slot rather than unbounded growth.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
