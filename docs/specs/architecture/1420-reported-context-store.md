# #1420 — hold the per-conversation context usage reading

Claim [#1419](https://github.com/pyrycode/pyrycode-desktop/issues/1419)'s carried `contextUsage`
daemon event into a per-conversation renderer store plus its own bridge, and register the whole-map
clear with the pairing-ended clear. Ships dormant: nothing renders here — #1421 draws the footer
reading and the gauge, #1254 the breakdown popover.

## Files read

- `src/shared/ipc/events.ts` → the `contextUsage` arm of `BaseDaemonEvent` — the eleven fields this
  store holds, and the security block (nested untrusted strings, `Map`-not-object indexing, the
  never-log escalation) this slice inherits verbatim.
- `src/shared/wire/types.ts` → `ContextUsageCategory`, `ContextUsageMCPTool`,
  `ContextUsageMemoryFile` — the three row types reused verbatim with their snake_case fields, and
  the per-row prohibitions (`name` is a label, `server_name` is inert, `path` is not a file handle,
  `type` is not a discriminant).
- `src/renderer/src/store/usageLimitStore.ts` → `createUsageLimitStore`, `UsageLimitReading`,
  `UsageLimitSnapshot`, `selectUsageLimitFor`, `clearAllUsageLimits` — the precedent this slice
  follows verb for verb: DI factory / singleton / hook / per-conversation selector, copy-on-write map
  writes, `ReadonlyMap` mandated and `Record` forbidden.
- `src/renderer/src/store/usageLimitBridge.ts` → `translateRateLimited`, `subscribeUsageLimit`,
  `UsageLimitData` — the reactive-only bridge shape (no request half, no connected edge, no retry)
  and the fresh-named-field-literal translate idiom.
- `src/renderer/src/store/announcedModelBridge.ts` → `AnnouncedModelData` — the app-level headless
  leaf whose effect-only `window.pyry` dereference is what lets the leaf server-render without a
  bridge mock.
- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `BackgroundTaskRosterEntry`,
  `BackgroundTaskRosterSnapshot` — the precedent for a held record carrying a `dropped*` count beside
  an inventory, and the one place this slice deliberately diverges (that store maps its wire rows into
  a keyed `Map` because a join needs prior state; this one holds its rows verbatim).
- `src/renderer/src/store/timelineBridge.ts` → the `contextUsage` case in the timeline reducer's
  event switch — the one of the four exhaustive bridges #1419 left marked DORMANT pending this
  ticket's routing choice.
- `src/renderer/src/clearPairingScopedState.ts` → `ClearPairingScopedStateDeps`,
  `clearPairingScopedState` — the enumeration this store joins, the last-position ordering constraint
  on `clearAllLastRead`, and the docblock whose stated member count already trails the interface.
- `src/renderer/src/clearPairingScopedState.test.ts` → `spyDeps` and the pinned `Object.keys(deps)`
  assertion — the tripwire a new member must update.
- `src/renderer/src/PairedShell.tsx` → the `ClearPairingScopedStateDeps` object literal where each
  member is bound to its app singleton.
- `src/renderer/src/App.tsx` → the headless-leaf JSX list where the new bridge mounts.
- `src/renderer/src/screens/conversation/contextUsage.ts` → `contextUsagePercent`,
  `contextUsageStep` — the settings-derived figure this store must not be mistaken for, and the
  reason the new module carries a different name.
- `docs/knowledge/features/usage-limit-store.md` → the package overview for the precedent: the
  named-for-the-reading naming break, the three-exit lifecycle, and the `ReadonlyMap` rule stated as
  a package-level contract rather than a module comment.

## Design source

**Figma:** N/A — nothing renders in this slice. The store and its bridge are pure renderer state with
no DOM sink at all; the visual surfaces are #1421 (footer reading and gauge) and #1254 (breakdown
popover), each of which carries its own Figma anchor and owns the visual-fidelity check.

## Context

#1419 carries the daemon's `context_usage` frame across the IPC boundary as a `contextUsage`
`DaemonEvent` arm, where all four exhaustive bridges no-op it. Nothing holds it. This slice gives the
reading a home so that #1421's footer, #1421's gauge and #1254's popover all read **one figure per
chat** rather than each deriving its own.

The figure this eventually displaces stays exactly where it is: `contextUsagePercent` under the
conversation screen derives a percent from `runConfigStore`'s window figures and keeps both its
callers untouched. That helper is a *derivation from settings*; this store is the *separate, pushed,
per-conversation reading claude reports for itself*. They are different facts and both remain live
until #1421 decides what to show.

**No ADR is warranted.** Every structural decision here is an application of an existing decided
pattern (`usageLimitStore` #1320, `announcedModelBridge` #588), not a new one. The one genuinely new
thing — a held record whose untrusted content is *nested inside row arrays* rather than flat on the
record — is a consequence of the wire shape #1455/#1459/#1460 already decided, and it is recorded in
the module header where the next reader of this store will be standing.

### Sizing — over the boundary on two counts, deliberately

The one-ticket boundary is exceeded on production file count (6 against a ceiling of 5) and total
written work (the refiner estimated ~2100 lines against a ceiling of 800). The refiner ruled against
a split and this plan agrees, on the floor rule: the store's only writer is its bridge, a store
nothing writes changes nothing observable, and a bridge with no store has nowhere to land. Neither
half is independently verifiable, so splitting would produce a child that cannot be checked on its
own. When the floor and the ceiling disagree the floor wins; the overage is stated here rather than
worked around. Split depth is zero (this ticket has no parent), so this is a deliberate overage, not
a depth-capped one.

### The name, and why it is not `contextUsageStore`

The family convention names a store for its event arm (`modelAnnounced` → `announcedModelStore`),
which would make this `contextUsageStore`. It is not, for `usageLimitStore`'s reason applied to a
concrete collision: `src/renderer/src/screens/conversation/contextUsage.ts` already exports
`contextUsagePercent` and `contextUsageStep`, and the ticket requires a module name that cannot be
mistaken for it on an import line. `reportedContextStore` says the distinguishing fact — claude
**reported** this figure, as against the one the client derives from settings — and
`selectReportedContextFor` cannot be misread as `contextUsagePercent` at a call site. Grep
discoverability is preserved exactly as #1320 preserved it: `translateContextUsage` names the arm and
both module headers cite the frame.

## Design

### The store — `src/renderer/src/store/reportedContextStore.ts`

```ts
export interface ReportedContextReading {
  model: string
  totalTokens: number
  maxTokens: number
  percentage: number
  categories: readonly ContextUsageCategory[]
  droppedCategories: number
  mcpTools: readonly ContextUsageMCPTool[]
  droppedMcpTools: number
  memoryFiles: readonly ContextUsageMemoryFile[]
  droppedMemoryFiles: number
}
export interface ReportedContextSnapshot extends ReportedContextReading { conversationId: string }
export interface ReportedContextState { readings: ReadonlyMap<string, ReportedContextReading> }
export type ReportedContextStore = ReportedContextState & {
  setReportedContext: (snapshot: ReportedContextSnapshot) => void
  clearAllReportedContext: () => void      // the pairing-ended exit; takes NO id
}

createReportedContextStore(init?)                 // vanilla createStore — DI seam, one per test
reportedContextStore                              // app-wide singleton
useReportedContextStore(selector)                 // React binding
selectReportedContextFor(conversationId)(s)       // the ONLY read surface
```

`usageLimitStore`'s DI-factory → singleton → hook → selector structure verbatim, with three
deliberate differences:

- **Ten held fields, not three, and the untrusted ones are nested.** `model` is the only untrusted
  string on the record itself; `name`, `server_name`, `path` and `type` live inside rows of the three
  inventories. Held verbatim — nothing recomputed, re-sorted, de-duplicated, summed or normalised.
- **`extends` rather than restating the ten fields**, for `UsageLimitSnapshot`'s reason: the write
  unit is exactly the record plus the routing key, so a field added later lands on both by
  construction. `conversationId` stays off the reading, so the key stops at the map key and never
  reaches the object a render surface holds.
- **The selector takes no second argument.** `selectUsageLimitFor` takes `nowSeconds` because a
  usage-limit reading expires; a context reading does not. There is no time input, no expiry and no
  read-time rule beyond `?? null`.

**The inventories are carried by reference, not copied.** The bridge builds the snapshot from the
event, the setter builds a fresh named-field record from the snapshot, and the three arrays cross
both hops as the same objects the decoder produced. They are typed `readonly` at every hop, nothing
retains the event once the listener returns, and no path mutates one. A defensive `.slice()` would
buy nothing and would add an allocation sized by daemon-supplied content on the write path.

**Two mutations, not three.** #1320 has a per-key clear because its `rate_limited` arm carries a
benign `allowed` status that ends a window. `contextUsage` has no such value: every frame is a
reading, and a window that shrinks at a `/clear` or a compaction arrives as the *next frame*, not as
an absence. Nothing would call a per-conversation clear, so none is written. A delete-time drop
(`conversationDeleted`) is not routed either — `usageLimitStore` routes none, and building an
eviction policy for a failure nobody has observed is exactly what its header forbids.

**`ReadonlyMap` mandated, `Record<string, …>` forbidden**, on `conversationActivityStore`'s rule:
`Map.prototype.get('__proto__')` performs no prototype-chain lookup and `set`/`delete` create and
remove ordinary own entries, so `__proto__`, `constructor` and `''` are unremarkable keys by
construction. This slice builds **no index over any inventory at all** — the rows are held as arrays
and read in order — which is a stronger compliance with the arm's `Map`-not-object rule than any
index could be. A consumer that later wants one (a legend keyed by category name, a panel grouped by
`server_name`) inherits the obligation.

**Absence is distinct from a present empty reading.** A key absent from the map is "no frame has
arrived for this conversation" and reads `null`; a present reading whose three inventories are `[]`
and whose three dropped counts are `0` is a real reading the daemon emitted, held as-is. That is the
distinction #1421's settings-derived fallback keys on, and the nullable return forces the branch.

**The six integers are figures, never sizes.** Nothing in this module allocates, iterates or sizes
anything from `totalTokens`, `maxTokens`, `percentage` or any of the three dropped counts. A dropped
count counts rows that are *not* present, so it must never become an array length or a loop bound.
`percentage` is not derivable from the totals and the categories need not sum — no invariant is
asserted between any two of the eleven fields, here or in a test.

### The bridge — `src/renderer/src/store/reportedContextBridge.ts`

```ts
translateContextUsage(event: DaemonEvent): ReportedContextSnapshot | null
subscribeReportedContext(onDaemonEvent, setReportedContext): () => void
ReportedContextData(): null      // the app-level headless leaf
```

`announcedModelBridge`'s shape: reactive-only, no request half, no connected-edge trigger, no retry —
the daemon pushes the reading after every turn end, and a client-side retry against a relay
withholding the frame would be a self-inflicted spin. `translateContextUsage` returns a **fresh
named-field literal** (never `return event`, never a spread) so `type` and any later-added arm field
never reach the store, and `default: null` rather than `assertNever`, because ignoring every other
arm is this subscriber's permanent intended behaviour.

`subscribeReportedContext` has **one route, no branch**: a translated snapshot goes to
`setReportedContext` and everything else no-ops. There is no guard on `conversationId` — an
unrecognised id is written under its own key and read by nothing, which is a stronger no-match than a
filter could be, and no `?? activeConversation` fallback exists anywhere on this path.

`ReportedContextData` mounts app-level in `App.tsx` beside `UsageLimitData`, not screen-scoped: the
daemon fans the frame out after every turn end for whichever conversation ran, which may be one the
operator has never opened, and a reading can arrive long before #1421's footer is mounted.
`window.pyry` is dereferenced only inside the effect, so the leaf server-renders to `''` without a
bridge mock.

### The pairing clear

`clearAllReportedContext` joins `ClearPairingScopedStateDeps` and is wired through `PairedShell.tsx`
to the singleton. Run against that helper's own discriminator — does a reconnect to the **same**
daemon need to clear it? — the answer is **no**: after a reconnect the window is whatever claude last
reported and the next turn end re-reports it, so blanking on the `connected` edge would blank a
correct value with nothing to re-fetch it (there is no request half). A pairing that has **ended** is
the opposite: nothing writes the map until the new daemon's next turn ends, and until then a surface
would attribute a departed machine's window composition — its model identity, its MCP server names
and its memory-file paths — to the new one. That is the `announcedModelStore` → `slashCommandListStore`
→ `modelListStore` → `usageLimitStore` sequence verb for verb.

Position among the in-memory clears is free; it must precede `clearAllLastRead`, the only effect that
reaches outside memory and so the only one that can throw. It is nullary, so no daemon-supplied id
can steer which pairing's paths and server names survive the boundary.

**The docblock's stated count.** `clearPairingScopedState`'s docblock says "the fifteen effects" while
the interface already carries sixteen — `clearSessionFacts` is in the interface and missing from the
bullet list. Per the ticket, the count is not extended. The ordinal is **dropped** and the
enumeration completed: the missing bullet is added, mine is added, and the sentences whose totals my
addition invalidates are rewritten count-free rather than renumbered, so the number cannot rot a
third time. The seven pre-existing inline "thirteen in-memory clears" position notes are already
stale, sit on lines this ticket does not otherwise touch, and are left alone.

### `timelineBridge`

The `contextUsage` arm's no-op is settled from DORMANT to **PERMANENT**: the reading goes to a
subscriber of its own, the `questionShown` (#885) / `rateLimited` (#1320) route, not to thread chrome.
The deciding fact is lifetime rather than layout — a context window is conversation-scoped and
outlives a turn end, a `/clear` and a session transition, so state a turn rebuilds would drop it at
the wrong moment and every reducer arm would carry ten extra fields to prevent that. Comment-only
change; the case stays present so the `assertNever` guard makes a new arm a compile error. The other
three exhaustive bridges already say PERMANENT and are not edited.

## State + concurrency model

One Zustand vanilla store, one app-lifetime subscription, no async work at all. Writes are
copy-on-write: clone the outer map, set the one key, return a fresh state — never mutate `s.readings`
or a held record, so a write for one conversation leaves every other record `Object.is`-identical and
a component watching a different id does not re-render. The map is read **inside** the `set` updater
rather than through `getState()` outside it, so two frames arriving back-to-back cannot interleave.

`clearAllReportedContext` returns `initialReportedContextState` **by reference** behind a `size === 0`
guard, so a redundant clear hands the state object back and zustand's `Object.is` short-circuit wakes
no listener. That by-reference return is what makes the copy-on-write discipline load-bearing rather
than stylistic: a writer that ever mutated in place would poison the module-shared constant and hand
one pairing's readings to the next with no type error.

Teardown: `subscribeReportedContext` returns the off-handle, used directly as the effect cleanup, so
a StrictMode double-mount nets exactly one live listener. Nothing is persisted and nothing may be —
web storage would outlive the pairing that scoped the reading and survive the clear with every
in-memory assertion still green.

Growth, stated rather than defended: one entry per distinct `conversationId` seen since launch, each
holding one ten-field record. Both halves are bounded per frame by `MAX_PLAINTEXT_BYTES` in
`parseInboundMessage` ahead of every narrower, so a flooding hostile relay costs one bounded entry
per distinct id rather than an unbounded append, and the pairing clear returns that to zero.

## Error handling

There are no failure modes in this slice and no reject branches. A malformed frame is rejected
upstream by #1454/#1455/#1459/#1460's fail-closed narrowers inside `daemonConnection`'s decode guard,
so no event is emitted at all and nothing malformed reaches here; a second, weaker check in the
renderer would only invent a disagreement. Nothing validates, coerces, dedups or shape-checks on the
way in, nothing throws, and **nothing on this path reaches a log on any branch** — not even a
content-free count of what a clear dropped. The grounds escalate across the frame: the integers
disclose how much private work is in the window, a `server_name` discloses what the operator wired
up, and a `path` discloses who the user is and where they work — and a path may legitimately contain
a newline, which would forge a record in the line-delimited diagnostic stream.

## Testing strategy

All vitest, node environment, no DOM needed. Two new co-located spec files plus edits to the existing
clear spec.

`reportedContextStore.test.ts` — against a fresh `createReportedContextStore()` per case:

- A landed snapshot reads back with all ten fields **verbatim**, rows in arrival order, including a
  row whose `name` is `__proto__`, whose `path` is `../../etc/passwd` and whose `type` is a
  `javascript:` URI; the held arrays are the same objects that were passed in.
- A later frame for the same conversation replaces the record wholesale — a verbatim repeat, a lower
  `percentage` and a shorter inventory each land rather than being suppressed.
- A write for one conversation leaves every other conversation's held record `Object.is`-identical.
- An absent key reads `null`; a present reading with three empty inventories and three `0` dropped
  counts reads as a present record and is not collapsed to absence.
- Hostile keys pre-write: `selectReportedContextFor('__proto__')`, `'constructor'` and `''` all read
  `null` on an empty store (the half that a `Record` swap would break), and post-write each is an
  ordinary key holding only what was written under it.
- `clearAllReportedContext` empties the map, returns `initialReportedContextState` by reference, and
  is a no-op reference on an already-clear store.
- No mutation reads or branches on held or arriving content — asserted by a reading whose `model` and
  every row string is empty landing exactly like any other.

`reportedContextBridge.test.ts` — plain spies, the `announcedModelBridge` idiom:

- `translateContextUsage` maps the owned arm to its eleven fields and returns `null` for a sample of
  other arms, including `rateLimited` (the adjacent reading) and a `messageReceived`.
- The returned snapshot is a fresh object — `type` is absent, and the three arrays are the event's
  own references.
- `subscribeReportedContext` calls `setReportedContext` exactly once per owned event and never for an
  unowned one; the off-handle unsubscribes.
- An event carrying a `conversationId` that matches nothing is still written under its own key, and
  is not redirected to any other conversation.
- `ReportedContextData` server-renders to `''` without a `window.pyry` mock.

`clearPairingScopedState.test.ts` — the pinned key-set assertion gains `clearAllReportedContext`, the
called-once/called-with-nothing assertion is added, the before-`clearAllLastRead` ordering case is
added, and the real-store integration case seeds a reading and asserts it is gone.

No Playwright spec: nothing renders and there is no transition a user can drive. No fakes are needed
beyond the injected `onDaemonEvent` spy — there is no transport or IPC boundary in this slice.

## Open questions

1. **Does `#1421` need a whole-map read surface after all?** The AC forbids one, and this plan builds
   none. Resolve by confirming during implementation that the per-conversation selector is the only
   export that reads `readings`. *(Resolve in Phase B; record under Revisions if it changes.)*
2. **Does `App.test.tsx` pin the headless-leaf set?** A grep found no reference to `UsageLimitData`,
   so probably not. Confirm when the suite runs; if it does, the pin is updated rather than loosened.

## Revisions

**2026-09-15 — both open questions resolved; no design change.**

1. *Does #1421 need a whole-map read surface?* No, and none was built.
   `selectReportedContextFor` is the only export that reads `readings`; there is no `selectAll*`, no
   iteration over the map anywhere in the module, and no fallback to the active conversation. The
   `useReportedContextStore` hook takes an arbitrary selector, exactly as `useUsageLimitStore` does —
   that is the family's shape, not a surface this ticket adds.
2. *Does `App.test.tsx` pin the headless-leaf set?* No. It passes unchanged with the new leaf
   mounted, so no pin was loosened or edited.

**One departure from the plan's letter, decided during implementation and recorded here rather than
absorbed:** the `clearPairingScopedState` docblock's rotted ordinal was fixed by **dropping** the
count rather than correcting it, and the same edit was made to the pinned test's comment. The plan
named both options; this is the one taken, and the header now says why reinstating a total is not an
improvement. The seven pre-existing inline "thirteen in-memory clears" position notes were left
untouched as planned, and the new entry's own note is written count-free so it cannot rot.

A second, smaller departure: `reportedContextBridge.test.ts` captures its listener through a
`fakeBridge` helper with an `emit` closure (the `usageLimitBridge.test.ts` idiom) rather than a bare
`let listener`. A bare binding narrows to `never` after an assignment TypeScript cannot see inside the
callback, which `npm run build` catches and vitest does not.

## Documentation handoff

The ticket body carries no `## Documentation handoff` section and no documentation-only acceptance
criterion. The documentation stage owns:

- A new package overview for this store, mirroring `docs/knowledge/features/usage-limit-store.md`.
- Folding the lessons from this PR into that overview and updating
  `docs/knowledge/INDEX.md` / `CATALOG.md`.

**Pending for the documentation stage.** Not written here — this ticket edits no file under
`docs/knowledge/`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — the untrusted content is nested, and the held type is where the
  next reader stands.** The IPC boundary itself is #1419's and is unchanged; within this slice
  `translateContextUsage` is the single, named point where an event becomes a held snapshot. What the
  type system does *not* signal is which of the ten fields are untrusted: `model` is the only
  untrusted string on the record, and `name`, `server_name`, `path` and `type` are one level down
  inside rows. The arm's own docblock names the exact trap — a consumer who has internalised "the
  untrusted fields are the string-typed ones on the arm" handles exactly one of five. `ReportedContextReading`
  is what #1421 and #1254 import, not `@shared/ipc/events`, so in Phase B the three inventory fields
  on the held type must each restate their per-row prohibition at the point of declaration rather
  than delegating to the wire type: `name` is a label and not a handle to call anything by;
  `server_name` is inert despite spelling the same field as `MCPReconnectPayload.ServerName`, which
  does cross an actuation seam, and must never be fed to an MCP verb or joined against `mcp_status`;
  `path` is descriptive text and never an `href`, an `openExternal` target, a `path.join` argument, a
  filename or a cache key; `type` beside a `path` is a label and never a `switch` discriminant. The
  verifier should check these landed on the held type, not only in the module header.
- **[Trust boundaries] No findings on flow direction** — data moves main → renderer only. This slice
  adds no renderer → main path, so nothing the renderer holds can steer a privileged action.
- **[Tokens, secrets, credentials] No findings** — nothing on this path is generated, stored, rotated,
  revoked or compared as a credential. The content is nonetheless *disclosure*-sensitive rather than
  inert (`path` discloses who the user is and where they work; `server_name` discloses what the
  operator wired up), which is why the logging ban below is total rather than graduated.
- **[File / storage operations] SHOULD FIX — the store must be bare, with no zustand middleware.**
  There is no filesystem access, no path construction and no cache key anywhere in this slice, so
  traversal and TOCTOU do not arise. The live risk is *storage that arrives later by accident*:
  `persist` would land every held `path` and `server_name` in renderer web storage, where they would
  outlive the pairing that scoped them and survive `clearAllReportedContext` with every in-memory
  assertion still green, and `devtools` would publish the whole state to any Redux DevTools session —
  a process outside the app's trust boundary. `systemPromptStore` and `systemPromptWriteStore` already
  state this rule in that form. In Phase B: `createStore` is called bare, `createReportedContextStore`
  takes no storage port (unlike `createConversationLastReadStore`), and the module header states the
  prohibition so it is not re-decided.
- **[Inter-process / Electron attack surface] No findings** — no new `contextBridge` API, no
  `ipcMain` channel, no `BrowserWindow` `webPreferences` change, no custom protocol, no navigation or
  window-open handler. The transport, keys and Noise session stay in the background process and this
  slice adds no capability that could reach them: a renderer compromise gains the ability to write a
  context reading into a store nothing actuates on, which is the same posture as before.
- **[Cryptographic primitives] No findings, and one positive property worth naming** — this slice
  performs **no string comparison at all**. #1320's sharpest edge was its exact-equality test against
  `BENIGN_STATUS`, where a `startsWith` would have discarded the one reading that matters; there is
  no benign value here and so no comparison for a hostile string to steer. `Map.get` on
  `conversationId` is plain equality by design — nothing here is unguessable and nothing is a secret,
  so `timingSafeEqual` would claim a property it lacks.
- **[Network & I/O] OUT OF SCOPE — unbounded distinct-conversation-id growth under a hostile daemon,
  and this is the store it will bite first.** No socket, no timeout and no TLS decision belongs to
  this slice; the per-frame payload is bounded by `MAX_PLAINTEXT_BYTES` in `parseInboundMessage`
  ahead of every narrower, so no single frame is unbounded. What is unbounded is the *number of
  distinct daemon-minted `conversationId`s*, one map entry each, which is the accepted posture of
  `usageLimitStore`, `modelListStore`, `slashCommandListStore`, `conversationActivityStore` and
  `queueStore`, and which the pairing clear returns to zero. The honest difference: a record here is
  ten fields including three daemon-sized row arrays, where the precedent's is three scalars, so an
  entry is far fatter. No eviction policy is built — the precedent's header forbids building one for
  a failure nobody has observed, and a second lifetime would be one more thing to keep in agreement
  with the clear — but if a bound is ever warranted anywhere in this family, it is warranted here
  first, and that is a later ticket's call against a measured failure.
- **[Error messages, logs, telemetry] No findings — the ban is total and the one live leak path is
  the arm that is deliberately kept.** Nothing in this slice logs on any branch, including a
  content-free count of what a clear dropped; there is no reject branch and nothing throws. The one
  path by which this content could still reach a crash reporter is `timelineBridge`'s `assertNever`
  guard, which stringifies the **whole** event into an `Error` message — so a confused implementer
  reading "the arm is settled as PERMANENT" and *deleting* the `case` label would put every memory
  file path and every MCP server name into a stack trace. The Phase B edit there is comment-only and
  the `case` is retained; `npm run build` is what proves it.
- **[Concurrency] OUT OF SCOPE — a post-clear re-population is a property of the app-level leaf
  pattern, not of this store.** One subscription, one off-handle used directly as the effect cleanup
  (so a StrictMode double-mount nets one listener), no timers, no async work, no `AbortController` to
  thread. The check-then-act shape is closed by reading the map inside the `set` updater rather than
  through `getState()` outside it, so two frames arriving back-to-back cannot interleave. The
  residual: `ReportedContextData` mounts **above** the route switch, so it does not unmount when
  `PairedShell` does, and an event landing after `clearPairingScopedState` ran would re-populate the
  map. That is identical for `UsageLimitData`, `AnnouncedModelData` and every other app-level leaf,
  is a property of where the pattern mounts rather than of this slice, and is not introduced here.
- **[Threat model alignment] No new findings.** Malicious relay: content-blind and on-path, so it can
  drop, delay, reorder or flood `context_usage` frames — the consequence here is a stale, absent or
  repeated reading, and nothing branches on the content, so no behaviour is steerable. Hostile
  daemon: every string is held verbatim and reaches no sink in this slice; the render-sink discipline
  is inherited by #1421 / #1254 rather than discharged here, which is why finding 1 puts the
  prohibitions on the type those tickets import. Token theft and renderer-compromise-reaching-the-
  transport are unchanged by this slice, which adds no secret and no capability.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
