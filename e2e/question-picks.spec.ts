import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { mintChatInWorkspace } from './fixtures/mintChatRow'
import { encodeEnvelope } from '../src/main/transport/codec'
import { AT_BOTTOM_TOLERANCE_PX } from '../src/renderer/src/screens/conversation/threadScrollPosition'
import type {
  QuestionDismissedPayload,
  QuestionShownPayload,
  WireQuestion,
  WireQuestionOption
} from '../src/shared/wire/types'

// Fake transport proves native interactions; captures contain synthetic content only.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes
// pushed frames by envelope id, so one fixed id is reused across every push.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// conversationStateFake's own default seed id — the conversation launchPairedApp lands in, and the one both
// batches are raised against. A batch is display-scoped by conversation, so this is what puts the panel in
// front of the operator at launch.
const CONVERSATION_ID = 'seed-conversation'
const SEEDED_TITLE = 'Seeded channel'
// The bare `conversationStateFake()` default seed's own `cwd` — the workspace the second conversation is
// minted into below. Restated here rather than imported: this spec takes the fake bare, and the seed is
// the fixture's business, so a literal is the narrower coupling of the two.
const SEEDED_CWD = '/fake/workspace'

// Three nonces, one per arc. Distinct so each later batch is genuinely a FRESH batch for the SAME
// conversation — which is the half of AC4 that a re-render of the first batch could never prove.
const BATCH_SINGLE = 'question-batch-single'
const BATCH_MULTI = 'question-batch-multi'
const BATCH_TABS = 'question-batch-tabs'

// MUTUALLY NON-SUBSTRING LABELS, and none of them appears in any description. Playwright matches an
// accessible name by case-insensitive SUBSTRING, and an implicit <label> gives each row the name
// "<label> <description>", so a label contained in another row's text would silently match two controls.
const OPTIONS: WireQuestionOption[] = [
  { label: 'Rust', description: 'systems' },
  { label: 'Elixir', description: 'concurrent' },
  { label: 'Haskell', description: 'pure' }
]

// #915's second question, distinguishable from the first in every observable at once — its header names its
// tab, its text is what the box must swap to, and its options are how a jump is told from a re-render of the
// question already showing. Non-substring of each other and of every label above, for the same accessible-
// name reason. The headers are also matched as BUTTON names, so neither may be a substring of Cancel or
// Continue.
const LANGUAGE_HEADER = 'Language'
const EDITOR_HEADER = 'Editor'
const EDITOR_QUESTION = 'And which editor should you drive it in?'
const EDITOR_OPTIONS: WireQuestionOption[] = [
  { label: 'Helix', description: 'modal' },
  { label: 'Zed', description: 'collaborative' }
]

// The panel's client-owned copy, re-declared spec-local rather than imported from QuestionPanel.tsx (the
// REJECTION_COPY precedent): e2e is outside every tsconfig and importing a .tsx module would drag React
// through Playwright's transform for two string literals.
const OTHER_PLACEHOLDER = 'Other. Type something.'
const OTHER_TICK = 'Other'
// #916's action-row copy, spec-local for the same reason. Matched as BUTTON NAMES, which Playwright does
// by case-insensitive substring — so none of them may contain another, nor either question header above.
const CONTINUE_COPY = 'Continue'

// Non-secret display literals, distinct from each other so a failure diagnostic names WHICH box held what.
const OTHER_TEXT = 'Zig, if that counts'
const EDITOR_OTHER_TEXT = 'Acme, on a good day'
const DRAFT = 'a half-typed message the panel must not eat'

/** One question, spread-overridden per arc (#915 widened this from a lone `multiSelect` flag, since the tab
 *  arc needs two questions that are told apart by their header, their text AND their options).
 *  `multi_select` is the wire's snake_case spelling — the one renamed field in this family. */
function wireQuestion(over: Partial<WireQuestion> = {}): WireQuestion {
  return {
    question: 'Which of these three programming languages should you learn next?',
    header: LANGUAGE_HEADER,
    options: OPTIONS,
    multi_select: false,
    ...over
  }
}

/** A `question_shown` batch, surfaced via daemon.pushFrame. All three payload fields always present. The
 *  batch is the whole list (#915): re-pushing the SAME id with a different list replaces it in place. */
function questionShownFrame(questionBatchId: string, questions: WireQuestion[]): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'question_shown',
    ts: FIXED_TS,
    payload: {
      conversation_id: CONVERSATION_ID,
      question_batch_id: questionBatchId,
      questions
    } satisfies QuestionShownPayload
  })
}

/** The daemon retiring a batch — the ONLY way one leaves the held set (this family has no answer frame, so
 *  there is no local dismissal to race). `outcome`/`source` carry the producer's one landed pair; neither is
 *  consulted by either store, which clears on any dismissal regardless of cause. */
function questionDismissedFrame(questionBatchId: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'question_dismissed',
    ts: FIXED_TS,
    payload: {
      question_batch_id: questionBatchId,
      outcome: 'unanswered',
      source: 'no_answer'
    } satisfies QuestionDismissedPayload
  })
}

test('inline questions keep independent picks and drafts through chat switches, replacement and redelivery', async ({ launchPairedApp }) => {
  const { page, daemon, app } = await launchPairedApp({ buildReplyFrames: conversationStateFake() })
  const panel = page.locator('.question-batch')
  const cards = panel.locator('.question-batch__question')
  const composer = page.getByPlaceholder('Message…')
  const batch = [wireQuestion(), wireQuestion({ header: EDITOR_HEADER })]
  await composer.fill(DRAFT)
  daemon.pushFrame(questionShownFrame(BATCH_SINGLE, batch))
  await expect(cards).toHaveCount(2)
  await expect(composer).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1320))
  await page.screenshot({ path: '/tmp/builder-1729/inline-desktop.png', animations: 'disabled' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600))
  await page.screenshot({ path: '/tmp/builder-1729/inline-minimum.png', animations: 'disabled' })
  await cards.nth(0).getByRole('radio', { name: /Rust/ }).press('Space')
  await cards.nth(1).getByRole('radio', { name: /Elixir/ }).press('Space')
  await cards.nth(0).getByRole('radio', { name: /Rust/ }).press('ArrowDown')
  await expect(cards.nth(0).getByRole('radio', { name: /Elixir/ })).toBeChecked()
  await expect(cards.nth(1).getByRole('radio', { name: /Elixir/ })).toBeChecked()
  await cards.nth(0).getByRole('textbox').fill(OTHER_TEXT)
  await expect(cards.nth(0).getByRole('radio', { name: 'Other', exact: true })).toBeChecked()
  await mintChatInWorkspace(page, SEEDED_CWD)
  await expect(panel).toHaveCount(0)
  await page.locator('.channel-list__row').filter({ hasText: SEEDED_TITLE }).locator('.channel-list__row-open').click()
  await expect(cards.nth(0).getByRole('textbox')).toHaveValue(OTHER_TEXT)
  await expect(cards.nth(1).getByRole('radio', { name: /Elixir/ })).toBeChecked()
  daemon.pushFrame(questionShownFrame(BATCH_MULTI, [wireQuestion({ multi_select: true })]))
  await expect(cards).toHaveCount(1)
  await expect(cards.getByRole('textbox')).toHaveValue('')
  await cards.getByRole('checkbox', { name: /Rust/ }).press('Space')
  await cards.getByRole('checkbox', { name: /Elixir/ }).press('Space')
  await cards.getByRole('textbox').fill(EDITOR_OTHER_TEXT)
  await expect(cards.locator('input:checked')).toHaveCount(3)
  daemon.pushFrame(questionShownFrame(BATCH_MULTI, [wireQuestion({ multi_select: true, options: OPTIONS.slice(0, 1) })]))
  await expect(cards.locator('.question-panel__option-label')).toHaveCount(1)
  await expect(cards.getByRole('textbox')).toHaveValue(EDITOR_OTHER_TEXT)
  daemon.pushFrame(questionDismissedFrame(BATCH_MULTI))
  await expect(panel).toHaveCount(0)
  daemon.pushFrame(questionShownFrame(BATCH_MULTI, [wireQuestion()]))
  await expect(cards.getByRole('textbox')).toHaveValue('')
})

test('inline question arrival and edits respect an earlier reader and bottom following', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: conversationStateFake() })
  const thread = page.locator('.conversation__thread')
  const push = (type: string, payload: unknown) => daemon.pushFrame(encodeEnvelope({ id: 1, type, ts: FIXED_TS, payload }))
  for (let index = 0; index < 25; index++) {
    push('assistant_delta', { conversation_id: CONVERSATION_ID, turn_id: `turn-${index}`, seq: 0, text: `Earlier reply ${index}` })
    push('turn_end', { conversation_id: CONVERSATION_ID, turn_id: `turn-${index}` })
  }
  await expect(page.locator('[data-thread-role="assistant"]')).toHaveCount(25)
  await expect.poll(() => thread.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2)
  await thread.evaluate(el => { el.scrollTop = 200 })
  await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBe(200)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const before = await thread.evaluate(el => el.scrollTop)
  daemon.pushFrame(questionShownFrame(BATCH_SINGLE, [wireQuestion(), wireQuestion()]))
  const cards = page.locator('.question-batch__question')
  await expect(cards).toHaveCount(2)
  await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBe(before)
  // Edit the way a pointer reader can: with the option on screen and the reader still above the bottom. A
  // label click focuses its visually hidden radio, and since #1733 made the thread that radio's containing
  // block, focusing an OFFSCREEN one scrolls the thread natively. Clicking an offscreen label would measure
  // that browser behaviour, not the app's response to the pick.
  const option = cards.nth(1).locator('.question-panel__option').first()
  await option.evaluate(label => label.scrollIntoView({ block: 'center' }))
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const reading = await thread.evaluate(el => el.scrollTop)
  expect(await thread.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(AT_BOTTOM_TOLERANCE_PX)
  await option.click()
  await expect(cards.nth(1).getByRole('radio', { name: /Rust/ })).toBeChecked()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await thread.evaluate(el => el.scrollTop)).toBe(reading)
  await thread.evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect.poll(() => thread.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  daemon.pushFrame(questionShownFrame(BATCH_SINGLE, [wireQuestion(), wireQuestion(), wireQuestion({ multi_select: true })]))
  await expect(cards).toHaveCount(3)
  await expect.poll(() => thread.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2)
})
