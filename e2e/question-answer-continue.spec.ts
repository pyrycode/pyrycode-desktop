import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  QuestionAnswerEntry,
  QuestionAnswerPayload,
  QuestionShownPayload,
  WireQuestion
} from '../src/shared/wire/types'

// Fake-stack UI e2e for the question panel's CONTINUE (#922) — the panel's last inert control, and the
// only place this slice's wiring can be proven at all. Renderer specs here are static server renders
// (`environment: 'node'`, no jsdom, no @testing-library), so the pure half — assembling the entries and
// deciding answerability, which are one function — is covered in questionResolution.test.ts and the
// disabled matrix in QuestionPanel.test.tsx, but nothing there can click.
//
// THIS SPEC EXISTS FOR THE CONJUNCTION AS MUCH AS FOR THE FRAME. The trailing control is ONE element in
// two roles: Next on every earlier question, Continue on the last. Gating it on batch completeness alone
// would disable Next on any incomplete batch — stranding the operator on question 1, unable to reach
// question 2 to answer it, so the batch could never become complete and the panel would deadlock. The
// whole drive below is shaped to make that failure visible: it steps through a batch with NOTHING
// answered before it answers anything.
//
// SECRET HYGIENE, the #921 rule unchanged. `question_answer` carries an `answer_token` beside the batch
// id — minted MAIN-side by daemonConnection.answerQuestions, never composed or held by the renderer. The
// capture below NARROWS at capture time to the type, the batch id and the entries, so no spec array, no
// `toEqual` diff and no failure diagnostic can ever hold or print one. That is also why nothing here
// asserts the payload's exact key set: correct code sends three fields and the third is the token.

const ROUNDTRIP_TIMEOUT_MS = 15_000

const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

const CONVERSATION_ID = 'seed-conversation'
const BATCH_ID = 'question-batch-answered'

// The panel's client-owned copy, re-declared spec-local rather than imported from QuestionPanel.tsx (the
// question-picks precedent): e2e is outside every tsconfig and importing a .tsx module would drag React
// through Playwright's transform for a handful of string literals.
const CONTINUE_COPY = 'Continue'
const NEXT_COPY = 'Next'
const OTHER_PLACEHOLDER = 'Other. Type something.'

const DRAFT = 'a half-typed message the answer must not eat'

// A THREE-QUESTION BATCH COVERING ALL THREE SHAPES (AC5): single-select, multi-select, and a question
// answered partly through the Other row. Headers and labels are pairwise non-overlapping as SUBSTRINGS,
// because both `hasText` and getByRole's name option match on substrings — two labels where one contains
// the other would make a row locator ambiguous and the failure would read as a product bug.
const QUESTIONS: WireQuestion[] = [
  {
    question: 'Which of these should you learn next?',
    header: 'Language',
    options: [
      { label: 'Rust', description: 'systems' },
      { label: 'Elixir', description: 'concurrent' }
    ],
    multi_select: false
  },
  {
    question: 'Which of these do you actually use?',
    header: 'Style',
    options: [
      { label: 'Tabs', description: 'wide' },
      { label: 'Spaces', description: 'narrow' },
      { label: 'Neither', description: 'brave' }
    ],
    multi_select: true
  },
  {
    question: 'When should this go out?',
    header: 'Timing',
    options: [
      { label: 'Today', description: 'bold' },
      { label: 'Monday', description: 'safe' }
    ],
    multi_select: false
  }
]

// PADDED ON BOTH SIDES, so the trim is proven rather than assumed — and matching NONE of the offered
// labels, which is legal traffic the daemon deliberately does not validate away (claude's contract
// permits free text anywhere).
const OTHER_TYPED = '   Prolog, on a good day   '
const OTHER_SENT = 'Prolog, on a good day'

/** What the window must send once every question holds a value. The multi-select entry is the load-bearing
 *  one: its labels read in claude's own DISPLAY order even though they are ticked bottom-up below, and the
 *  Other value is trimmed and placed LAST, after both labels. */
const EXPECTED_ANSWERS: QuestionAnswerEntry[] = [
  { question_index: 0, values: ['Elixir'] },
  { question_index: 1, values: ['Tabs', 'Neither', OTHER_SENT] },
  { question_index: 2, values: ['Today'] }
]

function questionShownFrame(): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'question_shown',
    ts: FIXED_TS,
    payload: {
      conversation_id: CONVERSATION_ID,
      question_batch_id: BATCH_ID,
      questions: QUESTIONS
    } satisfies QuestionShownPayload
  })
}

/** What the spec keeps about one outbound answer — the type, the batch id and the entries, and NOTHING
 *  else. The narrowing is the security property: `answer_token` never enters this array. */
type CapturedAnswer = {
  type: string
  questionBatchId: string
  answers: QuestionAnswerEntry[]
}

/** The spec-local capturing reply factory (#921's shape). The fake daemon runs in the TEST process via the
 *  loopback forwarder, so an array written here is directly readable from the test body. Every verb
 *  delegates to `conversationStateFake` — the list verbs seed the launch row, and a scripted
 *  buildReplyFrames replaces the fixture default entirely — while `question_answer` is additionally
 *  recorded on the way past. The daemon answers with nothing on this tier: the real one consumes the batch
 *  and broadcasts `question_dismissed`, which this spec does not need, since the clear is local. */
function capturingAnswerFake(captured: CapturedAnswer[]): (inbound: Uint8Array) => Uint8Array[] {
  const conversations = conversationStateFake()
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    if (env.type === 'question_answer') {
      // The cast is on the app's OWN trusted outbound (the fixture posture). Three fields are read, and
      // `answer_token` is deliberately not among them.
      const payload = env.payload as QuestionAnswerPayload
      captured.push({
        type: env.type,
        questionBatchId: payload.question_batch_id,
        answers: payload.answers
      })
      return []
    }
    return conversations(inbound)
  }
}

test('question panel: Continue waits for a complete batch, then sends every answer and clears', async ({
  launchPairedApp
}) => {
  const captured: CapturedAnswer[] = []
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: capturingAnswerFake(captured)
  })

  const panel = page.locator('.question-panel')
  const composer = page.getByPlaceholder('Message…')
  // The ONE trailing element, located by its class rather than by either copy — that is what lets an
  // assertion follow it across both roles and catch a split into two branched elements.
  const trailing = panel.locator('.question-panel__continue')
  // Tabs are scoped to the title row: since #915 a tab is also a `<button>`, so a panel-wide role match
  // would mix them with the action row's three.
  const tab = (header: string) =>
    panel.locator('.question-panel__labels').getByRole('button', { name: header })
  const optionRow = (label: string) =>
    panel.locator('.question-panel__option').filter({ hasText: label })
  const otherField = panel.getByRole('textbox', { name: OTHER_PLACEHOLDER })
  const otherTick = panel.locator('.question-panel__other-control')

  await composer.fill(DRAFT)
  daemon.pushFrame(questionShownFrame())
  await expect(panel).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  // Non-vacuity anchor: nothing has been sent before the drive below.
  expect(captured).toHaveLength(0)

  // AC2 — STEPPING IS NEVER GATED ON WHAT HAS BEEN PICKED, and this runs first, on a batch with nothing
  // answered at all. If the gate were `disabled={!canAnswer}` rather than the conjunction, the panel
  // would be deadlocked right here and every assertion below would be unreachable.
  await expect(trailing).toHaveText(NEXT_COPY)
  await expect(trailing).toBeEnabled()
  await trailing.click()
  await expect(panel.locator('.question-panel__question')).toHaveText(QUESTIONS[1].question)
  await expect(trailing).toHaveText(NEXT_COPY)
  await expect(trailing).toBeEnabled()
  await trailing.click()

  // AC1 — the last question, and the batch holds nothing: the same element now reads Continue and is
  // unavailable.
  await expect(panel.locator('.question-panel__question')).toHaveText(QUESTIONS[2].question)
  await expect(trailing).toHaveText(CONTINUE_COPY)
  await expect(trailing).toBeDisabled()

  // Answering ONLY this question is not enough — the gate is over the whole batch, not the one on screen.
  // This is the partial the daemon would reject totally and silently, so it must stay unsendable.
  await optionRow('Today').click()
  await expect(trailing).toBeDisabled()

  // Answer the first question, come back, and it is STILL unavailable: the middle one is untouched.
  await tab('Language').click()
  await optionRow('Elixir').click()
  await tab('Timing').click()
  await expect(trailing).toBeDisabled()

  // The multi-select question, and the one entry that proves three separate rules at once. Ticked
  // BOTTOM-UP (Neither before Tabs) so the sent order cannot be click order, plus Other text padded on
  // both sides and ticked. On a non-last question the trailing button is Next and enabled throughout,
  // gate or no gate.
  await tab('Style').click()
  await expect(trailing).toHaveText(NEXT_COPY)
  await expect(trailing).toBeEnabled()
  await optionRow('Neither').click()
  await optionRow('Tabs').click()
  await otherField.fill(OTHER_TYPED)
  await otherTick.click()

  // AC1's second half — available the moment every question holds a value.
  await tab('Timing').click()
  await expect(trailing).toHaveText(CONTINUE_COPY)
  await expect(trailing).toBeEnabled()

  await trailing.click()

  // AC3 — exactly one `question_answer`, and its entries asserted WHOLE. `toEqual` on the narrowed record
  // is what makes the assertion honest without touching the token: one entry per question, each naming
  // its question by index, labels in claude's display order rather than the operator's click order, and
  // the Other text trimmed, carried as its own value and placed last.
  await expect
    .poll(() => captured, { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual([{ type: 'question_answer', questionBatchId: BATCH_ID, answers: EXPECTED_ANSWERS }])

  // AC4 — the panel clears through #921's path and the composer comes back underneath with the draft
  // untouched. The clear is LOCAL and optimistic: no daemon frame has answered at this point, so a panel
  // that waited for one would still be up here.
  await expect(panel).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(composer).toBeVisible()
  await expect(composer).toHaveValue(DRAFT)
  expect(captured).toHaveLength(1)
})
