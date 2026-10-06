import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  QuestionAnswerEntry,
  QuestionAnswerPayload,
  QuestionShownPayload,
  WireQuestion,
  SetSessionSettingsPayload
} from '../src/shared/wire/types'

// Fake transport proves native interactions; captures contain synthetic content only.
const ROUNDTRIP_TIMEOUT_MS = 15_000

const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

const CONVERSATION_ID = 'seed-conversation'
const BATCH_ID = 'question-batch-answered'

// The panel's client-owned copy, re-declared spec-local rather than imported from QuestionPanel.tsx (the
// question-picks precedent): e2e is outside every tsconfig and importing a .tsx module would drag React
// through Playwright's transform for a handful of string literals.
const CONTINUE_COPY = 'Continue'
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
function capturingAnswerFake(captured: CapturedAnswer[], settings: { id: number; payload: SetSessionSettingsPayload }[], types: string[]): (inbound: Uint8Array) => Uint8Array[] {
  const conversations = conversationStateFake()
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    types.push(env.type)
    if (env.type === 'request_session_settings') {
      return [frame('session_settings', {
        session_id: 'question-session', model: 'sonnet', effort: 'low', yolo: false,
        permission_mode: 'default', used_tokens: 0, window_tokens: 200000
      }, env.id)]
    }
    if (env.type === 'set_session_settings') {
      settings.push({ id: env.id, payload: env.payload as SetSessionSettingsPayload })
      return []
    }
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

function frame(type: string, payload: unknown, inReplyTo?: number): Uint8Array {
  return encodeEnvelope({ id: REPLY_ENVELOPE_ID, type, ts: FIXED_TS, payload, in_reply_to: inReplyTo })
}

const MODELS = ['sonnet', 'opus', 'haiku'].map((value) => ({
  value, display_name: value, resolved_model: `claude-${value}-5`,
  effort_levels: ['low', 'high'], supports_auto_mode: true, truncated_fields: null
}))

test('inline Continue validates every question and sends ordered, trimmed answers optimistically', async ({ launchPairedApp }) => {
  const captured: CapturedAnswer[] = [], settings: { id: number; payload: SetSessionSettingsPayload }[] = [], types: string[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: capturingAnswerFake(captured, settings, types) })
  const panel = page.locator('.question-batch'), cards = panel.locator('.question-batch__question')
  const composer = page.getByPlaceholder('Message…'), continueButton = panel.getByRole('button', { name: 'Continue', exact: true })
  await composer.fill(DRAFT)
  daemon.pushFrame(questionShownFrame())
  await expect(cards).toHaveCount(3)
  await expect(page.locator('.conversation__thread .question-batch')).toHaveCount(1)
  await expect(composer).toBeVisible()
  await expect(continueButton).toBeDisabled()
  await cards.nth(0).getByRole('radio', { name: /Elixir/ }).press('Space')
  await cards.nth(1).getByRole('checkbox', { name: /Neither/ }).press('Space')
  await cards.nth(1).getByRole('checkbox', { name: /Tabs/ }).press('Space')
  await cards.nth(1).getByRole('textbox').fill(OTHER_TYPED)
  await expect(continueButton).toBeDisabled()
  await cards.nth(2).getByRole('textbox').fill('   ')
  await expect(continueButton).toBeDisabled()
  await cards.nth(2).getByRole('radio', { name: /Today/ }).press('Space')
  await expect(continueButton).toBeEnabled()
  daemon.pushFrame(frame('model_list', { conversation_id: CONVERSATION_ID, models: MODELS, dropped_models: 0 }))
  await page.locator('.composer__footer .composer__model').click()
  await page.getByRole('menuitem', { name: 'Opus', exact: true }).click()
  await expect.poll(() => settings.length).toBe(1)
  expect(settings[0].payload).toEqual({ session_id: 'question-session', model: 'opus' })
  daemon.pushFrame(frame('session_settings_updated', { session_id: 'question-session' }, settings[0].id))
  await expect(cards.nth(1).getByRole('textbox')).toHaveValue(OTHER_TYPED)
  await continueButton.click()
  await expect.poll(() => captured).toEqual([{ type: 'question_answer', questionBatchId: BATCH_ID, answers: EXPECTED_ANSWERS }])
  await expect(panel).toHaveCount(0)
  await expect(composer).toHaveValue(DRAFT)
})
