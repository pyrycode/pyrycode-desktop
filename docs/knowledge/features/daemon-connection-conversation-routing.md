# Conversation routing (#1118)

Split out of [Daemon connection — per-server routing](daemon-connection-routing.md) 2026-09-07 to keep that document under the size cap. Part of [Daemon connection](daemon-connection.md); see that document for what the package does, its edge cases and its links. See [The connection registry (#1117)](daemon-connection-registry.md) for `registry.active`, the stand-in this router closes a gap left open on.

\#1117 made the number of connections follow the number of paired records, but left exactly one way
out of the registry — `active`, whose members resolve to the **last** entry at call time. So a message
about a conversation on host A still went to whichever host was paired most recently. `createConversationRouter`
(`src/main/conversationRouter.ts`) closes that for the ten entry points that already carry a
conversation id: `sendMessage`, `requestSessionSettings`, `promoteConversation`, `archiveConversation`,
`unarchiveConversation`, `deleteConversation`, `renameConversation`, `changeWorkspace`,
`dequeueMessage`, and the attachment-retrieval channel. The id these commands send **is** the routing
key, so no renderer file changed and no wire type widened. (`requestModelList`, `newSession`,
`requestHistory` and `requestSystemPrompt` later joined this set once their own tickets gave the
daemon a conversation id to name; `interrupt` joined too, in
[#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092), once it left #1120's server-scoped
router — see § The four plain call sites, below.)

Like the registry, it is Electron-free and unit-tested with fakes — `src/main/index.ts` has no unit
test in this repo, so the lookup-and-refuse decision lives in an injectable module and the root keeps
its call sites as one-liners: `router.route(command.payload.conversation_id)?.sendMessage(...)`.

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
extracted so the delegation list — 26 members as of [#1230](https://github.com/pyrycode/pyrycode-desktop/issues/1230)'s
`requestSystemPrompt` addition — is written exactly once: the `ActiveConnection` `Omit` (no
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

