# Question panel — Cancel refuses the batch (#921)

Split out of [Question panel](conversation-shell-question-panel.md) on 2026-09-02 to keep that document
under the size cap. Part of the question vertical's render slice; see that document for the panel's frame,
header tabs and step controls, and [Question-batch model](question-batch-model.md) for the model and
bridge underneath both.

Through #916 the Actions row's Cancel button was inert chrome carrying only its copy constant — the panel
had a single exit and it had never worked. #919 landed the `question_refused` wire type and #920 the
`refuseQuestionsCommand` plus the main-side `answer_token` mint (`daemonConnection.refuseQuestions`);
nothing called either. This slice gives Cancel the row's first sending handler: it refuses the outstanding
batch and clears both question stores, so the composer returns underneath.

**The daemon owns what claude is told, not the client.** Cancel's frame carries the batch id and nothing
else the client composed — no client-authored refusal text. Upstream pyrycode#1990 consumes the batch,
denies claude's blocked call with a fixed instruction to wait for the operator's message, and broadcasts
one `question_dismissed`. Discussing before answering is Cancel plus an ordinary chat message, which is why
the design has no third button.

**`questionResolution.ts` (new, co-located with the screen, framework-free and React-free)** is the guarded
send plus the two local clears, mirroring `modalResolution.ts`'s `cancelPrompt` shape — injected `{
sendCommand, dispatchPicks, dispatchBatch }` deps, so `refuseQuestionBatch(questionBatchId, deps)` is a
plain, deterministic function tested with spies rather than a DOM:

```ts
export function refuseQuestionBatch(questionBatchId: string, deps: QuestionResolveDeps): void {
  try {
    deps.sendCommand(refuseQuestionsCommand({ question_batch_id: questionBatchId }))
  } catch {
    console.error('question refusal send failed')   // static, content-free — see below
  }
  deps.dispatchPicks({ type: 'dismissed', questionBatchId })
  deps.dispatchBatch({ type: 'dismissed', questionBatchId, outcome: 'refused', source: 'client' })
}
```

**The deps interface is `QuestionRefuseDeps` as shipped here, renamed `QuestionResolveDeps` by
[#922](question-panel-continue-answer.md)**, which added a second exit (`answerQuestionBatch`) over the
same three effects. The fields are unchanged; only the name generalized to cover both, the
`modalResolution.ts`'s `ModalResolveDeps` precedent for one interface across an answer and a cancel.

Renderer specs here are static server renders with no DOM and nothing to click (AC3's "a throw out of the
send bridge does not reach the render" is unreachable from a component test), so the guarded send had to
live in a seam vitest can drive directly rather than inline in `QuestionPanelSlot`; the click itself is
`e2e/`'s. Both dispatches sit **outside** the `try` — a swallowed send still clears the panel, matching
`modalResolution.ts`'s shape exactly.

**Picks-first, matching `subscribeQuestionBatches`' own fan-out order (see [Question-batch
model](question-batch-model.md) § The bridge).** Zustand notifies subscribers synchronously
inside `setState`, so whichever store is written first has already woken every subscriber before the second
write happens. Picks-first makes the intermediate state "batch still held, picks already cleared" —
indistinguishable from an untouched batch — where batch-first would expose a stale pick outliving its
batch at an observable instant, the state the picks store exists to prevent.

**`QUESTION_REFUSAL_OUTCOME = 'refused'` and `QUESTION_REFUSAL_SOURCE = 'client'`, both client-owned and
deliberately outside every daemon vocabulary.** `QuestionBatchEvent`'s `dismissed` arm is not widened, not
duplicated by a local arm, and no daemon value is copied out of the wire vocabulary — these two constants
go through the existing arm instead, and `reduceQuestionBatches` consults neither, so they are a forward
carry only. Neither collides with the daemon's one landed pair (`outcome: "unanswered"` / `source:
"no_answer"`), which matters so a later reader can tell the operator's deliberate refusal from a daemon
safe-deny. **`'client'`, deliberately not `'local'`** — the value `modalResolution.cancelPrompt` writes and
the one a reader arriving from that family reaches for first. `'local'` is a member of `WireModalSource`'s
closed `{remote, local, timeout}` set, where it means an *answered* outcome; carrying it here would let a
later reader merging the two families mistake a refusal for the operator's own choice — exactly what this
store's fail-closed rule (an unrecognised `source` means resolved, cause unknown, never an answer) exists
to prevent.

**`QuestionPanelView` gained one required prop, `onCancel: () => void`**, passed straight through to the
existing Cancel `<button>`'s `onClick` with no wrapping arrow — there is no argument to supply, and the
container's single read of `batch.questionBatchId` is what the refusal is recorded against, never a value
this view holds. Required rather than optional, so `tsc` forces the one call site to supply it. Nothing
else about the row changed: no class, no attribute, no copy, no conversation.css edit — the Figma read
confirmed the Actions row's treatment (`347:6657`) is exactly what #906/#916 already shipped, and the
view's spec asserts Cancel's rendered markup is byte-identical to what #906 shipped, so the handler leaks
no attribute.

**`QuestionPanelSlot` wires `onCancel` inside the click closure**, dereferencing `window.pyry.sendCommand`
only at interaction time — never during render, the queued backlog's own drop-closure
(`ConversationScreen`'s `onDrop` bind, since [#1009](https://github.com/pyrycode/pyrycode-desktop/issues/1009))
/ `Composer.handleSubmit` discipline — beside `questionPicksStore`'s and `questionBatchStore`'s `dispatch`,
both read off their singletons the same way the existing picks read already does:

```ts
onCancel={() =>
  refuseQuestionBatch(batch.questionBatchId, {
    sendCommand: window.pyry.sendCommand,
    dispatchPicks: dispatch,
    dispatchBatch: questionBatchStore.getState().dispatch
  })
}
```

**The catch logs a static, content-free string and drops the caught error** — a security-review finding
addressed in the design rather than deferred, and the one place this helper departs from
`modalResolution.cancelPrompt`'s `console.error('modal cancel send failed', error)`. `questionBatchId` is a
one-time unguessable nonce, and an `Error` raised by a failing structured clone or bridge teardown can
stringify the argument it choked on — the payload carrying that nonce — so the error object is the one part
that cannot be forwarded. The event name alone is the content-free log this feature owes; the binding is
not even destructured, so there is no value to forward by accident. **The renderer never holds an
`answer_token`** — `RefuseQuestionsCommandPayload` omits it, and the mint is main-side
(`daemonConnection.refuseQuestions`, #920) — so nothing on this path has one to log even by mistake.

**Testing.** `questionResolution.test.ts` (new, plain spies plus real `createQuestionBatchStore()` /
`createQuestionPicksStore()` instances, no React, no DOM): the command's payload key set is exactly
`question_batch_id` (AC1, asserted on the *command*, never on `answer_token`); both dispatches fire, the
picks event carrying the id alone (its key set asserted, since the batch event is structurally assignable
and would compile); one shared spy pins picks-before-batch order; a throwing `sendCommand` still yields both
dispatches (AC3); and a real refuse-then-daemon's-own-`dismissed` sequence asserts `toBe` reference identity
across the second event — "changes nothing further" proven as an identity rather than a shape.
`QuestionPanel.test.tsx` threads the new required prop through `renderBatch` with a no-op (a static render
fires nothing, so the wiring itself stayed e2e's, confirming the architecture doc's open question) and adds
the byte-identical-markup assertion above. **`e2e/question-cancel-refuses.spec.ts` (new)** is the first spec
in this repo to assert on an outbound frame: a spec-local capturing `buildReplyFrames` decodes each outbound
envelope, narrows a `question_refused` match to `{ type, question_batch_id }` **at capture time** — so the
token is never captured, asserted, or logged even structurally — and delegates every other verb to
`conversationStateFake()` so the app still seeds. Arc: `daemon.pushFrame` seeds `question_shown` (the #912
idiom) → panel visible → click Cancel → the captured frame is exactly one `question_refused` carrying the
spec's own batch id → the panel is gone and the composer is back with a pre-typed draft intact → push the
daemon's own `question_dismissed` for that id → nothing further changes. The local clear landed before the
captured frame in practice, but the spec asserts under auto-waiting rather than a fixed order, since the
frame crosses IPC → main → Noise → the loopback forwarder while the clear is synchronous.

**Security review: PASS** (builder self-review). The single new trust-boundary crossing is renderer → main
via `sendCommand`, already guarded by `isRefuseQuestionsPayload` (#920) with main-side fresh-literal
construction, so a smuggled `answer_token` cannot reach the wire even from a compromised renderer; nothing
inbound is parsed here, and `questionBatchId` is passed through opaquely — never parsed, keyed on,
truncated, or compared. No new `contextBridge` API, `ipcMain` channel, window, or persistence. The
applicable threat is a hostile or degraded relay dropping the refusal: the design fails open in the safe
direction — the client clears optimistically, the daemon keeps the batch parked, and the next reconnect
re-asserts it, so the operator sees the ask again rather than believing a refusal landed that did not. The
widest capability a compromised renderer gains is "refuse a batch whose nonce it already holds," which
resolves an ask without answering it and approves nothing; the *answer* path (#853) is explicitly out of
scope and not reachable through anything this slice adds.

## Related

- [Question panel](conversation-shell-question-panel.md) — the parent document: the panel's frame,
  `ComposerSlot`/`QuestionPanelSlot`, header tabs (#915) and step controls (#916).
- [Question panel — Continue answers the batch](question-panel-continue-answer.md) — the row's other
  sending control (#922), which reuses this document's guarded-send and picks-first-clear shape verbatim
  and renamed `QuestionRefuseDeps` to `QuestionResolveDeps` to serve both exits.
- [Question-batch model](question-batch-model.md) — `refuseQuestionBatch` is the first local dispatcher of
  this model's `dismissed` arm on both `questionBatchStore` and `questionPicksStore`; see its § Types and
  § The picks store for the arm and the withdrawn `resolved`-memory prediction.
