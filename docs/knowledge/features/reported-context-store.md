# Reported-context store

The renderer's held copy of **the latest context-window reading claude reported**, per conversation — a
dedicated, unidirectional Zustand store fed by a reactive-only headless observer, so the footer reading,
the gauge and the breakdown popover all read one figure per chat instead of each deriving its own.

Introduced in [#1420](../../specs/architecture/1420-reported-context-store.md), claiming
[#1419](daemon-event-channel-sealed-union-history-recent.md)'s carried `contextUsage` daemon event — which
[#1454](https://github.com/pyrycode/pyrycode-desktop/issues/1454)/[#1455](https://github.com/pyrycode/pyrycode-desktop/issues/1455)/[#1459](https://github.com/pyrycode/pyrycode-desktop/issues/1459)/[#1460](https://github.com/pyrycode/pyrycode-desktop/issues/1460)
decode off the daemon's `context_usage` frame and its three inventories — into a per-conversation store
plus its own bridge. [#1421](https://github.com/pyrycode/pyrycode-desktop/issues/1421) uses the held
reading in the footer and the run-configuration gauge, with settings-derived totals as the fallback
only when no reading exists.
[#1254](conversation-shell-composer-message-box.md#context-breakdown-popover-1254) turns the footer
reading into a button that opens a read-only breakdown of the held record.

**Named `reportedContextStore`, not `contextUsageStore` — a forced break with the family convention, for a
concrete collision rather than a stylistic one.** Every sibling here takes its name from its event arm
(`modelAnnounced` → `announcedModelStore`, `rateLimited` → `usageLimitStore`'s own documented break), which
would have made this `contextUsageStore` — but `src/renderer/src/screens/conversation/contextUsage.ts`
already exports `contextUsagePercent`/`contextUsageStep`, a percent **derived from `runConfigStore`'s
settings snapshot** (the run-configuration sheet's gauge and the pre-#1420 composer reading share it, and
both callers are untouched). This store is the separate, **pushed**, per-conversation figure claude
**reports** for itself — two different facts, both staying live. `reportedContextStore` says the
distinguishing fact; `selectReportedContextFor` cannot be misread as `contextUsagePercent` at a call site.
This is the second store in this family forced off the naming convention by a concrete collision
(`usageLimitStore` was the first, for `rateLimitStore`'s overclaim), which is worth noting for whoever
names the next one: check for an existing module of the "obvious" name before committing to it. Grep
discoverability is preserved: `translateContextUsage` names the arm, and both module headers cite the
frame.

## What it does

Holds, **per conversation**, the most recently arrived ten-field reading — `model`, the three totals
(`totalTokens`/`maxTokens`/`percentage`), and three `(inventory, droppedCount)` pairs
(`categories`/`droppedCategories`, `mcpTools`/`droppedMcpTools`, `memoryFiles`/`droppedMemoryFiles`) —
verbatim, replacing the whole record for that conversation's id on every new arrival. Nothing is
recomputed, re-sorted, de-duplicated or summed; the three inventories cross both the bridge and the store
**by reference**, pinned by `toBe` identity assertions in the tests rather than `toEqual` (which a
defensive `.slice()` would still pass). A verbatim repeat and a lower reading both land — the daemon fans
this out after every turn end whatever the window is doing, so a repeat is the signal that the reading is
still current and a fall is what a `/clear` or a compaction looks like.

A conversation id **absent from the map** is the distinct "no reading has arrived for this conversation"
state. A received reading whose three inventories are `[]` and whose three dropped counts are `0` is a
**real, degenerate reading**, held as-is and never collapsed to absence — the same `null`-vs-`''`/`null`-vs-
empty contract [usage-limit store](usage-limit-store.md) and the [session-id store](session-id-store.md)
use. That distinction is what lets the settings-derived pair stay the fallback on absence only, never on an
empty-but-present reading — the boundary [#1421](https://github.com/pyrycode/pyrycode-desktop/issues/1421)'s
`contextTokenSource` builds on, branching on `reported === null` alone so a present reading whose
`maxTokens` is `0` still wins rather than being read as an absence.

**Not a field on the thread-timeline record.** A context window is conversation-scoped, not turn-scoped: it
outlives a turn end, a `/clear` and a session transition. State a turn rebuilds would drop the reading at
the wrong moment and would cost every reducer arm ten extra fields to carry. This is the
`announcedModelStore`/`usageLimitStore` shape — a store beside a bridge, keyed by conversation id — and
`timelineBridge`'s `contextUsage` no-op, left DORMANT by #1419 pending this ticket's routing choice, is now
**PERMANENT**.

### The lifecycle has one exit, not three

`usageLimitStore`'s `rate_limited` arm carries a benign `allowed` status that ends a window, so that store
gets a per-key clear beside the whole-map one. `contextUsage` has no such value: **every frame is a
reading**, and a window that shrinks at a `/clear` or a compaction arrives as the **next frame** rather
than as an absence. A per-conversation clear would have no caller, so none was written —
`clearAllReportedContext` (the pairing-ended exit) is the only mutation beside `setReportedContext`.
`conversationDeleted` is not routed either, on `usageLimitStore`'s own rule: a delete-time drop is a later
ticket's question if it ever becomes one, and building an eviction policy for a failure nobody has observed
is what that store's header forbids.

## How it works

The receive bridge remains passive: it subscribes to `contextUsage` events and writes readings.
On each eligible [chat activation](paired-shell-conversation-exits.md#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166),
including reopening the same chat, `PairedShell`'s `activateDeps.requestConversationConfig` sends exactly one
`requestContextUsage` through `window.pyry.sendCommand`, immediately beside `requestRunConfigSnapshot`
and naming the same conversation. The connected-owner guard blocks unavailable or unresolved hosts;
the React-free sender also rejects null/empty ids. Created chats whose list row has not arrived use
the existing [deferred initialization](conversation-shell.md#created-chat-initialization).

Keep this ask at activation: adding it inside `requestRunConfigSnapshot` would also request context
on sheet opens and settings refreshes. Opening Run configuration sends no additional context ask.
The [outbound transport](daemon-connection-methods.md#public-surface) remains synchronous
fire-and-forget; main owns send diagnostics, and neither layer retries a failure, error or silence.
The bridge and store gain no request effect or pending state.

A reply for the chat replaces its held reading through the same receive path as unsolicited turn-end
reports. Both the footer and run-configuration gauge prefer that reading before any new turn through
`contextTokenSource`, keeping their existing visuals and absent-only transcript fallback. Reopening
does not clear the held reading while awaiting a reply. See the
[#1504 design](../../specs/architecture/1504-context-reading-on-chat-open.md).

### The store (`src/renderer/src/store/reportedContextStore.ts`)

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
  clearAllReportedContext: () => void   // the pairing-ended exit; takes NO id
}

createReportedContextStore(init?)              // vanilla createStore — one isolated instance per test
reportedContextStore                           // app-wide singleton
useReportedContextStore(selector)              // React binding
selectReportedContextFor(conversationId)(s)    // the only read surface — no second (time) argument
```

`usageLimitStore`'s DI-factory → singleton → hook → selector structure verbatim, with three deliberate
differences: ten held fields instead of three, with four of them (`categories[].name`, `mcpTools[].name`,
`mcpTools[].server_name`, `memoryFiles[].path`/`.type`) nested inside the three row arrays rather than flat
on the record; `ReportedContextSnapshot` **extends** `ReportedContextReading` rather than restating its ten
fields, so a field added later lands on both by construction; and the selector takes **no second
argument** — a usage-limit reading expires at an instant claude supplies, a context reading does not, so
there is no time input and no read-time rule beyond `?? null`.

`ReadonlyMap` is **mandated** and `Record<string, …>` **forbidden**, on
[`conversationActivityStore`](conversation-activity-store.md)'s rule (`Map.prototype.get('__proto__')`
performs no prototype-chain lookup; `set`/`delete` create and remove ordinary own entries). This store goes
one step further than its precedent: it builds **no index over any inventory at all** — the rows are held
as arrays and read in the producer's descending-token order, which is a stronger compliance with the arm's
`Map`-not-object rule than any index could be. A consumer that later wants one (a legend keyed by category
name, a panel grouped by `server_name`) inherits the obligation whole.

**Copy-on-write**, `usageLimitStore`'s idiom: clone the outer map, set the one key from a fresh named-field
literal, return a fresh state — never mutate `s.readings` or a held record in place, so a write for one
conversation leaves every other record `Object.is`-identical. The map is read **inside** the `set` updater
rather than through `getState()` outside it, closing the only check-then-act shape on this path.
`clearAllReportedContext` is nullary, `size === 0` guarded, and returns `initialReportedContextState` **by
reference** — the `clearAllUsageLimits` shape, and what makes the copy-on-write discipline load-bearing
rather than stylistic: a writer that ever mutated in place would poison the module-shared constant and hand
one pairing's readings to the next with no type error.

**Growth**, stated rather than defended: one entry per distinct `conversationId` seen since launch, each
holding a ten-field record with three daemon-sized row arrays — fatter than any sibling in this family
(three scalars for `usageLimitStore`). `MAX_PLAINTEXT_BYTES` in `parseInboundMessage` bounds every frame
ahead of every narrower, so a flooding relay costs one bounded entry per distinct id, and the pairing clear
returns that to zero. No eviction policy is built for a failure nobody has observed — if a bound is ever
warranted anywhere in this family, this store (being the fattest) is warranted first.

### The bridge (`src/renderer/src/store/reportedContextBridge.ts`)

```ts
translateContextUsage(event: DaemonEvent): ReportedContextSnapshot | null
subscribeReportedContext(onDaemonEvent, setReportedContext): () => void
ReportedContextData(): null
```

`announcedModelBridge`'s shape: receive-only, no send effect, no `connected`-edge trigger and no retry.
It accepts both unsolicited turn-end readings and replies to `request_context_usage` through the
same `parseContextUsagePayload` → `contextUsage` path. The reply's envelope `in_reply_to` identifies
the request on the wire, but the stored key comes only from the payload's `conversation_id`.
There is no pending-request lookup or substitution of the requested or active conversation id.
Optional `as_of` is ignored by the named-field parser and reaches neither the event nor the store;
displaying its meaning is separate work. Readings still replace by arrival order, with no timestamp
comparison or expiry.

The request errors `conversation.not_found` and retryable `context_usage.unavailable` keep generic
error handling upstream; neither produces a `contextUsage` event. This bridge ignores other event
arms, so an error neither clears a held reading nor fabricates one for an absent key. The outbound
method also never retries either error, a send failure or silence.

**One route, no comparison** — the sharpest contrast
with `usageLimitBridge`, which routes on an exact-equality test against a benign status: this arm has no
benign value, so the whole module is comparison-free and there is nothing for a hostile string to steer.
`translateContextUsage` returns a fresh named-field literal (never `return event`, never a spread) so
`type` never reaches the store, and `default: null` rather than `assertNever`, since ignoring every other
arm is this independent subscriber's permanent intended behaviour. There is deliberately no guard on
`conversationId`: an unrecognised id is written under its own key and read by nothing.

`ReportedContextData` mounts app-level in `App.tsx` beside `UsageLimitData`, not screen-scoped — the daemon
fans the frame out for whichever conversation ran, which may be one the operator has never opened, and a
reading can arrive long before #1421's footer is mounted. `window.pyry` is dereferenced only inside the
effect, so the leaf server-renders to `''` without a bridge mock.

### The pairing clear

`clearAllReportedContext` joins `ClearPairingScopedStateDeps` and is wired through `PairedShell.tsx`. No
`connected`-edge clear: after a reconnect the held value remains claude's last reported reading until
another arrives. The outbound request capability does not change that lifetime or guarantee a reply.
A pairing that has **ended** clears the map so a surface cannot attribute the departed machine's
model identity, MCP server names or memory-file paths to the new one while awaiting its first reading.
Position among the in-memory clears is free; it precedes
`clearAllLastRead`, the only effect that reaches outside memory and so the only one that can throw.

## Lessons learned (#1420)

- **A rotted ordinal is cheaper to delete than to maintain.** `clearPairingScopedState`'s docblock said "the
  fifteen effects" while the interface already carried sixteen — `clearSessionFacts` had landed in the
  interface without a matching bullet. Correcting the count to seventeen would only set up the next rot;
  the ordinal was dropped instead and the enumeration completed. The seven further inline "thirteen
  in-memory clears" position notes elsewhere in that file are stale for the same reason and were
  deliberately left alone as out of scope — the fix was the docblock's own count, not every count in the
  file.
- **A bare `let listener` in a bridge test narrows to `never`.** TypeScript cannot see the assignment that
  happens inside a subscribe callback, so every later `listener?.(event)` call is flagged "not callable" —
  caught only by `npm run build`, invisible to `vitest` (which strips types). `usageLimitBridge.test.ts`'s
  `fakeBridge` helper with an `emit` closure is the working idiom for this shape; reach for it first rather
  than after the build fails.
- **Settling an `assertNever`-guarded arm from DORMANT to PERMANENT is exactly when its disclosure risk is
  highest.** `timelineBridge`'s guard stringifies the *whole* event into an `Error` message. `contextUsage`
  is the largest arm on the union and the one carrying memory-file paths and MCP server names, so a future
  edit that reads "the arm is handled elsewhere now" and deletes the `case` label would put all of it into
  a stack trace and a crash reporter. The case must stay; only the comment above it changes.
- **Sized over the boundary on two counts (production files, total lines) and shipped as one ticket
  anyway, per the refiner's floor-over-ceiling ruling** — the store's only writer is its bridge, so neither
  half is independently verifiable and there was no seam to split on. Actuals: 6 production files, ~1350
  lines including the 441-line plan, finished well inside the run budget with no continuation leg — a data
  point *for* that ruling, not against it. See [#1320](usage-limit-store.md)'s identical call one arm
  earlier.

## Testing

`e2e/composer-context-claude-reading.spec.ts` holds the correlated on-open reply until both surfaces
show the transcript fallback, then verifies their replacement before any turn. An unsolicited
turn-end reading alone cannot prove the activation request. Unavailable-host checks observe
`window.pyry.sendCommand`: absent socket frames could otherwise hide a renderer send dropped by main.
The sender unit tests cover null/empty ids, repeated explicit asks and no scheduled retry.

## Edge cases and limitations

- **The untrusted content is nested, and that is the trap.** `model` is the only untrusted string directly
  on `ReportedContextReading`; `categories[].name`, `mcpTools[].name`/`.server_name` and
  `memoryFiles[].path`/`.type` are one level down, inside the three row arrays. A consumer that has
  internalised "the untrusted fields are the string-typed ones on the record" handles exactly one of five.
  The per-row prohibitions are restated on `ReportedContextReading`'s own docblock — not only delegated to
  `@shared/wire/types` — because this is the type #1421 and #1254 import.
- **`mcpTools[].server_name` is inert despite its name.** It spells the same field as the daemon's
  `MCPReconnectPayload.ServerName`, which crosses an actuation seam verbatim — but having the same spelling
  is not having its meaning. It must never be fed to an MCP verb (a reconnect, a tool invocation) or joined
  against `mcp_status`.
- **`memoryFiles[].path` is not a file handle.** Path-shaped descriptive text, never an `href`, a
  `shell.openExternal` target, a `path.join` argument, a filename or a cache key. The daemon constrains
  neither scheme nor shape, so a `javascript:` URI or a UNC path arrives as an ordinary `path`.
- **The six integers are figures, never sizes.** Never allocate, iterate or size anything from any of them
  — a dropped count counts rows that are *not* present, so the obvious "…and N more" rendering invites an
  array sized by an unbounded daemon number. `percentage` is not derivable from the totals, and the
  categories need not sum to either total.
- **No zustand middleware, ever.** `persist` would land every held `path` and `server_name` in renderer web
  storage, outliving the pairing that scoped them and surviving `clearAllReportedContext` with every
  in-memory assertion still green; `devtools` would publish the whole state to any Redux DevTools session.
  `createReportedContextStore` takes no storage port at all.
- **Nothing on this path is ever logged**, not even a content-free count of what a clear dropped. The
  grounds escalate across the frame: the integers disclose how much private work is in the window, a
  `server_name` discloses what the operator wired up, and a `path` discloses who the user is and where they
  work — and may legitimately contain a newline that would forge a record in a line-delimited diagnostic
  stream.
- **No whole-map read surface and no fallback to the active conversation.** `selectReportedContextFor` is
  the only export that reads `readings`. A reading carrying a `conversationId` nothing can select is held
  under its own key and read by nothing — do not add a `selectAll*`; it would surface exactly those stray,
  most-disclosive keys.

## Related

- [Usage-limit store](usage-limit-store.md) — the structural precedent this store follows verbatim (DI
  factory → singleton → hook → selector, `ReadonlyMap` mandated, copy-on-write, the clear returning initial
  state by reference, the independent-subscriber bridge posture) and the naming-convention break this store
  repeats for its own concrete collision.
- [Announced-model store](announced-model-store.md) — the earliest template for a per-conversation store
  beside a reactive-only bridge, and the origin of the app-level-mount rationale both stores restate.
- [Conversation activity store](conversation-activity-store.md) — the hostile-`Map`-key rule
  (`__proto__`/`constructor`/`''`) this store complies with more strongly than any sibling, by building no
  index over any inventory at all.
- [Paired shell](paired-shell.md) — `clearPairingScopedState`'s shared set and `PairedShell`'s wiring;
  `clearAllReportedContext` is its newest member.
- [Daemon-event channel — the sealed union: per-member history (recent
  members)](daemon-event-channel-sealed-union-history-recent.md) — the `contextUsage` `DaemonEvent` arm:
  the wire-to-IPC carry (#1419) and this ticket settling `timelineBridge`'s routing question.
- [#1420 architecture spec](../../specs/architecture/1420-reported-context-store.md) — this ticket's design,
  the sizing overage, and the security review (PASS, two SHOULD FIX both landed).
- `src/renderer/src/screens/conversation/contextUsage.ts` — `contextUsagePercent`/`contextUsageStep`, the
  settings-derived figure this store is deliberately **not** named after and does not replace; both stay
  live, computed from whichever pair wins. [#1421](https://github.com/pyrycode/pyrycode-desktop/issues/1421)
  made this store's reading the display source for the composer footer and the run-configuration gauge, the
  settings pair the fallback on an absent reading only — see
  [`contextTokenSource`](conversation-shell-run-configuration.md#run-configuration-context-window-section-192)
  and [Composer footer row](conversation-shell-composer-message-box.md#composer-footer-row-811).
  [#1254](conversation-shell-composer-message-box.md#context-breakdown-popover-1254) is the reading's own
  breakdown popover, reading this store's record directly and never the settings pair.
