// The question vertical's resolution effect — framework-free and React-free, co-located with the
// screen and mirroring `modalResolution.ts`'s cancelPrompt: the three effects (the guarded outbound
// command + the two local clears) are injected, so the helper is a pure, deterministic function tested
// with plain spies (no React, no store, no Electron). `QuestionPanelSlot` is thin glue over this.
//
// THIS IS WHERE THE GUARDED-SEND + UNCONDITIONAL-CLEAR LOGIC LIVES SO IT IS UNIT-TESTABLE. Renderer
// tests here are static server renders (`environment: 'node'`, no jsdom, no @testing-library), so the
// view cannot be driven and an inline handler in the container would put AC3 out of reach of vitest
// entirely. The click itself is proven in `e2e/question-cancel-refuses.spec.ts`.
//
// **THE FIRST THING IN THIS FAMILY THAT DISMISSES A BATCH FROM THE CLIENT SIDE.** Both stores have
// held a `dismissed` arm since #899/#911, but until #921 only `questionBridge` drove them, from the
// daemon's own broadcast. Two consequences follow, and both stores already absorb them with no new
// code: the daemon's own `question_dismissed` arriving afterwards is an unknown-id no-op returning the
// SAME state reference in each store, and a batch cleared while the transport was down comes back on
// the next reconnect, because the daemon still holds it parked and re-asserts it.
//
// NO `resolved` ID-MEMORY, and `QuestionBatchState`'s docblock predicting one arrives with the answer
// path is corrected rather than honoured. The modal vertical's slice (#195) existed to suppress
// re-delivery of a modal the client had already answered, and #510 is the record of the cost: the
// retained id suppressed the daemon's legitimate re-delivery and an operator's explicit Allow decayed
// into a timeout deny. Here the daemon re-asserts a batch only at CONNECT time, and both stores
// already reset on `reconnected` before the reconcile installs anything — so there is no
// mid-connection re-delivery for a memory to guard. A batch that reappears after a swallowed send is
// the honest outcome: the refusal did not land, so the ask is still live.
//
// NOTHING CLAUDE-AUTHORED REACHES THIS MODULE. It takes a batch id and nothing else — no `question`,
// no `header`, no option `label` or `description` — so the standing obligation the rest of the family
// records (plain text only, never an attribute, a URL, a filename, a cache key, a lookup path or a
// log) has nothing to bind on here by construction rather than by care.
import { refuseQuestionsCommand, type RendererCommand } from '@shared/ipc/commands'
import type { QuestionBatchEvent } from '../../store/questionBatches'
import type { QuestionPickEvent } from '../../store/questionPicksStore'

/**
 * The `outcome` a refusal records on the local `dismissed` event, and — with QUESTION_REFUSAL_SOURCE
 * below — the reason this slice needs no store change at all. `QuestionBatchEvent`'s dismissed arm
 * requires `outcome` and `source` where `QuestionPickEvent`'s carries the id alone, and a LOCAL caller
 * has no daemon strings for them. The arm is not widened, not duplicated by a local arm, and no daemon
 * value is copied out of the wire vocabulary; these two client-owned constants go through the existing
 * arm instead. `reduceQuestionBatches` consults neither field — only `questionBatchId` drives the
 * clear — so both are a forward carry for a later resolution surface, exactly as MODAL_CANCEL_OUTCOME
 * is one for #227's toast.
 *
 * **'refused', NOT the producer's 'unanswered'.** The daemon's three terminal paths all emit the one
 * landed pair `outcome: "unanswered"` / `source: "no_answer"`, and reusing either here would make a
 * later reader unable to tell the operator's deliberate refusal from a daemon safe-deny.
 */
export const QUESTION_REFUSAL_OUTCOME = 'refused'

/**
 * The `source` a refusal records — and the one constant in this family where the reflex answer is
 * actively wrong.
 *
 * **NOT 'local', which is what `modalResolution.cancelPrompt` writes and what a reader arriving from
 * that family reaches for first.** `local` is a member of `WireModalSource`'s closed
 * `{remote, local, timeout}` set, where it means an ANSWERED outcome — so carrying it here would let a
 * later reader merging the two families read a refusal as the operator's own choice. That is exactly
 * the misreading `questionBatches.ts`'s fail-closed rule exists to prevent (an unrecognised `source`
 * means RESOLVED, CAUSE UNKNOWN, and NEVER an answer). `'client'` sits outside the producer's pair AND
 * outside `WireModalSource`, so both readings collapse onto the safe one. The spec asserts the
 * exclusion by value rather than leaving it to this comment.
 */
export const QUESTION_REFUSAL_SOURCE = 'client'

/**
 * The three effects `refuseQuestionBatch` performs, injected so the helper stays pure and
 * deterministic in tests. `sendCommand` is `window.pyry.sendCommand` in the container; the two
 * dispatches are the question stores' own.
 *
 * TWO DISPATCHES RATHER THAN ONE, because the two stores take DIFFERENT event shapes — the picks arm
 * carries the id alone. Threading one combined dispatch would mean re-shaping inside the helper's
 * caller, which is where `questionBridge` already proved the transposition is invisible: the batch
 * arm is structurally assignable to the picks arm, so forwarding the richer event compiles clean while
 * carrying `outcome`/`source` into a store that must never hold them.
 */
export interface QuestionRefuseDeps {
  sendCommand: (command: RendererCommand) => void
  dispatchPicks: (event: QuestionPickEvent) => void
  dispatchBatch: (event: QuestionBatchEvent) => void
}

/**
 * Refuse an outstanding question batch, then clear it locally (optimistic). The operator declined to
 * choose, so the refusal carries the batch id and nothing else the client composed — the daemon owns
 * what claude is told (upstream pyrycode#1990 denies claude's blocked call with a fixed instruction to
 * wait for the operator's message, and broadcasts one `question_dismissed`).
 *
 * The `answer_token` is minted MAIN-side (#920, `daemonConnection.refuseQuestions`); this payload
 * carries only `question_batch_id`, and `RefuseQuestionsCommandPayload` Omit-excludes the token so a
 * caller cannot supply one even deliberately.
 *
 * THE SEND IS GUARDED AND BOTH DISPATCHES SIT OUTSIDE THE `try` (AC3), the cancelPrompt shape: a
 * bridge failure is swallowed, never propagated into the render, and the panel clears whether or not
 * the frame left.
 *
 * THE PICKS DISPATCH RUNS FIRST, and the order is load-bearing rather than tidiness — the same call
 * `subscribeQuestionBatches` makes for the daemon-driven path, so the local and remote clears cannot
 * drift. Zustand notifies subscribers synchronously inside `setState`, so whichever store is written
 * first has already woken every subscriber before the second write happens. Picks-first makes the
 * intermediate state "batch still held, picks already cleared" — indistinguishable from an untouched
 * batch, and therefore always coherent. Batch-first would expose "batch gone, picks still held": a
 * stale pick outliving its batch at an observable instant, which is what the picks store exists to
 * prevent. The spec pins the order.
 */
export function refuseQuestionBatch(questionBatchId: string, deps: QuestionRefuseDeps): void {
  try {
    deps.sendCommand(refuseQuestionsCommand({ question_batch_id: questionBatchId }))
  } catch {
    // AC3: a send-bridge failure must not crash the window. Both local clears still post below.
    //
    // A STATIC, CONTENT-FREE STRING, AND THE CAUGHT ERROR IS DELIBERATELY DROPPED — the one place this
    // helper departs from `modalResolution`'s `console.error('modal cancel send failed', error)`, and
    // a security-review finding rather than a style choice. `questionBatchId` is a one-time
    // unguessable nonce, and an Error raised by a failing structured clone or a bridge teardown can
    // stringify the argument it choked on, which is the payload carrying that nonce. A log is a sink:
    // it reaches DevTools, a crash reporter, and anything that catches and logs. The event name alone
    // is the content-free log this feature owes; the binding is not even destructured, so there is no
    // value here to forward by accident.
    console.error('question refusal send failed')
  }

  deps.dispatchPicks({ type: 'dismissed', questionBatchId })
  deps.dispatchBatch({
    type: 'dismissed',
    questionBatchId,
    outcome: QUESTION_REFUSAL_OUTCOME,
    source: QUESTION_REFUSAL_SOURCE
  })
}
