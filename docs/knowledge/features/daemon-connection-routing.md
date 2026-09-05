# Daemon connection — per-server routing

Split out of [Daemon connection — lifecycle](daemon-connection-lifecycle.md) 2026-09-05 to keep that
document under the size cap. Part of [Daemon connection](daemon-connection.md); see that document for
what the package does, its edge cases and its links.

Until #1117 the composition root held exactly **one** `DaemonConnection` for the whole app. #1117 made
the *set* of live connections follow the set of paired records; #1118, #1119, #1120 and #1129 then
routed everything that used to reach `registry.active` (whichever server was paired most recently) to
the specific connection each one actually belongs to. #1129 was the last consumer —
`uploadAttachment`, arriving on its own IPC channel rather than through the command switch — and its
landing retires the stand-in outright: `const connection = registry.active`
(`src/main/index.ts`) no longer exists anywhere in the composition root.

# The connection registry (#1117)

Until this ticket the composition root built exactly **one** `DaemonConnection`, passed it
`serverId: null`, and wired both pairing lifecycle signals as "`reconnect()` that same object" — so
an operator with more than one paired machine only ever reached whichever was paired most recently.
`createConnectionRegistry` (`src/main/connectionRegistry.ts`) is the piece that makes the **set of
live connections follow the set of stored records**: one `DaemonConnection` per paired server,
dialled independently, each reading its own record by id rather than the store's "most recently
saved" answer.

It is Electron-free, filesystem-free and socket-free — the store, the connection factory and the
[diagnostic log](diagnostic-log.md) are all injected, the same seam shape as `DaemonConnectionDeps`'
`createDriver`/`now`/`mintToken` — so it is unit-tested with fakes rather than through
`src/main/index.ts`, which has no unit test in this repo.

## The stable stand-in

The composition root binds `registry.active` once, in place of the connection it used to construct
directly. `active`'s type is `Omit<DaemonConnection, 'start' | 'stop' | 'reconnect'>` — deliberately
narrower than the full interface, so the 22 existing call sites (`send`, `interrupt`, the attachment
upload/retrieval, the 21-arm command switch, …) keep their exact current shape while becoming
**structurally unable** to start, stop or re-dial one connection through the stand-in. Each member
resolves the *current* last-held connection at call time, so with more than one connection it answers
for whichever server was paired most recently — where these call sites already reached after a
re-pair, before this ticket. Routing them per server is #1118/#1119/#1120, deliberately out of scope
here.

## The entry set and its one invariant

The registry holds an ordered `Entry[]` (`{ serverId, record, connection }`), and maintains one rule:
**the list is never empty**, and its last entry is the connection for whatever record `store.load()`
would answer. When nothing is paired, the registry holds exactly one entry: a stand-in built with
`serverId: null` over the *whole* store — byte-for-byte the single connection the root used to build.
So the not-paired settle (`connecting` → `failed(not-paired)`) is preserved by **running the same
code**, not by re-emitting the event from a second place, and `active` needs no null branch.

## Reconcile — one path for both `onPaired` and `onUnpaired`

`onPaired`/`onUnpaired` are both `() => void` by contract (two shipped tests pin the *bare* call —
no record crosses), so the registry can't be handed what changed. Instead `reconcile()` re-reads
`store.list()` and diffs it against the held entries, synchronously scheduling the work and returning
immediately (satisfying the must-not-throw `() => void` contract the way `reconnect()` used to):

- a `server` with no held entry → **build** a connection for it (`viewFor(serverId)`, a
  `{ save, load: () => store.loadById(serverId) }` adapter, so `loadDialConfig` reads *that* record
  with zero changes to `daemonConnection.ts`) and start it if the registry is already dialling.
- a `server` whose held record differs field-for-field from the fresh one → **`reconnect()`** that
  connection alone — a re-pair is a record changing under a live connection (`save` replaces by
  `server` key), which is what today's `reconnect()` already does.
- a `server` whose record is byte-identical → **untouched**. (One narrowing, stated rather than
  hidden: re-pasting a byte-identical payload no longer re-dials, where the old single-connection
  `reconnect()` would have. A real re-pair always differs — the daemon mints a fresh `token` per
  `pyry pair` — so this only costs a manual "retry" gesture via duplicate paste, never a real re-pair.)
- an entry whose record is no longer in the store → **stop and drop** it alone; every other connection
  is left un-reconnected.
- an empty result → the held stand-in is **reused**, never rebuilt, unless the last real record was
  *just* cleared (a stopped connection can never be reused, since `stop()` is permanent). Rebuilding
  an already-held stand-in on every empty reconcile would stop the very connection whose dial *is* the
  `failed(not-paired)` settle — this was one of two departures from the original plan, found by the
  unit tests (see below).

Comparison is by value (`sameRecord`, four named fields), not "re-dial the most recent" — the latter
would also satisfy `onPaired`, but `onUnpaired` runs the identical path, and under a future per-server
unpair (#1090) it would re-handshake an untouched server every time a *different* one was dropped.

**The untrusted `server` id never becomes an object key.** It is QR/paste input, so the reconcile
looks up a held entry with a linear `Array.find`+`===`, never a `Record<string, Entry>` — an id of
`__proto__` or `constructor` would otherwise be a prototype-pollution path reachable from a pasted
payload. Pinned by a regression test.

**Reconciles are serialized through a promise chain** — `pairedServerStore`'s own `mutate` idiom,
lifted a layer up — because the body is a read-modify-write across `await store.list()`: two signals
arriving in quick succession must not each compute their target set from the same stale snapshot and
both build a connection for one new record. `stopped` is checked both before and **after** that
`await`, mirroring `bootstrap`'s own post-await check, so a `will-quit` landing mid-reconcile can't
resume into dialling a socket after the app has already torn everything down.

A throw out of `store.list()` (the unreadable-collection state [paired-server store](paired-server-store.md)'s
`save`-side fix exists for) changes nothing: the entry set is left as it stands, so a live set survives
it and an unpaired launch still dials its stand-in and settles through its own `bootstrap` exactly as
before. The caught object is dropped, never logged and never re-thrown — a decode or keychain message
could echo the blob.

## Wiring — the four lifecycle sites in `src/main/index.ts`

| Site | Before #1117 | After |
|---|---|---|
| connection construction | one `createDaemonConnection({ serverId: null, … })` | `createConnectionRegistry({ createConnection: ({ serverId, pairedServer }) => createDaemonConnection({ …, serverId, pairedServer }), store: pairedServerStore })`, then `const connection = registry.active` |
| `onPaired` | `connection.reconnect()` | `registry.reconcile()` |
| `onUnpaired` | `connection.reconnect()` | `registry.reconcile()` |
| `did-finish-load` | `connection.start()` | `registry.start()` — idempotent, deferred behind the registry's own first store read so a load that outruns that read still dials the right set |
| `will-quit` | `connection.stop()` | `registry.stop()` — reaches every held connection, so a quit never leaks a second server's socket, and latches so a reconcile still in flight builds nothing after |

`bundleSink`/`windowLocalSink` stay bound to `null`, the orchestrator stays constructed once, and
`pairingHandler.ts`/`unpairHandler.ts` are untouched — the signals stay value-free by design. The
`app.whenReady().then(() => { … })` callback stays non-`async`: the registry does its own store read
after returning synchronously from its constructor, which is what lets the two "this callback
completes in one tick" comments guarding the pairing/unpair handler registrations keep holding.

## What this doesn't do

- **No per-connection failure fence.** A connection dropped from the set while its own `bootstrap` is
  mid-`await` can still emit one late `failed` event after leaving the set — each connection's
  generation fence is local to itself; the registry adds no cross-connection one. The one reachable
  case is an unpair landing on an in-flight bootstrap, whose late event is `failed(not-paired)` —
  exactly what an unpair is supposed to produce anyway. Deliberately undefended: no such failure has
  been observed, and distinguishing "this server is gone" from "this server failed" belongs to
  per-server status removal (#1085), not here.
- **No per-server routing on `active`, at the time this ticket shipped.** Its 22 delegating members
  all reached whichever connection was paired most recently. #1118 (below) closed this for the ten
  members that carry a conversation id; #1119 (below) closed it for the five that carry a modal,
  question-batch or session id. Only `interrupt` — which carries no payload at all — is left on
  `active` for that reason; it is #1120's.
- **No new IPC surface, no new logged field.** Two [diagnostic log](diagnostic-log.md) events,
  `registry-reconciled { count }` and `registry-reconcile-failed { code: 'unreadable-collection' }` —
  counts and a static code, never a server id or a record. `DiagnosticEvent` has no server-id field
  and no index signature, so this is enforced by the type system, not by discipline.
- **The registry retains each `PairedServerRecord` in memory**, beside the connection it belongs to,
  purely to detect a re-pair by value — not a new exposure, since the connection already holds the
  same token and static key inside its `hello`/headers, and the retention ends when the entry drops.
  The registry's own store handle is a `Pick` without `clear`/`clearServer`, so it cannot erase a
  pairing under any code path (security review verdict: **PASS**).
- **A known, non-load-bearing comment gap:** `sameRecord` compares `PairedServerRecord`'s four fields
  by name and its header claims a field added to the aliased `QrPayload` would be "a compile error
  here" — that isn't true (the function would keep compiling and silently ignore the new field). Code
  review flagged this as a non-blocking SHOULD FIX; a field added to the wire payload alongside a
  daemon change must have `sameRecord` updated by hand.

## Revisions found during implementation

Two departures from the original plan, both surfaced by the unit tests it specified rather than by
production behaviour (each connection's own idempotent `start()`/permanent `stop()` masked both in
practice):

1. **A single `dialling` flag, latched inside the deferred start callback, replaced two flags.** The
   plan had `start()` set a flag synchronously and then schedule the dials — which double-dials,
   because entries built by the deferred store read see the flag already set and dial through the
   *build* arm too. Flipping the flag in the one place any connection is actually dialled makes the
   registry's own plural `start()` idempotent in its own right, and makes a second `did-finish-load`
   arriving before the first read resolves return early rather than re-dialling.
2. **An already-held stand-in is reused, not rebuilt, when the record set reconciles to empty.** The
   common unpaired-launch sequence — construct a stand-in, then reconcile to the same empty set — was
   stopping the very connection whose dial *is* the not-paired settle. A fresh stand-in is now built
   only when the last real record has just been cleared.

Full design, the security review (`PASS`, one MUST FIX resolved before ship — a concurrency gap where
`will-quit` landing mid-reconcile could dial after the app had already torn down, closed by the
post-`await` `stopped` re-check above), and the 19-case test table live in
`docs/specs/architecture/1117-connection-registry.md`.

# Conversation routing (#1118)

\#1117 made the number of connections follow the number of paired records, but left exactly one way
out of the registry — `active`, whose members resolve to the **last** entry at call time. So a message
about a conversation on host A still went to whichever host was paired most recently. `createConversationRouter`
(`src/main/conversationRouter.ts`) closes that for the ten entry points that already carry a
conversation id: `sendMessage`, `requestSessionSettings`, `promoteConversation`, `archiveConversation`,
`unarchiveConversation`, `deleteConversation`, `renameConversation`, `changeWorkspace`,
`dequeueMessage`, and the attachment-retrieval channel. The id these commands send **is** the routing
key, so no renderer file changed and no wire type widened.

Like the registry, it is Electron-free and unit-tested with fakes — `src/main/index.ts` has no unit
test in this repo, so the lookup-and-refuse decision lives in an injectable module and the root keeps
its ten call sites as one-liners: `router.route(command.payload.conversation_id)?.sendMessage(...)`.

## The index, and where it learns from

A module-local `Map<string, string>` (conversation id → server id) — a `Map`, never a bare object,
since both keys and values are daemon-supplied strings and a `Record` written through `__proto__`
would be prototype pollution reachable from a hostile or confused daemon (the same rule
`ServerOrigin`'s docblock states for `serverId`).

The router's `observe(sink)` wraps the sink handed to `createConnection` — **not** `live.sink` and not
the two `bindServerOrigin(live.sink, null)` sinks beside it (bundle + notification-activated, which
carry no conversation events) — so it sits in the position `createDaemonConnection` applies
`bindServerOrigin` internally over, and therefore reads an event whose origin is **already stamped**.
Closing the root's `serverId` into the observer instead would compile and work, but would be a second
origin-binding path beside the one `bindServerOrigin`'s header says must be unique — the first open
question in the spec, resolved in favour of reading the stamp.

At a `DaemonEventSink`-typed hole the static type is the bare `DaemonEvent` — #1068's `serverId` rides
beside the union, not inside its arms — so the stamp is read with an `in`-guarded, `typeof`-checked
access (`isAttachmentRetrievalRequest`'s idiom), never a cast and never by re-declaring the wrapper's
`send` as `StampedDaemonEvent`: that second form *compiles*, because method parameters are bivariant,
and is unsound.

Two arms are read for a conversation id: `conversationsReceived` (one entry per row) and
`conversationCreated` (one entry). Everything else passes through unread. **Record happens before
forward** — the whole no-race argument: anything the window can name, the index has already seen, with
no gap for a renderer that reacts synchronously to route against a stale index. `live.sink.isDestroyed()`
is hard-coded `false` ([Live window](live-window.md)), which is load-bearing here too: the observer
keeps recording even while no window exists, so a macOS window-close does not blind the index.

**Last write wins.** A conversation reported later by a different server re-points to that server — the
connection registry's own record list (§ The connection registry, above) has the identical property,
and a first-write-wins rule would make a conversation that genuinely moved hosts (a daemon restored on
new hardware) permanently unroutable. A re-point that actually **changes** the owner logs
`conversation-reindexed`/`reassigned` (content-free); an identical re-write logs nothing.

**Nothing is un-learned by a later list**, on purpose — a per-server replace-on-`conversationsReceived`
sweep was considered and rejected because it can un-know a conversation the window still has open (the
open thread holds its id independently of the list store), turning a conforming command into a
refusal. The growth this admits is bounded instead: `MAX_INDEXED_CONVERSATIONS = 10_000`. At the cap a
*new* id is not learned (fails closed — an unlearned id refuses rather than mis-routes) while an
*existing* id can still re-point (an overwrite doesn't grow the map). The cap-reached log is latched
for the *process* lifetime, not per over-cap transition (code review NIT, accepted as diagnostics-only:
if the hygiene delete below ever drops the index back under the cap and it refills, a second exhaustion
stays silent — nothing routes incorrectly either way).

## The two refusals

`route(conversationId)`:

1. Absent, or not in the index → `null`, logged `unknown-conversation`. This is also what
   `requestSessionSettings`'s **optional** id gets — no separate branch, since an absent id is not a
   known conversation.
2. In the index, but `connectionFor(serverId)` answers `null` (server unpaired, or never paired) →
   delete the mapping, then `null`, logged `server-not-connected`.
3. Otherwise → that connection.

Branch 2's two halves are deliberately unequal weight. **The connection lookup is the boundary** — a
known conversation whose server has no entry refuses on the connection side whether or not the index
still holds the mapping, so an unpair can never leave anything routable. The mapping delete beside it
is hygiene, not the safety property; there is no reconcile-driven sweep, because `reconcile()` is
asynchronous and a prune called beside it would run before the registry had dropped anything — a no-op
on exactly the unpair path it exists for.

There is **no fallback**, ever — not "the first connection," not "the most recent one." Refusing is the
entire reason this index lives in the background process instead of trusting a routing hint from the
window.

## The registry's per-server accessor

`connectionFor(serverId): ActiveConnection | null` is `connectionRegistry.ts`'s new member, found with a
linear `entries.find(... === serverId)` — never an object key, `server` being untrusted QR/paste input,
same reasoning as `reconcile`'s own lookup. Its view is built by the same `viewOf` helper `active` uses,
extracted so the 22-member delegation list is written exactly once: the `ActiveConnection` `Omit` (no
`start`/`stop`/`reconnect`) is therefore enforced at runtime on **both** accessors by construction, not
by a second hand-copied literal that could drift. A stale view is inert rather than dangerous — every
`DaemonConnection` member is a documented no-op once `stop()`ped.

## Where AC5 (no fixture edits) actually rests

The renderer persists no conversation list across a relaunch — two `localStorage` keys at ship time
(default workspace, push-notification preference) and no Zustand `persist` middleware — so a
conversation id can only reach a command after arriving on this run's stream, which the index has
already recorded. **Verifier correction:** by the time this shipped, `conversationLastReadStore` had
already added a *third* `localStorage` key, keyed by conversation id and surviving a relaunch — the
exact shape this paragraph warns would break the invariant. It doesn't: those marks feed unread
computation only, and every conversation-scoped command is driven from `getOpenConversationId()`, which
`activateConversation` sets from a row that arrived on `conversationsReceived`. Re-check this claim
against the current `localStorage` key count before trusting it, rather than trusting either number.

## What was still on `active`, and where it went

At the time this section shipped: `requestConversations`, `requestRecentWorkspaces`,
`createConversation`, `createWorkspaceFolder`, `requestDebugBundle`, `uploadAttachment` — none of these
names an existing conversation, modal, batch or session to route *to*, so `active` stayed the only
sensible target for them regardless of connection-per-server — plus `interrupt`, which carries no
payload at all. `answerModal`/`cancelModal`/`answerQuestions`/`refuseQuestions`/`setSessionSettings`
had already moved off `active` in #1119 (above), resolved by a modal id, a question-batch id, or the
daemon's own `session_id` instead of a conversation id.

\#1120 (below) closed this for every member except `uploadAttachment`: those six now carry an optional
`serverId` and resolve through `serverRouter.ts`. Until each command's renderer sender gains a
per-server surface to source that id from (#1070/#1085/#1086), an unnamed one still reaches only the
one connection the registry holds when exactly one is paired — the same "reaches the active server or
refuses" behaviour this paragraph originally described, now made explicit and bounded rather than
implicit in `registry.active`'s last-write semantics. With two servers paired, `requestConversations`
against a *named* server now reaches that server, so the conversation index's coverage gap this
paragraph used to describe (fed only by the active server's list) narrows to exactly the servers no
renderer surface can yet name.

No `DiagnosticEvent` field was added for this slice: the refusal logs `conversation-route-refused` with
`code: 'unknown-conversation'` or `'server-not-connected'` and nothing else, deliberately never the
conversation id — widening the allowlist would drag `RendererDiagnosticEvent` and
`receiveDiagnostic.test.ts`'s reviewed `Omit` pin into a main-process routing slice. Full design and
the security review (PASS, one re-point-logging SHOULD FIX folded in before ship) are in
`docs/specs/architecture/1118-conversation-routing-index.md`.

# Correlation routing (#1119)

\#1118 closed routing for the ten commands that carry a `conversation_id`. Five remained on
`registry.active`: `answerModal`/`cancelModal` (keyed by `modal_id`), `answerQuestions`/
`refuseQuestions` (keyed by `question_batch_id`), and `setSessionSettings` (keyed by the daemon's own
`session_id`). None of these carries a `conversation_id` — ADR 0009 rules that no `conversation_id`
rides an ANSWER, since the daemon resolves the correlation id against its own outstanding state — so
\#1118's index cannot route them, and with two servers paired an answer minted for host A's modal could
land on host B's wire. `createCorrelationRouter` (`src/main/correlationRouter.ts`) closes this for all
five, resolving each correlation id to the server that minted it — read off the stamped `modalShown` /
`questionShown` / `runConfigReceived` / `sessionSettingsUpdated` / `sessionTransition` events, never a
hint the renderer supplies (the renderer can name an id, never a server).

## A sibling module, not a fourth map in `conversationRouter.ts`

Same observation point as #1118 — nested in the `sink:` position `createConnection` builds
(`sink: correlations.observe(router.observe(live.sink))`), under `bindServerOrigin` — but a **separate
module**, because the two indexes have opposite lifetime rules. #1118's conversation index only ever
grows: a conversation stays nameable for the process lifetime. A modal ends at `modalDismissed` /
`modalAnswerRejected` and a question batch at `questionDismissed`, and a long session raises many of
both, so a map that only grows here would leak over a multi-day run. `sessions` has no settle event and
inherits #1118's grow-and-cap posture unchanged.

Three module-local `Map<string, string>`s (id → server id) — never a bare object, the same `__proto__`
reasoning `conversationRouter.ts` states for its own map.

| Index | Learns from | Forgets on |
|---|---|---|
| `modals` | `modalShown.modalId` | `modalDismissed`, `modalAnswerRejected` |
| `batches` | `questionShown.questionBatchId` | `questionDismissed` |
| `sessions` | `runConfigReceived.sessionId`, `sessionSettingsUpdated.sessionId`, `sessionTransition.newSessionId` | *(nothing — grow + cap, #1118's posture)* |

`''` is never learned in any space — for `sessions` this is AC3 (a `session_id` of `''` means "no
session resolved," not an address); the same guard covers the other two for free.

## Last write wins — and the reason is not #1118's

\#1118 argues last-write-wins from conversations that genuinely move hosts. A live modal id or question
batch does not move hosts — `serverId` is the paired host's own stable identifier — so the first draft
made the two settling spaces **first-write-wins**, on the theory that a second server claiming a live
nonce is anomalous and should be refused. The security review rejected this as a MUST FIX: both
renderer stores (`modalPrompts.ts`, `questionBatches.ts`) are match-and-replace on a re-delivered id, so
first-write-wins would let the operator read host B's re-delivered title/prompt/options while the
answer still routed to host A — an approval attributed to a prompt they never saw. Last-write-wins keeps
the index and the screen agreeing, which the security review generalised: *an index that disagrees with
the store the operator is reading is more dangerous than one that obeys an anomalous re-point.* What
actually closes the cross-host case is origin-checked eviction (below) plus the unguessability of the
ids, not the write rule.

A re-point that actually changes the owner logs a content-free `<kind>-reindexed`/`reassigned`; an
identical re-write logs nothing.

## Origin-checked eviction

`forget(index, id, serverId)` deletes only when the held owner equals the stamped origin — the one rule
\#1118 has no equivalent for, since nothing there evicts. Without it, a second paired host could retire
host A's outstanding modal by echoing its id in a `modal_dismissed` frame: a cross-host denial of the
operator's own prompt. A settle frame from the wrong host is a no-op instead.

## The three routing calls, and the two refusals

`routeModal`/`routeQuestions`/`routeSession` share one `resolve` body, on #1118's own two-branch shape:

1. Id absent (never learned, settled, or over cap) → `null`, logged `<kind>-route-refused
   { code: 'unknown-correlation' }`.
2. Id known but `connectionFor(serverId)` answers `null` → delete the mapping, then `null`, logged
   `<kind>-route-refused { code: 'server-not-connected' }`.

`<kind>` is one of the three static literals `modal`/`question`/`session` — the AC4 "which kind was
refused" requirement, met on both branches without widening `DiagnosticEvent`. There is no fallback,
ever: refusing is the safety property, since a refused command never reaches the connection method that
mints the answer token, so nothing is ever minted on the wrong wire.

The five call sites in `src/main/index.ts` are one-liners in #1118's shape, e.g.
`correlations.routeModal(payload.modal_id)?.answerModal(payload)`.

## Caps, and why the entry cap alone doesn't bound this map

`MAX_INDEXED_CORRELATIONS = 10_000`, per index — #1118's constant, unchanged. But a correlation id,
unlike a conversation id, is bounded only by `MAX_FRAME_BYTES` (256 KiB), so an entry cap alone would
bound each index at ~2.5 GB rather than the ≈1 MB `MAX_INDEXED_CONVERSATIONS`'s own argument assumes.
`MAX_CORRELATION_ID_LENGTH = 512` closes that (real ids are UUID-shaped, 36 characters) — an over-long
id is never learned and fails closed. `conversationRouter.ts` carries the same latent exposure and is
deliberately left alone; noted for whoever revisits it.

## No id ever reaches a log

Every diagnostic call here is a pair of string literals — no template, no interpolation — so a
correlation id is not merely absent from a log line, it is structurally unrepresentable from this
module. This matters most for `question_batch_id`: it is the batch's one-time unguessable nonce, and
`events.ts` rules it must never reach a log; the answer tokens are secrets on the same leg and are
equally excluded. `DiagnosticEvent` gained no new field (it is `{ event, code? }` with no
identifier-shaped member) — widening it would drag the renderer-facing `RendererDiagnosticEvent`
allowlist and its `Omit` pin along, which stayed out of scope.

## `sessionTransition` — added after ship, on a verifier MUST FIX

The first version fed `sessions` from `runConfigReceived`/`sessionSettingsUpdated` only, on the premise
that the run-config store addresses whatever `runConfigReceived` last reported. That premise is false:
every footer control reads `sessionIdStore` (via `selectSessionId`), and that store has **two**
independent writers — `runConfigSnapshot.ts`'s `subscribeRunConfig` (off `runConfigReceived`) and
`sessionIdBridge.ts`'s `subscribeSessionId` (off `sessionTransition.newSessionId`) — with neither
preferred over the other by the store's own docblock.

The gap was reachable on a **single** paired server: after a `/clear`, `sessionTransition` lands a new
session id in `sessionIdStore` while `runConfigSnapshot.ts` leaves the run-config snapshot untouched,
and `runConfigLive.ts`'s refresh trigger fires on only two edges (a rising `connected`, or a
running→idle turn) — neither of which a bare `/clear` produces. In that window, every Model / Effort /
YOLO / permission-mode change resolved against the *old* session id, which the index had never learned
as belonging to the new one, while `submitSettingsChange`'s optimistic overlay had already drawn the
change as applied. The operator would see a change take effect that was never sent.

The fix reads `sessionTransition.newSessionId` as a third learning arm into the same `sessions` map —
safe on every `WireSessionTransitionReason` (the event is stamped; `''` is caught by `learn`'s existing
guard; an `idle_evict` marker mirrors the previous id, so it's an identical re-write that logs nothing).
\#501 (the standing session-id-vs-conversation-id confusion bug) is unaffected: this arm names a
**session** id and lands in the session map only, same as the other two.

## `needs-real-claude`, added against the ticket's own declared scope

The ticket declared itself deliberately not a real-claude ticket — "the new behaviour is per-server
routing, which the real-claude tier cannot exercise at all, its fixture spawns one daemon" — and #1118
shipped the same way. The `sessionTransition` fix invalidated that reasoning for this ticket
specifically: AC3 now depends on a **single-daemon** sequence (`/clear` → `session_transition` → a
footer-control write) that the fake tier has zero coverage for (no run-config spec seeds a
`session_transition`) and that only a live claude session can drive (`/clear` is intercepted
client-side, see CLAUDE.md § Driving a running session). Code review added `needs-real-claude` on pass,
parking the PR for a live confirmation before merge even though the routing design itself needed no
split and no real-claude label by its own original construction. Read this as a standing lesson for the
family: a design that starts out provably single-daemon-safe can stop being so mid-implementation, and
the real-claude label decision belongs at review time, not only at planning time.

Full design, the two design-vs-implementation reversals above, and the security review (PASS, one MUST
FIX resolved on the write rule before ship, one MUST FIX resolved during code review on the session-
learning arm) are in `docs/specs/architecture/1119-correlation-routing-indexes.md`.

# Server-scoped command routing (#1120)

\#1118 and #1119 routed every command that carries an id of its own. What was left on `registry.active`
had no id of any kind to route by: `requestConversations`, `requestRecentWorkspaces`,
`createConversation`, `createWorkspaceFolder`, `interrupt`, `requestDebugBundle` — six commands that are
about a *whole server*, so with two servers paired each reached whichever host was paired most
recently. `createServerRouter` (`src/main/serverRouter.ts`) closes this, and is the one router of the
family whose input is untrusted: `conversationRouter.ts` and `correlationRouter.ts` both learn a server
id off a *stamped daemon event* and can trust what they hold, but nothing a daemon ever reports names
"the window's server" — the id here comes from the renderer, so "resolve against the registry, never
trust the hint" is the security property, not a style note.

## Not a third index

The whole difference from its two siblings: `serverRouter.ts` holds **no state at all** — no map, no
cell, no cap, no `observe`. It is a lookup against two of `ConnectionRegistry`'s accessors
(`connectionFor`, and the new `soleConnection`) plus a refusal, written once as `resolve` and reused by
`route` (`resolve(...)?.connection ?? null`) for the five call sites that need only the connection.

`resolve` has exactly three outcomes and no fallback to an arbitrary server:

| Input | Outcome |
|---|---|
| a `string` naming a connected server | that server, `{ serverId, connection }` |
| a `string` naming no connected server | `null`, logged `server-route-refused { code: 'server-not-connected' }` |
| absent, registry holds exactly one entry | that entry — the not-paired stand-in included |
| absent, registry holds more than one | `null`, logged `server-route-refused { code: 'ambiguous-server' }` |

`''` is a present string, so it takes the named branch and refuses; treating it as absent would route it
to the sole connection — the arbitrary-server fallback under a different spelling. A *named* request can
never reach the not-paired stand-in: `connectionFor` takes a `string` and the stand-in's id is `null`, so
the two can never match — the same structural guarantee `connectionFor`'s own docblock states for #1118.

## `soleConnection()` — one registry entry, not one paired record

`ConnectionRegistry` gains a third accessor, answering the single held entry when `entries.length === 1`
and `null` otherwise. It doesn't consult any id at all — a length check, not a lookup — so it trivially
satisfies the never-an-object-key rule its two siblings (`connectionFor`, `reconcile`'s own lookup) state
for the untrusted `server` field; its view is built by the same `viewOf` helper, so the `ActiveConnection`
`Omit` (no `start`/`stop`/`reconnect`) is enforced by construction on all three accessors rather than by
a third hand-copied literal.

**"Exactly one connection" means one entry, including the not-paired stand-in.** The entry list is never
empty (§ The connection registry, above) — with nothing paired it holds a single stand-in whose dial
*is* the `connecting` → `failed(not-paired)` settle — so an unpaired launch has exactly one entry and the
six commands stay the inert no-ops they are today (AC4). An accessor written as "exactly one *paired*
record" would refuse on that path and break it.

## The command shape

Six `RendererCommand` union arms gain an optional top-level `serverId?: string` — a sibling of
`payload`, never a field inside it, `setSessionSettings`'s `changeId` precedent exactly. The envelope
builders consume `payload` alone, so the key has no expression that could carry it onto the wire; four of
the six are bare members with no payload at all, so the field costs no payload type and no new wire-type
import. `interruptCommand` gains an optional parameter, assigned unconditionally into the returned
literal (`toEqual` ignores the resulting `undefined` own property, this file's own `attachment_ids`
idiom).

It is **optional** on purpose, and that is what keeps this slice main-only: a required field would be a
compile-forced edit in six renderer senders and their fixtures, none of which has a per-server surface to
source an id from until #1070/#1085/#1086 land. No renderer file is touched by this ticket.

**The boundary guard's optional-field trap, closed once for all six.** A shared `hasValidServerId`
helper in `commands.ts` checks absent-or-`undefined`-or-string, never a bare `'serverId' in value`:
structured clone preserves an explicitly-`undefined` own property across the IPC bridge, so a
present-key check alone would read `{ serverId: undefined }` (exactly what `interruptCommand()` mints)
as a supplied value, while a present-key *rejection* would refuse the ordinary bare command every
current sender produces. Type only, not emptiness and not canonical shape — `''` is accepted here and
refused one layer later, by the resolver; a shape check here would buy nothing the resolution doesn't
already buy.

`notify` gains no id and is not in this set. It is main-local — `fireNotification` owns the copy table,
no command field supplies text, no frame results — so a server id on it would be a field nothing reads.

## The debug bundle — per server

The one of the six whose consumer has state across asks. `DebugBundleDownloadDeps` loses
`requestDebugBundle`; `DebugBundleDownload.request` now takes it as a parameter, so the orchestrator
holds the in-flight gate and the save/emit wiring for the process lifetime while the connection it
drives is resolved **fresh at every ask**.

This is the one real shape change, not just a field add. Keeping the connection in the closure would
compile and work — until a server is unpaired and re-paired: the registry drops and `stop()`s that entry
and builds a new connection, and the held orchestrator's captured view would resolve the stopped one,
permanently, so every later bundle request for that server would fail `unavailable` with no recovery
short of a relaunch. A *re-pair alone* doesn't surface this — `reconcile()`'s `reconnect()` arm reuses
the same connection object, so the bug hides behind the sequence most likely to be exercised in
testing. Passing the arming function in per ask removes the state that could go stale, rather than
documenting that it must not.

`createDebugBundleDownloads(build)` memoises `build(serverId)` in a `Map<string | null, DebugBundleDownload>`
— `null` is the not-paired stand-in's key, distinct from every string — so two servers can download at
once (separate gates) and one server cannot be asked twice (a memo hit returns the held gate). The sink
is bound once per server, inside `build`, exactly as each connection's is — never by wrapping the shared
`live.sink` once, which would stamp every emitter built over it with one id.

**The memo is keyed by the resolved `target.serverId`, never by the renderer's `command.serverId`.**
Keying it before resolution would make the map renderer-driven and unbounded: a compromised renderer
could grow one entry, and one bound sink, per fabricated id. The two lines are trivially reorderable and
the reordering is silent — code review re-walked this ordering explicitly against the diff rather than
taking the plan's claim on faith, and confirmed it lands on the right side. The memo never evicts: there
is no registry signal to hang an eviction on, and an orchestrator for an unpaired server is unreachable
anyway, since the router refuses before it is ever selected.

`saveDebugBundle`'s filename stays module constants (`STEM`, `EXT`) — no per-server stem, on purpose, so
no untrusted input reaches a path segment; two servers downloading at once don't collide regardless,
since `flag: 'wx'` already makes the `… (n).tar.gz` advance atomic.

## The five plain call sites, and the one that needs the key too

`requestConversations`, `requestRecentWorkspaces`, `createConversation`, `createWorkspaceFolder` and
`interrupt` stay one-liners in #1118's shape: `servers.route(command.serverId)?.<method>(...)`. The
debug bundle resolves once with `servers.resolve(...)` instead of `route`, because it needs the routing
key as well as the connection — the key selects that server's held orchestrator, the connection arms
that one ask — and returns early on `null` before anything is selected or armed, so a refused ask never
touches the transport's reassembler.

**`interrupt`'s field is expected to become vestigial.** #1092 would put the open conversation's id on
the frame and re-route it through #1118's index instead, but it is natively blocked on a daemon change
(pyrycode#2103) that hadn't landed at ship time, so `interrupt` takes a server id here like its five
siblings. Nothing is built around the field that would be expensive to unwind if #1092 supersedes it —
it is one arm of the shared resolver, same as the rest.

## What's left on `active`

One entry point remained at ship time: `uploadAttachment`. It arrives on its own IPC channel rather
than through the `onCommand` switch, behind two request guards of its own, so naming its server was a
separate contract on a separate surface — #1129, below, reusing `serverRouter.ts` unchanged.

No `DiagnosticEvent` field was added: both refusals (`server-not-connected`, `ambiguous-server`) are
static-literal pairs under `server-route-refused`, matching `conversation-route-refused` /
`modal-route-refused` / `question-route-refused` / `session-route-refused` exactly — a server id is
structurally unrepresentable from this module, not merely absent from a log line by discipline.

## `needs-real-claude`: re-taken, declined

Per this document's own standing instruction (above), the label decision was re-checked at the end of
implementation rather than only at planning time. Unlike #1119, the design here did not acquire a
single-daemon live sequence mid-implementation — the behaviour stays per-server routing throughout,
which a one-daemon fixture cannot exercise at all, so the label was not applied. `interrupt` is in scope
but its wire behaviour is unchanged, only which connection it resolves through, and that is covered by
the router's unit tests plus the fake tier.

Full design, the three resolved Open Questions (no memo eviction — nothing to hang one on, and an
unreachable orchestrator is harmless; `interruptCommand` keeps its parameter despite no sender filling it
yet, since #1092 or a per-server sender ticket would otherwise re-mint it; `needs-real-claude` declined,
above) and the security review (PASS, no MUST FIX — two SHOULD FIX/NIT comments left for a follow-up,
pointing a couple of `index.ts` design-record comments at symbols this slice renamed or removed) are in
`docs/specs/architecture/1120-server-scoped-command-routing.md`.

# The attachment upload names its server, and the stand-in retires (#1129)

The last consumer of `registry.active`, and a different surface from the six #1120 moved: the upload
arrives on its own IPC channel behind `isAttachmentUploadRequest` / `isAttachmentPasteRequest`
(`src/shared/ipc/attachmentUpload.ts`), never through the `onCommand` switch, so it could not simply
join #1120's `serverId?: string` arms — it needed its own optional field on both guarded ask shapes,
checked by a channel-local `hasValidServerId` that restates rather than imports #1120's
`hasValidServerId` in `commands.ts` (no production module under `src/shared/ipc/` imports a sibling;
see [Attachment upload § The request body and its guard](attachment-upload.md) for the guard itself).
The **resolver is #1120's, unchanged** — `servers.resolve` / `servers.route` are consumed exactly as
shipped, with no new outcome, no new refusal shape and no second resolver minted.

**The routing decision moved from listener-construction time to send time, per upload — the ticket's
one real design call.** Before #1129 the listener's single `deps` object was built once, hoisted to the
top of `attachmentUploadListener`, and shared by all three arms (drop, paste, picker) so they could not
drift into reporting on different channels. #1129 turns that object into a factory,
`buildDeps(serverId)`, called exactly once **inside whichever arm the ask selects** — never at the top
of the listener — so `servers.route` (which logs `server-route-refused` on both its refusal branches)
is reached only after the guards have already discriminated a well-formed ask from a malformed one.
Resolving earlier would hand a looping renderer, sending garbage that matches neither guard, the exact
lever `src/main/index.ts`'s neither-guard-matched return exists to deny it. The factory shape is
*stronger* than the old hoisted literal, not weaker: there is still exactly one construction site and
one call per ask, and it is now structurally impossible for two arms to be handed differently-built
`emit`s, because there is one body rather than one object anyone could copy.

**The refusal is surfaced through the existing `upload` seam as `not-connected`, rather than decided
before the flow module runs.** `driveUpload` (`src/main/attachmentUpload.ts`) mints the `uploadId`,
calls `deps.upload` exactly once, and emits exactly one terminal from what it returns — machinery that
already exists and is already tested. A refusal decided at the composition root, before `driveUpload`
runs, would have no id to address itself to and would have to hand-write that exactly-one-terminal
property by hand. The cost is one sentence's honesty: "Not connected — the file was not sent." is exactly
right for `server-not-connected` and imprecise for `ambiguous-server`, where the client is connected to
more than one host and simply cannot choose. Accepted, because `resolve` already collapses both
refusals into one `null` — a distinct composer sentence would need either a vaguer sentence than the one
already shown, or a re-derivation of the resolver's own branch at the call site, duplicating a decision
`serverRouter.ts` owns — and because minting a distinct `AttachmentUploadFailure` member would
compile-force a fourth production file (`attachmentUploadCopy.ts`) for a sentence with no differently
actionable instruction behind it, until #1086 gives the composer a server surface to name. The
operator-facing diagnostic stays precise regardless: `resolve` logs `ambiguous-server` vs
`server-not-connected` under `server-route-refused` either way.

**The picker arm has no ask object at all**, so it has nowhere for a routing key to ride and takes the
resolver's unnamed path unconditionally — the sole connection when the registry holds exactly one
entry, a refusal when it holds more. `buildDeps(undefined)` is called after the `pickerOpen` gate, so a
suppressed second picker builds nothing.

**No renderer sender was wired to send a `serverId` in this slice.** The composer has no per-server
surface to source one from until #1086 lands, so both shipped senders
(`dropAttachmentFile`/`pasteAttachmentImage`, `src/preload/index.ts`) still emit the bare ask, and every
upload today still takes the unnamed path — single-server behaviour is unchanged byte-for-byte. See
[Attachment upload](attachment-upload.md) and [Attachment upload — the guard and the
drive](attachment-upload-guard-and-drive.md) for the channel-contract and guard detail, and
`docs/specs/architecture/1129-attachment-upload-server-routing.md` for the full plan and security
review.

With #1129 landed, every entry point into a daemon connection resolves through one of three indexes —
`router` (a conversation id), `correlations` (a modal, question-batch or session id) or `servers` (about
a whole server, or nothing at all) — and refuses what it cannot resolve. There is no default connection
left anywhere in this process, and a new entry point picks its index by what it is *about*, never by
adding a fourth.
