# 973 — carry the published model list across IPC as a typed `DaemonEvent` arm

## Files read

- `src/shared/wire/types.ts` → `WireModelOption`, `ModelListPayload` — the row and payload shapes this
  arm carries, and the docblocks stating the three-positions-on-empty rule, the truncation contract,
  and the claude-authored trust tier the arm's own doc must restate on IPC ground.
- `src/main/transport/inboundMessage.ts` → `parseModelListPayload`, the `model-list` arm of
  `InboundMessage` — #972's fail-closed decode, the value this slice claims. Its docblock says in as
  many words that nothing consumes the arm yet and that `daemonConnection`'s inbound switch has no
  catch-all.
- `src/main/daemonConnection.ts` → the `case 'slash-command-list'` route — the exact precedent for the
  emit: a fresh named-field literal, top-level snake→camel, rows by reference, no log call.
- `src/shared/ipc/events.ts` → the `slashCommandList` arm — the arm-doc template and the end-of-union
  placement rule for a frame that opens its own family.
- `src/renderer/src/store/daemonEventBridge.ts` → `translateDaemonEvent`; `modalBridge.ts` →
  `translateModalEvent`; `questionBridge.ts` → `translateQuestionEvent`; `timelineBridge.ts` →
  `translateTimelineEvent` — the four switches over `DaemonEvent` that close with `assertNever(event)`.
  These are the compile-forced consumers.
- `src/main/daemonConnection.test.ts` → `slashCommandListPlaintext` and its `describe` block — the
  round-trip test shape this slice mirrors, including the smuggled-key and empty-list cases.
- `src/renderer/src/store/daemonEventBridge.test.ts`, `modalBridge.test.ts`, `questionBridge.test.ts`,
  `timelineBridge.test.ts` → the four no-op assertions for `slashCommandList`.
- `docs/knowledge/features/model-list-wire-types.md` § "Delivery window — two lanes" — the frame is
  narrow and lossy in delivery, which is why no consumer may block a menu on it. The overview also
  records that a section surviving a sibling's correction pass is the likeliest stale one.

## Context

The daemon publishes the models claude will accept for a conversation. #971 modelled the wire types and
#972 decoded the frame fail-closed into an `InboundMessage` arm; the decoded value stops in the
background process today. This slice carries it across the internal channel as one more arm of
`DaemonEvent`, so the store below it (#974) and the run-configuration sheet below that can consume a
typed value without touching a socket or a raw frame.

The precedent is exact and recent: #937 did the same carry for `slash_command_list`, the sibling frame
riding the same `initialize` control reply. This plan follows its route, its arm placement, and its test
shape.

No ADR is warranted. This adds a member to an existing union under settled house rules; the rules it
follows (fresh named-field literal, verbatim rows, required fields, `readonly` array) are already
recorded in the `daemon-event-channel-sealed-union` overview and in the arm docs themselves.

## Sizing note — kept whole, two table lines exceeded

Production files is **6** against a ceiling of 5, and total written work is **~850** against 800. Both
overages have one cause: four of the six files are a one-case-each addition **compile-forced by
`assertNever(event)`**, and the tests covering those four cases plus the route carry the line count.

No valid split exists, and this is not a coupling judgement. Adding the union arm without the four
bridge cases fails `tsc`, so a "union arm" child would ship a red `npm run build` — the salvage gate —
and a "bridge no-ops" child would ship cases for an arm that does not exist. Neither child could be
verified on its own, which is the floor rule, and the floor wins over the ceiling.

The split-depth gate also forbids a split independently: #973's parent is #561 and its grandparent is
#556, so the chain is already two deep. `needs-human:sizing` is on the ticket; the build proceeds.

The remaining four table lines are comfortably inside the boundary: 0 new exported types (the arm is a
member of an existing union and `WireModelOption` already exists), 4 consumer call sites against 10, 5
acceptance criteria against 5, and 0 new reject branches — the decode already rejected upstream.

## Design

### The union arm — `src/shared/ipc/events.ts`

One member appended at the end of the `DaemonEvent` union, after `slashCommandList`, for that arm's own
stated reason: this frame opens its own family and has no mid-file neighbour to sit beside.

```ts
| {
    type: 'modelList'
    conversationId: string
    models: readonly WireModelOption[]
    droppedModels: number
  }
```

`WireModelOption` joins the existing `import type` block from `../wire/types`.

**The name is a noun naming the snapshot**, following `slashCommandList` and `backgroundTaskRoster` and
deliberately not a `…Received` participle. The union's `…Received` arms (`conversationsReceived`,
`recentWorkspacesReceived`) name a reply to a request *this client made*; this frame is unsolicited — it
rides a `control_response` but is not correlated by this client's outstanding-request memory, so it is
emitted unconditionally on decode.

**All three fields are required and the array is `readonly`.** An assigned `undefined` survives the
structured clone across this channel, so an optional field would invent an absence case the daemon never
produces and make a later `'droppedModels' in event` check read true on an event carrying nothing.
`readonly` mirrors `queueState` and `slashCommandList`; `WireModelOption` itself stays a mutable
interface, exactly as `QueuedItem` and `BackgroundTask` are.

### The arm's doc — the contract the AC names

The docblock states, on IPC ground rather than by pointing at the wire type:

- **Per-field provenance.** `conversationId` is daemon-asserted, an outbound display-scoping key only —
  it is what lets a client with several live conversations avoid showing one conversation's menu in
  another. It grants no inbound capability and is not a nonce, the posture `modal_shown` and
  `question_shown` carry. Every string on a row — `resolved_model`, `value`, `display_name`, and every
  string in `effort_levels` — is **claude-authored** text that crossed the subprocess trust boundary,
  and **decoded is not sanitized**: #972 made the shape trusted and nothing more, so the render boundary
  owes the escaping.
- **The truncation contract.** `models.length + droppedModels` is the menu's true size; the list is cut
  **from the tail**, so the carried rows are claude's first N in claude's own order; each row's
  `truncated_fields` is that row's own report, where `null` and `[]` mean different things and neither
  may be folded into the other.
- **The three positions on empty**, because one frame states all three and a reader who assumes one rule
  gets two of them wrong: `models: []` is a positive statement that claude offered nothing;
  `effort_levels: []` on a row is a collapse; `truncated_fields` is exempt from normalisation entirely.
- **The two neighbouring `model` fields and how this one differs.** `runConfigReceived.model` is the
  per-session **override**, where `''` means "inherited default, no override"; `modelAnnounced.model` is
  what claude announced **for the current turn**. This arm's rows are a third meaning — the **menu**.
  Exactly two, not three; no count is transcribed from neighbouring prose.
- **The producer's ten-entry cap is a daemon-side producer cap, not a wire constant.** Nothing may
  hardcode it, treat a list of exactly ten as a signal, or derive truncation from anything but
  `droppedModels`.

### The route — `src/main/daemonConnection.ts`

A `case 'model-list':` in the inbound switch, structurally identical to `case 'slash-command-list'`:

```ts
emitDaemonEvent(sink, {
  type: 'modelList',
  conversationId: inbound.modelList.conversation_id,
  models: inbound.modelList.models,
  droppedModels: inbound.modelList.dropped_models
})
```

Two rules govern this emit and they pull in opposite directions; stating either alone is worse than
stating neither.

1. **The event object is a fresh named-field literal** — never `return event`, never a spread of the
   decoded payload. Top-level fields are snake→camel and the wire `type` does not cross. This keeps the
   emitted event immune to the wire payload gaining an unrelated field later.
2. **The rows are reused verbatim and pass across by reference** — snake→camel applies at the **top
   level only**, so each row keeps its wire spelling (`resolved_model`, `value`, `display_name`,
   `effort_levels`, `supports_auto_mode`, `truncated_fields`). Five precedents: `queueState`,
   `conversationsReceived`, `backgroundTaskRoster`, `questionShown`, `slashCommandList`. This is safe
   because `parseModelOption` already rebuilds every row as a fresh six-field literal, so there is
   nothing left to strip and no per-row mapping to write. Do not "fix" this into a `.map` that
   camelCases the rows — the fresh-literal rule governs the *event object*, and deep-remapping the rows
   would break the verbatim-row rule instead.

Every field is read **bare** — no `??`, no `|| 0`. The decode requires all three, so a missing or
wrong-typed one drops the whole line upstream of this emit; a `?? ''` would turn that fail-closed drop
into a menu filed against the wrong conversation, and a `|| 0` on the count would turn a real defect into
a plausible zero. Nothing recomputes or cross-checks `droppedModels` against `models.length`.

**No log call**, following the sibling. #972's decode already emitted the content-free `inbound-decoded`
record with a hash and a byte length, and this leg is where a claude-authored `display_name` would reach
a sink. The never-into-a-log clause rests here on the **contract** — the daemon bounds these strings and
does not sanitize them, so a control byte is permitted rather than excluded — and not on `WireSlashCommand`'s
measured `0x0a` across 51 workspace-authored entries. That measurement is the sibling's and does not
transfer. Deliberately no `count` of models either: how many models claude offers for a session is
itself a fact about that session.

### The four bridges — permanent no-ops

`daemonEventBridge.ts`, `modalBridge.ts`, `questionBridge.ts` and `timelineBridge.ts` each switch over
`DaemonEvent` and close with `assertNever(event)`. Each gains one `case 'modelList':` returning `null`.
(`git grep 'assertNever(event)'` returns about eleven source files; the other seven close over
`ModalEvent`, `NewFolderEvent`, `QuestionBatchEvent`, `QuestionPickEvent`, `RunSettingsWriteEvent`,
`ThreadEvent` and `PairingEvent`. Several shipped doc comments in this tree still say "all **three**
exhaustive bridges" — stale prose that fails no typecheck, and not to be transcribed.)

**These cases are a security control, not bookkeeping.** `assertNever` stringifies the whole event into
an `Error` message, so an arm that fell through would feed every claude-authored `display_name`,
`value` and `resolved_model` on the frame into a thrown error. The no-op case is what stops that, which
is why it lands with the arm rather than with the consumer.

**Documented as PERMANENT, not dormant** — and unlike the sibling this is already decided rather than
deferred. #937 shipped its cases dormant because whether #938 would subscribe through an existing bridge
was #938's call. Here the consumer has answered: #974 commits to a dedicated subscriber in the
`announcedModelBridge` / `backgroundTaskRosterBridge` / `slashCommandListBridge` posture, so none of the
four will ever own this arm. Each case's comment says so in its own bridge's vocabulary:

- `daemonEventBridge` — no session-store action; the session store holds no model-menu state at all.
- `modalBridge` — not a modal event: nothing is waiting on an answer. The frame publishes identities
  claude will run as, unsolicited and outstanding against nothing.
- `questionBridge` — not an ask, and the opposite direction from claude asking the operator to choose.
- `timelineBridge` — not a timeline event. The frame carries no `turn_id` and opens and closes no turn,
  so a published menu is daemon **state** by the queueState rule, and a snapshot that replaces a
  reader's view is not an item to append.

## State + concurrency model

None added. This slice is a pure translation on an existing synchronous path: an already-decoded
`InboundMessage` arm becomes one `emitDaemonEvent` call inside the driver's existing message handler.
No store, no subscription, no timer, no async work, and therefore no new cancellation path — the
connection's existing teardown owns everything on this leg. The four bridge cases are pure functions
returning `null`.

## Error handling

No new failure mode. `parseModelListPayload` (#972) already throws `WireDecodeError` on a malformed
frame, and `daemonConnection` catches it upstream of this switch — so a rejected frame never reaches the
route and emits nothing. This slice adds no `try`, no fallback, and no defaulting; adding any would
convert a fail-closed drop into a plausible-looking wrong answer, which is what the bare-read rule above
exists to prevent.

## Testing strategy

All vitest, node environment. No Playwright spec: nothing renders in this slice.

**`src/main/daemonConnection.test.ts`** — a `describe` block mirroring #937's, driving real encoded
plaintext through the connected driver via a new `modelListPlaintext` helper. A shared `MENU` fixture
carrying rows that exercise the reading rules: a `truncated_fields: null` row, a row whose
`truncated_fields` names `effort_levels` **beside a non-empty `effort_levels`** (the shape proving the
two fields cross independently), a row with `supports_auto_mode: false`, and a row carrying a newline
and non-ASCII in `display_name`.

- One exact `toEqual` on the emitted slice: three camelCase top-level fields, rows verbatim in wire
  order. `toEqual` distinguishes `null` from `undefined` and from an absent key, so the null
  `truncated_fields` rows are pinned by value, not merely by shape.
- `truncated_fields: null` asserted with `toBe(null)` — by value, never `toHaveProperty` or `in`, since
  structured clone over `webContents.send` preserves an assigned `undefined` as a present key.
- A smuggled key planted at **both** levels (payload and row): `Object.keys(...).sort()` equals exactly
  the four modelled properties, and the serialised events contain no smuggled marker.
- `droppedModels` carried verbatim: `0` beside carried rows (which a truthiness test or a `|| 0` would
  still pass), *and* a non-zero count disagreeing with `models.length` (which they would not) —
  the case that reddens on a recomputed or cross-checked count.
- An empty `models: []` still emits exactly one event, asserted on the slice length, separating an empty
  menu from a dropped frame.
- A malformed frame emits nothing and does not throw, asserted on the raw `webContents.send` call count
  so a non-event send would still be caught. The chosen malformation is `models: null` — the field whose
  contract forbids null while its row-level `truncated_fields` neighbour permits it, the branch a reader
  pattern-matching off the sibling waves through.

**The route is not compile-forced and that is where the tests do the work.** The four bridge cases redden
`tsc` the moment the union grows, so they cannot be forgotten. The inner switch in `daemonConnection`
carries no `assertNever` and no catch-all, so a missing case silently drops the frame — only the
round-trip test catches it.

**The four bridge tests** each add a `modelList` event to their existing no-op assertion and expect
`null`, in each file's established shape (`daemonEventBridge.test.ts` asserts a populated menu *and* an
empty one; `modalBridge.test.ts` and `questionBridge.test.ts` append to their `others` array;
`timelineBridge.test.ts` asserts both halves — same state reference and zero timeline items).

**Both gates are run, because they catch disjoint halves of a `DaemonEvent` fixture cascade.** Typed
fixtures fail only at `tsc`; `toEqual` expectations fail only at vitest, which never typechecks. And
`npm run typecheck` is `tsc node && tsc web` with a short-circuiting `&&`, so a node-side error hides
every renderer error — `npx tsc --noEmit -p tsconfig.web.json` is run on its own when sizing the bridge
cascade.

## Open questions

1. **Does any fifth module switch over `DaemonEvent` with an `assertNever` the ticket's count missed?**
   Resolved by running the web typecheck alone after the arm lands and treating its error list as the
   authoritative consumer set, rather than trusting the count. Recorded under `## Revisions` if it turns
   up a fifth.
2. **Does `emitDaemonEvent`'s typed parameter force the four bridge test fixtures at `tsc`, or only at
   vitest?** Expected to be `tsc` for the typed ones; confirmed by the RED run rather than assumed.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. The untrusted→shape-trusted crossing is `parseModelListPayload`
  in `src/main/transport/inboundMessage.ts`, which already landed at #972; this slice consumes its
  output and adds no second parse, no `as` cast, and no re-validation that could disagree with it. The
  arm's doc carries the signal the type system cannot: **shape-trusted is not content-trusted**, every
  string on a row stays claude-authored and unsanitized, and the render boundary owes the escaping.
  Naming that in the arm doc is the only mechanism available — `readonly WireModelOption[]` says nothing
  about provenance.
- **[Electron attack surface]** No findings, and one **worth stating positively rather than as N/A**:
  this arm is exactly the mechanism that keeps the renderer away from the socket. The window receives a
  typed value over `emitDaemonEvent`; no key, no raw frame, no socket handle, and no byte array can ride
  the arm, because its whole payload is one id, a bounded list of six-field rows, and a number. The
  channel direction is main→renderer only; this slice adds no `ipcMain.handle`, no `contextBridge`
  surface, and no renderer-supplied argument.
- **[Error messages, logs, telemetry]** **The load-bearing finding of this review, and it is the reason
  the four bridge cases are in scope at all.** `assertNever(event)` stringifies the *whole event* into an
  `Error` message. An arm added without a case in all four bridges therefore constructs an error whose
  message contains every claude-authored `display_name`, `value`, `resolved_model` and effort level on
  the frame — untrusted, model-influenced text, at a length bounded only by `MAX_PLAINTEXT_BYTES`, in an
  object a crash reporter or a caught-and-logged path would capture verbatim. The four no-op cases are
  the control that prevents it, which is why they must land in this commit rather than with the
  consumer. Separately, the route itself carries **no log call at all** — not even a model count.
- **[Error messages — second-order]** No finding, but stated so it is not mistaken for an omission: the
  decode's own reject path already names the failure *category* only and echoes no field value, and this
  slice adds no catch, so no new value can reach a log through an error message.
- **[Cryptographic primitives]** Not applicable by construction: this slice performs no comparison, no
  hashing, no key handling, and no randomness. `conversationId` is a routing/scoping key rather than a
  nonce or a secret, so a consumer matching it wants plain `===` and specifically **not**
  `crypto.timingSafeEqual` — the sibling arms' stated posture, restated here so a reader arriving from
  `questionShown`'s unguessable batch nonce does not import the wrong rule.
- **[Network & I/O]** No findings. The frame's size is capped upstream of every parse by
  `MAX_PLAINTEXT_BYTES` in `parseInboundMessage`, ahead of `decodeEnvelope` and ahead of every narrower,
  and `raw.map` in the decode allocates from the array that actually arrived rather than from the claimed
  `dropped_models`. This slice introduces no socket, no timeout, and no reconnect path, so a hostile
  relay gains nothing here it did not already have at the decode.
- **[Concurrency]** No findings. The emit is synchronous inside the existing message handler; no
  long-lived task, timer, listener or `AbortController` is added, so there is no new teardown obligation
  and no check-then-act gap across an `await`.
- **[Threat model — hostile daemon]** Addressed upstream and **not re-litigated here**: a hostile or
  compromised daemon can put whatever it likes in these strings at whatever length the frame cap allows,
  and the design's answer is that they cross as untrusted text with the escaping obligation named at the
  arm. This slice deliberately adds no client-side charset, length or plausibility check — a second bound
  here would be a second place the limit is decided and the two could disagree silently.
- **[Threat model — prototype pollution at the consumer]** **OUT OF SCOPE**, deferred to #974 and named
  so it is not lost: `display_name` is claude-authored, so a consumer indexing rows by it must use a
  `Map`, never `index[row.display_name] = row`, where a `__proto__` label writes through to
  `Object.prototype`. Nothing in this slice builds a container from a row value — the arm carries the
  array by reference and the bridges return `null` — so the obligation lands on the store below.
- **[File / storage operations]** Not applicable: this slice touches no filesystem path, writes no file,
  and persists nothing. `models` and `droppedModels` never become a filename, a cache key, or a lookup
  path on this leg.
- **[Tokens, secrets, credentials]** Not applicable: no field on this arm is a credential. Stated rather
  than skipped because `conversationId` is the field a reader might mistake for one — it is a
  daemon-asserted display-scoping key, guessable by construction, granting no inbound capability.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02

## Revisions

### 2026-09-02 — Phase B

**Open question 1 resolved: there is no fifth bridge.** `npx tsc --noEmit -p tsconfig.web.json`, run on
its own against the landed arm, reported exactly four `TS2345 … not assignable to parameter of type
'never'` errors — `daemonEventBridge.ts`, `modalBridge.ts`, `questionBridge.ts`, `timelineBridge.ts`.
The ticket's count of four is the whole compile-forced consumer set. No design change.

**Open question 2 resolved: `tsc` forces the fixtures, vitest does not.** All four bridge test fixtures
are typed call sites, so they redden the web typecheck; none of them would have failed vitest, which
never typechecks. Confirmed by the RED run rather than assumed. No design change.

**Departure from the plan's testing strategy — one assertion the plan did not anticipate.**
`questionBridge.test.ts` carries an explicit arm-count assertion over its `others` table
(`expect(others).toHaveLength(39)`, commented "42 union arms minus the 3 owned above"), which exists so
an arm silently dropped from that table cannot pass unnoticed. Growing the union by one required bumping
it to 40 and correcting the comment to 43. The plan's testing section said only "append to their `others`
array"; the count is a second edit in that file. It is a mechanical consequence of the arm rather than a
design change, recorded here because the diff shows a changed number the plan does not explain.
