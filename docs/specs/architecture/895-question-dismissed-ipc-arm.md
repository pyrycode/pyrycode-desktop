# 895 — Carry `question_dismissed` across IPC as a typed `DaemonEvent` arm

Ticket: [#895](https://github.com/pyrycode/pyrycode-desktop/issues/895) (split from #886, itself split
from #849; #894's decode merged). Depth-capped at `needs-human:sizing` — see § Size.

## Files read

- `src/shared/wire/types.ts` → `QuestionDismissedPayload` — the shape SSOT, and the source of every
  fact the arm's doc comment must carry: the deliberate absence of `conversation_id`, the plain-`string`
  `source`, the fail-closed reading rule, the one landed producer pair, and the dead-nonce note.
- `src/shared/wire/types.ts` → `WireModalSource` — read to confirm it is the closed set
  `'remote' | 'local' | 'timeout'` and that `events.ts` already imports it, which is what makes the
  wrong annotation a one-keystroke reach rather than a deliberate act.
- `src/shared/ipc/events.ts` → the `modalDismissed` arm — the single-line flat shape this arm copies
  structurally, and the `source: WireModalSource` line this arm must **not** copy.
- `src/shared/ipc/events.ts` → the `questionShown` arm (#885) — the sibling this arm is written beside,
  and the source of the family's doc-comment voice.
- `src/shared/ipc/events.ts` → its `import type { … } from '../wire/types'` block — read to confirm
  this slice extends it by **zero** names: all three fields are plain `string`.
- `src/main/daemonConnection.ts` → the `case 'question-shown':` and `case 'modal-dismissed':` arms of
  the inbound `switch (inbound.kind)` — the emit idiom, and the twin whose `outstandingAnswers` drain
  must **not** be copied (§ Design 2, and a security finding).
- `src/main/daemonConnection.ts` → that switch, verified `default`-free and `assertNever`-free — the
  emit is not compile-forced, which is what AC 2's round-trip test exists to cover.
- `src/main/transport/inboundMessage.ts` → the `{ kind: 'question-dismissed'; questionDismissed }` arm
  and `parseQuestionDismissedPayload` (#894) — this slice's input; three bare `requireString` calls
  returning a fresh named-field literal, which is why every field is read bare here.
- `src/main/transport/inboundMessage.ts` → `parseQuestionDismissedPayload`'s docblock — its explicit
  "`source` goes through plain `requireString` and is NOT closed to `WireModalSource`, unlike its modal
  twin one screen up… do not tighten them toward each other." The decode already made this call; this
  slice must not un-make it one hop later.
- `src/main/emitDaemonEvent.ts` → `emitDaemonEvent` — read (via #885's record) to confirm it is
  log-free by construction, including the destroyed-window drop.
- `src/renderer/src/store/daemonEventBridge.ts` → `translateDaemonEvent`, `assertNever`, and its
  `questionShown` case — first exhaustive bridge; per-arm case with its own comment is this file's
  local convention.
- `src/renderer/src/store/modalBridge.ts` → `translateModalEvent`, `assertNever`, and the
  fall-through no-op group #885 extended — second exhaustive bridge.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`, `assertNever`, and its
  fall-through group — third exhaustive bridge. `timelineTargetFor` is **not** a fourth compile-forced
  switch (it terminates in a `default`, deliberately) — #885 verified this and nothing since changed it.
- `docs/knowledge/features/daemon-event-channel-sealed-union.md` § `questionShown` — the sibling arm's
  settled record, including the permanent-vs-dormant vocabulary this arm reuses.
- `docs/knowledge/features/daemon-event-bridge.md` — the tabulated no-op roster and the "fourth
  independent subscriber" pattern (#180, #256, #573, #588) that #850 will follow.
- `docs/knowledge/features/question-shown-wire-types.md` — the family overview, now covering both
  frames after #894's fold.
- `docs/specs/architecture/885-question-shown-ipc-arm.md` — the direct precedent across this exact file
  set, and its § Revisions size actual (388 production+test lines against a ~400 estimate; the family's
  floor is comment-driven, not logic-driven).
- `docs/specs/architecture/894-question-dismissed-decode.md` § "Security review" — read because it
  names **this slice by number** in a SHOULD FIX: #895 "must not read 'decoded' as 'sanitized'."
  Answered in § Security review below.

## Design source

**Figma:** N/A — an IPC transport hop, nothing user-visible. The question panel and its take-down are
later slices (#850 and its render consumer); the visual-fidelity check is intentionally skipped.

## Context

#894 landed the fail-closed decode, so a `question_dismissed` frame now becomes a typed
`InboundDaemonMessage` inside the background process — and stops there. `daemonConnection.ts`'s inbound
switch has no `case 'question-dismissed':`, so the decoded dismissal is dropped one statement after it
was validated, and the renderer cannot see that a batch died. This slice carries it the last hop. It is
the exact mirror of what #885 did for `question_shown`, and of what #201 did for the two modal arms.

Five files move together because the typechecker welds them: the union arm plus the three
`assertNever`-guarded bridges cannot land apart, plus the emit. The refiner worked out the one
compilable cut (arm + three bridges / emit) and rejected it on the Sizing Guide **floor** — slice one's
only deliverable would be an arm nothing emits and nothing consumes, whose sole consumer is one sibling
in the same family. The depth gate forbids it independently.

**No ADR is warranted.** This slice makes no architectural choice of its own — it applies the settled
`DaemonEvent`-arm shape to a flat three-string payload. The documentation phase should fold its lessons
into the package overviews (`daemon-event-channel-sealed-union.md`, `daemon-event-bridge.md`,
`question-shown-wire-types.md`) rather than open a decision record.

## Design

### 1. The arm (`src/shared/ipc/events.ts`)

A new member on `DaemonEvent`, placed immediately after the `questionShown` arm so the question pair
sits adjacent and the family block continues where #885 left it:

```ts
| { type: 'questionDismissed'; questionBatchId: string; outcome: string; source: string }
```

Flat and single-line, structurally the `modalDismissed` shape one screen up **minus its
`WireModalSource`**. No import is added: all three fields are plain `string`.

**`source: string`, never `WireModalSource` — AC 1's named trap, and the one mistake that compiles and
passes.** `events.ts` already imports `WireModalSource`, the adjacent `modalDismissed` arm annotates
its `source` with it, and `QuestionDismissedPayload`'s own doc calls this frame "field for field with
`ModalDismissedPayload`". Copying that line is the natural move and it is wrong: the closed set is
`'remote' | 'local' | 'timeout'` and the producer emits **no member of it**. `remote` and `local` are
answered outcomes belonging to the not-yet-landed answer half (upstream pyrycode#1907); `timeout` is
not emitted either, because the producer's dismissal arbiter is one closure deferred on every `Await`
return and cannot tell an elapsed approval window from a caller disconnect or a daemon shutdown — so
all three terminal paths emit the single landed pair `outcome: "unanswered"` / `source: "no_answer"`.
Closing the enum here rejects the only traffic that exists. The trap has teeth because `'timeout'` *is*
a valid member and is sitting in upstream `internal/protocol/testdata/question_dismissed.json` — a
shape fixture minted by the declaring slice before any producer existed. An arm typed `WireModalSource`
and round-tripped with `'timeout'` typechecks and passes both AC 4 gates while rejecting live traffic.
**If a type error appears at the emit site, the fix is to widen the arm to `string`, never to cast the
payload and never to reach for the fixture's value.** #894's `parseQuestionDismissedPayload` docblock
already made this call in as many words ("do not tighten them toward each other"); this slice must not
un-make it one hop later.

The arm's doc comment carries forward, in the family's established voice:

- What the frame does — retires the `question_shown` batch (#883 vocabulary, #884 decode, #885 carry),
  so a client takes the panel down rather than rendering an ask that is already dead.
- **Why `source` is open**, in the terms above, with the fixture named as a trap rather than a source.
- **The fail-closed reading rule that makes the open type safe**: an unrecognised `source` means
  *resolved, cause unknown*, and **never** an answer. Backwards, it renders a daemon safe-deny as the
  operator's own choice. The values a client written today will not recognise are precisely the ones
  the producer has yet to name.
- **No `conversationId`, and do not add one** "for symmetry with the batch" — the batch nonce is the
  sole correlation key, a shape carrying both would admit a disagreeing pair someone must adjudicate,
  and a client holding the batch already knows its conversation. This arm carries exactly one id where
  `questionShown` carries two.
- **The trust tier, stated in both directions.** Unlike its sibling this arm carries **no
  claude-authored byte**: the id is daemon-asserted and `outcome` is an opaque producer-defined
  sentinel that never carries a claude-authored option label — a published contract, and the reason a
  consumer needing the label reads it from the batch it already holds, keyed on `question_batch_id`.
  So `questionShown`'s per-field escaping obligations have no counterpart here. **They are not replaced
  by a safety guarantee.** All three fields are daemon-*asserted*, not daemon-*bounded*: the only thing
  checked at the boundary is `typeof === 'string'`, and a compromised daemon puts whatever it likes in
  `outcome` and `source` at whatever length the frame cap allows. The comment must therefore **not**
  call these fields safe to render as trusted chrome; the escaping and length-bounding boundary is
  still this client's.
- **The nonce.** `question_batch_id` is the batch's one-time unguessable nonce echoed back. It must
  never reach a log; nothing on this leg has a sink (`emitDaemonEvent` is log-free by construction).
  It is **dead** once this frame lands and receiving it is **not** a capability — a retired batch
  resolves nothing daemon-side, the way a stale `modal_id` resolves nothing under first-answer-wins.
  Matching it against a held batch wants plain `===`, not `crypto.timingSafeEqual`: a local routing
  decision between two values the client already holds, not a secret compared against a guess.
- **Permanently** no-op in all three exhaustive bridges, **not dormant** — its consumer is #850's
  question store plus a dedicated bridge, a fourth independent subscriber on this channel.

### 2. The emit (`src/main/daemonConnection.ts`)

A new `case 'question-dismissed':` in the inbound `switch (inbound.kind)`, a fresh literal naming four
fields:

```ts
emitDaemonEvent(sink, {
  type: 'questionDismissed',
  questionBatchId: inbound.questionDismissed.question_batch_id,
  outcome: inbound.questionDismissed.outcome,
  source: inbound.questionDismissed.source
})
```

**A fresh named-field literal, never `...inbound.questionDismissed` (AC 1)** — so a decoder that later
grows a field cannot smuggle it across IPC. The payload is flat, so the smuggling surface is one level
wide, not three as it was for the batch.

Every field is read **bare** — no `??`, no optional handling. `parseQuestionDismissedPayload` requires
all three, so a missing or non-string one fails the whole line upstream without emitting; a `?? ''`
here converts that fail-closed drop into a silent misattribution, retiring the wrong batch or reporting
a cause the daemon never stated. No log call at the emit: #894's decode already emitted the
content-free record, and this is the one place on the leg where the nonce could reach a sink.

**The `modal-dismissed` twin's `outstandingAnswers` drain is deliberately NOT copied.** That block
(#248) removes an answered `modal_id` from the main-side correlation window so a later content-free
`error` cannot be mis-attributed to it. There is no counterpart here: this client sends no question
answer at all — the outbound verb is upstream pyrycode#1907 and has not landed — so there is no
outstanding-answer memory to drain, and `outstandingAnswers` holds `modal_id`s exclusively. Copying the
drain would search that modal window with a `question_batch_id`, which is a cross-frame
correlation-confusion path, not a harmless no-op. See § Security review.

### 3. The three permanent no-ops

Each of `translateDaemonEvent`, `translateTimelineEvent` and `translateModalEvent` gains an explicit
`case 'questionDismissed':` returning `null`, in that file's own idiom — `daemonEventBridge` a per-arm
case with its own comment, `timelineBridge` and `modalBridge` an entry appended to their fall-through
group with the group comment extended. All three `assertNever` guards keep compiling and none is
weakened into a catch-all `default: return null`.

Each comment states the same two facts in its own file's voice: the consumer is #850's question store
plus its dedicated bridge, a **fourth independent subscriber**, not this bridge; and the no-op is
therefore **permanent**, not dormant — contrasted against that file's own live flip precedent
(`compacting` #496 / `apiRetry` #493 in `daemonEventBridge` and `timelineBridge`, `connected` #538 in
`modalBridge`), so a reader can tell the two situations apart at the site.

Two per-file specifics that are not boilerplate:

- **`modalBridge`.** #885 had to draw the modal-versus-question line for `questionShown`, because it is
  the one arm in that group where something genuinely *is* waiting on an answer. This arm is the other
  half of that story and needs one added sentence rather than a repeat: a dismissal is the frame that
  ends the waiting, and it still routes nowhere near the modal store — `modalDismissed` resolves a
  permission prompt against `modal_id` under first-answer-wins, while this retires a question batch
  against its own nonce, with no answer frame in the contract at all.
- **`timelineBridge`.** The `queueState` rule (#720) decides it, exactly as for the batch: the frame
  carries no `turn_id` and opens and closes no turn, so a dismissal is daemon state, not a turn-stream
  item. Whether a retired panel ever leaves a timeline trace is #850's call.

## State + concurrency model

None, and strictly less than the `modal-dismissed` twin. The emit is a synchronous call inside the
existing inbound message handler; `emitDaemonEvent` is a guarded `webContents.send` with no `await`,
timer, listener or shared mutable state, and this case mutates **no** main-side state at all (§ Design
2). The three bridges gain pure `return null` branches, which allocate nothing and dispatch nothing —
each `subscribe*`'s existing `if (event) dispatch(...)` guard already skips them. The one lifecycle
fact is inherited, not added: `emitDaemonEvent`'s destroyed-window guard (#518) covers this call site
like the other thirty-odd.

## Error handling

No new error type, no new result type, no new catch.

| Failure | Answered by |
|---|---|
| Malformed frame / non-string field | #894's `parseQuestionDismissedPayload` throws `WireDecodeError` before this case is reached; `daemonConnection.ts`'s existing single `catch` drops the line without emitting |
| Window destroyed mid-emit | `emitDaemonEvent`'s `isDestroyed()` guard drops and returns |
| A future arm added without a bridge case | The three `assertNever` guards, unchanged, at compile time |
| An unrecognised `source` value | Not an error: it crosses verbatim by design. The fail-closed *reading* rule (resolved, cause unknown — never an answer) belongs to #850's consumer; this leg polices type, not membership |

The renderer-side error surface is unchanged: all three bridges return `null`, so no store reducer sees
this arm and no UI state can enter an error branch because of it.

## Testing strategy

All vitest. No Playwright spec: this slice adds no interaction and no render surface.

**Round-trip emit — `src/main/daemonConnection.test.ts`** (AC 2). A `questionDismissedPlaintext` helper
beside `questionShownPlaintext`, and a `createDaemonConnection — question_dismissed stream (#895)`
describe reusing the file's `connected()` pattern. This is the block that earns its keep: the inbound
switch has no `assertNever`, so a missing or mis-populated emit is invisible to tsc. A *mistyped*
literal is already a compile error via `emitDaemonEvent`'s typed parameter, so no test targets that.

- The landed producer pair round-trips: `outcome: 'unanswered'`, `source: 'no_answer'`, asserted with
  an exact `toEqual` on all four fields. **`'no_answer'` is not a `WireModalSource` member**, so this
  single assertion is also the trap test — a `WireModalSource`-typed arm cannot reach green here.
  **Deliberately not `'timeout'`**, per AC's Technical Notes and #894's tests.
- A second, unrecognised sentinel (a plausible future `source` the producer has yet to name) crosses
  verbatim — pinning that the arm is open, not merely open-enough-for-today.
- `Object.keys(...).sort()` equals exactly `['outcome', 'questionBatchId', 'source', 'type']`, and an
  extra key planted on the frame appears nowhere in the emitted JSON — the pair that catches a spread
  (AC 1). One level, since this payload is flat.
- A malformed frame (a non-string `source`) emits nothing and does not throw — the fail-closed path
  stays fail-closed with the emit wired.

**Three bridge no-ops** (AC 3), each in that file's established idiom:

- `daemonEventBridge.test.ts` — a dedicated `questionDismissed → null` case, matching the
  `questionShown → null` test's shape.
- `modalBridge.test.ts` — an entry in the existing `others` no-op array.
- `timelineBridge.test.ts` — an entry in its `others` array, **plus** the file's second form: a
  `creates NO timeline item` test asserting both halves (same state reference, zero items), which is
  what actually proves nothing was dispatched.

Each fixture uses the landed `unanswered` / `no_answer` pair, so the three typed call sites are three
more places a `WireModalSource` annotation would fail to compile.

**Not tested, deliberately:** no test asserts "nothing is logged" on this leg. `emitDaemonEvent` is
log-free by construction and has its own tests; this slice adds no log call, so such a test would
assert the absence of code that was never written and pass green forever regardless.

## Size

The size-S table is re-counted against this written plan: **5 production source files** (over the
ceiling of 3), 0 new exported types, 4 consumer call sites, 4 acceptance criteria, 0 error branches,
and a projected ~400 lines of production + test. Only the file line trips, and the parent chain is
#849 → #886 → #895 — grandparent is not `none`, so the hard depth gate forbids a further split and
`needs-human:sizing` is already applied by the refiner (matching #885 and #894, same family, same
reason). Building as it stands, per the depth-cap rule.

One calibration note carried from #885's § Revisions: this family's real floor is comment-driven, not
logic-driven, and #885 measured 388 production+test lines for a five-file, zero-branch, zero-export
slice. This plan is deliberately shorter than #885's 383 lines for that reason — the flat payload
removes the two-level nesting prose, and the budget belongs to Phase B.

## Open questions

1. **Where in the inbound switch does `case 'question-dismissed':` go?** #885 inserted `question-shown`
   between `modal-shown` and `modal-dismissed`, so the family order is already interleaved. Leaning
   after `modal-dismissed` — the natural append point at the end of that inner switch, adjacent to the
   twin whose divergences (`WireModalSource`, the `outstandingAnswers` drain) the comment names.
   Resolve at the edit.
2. **Does the round-trip test's second `source` value earn its line?** The first assertion already
   proves the arm is not enum-closed, since `'no_answer'` is not a `WireModalSource` member. Leaning
   keep: the two differ in what they pin — the first that *today's* traffic crosses, the second that a
   *future* sentinel crosses unchanged, which is the fail-closed reading rule's precondition. Resolve
   while writing, and drop it if the two assertions read as one.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** SHOULD FIX, and it is the direct answer to #894's review, which named this
  ticket by number. The boundary is main → renderer over `DAEMON_EVENT_CHANNEL`, one-way. #894 made
  the **shape** trusted and nothing more, and this arm's danger is the *inverse* of its sibling's:
  `questionShown` carries claude-authored text and the risk was forgetting to say so, whereas this one
  carries none at all, and the risk is writing the reassuring sentence — "all three fields are
  daemon-asserted" — that reads as "safe to render as trusted chrome". The wire type forbids exactly
  that reading in as many words. Phase B must state the split explicitly in the arm's doc comment:
  daemon-*asserted* (a published producer promise) but not daemon-*bounded* (only `typeof === 'string'`
  is checked, at whatever length the frame cap allows), so the escaping and length-bounding boundary is
  still this client's. The verifier should check it landed. Not a MUST FIX because this slice hands the
  value to no renderer consumer — all three bridges return `null`, so nothing reads these strings until
  #850 and its render slice.
- **[Trust boundaries, second finding]** SHOULD FIX — **the fail-closed *reading* rule for an
  unrecognised `source`, which no type can carry.** An unrecognised value means *resolved, cause
  unknown*, and never an answer; read backwards, a consumer renders a daemon safe-deny as the
  operator's own choice, i.e. shows the operator as having approved something they never saw. That is a
  misrepresentation with security weight, not a cosmetic one, and it is the precise cost of the open
  `string` this slice deliberately ships. This leg cannot enforce it — it has no consumer — so the
  arm's doc comment is the only place the rule will be read before #850 writes one. Must land there.
- **[Tokens, secrets]** No findings, and this frame sits a tier *below* its sibling. `question_batch_id`
  is the batch's one-time unguessable nonce echoed back; crossing to the renderer is required, not
  incidental, since #850 cannot match a dismissal to a held batch without it. Verified rather than
  assumed that it reaches no sink on this leg: `emitDaemonEvent` is log-free by construction (module
  header and function doc both state it, including the destroyed-window drop path), this slice adds no
  log call at the emit, and the three bridges dispatch nothing. Two facts lower the residual further:
  the nonce is **dead** once this frame lands — a retired batch resolves nothing daemon-side, the way a
  stale `modal_id` resolves nothing under first-answer-wins — so receiving it is not a capability; and
  no comparison happens here at all. Had one, plain `===` is correct rather than `timingSafeEqual`
  (#883/#894 record why: a local routing decision between two values the client already holds).
- **[Tokens, secrets — the copy-paste hazard]** SHOULD FIX, and the adversarial find of this pass: the
  `modal-dismissed` twin this case is written beside ends with an `outstandingAnswers` drain (#248),
  and it must **not** be copied. `outstandingAnswers` holds `modal_id`s exclusively; this client sends
  no question answer at all (the outbound verb is upstream pyrycode#1907, unlanded), so there is nothing
  to drain. A copied drain would search the *modal* correlation window with a `question_batch_id`,
  giving a hostile or buggy daemon a way to retire a live modal-answer correlation entry by echoing a
  known `modal_id` as a batch nonce — after which a later content-free `error` (#116) mis-attributes.
  It would look like a harmless no-op in review, because the `indexOf` is `-1` on every honest frame.
  Named here so Phase B and the verifier both see it as a deliberate omission rather than an oversight.
  Not a MUST FIX only because the plan already specifies the omission (§ Design 2).
- **[File / storage]** N/A by design — a pure in-memory forward of an already-decoded object. No path
  is constructed, no `fs` call, no write; nothing reaches `userData`, and nothing reaches renderer-side
  web storage (`localStorage` / IndexedDB are untouched — all three bridges return `null` and hold
  nothing). No traversal or TOCTOU surface exists to reason about.
- **[Electron attack surface]** No findings, verified rather than assumed. (a) No new `contextBridge`
  API and no new `ipcMain` channel: `DAEMON_EVENT_CHANNEL` and preload's `onDaemonEvent` already
  forward `DaemonEvent` generically — the fact that holds this slice to five production files rather
  than six. (b) No `BrowserWindow` / `webPreferences` change, no navigation or window-open handler, no
  protocol registration. (c) Everything crossing is structured-clone-safe by construction: #894's
  narrower builds a fresh literal from three `requireString` values, so the payload is three plain
  strings — no function, no class instance, no cycle, and no `__proto__` can ride, because the object
  is built from **named keys** rather than assignment from wire keys (assignment is the prototype
  hazard; named construction is not). Process placement unchanged: keys, sockets and the Noise session
  stay in main, and the renderer gains a typed event and no capability.
- **[Cryptographic primitives]** N/A — none introduced, none touched. No RNG, key, derivation, AEAD or
  secret comparison on this leg. The nonce is forwarded, never compared.
- **[Network & I/O]** No findings. No socket, URL, TLS decision or timeout is introduced — an
  in-process forward downstream of the relay read. Memory exhaustion from a hostile or buggy producer
  is the applicable threat, bounded upstream and unchanged: `parseInboundMessage`'s
  `MAX_PLAINTEXT_BYTES` guard runs before the parse, capping all three strings together at ~64 KiB
  before they can reach this emit. The structured clone is O(N) in that bounded size, and this payload
  is **flat** — no nesting, so no amplification at all, strictly better than the batch's two levels.
- **[Errors, logs, telemetry]** No findings, plus the non-obvious reason the three bridge cases are
  load-bearing beyond compilation. Each bridge's `assertNever` throws
  `` new Error(`Unhandled daemon event: ${JSON.stringify(event)}`) `` — so an arm reaching a bridge with
  **no case** serializes the whole event, unguessable nonce included, into an `Error.message` that
  propagates out of the subscription callback. AC 3's three explicit cases are what keep it out of that
  stringify: they are the sink guard, not a compile formality. The failure is compile-blocked, hence a
  "no finding" rather than a MUST FIX — but it is exactly why no bridge may be given a catch-all
  `default: return null` shortcut, which would silently un-exhaust the guard and put a future arm on
  that path. On the throw side, #894's `parseQuestionDismissedPayload` names the failure *category*
  only, so nothing value-bearing rides into `daemonConnection`'s catch; this slice adds no log call and
  must not.
- **[Concurrency]** N/A, and strictly less than the twin it copies. A synchronous emit on the existing
  inbound path with no `await`, timer, listener or shared mutable state added — and, per the
  `outstandingAnswers` finding above, **no main-side state mutation of any kind**, where
  `modal-dismissed` has one. Nothing outlives the call. The one lifecycle concern on this channel,
  emitting into a destroyed window after a macOS window close, is answered by `emitDaemonEvent`'s
  inherited `isDestroyed()` guard rather than by anything this slice writes.
- **[Threat model alignment]** **Hostile daemon response** is answered upstream by #894's fail-closed
  decode — a malformed frame never reaches this case — and the residual, that a well-formed frame can
  carry an arbitrarily long `outcome` / `source`, is deliberately preserved rather than defended here:
  bounding at this hop would present truncated text as complete, and this family has no
  `truncated_fields` to report it with. The desktop-specific residual worth naming is that a hostile
  daemon can forge a dismissal for a batch it never showed, retiring a live panel — but it is the same
  actor that showed the batch, so there is no privilege gain, and a dismissal naming an *unknown* nonce
  must clear nothing, which is #850's AC 1 rather than this slice's. **Malicious / compromised relay:**
  unchanged — content-blind and on-path; a flood is bounded by the frame cap and a dropped dismissal
  leaves a stale panel on screen, which is a liveness cost, not a confidentiality one. **Renderer
  compromise reaching the transport:** unchanged — one-way main → renderer, no new capability, handle
  or reply path. **Token theft from disk:** N/A, nothing persists. OUT OF SCOPE, named: the escaping and
  length-bounding render boundary, and what an unknown nonce means on screen (#850 and its render
  slice); the outbound answer verb and its `remote` / `local` sources (upstream pyrycode#1907).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02

## Revisions

### 2026-09-02 — Open questions resolved, and the trap measured rather than asserted

**Open question 1 — where `case 'question-dismissed':` goes in the inbound switch: resolved after
`modal-dismissed`**, as the plan leaned. It is the natural append point at the end of that inner switch
and it puts the case adjacent to the twin whose two divergences its comment has to name (the
`WireModalSource` annotation, and the `outstandingAnswers` drain). No design change.

**Open question 2 — the second `source` value in the round-trip test: resolved keep**, as the plan
leaned. The two assertions pin different things and read as two tests, not one: the first that today's
only landed pair crosses, the second that a sentinel the producer has yet to name crosses *unchanged*,
which is the precondition the fail-closed reading rule depends on. No design change.

**The trap was verified empirically, not argued.** The plan claimed a `source: WireModalSource` arm
fails at the emit site. Rather than trust that, the arm was temporarily narrowed and typechecked: it
does — `daemonConnection.ts` rejects `string` against `WireModalSource` — and so do **five typed test
fixtures** in the three bridge specs. Six compile guards, not one.

**And that measurement is where the one non-obvious lesson of this slice came from.** The first run of
the narrowed arm reported **exactly one error**, which reads as "the emit site is the only guard" and
would have made three of the test comments false as written. It was an artifact: `npm run typecheck` is
`tsc -p tsconfig.node.json && tsc -p tsconfig.web.json`, and the `&&` means **a node-side error hides
every web-side error**. Both tsconfigs `include` their `*.test.ts` files, so the web project had five
errors waiting that never ran. Anything that counts a change's blast radius from a single
`npm run typecheck` — a size check, a cascade estimate, a "does this even fail?" probe — undercounts
whenever the node side errors first. Run `tsc -p tsconfig.web.json` on its own to see the other half.
This is the compile-side twin of the already-recorded tsc/vitest split, and it bit inside one ticket.

**Size: ~480 lines of production and test across nine files, plus a ~330-line plan.** Under #885's
actual (388 production+test, 383-line plan) as the estimate predicted, and the reason is the one the
estimate named — the flat payload removes the two-level nesting prose and one whole level of
extra-key planting. The union arm is again the single largest item and again almost entirely comment,
which remains this family's real floor: the `WireModalSource` rationale and the fail-closed reading
rule are not compressible without dropping the two things that make the open `string` safe.
</content>
</invoke>
