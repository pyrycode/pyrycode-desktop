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
// CLAUDE-AUTHORED TEXT NOW REACHES THIS MODULE, AND #921's CLAIM THAT IT NEVER COULD IS CORRECTED
// RATHER THAN HONOURED. Through #921 the refusal took a batch id and nothing else, so the standing
// family obligation had nothing to bind on here by construction. #922 changed that: an option's
// `label` is claude-authored, it crossed the subprocess trust boundary unsanitized, and
// `resolveQuestionAnswers` below is the ONE place in the app it is read for a purpose other than
// rendering. Publishing it outbound does not make it trusted when it returns — which is exactly why
// the frame names a question by INDEX and never by its text, and why the daemon rebuilds the
// text-keyed map claude receives from its own parked copy of the batch.
//
// The obligation this module therefore owes, in full: a label goes into an entry's `values` array and
// NOWHERE else. Entries are built from the fixed literal keys `question_index` and `values`, never a
// computed key, so no label becomes an object key, a `Map` key, a React key, an attribute, a URL, a
// filename, a cache key or a lookup path. AND NOTHING HERE IS LOGGED WITH A VALUE IN IT — see the two
// catch blocks, which log a static string and drop the error object; the payload they choked on
// carries claude's labels and the operator's own typed text beside the one-time batch nonce.
import {
  answerQuestionsCommand,
  refuseQuestionsCommand,
  type RendererCommand
} from '@shared/ipc/commands'
import type { QuestionAnswerEntry } from '@shared/wire/types'
import type { Question, QuestionBatchEvent } from '../../store/questionBatches'
import type { QuestionPickEvent, QuestionSelection } from '../../store/questionPicksStore'

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
 * The `outcome` an ANSWER records on the local `dismissed` event (#922).
 *
 * **NOT the refusal's `'refused'`, and the distinction is the whole reason this is a second constant
 * rather than a shared one.** Both exits go through the SAME dismissed arm, so a later reader
 * merging the families has only this field to tell an operator who answered from one who declined.
 * Like the refusal's pair it stays outside the producer's one landed pair (`'unanswered'` /
 * `'no_answer'`), so a daemon safe-deny can never be read as this.
 */
export const QUESTION_ANSWER_OUTCOME = 'answered'

/**
 * The `source` an answer records — the same value as `QUESTION_REFUSAL_SOURCE` and deliberately a
 * separate constant, because the two are independently meaningful and may diverge. Both say *this
 * client raised it*, and both must stay outside `WireModalSource`'s closed `{remote, local, timeout}`
 * set for the reason that constant records at length: `'local'` there means an ANSWERED outcome in
 * the modal vocabulary, so borrowing it would let a later reader take a client-side event for the
 * daemon's own. `reduceQuestionBatches` consults neither field; both are a forward carry.
 */
export const QUESTION_ANSWER_SOURCE = 'client'

/**
 * The three effects a resolution performs, injected so the helpers stay pure and deterministic in
 * tests. `sendCommand` is `window.pyry.sendCommand` in the container; the two dispatches are the
 * question stores' own.
 *
 * ONE INTERFACE ACROSS BOTH EXITS (#922), `modalResolution.ts`'s `ModalResolveDeps` shape: an answer
 * and a refusal perform the same three effects against the same two stores and differ only in what
 * they send, so a second identical interface would be a copy that can drift.
 *
 * TWO DISPATCHES RATHER THAN ONE, because the two stores take DIFFERENT event shapes — the picks arm
 * carries the id alone. Threading one combined dispatch would mean re-shaping inside the helper's
 * caller, which is where `questionBridge` already proved the transposition is invisible: the batch
 * arm is structurally assignable to the picks arm, so forwarding the richer event compiles clean while
 * carrying `outcome`/`source` into a store that must never hold them.
 */
export interface QuestionResolveDeps {
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
export function refuseQuestionBatch(questionBatchId: string, deps: QuestionResolveDeps): void {
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

/**
 * Build the batch's answer entries from what the operator has picked, or `null` if any question in it
 * holds no value (#922).
 *
 * **DECIDING WHETHER THE BATCH MAY BE SENT AND BUILDING WHAT IS SENT ARE THE SAME COMPUTATION, and
 * that is the point of one function returning a nullable array rather than two returning a boolean
 * and a payload.** A batch with a gap has no entry to emit for that question, so the button's
 * availability and the frame's contents cannot disagree and a "which is it?" bug is not expressible.
 * The container calls this once per render and feeds both the gate and the send from the one result.
 *
 * **Why the gate is the operator-facing feature.** Upstream's `answerVerdict` rejects an answer whose
 * entry count is not exactly the parked question count, and the rejection is TOTAL AND SILENT:
 * `AnswerQuestion` returns false having assembled nothing, the batch's one-shot is not consumed, no
 * `question_dismissed` fires, and the relay handler's false branch is a debug log with no reply and
 * no error envelope. An under-filled send therefore produces no round-tripped rejection at all — from
 * the operator's side the button would simply do nothing until the approval window elapsed. Gating
 * here is what keeps that state unreachable, which is also why this path needs no rejection banner
 * and no correlation window.
 *
 * A question holds a value when it has at least one ticked option, or its Other row is ticked with
 * text that is not whitespace-only. **The trimmed text is what is sent** — the same trim decides
 * answerability, so the gate and the payload cannot disagree about what the value is — carried as the
 * value itself and never the word "Other", and placed after the ticked labels because the Other row
 * is drawn last. Ticked labels read in claude's own display order: `optionIndices` is held ascending
 * rather than in click order, so nothing re-sorts here.
 *
 * NOTHING IS VALIDATED AGAINST THE OFFERED LABELS, deliberately. claude's contract permits free text
 * anywhere, so an unlisted value is legal traffic and a validator rejecting one would reject a legal
 * answer. Nothing range-checks `question_index` either: it is generated by iterating the batch this
 * client holds, and the bound is the daemon resolver's (`QuestionAnswerEntry`'s own ruling).
 *
 * THE SINGLE-SELECT SHAPE NEEDS NO RULE HERE. `optionPicked` replaces the pick and clears the tick,
 * and `otherPicked` clears the options, so a single-select question can never assemble more than one
 * value. Re-deriving that from `multiSelect` would be a second enforcement point to keep in agreement
 * with the store's arms.
 */
export function resolveQuestionAnswers(
  questions: readonly Question[],
  selections: ReadonlyMap<number, QuestionSelection>
): QuestionAnswerEntry[] | null {
  const answers: QuestionAnswerEntry[] = []

  // ITERATE THE QUESTIONS, NEVER THE SELECTIONS. The picks map can hold entries for positions a
  // shortened re-delivery removed, and one phantom entry would break the daemon's exact-count check on
  // an otherwise complete answer. Iterating the batch also makes the emitted order the batch's own.
  for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
    const question = questions[questionIndex]
    const selection = selections.get(questionIndex)
    const values: string[] = []

    for (const optionIndex of selection?.optionIndices ?? []) {
      const option = question.options[optionIndex]
      // A STALE POSITION IS SKIPPED, AND THIS BRANCH IS REACHABLE RATHER THAN DEFENSIVE.
      // `reduceQuestionBatches`' `shown` arm replaces a held batch IN PLACE (latest wins) and neither
      // store clears picks on a re-delivery, so a same-nonce `question_shown` carrying fewer options
      // leaves a pick pointing past the end. This function runs during render to compute the gate, so
      // `question.options[optionIndex].label` would throw `undefined.label` OUT OF THE RENDER — on
      // traffic the daemon controls and the reducer explicitly supports. It is the same hazard the
      // container's `activeIndex` clamp guards one level up. Dropping the value is the only option
      // that neither crashes the window nor puts a hole on the wire; if it empties the question, the
      // batch is incomplete below and the operator re-picks against what is on screen.
      if (option === undefined) continue
      // The label's one crossing. A claude-authored string, into an array element and nowhere else.
      values.push(option.label)
    }

    // The Other row last, and only when it is BOTH ticked and non-blank: `otherText` is held
    // independently of `otherTicked`, so typing into an un-ticked row is ordinary traffic that
    // contributes nothing, and a ticked row with whitespace-only text is no value at all.
    const otherText = selection?.otherText.trim() ?? ''
    if (selection?.otherTicked === true && otherText !== '') values.push(otherText)

    // The gate, and the only incomplete signal there is: no partial array, no per-question flag.
    if (values.length === 0) return null
    answers.push({ question_index: questionIndex, values })
  }

  // An empty `answers` is out of contract upstream — it says nothing a refusal does not say better.
  // Unreachable in practice: the store's guard keeps an empty `questions` out of `outstanding`, so
  // there is no batch to draw with nothing in it, and the loop above cannot produce zero entries for a
  // non-empty batch. Returned as `null` rather than `[]` so the one impossible case still cannot send.
  return answers.length === 0 ? null : answers
}

/**
 * Answer an outstanding question batch with what the operator picked, then clear it locally
 * (optimistic) — `refuseQuestionBatch`'s shape with the assembled entries in place of nothing.
 *
 * **`answers` of `null` performs NO EFFECT AT ALL: no send, no clear, no log.** That is the gate's
 * second layer, and it is deterministic code rather than a second stochastic rule — the same value
 * that renders the button `disabled` refuses the send, so a handler firing anyway cannot post an
 * under-filled answer the daemon rejects totally and silently. The panel stays up, because nothing has
 * been resolved. Nothing is logged either: an incomplete batch is the gate working rather than a
 * fault, and the debug line a developer reaches for here would put the partial payload — claude's
 * labels plus the operator's typed text — into a sink.
 *
 * The `answer_token` is minted MAIN-side (#920, `daemonConnection.answerQuestions`, which deep-rebuilds
 * the payload and every entry from fresh literals); this payload carries `question_batch_id` and the
 * entries, and `AnswerQuestionsCommandPayload` Omit-excludes the token so a caller cannot supply one
 * even deliberately.
 *
 * THE SEND IS GUARDED AND BOTH DISPATCHES SIT OUTSIDE THE `try` (AC4), and THE PICKS DISPATCH RUNS
 * FIRST — both `refuseQuestionBatch`'s, both load-bearing for its reasons, restated there in full. A
 * swallowed answer degrades to the batch reappearing at the next reconnect, which is the honest
 * outcome: the answer did not land, so the ask is still live.
 */
export function answerQuestionBatch(
  questionBatchId: string,
  answers: QuestionAnswerEntry[] | null,
  deps: QuestionResolveDeps
): void {
  if (answers === null) return

  try {
    // Passed through without a copy, deliberately: this is `resolveQuestionAnswers`' own freshly-built
    // array with no other holder, and a defensive copy here would read as a check it is not — the
    // `values` ruling in `daemonConnection.answerQuestions`, one layer down, applied at this one.
    deps.sendCommand(answerQuestionsCommand({ question_batch_id: questionBatchId, answers }))
  } catch {
    // AC4: a send-bridge failure must not crash the window. Both local clears still post below.
    //
    // A STATIC, CONTENT-FREE STRING, AND THE CAUGHT ERROR IS DELIBERATELY DROPPED — the refusal's
    // rule, binding harder here. An Error raised by a failing structured clone or a bridge teardown
    // can stringify the argument it choked on, and on this path that argument carries claude-authored
    // option labels AND whatever the operator typed into the Other row, beside the one-time nonce. A
    // log is a sink: it reaches DevTools, a crash reporter, and anything that catches and logs. The
    // binding is not even destructured, so there is no value here to forward by accident.
    console.error('question answer send failed')
  }

  deps.dispatchPicks({ type: 'dismissed', questionBatchId })
  deps.dispatchBatch({
    type: 'dismissed',
    questionBatchId,
    outcome: QUESTION_ANSWER_OUTCOME,
    source: QUESTION_ANSWER_SOURCE
  })
}
