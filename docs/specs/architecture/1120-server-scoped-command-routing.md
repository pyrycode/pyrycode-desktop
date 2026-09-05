# 1120 — The server-scoped commands name their server

Ticket: [#1120](https://github.com/pyrycode/pyrycode-desktop/issues/1120). Split from #1084; the
fourth and last routing slice of that family, after #1117 (the registry), #1118 (conversation
routing) and #1119 (correlation routing).

## Files read

| Path → symbol | Why it matters |
|---|---|
| `src/main/index.ts` → the `onCommand` switch, `const connection = registry.active`, the `bundleSink` / `createDebugBundleDownload` construction, `windowLocalSink`, the `notify` arm | The six entry points this slice re-points, and the one construction site whose lifecycle changes. The header above `registry.active` names exactly what is left on the stand-in and why. |
| `src/main/connectionRegistry.ts` → `createConnectionRegistry`, `viewOf`, `connectionFor`, `Entry`, `buildStandIn` | Where the third accessor goes, and the two construction rules it must obey (linear scan, `viewOf`-built view). `buildStandIn` is why "exactly one entry" is not "exactly one paired record". |
| `src/main/conversationRouter.ts` → `createConversationRouter`, `route`, its two refusal literals | The refusal-and-log posture this slice copies: `null` having already refused, so the root keeps one-liners. Also the module header's "the decision lives here because `src/main/index.ts` has no unit test". |
| `src/main/correlationRouter.ts` → `resolve`, `DiagnosticRefusal` | The "one shared `resolve` body so the safety property has one implementation" idiom, and the closed-literal refusal-name type. |
| `src/shared/ipc/commands.ts` → `RendererCommand`, `isRendererCommand`, `interruptCommand`, `isAttachmentIdList`, the `setSessionSettings` `changeId` arm | The union arms and guard arms to widen. `changeId` is the top-level-sibling shape precedent; `isAttachmentIdList` is the explicitly-`undefined`-is-legal precedent; the `requestSessionSettings` arm is the opposite call and says why. |
| `src/main/debugBundleDownload.ts` → `createDebugBundleDownload`, its `active` flag, `DebugBundleDownloadDeps` | The gate that becomes per server, and the dep that must stop being construction-time. |
| `src/main/debugBundleDownload.test.ts` → `setup`, `Harness` | The harness the orchestrator's shape change churns. |
| `src/main/emitDaemonEvent.ts` → `bindServerOrigin` | "Bind exactly once per producer", and why the root binds its emitters separately rather than wrapping `live.sink` once. |
| `src/main/diagnosticLog.ts` → `DiagnosticEvent` | Confirms the field set (`event`, `code`, `status`, `bytes`, `count`, `host`, …) has no identifier-shaped member. Not widened here. |
| `docs/knowledge/features/daemon-connection-routing.md` § "What's still on `active`", § "The two refusals", § "`needs-real-claude`, added against the ticket's own declared scope" | The package overview. Three lessons carried into this plan: the refusal codes are a shipped vocabulary to match; the connection lookup is the boundary and the index delete is hygiene; and the real-claude decision is re-taken at review time, not only at planning time. |
| `docs/specs/architecture/1118-…md`, `…/1119-…md` (headers + security-review sections) | Sizing analogues and the security-review shape. |

Codegraph was not consulted: every `mcp__codegraph__*` call in this repo fails with
`CodeGraph not initialized`. Grep and Read throughout.

## Design source

**Figma:** N/A — main-process command routing. Nothing renders; no renderer file is touched, by the
ticket's own instruction. The visual-fidelity check is intentionally skipped.

## Context

#1117 made the set of live connections follow the set of stored paired records but left one way out
of the registry: `active`, whose members resolve to the *last* entry at call time. #1118 routed the
ten commands carrying a `conversation_id`; #1119 routed the five carrying a modal, question-batch or
session id. What is left on `registry.active` is everything with **no id of any kind to route by**.
Six of those are server-scoped by construction — `requestConversations`, `requestRecentWorkspaces`,
`createConversation`, `createWorkspaceFolder`, `interrupt`, `requestDebugBundle` — and with two
servers paired each of them reaches whichever host was paired most recently.

Neither sibling's technique applies. Both learn a server id off a *stamped daemon event* and refuse
anything they have not seen; these six name nothing a daemon ever reported. So the window says which
server it means, and **that hint is untrusted**: it is resolved against the registry's held entry
set, never trusted. That is the whole difference from the two shipped routers, and it is why this
module is a lookup rather than a third index.

**Sizing: over the 800-line ceiling, stated rather than split.** Every other boundary holds — 5
production files, 5 new exported types, 6 call sites, 4 acceptance criteria, 2 refusal branches — and
only the line count trips, at the refiner's estimated ~1700. The measured analogues are the three
siblings in this same family, counted from their merge commits: #1119 1851 added, #1117 1480, #1118
1422. The seam a split would use is the debug bundle, and it is not worth taking: a bundle-only child
needs the same union arm, the same boundary-guard arm and the same resolver as the other five, so it
would re-litigate all of that to own one construction site and one gate. #1129 takes the genuine
second surface (`uploadAttachment`, its own channel, its own guards) instead. Split depth was checked
— parent #1084, no grandparent — so a split was available and was declined on measurement, not on
depth.

**No ADR is warranted.** This slice adds no decision the family's three shipped specs and
`daemon-connection-routing.md` do not already frame; it applies their rules to a fourth id space.

## Design

### The resolver — `src/main/serverRouter.ts` (new)

Electron-free, socket-free, store-free and index-free. It holds **no state at all**: no map, no cell,
no cap, no `observe`. It is a lookup against the registry's held entry set plus a refusal, which is
the entire difference from `conversationRouter.ts` and `correlationRouter.ts`. Generic in the
connection type for their reason — the concrete `ActiveConnection` would be false coupling, and the
`Omit<DaemonConnection, 'start' | 'stop' | 'reconnect'>` guarantee is spent at the registry's
accessors where it belongs.

Contract:

- `ServerTarget<C>` — `{ serverId: string | null; connection: C }`. The id rides beside the
  connection because the bundle needs the *routing key* as well as the connection: it keys the
  per-server orchestrator and binds that orchestrator's sink. `null` only for the not-paired
  stand-in.
- `ServerRouterDeps<C>` — `connectionFor: (serverId: string) => C | null`,
  `soleConnection: () => ServerTarget<C> | null`, and the optional shared `DiagnosticLog`. Both
  lookups are the registry's; nothing else is injected.
- `ServerRouter<C>.resolve(serverId: string | undefined): ServerTarget<C> | null` — the whole
  decision, written once.
- `ServerRouter<C>.route(serverId: string | undefined): C | null` — `resolve(...)?.connection ?? null`.
  The five non-bundle call sites use this so they stay the one-liners #1118 established
  (`servers.route(command.serverId)?.requestConversations()`); the bundle uses `resolve`.

`resolve` has exactly three outcomes and no fallback to an arbitrary server:

| Input | Outcome |
|---|---|
| a `string` naming a connected server | that server's `ServerTarget` |
| a `string` naming no connected server | `null`, logged `server-route-refused { code: 'server-not-connected' }` |
| absent, registry holds exactly one entry | that entry's `ServerTarget` |
| absent, registry holds more than one | `null`, logged `server-route-refused { code: 'ambiguous-server' }` |

Taking `string | undefined` is #1118's own shape (`route(conversationId: string | undefined)`), so
an optional field needs no separate branch at any call site.

Two properties fall out of the types rather than out of care. The named branch narrows `serverId` to
`string`, so the `ServerTarget` it builds cannot disagree with the id it was asked for. And
`connectionFor` takes a `string` while the stand-in's id is `null`, so a *named* request can never
reach the not-paired stand-in — the same structural guarantee `connectionFor`'s docblock already
states for #1118.

`''` is a present string, so it takes the named branch and refuses (no record's `server` is empty).
It is deliberately not special-cased: an empty id is not an absent one, and treating it as absent
would route it to the sole connection.

**Logging.** Two string literals, no interpolation, matching the shipped vocabulary exactly —
`server-route-refused` beside `conversation-route-refused` / `modal-route-refused` /
`question-route-refused` / `session-route-refused`, and `server-not-connected` reused verbatim from
both siblings. `DiagnosticEvent` is **not** widened: it is `{ event, code?, … }` with no
identifier-shaped member, and adding one would drag the renderer-facing `RendererDiagnosticEvent`
allowlist and `receiveDiagnostic.test.ts`'s reviewed `Omit` pin into a main-process routing slice —
declined by #1118 and #1119 for the same reason.

### The registry's third accessor — `soleConnection()`

`ConnectionRegistry` gains `soleConnection(): SoleConnection | null`, answering the single held
entry when `entries.length === 1` and `null` otherwise. It obeys the two rules the ticket names:
the untrusted `server` id never becomes an object key (it is not consulted at all here — a length
check, not a lookup), and the view is built by the same `viewOf` helper `active` and `connectionFor`
use, so the `ActiveConnection` `Omit` is enforced by construction rather than by a hand-copied
literal.

**"Exactly one connection" is one registry *entry*, including the not-paired stand-in.** The entry
list is never empty: with nothing paired it holds a single stand-in built with `serverId: null`, and
that stand-in's dial *is* the `connecting` → `failed(not-paired)` settle. So an unpaired launch has
exactly one entry, the fallback answers it, and the six commands stay the inert no-ops they are
today — which is AC4. An accessor written as "exactly one *paired record*" would refuse on that path
and break it.

`SoleConnection` is exported as `{ serverId: string | null; connection: ActiveConnection }` and is
what `ServerTarget<ActiveConnection>` is satisfied by structurally; the router keeps its own generic
name so it stays registry-agnostic.

### The command shape — `src/shared/ipc/commands.ts`

Six union arms gain an **optional top-level `serverId?: string`**, a sibling of `payload` and never a
field inside it. That is `setSessionSettings`' `changeId` precedent exactly, and it is what keeps the
key off the wire *by construction*: every envelope builder consumes `payload` alone, so a top-level
sibling has no path to a frame. Four of the six are bare members with no payload at all, so the
sibling costs no payload type and no new wire-type import.

`interruptCommand` gains an optional `serverId` parameter, assigned unconditionally into the returned
literal. Unconditional assignment is this file's own idiom (`isAttachmentIdList`'s docblock records
that `submitMessage` assigns `attachment_ids` unconditionally and that `JSON.stringify` drops it), and
`toEqual` ignores an `undefined` own property, so the shipped constructor test stays green. No other
constructor exists for these six.

**The optional field with a one-connection fallback is deliberate and is what keeps this slice
main-only.** A required field would be a compile-forced edit in six renderer senders and their
fixtures, none of which has a per-server surface to source an id from until #1070 / #1085 / #1086.
No renderer file is touched here.

**The boundary guard's optional-field trap.** Structured clone *preserves* an explicitly-`undefined`
own property across the IPC bridge, so `'serverId' in value` alone would accept `{ serverId: undefined }`
as "present" and, worse, a bare `in`-rejection would refuse the ordinary case. The field is checked
**absent-or-undefined-or-string**, in one shared helper applied to all six arms —
`isAttachmentIdList`'s posture, and the deliberate opposite of the `requestSessionSettings` arm,
whose payload is *required* precisely because an unnamed request there addresses nothing and draws a
zero-valued reply (#941). Here an absent id is legal and means "the sole connection".

Type check only, not emptiness and not shape: the id is resolved against the held entry set, so an
unknown one refuses rather than mis-routing. There is nothing for a canonical-shape check to buy.

### The debug bundle — per server

`requestDebugBundle` is the one of the six whose consumer has state across asks, and AC3 asks for
three changes: the download runs against the named server's connection, the single-in-flight gate is
per server, and the progress and terminal events carry that server's id instead of the `null` bound
today.

**The orchestrator holds only what must persist across asks, and the connection is not that.**
`DebugBundleDownloadDeps` loses `requestDebugBundle`; `DebugBundleDownload.request` takes it as a
parameter instead. So one orchestrator per server holds the gate and the save/emit wiring for the
process lifetime, while the connection it drives is resolved **fresh at every ask**. Keeping the
connection in the closure would compile and would work until a server is unpaired and re-paired: the
registry drops and `stop()`s that entry and builds a new connection, and the held orchestrator's
captured view would resolve the stopped one — permanently inert, so every later bundle request for
that server would fail `unavailable` with no way back. Making it a parameter turns that from a
comment into a shape.

**One orchestrator per server, built on first ask.** `createDebugBundleDownloads(build)` in the same
module memoises `build(serverId)` in a `Map<string | null, DebugBundleDownload>` — a `Map`, never a
bare object, for the reason every id-keyed structure in this family states. `null` is a legal key,
distinct from every string, and is the not-paired stand-in's. Two servers can therefore download at
once (separate gates) and one server cannot be asked twice (a memo hit returns the *held* gate). The
memo lives in `debugBundleDownload.ts` rather than in the root because the root has no unit test in
this repo — the same argument #1117 and #1118 make for their own modules.

**The sink is bound once per server**, inside `build`, exactly as each connection's is —
`bindServerOrigin(live.sink, serverId)` per orchestrator, never a second binding over an
already-bound sink and never one wrapper over the shared `live.sink` (which would stamp all three
emitters with one id, the reason `bundleSink` and `windowLocalSink` are bound separately today even
though both are `null`). The root's `bundleSink` const disappears into `build`; `windowLocalSink`
stays bound to `null` and untouched, because `notificationActivated` is window-local and no daemon
originated it.

The orchestrator's information-minimising boundary is unchanged: `emit` still sees a chunk count, a
local path and the closed failure category, and the stamp is added by the sink beneath it, not by the
orchestrator — which stays origin-free and takes an `emit` function, not a sink.

### The six call sites in `src/main/index.ts`

Five stay one-liners in #1118's shape:

```
servers.route(command.serverId)?.requestConversations()
```

The bundle needs the key as well, so it resolves once and passes both halves — the target's
`serverId` selects the orchestrator, the target's `connection` arms this ask:

```
const target = servers.resolve(command.serverId)
if (target === null) return            // refused and logged by the router
downloads.for(target.serverId).request((consumer) => target.connection.requestDebugBundle(consumer))
```

`const connection = registry.active` **stays**: `uploadAttachment` is still its caller and is #1129's,
which is blocked by this ticket and reuses this resolver. The header above it is updated to say that
the six left this slice and that one entry point remains.

`notify` is untouched and gains no id. It is main-local: `fireNotification` owns the copy table, no
command field supplies text, and no frame results, so an id on it would be a field nothing reads.
The event its click emits stays origin-free for the reason the root already gives.

### Declaration order

`servers` is declared beside `router` and `correlations`, above `registry`, and closes over
`registry` lazily — `connectionFor: (serverId) => registry.connectionFor(serverId)`,
`soleConnection: () => registry.soleConnection()`. Unlike the two observers there is no
`observe` in the knot at all here, so the late binding is even more plainly safe: nothing this module
installs runs before the first command arrives, many ticks after `whenReady` completes.

## State + concurrency model

The resolver is stateless: construction is total and synchronous, there is nothing to tear down, and
there is no check-then-act gap because the lookup and its use are one expression in one tick.

The bundle memo is one `Map` that only grows, bounded by the number of servers the operator has ever
had paired in this process — not daemon-driven and not renderer-driven, since the key is a resolved
registry entry's id, never the renderer's hint. Entries are never evicted: an orchestrator for an
unpaired server holds a cleared gate and a bound sink, and its next ask resolves through the router
and refuses before the orchestrator is even selected.

Each orchestrator's gate is the existing single `active` flag, set synchronously before the arming
call and cleared at exactly the three terminal-emit sites, so it stays true across the async save.
Per server, that behaviour is byte-for-byte today's. No timer, no listener, no subscription is added
anywhere in this slice, so `will-quit` reaches nothing new.

## Error handling

Every failure is a refusal that puts no frame on any wire and emits one content-free debug line:

| Failure | Where | Result |
|---|---|---|
| a `serverId` naming no connected server | `serverRouter.resolve` | `null`, `server-route-refused { code: 'server-not-connected' }` |
| an absent `serverId` with more than one entry | `serverRouter.resolve` | `null`, `server-route-refused { code: 'ambiguous-server' }` |
| a malformed `serverId` (non-string, non-undefined) | `isRendererCommand` | the whole command is dropped at the boundary, as every malformed command is |
| a refused `requestDebugBundle` | the switch's early `return` | no orchestrator selected, no consumer built, no reassembler slot armed |

There is no fallback, ever — not "the first connection", not "the most recent one". Refusing is the
safety property: a command that reaches the wrong daemon is worse than one that reaches none, and
this resolver's input comes from the window rather than from a stamped event, which is exactly why.

The bundle's own failure surface is unchanged: the transport's `BundleFailReason` set still collapses
onto the three coarse `DebugBundleFailure` categories, the save errno is still caught and dropped, and
`not-connected` still reaches the renderer as `debugBundleFailed: unavailable`.

## Testing strategy

Vitest (node environment), fakes over mocks, no Electron. Nothing here is renderable, so there is no
renderer spec; nothing here changes an interaction, so there is no new Playwright spec. `npm run e2e`
must pass on the single-daemon fixture **with no edits** (AC4) — one paired record is exactly one
entry, so every bare command takes the fallback and behaves as it does today.

`src/main/serverRouter.test.ts` (new) — the safety property, driven through fakes for the two
registry lookups and a collecting `DiagnosticLog`:

- a named, connected server → that connection; the named branch never consults `soleConnection`
- a named, unconnected server → `null`, one `server-not-connected` line, and `connectionFor` was the
  only lookup reached
- an absent id with exactly one entry → that entry, and the stand-in case (`serverId: null`) is
  answered rather than refused
- an absent id with more than one entry → `null`, one `ambiguous-server` line
- `''` → refused on the named branch, not routed to the sole connection
- `route` and `resolve` agree on every branch above (one shared body, one refusal)
- every logged record's `Object.keys` is exactly `['event', 'code']` and neither value carries the id

`src/main/connectionRegistry.test.ts` — `soleConnection`:

- one paired record → that server's id and a working view
- the not-paired stand-in → `{ serverId: null, … }`, not `null`
- two paired records → `null`
- the returned view carries the 22 delegating members and none of `start` / `stop` / `reconnect`
- after an unpair that drops one of two, it starts answering again

`src/main/debugBundleDownload.test.ts` — the shape change and the memo:

- the existing suite, re-pointed at `request(requestDebugBundle)` (harness change only; every
  assertion about the fail-map, progress, the async-save window and the destroyed-window flag stands
  unchanged)
- a fresh arming function is used on each ask, so a re-resolved connection reaches the transport
- `createDebugBundleDownloads`: one `build` call per distinct id, the same instance returned on a
  repeat ask, distinct instances for distinct ids, and `null` distinct from any string key
- two ids download concurrently while one id is short-circuited (AC3's two halves, in one test)

`src/shared/ipc/commands.test.ts` — the boundary:

- each of the six arms accepts an absent `serverId`, an explicitly-`undefined` one, and a string one
- each of the six rejects a non-string `serverId` (number, `null`, object)
- the fifteen arms not in the table are unaffected, `notify` explicitly among them
- `interruptCommand()` and `interruptCommand('server-a')` both type-check as `RendererCommand` and
  produce the documented literal

## Open questions

1. **Should the memo evict on unpair?** Planned answer: no. There is no registry signal to hang it
   on, `reconcile()` is asynchronous so a prune beside it would run before the registry had dropped
   anything (#1118 ruled exactly this for its index delete), and a held orchestrator for an unpaired
   server is unreachable anyway — the router refuses before it is selected. To be confirmed while
   writing the memo test; recorded under Revisions if it changes.
2. **Does `interruptCommand` want the parameter at all, given no sender can supply one?** Planned
   answer: yes, as an optional parameter — it is the only mint site for that member, so #1092 or the
   per-server sender tickets would otherwise re-edit this file for one argument. To be re-checked
   against the "a field nothing reads" argument that drops `notify`; the difference is that
   `notify`'s id would reach no resolver at all, while this one reaches the same resolver as its five
   siblings.
3. **`needs-real-claude`?** Planned answer: no, and the ticket argues it — the behaviour is
   per-server routing, which the real-claude fixture cannot exercise because it spawns one daemon.
   But #1119 acquired the label at code review when a mid-implementation fix introduced a
   single-daemon sequence, and the package overview records that as a standing instruction to
   re-take the decision at review time. Re-checked before the PR opens; noted in the PR body either
   way.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the boundary is the whole slice. `serverId` crosses from
  the untrusted renderer at exactly two named places: `isRendererCommand` (shape — absent, or a
  string) and `serverRouter.resolve` (semantics — resolved against the registry's held entry set,
  never trusted as a hint). Downstream of `resolve` nothing holds the renderer's string: the five
  plain call sites hold an `ActiveConnection`, and the bundle holds a `ServerTarget` whose
  `serverId` came out of the resolution. This is the one property that separates this resolver from
  its two siblings, which learn their ids off stamped daemon events and can therefore trust them.
- **[Trust boundaries — a load-bearing ordering, not an incidental one]** The bundle memo is keyed by
  `target.serverId` (the **resolved** id), never by `command.serverId`. Keying it before resolution
  would make a `Map` whose key set is renderer-driven and unbounded — a compromised renderer could
  grow it one entry per fabricated id, and each entry would build and hold a bound sink. After
  resolution the key can only be an id `connectionFor` matched against a held record, or `null` for
  the stand-in, so the map is bounded by the servers this process has actually held. Stated here
  because the two lines are trivially reorderable and the reordering is silent.
- **[Trust boundaries — the guard's optional-field trap]** `'serverId' in value` alone is wrong in
  **both** directions here, and the file already records why: structured clone preserves an
  explicitly-`undefined` own property, so an `in`-check accepts `{ serverId: undefined }` as a
  present value (which must resolve as *absent*, not as a non-string), while an `in`-rejection would
  refuse the ordinary bare command every current sender produces. The check is
  absent-or-`undefined`-or-string, in one helper shared by all six arms, so the six cannot drift.
- **[Tokens, secrets, credentials]** No findings. Nothing here mints, stores, rotates, revokes or
  compares a token; no `timingSafeEqual` question arises, because the `===` in `connectionFor` and
  the length check in `soleConnection` compare a routing id to ids this process already holds, never
  a secret to a secret. **The id is not a bearer credential**: it selects a `DaemonConnection` that
  is already live and already authenticated in this process, so possessing it grants nothing pairing
  did not already grant. Cross-wiring one server's token onto another's socket is unreachable from
  here — each connection was built with its own `viewFor(serverId)` store view under the registry's
  "one `serverId` local, minted once" rule, and this slice adds no path that re-points a connection.
- **[File / storage operations]** No findings, and one decision recorded so it is not "improved"
  later: **the per-server bundle does not get a per-server filename.** `saveDebugBundle`'s filename
  parts are module constants (`STEM`, `EXT`) precisely so no untrusted input reaches a path segment
  and traversal is structurally impossible; putting a renderer-named id into the stem would undo
  that in one edit. Two servers downloading at once do not collide: `flag: 'wx'` is exclusive-create,
  so the EEXIST advance to `… (n).tar.gz` is atomic with no check-then-open gap. `save` stays
  `dir`-closed and per-server-identical.
- **[Inter-process / Electron attack surface]** No findings. No new channel, no new `contextBridge`
  member, no new `ipcMain.handle`/`on`, no `webPreferences` change, no protocol handler, no
  navigation surface. Six existing members of the existing `pyry:command` union gain one optional
  scalar, validated at the same boundary as every sibling field. The preload forwards the whole
  command object and validates nothing (by design — `receiveCommand`'s `isRendererCommand` is the
  boundary), so no preload edit is owed and none is made.
- **[Cryptographic primitives]** Not applicable, with the reason: this slice contains no randomness,
  no hashing, no key handling and no comparison against a secret, and it does not touch the Noise
  session, the handshake, the frame codec or any nonce counter. The connection methods it selects
  are the same ones the same commands already reached.
- **[Network & I/O]** No findings. **The id never reaches the wire, at two independent levels.** It
  is a top-level sibling of `payload`, and the switch passes `command.payload` (never `command`) to
  the two payload-bearing methods, so there is no expression that could carry it; and the envelope
  builders rebuild fresh literals from `payload` alone, which is the same construction that keeps
  `changeId` off the wire. No socket, URL, timeout, frame cap or TLS setting is touched.
- **[Error messages, logs, telemetry]** No findings. Both refusals are a pair of string literals with
  no interpolation, so a server id is not merely absent from a log line but structurally
  unrepresentable from this module — `conversationRouter.ts` and `correlationRouter.ts`'s posture,
  matched deliberately. `DiagnosticEvent` is not widened, so the renderer-facing
  `RendererDiagnosticEvent` allowlist and `receiveDiagnostic.test.ts`'s reviewed `Omit` pin stay out
  of a main-process routing slice. The refusal lines are renderer-driven at one per refused command,
  bounded by the rotating sink, so no latch is owed (unlike #1118's daemon-driven per-row cap log).
- **[Concurrency]** No findings. The resolver is stateless and total, so there is no check-then-act
  gap; the memo's get-build-set is synchronous with no `await` between the three, so two asks cannot
  interleave into two orchestrators for one id; the per-server gate is the shipped single flag, held
  across the async save exactly as today. Nothing new is scheduled, subscribed or listened to, so
  `will-quit` reaches nothing new. The memo grows without eviction — bounded by held servers, per the
  first finding — and an orchestrator for an unpaired server is unreachable, because the router
  refuses before it is selected.
- **[Concurrency — the one real change, and why it is a shape rather than a comment]**
  `requestDebugBundle` moves from `DebugBundleDownloadDeps` to a `request()` parameter so the
  orchestrator holds the gate but never a connection. Keeping the connection in the closure is the
  exploitable-by-accident version: after an unpair and re-pair, the held orchestrator's captured view
  resolves the `stop()`ped connection, and every later bundle request for that server fails
  `unavailable` with no recovery short of a relaunch. Making it a parameter removes the state that
  could go stale rather than documenting that it must not.
- **[Threat model alignment]** Malicious relay and hostile daemon: strictly *less* exposed than the
  two shipped routers — this resolver learns nothing from any daemon event, so a hostile paired host
  cannot influence where a command routes (#1119's origin-checked eviction has no analogue here
  because there is nothing to evict). **Renderer compromise: no privilege gain, one accepted
  widening.** All six commands were already reachable from a compromised renderer against the
  most-recently-paired host, and #1118's route already let it reach *any* paired host by naming a
  conversation id it had seen — so naming a server adds no capability. The widening is the debug
  bundle: a compromised renderer can now pull each paired server's bundle to Downloads where before
  it could pull only the active server's. That is exactly what AC3 asks for, the bundle is the
  content-free diagnostic archive (`diagnosticLog` carries event names, static codes, counts, byte
  lengths and a relay hostname — never a token, key, or message text), and the ask is already
  renderer-triggerable, so this is accepted rather than mitigated. Token theft from disk: untouched
  — no secret is read, written or moved by this slice.
- **[Threat model — named out of scope]** `uploadAttachment` stays on `registry.active` and is still
  reachable at the most-recently-paired host only; it is #1129, which is blocked by this ticket and
  reuses this resolver. `notify` gains no id on purpose (main-local, no frame results), and
  host-attributed notification copy is a separate ticket with its own consumer.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
