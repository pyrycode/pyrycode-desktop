# \#1118 — Route conversation-scoped commands by a conversation-to-server index

## Files read

Codegraph is not initialised in this repo (every `mcp__codegraph__*` call fails with "CodeGraph not
initialized"), so this list came from `Read` plus `grep`. Noted as the gap the reading list would
otherwise have been generated from.

- `src/main/connectionRegistry.ts` → `ActiveConnection` (the `Omit<DaemonConnection, 'start' | 'stop'
  | 'reconnect'>` guarantee this slice must not spend), `createConnectionRegistry`'s module-private
  `entries` / `current` / `active` (the 22-member delegating object the per-server accessor has to
  mirror), and its header's ruling that the decision lives in an injectable module because
  `src/main/index.ts` has no unit test.
- `src/main/index.ts` → the `app.whenReady()` callback: the `createConnectionRegistry` block and its
  `sink: live.sink` line (the observer's position), `const connection = registry.active` and the
  comment that names this ticket, the `onCommand` switch's ten conversation-scoped cases, and the
  `createAttachmentRetrieval` construction whose `requestAttachment` arrow is the tenth call site.
- `src/main/emitDaemonEvent.ts` → `DaemonEventSink` (the interface the observer must satisfy
  exactly), `emitDaemonEvent`'s destroyed-window ordering rule (**nothing may read `webContents`
  above the guard**), and `bindServerOrigin`'s header: bind exactly once per producer, and
  `createDaemonConnection` applies it internally over the sink it is given — which is what puts an
  observer in the `sink:` position *below* the stamp and therefore reading an already-stamped event.
- `src/main/liveWindow.ts` → `sink.isDestroyed()` is hard-coded `false`. That is load-bearing here:
  the observer's `send` is reached on every event even while no window exists, so a macOS
  window-close does not blind the index.
- `src/shared/ipc/events.ts` → `ServerOrigin` / `WithOrigin` / `StampedDaemonEvent` (the stamp is
  carried beside the union, so at a `DaemonEventSink`-typed hole the static type is the bare
  `DaemonEvent` and the stamp is a runtime property), the `conversationsReceived` and
  `conversationCreated` arms, and the standing instruction that a consumer indexing by `serverId`
  **must use a `Map`**.
- `src/shared/wire/types.ts` → `ConversationSummary.id`, `ConversationCreatedPayload.id`, and the
  `conversation_id` field on `SendMessagePayload`, `PromoteConversationPayload`,
  `ArchiveConversationPayload`, `UnarchiveConversationPayload`, `DeleteConversationPayload`,
  `RenameConversationPayload`, `ChangeWorkspacePayload`, `DequeueMessagePayload` — every routed
  command already carries its key.
- `src/main/daemonConnection.ts` → `DaemonConnection`'s member list (what the per-server view has to
  delegate), `send`'s "idempotent no-op when not connected, never throws" contract (why a view over a
  stopped connection puts nothing on any wire), and `AttachmentRetrievalConsumer.fail`, whose
  parameter is `AttachmentRetrievalFailure` and therefore accepts `'not-connected'`.
- `src/main/attachmentRetrieval.ts` → `AttachmentRetrievalDeps.requestAttachment` is a
  **construction-time** dep taking `(payload, consumer)` with `payload.conversation_id` in hand, and
  `settle` turns a `fail` into the window-facing terminal. So AC3's "answers its asker
  `failed`/`not-connected`" is bought by the root's arrow with no edit to that module.
- `src/shared/ipc/attachmentRetrieval.ts` → `AttachmentRetrievalFailure`'s `'not-connected'` member
  and its docblock ("the ask arrived with no live session, so nothing was sent") — the existing
  outcome the ticket says to reuse rather than widen.
- `src/main/diagnosticLog.ts` → `DiagnosticEvent`'s closed allowlist: no identifier-shaped field, no
  index signature. The refusal log is `event` + `code` and nothing else.
- `src/main/diagnosticLogSinks.ts` → `fileRotatingSink`'s `DEFAULT_MAX_BYTES` / `DEFAULT_MAX_FILES`
  (5 MiB × 5, oldest discarded). This is what bounds the renderer-drivable refusal log; see §
  Security review.
- `docs/specs/architecture/1117-connection-registry.md` → the entry set, the never-empty invariant,
  the stand-in, and its § Security review's ruling that per-server *routing* of renderer commands is
  out of scope there and picked up here.
- `docs/knowledge/features/daemon-connection-lifecycle.md`, `docs/knowledge/features/daemon-event-channel-plumbing.md`
  → the connect-on-pair / teardown-on-unpair sequences and the sink chain the observer joins.

## Design source

**Figma:** N/A — no `## Figma` section on the ticket, and correctly so: this slice adds no rendered
surface and no renderer file. The visual-fidelity check is intentionally skipped.

## Context

\#1117 made the number of connections follow the number of stored records, but left exactly one way
out of the registry: `registry.active`, whose members resolve to the **last** entry at call time. So
the root's command switch still reaches a single connection — it is just no longer the right one. With
two servers paired, a message about a conversation on host A goes to whichever host was paired most
recently. `src/main/index.ts`'s own comment names this slice as the fix.

This slice closes it for the ten entry points that already carry a conversation id. The id they send
**is** the routing key, so the window needs no new field and no renderer file is touched.

**No ADR is warranted.** No new IPC channel, no new at-rest format, no new boundary: the index is a
main-process `Map` of ids that crosses nothing. ADR 0002 (keep the transport out of the window) and
ADR 0009 (the modal frame carries no conversation id — which is why modals are \#1119's) both hold
unchanged. The documentation phase should fold this into
`docs/knowledge/features/daemon-connection-lifecycle.md` beside \#1117's registry section rather than
mint a decision record.

**Size — over the line ceiling by design, and deliberately not split.** Estimated ~1200 lines of total
written work across 3 production files (`src/main/conversationRouter.ts` new,
`src/main/connectionRegistry.ts` for the accessor, `src/main/index.ts` for the wiring). Every other
line of the size table holds: 3 production files, 10 call sites (at the boundary, not over), 3 new
exported symbols, 3 reject branches, 5 acceptance criteria. The overage is the **floor** case, not a
ceiling case: cutting the index module from its consumers mints a slice with exactly one consumer and
nothing that can observe it on its own — `src/main/index.ts` has no unit test and the two-daemon e2e
fixture is \#1091, which is blocked on this family. \#1117 shipped this same seam at this same scale
in one leg. Stated rather than split, exactly as the ticket argues.

## Design

One new module, `src/main/conversationRouter.ts`, plus one new member on the registry. Both are
Electron-free and unit-testable; the root keeps its per-case one-liners.

### The contract

```ts
/** conversationRouter.ts. Generic in the connection type because this module never CALLS a
 *  connection member — it only looks one up and refuses. `C` is inferred as `ActiveConnection` at
 *  the root, so the Omit guarantee is preserved where it is actually spent. */
export interface ConversationRouterDeps<C> {
  /** The registry's per-server accessor. `null` = that server has no live connection. */
  connectionFor: (serverId: string) => C | null
  diagnosticLog?: DiagnosticLog
}

export interface ConversationRouter<C> {
  /** Wrap a sink: record the conversation→server mapping off each stamped conversation event, then
   *  forward the event UNCHANGED. Applied once per connection, in the `sink:` position. */
  observe(target: DaemonEventSink): DaemonEventSink
  /** The connection that owns this conversation, or `null` HAVING ALREADY REFUSED AND LOGGED.
   *  Accepts `undefined` so `requestSessionSettings`'s optional id needs no separate branch. */
  route(conversationId: string | undefined): C | null
}

export function createConversationRouter<C>(deps: ConversationRouterDeps<C>): ConversationRouter<C>
```

```ts
/** connectionRegistry.ts, one new member on ConnectionRegistry. */
connectionFor(serverId: string): ActiveConnection | null
```

`route` returning `C | null` **after** logging its own refusal is what keeps the root's ten call sites
one-liners (`router.route(id)?.send(payload)`) while leaving the whole decision — lookup, refusal,
log — inside a module the tests drive with fakes. That is \#1117's shape, restated: the root is
wiring, the decision is testable.

### Why the router is generic

The module never invokes a connection member. Typing it on `ActiveConnection` would be false coupling
and would force the unit test to fabricate a 22-member object or cast. A single type parameter costs
nothing at the call site (inference) and states the true contract. The `ActiveConnection`-shapedness
the ticket protects lives on the **registry's** accessor, which is where it is spent.

### The index

`Map<string, string>` — conversation id → server id. **A `Map`, never a bare object**: both keys and
values are daemon-supplied strings, and a `Record<string, string>` written through `__proto__` is
prototype pollution reachable from a hostile or confused daemon. `events.ts`'s `ServerOrigin` docblock
already rules this for `serverId`; it holds identically for the conversation id.

**Learning.** `observe`'s `send` inspects the event before forwarding:

- `conversationsReceived` → one entry per row, keyed by `row.id`.
- `conversationCreated` → one entry, keyed by `conversation.id`.
- everything else → nothing read, nothing recorded.

An entry is written only when the event's stamp is a non-empty string and the id is a non-empty
string. A `serverId` of `null` is the registry's not-paired stand-in — it owns no conversation — and an
absent `serverId` would be an unbound producer, which `bindServerOrigin`'s header forbids; both are
skipped rather than trusted.

**Last write wins**, which is AC1's re-point: a conversation reported by a different server later
points at the server that reported it last. There is no merge and no tie-break. A re-point that
actually **changes** the owning server is logged content-free (`code: 'reassigned'`) — it is the one
state change here that a hostile paired host could use to claim another host's conversation, so it
leaves a trace in the bundle rather than none. See § Security review, finding 1.

**Reading the stamp.** At the `sink:` position the static type is the bare `DaemonEvent`
(`DaemonEventSink.webContents.send` declares it), and `serverId` is a runtime property carried beside
the union. It is read with an `in`-guarded, `typeof`-checked access — `isAttachmentRetrievalRequest`'s
own idiom — never a cast, and never by re-declaring the sink's parameter as `StampedDaemonEvent`
(method parameters are bivariant, so that would compile while being unsound).

**Nothing is un-learned by a later list.** A per-server replacement sweep on `conversationsReceived`
was considered and rejected: it can un-know a conversation the window still has open (the open-thread
route holds its id independently of the list store), which would turn a conforming command into a
refusal. Accumulation preserves the AC5 invariant absolutely — anything the window can name, the index
has already seen. The growth this admits is bounded instead, below.

**One cap, `MAX_INDEXED_CONVERSATIONS = 10_000`.** At the cap a *new* id is not learned; an *existing*
id may still re-point (an overwrite does not grow the map). Fails closed — an unlearned conversation
refuses rather than mis-routes — and the refusal is logged **once per transition**, not per row, so a
daemon spraying rows cannot drive the log. The repo's own idiom (`MAX_SAFE_BYTES`,
`MAX_RETRIEVAL_IDENTIFIER_LENGTH`, `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS`): a code-level cap, not a
stochastic rule. See § Security review for the bound this buys.

### Routing, and the two refusals

`route(conversationId)`:

1. `undefined`, or not in the index → `null`, logged `code: 'unknown-conversation'`.
2. In the index, but `connectionFor(serverId)` answers `null` → **delete the mapping**, then `null`,
   logged `code: 'server-not-connected'`.
3. Otherwise → that connection.

Branch 2 is AC4, and its two halves are deliberately unequal. The **connection lookup is the
boundary**: a known conversation whose server has no entry refuses on the connection side whether or
not the index still holds the mapping, so an unpair cannot leave anything routable. The deletion
beside it is hygiene — it drops the mapping at the one moment the mapping could ever matter again.
There is **no reconcile-driven sweep**: `registry.reconcile()` is asynchronous, so a prune called
beside it would run before the registry had dropped anything and be a no-op on exactly the path it
was written for. That is the elaborate mechanism the ticket warns against building in the belief that
it is the boundary.

**There is no fallback, ever.** Not "the first connection", not "the most recent one". A message
addressed to a conversation on host A must not reach host B under any circumstance; refusing is the
whole reason the index lives in the background process instead of trusting a routing hint from the
window.

### The registry's per-server accessor

`active`'s 22 delegating members are extracted into one helper so the new accessor cannot drift from
them:

```ts
/** An ActiveConnection view over a resolver. The ONE place the member list is written. */
const viewOf = (resolve: () => DaemonConnection): ActiveConnection => ({ /* 22 delegations */ })

// active            → viewOf(current)                     // unchanged behaviour
// connectionFor(id) → viewOf(() => entry.connection) | null
```

The view is a **fresh object carrying only the 22 members**, so the `Omit` is enforced at runtime as
well as in the type — a cast at a call site recovers no lifecycle method, because none is there.
That is \#1117's guarantee, and extracting the helper is what keeps it from being spent by a second,
hand-copied literal.

The lookup is `entries.find((entry) => entry.serverId === serverId)` — a linear scan with `===`, never
an object key, for `runReconcile`'s stated reason: `server` is untrusted QR/paste input. The parameter
is `string`, so the stand-in (`serverId: null`) is unreachable through it: with nothing paired,
**every** conversation-scoped command refuses. That is AC4's deterministic half.

`connectionFor` returns a view bound to the entry found at call time. The router calls it and invokes
one member in the same tick, so a view cannot go stale in practice; and even a stale one is inert —
`DaemonConnection.send` is a documented no-op with no driver and `stop()` removes the driver, so a
view over a dropped connection puts nothing on any wire.

### Root wiring

| Site | Today | After |
|---|---|---|
| before `createConnectionRegistry` | — | `const router = createConversationRouter({ connectionFor: (serverId) => registry.connectionFor(serverId), diagnosticLog })` |
| the factory's `sink:` line | `sink: live.sink` | `sink: router.observe(live.sink)` |
| the nine conversation-scoped `case`s | `connection.X(command.payload)` | `router.route(command.payload.conversation_id)?.X(command.payload)` |
| `createAttachmentRetrieval`'s `requestAttachment` arrow | `connection.requestAttachment(payload, consumer)` | look up `payload.conversation_id`; `consumer.fail('not-connected')` when it refuses |

The router is declared **before** the registry and reaches it by late binding, because each needs
something from the other: the registry's connection factory needs `observe`, the router needs
`connectionFor`. The arrow's body runs on a command, many ticks after `registry` is initialised, so
there is no temporal-dead-zone read — `downloader`'s `requestDebugBundle` arrow reaching `connection`
is the same shape.

`router.observe(live.sink)` is evaluated **once per connection**, giving each producer its own wrapper
over the shared sink and the one shared index. It stamps nothing and adds no second stamping path; it
reads what `bindServerOrigin` already wrote, one layer up.

`requestSessionSettings` unwraps its optional id into a local and passes the same value to both calls:

```ts
const conversationId = command.payload?.conversation_id
router.route(conversationId)?.requestSessionSettings(conversationId)
```

An absent id is not a known conversation, so it refuses on the ordinary path — no separate branch is
owed, as the ticket rules.

**Explicitly not touched.** `setSessionSettings` (carries `session_id`, a different id space),
`answerModal` / `cancelModal` / `answerQuestions` / `refuseQuestions` (modal/question id spaces) —
\#1119. `interrupt` (no payload at all) — \#1120. `requestConversations`,
`requestRecentWorkspaces`, `createConversation`, `createWorkspaceFolder`, `requestDebugBundle`,
`uploadAttachment` (no conversation id) — they keep reaching `registry.active`, so `connection`
remains live at the root. No renderer file, no wire type, no IPC contract, no `DiagnosticEvent` field,
no `AttachmentRetrievalFailure` member.

### Why AC5 holds with no fixture edits

The index observes the same stream the renderer renders from, and it **records before it forwards**,
so anything the window can name the index has already seen, with no race. Nothing persists a
conversation list across a relaunch: the renderer has exactly two `localStorage` keys (the default
workspace and the push-notification preference) and no Zustand `persist` middleware, so a conversation
id can only reach a command after arriving on this run's stream. `live.sink.isDestroyed()` is
hard-coded `false`, so the observer is reached even while no window exists — a macOS window-close does
not blind it, and a reopened window's fresh stores are re-fed by the same list request that feeds the
index.

**What would break that invariant**, and is worth a line here because it would turn this refusal from
a safety property into a bug: a later ticket that persists the conversation list across launches, or
that drives a conversation-scoped command from a stored id. Either one must feed the index from the
same store it restores from.

**Known consequence of the family's current state, stated rather than hidden.** `requestConversations`
still reaches `registry.active` only, so with two servers paired the index is fed by the active
server's list plus whatever any server broadcasts. A command for a conversation on the other server
therefore refuses until the list request fans out per server (\#1070/\#1091's layer). That is a strict
improvement on today, where the same command reaches the *wrong* daemon.

## State + concurrency model

- **Two cells**, both module-local to the router: the `Map` and one `boolean` latch for the cap log.
  No timer, no listener, no subscription, no async work — so there is nothing to cancel and nothing
  for `will-quit` to tear down. The registry's cells are unchanged.
- **Everything is synchronous.** `observe`'s `send` and `route` both run to completion with no
  `await`, so there is no check-then-act gap between learning a mapping and using it, and no
  serialisation is owed. This is the whole reason the ordering argument in AC5 is sound.
- **Record-then-forward** is the one ordering rule, and it is pinned by a test that re-enters `route`
  from the target's `send`.
- **Destroyed-window discipline is inherited exactly.** `isDestroyed` delegates to the target;
  `target.webContents` is read **only inside `send`'s body**, never at wrap time, never aliased above
  the guard — on a real destroyed `BrowserWindow` that property read *is* the throw. Wrapping a
  destroyed target is therefore itself safe.
- **Cancellation** is delegated whole: every long-lived task stays owned by its own
  `DaemonConnection`, which `registry.stop()` tears down. This slice adds none.

## Error handling

- Two refusal branches on `route` (`unknown-conversation`, `server-not-connected`) and one on the
  learn side (the cap). None throws; `route` returns `null` and the call site's `?.` makes the command
  a no-op that put no frame on any wire.
- **The attachment leg answers rather than going silent**: the root's arrow calls
  `consumer.fail('not-connected')`, which `createAttachmentRetrieval`'s `settle` turns into exactly one
  `{ type: 'failed', reason: 'not-connected' }` on the asker's own emit, releasing the in-flight slot.
  No new failure member, no widened union.
- `observe` never throws on a malformed event: every read is `in`-guarded and `typeof`-checked, and an
  arm it does not recognise is forwarded untouched.
- Nothing is caught and re-thrown anywhere in this slice, because nothing here can throw.

## Logging

Through the injected `DiagnosticLog`, **static event names and static codes only** — never an
identifier. `DiagnosticEvent` has no identifier-shaped field and no index signature, so this is
enforced by the type system rather than by discipline, and `code` is a literal at every site (never a
UUID smuggled in).

| Event | Code | When |
|---|---|---|
| `conversation-route-refused` | `unknown-conversation` | the id is absent or not in the index |
| `conversation-route-refused` | `server-not-connected` | the id maps to a server with no live connection |
| `conversation-index-full` | `cap-reached` | the cap refuses a new id — **once per transition**, latched |
| `conversation-reindexed` | `reassigned` | a known conversation's owning server **changed** — never on an identical re-write |

No success is logged: one line per command would be high volume with nothing to diagnose. The
`DiagnosticEvent` is **not** widened to carry the conversation id, per the ticket — that would drag
`RendererDiagnosticEvent`, `projectDiagnosticEvent` and `receiveDiagnostic.test.ts`'s `Omit` pin, a
renderer-facing security contract, into a main-process routing slice.

## Testing strategy

Vitest, node environment (this is `src/main` — no React, no DOM). Fakes at both seams: a
`connectionFor` fake over a plain `Map<string, object>` (the generic is what makes a one-line fake
sufficient), a capture-array `DiagnosticLog`, and a recording `DaemonEventSink`.

`src/main/conversationRouter.test.ts`:

| # | Behaviour proven | AC |
|---|---|---|
| 1 | Each row of a stamped `conversationsReceived` becomes routable to that event's server | 1 |
| 2 | A stamped `conversationCreated` becomes routable to that event's server | 1 |
| 3 | A conversation reported later by a different server re-points to the later reporter, and logs `reassigned`; a re-report by the SAME server logs nothing | 1 |
| 4 | `observe` forwards every event to the target unchanged (same object, same channel), arms it does not index included | 5 |
| 5 | The mapping is recorded BEFORE the forward: a target whose `send` re-enters `route` already routes | 5 |
| 6 | `isDestroyed` delegates, and `target.webContents` is not read at wrap time (a throwing getter still wraps) | 5 |
| 7 | An event stamped `serverId: null`, or carrying no `serverId` at all, indexes nothing | 4 |
| 8 | An unknown id returns `null` and logs `unknown-conversation` | 3 |
| 9 | `route(undefined)` — `requestSessionSettings`'s absent id — refuses on the same path | 3 |
| 10 | A known id whose server has no connection returns `null` and logs `server-not-connected` | 4 |
| 11 | …and the mapping is DROPPED: restoring that server's connection does not make the id routable again | 4 |
| 12 | Every logged record carries `event` + `code` and nothing else — no conversation id, no server id | 3 |
| 13 | A conversation id of `__proto__` / `constructor` routes correctly and pollutes no prototype | 5 |
| 14 | A server id of `__proto__` likewise | 5 |
| 15 | At the cap a new id is not learned (refuses) while an existing id still re-points, and `cap-reached` is logged once across many refusals | — |
| 16 | Nothing reaches `console.*` on any path (six-method spy, the `daemonConnection` precedent) | 5 |

`src/main/connectionRegistry.test.ts`, appended:

| # | Behaviour proven | AC |
|---|---|---|
| 17 | `connectionFor(id)` reaches **that** server's connection, not the most recently paired one | 2 |
| 18 | `connectionFor` answers `null` for a server with no entry, and for every id when nothing is paired | 4 |
| 19 | The returned view has no `start` / `stop` / `reconnect` **at runtime**, and `active` still does not either | 2 |
| 20 | `connectionFor` follows an unpair: the dropped server's id answers `null` afterwards | 4 |

`src/main/index.ts` has no unit test in this repo and gains none; its wiring is covered by
`npm run e2e`'s single-daemon fixture, which must pass unedited (AC5). No new Playwright spec: the
two-daemon fixture is \#1091 and is blocked on this family, and the fake tier cannot easily produce an
unknown conversation id — which is precisely why AC3's safety property is proven by unit tests over an
injectable module rather than by guard blocks in the switch.

## Open questions

1. **Does the observer read the stamp, or close the server id in at `createConnection`?** Resolved:
   read the stamp. The root has `serverId` in hand at that site, but binding it a second time would
   be a second origin-binding path beside `bindServerOrigin`, which its header forbids for the drift
   it invites. Reading what is already stamped means the index can never disagree with what the
   renderer sees.
2. **Should `conversationsReceived` replace that server's mappings rather than add to them?**
   Resolved: no — see § Design. It bounds the index for free but can un-know a conversation the window
   still has open. The cap answers the growth question without that cost.
3. **Should the index be pruned when a server is unpaired?** Resolved: lazily, at the lookup that
   would have used the mapping. The connection lookup is the boundary; a reconcile-driven sweep would
   race the reconcile's own `await` and be a no-op on the unpair path it was written for.

## Security review

**Verdict:** PASS (one SHOULD FIX folded into the plan above before this section was written — the
re-point log)

**Findings:**

- **[Trust boundaries]** Two boundaries, both named, plus **finding 1 — the one genuine cross-server
  vector in this design**. (a) *renderer → main*: the conversation id arrives on the already-guarded
  command channel and is used **only** as a `Map` lookup key. It never becomes a path, a store name, a
  persistence key or an object property; it reaches the wire only inside the payload the switch
  already forwards today, unchanged by this slice. It is a **LOOKUP KEY, NEVER AUTHORIZATION** —
  authorization on this wire is pairing, enforced structurally at the Noise handshake; the index
  decides only *which authenticated session* a command reaches, and its default is to refuse. (b)
  *daemon → main*: the ids come off the wire through the inbound decode's row narrower, which already
  stripped each row to its known fields, and the origin stamp is read with an `in`-guarded,
  `typeof`-checked access rather than a cast. **Finding 1: a hostile paired host B that reports host
  A's conversation id in its own `conversationsReceived` re-points the mapping, so the operator's next
  message about that conversation — text included — goes to B.** AC1 mandates last-write-wins, and it
  is the right rule: a conversation id genuinely can move hosts (a daemon restored on new hardware),
  first-write-wins would make a legitimately moved conversation permanently unroutable, and the
  renderer's own `conversationListStore` has the same last-write-wins property — an index that
  disagreed with the visible list would be worse, showing a row under one host while the message went
  to another. Exploitation additionally requires knowing a UUIDv4 the id-minting host never publishes
  outside its own session (122 bits). Classified **SHOULD FIX and fixed above**: the re-point is now
  logged content-free (`conversation-reindexed` / `reassigned`) whenever the owning server actually
  changes, so the one state change an attacker would need leaves a trace in the debug bundle instead
  of none. Refusing a conflicting claim outright is **OUT OF SCOPE** — it needs per-server conversation
  state to tell a move from a claim, which is \#1070's layer.

- **[Tokens, secrets, credentials]** No findings, and the surface is narrower than \#1117's. The index
  holds **ids only** — no token, no key, no message text, no record. The router is never handed a
  `PairedServerRecord`, never touches `pairedServerStore`, and its `connectionFor` dep answers an
  `ActiveConnection` view that exposes no credential accessor. Nothing it holds is logged, returned
  across IPC, or persisted. Generation, storage, rotation and revocation are all untouched: this slice
  constructs no connection and reads no store. Unlike \#1117 it retains nothing with a lifetime.

- **[File / storage operations]** Not applicable by construction: no filesystem call, no path join,
  and neither `fs` nor `electron` imported. The conversation id **never becomes a path component** —
  that is the attachment id's role, still gated solely by `resolveAttachmentPath`, which this slice
  does not touch; `attachmentDir` is still joined once at the root from `app.getPath('userData')` and
  never derived from anything the window or the wire sent. One pre-existing hazard is named and
  **improved rather than introduced**: attachments are stored under one shared directory keyed by
  attachment id, so since \#1117 two paired hosts could in principle collide on an id and overwrite one
  another's cached bytes. Routing retrieval per conversation strictly narrows the reachable set (a
  retrieval for A's conversation can now only be answered by A); a per-server store is **OUT OF SCOPE**
  and belongs with \#1070's per-server surfaces.

- **[Inter-process / Electron attack surface]** No findings, and the surface **narrows**. No
  `ipcMain` channel, no `contextBridge` member, no `webPreferences` change, no new preload export.
  A compromised renderer is strictly *less* powerful after this slice: today every
  `conversation_id` it invents reaches the active connection, and afterwards only ids the daemon
  itself reported reach that daemon — ids the renderer could already name, addressed to the host that
  minted them. It cannot enumerate connections, cannot address one, and cannot reach the index.
  \#1117's structural guarantee is not merely preserved but **strengthened**: extracting the 22
  delegations into one `viewOf` helper means `connectionFor` returns a fresh object carrying no
  `start` / `stop` / `reconnect` **at runtime**, so a cast at a routing call site recovers no
  lifecycle method — where a hand-copied second literal could have silently drifted, or a bare
  `DaemonConnection` typed as `ActiveConnection` would have kept them reachable. Pinned by test 19.

- **[Cryptographic primitives]** No findings, two properties named. (a) **Cross-server credential
  mix-up is unreachable from here**: routing selects an already-constructed connection and can neither
  construct, re-dial nor re-configure one (the `Omit`), so each connection keeps dialling
  `loadById(its own serverId)` — \#1117's guarantee, unspent. (b) No RNG, no key, no nonce, no AEAD and
  no comparison against a secret: every `===` here is id-vs-id, both non-secret routing values read
  from this process's own state, so `timingSafeEqual` is not warranted (nothing attacker-supplied is
  compared against a secret). The device keypair, per-connection sessions and per-direction nonce
  counters are untouched; no session is added or shared.

- **[Network & I/O]** No findings. No socket, no URL, no TLS decision, no timeout and no reconnect
  logic; `maxFrameBytes`, connect/idle deadlines, ping-pong liveness and backoff are per-driver and
  inherited verbatim. The slice can only **reduce** the frames put on a wire — every refusal is a
  frame not sent. A hostile relay is content-blind and cannot forge a stamped event (the stamp is
  bound main-side from the at-rest record, never read off the wire), so the most it can do to the
  index is drop or delay the events that feed it, which makes a conversation unknown: **fails closed,
  to a refusal.**

- **[Error messages, logs, telemetry]** No findings; one accepted amplification, bounded. Four static
  `event`/`code` pairs, no identifier of any kind — enforced by `DiagnosticEvent`'s allowlist (no
  identifier-shaped field, no index signature, no `Record`), not by discipline, and `code` is a
  literal at every site with no UUID smuggled in. `DiagnosticEvent` is deliberately **not widened**:
  that would drag `RendererDiagnosticEvent`, `projectDiagnosticEvent` and `receiveDiagnostic.test.ts`'s
  reviewed `Omit` pin — a renderer-facing security contract — into a routing slice. **Amplification:**
  `conversation-route-refused` is renderer-drivable at one line per refused command, so a looping
  renderer can churn the log. Accepted: the line is fixed-size and content-free, `fileRotatingSink`
  caps it at 5 MiB × 5 files with the oldest discarded (bounded disk, never exhaustion), AC3 mandates
  the record, and the identical vector already ships — `attachment-fetch` logs `started` per renderer
  ask. The two daemon-drivable records are held down deliberately: `cap-reached` is latched to one
  line per transition rather than one per row, and `reassigned` fires only when the owning server
  actually changes. No success path is logged. Pinned by tests 12 and 15; no `console.*` anywhere,
  pinned by a six-method spy (test 16, the `daemonConnection` precedent).

- **[Concurrency]** No findings, and **one launch-time hazard walked and closed**. The router is
  entirely synchronous — no `await`, no timer, no listener, no subscription — so there is no
  check-then-act gap between learning a mapping and using it, nothing to cancel, and nothing
  `will-quit` must reach. `connectionFor` reads `entries` synchronously with no await inside, so a
  reconcile can replace the set between two routes (correct: the next route sees the new set) but
  cannot tear one. The hazard is the **temporal dead zone** created by the late binding: the router is
  declared before `const registry`, and a `registry.connectionFor` read before that initialiser
  completes would be a `ReferenceError` in the composition root — fatal at launch. It is unreachable,
  and the reason is structural rather than incidental: `createConnectionRegistry`'s constructor does
  call `router.observe` synchronously (building the stand-in), but `observe` only *wraps*, and the
  recording path it installs reads the event and the index and never calls `connectionFor`. The dep is
  reached only from `route`, whose sole callers are the command listener and the attachment-retrieval
  listener — both driven by an IPC message, many ticks after `whenReady` returns.

- **[Threat model alignment]** No findings beyond finding 1. **Hostile relay** — content-blind,
  per-connection, cannot forge the origin stamp; fails closed (above). **Token theft from disk** —
  unchanged; this slice reads no store and holds no credential. **Hostile daemon response** — the
  primary threat here, and the source of finding 1 and of the growth question: an id-spraying daemon
  is bounded by `MAX_INDEXED_CONVERSATIONS` (≈ 10 000 × two short strings ≈ 1 MB, refusing new ids past
  it and never un-knowing an old one), which is why the cap is in the design rather than deferred.
  **Renderer compromise reaching the transport** — process isolation is untouched, and the renderer's
  reach over the wire strictly *shrinks* (above). The wire-protocol model upstream is unaffected: no
  envelope, no builder and no decoder is edited.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-05
