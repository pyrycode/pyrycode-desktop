import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  QuestionDismissedPayload,
  QuestionRefusedPayload,
  QuestionShownPayload,
  WireQuestion,
  WireQuestionOption
} from '../src/shared/wire/types'

// Fake-stack UI e2e for the question panel's CANCEL (#921) — and the first spec in this repo to assert
// on a frame the window SENT rather than only on what it did with one it received. #906 drew the button,
// #919/#920 landed the `question_refused` frame and the command that mints its token and sends it, and
// this slice wires the three together. Its first three acceptance criteria are provable from vitest —
// the guarded send and the two local clears live in `refuseQuestionBatch`, driven by plain spies — but
// the click is not: `environment: 'node'`, no jsdom, no @testing-library, so no DOM, no effects and no
// event handlers. This spec is the only place the wiring itself is proven.
//
// THE OUTBOUND SEAM IS A SCRIPTED `buildReplyFrames`, which receives the app's own decoded outbound
// envelope. `decodeEnvelope` is generic on `type`, so the `question_refused` case reads
// `payload.question_batch_id` directly. A scripted `buildReplyFrames` OVERRIDES the fixture default, so
// it must fall through to `conversationStateFake` for the list verbs or the app never seeds its
// conversation and the panel has no chat to be display-scoped to.
//
// SECRET HYGIENE, AND THIS SPEC OWES MORE OF IT THAN ITS SIBLINGS. `question_refused` carries an
// `answer_token` beside the batch id — minted MAIN-side by daemonConnection.refuseQuestions, never
// composed or held by the renderer. It is a secret: the capture below NARROWS to the type and the batch
// id AT CAPTURE TIME, so no spec array, no `toEqual` diff and no failure diagnostic can ever hold or
// print one. That is also why there is no assertion that the payload has exactly one key — correct code
// sends two, and the second is the token. AC1's "nothing else the client composed" is a statement about
// the COMMAND, asserted one layer down in questionResolution.test.ts. Everything else read here is a DOM
// value or a count; the batch nonce is a spec-local routing literal this spec minted itself.

// The click → IPC → main → Noise → forwarder → capture hop is fast in-process, so a short headroom over
// Playwright's 5s default suffices for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// conversationStateFake's own default seed id — the conversation launchPairedApp lands in, and the one
// the batch is raised against. A batch is display-scoped by conversation, so this is what puts the panel
// in front of the operator at launch.
const CONVERSATION_ID = 'seed-conversation'
const BATCH_ID = 'question-batch-cancelled'

// The panel's client-owned copy, re-declared spec-local rather than imported from QuestionPanel.tsx (the
// question-picks precedent): e2e is outside every tsconfig and importing a .tsx module would drag React
// through Playwright's transform for one string literal.
const CANCEL_COPY = 'Cancel'
// A draft typed into the message box BEFORE the batch arrives — so "the composer returns" is proven as
// the operator's own box coming back, not merely as some textbox being present.
const DRAFT = 'a half-typed message the panel must not eat'

const OPTIONS: WireQuestionOption[] = [
  { label: 'Rust', description: 'systems' },
  { label: 'Elixir', description: 'concurrent' }
]

const QUESTION: WireQuestion = {
  question: 'Which of these two programming languages should you learn next?',
  header: 'Language',
  options: OPTIONS,
  multi_select: false
}

function questionShownFrame(): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'question_shown',
    ts: FIXED_TS,
    payload: {
      conversation_id: CONVERSATION_ID,
      question_batch_id: BATCH_ID,
      questions: [QUESTION]
    } satisfies QuestionShownPayload
  })
}

/** The daemon's own retirement of the batch it just had refused — what pyrycode#1990 broadcasts after
 *  consuming it. Pushed AFTER the click, to drive AC2's second half: an unknown-id no-op in both stores
 *  by then, so nothing further may change on screen. */
function questionDismissedFrame(): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'question_dismissed',
    ts: FIXED_TS,
    payload: {
      question_batch_id: BATCH_ID,
      outcome: 'unanswered',
      source: 'no_answer'
    } satisfies QuestionDismissedPayload
  })
}

/** What the spec keeps about one outbound refusal — the type and the batch id, and NOTHING else. The
 *  narrowing is the security property: the token never enters this array, so it cannot leak through a
 *  diff, a retained trace or a console line. */
type CapturedRefusal = { type: string; questionBatchId: string }

/**
 * The spec-local capturing reply factory (the capturingRunConfigFake shape). The fake daemon runs in the
 * TEST process via the loopback forwarder, so an array written here is directly readable from the test
 * body. Every verb delegates to `conversationStateFake` — the list verbs are what seed the launch row,
 * and a scripted buildReplyFrames replaces the fixture default entirely — while `question_refused` is
 * additionally recorded on the way past. The daemon answers a refusal with nothing on this tier: the
 * real one broadcasts `question_dismissed`, which this spec pushes by hand afterwards so the arrival is
 * sequenced against the assertions rather than racing them.
 */
function capturingQuestionFake(captured: CapturedRefusal[]): (inbound: Uint8Array) => Uint8Array[] {
  const conversations = conversationStateFake()
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    if (env.type === 'question_refused') {
      // The cast is on the app's OWN trusted outbound (the fixture posture). Only two fields are read,
      // and `answer_token` is deliberately not among them.
      const payload = env.payload as QuestionRefusedPayload
      captured.push({ type: env.type, questionBatchId: payload.question_batch_id })
      return []
    }
    return conversations(inbound)
  }
}

test('question panel: Cancel refuses the batch, the composer stays available, and the daemon’s own dismissal changes nothing', async ({
  launchPairedApp
}) => {
  const captured: CapturedRefusal[] = []
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: capturingQuestionFake(captured)
  })

  const panel = page.locator('.question-panel')
  const composer = page.getByPlaceholder('Message…')
  // Scoped to the PANEL rather than the page: Cancel is ordinary chrome copy elsewhere in the shell, and
  // a page-wide role match is one shipped dialog away from matching two controls at once.
  const cancel = panel.getByRole('button', { name: CANCEL_COPY })

  // AC2's observable, staged before anything else: the operator's half-typed message. #912 proved the
  // covered composer subtree stays mounted while a batch is up; this is what "the composer returns"
  // has to mean afterwards.
  await composer.fill(DRAFT)
  await expect(composer).toHaveValue(DRAFT)

  daemon.pushFrame(questionShownFrame())
  await expect(panel).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  // Non-vacuity anchor: nothing has been sent before the click, so the single frame asserted below is
  // one this drive caused rather than one that was already there.
  expect(captured).toHaveLength(0)
  await expect(page.locator('.conversation__thread .question-batch')).toHaveCount(1)
  await expect(composer).toBeVisible()

  // AC1 + AC2 — the one gesture, and both halves of what it must do.
  await cancel.click()

  // AC1 — exactly one `question_refused`, carrying this batch's id. `toEqual` on the NARROWED record is
  // what makes the assertion honest without touching the token: the frame the app really sent carries
  // one beside this id, and asserting the payload's whole key set here would fail on correct code.
  await expect
    .poll(() => captured, { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual([{ type: 'question_refused', questionBatchId: BATCH_ID }])

  // AC2 — the batch left the held set and the composer is back underneath, with the draft untouched. The
  // clear is LOCAL and optimistic: no daemon frame has answered the refusal at this point, so a panel
  // that waited for one would still be up here.
  await expect(panel).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(composer).toBeVisible()
  await expect(composer).toHaveValue(DRAFT)

  // AC2's second half — the daemon's own dismissal for the SAME batch, arriving after the optimistic
  // clear, which is the ordinary case rather than an edge one. By now it is an unknown-id no-op in both
  // stores, returning the same state reference in each, so nothing further changes. Sequenced against a
  // second refusal count check so a re-render that somehow re-sent would show up as a second frame.
  daemon.pushFrame(questionDismissedFrame())
  await expect(panel).toHaveCount(0)
  await expect(composer).toHaveValue(DRAFT)
  expect(captured).toHaveLength(1)
})
