# Usage-limit store

The renderer's held copy of **the latest usage-limit reading claude reported**, per conversation — a
dedicated, unidirectional Zustand store fed by a reactive-only headless observer, so the composer status
row can draw the reading without re-deriving when it expires.

Introduced in [#1320](../../specs/architecture/1320-usage-limit-store.md), claiming
[#1319](daemon-event-channel-sealed-union-history-recent.md)'s dormant `rateLimited` daemon event — which
[#1318](https://github.com/pyrycode/pyrycode-desktop/issues/1318) decodes off the daemon's `rate_limited`
frame — into a per-conversation store plus its bridge. Shipped dormant: nothing renders yet.
[#1321](https://github.com/pyrycode/pyrycode-desktop/issues/1321) draws the reading in the composer status
row and owns the visual-fidelity check and the DOM-sink discipline this slice only inherits.

**Named for the reading, not for the frame — a deliberate break with the family convention.** Every
sibling here takes its name from its event arm (`modelAnnounced` → `announcedModelStore`, `modelList` →
`modelListStore`), which would have made this `rateLimitStore`. The arm's own docblock names "you are
rate limited" as the realistic client bug: the one non-benign status ever measured is `allowed_warning`
(2026-08-22, claude 2.1.239, `limit_type: seven_day`), a weekly warning band in which every turn still ran
normally. A module called `rateLimitStore` would nudge every later reader — including the surface that
writes the copy — toward exactly that overclaim. Grep discoverability is preserved: `translateRateLimited`
names the arm, and both module headers cite the frame.

## What it does

Holds, **per conversation**, the most recently arrived `{ status, limitType, resetsAt }` reading, verbatim,
replacing the whole record for that conversation's id on every new arrival (most-recent-wins per key, no
merge, **no dedup of a verbatim repeat** — the daemon re-reports the window once per run whatever its
state, and a repeat is the signal that the reading is still current). A write for one conversation leaves
every other conversation's held record untouched and `Object.is`-identical.

A conversation id **absent from the map** is the distinct "no reading has arrived for this conversation"
state. A received `{ status: '', limitType: '', resetsAt: 0 }` is a **real, degenerate reading**, held
as-is under its key and never collapsed to absence — the [session-id store](session-id-store.md)'s
`null`-vs-`''` contract, reused here. This arm is reachable, not hypothetical: the daemon's producer emits
only on a non-empty status, but #1318 deliberately declined a second client-side narrowing, so a
non-conforming or hostile daemon can still deliver one.

**The underlying limit is account-wide, and this store keeps the daemon's scoping rather than correcting
it.** The daemon names whichever conversation observed the window, so one conversation can carry a reading
while its siblings show nothing. There is deliberately no fan-out to the account's other conversations.

**Not a field on the thread-timeline record.** A usage-limit window is conversation-scoped, not
turn-scoped: it outlives a turn end, a `/clear` and a session transition. State a turn rebuilds would drop
the reading at the wrong moment and cost every reducer arm an extra field to carry. This is the
`announcedModelStore` shape — a store beside a bridge, keyed by conversation id — and `timelineBridge`'s
`rateLimited` no-op, marked DORMANT pending this ticket's routing decision, is now **PERMANENT**.

### The lifecycle has three exits and one of them is "never"

- An `allowed` reading clears that conversation's entry, through `clearUsageLimitFor`. The daemon is
  silent on the benign status today — this arm has no live producer yet — kept because it is one string
  comparison, drivable by a fake frame, and the daemon has committed to sending it: it is the only clean
  clear the wire will ever offer.
- Otherwise the entry stops being **readable** once `resetsAt` has passed — a read-time comparison in the
  selector, not an eviction (see § How it works).
- `resetsAt: 0` means claude reported no reset, so there is no instant to expire at, and the entry stays
  readable until an `allowed` arrives or the pairing ends. It must **not** be read as "expired at the
  epoch", which would make every unreported reading invisible the moment it lands.

## How it works

### The store (`src/renderer/src/store/usageLimitStore.ts`)

```ts
export interface UsageLimitReading { status: string; limitType: string; resetsAt: number }
export interface UsageLimitSnapshot extends UsageLimitReading { conversationId: string }  // the write unit
export interface UsageLimitState { readings: ReadonlyMap<string, UsageLimitReading> }
export type UsageLimitStore = UsageLimitState & {
  setUsageLimit: (snapshot: UsageLimitSnapshot) => void
  clearUsageLimitFor: (conversationId: string) => void   // the `allowed` exit
  clearAllUsageLimits: () => void                        // the pairing-ended exit; takes NO id
}

createUsageLimitStore(init?)        // vanilla createStore — one isolated instance per test (DI seam)
usageLimitStore                     // app-wide singleton
useUsageLimitStore(selector)        // React binding: useStore(usageLimitStore, selector)
selectUsageLimitFor(conversationId, nowSeconds)(s)   // the only read surface — a selector FACTORY
```

Mirrors [`announcedModelStore`](announced-model-store.md)'s DI-factory → singleton → hook → selector
structure and its `ReadonlyMap`-keyed, entry/snapshot-split shape verbatim. `UsageLimitSnapshot` **extends**
`UsageLimitReading` rather than restating its three fields, so a field added later lands on both by
construction. `conversationId` stays off `UsageLimitReading` and rides only on the write unit — the
family's rule: the key stops at the map key and never reaches the object a reader holds and #1321 renders
from.

`ReadonlyMap` is **mandated** and `Record<string, …>` **forbidden**, on
[`conversationActivityStore`](conversation-activity-store.md)'s rule: `Map.prototype.get('__proto__')`
performs no prototype-chain lookup and `set`/`delete` create and remove ordinary own entries, so
`__proto__`, `constructor` and `''` are unremarkable keys by construction rather than by validation. A
`Record` swap type-checks cleanly and breaks no other assertion — only a **pre-write read** of a hostile
key catches it, which is why `usageLimitStore.test.ts`'s hostile-key cases read before writing.

Three named setters rather than a reducer — each is a whole-key or whole-map write, none is a state-machine
arm, and there is no reject branch anywhere:

- **`setUsageLimit`** — copy-on-write: clone the outer map, set the one key from a fresh named-field
  literal, return a fresh state. Unconditional; no branch on arriving or held content, so a hostile daemon
  value cannot craft a record that survives a clear. The map is read **inside** the `set` updater rather
  than through `getState()` outside it, so two frames arriving back-to-back cannot interleave.
- **`clearUsageLimitFor`** — the [`conversationActivityStore.dropConversation`](conversation-activity-store.md)
  shape: `has` guard, then clone-and-delete. The guard returns the state **object**, so a clear for a
  conversation holding nothing wakes no subscriber — the common case, since the bridge routes every
  `allowed` reading here and most conversations have never held one. It takes the id and nothing else: the
  status that decided this is not carried in, keeping "no mutation reads arriving content" whole.
- **`clearAllUsageLimits`** — nullary, the [`clearAllModelLists`](model-list-store.md) shape verbatim:
  `size === 0` guard for the subscriber short-circuit, otherwise `initialUsageLimitState` returned **by
  reference**. That return is what makes the copy-on-write above load-bearing rather than stylistic — the
  constant is module-shared, so an in-place mutation anywhere would poison it and hand one pairing's
  readings to the next with no type error. Pinned by a test. Reached only through
  [`clearPairingScopedState`](paired-shell.md), never from a bridge arm or a call site — keeping it out of
  `usageLimitBridge` is what makes it daemon-unreachable.

**Growth**, stated rather than defended: one entry per distinct `conversationId` seen since launch, each
holding one bounded three-field record. Both halves are bounded per frame — `MAX_PLAINTEXT_BYTES` caps the
decrypted envelope before any parse, and the daemon bounds both strings at construction — so a flooding
relay costs one bounded entry per distinct id rather than an unbounded append, and the pairing clear
returns that to zero. `modelListStore`, `slashCommandListStore`, `conversationActivityStore` and
`queueStore` all ship the identical posture; no eviction policy is built for a failure nobody has observed.

### The expiry — a value, not a clock read

`selectUsageLimitFor(conversationId, nowSeconds)` takes the current time as a parameter. Nothing in this
module reads a global clock, which is what makes the rule unit-testable in this repo's `node` environment
(no timers, no DOM), and what keeps the store free of the hazard the arm names — no `setTimeout`, no
interval, no re-arming handler anywhere on this path.

| held state | result |
|---|---|
| key absent | `null` |
| `resetsAt === 0` | the held record, at every `nowSeconds` |
| `nowSeconds < resetsAt` | the held record |
| `nowSeconds >= resetsAt` | `null` |

The zero test comes first and that ordering is the point: `0` means claude did not report a reset, not the
epoch. The boundary is `>=`, so a reading is unreadable *at* `resetsAt` as well as after it — the reset
instant is when the window is fresh again, not the last instant it was stale. A negative `resetsAt` is a
past instant and expires immediately for any non-negative `nowSeconds` — the honest reading of an
unvalidated claude number, not a rejection. `NaN` and `Infinity` would fall through to "readable
indefinitely" (every comparison against `NaN` is false), but neither is expressible in JSON, so neither
reaches here through the wire — `requireNumber`'s type-only check is the upstream fact this rests on, and
no guard is built for a failure that cannot arrive.

The expiry is a **read-time** rule and evicts nothing: an expired entry stays in the map until an `allowed`
reading, a replacement, or the pairing clear. No consumer can observe the difference, because the selector
is the only read surface.

**The parameter is named `nowSeconds`, and the name is the defence.** `resetsAt` is unix seconds, so a
caller passing a millisecond `Date.now()` would supply a value roughly a thousand times larger than any
real `resetsAt`, and every reading would expire the instant it landed — green in every store test, and
invisible in a diff, with a symptom ("nothing ever shows") identical to the daemon having sent nothing.
[#1321](https://github.com/pyrycode/pyrycode-desktop/issues/1321) must pass
`Math.floor(Date.now() / 1000)`. Pinned by a test asserting a millisecond value expires a live reading.

### The bridge (`src/renderer/src/store/usageLimitBridge.ts`)

```ts
translateRateLimited(event: DaemonEvent): UsageLimitSnapshot | null
subscribeUsageLimit(onDaemonEvent, setUsageLimit, clearUsageLimitFor): () => void
UsageLimitData(): null
```

**An independent subscriber, not a fifth arm on one of the four exhaustive bridges.** All four —
`daemonEventBridge`, `modalBridge`, `questionBridge`, `timelineBridge` — keep their `rateLimited` no-op
**permanently**, present only so each `assertNever` guard makes a new arm a compile error. This is the
[`announcedModelBridge`](announced-model-store.md) / `slashCommandListBridge` / `modelListBridge` posture,
not the `apiRetry` shape where that arm folded into `timelineBridge`'s owned status cluster.
`timelineBridge`'s `rateLimited` no-op was the one still marked DORMANT, recording the routing choice as
this ticket's to make; taking the dedicated-subscriber route settles it and that comment now says
PERMANENT — see [Daemon-event channel — the sealed union: per-member history
(recent members)](daemon-event-channel-sealed-union-history-recent.md).

Reactive-only, like `announcedModelBridge`/`slashCommandListBridge` and unlike `conversationListBridge`:
the daemon pushes the reading unsolicited, so there is no request half — no command sent, no
`connected`-edge trigger, and specifically no retry, since a client-side retry against a relay withholding
the frame would be a self-inflicted spin.

`translateRateLimited` maps the one owned arm to a **fresh** four-field literal — never a spread, never
`return event` — so `type` never reaches the store. `default: null` rather than `assertNever`, because
ignoring the rest is this path's permanent intended behaviour; `null` means "not our arm", never "bad
data" (a malformed payload is already rejected upstream by #1318's fail-closed narrower inside
`daemonConnection`'s decode guard, and no event is emitted at all).

**The `allowed` routing lives in `subscribeUsageLimit`, not in the store**, and both halves of that
placement are load-bearing: the store keeps its "no mutation branches on held content" property (stopping
a hostile value from crafting a survivor across a clear), and the decision stays a pure function of the
event, testable with two spies and no store at all.

```
status === 'allowed'  →  clearUsageLimitFor(conversationId)
otherwise              →  setUsageLimit(snapshot)
```

**The comparison is exact equality, never a prefix or substring test — the sharpest edge in the slice.**
`allowed_warning`, the only non-benign status ever measured, *starts with* `allowed`, so a `startsWith` or
`includes` test would silently discard the single reading this whole vertical exists to show. `BENIGN_STATUS`
is module-private and unexported: a benign reading is never held, so #1321 selects its copy from statuses
this constant excludes and never needs to name it. Pinned by a test naming `allowed_warning` specifically.

There is deliberately no guard on `conversationId`: an unrecognised id is written under its own key and
read by nothing — a stronger no-match than a filter could be — and there is no `?? activeConversation`
fallback anywhere on this path.

`UsageLimitData` is the thin React glue — one subscribe effect whose cleanup is the off handle, so a
StrictMode double-mount nets exactly one live listener. `window.pyry` is dereferenced only inside the
effect, never during render, so it server-renders to `''` without a bridge mock.

### The mount (`src/renderer/src/App.tsx`)

`<UsageLimitData />` is the **fourteenth** headless leaf, mounted app-level after `SystemPromptWriteData`
in the numbered comment block. App-level always-listening for `AnnouncedModelData`'s sharpened reason: a
reading arrives for whichever conversation observed the window, which may be one the operator has never
opened, and long before the composer status row is ever mounted. No `connected` branch — after a reconnect
to the same daemon the account's quota window is exactly what it was, and there is no request half that
could re-fetch a reading blanked at that edge.

### The pairing clear (`clearPairingScopedState.ts` + `PairedShell.tsx`)

`clearAllUsageLimits` is the **fifteenth** member of `ClearPairingScopedStateDeps`, wired in
`PairedShell`'s module-scope `clearPairingDeps` as
`() => usageLimitStore.getState().clearAllUsageLimits()`. See [Paired shell](paired-shell.md) for the
shared helper and its ordering guarantees (this clear precedes `clearAllLastRead`, the one effect that can
throw, per that helper's own rule).

Run against `clearPairingScopedState`'s own discriminator — *does a reconnect to the same daemon need to
clear it?* — the answer is **no**: after a reconnect the account's quota window is exactly what it was,
nothing on this path re-asserts a reading, and there is no request half to re-fetch one, so blanking on
the `connected` edge would blank a correct value permanently. A pairing that has **ended** is the opposite
case: nothing writes the map until the new daemon's next reading, and until then a surface would attribute
the previous account's quota posture to the new one. This is the `announcedModelStore` (#593) →
`slashCommandListStore` (#955) → `modelListStore` (#977) sequence, verb for verb.
`clearServerScopedState` is deliberately **not** the join: its docblock parks the conversation-keyed
stores out of its scope. Scoping a departed *server's* readings, as opposed to a departed *pairing's*, is
a later ticket's question, exactly as it is for those three stores.

## Configuration and usage

- **Import surface**, for [#1321](https://github.com/pyrycode/pyrycode-desktop/issues/1321)'s composer
  status row: `import { useUsageLimitStore, selectUsageLimitFor } from '@renderer/store/usageLimitStore'`,
  called with a `useMemo`-stable selector bound to the open `conversationId` and
  `Math.floor(Date.now() / 1000)` — a fresh closure or a millisecond clock each render would be wrong in
  two different ways (churn, and silent permanent expiry respectively).
- **Mount point:** `src/renderer/src/App.tsx`, `<UsageLimitData />` after `<SystemPromptWriteData />`.
- **Pairing clear:** `PairedShell.tsx`'s `clearPairingDeps`, `clearAllUsageLimits` entry.

## Edge cases and limitations

- **No sink for either string, in this slice.** `status` and `limitType` are claude-authored open strings
  that crossed the subprocess trust boundary; the daemon bounds them at construction and does not sanitize
  them. They reach no DOM node, no attribute, no URL, no filename, no cache key and no lookup path here —
  the one place `status` is consumed is the exact-equality comparison in `subscribeUsageLimit`, which the
  arm's contract explicitly permits (a key selecting among strings this client wrote, never a key resolving
  a resource). The render constraint is **inherited** here and **discharged** by #1321.
- **Nothing is logged, on any path, and nothing may be.** The pair of strings discloses the account's quota
  posture, a fact about the operator rather than about this frame. Not even a content-free count of what a
  clear dropped — the no-diagnostic property has to be total to be worth anything, and a count is the
  first crack in it.
- **`resetsAt` is never a scheduling, allocation or iteration input.** The expiry is a read-time comparison
  inside the selector only. A delay computed from it can be negative (fires immediately, spins if the
  handler re-arms) or past `setTimeout`'s ~24.8-day clamp (also fires immediately rather than never) — this
  is the single most likely way to get this frame wrong, and nothing on this path does it.
- **Hostile map keys are safe by construction, not by validation.** See § How it works. `Object.fromEntries`,
  spreading the map into an object, and `JSON.stringify` of it are all out for the same reason a `Record`
  swap is.
- **A test fixture for one `DaemonEvent` arm needs `Extract`, not `Omit`.** `Omit<DaemonEvent, 'type'>`
  collapses to the keys every union member shares, so a fixture typed that way rejects every field specific
  to the `rateLimited` arm. `vitest` does not catch this — it strips types, so all 24 bridge tests ran green
  — only `npm run build` reported it, sixteen errors at once. The fix, used in
  `usageLimitBridge.test.ts`: `Extract<DaemonEvent, { type: 'rateLimited' }>` first, then `Omit` on *that*.
  Worth knowing for any future spec building a fixture for one arm of a large discriminated union.
- **Known window, inherited rather than introduced.** A `rateLimited` frame already queued on the IPC
  channel when the pairing clear runs repopulates the map afterwards, because every write is unconditional
  and last-write-wins, and `UsageLimitData` is an App-level sibling of `AppView` whose listener the unpair
  route flip does not unmount. This is the window [session-id store](session-id-store.md) documents and
  deliberately leaves alone; the late record lands under a departed pairing's conversation id, which
  nothing can select.
- **No correlation, no request half.** The daemon pushes `rateLimited` unsolicited off its own report
  cadence; there is no `requestUsageLimit` command and nothing to time out or retry.

## Related

- [Announced-model store](announced-model-store.md) — the structural template this store follows verbatim:
  DI factory → singleton → hook → selector, `ReadonlyMap` mandated over `Record`, copy-on-write, the clear
  returning the exported initial state by reference, and the independent-subscriber bridge posture.
- [Model-list store](model-list-store.md) — `clearAllModelLists`' nullary whole-map-clear shape, copied
  verbatim by `clearAllUsageLimits`.
- [Conversation-activity store](conversation-activity-store.md) — the hostile-`Map`-key rule
  (`__proto__`/`constructor`/`''`) and the `dropConversation` clone-and-delete shape `clearUsageLimitFor`
  follows.
- [Paired shell](paired-shell.md) — `clearPairingScopedState`'s shared set and `PairedShell`'s
  `clearPairingDeps` wiring; `clearAllUsageLimits` is its fifteenth member.
- [Daemon-event channel — the sealed union: per-member history (recent
  members)](daemon-event-channel-sealed-union-history-recent.md) — the `rateLimited` `DaemonEvent` arm:
  the wire-to-IPC carry, the four exhaustive bridges' permanent no-ops, and the record of this ticket
  settling `timelineBridge`'s routing question.
- [Daemon-event bridge](daemon-event-bridge.md) — `daemonEventBridge.ts`'s own `rateLimited` row and why
  it stays permanently null there (folding a quota reading into the session store's connection-status
  scalar would be the same "you are blocked" overclaim the wire warns against).
- [#1319 architecture spec](../../specs/architecture/1319-rate-limited-ipc-carry.md) — the transport-to-IPC
  carry this store consumes: which of the wire's five fields cross, and the inherited render/lookup
  contract on `status`/`limitType`.
- [#1320 architecture spec](../../specs/architecture/1320-usage-limit-store.md) — this ticket's design,
  the sizing overage (six exported shapes, ~1000 lines, stated and not split), and the security review.
