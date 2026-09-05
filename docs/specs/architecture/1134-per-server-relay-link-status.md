# #1134 — the relay-link store's status, keyed by server

## Files read

- `src/renderer/src/store/relayLinkStore.ts` → `RelayLinkState`, `RelayLinkStore`,
  `createRelayLinkStore`, `initialRelayLinkState`, `selectRelayLinkStatus` — the store this ticket
  re-keys. Its header carries the two constraints the design must respect: the single-setter posture
  ("a discriminated-union action set would be a one-member union — ceremony without benefit") and the
  orthogonality argument ("a dedicated store … NOT a `sessionStore` facet"), which is what rules out
  the cheapest key-domain unification below.
- `src/renderer/src/store/relayLinkBridge.ts` → `translateRelayLink`, `subscribeRelayLink`,
  `RelayLinkData` — the store's only writer, and the one place the stamp can be read.
- `src/renderer/src/store/sessionStore.ts` → `StatusOrigin`, `SessionState.statuses`, `withStatus`,
  `selectStatus`, `selectStatusFor` — #1133's merged shape, which this ticket follows: the
  three-case key domain, the `ReadonlyMap` index sitting *beside* an untouched app-wide cell, the
  copy-on-write write helper, and the `select…For` factory that answers `undefined` for a server
  that has reported nothing yet.
- `src/renderer/src/store/daemonEventBridge.ts` → `originOf`, `translateDaemonEvent` — the merged
  renderer-side stamp read, whose docblock states why the subscribe parameter stays typed on the bare
  `DaemonEvent` union rather than widening to `StampedDaemonEvent`.
- `src/main/liveWindow.ts` → `StatusOrigin`, `originOf`, `createLiveWindow`'s `statuses` map —
  #1121's main-side original, the third declaration of the same key domain and the one the
  `shared/` question turns on.
- `src/main/correlationRouter.ts` → the module header's duplicated-`originOf` ruling ("the cost of
  the split is the duplicated `originOf` below; the cost of merging would be one module whose
  docblock has to say …") — the repo's standing answer on when to copy this helper rather than share it.
- `src/shared/ipc/events.ts` → `ServerOrigin`, `WithOrigin`, `StampedDaemonEvent`, and the
  `relayLinkChanged` arm (`{ type: 'relayLinkChanged'; status: RelayLinkStatus }` — no id of its
  own). `ServerOrigin`'s header carries the two rulings this ticket obeys: the id is never a log
  field, and "if a consumer indexes by it, THE INDEX IS A `Map`".
- `src/main/daemonConnection.ts` → the `relay-link-up` / `relay-link-down` arms of `onDriverEvent`,
  which emit `relayLinkChanged` per connection — the reason the single cell is last-writer-wins
  across servers.
- `src/main/connectionRegistry.ts` → the not-paired stand-in, `createConnection({ serverId: null, … })`
  — proof that the present-`null` origin is live on this leg too, not hypothetical.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostConnectionDotsControl` — the sole
  production reader of `selectRelayLinkStatus`, which this ticket leaves untouched, and
  `ChannelList.test.tsx`'s "names both legs from the two stores it reads, with no false green"
  case, which is criterion 3's detector.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `relayLeg` — takes
  `RelayLinkStatus | null`, and it is `null` that maps to "Relay Unknown". That signature is why the
  app-wide read's return type is load-bearing.
- `docs/specs/architecture/1133-per-server-session-status.md` § Open questions — the two questions
  #1133 left behind, the first of which this ticket must answer rather than inherit.
- `docs/knowledge/features/relay-link-store.md` — the store's own overview. Two lessons from it shape
  this plan: "no correlation, no reset" (there is no clear path to teach about the index) and the
  rejected fabricated-fourth-category idea (which is why the not-yet-arrived state stays a sentinel
  rather than becoming a stored value).
- `docs/knowledge/features/live-window.md` § "One slot per server, since #1121" — the prose form of
  the precedent, including why `null` and `undefined` are kept apart.

Codegraph is not initialized in this repo (`codegraph_*` returns a hard "CodeGraph not initialized"
error rather than an empty result), so the reading list above was built with Grep and Read.

## Design source

**Figma:** N/A — this ticket ships no visual change, deliberately. Criterion 3 is that the one
production consumer renders exactly what it renders today; the surface that draws one host row per
server is #1070's AC4. The visual-fidelity check is intentionally skipped.

## Context

`relayLinkStore` holds one `RelayLinkStatus | null` for the whole app. Every `DaemonConnection`
emits its own `relayLinkChanged` from `onDriverEvent`'s `relay-link-up` / `relay-link-down` arms,
and since #1117 the registry holds one connection per paired server — so every server's relay leg
writes that same cell and the last one wins. On a healthy relay socket the next status change is
never, so another server's link can read wrong for the life of the window.

This is the relay half of #1085. The daemon half, #1133, has merged (`ce5a3d3`), and the two legs are
read side by side by the same host row, so this store follows the shape #1133 established rather than
inventing its own: the same three-case key domain, a `Map` index beside an untouched app-wide cell,
and "most recently written" as the app-wide rule.

**No ADR is warranted** — the design calls here are #1121's and #1133's, already recorded in
`docs/knowledge/features/live-window.md`. What the documentation phase may want to record is that the
key domain now exists in *three* declarations (`liveWindow.ts`, `sessionStore.ts`, and this store) and
`originOf` in *five*, and that the `shared/` lift is deferred for the reason in the next section. That
is noted here, not acted on.

## Design

### The key domain — a local `RelayLinkOrigin`, and why the `shared/` lift is deferred

The domain is the same three cases #1121 and #1133 use, kept apart rather than coalesced:

- a **string** — one slot per paired server, the point of the keying;
- a **present `null`** — a producer bound while no paired record was in hand. Live on this leg, not
  hypothetical: `connectionRegistry`'s not-paired stand-in is built with `serverId: null` and is
  dialled like any other, so its relay socket's up/down genuinely arrives stamped `null`;
- **absent** (`undefined`) — a producer that never went through a binding. Unreachable in production,
  reachable from the tests, which emit bare event literals. Filing it keeps the write total.

#1133's first open question — should this type be lifted into `src/shared/` once a third consumer
appears? — is live here, because this ticket **is** the third consumer. The plan answers it: **no
lift, a local declaration.** Three routes were weighed.

1. **Import `StatusOrigin` from `sessionStore.ts`.** Rejected. `relayLinkStore`'s header argues at
   length that this store is deliberately *not* a `sessionStore` facet — the relay leg and the daemon
   leg are orthogonal — and a type import would make the relay leg's key domain a dependent of the
   daemon leg's store module, which is the coupling that header exists to prevent. It also
   deduplicates nothing main-side.
2. **Lift into `src/shared/`, beside `ServerOrigin`.** Rejected *for this ticket*, and the reason is
   worth recording because it is not the consumer count. The lift's whole value is unifying all three
   declarations, and the third lives in `src/main/liveWindow.ts`, which this ticket's Technical Notes
   place out of scope ("Nothing under `src/main/` changes"). A lift that reaches two of three leaves a
   shared type with one unexplained holdout — strictly worse than three honest copies with
   cross-references, because a holdout reads as an oversight rather than as a scope boundary. It also
   costs a third and fourth production file (the shared module plus `sessionStore.ts`'s import) and
   would retire a public export that merged four commits ago. **The blocker is the main-side edit, not
   the third consumer**, so the natural home for the lift is a ticket already touching `src/main/`.
3. **A local declaration.** Taken.

Named `RelayLinkOrigin`, **not** a third `StatusOrigin`. #1070 reads both legs in one component and
would otherwise have to alias one of the two key types on import; and the name says which index it
keys. Its docblock cross-references the other two declarations and records the deferral above, so the
triplication is visible from any of the three.

### State — the index sits BESIDE the existing cell

```ts
interface RelayLinkState {
  status: RelayLinkStatus | null                            // unchanged: most recently written
  statuses: ReadonlyMap<RelayLinkOrigin, RelayLinkStatus>   // new: one slot per origin
}
```

`status` is not re-shaped, and the ticket makes that non-negotiable rather than convenient:
`selectRelayLinkStatus` keeps its current name, signature **and return type**, because `relayLeg`
takes `RelayLinkStatus | null` and it is `null` that maps to "Relay Unknown" (#719). A field nothing
rewrote is the cheapest possible guarantee of criterion 3.

A `Map`, never a bare object — `ServerOrigin`'s header rules it for any consumer that indexes by the
id, since a `__proto__` id would write through `Object.prototype` on a `Record<string, …>`.
`liveWindow.ts`, `sessionStore.ts` and `queueStore.ts` are the three precedents.

`initialRelayLinkState.statuses` is an empty `Map`, so "before any event arrives" needs no special
case: the app-wide cell still starts at `null` and every per-server read starts at "not heard from".

### The setter — one more argument, still the sole write path

```ts
setRelayLinkStatus: (status: RelayLinkStatus, serverId?: string | null) => void
```

Still a single setter, not a reducer: keying does not add a second mutation, so the header's
one-member-union argument stands untouched. The origin is an **optional parameter**, mirroring
#1133's optional `serverId?: string | null` on its four status arms, and the optionality is
load-bearing twice over. It makes the absent case a genuine absent argument, matching the three-case
domain with no sentinel value; and it leaves every existing `setRelayLinkStatus('connected')` call in
this store's own tests compiling and behaving exactly as before, filing under the unstamped slot.

The write lands in both facets in one `set`, so `selectRelayLinkStatus` and
`selectRelayLinkStatusFor(origin)` can never be caught disagreeing about the link that just moved. A
module-local `withSlot(statuses, origin, status)` builds the new index copy-on-write — `new Map(held)`
then `set`, never a mutation of the held map — which is what makes an untouched server's slot come
back *by reference*, so a component watching that server does not re-render when a different one
changes. (The values here are string literals rather than objects, so reference identity is value
identity; the copy-on-write discipline is what keeps the *map* honest.)

`withSlot` returns the map rather than a whole `RelayLinkState`, and the setter stays a **partial**
`set((s) => ({ status, statuses: withSlot(s.statuses, serverId, status) }))` — the shape the existing
`set({ status })` already has. #1133's `withStatus` returns a whole state because `reduceSession` is
an exported pure reducer that must; this store has no reducer, and a whole-state literal here would
be a place a future third field could be silently dropped.

Growth is bounded by the distinct-origin count — one per paired server plus at most the two non-server
keys — and a daemon cannot influence which key its own event carries, so nothing it sends can mint a
slot. Nothing is evicted: a torn-down server's last relay status is `offline` or `daemon-absent`,
which is exactly what a per-server reader should be told.

**There is no reset path to extend.** `relayLinkStore` is deliberately absent from
`clearPairingScopedState` (`src/renderer/src/clearPairingScopedState.ts`) — the daemon re-asserts relay
status unsolicited — so unlike #1133 there is no whole-store clear to teach about the new index.

### Reading the origin — `originOf` in the bridge

`translateRelayLink` keeps its bare-`DaemonEvent` parameter and its current return type, and
`subscribeRelayLink`'s `onDaemonEvent` parameter keeps its bare-union listener type. **Not widened to
`StampedDaemonEvent`**, per the ticket and per what #1133 settled in the same module family:
`ServerOrigin.serverId` is required, so a bare `DaemonEvent` is not assignable to a
`StampedDaemonEvent`, and under `strict: true` widening reddens this ticket's own existing tests —
`relayLinkBridge.test.ts` builds bare `DaemonEvent` literals and a `fakeBridge` typed on the bare
union, which stops being assignable the moment the subscribe parameter widens.

So a module-local `originOf(event: DaemonEvent): RelayLinkOrigin` reads the stamp with the merged
`in`-guard-plus-`typeof` idiom: absent property → `undefined`; `null` → `null`; a string → that
string; anything else → `undefined` (the unstamped slot), which keeps the function total without
throwing. `subscribeRelayLink`'s listener then becomes one line longer:
`if (status !== null) setRelayLinkStatus(status, originOf(event))`.

This is the fifth `originOf` in the tree. Exporting `daemonEventBridge.ts`'s instead was considered
and rejected: it is module-private, it returns `sessionStore`'s `StatusOrigin`, and importing it would
couple two deliberately independent single-arm subscribers *and* drag the relay bridge's key type back
onto the session store — the coupling route 1 above already rejected. `correlationRouter.ts`'s header
records the same call for the same reason.

**The origin is read ONLY from the stamp.** On this arm that is not merely the preferred source, it is
the only one: `relayLinkChanged`'s payload is the closed `RelayLinkStatus` category and nothing else,
so there is no `ack.server_id`-shaped temptation here the way there is on the daemon leg. Criterion 4
is this rule, and it gets its own test anyway — a future edit that reached for a payload field would
have to invent one, and the test is what would catch it.

### The two read surfaces

```ts
selectRelayLinkStatus(s: RelayLinkState): RelayLinkStatus | null            // unchanged — app-wide
selectRelayLinkStatusFor(origin: RelayLinkOrigin): (s: RelayLinkState) => RelayLinkStatus | undefined
```

`selectRelayLinkStatus` is untouched in name, signature and return type, which is what leaves
`HostConnectionDotsControl` — its one production reader — working without an edit. "Most recently
written" is byte-for-byte today's behaviour; a fold ("connected if any server's link is") was
considered and rejected, since it would change what the sidebar's relay dot says in a ticket whose
third criterion is that nothing visible moves.

`selectRelayLinkStatusFor` is the `select…For` factory idiom used eight times in this directory. It
returns `RelayLinkStatus | undefined` and **deliberately does not default**: criterion 2 is precisely
that a caller can tell "not heard from" apart from a link that has reported, and any default would
erase it.

Returning `RelayLinkStatus | null` instead — so a per-server reader could pass the result straight into
`relayLeg` — was considered and rejected. It would preserve the criterion-2 distinction (the map holds
no nulls, so `null` would still uniquely mean "not arrived"), but it costs the symmetry that matters
most to the one consumer this exists for: #1070 reads both legs per row, and
`selectStatusFor(id) → ConnectionStatus | undefined` beside
`selectRelayLinkStatusFor(id) → RelayLinkStatus | undefined` is two identical shapes rather than two
near-identical ones. The `?? null` that #1070 then writes at the `relayLeg` call is one operator, and
it puts the flattening of "not heard from" into "Relay Unknown" in view at the point where it happens
rather than hiding it inside the selector for every future caller.

No whole-map selector ships, for the reason #1133 gives: nothing in the renderer enumerates paired
servers yet (`src/shared/ipc/commands.ts` records that as a shipped fact), so #1070 adds one if it
wants one rather than this ticket shipping an unconsumed read surface.

### What does not change

`HostConnectionDotsControl`, `relayLeg`, `RelayLinkData`'s mount in `App.tsx`, `translateRelayLink`,
the wire, and everything under `src/main/`. Two existing test sites construct a `RelayLinkState`
shape and so must gain the new field — `createRelayLinkStore({ status: 'daemon-absent' })` and the
`initialRelayLinkState` `toEqual` — both in this store's own test file, both mechanical, far inside
the ten-call-site ceiling.

## State + concurrency model

One store slice, one new field, no async work. The store does no I/O, subscribes to nothing and owns
no timer, so there is nothing to cancel and no new teardown path — `RelayLinkData`'s existing
subscribe-on-mount / off-handle-as-cleanup effect is unchanged and stays the only lifecycle here.
Every write is synchronous inside the setter, so there is no check-then-act gap across an `await`.

## Error handling

No new failure modes and no new reject branch. `originOf` is total by construction — every input maps
to one of the three keys, including a value that is neither string nor null, which files under the
unstamped slot rather than throwing. The setter keeps its unconditional-replace contract: the arm
already carries the final classified category (#328 drops the raw relay close code before it crosses
IPC), so there is no validation, no coercion and no invalid transition to reject. Nothing crosses a
trust boundary in this ticket beyond the key derivation itself; the store is pure renderer state.

## Testing strategy

vitest, node environment. Every behaviour here is a pure store write and a pure translation, so
nothing needs a static render beyond the existing `RelayLinkData` server-render sanity case, and
nothing needs Playwright. **No `e2e/` spec:** the ticket ships no visual change, and
`e2e/connection-dot-colours.spec.ts` drives no connection state, so it is not a detector for this
either way. The real regression guard on criterion 3 is `ChannelList.test.tsx`'s "names both legs
from the two stores it reads, with no false green" case, which reads "Relay Unknown" back out of a
static render of the untouched consumer.

`relayLinkStore.test.ts` (new cases alongside the existing ones, which stay green):

- two servers' relay links are independent — a write for A leaves B's slot untouched, across all
  three categories;
- an `offline` for A after a `connected` for B leaves B connected — criterion 1 in the direction that
  would have been wrong before;
- an unwritten origin reads `undefined`, and a written origin reads its category — the two halves of
  criterion 2 in one pair;
- a present-`null` origin and an absent origin are separate slots, and neither is the other;
- the app-wide `status` is the most recently written value after an interleaved two-server sequence,
  and starts at `null` — criterion 3;
- copy-on-write purity: a write for A returns a new map and does not mutate the map the previous
  state held, and B's slot survives by value;
- `initialRelayLinkState` carries an empty index, and two stores stay independent (the existing DI
  cases, extended).

`relayLinkBridge.test.ts` (new cases):

- a stamped `relayLinkChanged` files under its stamp; an unstamped one files under the absent slot; a
  `serverId: null` one files under the null slot;
- two servers' events driven through one real store leave two independent slots and one app-wide
  value — the seam test, extended;
- an event stamped `__proto__` opens its own slot and does not write through `Object.prototype` — the
  `Map`-not-object ruling, asserted rather than assumed;
- criterion 4: the origin comes from the stamp alone. An event carrying a decoy `server_id` property
  beside the stamp files under the **stamp**, and the decoy's id reads `undefined`.

Existing cases that must be updated rather than added: the three `toHaveBeenCalledWith` assertions in
`subscribeRelayLink`'s describe block now observe a second argument. Fakes over mocks throughout —
these are pure functions and isolated stores from `createRelayLinkStore`, so no `vi.mock` and no fake
timers.

## Open questions

1. Should `RelayLinkOrigin` / `StatusOrigin` and `originOf` be lifted into `src/shared/`? **Answered
   above for this ticket** (no — the blocker is the main-side edit, not the consumer count), but the
   question stays live for the first ticket that may touch `src/main/liveWindow.ts`. This plan makes
   the deferral, and its reason, findable from all three declarations.
2. Does #1070 want a whole-map selector, or per-row `selectRelayLinkStatusFor` calls? Left to #1070,
   which knows how it enumerates servers. Adding one now would ship an unconsumed read surface.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX, one SHOULD FIX below. The boundary this ticket touches is the
  untrusted-payload / trusted-stamp split on `DAEMON_EVENT_CHANNEL`, and the design puts the whole of
  it in one named function: `originOf` in `relayLinkBridge.ts` is the only place a key is derived, and
  it derives it only from `serverId`. On this arm the boundary is narrower than on the daemon leg —
  `relayLinkChanged` carries the closed `RelayLinkStatus` category and nothing else, so there is no
  daemon-supplied id on the event at all and no `ack.server_id`-shaped alternative source to reject.
  A hostile daemon on server A can flap A's own relay status (it can already make its own link look
  down) and cannot reach B's slot: the stamp is fixed per connection at construction from a
  client-held paired record, and A's driver events only ever reach A's sink. **The `null` slot is
  shared by construction** — every producer bound with no paired record in hand files there — and that
  is deliberate, not a collision bug: it is the honest-unknown bucket, `connectionRegistry` builds at
  most one such stand-in at a time (only while nothing is paired), and no per-server row can address
  it, since a row exists per paired server, i.e. per string id. Nothing branches security-relevant
  behaviour on the key, which upholds `ServerOrigin`'s "it is a REPORT, not a control input" ruling.
- **[Trust boundaries — SHOULD FIX]** The *read* side has a provenance requirement the plan states but
  the type system cannot: `selectRelayLinkStatusFor(origin)` must be called with an id from the
  client's own paired-server list, never with one taken from a daemon-supplied field. Nothing in this
  ticket can violate it (there is no caller yet), but #1070 is the consumer and a wire-sourced lookup
  key would let a hostile daemon make one host row display another's relay state — the read-side twin
  of the write-side attack criterion 4 closes. Phase B lands this as a docblock line on the selector,
  so #1070 inherits it at the point of use rather than having to find this document. Not a gate: it is
  a comment on a function with no production callers.
- **[Tokens, secrets, credentials]** No findings, structurally rather than by care. `serverId` is a
  non-secret routing id — one of the two safe `PairedServerRecord` fields — and this path is handed a
  `string | null` scalar, never a record, so `token` and `server_static_pubkey` are unreachable from
  it. The ticket adds no storage, so there is no token lifecycle, rotation, revocation or expiry
  surface to address. The held value is a three-member display category, not a credential.
- **[File / storage operations]** Not applicable by design decision: the store writes nothing to disk,
  reads no path, and touches no web storage (no `localStorage`, no `sessionStorage`, no IndexedDB —
  a renderer store is exactly where that temptation would live, and it is not taken). The key is used
  as a `Map` key and for nothing else: never a filename, never a cache path, never a lookup into
  anything but this map. That restriction is `ServerOrigin`'s standing ruling and this design does not
  widen it. No path traversal, TOCTOU or atomic-write question arises because there is no file.
- **[Inter-process / Electron attack surface]** No findings. No `contextBridge` API, no `ipcMain`
  channel and no `webPreferences` are added or changed; the ticket consumes an existing subscription
  through the existing preload bridge, and `RelayLinkData`'s listener count and cleanup are unchanged
  (one subscribe, the off handle as the effect cleanup). The setter's new parameter does not widen
  renderer capability: `relayLinkStore.getState().setRelayLinkStatus` was already reachable from any
  renderer module, and a compromised renderer that could write this store could already write the
  single cell it replaces — neither reaches keys, the token, or the socket, which stay in main.
- **[Cryptographic primitives]** Not applicable, and the absence of a constant-time compare is correct
  rather than an oversight: no randomness is generated, nothing is hashed, and no value is compared
  against a secret. `Map` key lookup is `SameValueZero` on a non-secret routing id, so
  `timingSafeEqual` has nothing to guard here. No Noise, key-schedule or AEAD code is touched — the
  handshake stays where it is, in main.
- **[Network & I/O]** Not applicable: no socket is opened, no URL is constructed, no fetch is made and
  no frame is parsed. The ticket reads one already-decoded, already-classified field off an
  already-typed event; `daemonConnection`'s `relay-link-down` arm remains the single classification
  choke point and still drops the raw close code before it crosses IPC. `maxPayload`, TLS, timeout and
  backoff discipline all live upstream in the transport and are unchanged.
- **[Error messages, logs, telemetry]** No findings, and this is the category that produced #1133's
  closest call, so it was walked rather than assumed. Neither `relayLinkStore.ts` nor
  `relayLinkBridge.ts` imports a logger today and this ticket adds no log call, so `ServerOrigin`'s
  "the id is never a log field" ruling holds structurally here. Unlike `sessionStore`, this store has
  **no `TransitionObserver` seam at all** — `createRelayLinkStore` takes no observer and there is no
  `relayLinkDiagnostics` module — so a state-shape change reaches no diagnostics record and no
  `sendDiagnostic` call, and no count of paired servers can leak that way. The store is created from
  `zustand/vanilla`'s `createStore` with no middleware, so there is no devtools serialisation path
  either. No error message is produced: the write is unconditional and total, so there is nothing to
  phrase and nothing to leak in phrasing it.
- **[Concurrency]** No findings. Nothing async is added: no promise, no timer, no new listener, no
  `AbortController` — so there is no cancellation path to define and no new leak surface. Every write
  is a synchronous statement inside the setter, so there is no check-then-act gap across an `await`
  and no shared-state race; shutdown is unchanged because the store owns no resource. Two growth
  questions were pushed on rather than waved at. **Slot growth** is bounded by the key domain, not by
  a cap: `originOf` can only answer `undefined`, `null`, or the stamp, and the stamp comes from
  `bindServerOrigin` once per connection, so cardinality is at most the paired-server count plus the
  two non-server keys, and minting a new slot requires an operator-driven pairing — a daemon cannot do
  it, and a non-string, non-null `serverId` files under the existing unstamped slot rather than
  opening one. No eviction policy is therefore needed, and keeping a torn-down server's last status is
  the intended behaviour. **Per-event cost** rises from O(1) to O(n) for the map copy, where n is that
  same tiny bound; a hostile relay that accept-then-closes in a loop already drives one state write and
  one re-render per transition today and is rate-bounded by the supervisor's existing backoff, so this
  is a constant-factor change to a pre-existing, already-bounded path, not a new exhaustion vector.
- **[Threat model alignment]** **Malicious relay** — on-path and content-blind; it can drop, delay,
  reorder or flood, which surfaces here as relay-link flapping for the one connection it is on path
  for. It cannot forge a stamp, which is applied main-side after decode from a client-held record, so a
  flap on server A's relay cannot move server B's slot — which is precisely the property this ticket
  ships. **Hostile daemon response** — addressed above: the only daemon-derived value on this arm is
  the classified category, and there is no payload id to mis-source the key from; the decoy-property
  test asserts that a future edit cannot start. **Renderer compromise reaching the transport** —
  unchanged, no capability added. **Token theft from disk** — out of scope, no storage added;
  `secure-store` owns it. One prototype-pollution vector is specific to this change and is closed by
  construction: a `__proto__` or `constructor` id would write through `Object.prototype` on a bare
  object index, so the index is a `Map`, per `ServerOrigin`'s ruling, and a test asserts it rather
  than trusting it.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
