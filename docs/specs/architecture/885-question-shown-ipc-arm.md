# 885 — Carry the question batch across IPC as a typed `DaemonEvent` arm

Ticket: [#885](https://github.com/pyrycode/pyrycode-desktop/issues/885) (split from #849; #883 wire
types and #884 decode both merged).

## Files read

- `src/shared/ipc/events.ts` → the `DaemonEvent` union, and specifically the `modalShown` /
  `backgroundTaskRoster` arms — the two shape precedents this arm sits between (one for the
  `conversationId`-carrying scoping key, one for the nested-row rule at `readonly` outer + mutable
  row).
- `src/shared/ipc/events.ts` → the `backgroundTaskRoster` arm's doc paragraph beginning "Top-level
  fields are snake→camel" — the settled house rule AC 2 cites, stated there with its two prior
  precedents (`queueState`, `conversationsReceived`).
- `src/shared/ipc/events.ts` → its `import type { … } from '../wire/types'` block — the relative
  import (no `@shared` alias on the main/preload side) this slice extends by one name.
- `src/main/daemonConnection.ts` → the `case 'modal-shown':` arm of the inbound `switch (inbound.kind)`
  — the emit this one is written beside, and the source of the named-field-literal idiom.
- `src/main/daemonConnection.ts` → that same switch, verified **`default`-free and `assertNever`-free**
  (its own arm comments say so repeatedly): the emit is *not* compile-forced, which is precisely what
  AC 4's round-trip test exists to cover.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage`'s `{ kind: 'question-shown';
  questionShown: QuestionShownPayload }` arm and `parseQuestionShownPayload` (#884) — this slice's
  input, and the reason every field can be read bare with no `??` and no optional handling.
- `src/main/emitDaemonEvent.ts` → `emitDaemonEvent`, `DaemonEventSink` — read to confirm AC 5's
  "nothing on this leg reaches a log sink" rather than assume it: the module header and the function
  doc both state it is log-free by construction, including on the destroyed-window drop.
- `src/preload/index.ts` → `onDaemonEvent` — read to confirm the preload forwards `DaemonEvent`
  generically and needs **no** change, which is what fixes this slice at five production files rather
  than six.
- `src/renderer/src/store/daemonEventBridge.ts` → `translateDaemonEvent`, `assertNever` — first
  exhaustive bridge; its `modelAnnounced` case is the closest-shaped no-op comment.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`, `assertNever` — second
  exhaustive bridge, whose no-op group is a fall-through list rather than a per-arm case.
- `src/renderer/src/store/timelineBridge.ts` → `timelineTargetFor` — read specifically to check
  whether it is a *fourth* compile-forced switch. It is **not**: it terminates in a `default`, and its
  docblock states that as a deliberate choice. No case is needed there.
- `src/renderer/src/store/modalBridge.ts` → `translateModalEvent`, `assertNever` — third exhaustive
  bridge. Its `connected` case is the live example of a no-op that later *flipped* to an owned arm,
  which is the thing AC 3 wants this arm's comments to distinguish themselves from.
- `src/shared/wire/types.ts` → `QuestionShownPayload`, `WireQuestion`, `WireQuestionOption` — the
  shape SSOT and the per-field provenance note the arm's own comment must carry forward.
- `docs/knowledge/features/daemon-event-channel-sealed-union.md` — the nested-array precedent chain
  (`conversationsReceived` → `queueState` → `backgroundTaskRoster`) and, on the `modelAnnounced` entry,
  the sentence that the three exhaustive bridges "keep their no-ops permanently" when the real consumer
  is a fourth subscriber. That is the shipped precedent behind AC 3's permanent-vs-dormant wording.
- `docs/knowledge/features/daemon-event-bridge.md` — the tabulated no-op roster and the "fourth
  independent subscriber" pattern (#180, #256, #573, #588) that #850 will follow.
- `docs/knowledge/features/question-shown-wire-types.md` § "Per-field provenance", § "The two caveats
  a consumer gets wrong by default" — the two ids are daemon-asserted, the four strings are
  claude-authored and unsanitized.
- `docs/specs/architecture/884-question-shown-decode.md` § "Security review" — read because #884's
  review names **this slice by number** in a SHOULD FIX: "#885 reads this arm as its input and must not
  read 'decoded' as 'sanitized'." Answered in § Security review below.

## Design source

**Figma:** N/A — an IPC transport hop, nothing user-visible. The question panel is a later slice
(#850 and its render consumer); the visual-fidelity check is intentionally skipped.

## Context

#883 landed the wire vocabulary and #884 the fail-closed decode, so a `question_shown` frame now
becomes a typed `InboundDaemonMessage` inside the background process — and stops there. The inbound
switch in `daemonConnection.ts` has no `case 'question-shown'`, so the decoded batch is silently
dropped one statement after it was validated. This slice carries it the last hop, across IPC, as a
`DaemonEvent` arm the renderer can read. It is the mirror of what #201 did for the two modal arms.

Three files move together because the typechecker welds them (the union plus the three
`assertNever`-guarded bridges), plus the emit. That is the whole slice: no store consumer, no render
surface, no outbound verb.

**The permanent/dormant distinction AC 3 asks for is not a wording preference.** This codebase's
"ships dormant" means a bridge's own `null` case is *expected to flip* to an owned arm later — and
several have: `stallDetected` flipped in #317, `apiRetry` in #493, `compacting` in #496, `connected`
in modalBridge at #538. This arm can never flip in any of the three, because its consumer (#850) is a
**fourth independent subscriber** on the same channel — the `announcedModelBridge` / `queueBridge` /
`backgroundTaskRosterBridge` shape — not a new owned arm on session, timeline or modal state. The
sealed-union overview already records that outcome for `modelAnnounced`: the three bridges "keep
their no-ops permanently." Writing "ships dormant" here would set a false expectation in three files
at once.

**No ADR is warranted.** This slice makes no architectural choice of its own — it applies the settled
`DaemonEvent`-arm shape to a second nesting level. The documentation phase should fold its lessons
into the package overviews (`daemon-event-channel-sealed-union.md`, `daemon-event-bridge.md`,
`question-shown-wire-types.md`) rather than open a decision record.

## Design

### 1. The arm (`src/shared/ipc/events.ts`)

A new member on `DaemonEvent`, placed immediately after the two modal arms (the ticket's stated
neighbourhood, and the arms it most resembles):

```ts
| {
    type: 'questionShown'
    conversationId: string
    questionBatchId: string
    questions: readonly WireQuestion[]
  }
```

`WireQuestion` joins the existing relative `import type` block. `WireQuestionOption` is **not**
imported — it is reached through `WireQuestion.options` and naming it here would be an unused import.

**Top-level snake→camel, nested rows verbatim (AC 2), applied at both levels.** `conversation_id` →
`conversationId` and `question_batch_id` → `questionBatchId`; `WireQuestion` is reused as-is, so
`multi_select` stays `multi_select`, and `WireQuestionOption` beneath it stays `{ label, description }`.
This family nests two levels where `queueState` and `backgroundTaskRoster` nest one, so the rule is
worth stating twice: it applies to `questions` **and** to each question's `options`. The justification
is unchanged at both — the #884 narrower already stripped every row to its known fields, so there is
nothing to drop and no mapping to write.

`readonly` on the outer array mirrors `queueState` / `backgroundTaskRoster`; `WireQuestion` and
`WireQuestionOption` stay mutable interfaces exactly as `QueuedItem` and `BackgroundTask` are. The
modifier is a compile-time no-mutate signal and is erased harmlessly by the structured clone.

The arm's doc comment carries forward, in the family's established voice: the two-level nesting and
why the row types are verbatim; `conversationId` as an **outbound display-scoping key only** with
`questionBatchId` the sole correlation key (the split `modalShown` has carried since #870); the
per-field provenance split (ids daemon-asserted, the four strings claude-authored, unbounded and
unsanitized, render-as-plain-text-only, never a log/attribute/URL/filename/cache key); that the
nonce is unguessable and must never reach a log; and that all three exhaustive bridges no-op it
**permanently**, naming #850 as a fourth independent subscriber.

### 2. The emit (`src/main/daemonConnection.ts`)

A new `case 'question-shown':` in the inbound `switch (inbound.kind)`, beside `case 'modal-shown':`:

```ts
emitDaemonEvent(sink, {
  type: 'questionShown',
  conversationId: inbound.questionShown.conversation_id,
  questionBatchId: inbound.questionShown.question_batch_id,
  questions: inbound.questionShown.questions
})
```

**A fresh literal with three named fields, never `...inbound.questionShown` (AC 1)** — so a decoder
that later grows a field cannot smuggle it across IPC.

**AC 1 and AC 2 govern different levels, and reading AC 1 as demanding a deep re-map would violate
AC 2.** "Fresh named-field literal" is about the *event object*; the `questions` array passes across
**by reference**, exactly as `modalShown`'s `options` does — that is the `conversations` precedent the
modal arm's own comment cites, and it is what "reused verbatim" means. No `.map`, no re-construction,
no per-row copy.

Every field is read **bare** — no `??`, no optional handling. `parseQuestionShownPayload` requires all
three, so a missing or wrong-typed one fails the whole line upstream without emitting; a `?? ''` here
would convert that fail-closed drop into a silent misattribution, filing a question batch against the
wrong conversation. Same reasoning #871 recorded for `modalShown.conversationId`, and it is the one
place a defensive-looking edit is actively harmful.

No log call at the emit: #884's decode already emitted the content-free record, and adding one here
would be the only place on this leg a nonce could reach a sink.

### 3. The three permanent no-ops

Each of `translateDaemonEvent`, `translateTimelineEvent` and `translateModalEvent` gains an explicit
`case 'questionShown':` returning `null`, in each file's own idiom — `daemonEventBridge` uses a
per-arm case with its own comment, `timelineBridge` and `modalBridge` append to their fall-through
group and extend the group comment. All three `assertNever` guards keep compiling and none is
weakened into a catch-all `default: return null`.

Each comment states the same two facts in its own file's voice: the consumer is #850's question store
plus its dedicated bridge, a **fourth independent subscriber**, not this bridge; and the no-op is
therefore **permanent**, not dormant — contrasted against that file's own live flip precedent
(`compacting`/`apiRetry` in `daemonEventBridge`, `apiRetry`/`compacting` in `timelineBridge`,
`connected` in `modalBridge`) so a reader can tell the two situations apart at the site.

The bridges are also where the *timeline* question gets answered, in the `queueState` #720 idiom: a
`question_shown` frame carries **no `turn_id` and opens and closes no turn**, so it is daemon state,
not a turn-stream item. Whether a question panel ever becomes a timeline surface is #850's call, not
this slice's.

**The three cases are load-bearing beyond compilation.** `assertNever` throws
`` new Error(`Unhandled daemon event: ${JSON.stringify(event)}`) `` — a missing case would serialize
the whole event, nonce and claude-authored text included, into an error message. See § Security review.

## State + concurrency model

None. The emit is a synchronous call inside the existing inbound message handler, on the same
synchronous path `modalShown` already takes; `emitDaemonEvent` is a guarded `webContents.send` with no
`await`, timer, listener or shared mutable state. No store slice, no subscription, nothing to cancel
or tear down. The three bridges gain pure `return null` branches, which allocate nothing and dispatch
nothing — the existing `if (event) dispatch(...)` guard in each `subscribe*` already skips them.

The one lifecycle fact worth naming is inherited, not added: `emitDaemonEvent`'s destroyed-window
guard (#518) covers this call site like the other thirty-odd, so a batch arriving after the window
closes is dropped rather than throwing into the ws handler.

## Error handling

No new error type, no new result type, no new catch. Failure modes on this leg and where each is
already answered:

| Failure | Answered by |
|---|---|
| Malformed frame | #884's `parseQuestionShownPayload` throws `WireDecodeError` before this case is reached; the existing single `catch` in `daemonConnection.ts` drops the line without emitting |
| Missing / wrong-typed field | Same — which is why every field here is read bare |
| Window destroyed mid-emit | `emitDaemonEvent`'s `isDestroyed()` guard drops and returns |
| A future arm added without a bridge case | The three `assertNever` guards, unchanged, at compile time |

The renderer-side error surface is unchanged: the three bridges return `null` and dispatch nothing, so
no store reducer sees this arm and no UI state can enter an error branch because of it. An empty
`questions: []` (out of contract daemon-side, a producer bug) crosses without special handling — this
leg polices nothing the decode already policed, and #850 owns what an empty batch means on screen.

## Testing strategy

All vitest. No Playwright spec: this slice adds no interaction and no render surface.

**Round-trip emit — `src/main/daemonConnection.test.ts`** (AC 4). A `questionShownPlaintext` helper
beside `modalShownPlaintext`, and a `createDaemonConnection — question_shown stream (#885)` describe
reusing the file's existing `connected()` pattern. This is the block that earns its keep against a
missing, mis-routed or mis-populated emit — none of which tsc catches, because the inbound switch has
no `assertNever`. A *mistyped* literal is already a compile error via `emitDaemonEvent`'s typed
parameter, so no test targets that.

- A well-formed two-question batch drives through decode and emits exactly one `questionShown`,
  asserted with an exact `toEqual` on all four fields, nested options in wire order, `multi_select`
  both `false` and `true`.
- `Object.keys(...).sort()` equals exactly `['conversationId', 'questionBatchId', 'questions',
  'type']`, and an extra `smuggled` key planted on the frame appears nowhere in the emitted JSON —
  the pair that actually catches a spread (AC 1). Planted at all three levels, since this family
  nests two deep and the top-level check alone would miss a row-borne extra.
- A malformed frame (non-boolean `multi_select`) emits nothing and does not throw — the fail-closed
  path stays fail-closed with the emit wired.
- An empty `questions: []` still emits, carrying `[]` — a decoded batch is not dropped here for being
  out of contract; that judgement is #850's.

**Three bridge no-ops** (AC 3), each in that file's own established idiom:

- `daemonEventBridge.test.ts` — a dedicated `questionShown → null` case, matching the
  `backgroundTaskRoster → null` test's shape.
- `timelineBridge.test.ts` — an entry in the existing `others` no-op array, **plus** the file's second
  form: a `creates NO timeline item` test asserting both halves (same state reference, zero items),
  which is what actually proves nothing was dispatched.
- `modalBridge.test.ts` — an entry in its `others` no-op array.

Each fixture carries a realistic two-level batch (two questions, options each, `multi_select` mixed)
rather than a stub, so the assertion also pins that the nested rows type-check on the renderer side.

**Not tested, deliberately:** no test asserts "nothing is logged" on this leg. `emitDaemonEvent` is
log-free by construction and already has its own tests; this slice adds no log call, so such a test
would assert the absence of code that was never written — it would pass green forever regardless of
what this slice did.

## Open questions

1. **Does the `daemonEventBridge` case belong in its own `case` block or in a fall-through group?**
   That file uses per-arm cases with individual comments for every recent arm (`modelAnnounced`,
   `backgroundTaskRoster`), while the other two use grouped fall-through. Leaning per-arm, following
   the file's own local convention rather than imposing consistency across the three. Resolve while
   writing.
2. **Should the arm sit after the modal arms or at the end of the union?** The ticket says beside the
   modal arms; the union's recent additions have accreted at the end. Leaning beside the modal arms as
   the ticket states — the two families are read together and the neighbourhood carries meaning
   (`modalShown` is the `conversationId`-scoping precedent this arm copies). Resolve at the edit.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** SHOULD FIX, and it is the direct answer to #884's review, which named this
  ticket: the decode made the *shape* trusted and left the four strings untrusted, and the type system
  carries no signal for that (`string` is `string`; no branded type exists). Phase B must state the
  provenance split explicitly in the arm's doc comment — ids daemon-asserted, `question` / `header` /
  `label` / `description` claude-authored, unbounded, unsanitized, plain-text-render-only — exactly as
  the `modalShown` arm does for `title` / `prompt` / `options[].label`. The verifier should check it
  landed. Not a MUST FIX because this slice hands the value to no renderer consumer: the three bridges
  return `null`, so nothing reads the strings until #850 and its render slice, which own the escaping
  boundary. The direction of this boundary is also the safe one — main → renderer, one-way. It adds no
  `ipcMain.handle`, no reply channel and no renderer-supplied input, so the checklist's
  "renderer → main-process state" concern does not arise.
- **[Tokens, secrets]** No findings. `question_batch_id` is a one-time unguessable nonce, and it
  crossing to the renderer is required, not incidental — #850's panel cannot correlate an answer
  without it, and `modal_id` has crossed on identical terms since #201. Verified rather than assumed
  that it reaches no sink on this leg: `emitDaemonEvent` is log-free by construction (module header and
  function doc both state it, including on the destroyed-window drop path), this slice adds no log call
  at the emit, and the three bridges dispatch nothing. No comparison against the nonce happens here;
  the answer path is upstream pyrycode#1907.
- **[Errors, logs, telemetry]** No findings, and one non-obvious reason the three bridge cases are
  load-bearing beyond compilation. Each bridge's `assertNever` throws
  `` new Error(`Unhandled daemon event: ${JSON.stringify(event)}`) `` — so an arm reaching a bridge
  with **no case** serializes the entire event, the unguessable nonce and all four claude-authored
  strings included, into an `Error.message` that propagates out of the subscription callback into
  whatever handles it. AC 3's three explicit cases are what keep the batch out of that stringify. This
  reframes them: they are not a compile formality, they are the sink guard. The failure is
  compile-blocked (tsc rejects the missing case before it can ship), which is why this is a "no
  finding" rather than a MUST FIX — but it is the reason no bridge may be given a catch-all
  `default: return null` as a shortcut, which would make the guard silently non-exhaustive and put a
  future arm on exactly that path.
- **[File / storage]** N/A by design — a pure in-memory forward of an already-decoded object. No path
  is constructed, no `fs` call, no write, nothing reaches `userData` or any renderer-side web storage
  (`localStorage` / IndexedDB are untouched; the bridges hold nothing). No traversal or TOCTOU surface
  exists to reason about.
- **[Electron attack surface]** No findings, three of them verified in the source rather than assumed.
  (a) No new `contextBridge` API and no new `ipcMain` channel: `DAEMON_EVENT_CHANNEL` and preload's
  `onDaemonEvent` already exist and forward `DaemonEvent` generically — read to confirm, which is also
  what holds this slice to five production files. (b) No `BrowserWindow` / `webPreferences` change, no
  navigation or window-open handler, no protocol registration. (c) Everything crossing is
  structured-clone-safe by construction: the #884 narrower builds fresh literals from `requireString`
  values, so the payload is plain strings, arrays and objects — no function, no class instance, no
  cycle, and no `__proto__` can ride, because each row is built from named keys rather than assignment
  from wire keys. `readonly` is erased by the clone, matching every prior nested-array arm. Process
  placement is unchanged: keys, sockets and the Noise session stay in main; the renderer gains a typed
  event and no capability.
- **[Cryptographic primitives]** N/A — none introduced, none touched. No RNG, no key, no derivation,
  no AEAD, no secret comparison on this leg. The nonce is forwarded, never compared: had this slice
  compared it, `===` would be correct rather than `timingSafeEqual` (#883 records why), but it does
  not.
- **[Network & I/O]** No findings. No socket, no URL, no TLS decision, no timeout is introduced —
  this is an in-process forward downstream of the relay read. Memory exhaustion from a hostile or
  buggy producer is the applicable threat and it is bounded upstream and unchanged:
  `parseInboundMessage`'s `MAX_PLAINTEXT_BYTES` guard runs before the parse, so the batch is capped at
  ~64 KiB of strings before it can reach this emit. The structured clone is O(N) in that bounded size,
  and the two levels nest rather than cross-product, so there is no amplification.
- **[Concurrency]** N/A — a synchronous emit on the existing inbound path, with no `await`, timer,
  listener or shared mutable state added. Nothing outlives the call. The one lifecycle concern on this
  channel, emitting into a destroyed window after a macOS window close, is answered by
  `emitDaemonEvent`'s inherited `isDestroyed()` guard rather than by anything this slice writes.
- **[Threat model alignment]** **Hostile daemon response** is answered upstream by #884's fail-closed
  decode — a malformed frame never reaches this case — and the residual, that a *well-formed* frame
  can carry arbitrary claude-authored text, is deliberately preserved rather than defended here:
  bounding or sanitizing at this hop would present truncated text as complete, which this family has
  no `truncated_fields` to report. **Malicious / compromised relay:** unchanged — content-blind and
  on-path, a flood is bounded by the frame cap, a dropped batch parks the session, which #883 already
  records as the chosen price of the all-required mirror. **Renderer compromise reaching the
  transport:** unchanged — the arm is one-way main → renderer and grants the renderer no new
  capability, no handle and no reply path. **Token theft from disk:** N/A, nothing persists.
  OUT OF SCOPE, named: the escaping/render boundary and the meaning of an empty batch (#850 and its
  render slice); the outbound answer verb (upstream pyrycode#1907); `question_dismissed`
  (pyrycode#1974, sibling slice).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-01
