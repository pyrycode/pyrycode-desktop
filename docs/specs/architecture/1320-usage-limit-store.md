# #1320 — hold the per-conversation usage-limit reading, with its clear and expiry

## Files read

- `src/shared/ipc/events.ts` → the `rateLimited` arm of `BaseDaemonEvent` — the four fields that cross
  (`conversationId`, `status`, `limitType`, `resetsAt`), and the arm contract this store inherits: both
  strings are open and held verbatim, `resetsAt` is never a scheduling input, `0` means "claude did not
  report one" and not the epoch, nothing on the path reaches a log.
- `src/shared/wire/types.ts` → `RateLimitedPayload` — where "a frame is not proof that anything was
  blocked" is argued, and the one measured non-benign value (`allowed_warning`, `limit_type: seven_day`,
  2026-08-22, claude 2.1.239, every turn still running). It is why this slice's module is named for the
  usage-limit *reading* rather than for being rate limited.
- `src/main/transport/inboundMessage.ts` → `parseRateLimitedPayload` and `requireNumber` — the decode
  contract. `requireNumber` tests `typeof value !== 'number'` only, so it admits `NaN` and `Infinity` in
  principle; neither is expressible in JSON, so neither reaches this store through the wire. That
  reachability argument is why the selector below carries no finiteness guard.
- `src/renderer/src/store/announcedModelStore.ts` → `createAnnouncedModelStore`,
  `selectAnnouncedModelFor`, `initialAnnouncedModelState` — the store shape this one adopts verbatim:
  DI factory → singleton → hook → selector factory, `ReadonlyMap` mandated and `Record` forbidden,
  copy-on-write, the clear returning the exported initial state by reference.
- `src/renderer/src/store/announcedModelBridge.ts` → `translateModelAnnounced`,
  `subscribeAnnouncedModel`, `AnnouncedModelData` — the independent-subscriber posture, the fresh
  named-field literal in the translate step, and the effect-cleanup-is-the-off-handle idiom.
- `src/renderer/src/store/modelListStore.ts` → `clearAllModelLists` — the nullary whole-map clear with
  its `size === 0` subscriber short-circuit guard, which `clearAllUsageLimits` copies.
- `src/renderer/src/store/conversationActivityStore.ts` → `dropConversation` — the per-key delete
  idiom: clone the outer map, delete on the clone, and return the state OBJECT on an absent key so no
  subscriber wakes. `clearUsageLimitFor` is this shape.
- `src/renderer/src/store/lastEffortStore.ts` → the ticket's second named shape precedent. Read and
  then set aside: it is a persisted client preference behind a storage port, and nothing here persists.
- `src/renderer/src/clearPairingScopedState.ts` → `ClearPairingScopedStateDeps` and
  `clearPairingScopedState` — the enumeration this slice becomes the fifteenth member of, its
  membership discriminator, and the one ordering constraint (`clearAllLastRead` runs last).
- `src/renderer/src/clearPairingScopedState.test.ts` → the sorted-key pin that fails until a new member
  is both declared and asserted called.
- `src/renderer/src/PairedShell.tsx` → `clearPairingDeps` — the module-scope dep object the new member
  is wired into.
- `src/renderer/src/App.tsx` → the thirteen headless `…Data` leaves and the numbered comment block above
  them; this slice adds the fourteenth.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`'s `rateLimited` no-op, marked
  DORMANT pending this ticket's routing decision. The other three exhaustive bridges
  (`daemonEventBridge`, `modalBridge`, `questionBridge`) already say PERMANENT, so exactly one comment
  flips.
- `docs/knowledge/features/announced-model-store.md` → the package overview for the nearest analogue;
  the source of the absent-key-vs-degenerate-value contract restated below.

## Design source

**Figma:** N/A — nothing renders in this slice. The store and its bridge are headless; #1321 draws the
reading in the composer status row and owns the visual-fidelity check.

## Context

#1318 decodes the daemon's `rate_limited` frame; #1319 carries it to the window as a dormant
`rateLimited` daemon event that all four exhaustive bridges no-op. Nothing holds it. This slice claims it
into a per-conversation store plus a dedicated bridge, so #1321 can draw the reading without re-deriving
when it expires.

**Not on the thread-timeline record.** A usage-limit window is conversation-scoped, not turn-scoped: it
outlives a turn end, a `/clear` and a session transition. State a turn rebuilds would drop it at the
wrong moment and cost every reducer arm a field to carry. So this is the `announcedModelStore` shape — a
store beside a bridge, keyed by conversation id — and `timelineBridge`'s `rateLimited` no-op becomes
PERMANENT.

**The underlying limit is account-wide, and this slice keeps the daemon's scoping.** The frame names
whichever conversation observed the window, so one conversation can carry a reading while its siblings
show nothing. There is no fan-out.

No ADR is warranted: every decision here is an application of a settled family pattern, and the two that
are genuinely new (the expiry rule and the content-driven clear) are argued against the wire contract
rather than against a new principle.

### Sizing — three boundary lines exceeded, stated rather than split

| Line | Boundary | This ticket |
|---|---|---|
| Production source files | ≤ 5 | 6 |
| Total written work | ≤ 800 | ~1000 |
| New exported types, interfaces, components or stores | ≤ 5 | 6 |

The refiner stated the first two on the ticket. The third it did not, and it is inherited rather than
chosen: `announcedModelStore` exports the same six shapes (record, write unit, state, store type,
singleton, data component), and three of them are structurally mandatory for any keyed zustand store in
this repo.

Split depth is one (parent #1236, no grandparent), so a split is permitted by the depth rule. It is
declined because **no split relieves any of the three lines**:

- **store | bridge** is forbidden by the one-consumer floor — the store's only consumer is the bridge.
- **(store + bridge + mount) | (clear)** is the only other seam, the #588 → #593 precedent. It leaves
  the parent at 4 files, ~900 lines and the same 6 exported shapes, so two of the three lines still
  trip; and it splits AC4 across two tickets, where the parent would ship "the entry survives a
  reconnect" with the absence of the pairing drop indistinguishable from a defect.

Per the floor-over-ceiling rule the overage is stated here and the work proceeds. `needs-human:sizing`
is not applied: this is not the depth-capped case, and the sizing call is made and argued rather than
deferred.

### Naming

The wire frame is `rate_limited` and the event arm is `rateLimited`, but the modules are
`usageLimitStore` / `usageLimitBridge`, and the held type is `UsageLimitReading`.

The family convention is to name a store after its event arm (`modelAnnounced` → `announcedModelStore`,
`modelList` → `modelListStore`). It is broken here deliberately, because the arm's own docblock names
"you are rate limited" as THE realistic client bug: the one measured non-benign status is a warning band
in which every turn ran normally. A module called `rateLimitStore` would nudge every later reader —
including #1321, which writes the copy — toward the overclaim the wire spends four paragraphs warning
against. The ticket's own vocabulary is "usage-limit reading" throughout, and that is what the modules
are called. Grep discoverability is preserved: the bridge's translate step names the `rateLimited` arm,
and both module headers cite the frame.

## Design

### The store — `src/renderer/src/store/usageLimitStore.ts`

```ts
export interface UsageLimitReading {
  status: string      // claude-authored, open, held verbatim; a lookup key for client-owned copy only
  limitType: string   // same tier and same contract
  resetsAt: number    // unix SECONDS, claude's number; 0 = claude reported no reset, NOT the epoch
}
export interface UsageLimitSnapshot extends UsageLimitReading { conversationId: string }
export interface UsageLimitState { readings: ReadonlyMap<string, UsageLimitReading> }
export type UsageLimitStore = UsageLimitState & {
  setUsageLimit: (snapshot: UsageLimitSnapshot) => void
  clearUsageLimitFor: (conversationId: string) => void
  clearAllUsageLimits: () => void
}
export const initialUsageLimitState: UsageLimitState
export function createUsageLimitStore(init?: UsageLimitState): StoreApi<UsageLimitStore>
export const usageLimitStore: StoreApi<UsageLimitStore>
export function useUsageLimitStore<T>(selector: (s: UsageLimitStore) => T): T
export const selectUsageLimitFor: (
  conversationId: string,
  nowSeconds: number
) => (s: UsageLimitState) => UsageLimitReading | null
```

`conversationId` stays OFF `UsageLimitReading` and rides only on the write unit, the family's rule: the
key stops at the map key and never reaches the object a reader holds and #1321 renders from.
`UsageLimitSnapshot extends UsageLimitReading` so a field added later lands on both by construction.

`ReadonlyMap` is mandated and `Record<string, …>` forbidden, on `conversationActivityStore`'s rule:
`Map.prototype.get('__proto__')` performs no prototype-chain lookup and `set` creates an ordinary own
entry, so AC5's three hostile ids are unremarkable keys by construction rather than by validation.

Three named setters rather than a reducer. Each is a whole-key or whole-map write; none is a state
machine arm, and there are no reject branches at all.

- **`setUsageLimit`** — copy-on-write: clone the outer map, set the one key from a fresh named-field
  literal, return a fresh state. Unconditional; no dedup of a verbatim repeat, because the arm is not
  deduped upstream and a repeat is the signal that the reading is still current. A write for one
  conversation leaves every other record `Object.is`-identical.
- **`clearUsageLimitFor`** — the `dropConversation` shape: `has` guard, then clone-and-delete. The guard
  returns the state OBJECT, so a clear for a conversation holding nothing wakes no subscriber. It never
  branches on held content.
- **`clearAllUsageLimits`** — nullary, the `clearAllModelLists` shape verbatim: `size === 0` guard for
  the subscriber short-circuit, otherwise `initialUsageLimitState` returned BY REFERENCE. That return is
  what makes the copy-on-write above load-bearing rather than stylistic — the constant is module-shared,
  so an in-place mutation anywhere would poison it and hand one pairing's readings to the next with no
  type error. Pinned by a test.

**Absence lives in the map's keyspace.** A key absent is the distinct "no reading has arrived for this
conversation" state. A present `{ status: '', limitType: '', resetsAt: 0 }` is a real, degenerate reading
held verbatim and never collapsed to absence — the `sessionIdStore` `null`-vs-`''` contract, reused here
as `announcedModelStore` reuses it. Reachable rather than hypothetical: the daemon's producer emits on
any non-empty status, but #1318 declined a second client-side narrowing, so a non-conforming or hostile
daemon can deliver one.

**Growth**, stated rather than defended: one entry per distinct `conversationId` seen since launch, each
holding one three-field record. Both halves are bounded per frame — `MAX_PLAINTEXT_BYTES` caps the
decrypted envelope before any parse, and the daemon bounds both strings at construction — so a flooding
relay costs one bounded entry per distinct id rather than an unbounded append, and the pairing clear
returns that to zero. No eviction policy is built for a failure nobody has observed.

### The expiry — a value, not a clock read

`selectUsageLimitFor(conversationId, nowSeconds)` takes the current time as a parameter. Nothing in this
module reads a global clock, which is what makes the rule unit-testable in a `node` environment with no
timers, and what keeps the store free of the "never schedule from `resetsAt`" hazard the arm names — no
`setTimeout`, no interval, no re-arming handler exists anywhere on this path.

The rule, in the selector and nowhere else:

| held state | result |
|---|---|
| key absent | `null` |
| `resetsAt === 0` | the held record, at every `nowSeconds` |
| `nowSeconds < resetsAt` | the held record |
| `nowSeconds >= resetsAt` | `null` |

`resetsAt === 0` is tested FIRST and is the clause AC3's second half rests on: `0` means claude reported
no reset, so there is no instant to expire at. Read as an epoch timestamp it would make every unreported
reading invisible the moment it lands, which is the failure this ordering forecloses.

Three consequences, stated rather than discovered:

- The boundary is `>=`, so a reading is unreadable AT `resetsAt` as well as after it. The reset instant
  is when the window is fresh again, not the last instant it was stale.
- A negative `resetsAt` is a past instant and expires immediately for any non-negative `nowSeconds`.
  That is the honest reading of an unvalidated claude number, not a rejection: the wire declines to
  reject one and so does this.
- `NaN` and `Infinity` would fall through to "readable indefinitely" (every comparison against `NaN` is
  false), and neither is expressible in JSON, so neither reaches here through the wire. No guard is
  built for it — Evidence-Based Fix Selection, and `requireNumber`'s type-only check is the upstream
  fact this rests on.

**The parameter is named `nowSeconds`, and the name is the defence.** `resetsAt` is unix seconds, so a
caller passing a millisecond `Date.now()` would supply a value roughly a thousand times larger than any
real `resetsAt` and every reading would expire the instant it landed — green in every store test, and
invisible in a diff. #1321 must pass `Math.floor(Date.now() / 1000)`. The unit is stated on the
parameter, on the field, and in a test's name.

The expiry is a READ-TIME rule and evicts nothing: an expired entry stays in the map until an `allowed`
reading, a replacement, or the pairing clear. That keeps the store free of a timer it would otherwise
need to evict on schedule, and no consumer can observe the difference — the selector is the only read
surface.

### The bridge — `src/renderer/src/store/usageLimitBridge.ts`

```ts
export function translateRateLimited(event: DaemonEvent): UsageLimitSnapshot | null
export function subscribeUsageLimit(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setUsageLimit: (snapshot: UsageLimitSnapshot) => void,
  clearUsageLimitFor: (conversationId: string) => void
): () => void
export function UsageLimitData(): null
```

An INDEPENDENT SUBSCRIBER in the `announcedModelBridge` / `slashCommandListBridge` / `modelListBridge`
posture, not a fifth arm on one of the four exhaustive bridges. Reactive-only: the daemon pushes the
reading unsolicited, so there is no request half, no `connected`-edge trigger and no retry.

`translateRateLimited` maps the one owned arm to a FRESH four-field literal — never a spread, never
`return event` — so `type` never reaches the store and the store shape stays immune to the arm gaining an
unrelated field later. `default: null` rather than `assertNever`, because ignoring the rest is this
path's permanent intended behaviour; `null` means "not our arm", never "bad data" (a malformed payload
is already rejected upstream at #1318's fail-closed narrower, inside `daemonConnection`'s decode guard,
and no event is emitted at all).

**The `allowed` routing lives in `subscribeUsageLimit`, not in the store.** One exact-equality comparison
against a module-private client-owned constant decides which of two store mutations an arriving reading
reaches:

- `status === 'allowed'` → `clearUsageLimitFor(conversationId)`
- otherwise → `setUsageLimit(snapshot)`

Two reasons for that placement, and both are load-bearing. The store keeps its "no mutation branches on
held content" property, which is what stops a hostile value from crafting a survivor across a clear. And
the comparison is a pure function of the event, testable with two spies and no store at all.

The comparison is EXACT EQUALITY, never a prefix or substring test, and this is the sharpest edge in the
slice: `allowed_warning` — the only non-benign status ever measured — starts with `allowed`, so a
`startsWith` or `includes` test would silently discard the single reading this whole vertical exists to
show. Pinned by a test naming that string.

There is deliberately no guard on `conversationId`: an unrecognised id is written under its own key and
read by nothing, a stronger no-match than a filter could be, and there is no `?? activeConversation`
fallback anywhere on this path.

`UsageLimitData` is the thin React glue — one subscribe effect whose cleanup is the off handle, so a
StrictMode double-mount nets exactly one live listener. `window.pyry` is dereferenced only inside the
effect, never during render, so it server-renders to `''` without a bridge mock.

### The mount — `src/renderer/src/App.tsx`

`<UsageLimitData />` joins the thirteen existing headless leaves as the FOURTEENTH, with its own comment
in the numbered block: App-level always-listening for the sharpened reason its neighbours carry — a
reading arrives for whichever conversation observed the window, which may be one the operator has never
opened, and long before #1321's status row is mounted. No `connected` branch, for `AnnouncedModelData`'s
reason (see the clear below).

`App.tsx` is the one hazard worth naming, and the ticket names it: a hunk adding a leaf here has been
observed deleting a neighbour's JSX call while leaving its import standing, which typechecks, builds and
passes every renderer unit test, because those are static renders that mount no effects. The JSX block
gets read back after the edit rather than trusted from the diff.

### The pairing clear — `clearPairingScopedState.ts` + `PairedShell.tsx`

`clearAllUsageLimits` becomes the FIFTEENTH member of `ClearPairingScopedStateDeps`, wired in
PairedShell's module-scope `clearPairingDeps` as
`() => usageLimitStore.getState().clearAllUsageLimits()`. The call site needs no edit.

Run against that helper's own discriminator — *does a reconnect to the SAME daemon need to clear it?* —
the answer is NO, so this is the mechanism and NOT the `connected` edge. After a reconnect the account's
quota window is exactly what it was, nothing on this path re-asserts a reading, and there is no request
half to re-fetch one, so blanking at the edge would blank a correct value permanently. A pairing that has
ENDED is the opposite case: nothing writes the map until the new daemon's next reading, and until then a
surface would attribute the previous ACCOUNT's quota posture to the new one. That is the
`announcedModelStore` (#593) → `slashCommandListStore` (#955) → `modelListStore` (#977) sequence, verb
for verb.

`clearServerScopedState` is deliberately not the join: its docblock parks the conversation-keyed stores
out of its scope and closes with "Do NOT key a store here to make its clear scopeable." Scoping a
departed server's readings is a later ticket's question, exactly as it is for those three.

Placement in the body: among the in-memory clears, beside `clearAllModelLists` and its neighbours. What
is NOT free is that it must precede `clearAllLastRead`, the one effect that can throw.

### The comment flip — `timelineBridge.ts`

`translateTimelineEvent`'s `rateLimited` no-op is marked DORMANT pending this ticket's routing decision.
Taking the dedicated-subscriber route settles it, so the arm becomes PERMANENT and the comment says so
and why. The `case` line does not move; only the paragraph changes.

## State + concurrency model

One new Zustand vanilla store, keyed by `conversationId`, written only by `subscribeUsageLimit` and by
`clearPairingScopedState`'s fifteenth member. Read only through `selectUsageLimitFor`, which #1321 will
call with the open conversation's id.

Copy-on-write throughout, so a write for one conversation leaves every other record `Object.is`-identical
and a component watching a different id does not re-render. The map is read INSIDE each `set` updater
rather than through `getState()` outside it, so two frames arriving back-to-back cannot interleave —
zustand runs the updater synchronously against current state, which closes the only check-then-act shape
on this path, including `clearUsageLimitFor`'s `has` guard.

One async lifecycle: the `onDaemonEvent` subscription in `UsageLimitData`'s effect. Its off handle IS the
effect cleanup, so teardown on unmount and on a StrictMode double-mount is by construction. There is no
timer, no interval, no `AbortController` and no fire-and-forget promise anywhere in the slice — the
expiry is a read-time comparison, which is precisely why none is needed.

One known window, inherited rather than introduced: a `rateLimited` frame already queued on the IPC
channel when the pairing clear runs repopulates the map afterwards, because every write is unconditional
and last-write-wins, and `UsageLimitData` is an App-level sibling of `AppView` whose listener the unpair
route flip does not unmount. That is the window `sessionIdStore` documents and deliberately leaves alone;
the late record lands under a departed pairing's conversation id, which nothing can select.

## Error handling

There is no failure mode in this slice and so no result type. Nothing parses, validates, coerces, throws
or rejects: the frame was narrowed fail-closed at #1318 inside `daemonConnection`'s decode guard, so a
malformed payload emits no event at all and nothing malformed reaches the renderer. A second, weaker
check here would only invent a disagreement.

`translateRateLimited` returning `null` is "not our arm", not an error. `clearUsageLimitFor` on an absent
key is a no-op BY DESIGN — the common case, since the bridge would fire it for any conversation that has
never produced a reading — not a swallowed error.

**Nothing is logged, on any path, and nothing may be.** The pair of strings discloses the ACCOUNT'S quota
posture, a fact about the operator rather than about this frame, and `conversationId` is untrusted
daemon-asserted text. Not even a content-free count of what a clear dropped: the no-diagnostic property
has to be total to be worth anything, and a count is the first crack in it. There is deliberately no
diagnostic seam in either module.

## Testing strategy

Vitest only, both files in the `node` environment. No Playwright spec: nothing renders, so there is no
interaction to drive and no markup to assert. #1321 owns the e2e coverage.

**`usageLimitStore.test.ts`** — plain store instances from the DI factory, no React:

- one reading per id; a second reading for the same id replaces the first (AC1)
- a write for one conversation leaves every other record `Object.is`-identical (AC1, narrow-slice)
- `clearUsageLimitFor` removes exactly one key and leaves survivors identical (AC2's store half)
- `clearUsageLimitFor` on an absent key returns the state OBJECT (no subscriber wakes)
- `clearAllUsageLimits` returns `initialUsageLimitState` by reference; the `size === 0` guard hands the
  state object back (AC4's second half)
- the module constant is never poisoned: write, clear, then a second instance still starts empty
- selector — absent key yields `null` (AC5)
- selector — `resetsAt: 0` stays readable at a far-future `nowSeconds` (AC3's second half)
- selector — readable strictly before `resetsAt`, `null` AT it, `null` after it (AC3's first half)
- selector — a negative `resetsAt` yields `null`
- selector — a millisecond clock value expires a live reading, the test that names why the parameter is
  called `nowSeconds`
- selector — returns the HELD record itself by reference
- hostile ids: `__proto__`, `constructor` and `''` each read `null` BEFORE any write, hold their own
  written record after, and a delete of one leaves the other two (AC5). The pre-write reads are the half
  that matters: a `Record` would hand back `Object.prototype` where `?? null` should have fired.
- a degenerate `{ status: '', limitType: '', resetsAt: 0 }` is held verbatim, not collapsed to absence

**`usageLimitBridge.test.ts`** — injected `onDaemonEvent` and two spies, the `announcedModelBridge` idiom:

- `translateRateLimited` maps the owned arm to a fresh four-field literal, and `type` is absent from it
- every unrelated arm translates to `null` (spot-checked, `thinkingProgress` and `runConfigReceived`
  among them — the two nearest neighbours on the union)
- a non-`allowed` reading reaches `setUsageLimit` and never `clearUsageLimitFor`
- an `allowed` reading reaches `clearUsageLimitFor` with that id and never `setUsageLimit` (AC2)
- `allowed_warning` RECORDS rather than clears — the exact-equality pin, named for the one measured
  non-benign value
- an unrelated event calls neither spy
- the returned handle is the off handle from `onDaemonEvent`
- `<UsageLimitData />` server-renders to `''` with no bridge mock

**`clearPairingScopedState.test.ts`** — the sorted-key pin grows to fifteen, `clearAllUsageLimits` is
asserted called, and its ordering before `clearAllLastRead` is pinned by call order.

Fakes over mocks: the store tests use real store instances, and the bridge tests use a hand-rolled
`onDaemonEvent` that captures its listener. `vi.fn()` appears only for the two mutation spies, where
interaction verification is the point.

## Open questions

1. Should `selectUsageLimitFor` expose the expired-but-held record to any consumer, for wording like
   "your limit reset a moment ago"? Resolved at design time: no. AC3 says an expired entry yields
   nothing, one read surface is the family rule, and a second surface would ship a read path nothing
   calls.
2. Is the `'allowed'` constant worth exporting for #1321? Expected answer: no — #1321 selects copy by a
   status it holds, and a benign reading is never held, so the constant has no reader outside the bridge.
   Confirm while implementing; if it stays private, the bridge test pins the literal string instead,
   which is the stronger pin.
3. Does `clearUsageLimitFor` want a whole-map counterpart per conversation deletion
   (`conversationDeleted`)? Expected answer: no — nothing has asked for one, and a second per-key
   lifetime would be one more thing to keep in agreement with the pairing clear.

## Security review

Run per § A6 because #1320 carries `security-sensitive`. Adversarial pass over the design above.

### Trust boundaries

Four values cross into this slice, all from the same source and all already across the subprocess trust
boundary before #1318 saw them:

- `status`, `limitType` — claude-authored open strings. The daemon BOUNDS them at construction and does
  NOT sanitize them. Untrusted, model-influenced text.
- `resetsAt` — claude's unvalidated number. Negative, zero and year-40000 values are all representable
  and none is rejected upstream.
- `conversationId` — daemon-asserted routing key. Untrusted text; never an authorization signal.

The enforcing symbols are `parseRateLimitedPayload` (shape, fail-closed) and this slice's
`translateRateLimited` (the fresh four-field literal, which is what stops `type` or any later-added arm
field from smuggling across). Nothing downstream of the literal re-validates, deliberately.

### Findings

**MUST FIX — none outstanding.** Each of the following is a design obligation the plan above already
discharges; they are enumerated so the implementation can be checked against them line by line.

1. **No sink for either string.** `status` and `limitType` reach no DOM node, no attribute, no URL, no
   filename, no cache key and no lookup path in this slice. The one place `status` is consumed is an
   exact-equality comparison against a client-owned literal in `subscribeUsageLimit`, which the arm's
   contract explicitly permits (a key selecting among strings this client wrote, with a fallback on a
   miss, is not a key resolving a resource). Verified by construction: the slice has no DOM sink at all.
   The render constraint is INHERITED here and DISCHARGED by #1321.
2. **No log sink on any path.** Neither module imports a logger, and neither the store's three mutations
   nor the bridge's translate and subscribe steps emit a diagnostic — not even a content-free count. The
   pair of strings discloses the account's quota posture, which is a fact about the operator. Checked by
   grepping both new files for every logging entry point before commit.
3. **`resetsAt` is never a scheduling, allocation or iteration input.** The expiry is a read-time
   comparison inside the selector. No `setTimeout`, no `setInterval`, no re-arming handler, no array
   sized from it, no loop bounded by it. This is the single most likely way to get this frame wrong: a
   delay computed from `resetsAt` can be negative (fires immediately, spins if the handler re-arms) or
   past `setTimeout`'s ~24.8-day clamp, which ALSO fires immediately rather than never.
4. **Hostile map keys are safe by construction, not by validation.** `ReadonlyMap` is mandated;
   `Record<string, …>` is forbidden outright. `Map.prototype.get('__proto__')` performs no
   prototype-chain lookup, `set` creates an ordinary own entry, and `delete` likewise. Three
   consequences the implementation must honour, none of them a type error if broken: nothing is keyed
   into an object literal, no write path uses a computed object key, and `Object.fromEntries`, spreading
   the map into an object, and `JSON.stringify` of it are all out. The pre-write hostile-key reads in
   the test are the half that matters — a `Record` hands a reader `Object.prototype` where `?? null`
   should have fired.
5. **`status` steers no security-relevant behaviour.** The one branch it drives chooses between two
   store mutations. Worst case for a hostile or wrong value: a reading that should have been held is
   dropped, or one that should have been dropped is held. Both cost at most one wrong or missing row on
   #1321's surface. Nothing is authorized, unlocked, retried, throttled, suspended, spent or reconnected
   on it, and no mutation in the store branches on held content at all.

**SHOULD FIX — two, both folded into the design above rather than deferred.**

6. **The `allowed` comparison must be exact equality.** A `startsWith` or `includes` test would swallow
   `allowed_warning`, the only non-benign status ever measured, which is the exact reading this vertical
   exists to surface. It is a correctness bug that presents as a security-shaped one (the user stops
   being told about their quota), and it is one keystroke away. Pinned by a named test.
7. **The clock parameter must state its unit in its name.** A millisecond `Date.now()` passed as
   `nowSeconds` expires every reading instantly and silently — no type error, no red test in this
   slice, and the symptom (nothing ever shows) looks identical to "the daemon sent nothing." Named
   `nowSeconds`, documented on the parameter and on the field, and pinned by a test.

**OUT OF SCOPE — deferred deliberately, do not fix here.**

8. `truncated_fields` does not cross the IPC boundary at all (#1319's decision) and so cannot be
   consulted. If #1321 ever needs to mark a cut string, the field crosses in a ticket of its own.
9. Scoping a departed SERVER's readings, as opposed to a departed pairing's. `clearServerScopedState`'s
   docblock parks the conversation-keyed stores out of its scope, and this store joins the three
   existing ones in that posture.
10. The inherited late-frame window at the pairing clear (a frame already queued on the IPC channel when
    the clear runs). Documented above, unguarded, and owned by the pairing lifecycle rather than by a
    store whose whole contract is to record what it was told.
11. The unbounded-latch shape of a hostile stream of distinct conversation ids. Bounded per entry by
    `MAX_PLAINTEXT_BYTES` and the daemon's own string caps, collected at every pairing change, and
    identical to four shipped stores. No eviction policy is built for a failure nobody has observed.

**Verdict: PASS.** Every MUST FIX is discharged by the design as written, both SHOULD FIX items are
folded in with a pinning test named for each, and the four deferrals each name the ticket or mechanism
that owns them.
