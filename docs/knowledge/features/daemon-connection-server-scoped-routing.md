# Server-scoped command routing (#1120)

Split out of [Daemon connection — per-server routing](daemon-connection-routing.md) 2026-09-07 to keep that document under the size cap. Part of [Daemon connection](daemon-connection.md); see that document for what the package does, its edge cases and its links.

\#1118 and #1119 routed every command that carries an id of its own. What was left on `registry.active`
had no id of any kind to route by: `requestConversations`, `requestRecentWorkspaces`,
`createConversation`, `createWorkspaceFolder`, `interrupt`, `requestDebugBundle` — six commands that are
about a *whole server*, so with two servers paired each reached whichever host was paired most
recently. **`interrupt` left this set in [#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092)**
once the daemon could carry a conversation id on the frame (pyrycode#2103) — see § The four plain call
sites, below, for the departure. **[#1289](https://github.com/pyrycode/pyrycode-desktop/issues/1289)
then added `renameWorkspace`** — a workspace label belongs to the host, not to any one chat, so it
carries no id to route by either and joined this set for the same reason the other five did — bringing
the count back to six, though the membership is not the original six: `interrupt` is out,
`renameWorkspace` is in. See [Conversation workspace change §
Workspace rename](conversation-workspace-change.md#workspace-rename-label-change-1289) for that verb's
own contract; the rest of this section covers the five that predate it.
`createServerRouter` (`src/main/serverRouter.ts`) closes this, and is the one router of the
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
record" would refuse on that path and break it. (Five of the six, as of
[#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092) — `interrupt` now routes through
\#1118's conversation index instead and is inert there on the same "no entry to route to" grounds, not
through this accessor.)

## The command shape

Six `RendererCommand` union arms gained an optional top-level `serverId?: string` — a sibling of
`payload`, never a field inside it, `setSessionSettings`'s `changeId` precedent exactly. The envelope
builders consume `payload` alone, so the key has no expression that could carry it onto the wire; four of
the six were bare members with no payload at all, so the field cost no payload type and no new wire-type
import. `requestConversationsCommand` (like its three bare siblings) gains an optional parameter,
assigned unconditionally into the returned literal (`toEqual` ignores the resulting `undefined` own
property, this file's own `attachment_ids` idiom). **`interruptCommand` was one of the four bare members
at ship time and shared this shape**, but
[#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092) removed `serverId` from it entirely and
gave it a **required** payload instead (`InterruptCommandPayload{conversation_id}`) — the field this
section describes now covers five members, not six; see [Command channel](command-channel.md) for
`interrupt`'s current shape. [#1289](https://github.com/pyrycode/pyrycode-desktop/issues/1289) then
brought the count back to six by adding `renameWorkspace{path, label}` — unlike the four bare members
above, it is **payload-carrying**, so (like `createConversation`/`createWorkspaceFolder` before it) it
does need a payload type and does need a wire-type import; the field itself is the same optional
top-level sibling shape.

It is **optional** on purpose, and that is what keeps this slice main-only: a required field would be a
compile-forced edit in six renderer senders and their fixtures, none of which has a per-server surface to
source an id from until #1070/#1085/#1086 land. No renderer file is touched by this ticket.

**The boundary guard's optional-field trap, closed once for all six (five since
[#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092) — `hasValidServerId`'s own docblock was
corrected to say so).** A shared `hasValidServerId` helper in `commands.ts` checks
absent-or-`undefined`-or-string, never a bare `'serverId' in value`: structured clone preserves an
explicitly-`undefined` own property across the IPC bridge, so a present-key check alone would read
`{ serverId: undefined }` (exactly what `requestConversationsCommand()` mints) as a supplied value, while
a present-key *rejection* would refuse the ordinary bare command every current sender produces. Type
only, not emptiness and not canonical shape — `''` is accepted here and refused one layer later, by the
resolver; a shape check here would buy nothing the resolution doesn't already buy.

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

## The four plain call sites, and the one that needs the key too

`requestConversations`, `requestRecentWorkspaces`, `createConversation` and `createWorkspaceFolder` stay
one-liners in #1118's shape: `servers.route(command.serverId)?.<method>(...)`.
[`renameWorkspace`](https://github.com/pyrycode/pyrycode-desktop/issues/1289) joined this set as a
fifth plain call site — `servers.route(command.serverId)?.renameWorkspace(command.payload)` — the same
shape as `createWorkspaceFolder` beside it, and the one place its design departs from its
conversation-scoped neighbour `changeWorkspace`. The debug bundle resolves
once with `servers.resolve(...)` instead of `route`, because it needs the routing key as well as the
connection — the key selects that server's held orchestrator, the connection arms that one ask — and
returns early on `null` before anything is selected or armed, so a refused ask never touches the
transport's reassembler.

**`interrupt` was a fifth plain call site at ship time, and its field turned out vestigial exactly as
predicted.** This section originally reasoned that #1092 would put the open conversation's id on the
frame and re-route it through #1118's index instead, but was natively blocked on a daemon change
(pyrycode#2103) that hadn't landed yet, so `interrupt` shipped taking a server id here like its four
siblings, with nothing built around the field that would be expensive to unwind once #1092 landed.
**[#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092) then landed exactly that way**:
`interrupt` dropped `serverId` and now resolves through `router.route(conversationId)?.interrupt(conversationId)`
against #1118's conversation-to-server index, the same shape as `newSession`. Nothing here needed to
change to accommodate the departure — the arm simply left, and this section's five became four.

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
which a one-daemon fixture cannot exercise at all, so the label was not applied. `interrupt` was in scope
at ship time but its wire behaviour was unchanged, only which connection it resolved through, and that
was covered by the router's unit tests plus the fake tier. (`interrupt` left this router entirely in
[#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092); see § The four plain call sites,
above.)

Full design, the three resolved Open Questions (no memo eviction — nothing to hang one on, and an
unreachable orchestrator is harmless; `interruptCommand` keeps its parameter despite no sender filling it
yet, since #1092 or a per-server sender ticket would otherwise re-mint it — #1092 in fact **removed** the
field rather than filling it, once the daemon change it was blocked on landed; `needs-real-claude`
declined, above) and the security review (PASS, no MUST FIX — two SHOULD FIX/NIT comments left for a
follow-up, pointing a couple of `index.ts` design-record comments at symbols this slice renamed or
removed) are in `docs/specs/architecture/1120-server-scoped-command-routing.md`.

