# #1139 — Scope the background-task roster reconnect reset to the reconnecting server

## Files read

- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → `subscribeBackgroundTaskRoster` — the
  `connected` branch this ticket scopes, and the docblock above it that calls that branch the sole
  enforcement of #573's AC5 and names "gating it behind a condition" as the hazard; also
  `BackgroundTaskRosterData`, the production wiring that hands the reset dep in.
- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `resetRosters` — today's whole-map clear with
  its `size === 0` short-circuit; `setRoster` / `setStartedTask` / `setUpdatedTask` — the four write
  paths whose held records the scoped reset must drop as one unit; `selectRosterFor` — the `?? null`
  read whose "after `resetRosters` every key is absent" claim stops being true store-wide; the module
  header's no-persistence security paragraph.
- `src/renderer/src/store/queueBridge.ts` → `originOf`, `subscribeQueue`, `QueueData` — #1138's landed
  template for the whole bridge half: the local three-valued origin read, the origin-taking reset dep,
  and the composition root that resolves the origin to ids.
- `src/renderer/src/store/queueStore.ts` → `resetBacklogsFor`, `clearAllBacklogs` — the setter PAIR
  this store copies (a scoped `…For` reset beside a nullary whole-map clear), including the
  iterate-the-held-keys shape and both short-circuits; its `createQueueStore` docblock states why
  scoping the first one required the second.
- `src/renderer/src/store/conversationListStore.ts` → `selectConversationIdsFor`,
  `EMPTY_CONVERSATION_IDS`, `ConversationListOrigin` — #1138's shared resolution, its stable empty
  reference, and the three-valued origin type this reset's key domain reuses rather than re-declares.
  Its docblock names this ticket as one of the three intended consumers.
- `src/renderer/src/clearPairingScopedState.ts` → `ClearPairingScopedStateDeps`,
  `clearPairingScopedState` — the eleven-effect dep set this store joins, the header paragraph that
  cites `backgroundTaskRosterStore` BY NAME as the counter-example to its own membership rule, the
  discriminator that rule turns on, and the `clearAllLastRead`-last throw-ordering constraint.
- `src/renderer/src/PairedShell.tsx` → `clearPairingDeps` — the shared injected dep object the new
  clear is wired into; `clearAllBacklogs` is the shape to copy, and neither `clearPairingScopedState`
  call site is touched.
- `src/renderer/src/clearPairingScopedState.test.ts` → the `Object.keys(deps).sort()` pin (eleven
  names, becomes twelve), the nullary `toHaveBeenCalledWith()` assertions, and the two call-order
  tests that pin a clear ahead of `clearAllLastRead`.
- `src/renderer/src/store/queueBridge.test.ts` → its `seam` helper, `connectedFrom`, and the
  `per-server reconnect scope (seam)` block — the six scenarios (own server, other server untouched,
  no list yet, unstamped/null slots, orphan conversation, stamp-beats-ack) this ticket's AC2 and AC5
  restate against four write paths instead of one.
- `src/shared/ipc/events.ts` → `ServerOrigin` — the rule that a consumer indexing by a server id uses a
  `Map` or a `Set`, never a bare object, and that the stamp is bound client-side rather than taken
  from `hello_ack.server_id`.
- `docs/knowledge/features/background-task-roster-store.md` § "Related" — records that this store is
  "deliberately absent" from `clearPairingScopedState` and that the slash-command store deliberately
  did NOT copy this store's `connected` reset. Both statements are what this ticket falsifies; the
  documentation phase owns rewriting them.
- `docs/knowledge/features/queue-store.md` § "Edge cases" — the #1138 lesson that matters most here:
  its first security-review pass PASSED while missing the pairing boundary entirely, and a revised
  pass caught it as a MUST FIX. This plan's § Security review audits that boundary from the start.

Codegraph was not used: every `mcp__codegraph__*` call in this repo fails with "CodeGraph not
initialized". The reading list above came from `grep`/`Read` and from #1138's landed diff.

## Design source

**Figma:** N/A — no `## Figma` section on the ticket, and correctly so. This slice changes store
setters, a bridge branch and a dep-set wiring; it renders nothing and adds no component. The
visual-fidelity check is intentionally skipped.

## Context

Since #1117 the background process holds one live connection per paired server, and since #1068 every
daemon event carries the id of the server it came from. `connected` therefore means "**this** server's
connection came back", not "the app's one connection came back". `subscribeBackgroundTaskRoster` still
reads it the older way: its `connected` branch calls `resetRosters()`, which empties the whole
`conversationId`-keyed map, so server B reconnecting erases server A's rosters. Nothing repopulates
them — these three frames are not in the daemon's reconcile-on-connect set and this app advertises no
`last_event_id` (#569 owns that gap) — which makes this the harshest of the three stores with this
defect.

**Scoping the reset relocates half of #573's AC5 rather than preserving it.** The reconnect half
survives: the reconnecting server's own listed conversations are still emptied on its edge. The
*previous-pairing* half does not. A new pairing's first `connected` arrives before that server's
`list_conversations` reply has landed, so `selectConversationIdsFor` answers `EMPTY_CONVERSATION_IDS`,
the scoped reset matches no held key, and the departed pairing's rosters are dropped by nothing at
all. With no re-assertion path of any kind they latch for the life of the process — stale `local_bash`
command lines and patch text attributed to a machine the operator has left. So this store must join
`clearPairingScopedState`, the set whose header currently cites it by name as the counter-example.

#1138 ran this exact argument one week ago on the weaker case: `queueStore` moved into the clear set
because scoping its `connected` reset removed the self-heal that had kept it out. The queue's case was
weaker because `queue_state` at least re-asserts a non-empty conversation, so only a *drained*
conversation went stale there; rosters re-assert nothing, ever.

**Both halves are one ticket, deliberately.** Landing the scoped reset alone would knowingly ship the
regression — on the store the codebase names as an AC5 enforcement point — with this ticket's own
criteria green. That is the § A1 floor rule: a slice whose deliverable is unverifiable without its
sibling is part of that sibling.

**Size: over the 800-line ceiling, stated rather than hidden.** The estimate is ~1150 lines of total
written work across 4 production files. Every other line of the size table holds: 4 production files
(≤ 5), 0 new exported types and 2 new store members (≤ 5), 4 production call sites (≤ 10), 5
acceptance criteria (≤ 5), no state machine and so no reject branches (≤ 10). The overage is licensed
by the floor-outranks-ceiling rule, and the measurement backs it: #1138 — the identical fix on the
weaker store, with two of this slice's pieces already paid for — landed 1280 insertions across 15
files at its merge commit `9de6fd3`. The parent chain is `#1139 → #1089 → none`, so a split would be
permitted by depth; it is refused on the floor, not on depth, and no `needs-human:sizing` marker
applies.

**No ADR.** This ticket adds no decision of its own: it applies #1138's merged rule ("the same ticket
that keys the reset by the conversation list must clear the store at the boundary that list is
cleared at") to the second of its three intended consumers. The rule is already recorded in
`clearPairingScopedState`'s header and `createQueueStore`'s docblock.

## Design

### The setter pair (`backgroundTaskRosterStore.ts`)

`resetRosters: () => void` is REPLACED by two setters, the `queueStore` shape:

```ts
resetRostersFor: (conversationIds: ReadonlySet<string>) => void   // connected edge, scoped
clearAllRosters: () => void                                       // pairing boundary, nullary
```

- `resetRostersFor` iterates the HELD keys (bounded by what this store holds, not by the server's
  conversation count), keeps those absent from the id set, and deletes the rest with copy-on-write.
  When no held key is listed it returns the state object ITSELF, generalising today's `size === 0`
  short-circuit so a first connect, a reconnect of a server holding nothing here, and an orphan-only
  map all wake no listener. Surviving entries come back BY REFERENCE, so a component watching another
  conversation sees `Object.is` true.
- `clearAllRosters` returns `initialBackgroundTaskRosterState` BY REFERENCE, with the same
  `size === 0` subscriber short-circuit its four siblings in the clear set carry. Nullary by design:
  no conversation id and no server origin, so no daemon-supplied field can steer which command lines
  and patches survive a boundary the operator crossed deliberately.

Membership is tested with `Set.has` over the held keys — never a bare object lookup, per
`ServerOrigin`'s rule — which is also what keeps `__proto__`, `constructor` and `''` unremarkable
conversation keys, as `backgroundTaskRosterStore.test.ts` already requires.

The three write paths are untouched. A dropped conversation loses its whole entry — roster-sourced
tasks, started-sourced tasks with their `toolCallId`, and recorded `latestUpdate` patches together —
because the reset deletes the map key rather than filtering inside an entry.

### The bridge (`backgroundTaskRosterBridge.ts`)

A module-private `originOf(event: DaemonEvent): ConversationListOrigin` is added, a COPY of the one in
`queueBridge` / `relayLinkBridge` / `conversationListBridge` / `daemonEventBridge` rather than an
import, for the reason each of those four states. It is an `in`-guarded, `typeof`-checked read of
#1068's stamp: `'serverId' in event` false ⇒ `undefined`, `null` ⇒ `null`, a string ⇒ that string,
anything else ⇒ `undefined` (total, no throw).

`subscribeBackgroundTaskRoster`'s third parameter becomes
`resetRostersForServer: (origin: ConversationListOrigin) => void`. The branch keeps its current
shape — first, ahead of the three translators, returning immediately — for the reason the existing
docblock gives: the translators return VALUES, not members of an action union, so folding the reset in
would force a `Snapshot | 'reset' | null` return type. It reads the discriminant and the stamp, never
`event.ack`.

Turning an origin into ids stays the CALLER's job, so the bridge remains store-free and drivable with
a plain spy. `BackgroundTaskRosterData` is the composition root:

```ts
(origin) =>
  backgroundTaskRosterStore
    .getState()
    .resetRostersFor(selectConversationIdsFor(origin)(conversationListStore.getState()))
```

The list is read at RESET time, not at subscribe time — the `QueueData` property, and it is what makes
a first connect drop nothing and a reconnect know its own conversations.

### The pairing clear (`clearPairingScopedState.ts`, `PairedShell.tsx`)

`ClearPairingScopedStateDeps` gains a twelfth member, `clearAllRosters: () => void`, called from
`clearPairingScopedState` beside `clearAllBacklogs` — the two are one fact against two stores, both
having lost their self-heal to the same scoping. It must precede `clearAllLastRead`, which stays LAST
for the throw-ordering reason its header gives; position is otherwise free among the in-memory clears.

`PairedShell`'s shared `clearPairingDeps` object gains
`clearAllRosters: () => backgroundTaskRosterStore.getState().clearAllRosters()`. Neither
`clearPairingScopedState` call site is edited — per-path divergence is the exact bug that helper
exists to prevent.

### Key domain

`ConversationListOrigin` (`string | null | undefined`) is reused, not re-declared. `byServer` is
genuinely keyed by all three values: `null` is a producer bound while no paired record was in hand,
`undefined` one that never went through a binding. Treating the origin as a total, opaque lookup key
is what makes AC2's unstamped clause fall out of the ordinary path rather than needing a special case.

### The four docblocks this falsifies

Rewritten, not extended — this is deliverable, not tidying. A reader left trusting any of them would
be trusting a guarantee that has moved:

1. `backgroundTaskRosterBridge.ts`'s `subscribeBackgroundTaskRoster` docblock — "THIS BRANCH IS THE
   SOLE ENFORCEMENT OF AC5 … it is why the store is deliberately NOT added to
   `clearPairingScopedState`", and its naming of gating-behind-a-condition as the hazard.
2. `backgroundTaskRosterStore.ts`'s module header, the no-persistence security paragraph —
   "`resetRosters` on the `connected` edge is what keeps a previous PAIRING's command lines and
   patches from ever appearing".
3. `backgroundTaskRosterStore.ts`'s `createBackgroundTaskRosterStore` docblock, the `resetRosters`
   paragraph — "clearing the WHOLE map here is what keeps a previous connection's — or a previous
   PAIRING's — tasks from ever appearing".
4. `clearPairingScopedState.ts`'s header — the sentence citing `backgroundTaskRosterStore` by name as
   the counter-example to its own set, and the discriminator ("does a reconnect to the SAME daemon
   need to clear it?") whose answer for this store becomes BOTH mechanisms, as it already is for
   `queueStore`.

Three adjacent claims in the same two files become false with them and are corrected in the same
edits: the store-shape docblock's "clear everything on the `connected` edge (AC5)",
`BackgroundTaskRosterData`'s inline "a connected edge clears every one of them (AC5)", and
`selectRosterFor`'s "after `resetRosters` every key is absent, so every conversation reads `null`".

The package overview at `docs/knowledge/features/background-task-roster-store.md` carries the same
now-false claims in its § Related and § Edge cases. It is the documentation phase's file; this ticket
does not touch it.

## State + concurrency model

Two renderer stores, both `zustand/vanilla`, both in-memory. `backgroundTaskRosterStore` is written on
the `connected` edge (scoped reset) and at a pairing boundary (nullary clear);
`conversationListStore` is only READ, through `selectConversationIdsFor`, never written here.

The origin is resolved from `conversationListStore.getState()` OUTSIDE the roster store's `set`
updater, which reads as a check-then-act across two stores. It is not one: both stores are written
from the same synchronous daemon-event dispatch on the renderer's single thread, with no `await`
between the resolve and the write. The held-map read is INSIDE the updater, closing the half that
otherwise could interleave.

Subscription lifecycle is unchanged: one `useEffect`, one `off` handle returned as the cleanup, one
live listener under a StrictMode double-mount. No new async work, no timer, no `AbortController` —
nothing here is long-lived. The pairing clear is a synchronous in-memory write inside a function whose
eleven siblings are the same.

## Error handling

No new failure mode. Neither setter can throw: both are pure `Map` operations over held state, and
`clearAllRosters` reaches nothing outside memory, so it neither needs nor perturbs the ordering
constraint that keeps `clearAllLastRead` last. `originOf` is TOTAL by construction — a value that is
neither a string nor `null` selects the unstamped slot rather than throwing — so a malformed stamp
degrades to "scope to the unstamped slot", never to an exception inside a daemon-event listener.

Nothing is logged, deliberately and in line with both paths' existing posture: the only values in hand
are a server origin and conversation ids, precisely the daemon-adjacent strings `ServerOrigin`'s
docblock forbids from reaching a log, and a task `description` for `local_bash` IS the command line
claude ran. Not even a content-free count of what was dropped.

## Testing strategy

All vitest, all node-environment. **No e2e work**: `e2e/` contains no background-task spec, so this
slice adds no Playwright surface. Everything below is unit-testable through injected spies and real
store instances.

`backgroundTaskRosterStore.test.ts` — the setter pair:

- `resetRostersFor` drops exactly the listed held keys and leaves the rest (AC1).
- A held conversation in no list survives every scoped reset (AC2's orphan clause).
- No held key listed ⇒ the SAME state object back (`Object.is`), covering first connect and a
  server holding nothing here.
- An empty id set drops nothing.
- Surviving entries come back BY REFERENCE (narrow-slice correctness).
- A dropped conversation loses started-sourced tasks and recorded patches with it (AC3's joins).
- `__proto__`, `constructor` and `''` are droppable and survivable like any other conversation key.
- `clearAllRosters` returns every conversation to never-observed — roster-sourced, started-sourced
  and patched alike (AC4).
- `clearAllRosters` on an already-empty map is a same-reference no-op, and on a populated one returns
  `initialBackgroundTaskRosterState` by reference.

`backgroundTaskRosterBridge.test.ts` — spy-driven branch tests plus a two-server seam mirroring
`queueBridge.test.ts`'s `seam(lists)` (the roster seam gains a `lists` parameter and the
`selectConversationIdsFor` wiring):

- `connected` calls the reset dep once with the origin `originOf` read; a real id, a `null` stamp and
  an absent stamp each pass their own value through (AC2's three-valued clause).
- Non-`connected` events never reset; the three translator branches are unchanged.
- Seam: two servers with a roster held on each — B's `connected` drops B's and leaves A's (AC1).
- Seam: after B's `connected`, no task from B's previous connection is readable, including a
  started-sourced task with its `toolCallId` and a task carrying a recorded patch (AC3).
- Seam: a `connected` for a server with no list yet drops nothing (AC2).
- Seam: an unstamped and a `null`-stamped edge each select their own slot and nothing wider (AC2).
- Seam: a roster held for a conversation in NO server's list survives all three edges (AC2's pin
  against a later silent widening).
- Seam: a stamp naming server A with an `ack.server_id` of B drops A's and spares B's — the stamp
  wins over the daemon's own word (AC5).

`clearPairingScopedState.test.ts`:

- The `Object.keys(deps).sort()` pin becomes twelve names.
- `clearAllRosters` called exactly once and NULLARY (`toHaveBeenCalledWith()`).
- Call-order: `clearAllRosters` before `clearAllLastRead`, the sibling of the two existing
  throw-ordering tests.
- The real-store case gains a populated roster store and asserts every conversation reads `null`
  after the clear (AC4).

`PairedShell.test.tsx` is expected to need no change — it does not pin the dep object — but is run to
confirm.

Fakes over mocks throughout: the existing `fakeBridge` captures the listener and hands back an `off`
spy; real store instances are constructed per test through the DI factories.

## Open questions

1. ~~**Does `clearAllRosters` return `initialBackgroundTaskRosterState` by reference, or a fresh
   `new Map()` as today's `resetRosters` does?**~~ **Resolved as the leaning: by reference**, matching
   `clearAllBacklogs` and the other four whole-map clears in the set. Nothing forced otherwise — the
   existing `initialBackgroundTaskRosterState is an empty map` test asserts by value and is unaffected,
   and the reference is safe to hand out because `rosters` is a `ReadonlyMap` every setter replaces
   rather than mutates. A new test pins the identity so a later `new Map()` regression reddens.
2. ~~**Does `PairedShell.test.tsx` need an edit?**~~ **Resolved: no.** It does not pin the dep object,
   and it passes unchanged. The dep-set tripwire lives in `clearPairingScopedState.test.ts`'s
   `Object.keys(deps).sort()` pin, which was updated to twelve names.
3. ~~**Is `resetRosters` referenced anywhere outside the bridge, the store and their two test files?**~~
   **Resolved before the plan commit.** A repo-wide sweep (`src/` and `e2e/`, no path filter) finds
   `resetRosters` in exactly those four files. `BackgroundTaskPanel` — the store's only real reader —
   goes through `selectRosterFor` alone and is untouched by the rename. No hidden call site.

## Security review

**Verdict:** PASS — with one MUST FIX recorded and already carried by § Design. #1138's first pass on
the sibling store returned PASS while missing the pairing boundary entirely, and a revised pass caught
it; that boundary is audited here from the start rather than discovered in review. The two findings
this pass declines to escalate are declined on a monotonicity argument that is spelled out, not on a
judgement call — and one clause of #1138's version of that argument is FALSE here and is not reused.

**Findings:**

- [Trust boundaries] The design has two inputs with **different provenance**, which is the whole point
  of the audit. The *slot* is chosen by the event's `serverId` stamp, bound main-side by
  `bindServerOrigin` from a paired record this client holds — `ServerOrigin`'s docblock rules it is
  deliberately not `hello_ack.server_id`, so a hostile or confused daemon cannot make its events claim
  another server's slot. AC5's claim holds on that half unconditionally, and `originOf` reads the
  stamp only, never `event.ack`. The *members of the id set*, however, ARE daemon-supplied:
  `ConversationSummary.id` values off that server's own `conversations` reply. So a daemon does
  influence which keys a reset drops.
- [Trust boundaries] OUT OF SCOPE — a hostile daemon on server A listing server B's conversation ids,
  so A's reconnect drops B's held rosters. Declined as a MUST FIX by monotonicity: the reset's scope
  moves from "every held key" to "the held keys this server's own list names", a **subset** under
  every possible input, and the worst outcome forced is exactly the behaviour shipped today for every
  reconnect on any server. A daemon can make this reset drop *less* than the status quo, never more,
  and no content crosses servers — a roster renders only under its own conversation id. **What must
  NOT be carried over from #1138's version of this finding is its closing clause, "and B's next
  `queue_state` restores it."** That is false here: none of the three frames is in the daemon's
  reconcile-on-connect set and this app advertises no `last_event_id`, so an erased roster returns
  only when claude next emits a frame for that conversation. The harm is therefore a longer-lived
  denial of display than the queue's, not merely a transient one — still strictly narrower than
  today's unconditional whole-map erase, and still availability-only. #569 owns the repopulation gap
  and needs a daemon-side change.
- [Trust boundaries] OUT OF SCOPE, and it strictly dominates the finding above: `rosters` is keyed by
  `conversationId` ALONE, with no server in the key, so `setRoster` / `setStartedTask` /
  `setUpdatedTask` already let a hostile daemon on A push a frame under one of B's conversation ids
  and have it render in B's conversation view — and here the payload is a `description` that for
  `taskType: local_bash` IS the literal command line claude ran. That is cross-attribution of
  untrusted command text on the WRITE path, which this slice neither introduces nor can fix: fixing it
  means keying the store by `(server, conversation)`, changing `selectRosterFor`'s contract and
  `BackgroundTaskPanel` with it. Same unfixed family the ticket's Context names under #1089; picked up
  by whichever ticket server-keys this store.
- [Trust boundaries] **MUST FIX — the pairing boundary, and the reason this ticket is not two.**
  Scoping the reset retires the justification that keeps this store out of `clearPairingScopedState`.
  A new pairing's first `connected` arrives before that server's `list_conversations` reply, so the
  resolution answers `EMPTY_CONVERSATION_IDS`, the scoped reset matches no held key, and the departed
  pairing's rosters are dropped by nothing at all. With no re-assertion path of ANY kind they latch
  for the life of the process. This is strictly worse than the sibling case #1138 fixed on two axes:
  `queue_state` at least re-asserts a non-empty conversation, so only a *drained* one went stale
  there; and the content at stake is worse than a `QueuedItem.text` — a `description` is a literal
  shell command line and `latestUpdate.patch` is the same class of model-influenced text under a
  structured-looking shape, both attributed on screen to a machine the operator has left. **Fixed in
  the design as written**: the store gains a nullary `clearAllRosters` and joins the pairing-scoped
  dep set. Recorded as a finding rather than silently folded in, because the plan that shipped the
  scoped reset alone would have passed its own criteria green while breaking #573's AC5.
- [Trust boundaries] The fix's own input is audited on the same terms and is strictly safer:
  `clearAllRosters` is NULLARY. It takes no conversation id and no server origin, so no daemon-supplied
  field can steer which command lines and patches survive a boundary the operator crossed
  deliberately — against the sharpest input in the whole dep set. It lands in the SHARED dep object,
  never at either `PairedShell` call site, so both pairing-change paths get it by construction and the
  dep-set pin test fails until it is actually invoked; per-path divergence is the bug that helper
  exists to prevent.
- [Trust boundaries] `EMPTY_CONVERSATION_IDS` is a shared singleton handed to every empty read, and
  `Object.freeze` does not stop `Set.prototype.add`, so its `ReadonlySet` type is the only guard.
  Accepted unchanged: this slice only ever calls `.has` on it and never retains it, and returning a
  fresh set instead would forfeit the reference stability it exists for.
- [Trust boundaries] `__proto__`, `constructor` and `''` are unremarkable conversation keys that
  `backgroundTaskRosterStore.test.ts` already pins. The scoped reset iterates a `Map`'s held keys and
  tests membership with `Set.has` — never a bare object keyed by id — so no id can write through
  `Object.prototype`. This is `ServerOrigin`'s docblock rule applied on the read side, and the new
  tests keep the existing pin true.
- [Tokens, secrets, credentials] No findings — nothing on this path reads, stores, compares or logs a
  credential. The origin arrives as a `string | null` scalar, never a `PairedServerRecord`, so the
  record's `token` and `server_static_pubkey` are structurally unreachable; both setters delete or
  replace map entries and never read a `HeldBackgroundTask`'s `description` or `patch`.
- [File / storage operations] No findings, and one obligation must survive the docblock rewrite. No
  filesystem path, no `safeStorage`, no `localStorage`, IndexedDB or renderer web storage of any kind
  is touched; both stores are in-memory renderer state that dies with the window. But the store's
  header states its no-persistence rule with the `connected` reset as the stated reason — the very
  justification this ticket falsifies. Rewriting that paragraph must **re-attribute** the obligation
  to the pairing clear, never delete it along with the false reason: web storage would still survive
  the boundary, and the content is command-line text. Called out because a careless rewrite loses a
  security rule while looking like a correctness fix.
- [Inter-process / Electron attack surface] No findings — no new IPC channel, no `contextBridge`
  addition, no preload change, no `webPreferences` touched. The bridge subscribes through the existing
  `window.pyry.onDaemonEvent` and adds no send path; the origin rides #1068's already-shipped stamp.
  Nothing in the diff imports from `src/main/`, so no transport, socket or key surface moves
  renderer-side.
- [Cryptographic primitives] No findings, and the absence is load-bearing rather than vacuous: the
  membership test is `Set.has` over non-secret routing ids, so the checklist's constant-time-comparison
  rule does not engage — neither operand is a secret or a MAC. No RNG, no key material, no Noise.
- [Network & I/O] No findings on the network axis — no socket, frame, URL or timeout — but one
  memory-retention consequence is named rather than glossed, and it has no analogue in #1138. The
  store's header accepts an unbounded-COUNT growth path: a started-only task for a conversation that
  never receives a subsequent roster is held "until the `connected` edge clears it". Scoping that edge
  means it now collects only the reconnecting server's **listed** conversations, so a started task
  filed under a conversation in no server's list is no longer collected by any `connected` edge — its
  retention window widens from "until the next connect" to "until the pairing ends". Accepted, on the
  same terms the header already accepts the bound: ~5 KB per task under the daemon's per-frame caps,
  from a bounded-frame stream, with no observed exhaustion. It is pinned by AC2's orphan test so a
  later widening of the reset is a deliberate change rather than drift, and the new pairing clear is
  what collects those entries. The id set itself is a transient projection of rows
  `conversationListStore` already holds, built once per `connected` and not retained; a hostile relay
  forcing rapid reconnects pays one filter over the held keys per reconnect.
- [Error messages, logs, telemetry] No findings, deliberately, and the bar is higher here than on the
  sibling store: this path emits no log line and must not gain one. The values in hand are a server
  origin and conversation ids — precisely the daemon-adjacent strings `ServerOrigin`'s docblock
  forbids from reaching a log — and the entries being dropped hold a `description` that IS a shell
  command line. `setUpdatedTask`'s existing silent-miss branches document exactly this reasoning for
  the write path; the reset inherits it. Not even a content-free count of what was dropped: this
  path's no-diagnostic property is total and a count is the first crack in it. There is no error class
  here to classify — neither setter can throw.
- [Concurrency] No findings, but one shape needed checking: the id set is resolved from
  `conversationListStore.getState()` **outside** the roster store's `set` updater, which reads as a
  check-then-act across two stores. It is not one — both are written from the same synchronous
  daemon-event dispatch on the renderer's single thread, with no `await` between the resolve and the
  write — and the held-map read is inside the updater, closing the half that otherwise could
  interleave. There is no reset-before-repopulate ordering to reason about at all, unlike the queue's:
  nothing re-sends these frames on connect. Subscription lifecycle is unchanged (one effect, one off
  handle, one live listener under a StrictMode double-mount). The pairing clear introduces no new
  interleaving: a synchronous in-memory write among eleven siblings, unable to throw, so it neither
  needs nor perturbs the constraint that keeps `clearAllLastRead` last — and it carries the
  `size === 0` subscriber short-circuit, so the common case (a pairing change with no roster held)
  wakes no listener.
- [Threat model alignment] Malicious relay — on-path and content-blind, it can force reconnects; under
  this change each forced reconnect clears strictly less than today and leaks no plaintext, so the
  design is better under that threat, though the erasure it can force is longer-lived than the queue's
  for the no-repopulation reason above (#569). Token theft from disk — not on this path; nothing here
  persists. Hostile daemon response — the two OUT OF SCOPE findings above, named and deferred to the
  #1089 family. Renderer compromise reaching the transport — unchanged, no new capability crosses the
  bridge and no secret becomes renderer-reachable.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
