# #1419 — carry the context usage reading across to the window

The carry step for `context_usage`: #1454 (the reading), #1455 (the category breakdown), #1459 (the
MCP-tool inventory) and #1460 (the memory-file inventory) decoded the frame into an inbound arm that
stops in the background process; this slice emits it as a `DaemonEvent` so renderer state can hold it.
The same step `rate_limited` took at #1319, `thinking_progress` at #1313 and `modal_shown` at #871.

## Files read

- `src/shared/wire/types.ts` → `ContextUsagePayload` — the eleven wire fields and every contract clause
  this arm inherits: mixed provenance within one struct (`conversation_id` daemon-authored, `model`
  claude-authored), the reading is informational and `percentage` is not derivable, each inventory is a
  plain array whose `[]` is a positive statement, each dropped count is independent and not inferable,
  and `0` is a value everywhere.
- `src/shared/wire/types.ts` → `ContextUsageCategory`, `ContextUsageMCPTool`, `ContextUsageMemoryFile`
  — the three row types that cross verbatim, and the per-row prohibitions the arm forwards: `name` is a
  label, `server_name` is inert despite colliding with the actuation-crossing `MCPReconnectPayload.ServerName`,
  `path` is path-shaped descriptive text and not a file handle, `type` is a label and never a discriminant.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage`'s `context-usage` arm,
  `parseContextUsagePayload`, `parseContextUsageCategory` / `parseContextUsageMCPTool` /
  `parseContextUsageMemoryFile` — what the decode family produced, that the arm takes no
  `FrameTimestamp`, and the fail-closed posture the emit sits behind. **Each row parser returns a fresh
  two- or three-field literal built from named `requireString` / `requireNumber` reads** — verified in
  the tree rather than taken from the ticket, because the whole pass-by-reference design rests on it.
- `src/main/daemonConnection.ts` → the inbound switch's `rate-limited` case — the immediately
  preceding carry and the shape precedent for the emit (fresh literal, fields by name, no `daemonTs`,
  explicitly stateless); `queueState` and `background-task-roster` beside it for the array half
  (`queued` / `tasks` pass through by reference, unmapped).
- `src/main/emitDaemonEvent.ts` → `emitDaemonEvent` — the log-free sink the emit goes through.
- `src/shared/ipc/events.ts` → `BaseDaemonEvent`, its `rateLimited` arm (the union's newest member,
  appended at #1319), `queueState` / `backgroundTaskRoster` (the `readonly` row-array convention),
  `DaemonEventTimestamp` / `WithDaemonTs` — where the new arm lands and why it carries no `daemonTs`.
- `src/renderer/src/store/daemonEventBridge.ts` → `translateDaemonEvent`;
  `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`;
  `src/renderer/src/store/modalBridge.ts` → `translateModalEvent`;
  `src/renderer/src/store/questionBridge.ts` → `translateQuestionEvent` — the four `DaemonEvent`
  switches ending in `assertNever`. **Re-derived from the tree rather than trusted from the ticket:**
  exactly four files carry a `case 'rateLimited'`, and since that arm is the union's newest a fifth
  exhaustive switch could not exist without one. `usageLimitBridge.ts` (#1320) is new since #1319 and
  is **not** in the set — it ends in `default`, as `timelineBridge`'s `timelineTargetFor` /
  `timelineWriteTarget` do.
- `src/main/daemonConnection.test.ts` → the `rate_limited` describe block, `rateLimitedPlaintext`, the
  local `connected(diagnosticLog?)` helper and `captureLog` — the round-trip test shape this slice clones.
- `src/main/transport/inboundMessage.test.ts` → `CONTEXT_USAGE_FRAME` / `CONTEXT_USAGE_EMPTY_FRAME` —
  the daemon's two committed captures, transcribed for this slice's fixtures. The adversarial values
  (`Messages <&>`, an embedded newline, `remote<mcp>`, `../../../etc/passwd`) are upstream on purpose.
- `src/renderer/src/store/questionBridge.test.ts` → the inverse-filter table's
  `expect(others).toHaveLength(43)` — the arm-count pin that moves with this union member.
- `docs/knowledge/features/daemon-event-channel-sealed-union.md` — the union's standing rules: a member
  reuses its wire payload type where one exists, top-level fields are snake→camel while **nested row
  types are reused verbatim with snake_case fields**, and `DaemonEvent` / `SessionAction` stay
  separately declared per layer. None is disturbed.
- `docs/specs/architecture/1319-rate-limited-ipc-carry.md` — the same slice one frame earlier; its
  Design, Testing strategy and Security review sections are the template.

## Design source

**Figma:** N/A — this slice adds no rendered surface. Nothing in the window draws the reading after it
lands; the store slice is #1420 and the surfaces are #1421.

## Context

The daemon's `context_usage` frame is claude's own report of how full the context window is, plus the
three inventories that say how it got that way. The decode family narrowed it into
`InboundDaemonMessage`'s `context-usage` arm, where it stops: `daemonConnection`'s inbound switch has
no catch-all, so an unclaimed kind is dropped. This slice claims it and emits a `DaemonEvent`, leaving
the reading where a renderer store can reach it. It ships **dormant** — the four exhaustive bridges
no-op it until #1420.

**Sizing — six production files, one over the ceiling, stated rather than split.** The arm on
`BaseDaemonEvent` compile-forces a case in each of the four `assertNever`-closed bridges, so the
minimum landable change is `events.ts` + `daemonConnection.ts` + four bridges. The only cut that
divides it — arm plus four bridge no-ops first, emit second — produces a first slice whose one
deliverable (a union arm nothing emits) is consumed by exactly one sibling in the same family. That is
the floor rule, and the floor beats the ceiling: merged back, overage recorded here, built as one
ticket. This is #1319's argument unchanged, and it held there. Every other boundary holds — **no new
exported type** (one arm on an existing union; the three row types are already exported from
`wire/types.ts`), five consumer edits, four acceptance criteria, no new reject branch, ~550 lines of
total written work.

No ADR is warranted: this arm settles nothing the union's existing rules do not already decide. The
one genuinely new question it raises — how the window reconciles this reading against the renderer's
existing `contextUsagePercent`, which derives one from session settings — is **#1421's**, and this
slice deliberately does not touch, read or reconcile against that function.

## Design

**The arm.** Appended to the end of `BaseDaemonEvent`, after `rateLimited`:

```ts
| {
    type: 'contextUsage'
    conversationId: string
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
```

All eleven wire fields cross. Unlike `rateLimited`, nothing is left behind: every field has a consumer
in #1420/#1421 by the ticket's own contract, and the frame carries no truncation marker to drop.

- **Top-level fields are snake→camel; the three ROW TYPES are reused VERBATIM with their snake_case
  fields.** That is the settled house rule for nested arrays, with two precedents directly above
  (`queueState.queued: readonly QueuedItem[]` and `backgroundTaskRoster.tasks: readonly BackgroundTask[]`):
  the row narrower already stripped each row to its known fields, so there is nothing to drop and no
  mapping to write. `server_name` therefore crosses spelled that way, inside its row, while
  `mcp_tools` → `mcpTools` and `dropped_mcp_tools` → `droppedMcpTools` at the top level. The acronym
  lowercases in a *field* name (mechanical snake→camel) while staying capitalised in the *type* name
  (`ContextUsageMCPTool`), which is the existing split rather than a new one.
- `readonly` on each array, mirroring both precedents; the row interfaces themselves stay mutable,
  exactly as `QueuedItem` and `BackgroundTask` do.
- **`ContextUsageCategory` / `ContextUsageMCPTool` / `ContextUsageMemoryFile` are added to
  `events.ts`'s existing `import type { … } from '../wire/types'`** — the union's standing rule that a
  member reuses its wire payload type where one exists, and no new exported type is minted.
- **No `daemonTs`.** The `context-usage` decode arm takes no `FrameTimestamp` — that mix-in marks the
  arms `decodeHistoryEvent` draws, which need (`type`, `ts`) as the join key between a served page and
  the live stream, and this type is armless there. Stamping it would advertise a join nothing can
  perform. `rateLimited` and `thinkingProgress`, not `apiRetry`, are the precedent for the literal's shape.
- `conversationId` is **required**, never optional — an optional routing key invites
  `?? activeConversation` fallbacks, the misattribution the per-conversation work exists to remove.
- **Nothing is narrowed, normalised or allow-listed on this boundary.** `model`, every row label, every
  `server_name`, every `path` and every `type` cross verbatim. `type` in particular stays an open
  string: a client-side closed set fail-closes a valid future frame, which CLAUDE.md / ADR 0002 rank
  above cosmetic robustness.
- **`0` and `[]` are values, never absences.** Nothing on this leg tests any integer or any array for
  truthiness, and the contract forbids a consumer doing so.

**The arm's contract** (docblock on the union member, in the file's established style). Beyond the
above it records, per AC1 and AC4:

- **A reading, not a state transition** — no `turn_id`, opening and closing no turn, so daemon STATE by
  the `queueState` rule (#720). Fanned out after every turn end on the interactive path.
- **Mixed provenance within one arm**, the field-level fact a reader is likeliest to get wrong:
  `conversationId` is daemon-authored (the mapper fills it from the daemon's own registry), `model` is
  claude-authored descriptive text. Assuming one provenance for the whole arm promotes `model` to a
  value it was never checked to be.
- **The reading is informational and does not reconcile** — `percentage` is not derivable from
  `totalTokens` / `maxTokens`, the categories need not sum to the total, and a retained list's length is
  no evidence about its dropped count. `list.length + its OWN dropped count` is that inventory's true
  size; no count is evidence about another.
- **Never allocate, iterate or size from any of the six integers** (`attachment_chunk`'s rule).
  Sharpened for this arm: `droppedCategories` is a count of rows that are *not present*, so
  `Array(droppedCategories)` to render "3 more…" is an allocate-from-a-claim on an unbounded
  daemon-supplied number. Render the figure, never a structure sized by it.
- **The three row prohibitions forwarded verbatim**: `name` is a label; `server_name` is inert and must
  never be fed to an MCP verb or joined against `mcp_status` on the strength of appearing here; `path`
  is not a file handle — never an `href`, an `openExternal` target, a `path.join` argument or a
  plain-object key; `type` is a label, never a discriminant to `switch` on. **If a consumer indexes any
  inventory by any string, the index is a `Map`** — `__proto__` and `../..` are ordinary values in all
  three.
- **Rows arrive as a prefix in the producer's descending-token order**, any cut taking entries off the
  tail — so re-sorting or de-duplicating destroys the only ordering signal a consumer gets.
- **`model` is not an identity**: `modelAnnounced` remains the authority on which model is running.
- **Nothing decoded reaches a log**, with the escalating grounds the wire type states.

**The emit.** A `case 'context-usage':` in `daemonConnection`'s inbound switch, placed to mirror
`InboundDaemonMessage`'s own arm order. It builds a fresh eleven-property literal with each field
copied **by name** from `inbound.contextUsage` — never a spread of the decoded record, so a decoder
that later grows a field cannot smuggle it across IPC.

**The three arrays pass through by reference, unmapped**, which is the `queued` / `tasks` precedent and
is safe *here* for a reason verified in the tree rather than assumed: `parseContextUsageCategory`,
`parseContextUsageMCPTool` and `parseContextUsageMemoryFile` each build a **fresh two- or three-field
literal** from named `requireString` / `requireNumber` reads, so no reference to the `JSON.parse`
result survives into the array, there is nothing left to strip, and a key planted inside a row cannot
ride across. That is a property of the decoder, not of this emit, so the test plan pins it from this
side too. Had any row parser returned its input, this design would instead have to re-map each row.

That inner switch has no `assertNever`, so nothing compile-forces this case; the round-trip test is
what guards it, which is why it is the first test written.

**Statelessness is the contract, not an omission.** No dedup, no coalescing, no timer, no last-value
memo, and none keyed by `conversationId` — one event per decoded frame, verbatim repeats included. The
daemon fans this out after every turn end, so consecutive frames legitimately repeat and legitimately
*fall*: a window shrinks at a `/clear` or a compaction. A suppressor that ate a repeat would starve the
consumer of the report that says the reading is current, and one that filtered a drop would eat
ordinary traffic — the `thinking_progress` mistake one arm over, where `estimated_tokens` restarts near
zero four times inside a single committed capture.

**The four bridges.** Each ends its `DaemonEvent` switch in `assertNever`, so each needs a case or
`npm run typecheck` reddens; all four land in this commit.

| Bridge | Disposition |
|---|---|
| `translateDaemonEvent` (`daemonEventBridge.ts`) | PERMANENT no-op — the session store holds *connection* status, and how full the context window is is orthogonal to whether the socket is up. There is no status scalar here for a reading to flip, the `rateLimited` / `thinkingProgress` grounds. Own case, appended before `default`. |
| `translateTimelineEvent` (`timelineBridge.ts`) | DORMANT — whether the reading draws as thread chrome (the `apiRetry` / `compacting` / `thinkingProgress` route) or through a subscriber of its own (the `questionShown` / `rateLimited` route) is #1420's call. Joins the existing null fall-through group. |
| `translateModalEvent` (`modalBridge.ts`) | PERMANENT no-op — nothing daemon-side is waiting on an answer and there is no `modal_id` to resolve it against. Joins the null group. |
| `translateQuestionEvent` (`questionBridge.ts`) | PERMANENT no-op — unsolicited, nothing outstanding, no answer to give: the `rateLimited` / `thinkingProgress` reading of that group, not the history one. Joins the null group. |

`usageLimitBridge` (#1320) is the newest `DaemonEvent` consumer and is deliberately **not** touched: it
ends in `default`, so it is not compile-forced, and claiming the arm there would decide #1420's
question for it.

**No store is written differently than before this slice** (AC3). All four translators return `null`.

## State + concurrency model

None added. The change is one union member, one synchronous `switch` case that calls the existing
`emitDaemonEvent`, and four `return null` cases. No task is launched, no timer set, no listener
registered, no store slice created — so there is nothing to cancel, nothing to tear down on window
close, and no check-then-act window across an `await`. The three arrays are handed on by reference and
never retained, copied or mutated on this leg.

## Error handling

Inherited, unchanged. `parseContextUsagePayload` is fail-closed upstream: a missing or mistyped field
— at the top level or inside any row of any inventory — throws `WireDecodeError`, which
`parseInboundMessage`'s caller already catches and drops without emitting. So a malformed frame
produces no event and no throw, and the emit is reached only with an already-validated payload. This
slice adds no new failure mode and no new error surface: the emit cannot fail, and the four bridges
return `null` rather than throwing.

## Testing strategy

Vitest only (node environment). No renderer render and no Playwright spec: nothing is drawn.

- **`src/main/daemonConnection.test.ts`** — a new `context_usage` describe block beside the
  `rate_limited` one, with a `contextUsagePlaintext` helper cloned from `rateLimitedPlaintext` and
  fixtures transcribed from the daemon's two committed captures (the full frame with its adversarial
  strings, and the all-empty one):
  - a decoded full frame emits exactly one `contextUsage` event, asserted with a strict `toEqual` on
    the whole event (the AC1/AC2 round trip; positive, so it also pins the absence of `daemonTs` and
    that every row crosses byte-for-byte — `Messages <&>`, the embedded newline, `remote<mcp>` and
    `../../../etc/passwd` included, unescaped and unnormalised).
  - `Object.keys(...).sort()` on the emitted event proves the eleven camel keys and nothing else; a
    smuggled top-level key does not cross. **Paired with the sharper version this arm needs and
    `rateLimited` did not: a smuggled key planted INSIDE a row of each of the three inventories also
    does not cross** — the assertion that pins the fresh-row-literal property the pass-by-reference
    design rests on, from this side of the decoder.
  - **empty inventories beside non-zero dropped counts** (AC4): `categories: []` / `mcp_tools: []` /
    `memory_files: []` with `dropped_categories: 3`, `dropped_mcp_tools: 5`, `dropped_memory_files: 7`
    all cross unchanged. These are the assertions that redden if someone later reads an empty list as
    proof nothing was dropped, or collapses `[]` into `null`.
  - **a frame for an unknown conversation is still carried** (AC4) — an id matching no conversation
    this client knows emits exactly as any other does. Retention is #1420's decision, and the transport
    must not pre-empt it by filtering.
  - the open sets survive the crossing: an unrecognised `model`, a row `type` outside any known set, and
    the empty string for each cross unchanged — the assertions that redden if someone narrows either.
  - the six integers cross unpoliced: `0` everywhere (the all-empty capture), a `percentage` over 100, a
    `total_tokens` exceeding `max_tokens`, a `max_tokens: 0` beside a non-zero total, and a negative.
  - **no dedup:** two identical frames emit two events, and a falling reading followed by a verbatim
    repeat emits all three in wire order.
  - **logs nothing decoded on any path** (AC3): a frame carrying distinctive values for the id, `model`,
    a `server_name` and a `path`, asserted absent from every captured diagnostic record, with a
    non-vacuity assertion that the frame nonetheless produced its `inbound-decoded` record under the
    client-owned `code` literal. Uses the block's local `connected(diagnosticLog?)` helper.
  - a malformed frame (a JSON-string `total_tokens`, and separately a mistyped field inside one row)
    emits nothing and does not throw.
- **The four bridge specs** — `daemonEventBridge.test.ts`, `modalBridge.test.ts`,
  `questionBridge.test.ts`, `timelineBridge.test.ts` each gain a `contextUsage` → `null` assertion in
  the shape each file already uses for `rateLimited` (an inline literal in the inverse-filter table for
  three of them; a named `it` for `daemonEventBridge`). `questionBridge`'s arm-count pin moves 43 → 44.
  `timelineBridge`'s adds the store-identity half its `rateLimited` test used (`store.getState()` is the
  same ref, and no item was appended), which is what makes AC3 an assertion rather than a claim.

Fakes, not mocks, throughout: the existing driver fake feeds plaintext, the existing `fakeBridge` feeds
the bridges.

## Open questions

- Which store #1420 claims the arm into — a dedicated store plus an independent subscriber (the #1320 /
  `usageLimitStore` shape) or an existing one. Recorded as DORMANT on `timelineBridge` rather than
  decided; the disposition comment says #1420 owns the choice, so either outcome falsifies no claim here.
- How the reading reconciles against the renderer's existing `contextUsagePercent`, which derives one
  from session settings. Explicitly **#1421's**, named in § Context and left untouched here — this
  slice reads neither that function nor its inputs.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings on the boundary itself; this slice crosses already-narrowed values
  over an existing boundary and adds no new one. The narrowing happened at `parseContextUsagePayload`
  and its three row parsers. The standing rule binds and is worth restating because the type system
  carries no signal for it: **decoding made the SHAPE trusted, not the CONTENT.** What is new here and
  has no precedent on this union is that the untrusted content is now **nested inside three arrays**
  rather than sitting in flat scalar fields — up to two or three untrusted strings per row, per
  inventory — so a consumer that has internalised "a `DaemonEvent` arm's untrusted fields are the
  string-typed ones on the arm" will miss every one of them. The arm's docblock therefore forwards the
  per-row prohibitions explicitly rather than delegating to the wire type.
- **[Trust boundaries]** No finding, but the load-bearing verification is recorded rather than assumed:
  the three arrays cross **by reference**, and that is safe only because each row parser returns a
  fresh literal built from named `requireString` / `requireNumber` reads. This was **checked in the
  tree**, not taken from the ticket, because had any parser returned its input record, a `__proto__`
  planted as an own data property inside a row would ride across IPC into whatever index #1420 builds.
  It is additionally pinned from this side by the smuggled-key-inside-a-row test, so a future decoder
  change that broke the property reddens here.
- **[Trust boundaries]** SHOULD FIX, binding on #1420/#1421 and recorded so it stays findable: **if any
  inventory is indexed by any of its strings, the index is a `Map`, never a plain object, and never a
  React `key` either.** All three inventories invite exactly this — a legend keyed by category name, a
  panel grouped by `server_name`, a list keyed by `path` — and `__proto__` and `../..` are ordinary
  values in all three. Nothing on THIS leg indexes anything: the arrays are handed to `emitDaemonEvent`
  and all four bridges discard the event.
- **[Tokens, secrets, credentials]** Not applicable, structurally. No field is a credential, a nonce or
  a correlation secret — the contrast is `question_shown`'s `question_batch_id`, an unguessable
  one-time nonce, and there is no analogue here. The no-log rule below therefore rests on
  disclosure-, correlation- and integrity-leak grounds only, never on secrecy.
- **[File / storage operations]** The sharpest category on this arm, and the reason it is worth the
  label even though nothing here touches a filesystem. **`path` is path-shaped descriptive text and not
  a file handle**, and #1419 is where it first crosses `contextBridge` — the wire docblock says so in
  those words. The daemon's own committed fixture carries `../../../etc/passwd` deliberately, and this
  leg passes it byte-for-byte: unjoined, uncleaned, unresolved, unnormalised. That is correct and is
  the operator ruling of 2026-08-20 (escaping and any resolution are owed at the sink, and doing either
  at a carry corrupts the value for every non-HTML sink while buying false safety at the real one).
  No finding on this leg, since no code here has a path to join it into. SHOULD FIX forward to
  #1421: **never an `href`, never a `shell.openExternal` target, never a `path.join` argument, never a
  filename or cache key.** A path-shaped string is not a path-constrained one — the daemon constrains
  neither scheme nor shape, so a `javascript:` URI, a `file://` URL and a UNC path all arrive as an
  ordinary `path`. Nothing is persisted by this slice.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, no `contextBridge` API and
  no `ipcMain` handler is added — the arm rides the existing `DAEMON_EVENT_CHANNEL` through
  `emitDaemonEvent`, whose sink discipline is untouched, and `webPreferences` is not touched. The event
  is structured-clone-safe by construction: six numbers, one string, and three arrays of plain
  two/three-field objects whose fields are all scalars. No function, no `Buffer`, no key and no raw
  frame can ride it, and its whole top-level surface is enumerated by the exact-keys assertion in the
  test plan. This arm is the **largest** on the union, which is worth stating and then dismissing: the
  frame-level `MAX_PLAINTEXT_BYTES` guard (65519) in `parseInboundMessage` plus the daemon's own
  frame-byte budget bound it twice before it reaches here, and **no second bound is invented on this
  boundary** — a cap here would silently truncate a legitimate inventory and would be a client-side
  re-decision of a daemon-side cap the contract forbids. Process placement is unchanged and correct.
- **[Cryptographic primitives]** Not applicable — no key, nonce, handshake, RNG or comparison is added
  or re-derived.
- **[Network & I/O]** No findings, and one inherited obligation sharpened rather than forwarded blindly.
  All six integers are unbounded, unvalidated, claude-authored numbers; the standing rule is **never
  allocate, iterate or size anything proportional to one** (`attachment_chunk`'s never-allocate-from-a-claim).
  This arm creates a trap `rateLimited` did not have and it is named so #1421 meets it in writing: a
  **dropped count is a count of rows that are not present**, so the natural "…and 3 more" rendering
  invites `Array(droppedCategories)` or a loop to that bound — an allocation sized by a hostile number.
  Render the figure; never a structure sized by it. Two more formatting traps ride along: `maxTokens: 0`
  yields `Infinity` from the obvious ratio (the renderer's own `contextUsagePercent` already documents
  this), and `percentage` must never be recomputed — a client that recomputes disagrees with the figure
  claude reported, which is the whole reason this frame exists. **This leg schedules, allocates and
  iterates nothing**: every value is copied or referenced into a literal and handed to an existing sink.
  A hostile daemon **can** flood this frame, and the tempting defence (a rate limit, a coalescing timer,
  a last-value memo) is **rejected on purpose** — it would be the only mutable state on this path, keyed
  by a daemon-supplied id and fed by a daemon-supplied stream, and the daemon fans this out after every
  turn end, so a suppressor would eat the report that says the reading is current. The blast radius is
  one bounded literal per frame handed to an existing sink; AC3's no-dedup test pins the refusal.
- **[Error messages, logs, telemetry]** No findings, and this arm carries the union's strongest
  no-log grounds. `emitDaemonEvent` is log-free by construction and the decode-side line is pinned
  content-free, so nothing decoded reaches a log on any path. The grounds **escalate across the frame**
  and all four are real: the three integers disclose how much private work is in the window; each
  per-row figure discloses how the window is *composed* rather than merely how full it is; a
  `server_name` is **workspace configuration**, disclosing what the operator wired up, so a server named
  after internal infrastructure must not ride into a bundle an operator may send off-box; and a `path`
  is the strongest — it discloses **who the user is and where they work** (the daemon's own fixture
  value leaks a home-directory username and a project name). The exclusion is also an **integrity**
  rule, not only a privacy one: the diagnostic stream is line-delimited JSON, and both the MCP
  fixture's embedded newline and the newline a POSIX path may legitimately contain could **forge a
  record**. No error message is minted here and none interpolates a value. The one route by which any
  of this could still reach an `Error` message, a stack trace and a crash reporter is a **missing
  bridge case** — `assertNever` stringifies the whole event — and that is the sharpest instance of the
  argument on this union, because this event is the largest and carries the most disclosive fields of
  any arm. It is exactly why all four cases land in this commit rather than any subset.
- **[Concurrency]** Not applicable, stated rather than assumed: one union member, one synchronous
  `switch` case, four `return null` cases. No task, no timer, no listener, no shared mutable state, no
  `await` — nothing to cancel, nothing to tear down, no check-then-act race. The arrays are neither
  retained nor mutated here, so no consumer can observe one changing under it.
- **[Threat model alignment]** Addressed. *Hostile daemon response:* fail-closed upstream and unchanged
  — a malformed frame, including one malformed only inside a single row of one inventory, throws before
  the emit is reached and leaves no record; the fresh-literal emit and the fresh row literals together
  block a planted `__proto__` from riding across. A hostile daemon's remaining power is arbitrary label,
  `server_name`, `path`, `type` and `model` text plus arbitrary integers, which is *by design*: the
  frame is a **report, never a control input**, and this client must hold that line — **no
  security-relevant behaviour may branch on any of it**, which the arm's docblock states. The
  `server_name` collision is the concrete instance and is called out on the arm: it spells the same
  field name as the daemon's actuation-crossing `MCPReconnectPayload.ServerName`, and having the same
  spelling as a field that actuates is not having its meaning. *Malicious relay:* on-path but
  content-blind; it can drop, delay, reorder or duplicate, and this arm carries no state transition, so
  a dropped frame loses a reading and a duplicate repeats a harmless one — which is why "absence proves
  nothing" is a security property here and not only a UX note. *Renderer compromise reaching the
  transport:* unchanged — no new renderer-reachable surface, and the arm is one-directional.
  *Prototype pollution:* nothing on this leg uses any string as a key at all.
- **[Threat model alignment]** OUT OF SCOPE, named rather than silently deferred, all for #1420/#1421:
  whether a consumer may attribute a reading to a conversation it does not host (deferred forward one
  hop with its reason restated, since all four translators still discard the event — and AC4 requires
  the transport carry an unknown-conversation frame precisely so the store, not the transport, makes
  that call); the render sink where every untrusted string on this frame is finally escaped; and the
  reconciliation against the renderer's existing `contextUsagePercent`, which is #1421's by the
  ticket's own words.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
