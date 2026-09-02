# 921 — Cancel refuses the question batch and clears the panel

Split from #853. Makes the question panel's Cancel button — inert chrome since #906 — send the
`question_refused` frame #919/#920 landed and clear the panel locally, so the composer returns.

## Files read

- `src/renderer/src/screens/conversation/QuestionPanel.tsx` → `QuestionPanelView`,
  `QUESTION_CANCEL_COPY`, `optionPickEventFor` — the pure view this slice gives its first sending
  control; the Cancel `<button>` currently carries copy and no handler.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `QuestionPanelSlot`,
  `ComposerSlot`, `QueuedBacklogControl` — the container that owns the store dispatches, and the
  `sendCommand: window.pyry.sendCommand`-inside-the-click-closure idiom every control here follows.
- `src/renderer/src/screens/conversation/modalResolution.ts` → `cancelPrompt`,
  `MODAL_CANCEL_OUTCOME`, `ModalResolveDeps` — the direct precedent for the whole shape: injected
  deps, the send inside a `try`, the local clear **outside** it.
- `src/renderer/src/store/questionBatches.ts` → `QuestionBatchEvent`'s `dismissed` arm,
  `reduceQuestionBatches`, `QuestionBatchState` — the arm this slice becomes the first local caller
  of, its fail-closed `source` reading rule, and the `resolved`-memory refusal that stands.
- `src/renderer/src/store/questionPicksStore.ts` → `QuestionPickEvent`'s `dismissed` arm,
  `createQuestionPicksStore` — the picks half of the clear, and the `init` seam the unit spec drives.
- `src/renderer/src/store/questionBridge.ts` → `subscribeQuestionBatches` — the picks-first fan-out
  order this slice's local caller must match, and why it is load-bearing rather than incidental.
- `src/shared/ipc/commands.ts` → `refuseQuestionsCommand`, `RefuseQuestionsCommandPayload`,
  `isRefuseQuestionsPayload` — #920's command: the batch id alone, the token minted main-side.
- `src/main/daemonConnection.ts` → `refuseQuestions` — where the `answer_token` is actually minted,
  so the renderer never composes one.
- `src/renderer/src/screens/conversation/QuestionPanel.test.tsx` → `renderBatch` — the single
  `<QuestionPanelView>` render site, so a new required prop is a one-line thread rather than a fan-out.
- `e2e/question-picks.spec.ts` (#912) → its `daemon.pushFrame(questionShownFrame(...))` seeding — the
  fixture precedent for putting this panel on screen.
- `e2e/run-config-settings.spec.ts` → `capturingRunConfigFake` — the capture-then-delegate
  `buildReplyFrames` shape this slice's outbound assertion reuses.
- `e2e/fixtures/conversationStateFake.ts` → `conversationStateFake` — the list-verb fallthrough a
  scripted `buildReplyFrames` must keep, or the app never seeds its conversation.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6657

The panel's Actions row: a right-aligned 16px-gap row of three small buttons — outlined Cancel,
outlined Previous, filled Continue — each a 6px-radius pill with `body-small` medium copy. Cancel
leads. **Its treatment is unchanged by this slice and no markup or `conversation.css` change is
expected**: the design read confirms the row is exactly what #906 and #916 already shipped, and this
ticket gives an existing button a handler rather than drawing anything new. The one visual assertion
owed is the negative: Cancel's rendered markup must stay byte-identical, so the handler leaks no
attribute (see Testing strategy).

## Context

The panel has had a single exit since #906 and it has never worked. #919 landed the
`question_refused` wire type and #920 the command plus the main-side token mint; nothing calls
either. Until this slice, an operator who does not want to answer can only wait for the daemon's ask
to time out, with the composer covered the whole time.

**Cancel sends a refusal rather than nothing.** The daemon owns what claude is told: pyrycode#1990
consumes the batch, denies claude's blocked call with a fixed instruction to wait for the operator's
message, and broadcasts one `question_dismissed`. So the refusal carries the batch id and nothing
else the client composed. Discussing before answering is Cancel plus an ordinary chat message, which
is why the design has no third button.

**This is the first thing in the family that dismisses a batch from the client side.** Both stores
already hold a `dismissed` arm keyed on the id alone; today only `questionBridge` drives them, from
the daemon's own broadcast. Two consequences follow and both stores already absorb them with no new
code: the daemon's own `question_dismissed` arriving afterwards is an unknown-id no-op returning the
same state reference in each store, and a batch cleared while the transport was down comes back on
the next reconnect because the daemon still holds it parked.

**No `resolved` id-memory, and `QuestionBatchState`'s docblock predicting one is corrected rather
than honoured.** The modal vertical's `resolved` slice (#195) existed to suppress re-delivery of a
modal the client had already answered, and #510 is the record of the cost: the retained id suppressed
the daemon's legitimate re-delivery and an operator's explicit Allow decayed into a timeout deny. On
this family the daemon re-asserts a batch only at connect time, and both stores already reset on
`reconnected` before the reconcile installs anything — so there is no mid-connection re-delivery for
a memory to guard. A batch that reappears after a swallowed send is the honest outcome: the refusal
did not land, so the ask is still live.

No ADR is owed. This slice consumes contracts ADR 0009 and #919/#920 already settled.

## Design

### The pure resolution helper — `questionResolution.ts` (new)

A new module beside the screen, framework-free and React-free, mirroring `modalResolution.ts`:

```ts
export const QUESTION_REFUSAL_OUTCOME: string   // the client-owned outcome the local `dismissed` records
export const QUESTION_REFUSAL_SOURCE: string    // the client-owned source, ditto
export interface QuestionRefuseDeps {
  sendCommand: (command: RendererCommand) => void
  dispatchBatch: (event: QuestionBatchEvent) => void
  dispatchPicks: (event: QuestionPickEvent) => void
}
export function refuseQuestionBatch(questionBatchId: string, deps: QuestionRefuseDeps): void
```

Behaviour, in order: send `refuseQuestionsCommand({ question_batch_id })` inside a `try`; on a throw,
swallow it with a content-free log; then dispatch `{ type: 'dismissed', questionBatchId }` to the
**picks** store; then `{ type: 'dismissed', questionBatchId, outcome, source }` to the **batch**
store. Both dispatches sit **outside** the `try`, which is the whole of AC3 — the seam exists so that
guarantee is provable with plain spies under `environment: 'node'`, where the view cannot be.

**Picks-first, matching `subscribeQuestionBatches`.** Zustand notifies subscribers synchronously
inside `setState`, so whichever store is written first has already woken every subscriber. Picks-first
makes the intermediate state "batch still held, picks already cleared" — indistinguishable from an
untouched batch. Batch-first would expose "batch gone, picks still held" at an observable instant,
which is precisely what the picks store exists to prevent. The unit spec pins the order.

**The two constants are client-owned and deliberately outside every daemon vocabulary.**
`QuestionBatchEvent`'s `dismissed` arm requires `outcome` and `source` where `QuestionPickEvent`'s
carries the id alone, and a local caller has no daemon strings for them. The arm is **not widened, not
duplicated by a local arm, and no daemon value is copied out of the wire vocabulary** — the store is
not edited for code at all. `outcome` is `'refused'` and `source` is `'client'`. Neither appears in
the producer's one landed pair (`'unanswered'` / `'no_answer'`), and — the part that matters —
neither appears in `WireModalSource`'s closed `{remote, local, timeout}` set either. That rules out
`'local'`, which `modalResolution.ts` uses and which reads as an *answered* outcome in the modal
vocabulary: a later reader merging the two families would take it for the operator's own choice,
which is exactly the misreading the store's fail-closed rule exists to prevent. Under that rule an
unrecognised `source` means resolved, cause unknown, never an answer — the correct reading of both
values here. `reduceQuestionBatches` consults neither field, so they are a forward carry only.

### The view — `QuestionPanel.tsx`

`QuestionPanelView` gains one required prop, `onCancel: () => void`, bound to the existing Cancel
`<button>`'s `onClick`. Nothing else about the row changes: no class, no attribute, no copy, no
ordering. Variant-neutral like the two `*Chosen` callbacks — the view knows a gesture happened and
nothing about what it becomes. It takes no batch id, for the reason the pick callbacks take no
question index: which batch a refusal is recorded against stays the container's single read, so the
two cannot drift apart. Required rather than optional so `tsc` forces the one call site to supply it.

### The container — `QuestionPanelSlot`

Wires `onCancel` to `refuseQuestionBatch(batch.questionBatchId, deps)`, building deps inside the
click closure: `sendCommand: window.pyry.sendCommand` (dereferenced at interaction time, never during
render, so the container's smoke render stays bridge-free — the `QueuedBacklogControl` /
`Composer.handleSubmit` discipline), plus the two stores' `dispatch` read off their singletons.
`questionPicksStore`'s dispatch is already read here; `questionBatchStore`'s is added the same way.
The id read is `batch.questionBatchId` — the same value the slot is keyed on.

### Docblock corrections

Three shipped docblocks assert what this slice falsifies. All three are comment-only edits:

- `questionBatches.ts` — `QuestionBatchEvent`'s "nothing dismisses a batch locally" and
  `QuestionBatchState`'s "this vertical has no answer frame at all, so nothing dismisses a batch
  locally … `resolved` would defend a failure that CANNOT OCCUR here". The `resolved` refusal itself
  **stands and is restated on its new footing** (the daemon re-asserts only at connect time, and both
  stores reset on `reconnected` first), rather than being deleted along with its stale premise.
- `questionPicksStore.ts` — `QuestionPickEvent`'s "There is no answer arm and no local dismissal".
  Not named by the ticket, but falsified by this same diff one file over; correcting a comment my own
  change invalidates is this change's own debt, not adjacent refactoring.
- `QuestionPanelSlot` — "NEITHER `dismissed` NOR `reconnected` IS DISPATCHED HERE". `dismissed` now
  is; `reconnected` still is not, and that half stays.

## State + concurrency model

Two Zustand singletons, both written synchronously from one click handler in one turn:
`questionPicksStore` then `questionBatchStore`. No async task, no timer, no subscription, no
teardown, and no `AbortSignal` — `sendCommand` is fire-and-forget over the preload bridge and returns
`void`, so there is no promise to float, await, or cancel. The panel unmounts as a consequence of the
batch-store write (`selectBatchFor` stops matching, `ComposerSlot` drops the slot), not by any
lifecycle this slice writes.

The one ordering hazard is the intra-turn one above, settled picks-first. There is no check-then-act
race: nothing is read before the dispatches, and both reducers are total and non-throwing on an
unknown id. A double-click dispatches twice; the second is an unknown-id no-op in both stores
(same state reference) and sends a second `question_refused` the daemon resolves idempotently against
an already-retired batch — the same posture `daemonConnection.refuseQuestions`' own spec pins.

## Error handling

- **Send throw (AC3).** `sendCommand` is the only failure path. It is wrapped in a `try`, the catch
  swallows, and both dispatches sit outside — so the panel clears whether or not the frame left.
- **The catch logs a static, content-free string and drops the error object**, deviating from
  `modalResolution.ts`'s `console.error('modal cancel send failed', error)`. This family refuses to
  log at all (`questionBatches.ts`, `questionPicksStore.ts`, `questionBridge.ts` each record why):
  `questionBatchId` is a one-time unguessable nonce. An `Error` raised by a failing structured-clone
  or bridge teardown can stringify the argument it choked on, which is the payload carrying that
  nonce — so the error object is the one part that cannot be forwarded. The event name alone is the
  content-free log the feature owes.
- **No new failure mode reaches the UI.** There is no result type to surface and no error state to
  render: the operator's Cancel always clears, by construction. A refusal that did not land shows up
  as the batch reappearing on the next reconnect, which is the honest outcome (see Context).

## Testing strategy

**vitest — `questionResolution.test.ts` (new).** Plain spies plus real store instances from
`createQuestionBatchStore()` / `createQuestionPicksStore()`; no React, no DOM, no Electron.

- The command is `refuseQuestions` and its payload's key set is exactly `question_batch_id` carrying
  the given id — AC1's "nothing else the client composed", asserted on the **command**. No assertion
  anywhere on `answer_token`: the renderer never sees one.
- Both dispatches fire, with the picks event carrying the id **alone** (no `outcome`, no `source` —
  the key set is asserted, since the batch event is structurally assignable and would compile) and
  the batch event carrying the two client-owned constants.
- **Order:** one shared spy records both calls; picks-first is asserted on the recorded sequence.
- **AC3:** a `sendCommand` that throws — `refuseQuestionBatch` does not throw, and both dispatches
  still fire with the same payloads.
- **AC2's second half, without a DOM:** seed a real batch + real picks, refuse it, assert the batch
  left and the picks were dropped, then dispatch the daemon's own `dismissed` for that same id and
  assert **`toBe` reference identity** of both stores' state across it — "changes nothing further"
  proven as an identity rather than as a shape.

**vitest — `QuestionPanel.test.tsx`.** Thread the new required prop through `renderBatch`. One added
assertion: Cancel's rendered markup is byte-identical to the `<button type="button"
class="question-panel__cancel">Cancel</button>` #906 shipped — the handler leaks no attribute, which
is the negative the Figma read leaves owed. The static render cannot see `onClick` at all, so the
wiring itself is e2e's.

**Playwright fake tier — `e2e/question-cancel-refuses.spec.ts` (new).** One `test()`, one launch.
`daemon.pushFrame` seeds `question_shown` (the #912 idiom); a spec-local capturing
`buildReplyFrames` decodes each outbound envelope, records `question_refused` **narrowed at capture
time to `{ type, question_batch_id }`**, and delegates every other verb to `conversationStateFake()`
so the conversation still seeds. Arc: panel visible → click Cancel → the captured frame is exactly
one `question_refused` carrying the spec's own batch id → the panel is gone and the composer is back,
with a pre-typed draft intact → push the daemon's `question_dismissed` for that id → nothing further
changes. **The token is never captured, never asserted, never logged** — the narrowing at capture
time is what makes that structural rather than a convention a failing `toEqual` could break.

Not run by this slice: the full suite and the real-claude tier, both the verifier's gate.

## Open questions

1. **Does `QuestionPanel.test.tsx` need a spy rather than a no-op for `onCancel`?** Expected no — a
   static render fires nothing. Resolve by writing it; if a spy turns out to be needed the render is
   doing something it should not.
2. **Does the e2e capture see `question_refused` before the panel unmounts?** The clear is local and
   synchronous while the frame crosses IPC → main → Noise → the loopback forwarder, so the panel is
   expected to go first. Both are asserted under `expect.poll` / auto-waiting rather than in a fixed
   order, so neither ordering fails the spec. Record the observed order in Revisions if it surprises.

## Size check

Re-counted against this written plan, not the opening sketch:

| Limit | Boundary | This ticket |
|---|---|---|
| Production source files created or modified | ≤ 3 | **3 with code changes** (`questionResolution.ts` new, `QuestionPanel.tsx`, `ConversationScreen.tsx`); 2 further comment-only (`questionBatches.ts`, `questionPicksStore.ts`) |
| New exported types / interfaces / components / stores | ≤ 5 | 4 (`refuseQuestionBatch`, `QuestionRefuseDeps`, and the two copy constants) |
| Consumer call sites needing simultaneous update | ≤ 10 | 2 (`QuestionPanelSlot`, and `renderBatch` in the view's spec) |
| Acceptance criteria | ≤ 5 | 4 |
| Distinct error / reject branches | ≤ 10 | 1 (the send catch) |
| Total written work | ≤ 400 lines | **over — see below** |

Five of six measure well inside, and the two that historically bind — edit fan-out and reject-branch
count — are 2 and 1. The sixth is over, and stating why plainly rather than re-counting it under: this
repo's shipped `size:s` tickets in this exact family run 200–342-line plans beside 207–769-line
implementations (#916, #920, #912 measured from their own commits), because the house style is
docblock-dominated prose rather than logic. The logic here is one ~15-line function, one prop, one
handler and three comment corrections.

**Not split, and the floor rule is the reason rather than the ceiling being negotiable.** Cancel
sends-and-clears is one behaviour landing at once; its e2e drive proves that same behaviour, not a
second one. Every slice line available — "land the helper" then "wire the button", or "wire the
button" then "add the e2e" — produces a child consumed by exactly one sibling in the same family and
nothing outside it, which § A1's floor rule says to merge back. Split depth was checked
(parent #853, no grandparent), so a split was genuinely on the table and is declined on the
measurement, not on the depth cap.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings, and the direction is worth naming: this slice moves data
  **outward** only. The single new boundary crossing is renderer → main via `sendCommand`, already
  guarded by `isRefuseQuestionsPayload` (#920), which type-checks `question_batch_id` and which the
  main-side sender backs with fresh-literal construction — so a smuggled extra field, including a
  renderer-composed `answer_token`, cannot reach the wire. Nothing inbound is parsed here. The one
  value handled, `questionBatchId`, is read from state the client already holds and is passed
  through opaquely: never parsed, keyed on, truncated, or compared.
- [Tokens, secrets, credentials] No findings. **The renderer never holds an `answer_token`.**
  `RefuseQuestionsCommandPayload` is `Omit<QuestionRefusedPayload, 'answer_token'>`, so a caller
  cannot supply one even by accident; the mint is `daemonConnection.refuseQuestions`' with the
  main process's CSPRNG. No storage, no rotation, no revocation surface is added. `questionBatchId`
  is an unguessable one-time nonce but not a credential — it authorises nothing, and nothing on this
  path compares it to anything, so no `timingSafeEqual` question arises. The e2e capture is narrowed
  to `{ type, question_batch_id }` at capture time specifically so no spec array, diff, or failure
  diagnostic can ever hold a token.
- [File / storage operations] Not applicable by design — no filesystem path, no persistence, no
  `localStorage`. `questionPicksStore` refuses persistence for this family and that stands.
- [Inter-process / Electron attack surface] No findings. No new `contextBridge` API, no new
  `ipcMain` channel, no new window, no protocol handler, no navigation: this slice is a new *caller*
  of an existing validated command. `window.pyry` is dereferenced only inside the click closure, so
  no render path touches the bridge.
- [Cryptographic primitives] Not applicable — no RNG, no hashing, no comparison, no Noise surface in
  the renderer. The one randomness need on this path (the token) is main-side and already landed.
- [Network & I/O] Not applicable — the renderer opens no socket and sets no deadline. The frame this
  triggers rides the existing supervised relay connection with its established caps and timeouts.
  A swallowed send is covered under Error handling; it degrades to the batch reappearing at
  reconnect, never to a retry loop, because nothing here retries.
- [Error messages, logs, telemetry] **SHOULD FIX, addressed in the design rather than deferred:** the
  precedent this slice copies (`modalResolution.cancelPrompt`) logs its caught `error` object, and
  copying that verbatim would be the finding — an `Error` from a failing bridge send can stringify
  the payload it choked on, which is the nonce. The design therefore logs a static content-free
  string and drops the error object. Nothing else is logged, and no claude-authored string reaches
  this module at all: `refuseQuestionBatch` takes an id and nothing else, so the four untrusted
  strings have no path into it. The verifier should check the implemented catch carries no
  interpolation and no second argument.
- [Concurrency] No findings. One synchronous handler, no async task, no timer, no listener, no
  teardown, no `await` — so there is no cancellation path to define and no check-then-act gap to
  guard. The one ordering decision (picks-first) is pinned by a spec assertion rather than left to
  care. A double-click is a no-op in both stores and idempotent daemon-side.
- [Threat model alignment] The applicable desktop threat is a **hostile or degraded relay dropping
  the refusal**. The design fails open in the safe direction on purpose: the client clears
  optimistically, the daemon keeps the batch parked, and the next reconnect re-asserts it — the
  operator sees the ask again rather than believing a refusal landed that did not. A renderer
  compromise gains nothing new: the widest capability added is "refuse a batch whose nonce you
  already hold", which resolves an ask without answering it and cannot approve anything. **Out of
  scope:** the *answer* path (#853's remaining slices) — a compromised renderer composing an answer
  is a different and larger question, and it is not reachable through anything this slice adds.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
