# #1133 — the session store's connection status, keyed by server

## Files read

- `src/renderer/src/store/sessionStore.ts` → `SessionState`, `SessionAction`, `reduceSession`,
  `initialSessionState`, `selectStatus` — the store this ticket re-keys. Note `reduceSession`'s
  documented purity ("input state and its `messages` array are never mutated") and `reset`'s
  return-the-shared-const identity, both of which constrain how the new index may be written.
- `src/renderer/src/store/daemonEventBridge.ts` → `translateDaemonEvent`, `useDaemonEventBridge` —
  the only writer into the store, and the one place the stamp can be read.
- `src/main/liveWindow.ts` → `StatusOrigin`, `originOf`, `createLiveWindow`'s `statuses` map — the
  #1121 precedent this ticket mirrors: the three-key domain, the `Map`-not-object ruling, and the
  read-the-origin-only-from-the-stamp rule, all written out there in full.
- `src/shared/ipc/events.ts` → `ServerOrigin`, `WithOrigin`, `StampedDaemonEvent` — the stamp's
  contract. Its header carries the two rulings this ticket must obey: the id is never a log field,
  and "if a consumer indexes by it, THE INDEX IS A `Map`".
- `src/preload/index.ts` → `onDaemonEvent` — typed on `StampedDaemonEvent`, so the stamp is
  statically present at the subscription and only goes silent at `translateDaemonEvent`'s
  bare-union parameter.
- `src/renderer/src/store/queueStore.ts` → `selectBacklogFor`, `selectBacklogs`, `QueueState.backlogs`
  — the repo's existing `ReadonlyMap` + `select…For` factory idiom, including the narrow-slice
  re-render argument this ticket reuses. Also `selectRosterFor`, `selectActivityFor`,
  `selectTimelineFor`, `selectBatchFor`, `selectModelListFor`: the same shape, six more times.
- `src/renderer/src/store/sessionDiagnostics.ts` → `toDiagnosticRecord`, `logSessionTransition` —
  the observer a `SessionState` shape change reaches. It reads `action.type` and
  `state.messages.length` and nothing else, which is what keeps the id out of the diagnostics record.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostConnectionDotsControl` — the fifth
  `selectStatus` consumer, and the one whose store binding is covered by e2e only.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the three `selectStatus` readers
  (the composer status row, the connection banner container, the repair control).
- `src/renderer/src/store/conversationListBridge.ts` → the `s.status.type === 'connected'` gate —
  the one raw-field production reader.
- `docs/knowledge/features/live-window.md` § "One slot per server, since #1121" — the prose form of
  the precedent, including why `null` and `undefined` are kept apart.
- `docs/knowledge/features/session-store.md` — the store's own overview; its orthogonality and
  purity invariants are the ones the new facet must not break.
- `docs/knowledge/features/daemon-event-bridge.md` § "1. The pure translation" — why
  `translateDaemonEvent` is a pure choke point and stays one.

Codegraph is not initialized in this repo (`codegraph_*` returns a hard "CodeGraph not initialized"
error), so the reading list above was built with Grep and Read.

## Design source

**Figma:** N/A — this ticket ships no visual change, deliberately. Its acceptance criterion 3 is that
nothing visible moves; the consumer that draws one host row per server is #1070's AC4. The
visual-fidelity check is intentionally skipped.

## Context

`sessionStore` holds one `ConnectionStatus` for the whole app, written by every connection's status
events, last writer wins. Since #1117 the connection registry holds one `DaemonConnection` per paired
server and each dials independently, so that single cell reports whichever connection changed most
recently and nothing about the others. On a healthy connection the next status change is never, so
another server's leg can stay wrong for the life of the window.

#1068 shipped the missing ingredient: every event on `DAEMON_EVENT_CHANNEL` is a
`StampedDaemonEvent` carrying `serverId` beside the union. #1121 already solved exactly this problem
main-side for the reopened-window status cache. This ticket applies the same shape renderer-side.

No ADR is warranted: the design decisions here are #1121's, already recorded in
`docs/knowledge/features/live-window.md`, and this ticket is their second application rather than a
new call. What the documentation phase may want to record is the *duplication* — `StatusOrigin` and
`originOf` now exist twice, once under `src/main/` and once under `src/renderer/`, because the
renderer may not import from main and neither copy belongs in `src/shared/ipc/` without a third
consumer to justify the move. That is noted here, not acted on.

## Design

### The key domain — `StatusOrigin`, three cases

A renderer-local `StatusOrigin = string | null | undefined`, mirroring `liveWindow.ts`'s type of the
same name member for member, and for the same reasons:

- a **string** — one slot per paired server, the point of the widening;
- a **present `null`** — a producer bound while holding no paired record. Live, not hypothetical:
  `connectionRegistry`'s not-paired stand-in is built with `serverId: null` and is dialled like any
  other, so its `failed(not-paired)` genuinely arrives;
- **absent** (`undefined`) — a producer that never went through a binding. Unreachable in production,
  reachable from the tests, which dispatch bare literals. Recording it keeps the reducer total.

`null` and `undefined` stay distinct rather than coalesced, because that is the one place
`ServerOrigin`'s present-null-vs-absent-property distinction is observable in a running consumer.

The type is declared in `sessionStore.ts` rather than shared with main's copy: `src/renderer/` may
not import from `src/main/`, and lifting it to `src/shared/` would edit a third file and drag
`liveWindow.ts` into a ticket whose Technical Notes say nothing under `src/main/` changes.

### State — the index sits BESIDE the existing cell

```ts
interface SessionState {
  status: ConnectionStatus                                 // unchanged: most recently written
  statuses: ReadonlyMap<StatusOrigin, ConnectionStatus>    // new: one slot per origin
  messages: readonly MessagePayload[]                      // unchanged
}
```

`status` is not re-shaped, and that is the sizing-decisive constraint the ticket states rather than
suggests: ~21 existing assertions across three test files read it raw. Keeping it as the
most-recently-written cell leaves all of them green, holds the change to two production files, and is
the cheapest possible guarantee of criterion 3 — a field nothing rewrote cannot render differently.

A `Map`, never a bare object: `ServerOrigin`'s header rules it for any consumer that indexes by the
id, since a `__proto__` id would write through `Object.prototype` on a `Record<string, …>`.
`liveWindow.ts`'s `statuses` and `queueStore.ts`'s `backlogs` are the two precedents.

`initialSessionState.statuses` is an empty `Map`, so criterion 3's "including before any event
arrives" holds by construction: `status` still starts at `{ type: 'disconnected' }` and every
per-server read starts at "not heard from".

### Actions — the origin rides the four status arms, optionally

The four status arms gain `serverId?: string | null`. Optional, not required, and that is load-bearing
twice over: it makes the absent case a genuine absent property (matching the three-key domain exactly,
with no sentinel), and it keeps every existing `dispatch({ type: 'connecting' })` in the tests and in
`clearPairingScopedState` compiling untouched.

`messages` actions and `reset` are unchanged. Per the ticket, `messages` stays one unkeyed list and
`reset` keeps its whole-store scope.

The alternative — a second `dispatch(action, origin)` parameter — was rejected: it would put the
origin outside the sealed action union, change `TransitionObserver`'s contract, and give
`reduceSession` a shape other than `(state, action) => state`.

### The reducer

Each of the four status arms builds its `ConnectionStatus` once and writes it to both places: the
`status` field and the slot named by `action.serverId`. The same object reference lands in both, so
`selectStatus(s)` and `selectStatusFor(origin)(s)` are reference-identical for the most recent writer.

A module-local `withStatus(existing, origin, status): ReadonlyMap<StatusOrigin, ConnectionStatus>`
does the write copy-on-write — `new Map(existing)` then `set` — so `reduceSession`'s documented purity
holds: the input state's map is never mutated. Growth is bounded by the distinct-origin count (one per
paired server plus at most the two non-server keys), so nothing a daemon sends can mint a slot, and
nothing is evicted — a torn-down server's last status is `failed` or `disconnected`, which is what a
per-server reader should be told.

`reset` keeps returning `initialSessionState` by reference, clearing the index along with the other
two facets. Returning the shared const rather than a fresh object is required by
`sessionStore.test.ts`'s `expect(next).toBe(initialSessionState)` and by the by-reference identity
`clearPairingScopedState.ts` documents.

### Reading the origin — `originOf` in the bridge

`translateDaemonEvent` keeps its bare-`DaemonEvent` parameter. 51 existing calls pass bare event
literals; re-declaring the parameter as `StampedDaemonEvent` fails all of them to typecheck, and would
compile at the sink only through method-parameter bivariance — sound-looking and unsound. This is the
same hole `liveWindow.ts`'s `originOf` documents: at a bare-union-typed parameter the stamp arrives
structurally while the type stays silent.

So a module-local `originOf(event: DaemonEvent): StatusOrigin` reads it with the same
`in`-guard-plus-`typeof` idiom: absent property → `undefined`; `null` → `null`; a string → that
string; anything else → `undefined` (the unstamped slot), which keeps the function total without
throwing. The four status cases then carry `serverId: originOf(event)` onto the action they already
return; every other case is untouched.

**The origin is read ONLY from the stamp, NEVER from a payload field** — in particular never from
`connected`'s `ack.server_id`, which is a distinct, daemon-supplied value. The stamp is bound
main-side at construction from a client-held paired record, so a hostile or confused daemon cannot
make its events claim another server's slot; a wire-sourced id would hand it exactly that. Criterion 4
is this rule, and it gets its own test.

### The two read surfaces

```ts
selectStatus(s: SessionState): ConnectionStatus                      // unchanged — app-wide
selectStatusFor(origin: StatusOrigin): (s: SessionState) => ConnectionStatus | undefined
```

`selectStatus` keeps its current name, signature and return type, which is what leaves all five
consumers — `ConversationScreen`'s three readers, `ChannelList`'s `HostConnectionDotsControl`, and
`composerSend`'s plain-argument taker — working untouched. "Most recently written" is byte-for-byte
today's behaviour; a fold ("connected if any server is") was considered and rejected, since it would
change what the banner says in a ticket whose third criterion is that nothing visible moves.

`selectStatusFor` is the `select…For` factory idiom already used seven times in this directory. It
returns `ConnectionStatus | undefined` and **deliberately does not default** the way
`selectBacklogFor` defaults to an empty array: criterion 2 is precisely that a caller can tell "not
heard from" apart from "disconnected", and a `{ type: 'disconnected' }` default would erase it.

Narrow-slice correctness comes free from the copy-on-write map: a status write for server A produces a
new map, but `newMap.get(B)` returns the *same* `ConnectionStatus` reference, so `Object.is` holds and
a component watching B does not re-render. That is criterion 1 expressed as a render property.

No whole-map selector ships. `queueStore` has one because #197 iterates all backlogs; nothing
enumerates paired servers in the renderer yet (`commands.ts` and `connectionRegistry.ts` both record
that as a shipped fact, naming #1070/#1085/#1086 as the tickets that change it), so #1070 adds one if
it wants one.

### What does not change

`conversationListBridge`'s `s.status.type === 'connected'` gate keeps working as written under the
beside-not-instead-of constraint. The ticket calls moving it to `selectStatus` optional hygiene; this
plan does **not** take it, keeping the change to two production files and the diff to what the four
criteria need. `sessionDiagnostics` is untouched: `toDiagnosticRecord` reads `action.type` and
`state.messages.length` only, so the new field reaches it and the id does not — which is what
`ServerOrigin`'s "never a log field" ruling requires.

Two existing test files construct a `SessionState` object literal and so must gain the new field:
`sessionStore.test.ts`'s purity fixture and `sessionDiagnostics.test.ts`'s `stateWith` helper. Two
sites, both mechanical, both far inside the ten-call-site ceiling.

## State + concurrency model

One store slice, one new field, no async work. The store does no I/O, subscribes to nothing and owns
no timer, so there is nothing to cancel and no new teardown path — `useDaemonEventBridge`'s existing
subscribe-on-mount / unsubscribe-on-unmount effect is unchanged and stays the only lifecycle here.
Every write is synchronous inside `dispatch`, so there is no check-then-act gap across an `await`.

## Error handling

No new failure modes and no new reject branch. `originOf` is total by construction — every input maps
to one of the three keys, including a value that is neither string nor null, which files under the
unstamped slot rather than throwing. The reducer keeps its unconditional-set contract: each status
action writes its slot regardless of what was there, ordering being the caller's responsibility, so
there is no invalid transition to reject. Nothing crosses a trust boundary in this ticket; the store
is pure renderer state.

## Testing strategy

vitest, node environment, no rendering — every behaviour here is pure reducer and pure translation, so
nothing needs a static render and nothing needs Playwright. No `e2e/` spec: the ticket ships no visual
change, and the existing `connection-dot-colours.spec.ts` / `host-label-sidebar.spec.ts` are the
regression guard on `ChannelList`'s untouched store binding.

`sessionStore.test.ts` (new cases alongside the existing ones):

- two servers' statuses are independent — a write for A leaves B's slot untouched, across
  connecting / disconnected / failed / connected;
- a `connected` for A after a `failed` for B leaves B failed (criterion 1's "leaves the other
  untouched" in the direction that would have been wrong before);
- an unwritten origin reads `undefined`, and a written-then-`disconnected` origin reads
  `{ type: 'disconnected' }` — the two halves of criterion 2 in one assertion pair;
- a present-`null` origin and an absent origin are separate slots;
- the app-wide `status` field is the most recently written value after an interleaved two-server
  sequence, and `selectStatus` returns it by reference (criterion 3);
- purity — the input state's map is not mutated by a status write, and a message action leaves
  `statuses` identical by reference (orthogonality, matching the existing `messages` case);
- `reset` empties the index and still returns `initialSessionState` by reference;
- `selectStatusFor` returns the slot for a known origin and `undefined` for an unknown one.

`daemonEventBridge.test.ts` (new cases):

- a stamped status event files under its stamp; an unstamped one files under the absent slot; a
  `serverId: null` one files under the null slot;
- a `connected` event stamped `srv-A` whose `ack.server_id` is `srv-B` files under `srv-A`, and
  `srv-B` reads `undefined` — criterion 4, and the one test that would catch a payload-sourced key;
- two servers' events dispatched into one store leave two independent slots and one app-wide value;
- an event stamped `__proto__` opens its own slot and does not write through `Object.prototype` —
  the `Map`-not-object ruling, asserted rather than assumed.

Fakes over mocks throughout: these are pure functions and isolated stores from `createSessionStore`,
so no `vi.mock` and no fake timers are needed.

## Open questions

1. Should `StatusOrigin` and `originOf` be lifted into `src/shared/` once a third consumer appears?
   Not resolved here — two copies with a cross-reference is the cheaper answer at two consumers, and
   the move would edit `src/main/`, which this ticket's Technical Notes exclude.
2. Does #1070 need a whole-map selector, or per-row `selectStatusFor` calls? Left to #1070, which
   knows how it enumerates servers. Adding one now would ship an unconsumed read surface.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The one boundary this ticket touches is the untrusted-payload /
  trusted-stamp split on `DAEMON_EVENT_CHANNEL`, and the design puts it in a single named function:
  `originOf` in `daemonEventBridge.ts` is the only place a key is derived, and it derives it only from
  `serverId`. The concrete threat is real and named in criterion 4: `connected` carries a
  daemon-supplied `ack.server_id`, so a hostile or confused daemon that could get its status filed
  under another server's key would overwrite that server's slot and make a down machine read as up
  (or an up one as down) in #1070's sidebar. The stamp is bound main-side at construction from a
  client-held paired record and cannot be influenced from the wire, which is why it is the only
  admissible source. This is asserted, not merely documented: the mismatched-ack test above fails if a
  future edit reaches for the payload. No other data crosses a boundary here — the store is pure
  renderer state with no IPC, no disk and no socket.
- **[Tokens, secrets, credentials]** No findings, structurally rather than by care. `serverId` is a
  non-secret routing id — one of the two safe `PairedServerRecord` fields — and `ServerOrigin`'s
  header records that `token` and `server_static_pubkey` are unreachable from this path, which is
  handed a `string | null` scalar and never a record. This ticket adds no storage, so there is no
  token lifecycle, rotation or revocation surface to address.
- **[File / storage operations]** Not applicable by design decision: the store writes nothing to
  disk, reads no path, and touches no web storage. The key is used as a `Map` key and for nothing
  else — never a filename, never a cache path, never a lookup into anything but this `Map`. That
  restriction is `ServerOrigin`'s standing ruling and this design does not widen it.
- **[Inter-process / Electron attack surface]** No findings. No `contextBridge` API, no
  `ipcMain` channel and no `webPreferences` are added or changed; the ticket consumes an existing
  subscription through the existing preload bridge. `useDaemonEventBridge`'s listener is unchanged.
- **[Cryptographic primitives]** Not applicable: no randomness, no hashing, no comparison against a
  secret. `Map` key equality is `SameValueZero` on a routing id, not a secret compare, so
  `timingSafeEqual` has nothing to guard here.
- **[Network & I/O]** Not applicable: no socket, no fetch, no URL is constructed. The ticket adds no
  parsing of daemon bytes — it reads one already-decoded field off an already-typed event.
- **[Error messages, logs, telemetry]** No findings, and this was the category most likely to hide
  one, because a `SessionState` shape change reaches the diagnostics observer. `toDiagnosticRecord`
  emits exactly `{ event, code: action.type, count: state.messages.length }`; the new `serverId` is on
  the action but is never read there, and the new `statuses` field is never read there either, so no
  id and no count of paired servers reaches `sendDiagnostic`. That upholds `ServerOrigin`'s "the id is
  never a log field" ruling, and the main-side `projectDiagnosticEvent` re-validates the same
  guarantee at the untrusted boundary — different fabric, per the standing belt-and-suspenders rule.
  The plan explicitly does not change what the observer emits. The one live risk is a future edit
  widening the record to include `action.serverId`; the existing `sessionDiagnostics.test.ts` shape
  assertions (`toEqual` on the whole three-field record) redden if that happens.
- **[Concurrency]** No findings. Nothing async is added: no promise, no timer, no listener, no
  `AbortController` — so there is no cancellation path to define and no new leak surface. Every write
  is a synchronous statement inside `dispatch`, so there is no check-then-act gap across an `await`
  and no shared-state race. The one growth question — an unbounded index — is answered by the key
  domain rather than by a cap: slots are minted only by origins, one per paired server plus at most
  the two non-server keys, and a daemon cannot influence which key its event carries (see Trust
  boundaries). So no eviction policy is needed and no memory-exhaustion vector exists.
- **[Threat model alignment]** The applicable desktop threat is **hostile daemon response**, and it
  is addressed above: the only daemon-supplied candidate key (`ack.server_id`) is explicitly rejected
  in favour of the client-bound stamp, with a test. **Malicious relay** is unaffected — the relay is
  on-path outside the Noise session and cannot forge a stamp, which is applied after decode, in main.
  **Renderer compromise reaching the transport** is unchanged: this ticket adds no capability to the
  renderer, and a compromised renderer that could write this store could already write the single cell
  it replaces. **Token theft from disk** is out of scope — no storage is added; `secure-store` owns it.
  One prototype-pollution vector is specific to this change and is closed by construction: a
  `__proto__` or `constructor` id would write through `Object.prototype` on a bare object index, so
  the index is a `Map`, per `ServerOrigin`'s ruling, and a test asserts it rather than trusting it.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
