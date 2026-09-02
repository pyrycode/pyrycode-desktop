# 922 — Continue sends the batch's answers once every question holds one

Split from #853, and the last inert control on the question panel. #919 landed the `question_answer`
frame, #920 the command that mints its token, #921 the local clear this slice reuses. This slice
assembles what the operator picked into that frame's `answers` array, sends it, and keeps Continue
unavailable until every question in the batch holds a value.

## Files read

- `src/renderer/src/screens/conversation/questionResolution.ts` → `refuseQuestionBatch`,
  `QuestionRefuseDeps`, `QUESTION_REFUSAL_OUTCOME`, `QUESTION_REFUSAL_SOURCE` — the seam #921
  established for exactly this: injected effects, guarded send, clears outside the `try`. Its
  "nothing claude-authored reaches this module" docblock is **corrected** by this slice; see Design.
- `src/renderer/src/screens/conversation/QuestionPanel.tsx` → `QuestionPanelView`, its
  `isLastQuestion` derivation and the single `question-panel__continue` `<button>` — the one element
  in two roles, and the comment recording why it must stay one.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `QuestionPanelSlot`,
  `ComposerSlot` — the container that owns both store reads, the `activeIndex` clamp, and the
  `sendCommand: window.pyry.sendCommand`-inside-the-click-closure idiom.
- `src/renderer/src/store/questionPicksStore.ts` → `QuestionSelection`, `QuestionPicksState`,
  `selectQuestionSelection`, `EMPTY_QUESTION_SELECTION`, `withSelection` — the picks half. Records
  that `optionIndices` is held in **ascending display order**, that `otherText` is held
  independently of `otherTicked`, and that resolving a stored position back to a label at answer
  time is this ticket's job.
- `src/renderer/src/store/questionBatches.ts` → `Question`, `QuestionOption`,
  `reduceQuestionBatches`' `shown` arm, `QuestionBatchEvent`'s `dismissed` arm — the batch half.
  The `shown` arm is **latest-wins in place**, which is where the stale-position hazard below comes
  from.
- `src/shared/wire/types.ts` → `QuestionAnswerEntry`, `QuestionAnswerPayload` — the frame's shape.
  Records that `question_index` is never range-checked client-side, that `values` is never validated
  against the offered labels, and that there is no `response` field to add.
- `src/shared/ipc/commands.ts` → `answerQuestionsCommand`, `AnswerQuestionsCommandPayload`,
  `isAnswerQuestionsPayload` — #920's command: `question_batch_id` + `answers`, token
  `Omit`-excluded so the renderer cannot supply one.
- `src/renderer/src/screens/conversation/modalResolution.ts` → `ModalResolveDeps`, `answerPrompt`,
  `cancelPrompt` — the precedent for ONE deps interface serving both the answer and the cancel path.
- `src/renderer/src/screens/conversation/conversation.css` → `.question-panel__continue`,
  `.composer__send:disabled`, `.log-data__download:disabled` — the filled treatment and the house
  unavailable convention. See Design source.
- `e2e/question-cancel-refuses.spec.ts` (#921) → `capturingQuestionFake`, `questionShownFrame` — the
  capture-then-delegate outbound seam and the capture-time narrowing this spec reuses.
- `docs/knowledge/features/question-panel.md` — package overview, if present at implementation time.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6657

The panel's Actions row: a right-aligned 16px-gap row of three `Button small` instances — outlined
Cancel (347:6661), outlined Previous (347:6888), filled Continue (347:6692) — each a 6px-radius pill
carrying `body-small` emphasized copy, the filled one `Schemes/Primary` under `Schemes/On Primary`.
**The design draws no unavailable state**, and a static frame cannot express one that depends on
what the operator has picked, so the treatment below is this ticket's own rather than a design read.

The house convention is followed rather than invented: `.log-data__download:disabled` is the filled
member of the `.composer__send:disabled` family, and it mutes the CONTENT colour to
`--color-on-surface-variant` and drops the pointer affordance while keeping the button's own fill —
no opacity literal, no new geometry, no border change. `.question-panel__continue:disabled` copies
that pair exactly. Nothing else on the row changes, so Cancel's and Previous's markup stay as #921
and #916 shipped them.

## Context

Continue has been drawn since #906 and inert ever since. The wire type (#919), the command and its
main-side token mint (#920) all exist with no caller on this path. Until this slice an operator who
has picked answers has no way to send them.

**The gate is the operator-facing feature, not a nicety.** Upstream's `answerVerdict`
(pyrycode `cmd/pyry/modal_resolve_v2.go`) rejects an answer whose entry count is not exactly the
parked question count, and the rejection is **total and silent**: `AnswerQuestion` returns false
having assembled nothing, the batch's one-shot is not consumed, no `question_dismissed` fires, and
the relay handler's false branch is a debug log with no reply and no error envelope. An under-filled
Continue would therefore produce no round-tripped rejection at all — the button would appear to do
nothing until the approval window elapsed. Gating client-side is what keeps that state unreachable,
which is also why #853's rejection-banner criterion is gone: there is no daemon-originated rejection
on this path to correlate a banner against, and the reachable local failure (a throwing send bridge)
is already #921's.

**No ADR is owed.** This slice adds no new decision record surface: the answer shape was settled by
#919 (no `response` field) and the resolution seam by #921. The documentation phase folds the
lessons into the package overview.

**On sizing.** The refiner measured this at ~620 lines and recorded `needs-human:sizing` on the
ticket rather than splitting, with three candidate splits named and each rejected for shipping a
knowingly broken intermediate (a Continue that lights up and does nothing; a Continue that sends a
silently-rejected frame; a parent left unprovable because renderer specs here cannot click). This
plan agrees and adds one correction: the file count is **4** production `.ts`/`.tsx` files, not the
3 the refiner counted — the picks store's new read shape, which the ticket body itself names, was
not in that tally. That is one over the size-S line on top of the line count already flagged. The
call stands and is not re-routed: the sizing judgement is already discharged on the board with the
marker on, all three candidate splits were measured, and the two nearest analogues in this family
(#912 at 736 lines, #921 at 641) both landed clean at `size:s` on this budget.

## Design

### One pure function, in `questionResolution.ts`

```ts
export function resolveQuestionAnswers(
  questions: readonly Question[],
  selections: ReadonlyMap<number, QuestionSelection>
): QuestionAnswerEntry[] | null
```

Returns the batch's entries in question order, or `null` when any question holds no value.
**Answerability and the payload are the same computation** — a batch with a gap has no entry to emit
for that question, so the button's state and the frame's contents cannot disagree and a "which is
it?" bug is not expressible. The container calls it once per render and feeds both the gate and the
send from the one result.

Per question at index `i`, in order:

1. `values` = each position in `selections.get(i)?.optionIndices` resolved to
   `questions[i].options[position].label`, in the held ascending display order.
2. Then, if the Other row is ticked **and** `otherText.trim()` is non-empty, that trimmed string is
   appended — carried as the value itself, never the word "Other", and always last.
3. An empty `values` means the batch is incomplete: return `null` immediately.

A `null` return is the only incomplete signal; there is no partial array and no per-question flag.

**A stored position may be out of range, and that is reachable rather than defensive.**
`reduceQuestionBatches`' `shown` arm replaces a held batch **in place, latest wins**, and neither
store clears picks on a re-delivery — only `dismissed` and `reconnected` do. So a same-nonce
`question_shown` carrying a shorter `options` array leaves a pick pointing past the end, and
`questions[i].options[position].label` would throw `undefined.label` **out of the render**, because
this function runs during render to compute the gate. This is the identical failure the container's
`activeIndex` clamp already guards one level up. Decision: an out-of-range position **contributes no
value and is skipped**; if that empties the question, the batch is incomplete and Continue goes
unavailable. Sending a hole, or crashing the window, are the two alternatives and both are worse on
traffic the daemon controls and the reducer explicitly supports.

**`question_index` is the question's own array index and is not range-checked** — the wire type's
own ruling, and there is nothing to check against here anyway since the indices are generated by
iterating the batch this client holds.

### This is where claude-authored text first leaves the module boundary

`option.label` crossed the subprocess trust boundary unsanitized, and this slice is the one place it
is read for a purpose other than rendering. It goes into `values` and **nowhere else**: the entry is
built with the fixed literal keys `question_index` and `values`, never a computed key, so no label
becomes an object key, a `Map` key, a React key, an attribute, a URL, a filename, or a log line.
Publishing it outbound does not make it trusted, which is exactly why `question_index` names the
question rather than its text — the daemon rebuilds the text-keyed map claude receives from its own
parked copy.

Two consequences for the implementation, both obligations rather than notes:

1. **`questionResolution.ts`'s module docblock currently claims "NOTHING CLAUDE-AUTHORED REACHES THIS
   MODULE … by construction rather than by care."** After this slice that is false, and a stale
   comment asserting a security property the module no longer has is worse than no comment — a later
   editor would read it as licence to log from here. The docblock is corrected in the same commit,
   stating what actually holds now: untrusted text passes through this module into one payload field
   and reaches no other sink.
2. **Nothing on the incomplete path is logged.** The reflex debug line
   (`console.warn('incomplete', answers)`) would put the partial payload — labels plus the operator's
   typed text plus, one field over, the batch nonce — into a sink. An incomplete batch is not an
   error; it is the gate working.

### The send effect, beside `refuseQuestionBatch`

```ts
export function answerQuestionBatch(
  questionBatchId: string,
  answers: readonly QuestionAnswerEntry[] | null,
  deps: QuestionResolveDeps
): void
```

`null` in means **nothing happens** — no send, no clear, no log. That is the gate's second layer and
it is deterministic code rather than a second stochastic rule: the button is `disabled`, and if a
handler fires anyway the same value that disabled it also refuses the send. Non-null takes
`refuseQuestionBatch`'s shape verbatim: the `sendCommand(answerQuestionsCommand({…}))` inside a
`try`, both local dispatches **outside** it and **picks first**, so a bridge failure still clears the
panel and the local clear cannot drift from `subscribeQuestionBatches`' order.

`QuestionRefuseDeps` is **renamed** `QuestionResolveDeps` and serves both functions — the fields are
identical and `modalResolution.ts`'s `ModalResolveDeps` is the precedent for one interface across an
answer and a cancel. Four line edits, no behaviour change.

Two new client-owned constants for the local `dismissed` event, matching #921's pair rather than
reusing it: `QUESTION_ANSWER_OUTCOME = 'answered'` and `QUESTION_ANSWER_SOURCE = 'client'`.
`'answered'` must not be the refusal's `'refused'` — a later reader merging the families must be able
to tell an answer from a refusal — and the source stays **outside** `WireModalSource`'s closed
`{remote, local, timeout}` set for the reason #921 records: `'local'` there means an ANSWERED
outcome, so borrowing it would make a client-side event indistinguishable from the daemon's own.
`reduceQuestionBatches` consults neither field; both are a forward carry.

### The picks store's new read shape

```ts
export const selectBatchSelections =
  (questionBatchId: string) => (s: QuestionPicksState): ReadonlyMap<number, QuestionSelection>
```

The whole batch's picks, mirroring `selectQuestionSelection`'s factory shape and its stability
contract: a held batch answers with the inner map **by reference** (`withSelection` clones on write,
so it is stable across a write to any other batch), and an untouched batch answers with a hoisted
shared empty `Map` — the `EMPTY_QUESTION_SELECTION` mechanism, because `useStore` compares the
selector's RESULT under `Object.is` and a fresh `new Map()` per call would spin a bound component.
Safe to call inline in a render with no `useMemo`, exactly as the existing selector is.

The slot keeps its existing `selectQuestionSelection` read for the ACTIVE question rather than
deriving it from this map: that would need the deliberately-unexported empty sentinel, and the two
subscriptions cost nothing — the batch-wide read already re-renders the slot on every pick, so the
narrow one is a strict subset.

### The view's conjunction

`QuestionPanelView` gains `canAnswer: boolean` and `onAnswer: () => void`, both required so `tsc`
forces the one call site. The trailing button stays **one element**; only its attributes vary:

```
disabled={isLastQuestion && !canAnswer}
onClick={isLastQuestion ? onAnswer : () => onQuestionSelected(activeIndex + 1)}
```

The conjunction lives here because `isLastQuestion` does, and it is what keeps stepping ungated:
`disabled` is false in the Next role no matter what has been picked, so an incomplete batch can
still be walked to the question that completes it. Gating on completeness alone would strand the
operator on question 1 and deadlock the panel. Previous and Cancel are untouched.

## State + concurrency model

No new store slice, no async task, no timer, no listener, no subscription, no teardown. The whole
slice is one synchronous click handler over two existing zustand stores plus one `sendCommand` hop,
so there is no cancellation path to define and no check-then-act gap across an `await`. The one
ordering decision (picks-first) is inherited from #921 and pinned by a spec assertion. A double
click is idempotent: the second dispatch pair is an unknown-id no-op in both stores, and the batch
is one-shot daemon-side.

`window.pyry` is dereferenced only inside the click closure — interaction time, never render — so
the container's smoke render still touches no bridge.

## Error handling

- **A throwing send bridge** is swallowed and the panel still clears, `refuseQuestionBatch`'s
  posture: the operator's answer did not land, the daemon keeps the batch parked, and the next
  reconnect re-asserts it. Failing open in that direction is deliberate — the operator sees the ask
  again rather than believing an answer landed that did not.
- **The catch logs a static, content-free string and drops the error object**, harder here than in
  #921: the payload this send choked on now carries claude-authored option labels and the operator's
  own typed text beside the batch nonce, and an `Error` from a failing structured clone can
  stringify it.
- **An incomplete batch** is not an error path at all — `resolveQuestionAnswers` returns `null`, the
  button is unavailable, and `answerQuestionBatch` refuses. Nothing is logged, because nothing went
  wrong.
- **A stale option position** (above) is absorbed, not thrown.

## Testing strategy

Vitest, `environment: 'node'` — static server renders and plain spies:

- `questionResolution.test.ts` — `resolveQuestionAnswers`: a complete multi-question batch yields
  entries in question order with labels in ascending display order; Other text is trimmed, carried
  as its own value and placed after the ticked labels; whitespace-only Other text does not satisfy
  the gate; a ticked Other with no options is a complete question; an untouched question, an empty
  selection and a ticked-but-blank Other each yield `null`; an out-of-range position is skipped and
  can itself make the batch incomplete; a value matching none of the offered labels (the Other case)
  is carried unchanged. `answerQuestionBatch`: `null` performs no effect at all; a complete answer
  sends exactly one `answerQuestions` command carrying the entries and no token; the two dispatches
  land picks-first and outside the `try`; a throwing send still clears both stores.
- `questionPicksStore.test.ts` — `selectBatchSelections`: an untouched batch returns the shared empty
  map (same reference twice), a picked batch returns the held inner map by reference, a write to a
  sibling batch leaves that reference intact, and the hostile-key reads (`__proto__`, `constructor`,
  `''`) answer empty before any write.
- `QuestionPanel.test.tsx` — the disabled matrix on the trailing button: last question + incomplete
  is `disabled`, last + complete is not, a non-last question is never `disabled` and still reads
  Next. Exactly one `question-panel__continue` element in every case, so the two roles cannot become
  two elements.

Playwright fake tier, `e2e/question-answer-continue.spec.ts` — the only place the click itself and
the outbound frame can be proven. A three-question batch (single-select, multi-select, Other),
driven end to end: with nothing answered the trailing button reads Next and steps forward (AC2);
with the batch part-answered Continue on the last question is `disabled` (AC1); answering the last
question flips it available; clicking it sends exactly one `question_answer` whose entries are
asserted whole (AC3), the panel clears and the composer returns with its draft intact (AC4). The
capture **narrows at capture time** to `{ type, question_batch_id, answers }` so `answer_token`
never enters a spec array, a diff, or a failure diagnostic — #921's rule, unchanged.

## Open questions

- Whether `.question-panel__continue:disabled` needs a `background` change as well as the muted
  content colour. Resolved against `.log-data__download:disabled` (content only, fill kept) before
  implementation; if the rendered result reads as available anyway, the deviation and its reason go
  in a `## Revisions` entry rather than a silent second property.
- Whether the e2e tier can drive a `multi_select` question's checkbox rows and the Other field in
  one spec without a second launch. Expected yes (#912 drives both), confirmed during Phase B.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX, addressed in the design rather than deferred.** This is the slice
  where claude-authored text stops being render-only: `option.label` is read out of the held batch
  and placed into the outbound frame's `values`. The boundary is a single named function
  (`resolveQuestionAnswers`), not scattered, and the entry is built from fixed literal keys so no
  label reaches a key, an attribute, a URL, a filename, a cache key or a log — the standing family
  obligation, discharged by construction. The finding is the **stale docblock**: the module still
  asserts that nothing claude-authored reaches it, which this slice falsifies, and a later editor
  trusting it would log from here. The design requires correcting it in the same commit. Direction is
  outward only — nothing inbound is parsed here. The renderer→main crossing is #920's
  `isAnswerQuestionsPayload`, which recurses into each entry and each `values` element (with
  `for…of`, not `every`, so a sparse array cannot smuggle a `null` through), and `answerQuestions`
  then **deep**-rebuilds the payload and every entry from fresh literals — so an extra key at either
  depth is dropped rather than serialized.
- **[Tokens, secrets, credentials] No findings.** The renderer never holds an `answer_token`:
  `AnswerQuestionsCommandPayload` is `Omit<QuestionAnswerPayload, 'answer_token'>`, so a caller
  cannot supply one even deliberately, and the mint is `daemonConnection.answerQuestions`' with the
  main process's CSPRNG — a smuggled token loses to the minted one at rebuild time. No storage, no
  rotation, no revocation surface added. `questionBatchId` is an unguessable one-time nonce, passed
  through opaquely and never compared, so no `timingSafeEqual` question arises. The e2e capture
  narrows to `{ type, question_batch_id, answers }` **at capture time**, so no spec array, diff or
  failure diagnostic can hold a token. New this slice: the operator's Other text is now sent; it is
  ordinary user content on the same footing as a chat message, and the no-log rules below cover it.
- **[File / storage operations] Not applicable by design.** No filesystem path, no persistence, no
  `localStorage`, no IndexedDB. `questionPicksStore` refuses persistence for this family — writing
  live nonces and operator text into a hand-editable blob — and that refusal stands unchanged.
- **[Inter-process / Electron attack surface] No findings.** No new `contextBridge` API, no new
  `ipcMain` channel, no new window, no `webPreferences` change, no protocol handler, no navigation:
  this slice is a new *caller* of an already-validated command. `window.pyry` is dereferenced only
  inside the click closure, so no render path touches the bridge. The renderer composes more of this
  frame than of any sibling (an array of objects rather than a flat scalar row), which is exactly why
  #920's guard is the one in that file that recurses — and it is already landed and tested.
- **[Cryptographic primitives] Not applicable.** No RNG, no hashing, no comparison, no key material
  and no Noise surface in the renderer. The one randomness need on this path is the token, main-side
  and already landed.
- **[Network & I/O] No findings.** The renderer opens no socket and sets no deadline; the frame rides
  the existing supervised relay with its established caps. An over-cap payload is a fail-closed
  `WireEncodeError` inside `answerQuestions` — the send is dropped **whole, never truncated**,
  because a trimmed answer would send a different choice than the operator made — and nothing
  retries, so there is no loop to spin.
- **[Error messages, logs, telemetry] SHOULD FIX, addressed in the design.** Two reflexes are wrong
  here and both are named in Design. The catch must log a **static content-free string and drop the
  error object**: the payload this send choked on carries claude-authored labels, the operator's own
  typed text, and the batch nonce, and an `Error` raised by a failing structured clone can stringify
  the argument it choked on. And the incomplete path must log **nothing at all** — the debug line a
  developer reaches for there would put the partial payload in a sink, for a state that is the gate
  working rather than a fault. The verifier should check the implemented catch carries no
  interpolation and no second argument, and that no `console.*` appears on the `null` branch.
- **[Concurrency] No findings; one residual named rather than guarded.** The whole slice is one
  synchronous handler — no `await`, no timer, no listener, no teardown — so there is no cancellation
  path to define and no check-then-act gap across a suspension point. Double-click is idempotent
  (unknown-id no-op in both stores, one-shot daemon-side). The residual: `answers` is computed at
  render and consumed at click, so a same-nonce `question_shown` re-delivery landing in that window
  leaves the closure holding entries resolved against the *previous* delivery's labels. The worst
  case is an answer recorded against re-worded questions — and it is **not exploitable**, because the
  party that would have to mount it is the daemon, which both re-delivers the batch and resolves it.
  It can already record whatever answer it likes; there is no deputy to confuse. The likelier
  outcome, a shrunk batch, is rejected totally by `answerVerdict` and degrades to the swallowed-send
  behaviour below. Recomputing inside the handler would be no fresher and would split the one
  computation the gate and the payload deliberately share.
- **[Threat model alignment]** The applicable desktop threat is a **hostile or degraded relay
  dropping the answer**. The design fails open in the safe direction on purpose: the client clears
  optimistically, the daemon keeps the batch parked, and the next reconnect re-asserts it — the
  operator sees the ask again rather than believing an answer landed that did not. **Renderer
  compromise** gains no new capability class: the widest capability added is "answer a batch whose
  nonce you already hold, with values you choose", which steers claude's next turn with chosen text —
  strictly weaker than the `sendMessage` command a compromised renderer can already issue, and it
  approves nothing (a question batch is a clarifying ask, not a permission modal). Process isolation
  is untouched: no key, token or socket becomes renderer-reachable. **Out of scope:** pyrycode#702's
  per-device remote-permission opt-in, which defaults to deny and makes a correct answer from a
  non-opted-in device indistinguishable from a swallowed send at this layer — that is a live-run
  concern owned by **#923**, already wired blocked-by this ticket and already carrying
  `needs-real-claude`.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
</content>
</invoke>
