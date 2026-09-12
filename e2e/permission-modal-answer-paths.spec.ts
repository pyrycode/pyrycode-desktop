import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, Envelope, EnvelopeType, ModalShownPayload, WireQuestion } from '../src/shared/wire/types'
import type { Locator, Page } from '@playwright/test'

// All content is synthetic. Assert only routing fields; never serialize captured answer tokens.
const OPEN = SEEDED_ROW.id
const OTHER = { ...SEEDED_ROW, id: 'other-chat', name: 'Other discussion' }
const OPTIONS = [{ id: 'deny', label: 'Deny' }, { id: 'allow', label: 'Allow' }]
const frame = (type: EnvelopeType, payload: unknown): Uint8Array =>
  encodeEnvelope({ id: 1, type, ts: '2026-07-07T12:00:00.000Z', payload })
const shown = (id: string, over: Partial<ModalShownPayload> = {}): Uint8Array =>
  frame('modal_shown', { conversation_id: OPEN, modal_id: id, class: 'permission',
    title: id, prompt: 'Allow reading the file?', options: OPTIONS, default_option_id: 'deny', ...over })
const dismissed = (id: string): Uint8Array =>
  frame('modal_dismissed', { modal_id: id, outcome: 'remote', source: 'remote' })
const question = (header: string): WireQuestion => ({ header, question: 'Choose ' + header,
  options: [{ label: 'First pick', description: 'A supplied choice' }], multi_select: true })
const questions = (id: string): Uint8Array => frame('question_shown', {
  conversation_id: OPEN, question_batch_id: id, questions: [question('Language'), question('Editor')]
})

function fake(captured: Envelope[], rows: ConversationSummary[]) {
  return (bytes: Uint8Array): Uint8Array[] => {
    const env = decodeEnvelope(bytes)
    captured.push(env)
    return env.type === 'list_conversations' ? [frame('conversations', { conversations: rows })] : []
  }
}
function resolutions(captured: Envelope[], id: string, type = 'modal_answer', option?: string): number {
  return captured.filter((e) => {
    const payload = e.payload as { modal_id?: string; option_id?: string }
    return e.type === type && payload.modal_id === id && (option === undefined || payload.option_id === option)
  }).length
}
const panelFor = (page: Page): Locator => page.locator('.permission-panel')
const action = (panel: Locator, name: string): Locator => panel.getByRole('button', { name, exact: true })
const choose = async (panel: Locator, name: string): Promise<void> => {
  await panel.locator('.question-panel__option').filter({ hasText: name }).click()
  await expect(panel.locator('.question-panel__option').filter({ hasText: name }).getByRole('radio')).toBeChecked()
}
const rowFor = (page: Page, name: string): Locator => page.locator('.channel-list__row').filter({ hasText: name })
const openChat = async (page: Page, name: string): Promise<void> => {
  await rowFor(page, name).locator('.channel-list__row-open').click()
  await expect(rowFor(page, name).locator('.channel-list__row-open')).toHaveAttribute('aria-current', 'true')
}

test('permission and trust require selection then Continue; confirmation, cancel and remote dismissal advance FIFO', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake(captured, [SEEDED_ROW]) })
  await page.setViewportSize({ width: 1280, height: 800 })
  const panel = panelFor(page)
  daemon.pushFrame(shown('Default permission'))
  await expect(panel).toBeVisible()
  await expect(action(panel, 'Continue')).toBeDisabled()
  await expect(panel.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.permission-modal-overlay')).toHaveCount(0)
  await choose(panel, 'Deny')
  expect(resolutions(captured, 'Default permission')).toBe(0)
  await page.screenshot({ path: '/tmp/builder-1356-permission-normal.png', animations: 'disabled' })
  await action(panel, 'Continue').click()
  await expect.poll(() => resolutions(captured, 'Default permission', 'modal_answer', 'deny')).toBe(1)
  await expect(panel).toHaveCount(0)

  daemon.pushFrame(shown('Confirm permission'))
  await choose(panel, 'Allow')
  await expect(action(panel, 'Confirm')).toHaveCount(0)
  await action(panel, 'Continue').click()
  await expect(action(panel, 'Confirm')).toBeVisible()
  expect(resolutions(captured, 'Confirm permission')).toBe(0)
  await action(panel, 'Back').click()
  await expect(panel.getByRole('radio', { name: 'Allow', exact: true })).toBeChecked()
  expect(resolutions(captured, 'Confirm permission')).toBe(0)
  await action(panel, 'Continue').click()
  await action(panel, 'Confirm').click()
  await expect.poll(() => resolutions(captured, 'Confirm permission', 'modal_answer', 'allow')).toBe(1)

  // The supplied default is authoritative even when it is affirmative.
  daemon.pushFrame(shown('Trust workspace', { class: 'trust', options: [
    { id: 'proceed', label: 'Proceed' }, { id: 'exit', label: 'Exit' }
  ], default_option_id: 'proceed' }))
  await choose(panel, 'Proceed')
  await action(panel, 'Continue').click()
  await expect.poll(() => resolutions(captured, 'Trust workspace', 'modal_answer', 'proceed')).toBe(1)

  daemon.pushFrame(shown('Replace options'))
  daemon.pushFrame(shown('Next request'))
  await choose(panel, 'Allow')
  await action(panel, 'Continue').click()
  await expect(action(panel, 'Confirm')).toBeVisible()
  daemon.pushFrame(shown('Replace options', { options: [OPTIONS[0]] }))
  await expect(action(panel, 'Continue')).toBeDisabled()
  daemon.pushFrame(shown('Replace options'))
  await expect(panel.getByRole('radio')).toHaveCount(2)
  await expect(action(panel, 'Continue')).toBeDisabled()
  await choose(panel, 'Allow')
  await action(panel, 'Continue').click()
  daemon.pushFrame(dismissed('Replace options'))
  await expect(panel).toContainText('Next request')
  await expect(action(panel, 'Continue')).toBeDisabled()
  await expect(action(panel, 'Confirm')).toHaveCount(0)
  expect(resolutions(captured, 'Replace options')).toBe(0)
  daemon.pushFrame(shown('After cancel'))
  await action(panel, 'Cancel').click()
  await expect.poll(() => resolutions(captured, 'Next request', 'modal_cancel')).toBe(1)
  expect(resolutions(captured, 'Next request')).toBe(0)
  await expect(panel).toContainText('After cancel')
  await expect(action(panel, 'Continue')).toBeDisabled()
  daemon.pushFrame(dismissed('After cancel'))
  await expect(panel).toHaveCount(0)

  for (const env of captured.filter((e) => e.type === 'modal_answer')) {
    expect(Object.keys(env.payload as object).sort()).toEqual(['answer_token', 'modal_id', 'option_id'])
  }
})

test('chat-scoped FIFO and rejection feedback survive optimistic removal, switching and reconnect', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const rows = [SEEDED_ROW]
  const { page, daemon, forwarder } = await launchPairedApp({
    buildReplyFrames: fake(captured, rows),
    reconnectResendFrames: [shown('Reconnect marker', { conversation_id: OTHER.id })]
  })
  rows.push(OTHER)
  daemon.pushFrame(frame('conversations', { conversations: rows }))
  const panel = panelFor(page)
  daemon.pushFrame(shown('Other first', { conversation_id: OTHER.id }))
  await expect(rowFor(page, OTHER.name).getByRole('img', { name: 'Input required' })).toBeVisible()
  await expect(rowFor(page, SEEDED_ROW.name!).locator('.channel-list__row-open')).toHaveAttribute('aria-current', 'true')
  await expect(panel).toHaveCount(0)
  daemon.pushFrame(shown('Open first'))
  daemon.pushFrame(shown('Open second'))
  await expect(panel).toContainText('Open first')
  await choose(panel, 'Allow')
  await action(panel, 'Continue').click()
  await openChat(page, OTHER.name)
  await expect(panel).toContainText('Other first')
  await expect(action(panel, 'Continue')).toBeDisabled()
  await openChat(page, SEEDED_ROW.name!)
  await expect(panel).toContainText('Open first')
  await expect(action(panel, 'Continue')).toBeDisabled()
  await choose(panel, 'Deny')
  await action(panel, 'Continue').click()
  await expect.poll(() => resolutions(captured, 'Open first')).toBe(1)
  await expect(panel).toContainText('Open second')

  // Delay rejection until the originating chat is no longer open.
  await openChat(page, OTHER.name)
  daemon.pushFrame(frame('error', {}))
  await expect(panel).toContainText('Other first')
  await expect(page.locator('.modal-rejection')).toHaveCount(0)
  await action(panel, 'Cancel').click()
  await expect.poll(() => resolutions(captured, 'Other first', 'modal_cancel')).toBe(1)
  await openChat(page, SEEDED_ROW.name!)
  const banner = page.locator('.modal-rejection')
  await expect(banner).toContainText('Your answer was rejected.')
  daemon.pushFrame(dismissed('Open second'))
  await expect(page.getByPlaceholder('Message…')).toBeVisible()
  await page.getByPlaceholder('Message…').fill('Feedback does not cover input')
  await expect(rowFor(page, OTHER.name).getByRole('img', { name: 'Input required' })).toHaveCount(0)
  forwarder.dropClientLeg()
  await expect(rowFor(page, OTHER.name).getByRole('img', { name: 'Input required' })).toBeVisible({ timeout: 15_000 })
  await expect(banner).toBeVisible()
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Feedback does not cover input')
  daemon.pushFrame(questions('question-after-rejection'))
  const questionnaire = page.locator('.question-panel:not(.permission-panel)')
  await expect(questionnaire).toBeVisible()
  const bannerBox = await banner.boundingBox()
  const questionBox = await questionnaire.boundingBox()
  expect(bannerBox!.y + bannerBox!.height).toBeLessThanOrEqual(questionBox!.y)
  await openChat(page, OTHER.name)
  await expect(banner).toHaveCount(0)
  await openChat(page, SEEDED_ROW.name!)
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: 'Dismiss' }).click()
  await expect(banner).toHaveCount(0)
  await expect(questionnaire).toBeVisible()
})

test('permission coverage retains draft, questionnaire picks, Other and active question while isolating hidden inputs', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake(captured, [SEEDED_ROW]) })
  await page.setViewportSize({ width: 800, height: 600 })
  const composer = page.getByPlaceholder('Message…')
  await composer.fill('Retained draft')
  daemon.pushFrame(questions('waiting-batch'))
  const questionnaire = page.locator('.question-panel:not(.permission-panel)')
  const other = questionnaire.getByRole('textbox', { name: 'Other. Type something.' })
  await questionnaire.locator('.question-panel__option').filter({ hasText: 'First pick' }).click()
  await other.fill('Retained first Other')
  await questionnaire.getByRole('button', { name: 'Editor', exact: true }).click()
  await other.fill('Retained editor Other')
  const longPath = '/workspace/reports/' + 'a'.repeat(180) + '.json'
  const longText = `Write the generated report to ${longPath}?\n` +
    'A complete explanation must wrap and remain reachable. '.repeat(160) + 'FINAL EXPLANATION'
  const allowLabel = `Allow writing ${longPath}`
  daemon.pushFrame(shown('Long permission', {
    prompt: longText, options: [OPTIONS[0], { id: 'allow', label: allowLabel }]
  }))
  const panel = panelFor(page)
  await expect(panel).toBeVisible()
  await expect(questionnaire).toBeHidden()
  await expect(composer).toBeHidden()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(panel.locator('.permission-panel__explanation')).toHaveText(longText)
  // Hidden focused inputs cannot retain keyboard input, focus, or a submit gesture.
  await page.keyboard.type('SHOULD NOT REACH A HIDDEN INPUT')
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('[hidden]') !== null)).toBe(false)
  }
  expect(captured.filter((e) => ['send_message', 'question_answer', 'modal_answer'].includes(e.type))).toHaveLength(0)
  const scroll = panel.locator('.permission-panel__content')
  const expectNoHorizontalOverflow = async (): Promise<void> => {
    for (const element of [scroll, panel.locator('.permission-panel__explanation')]) {
      const width = await element.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }))
      expect.soft(width.scroll).toBeLessThanOrEqual(width.client)
    }
  }
  await expectNoHorizontalOverflow()
  const dimensions = await scroll.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
  expect(dimensions.scroll).toBeGreaterThan(dimensions.client)
  await expect(action(panel, 'Cancel')).toBeInViewport()
  await expect(action(panel, 'Continue')).toBeInViewport()
  await page.screenshot({ path: '/tmp/builder-1356-rework-permission-long.png', animations: 'disabled' })
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await choose(panel, 'Allow writing')
  await action(panel, 'Continue').click()
  await expect(panel.locator('.permission-panel__explanation')).toHaveText(
    `Send "${allowLabel}"? This grants the requested action.`)
  await expectNoHorizontalOverflow()
  await expect(action(panel, 'Back')).toBeInViewport()
  await expect(action(panel, 'Confirm')).toBeInViewport()
  await page.screenshot({ path: '/tmp/builder-1356-rework-permission-confirm.png', animations: 'disabled' })
  expect(resolutions(captured, 'Long permission')).toBe(0)
  await action(panel, 'Back').click()
  await choose(panel, 'Deny')
  await action(panel, 'Continue').click()
  await expect.poll(() => resolutions(captured, 'Long permission', 'modal_answer', 'deny')).toBe(1)
  await expect(questionnaire).toBeVisible()
  await expect(questionnaire.getByRole('button', { name: 'Editor', exact: true })).toHaveAttribute('aria-current', 'true')
  await expect(other).toHaveValue('Retained editor Other')
  await questionnaire.getByRole('button', { name: 'Language', exact: true }).click()
  await expect(other).toHaveValue('Retained first Other')
  await expect(questionnaire.getByRole('checkbox', { name: /First pick/ })).toBeChecked()
  daemon.pushFrame(frame('question_dismissed', { question_batch_id: 'waiting-batch', outcome: 'unanswered', source: 'no_answer' }))
  await expect(composer).toBeVisible()
  await expect(composer).toHaveValue('Retained draft')
})
