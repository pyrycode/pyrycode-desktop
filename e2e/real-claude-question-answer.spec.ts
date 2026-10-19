import { randomUUID } from 'node:crypto'
import { type Page } from '@playwright/test'
import type { DaemonEvent } from '../src/shared/ipc/events'
import type { WireModelOption } from '../src/shared/wire/types'
import { test, expect, encodePairingPayload, scenarioNonce, scenarioInput } from './fixtures/clientScenario'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { createQuestionAnswerEvidence } from './fixtures/questionAnswerEvidence'

// AskUserQuestion must park on the stream-json approval path, with the device's remote-answer grant.
// Skipping permissions auto-runs the tool without an answerable batch. Require daemon question support.
const QUESTION_MODEL = 'claude-sonnet-5'
test.use({ skipPermissions: false, interactiveRunner: 'stream-json', stdioPermissionPrompt: true,
  allowRemotePermissions: true, claudeModel: QUESTION_MODEL, requiredCapabilities: ['question'] })

const HANDSHAKE_TIMEOUT_MS = 45_000
const QUESTION_SURFACE_TIMEOUT_MS = 180_000
const TURN_TIMEOUT_MS = 120_000
const PANEL = '.question-batch'
const OPTION_LABEL = '.question-panel__option-label'
const CARD = '.question-batch__question'
const CURSOR_SELECTOR = '.bubble__cursor'

function questionAnswerTrigger(nonce: number): string {
  return 'Before writing anything, use AskUserQuestion once with a batch of exactly two questions, ' +
    'each with a short header, options with descriptions, and multiSelect false. First ask which eviction ' +
    'policy an in-memory key-value cache should use, offering four policies. Second ask for a confirmation ' +
    'message, offering two examples; I will supply my own message through Other. After I answer, ' +
    'acknowledge the selected policy and include my exact supplied confirmation message in your reply, ' +
    `using any natural sentence structure. Do not write code or use any other tool. run=${nonce}`
}

// Only the later probe uses a DOM transcript suffix. Prefix replacement supplies no freshness evidence.
function assistantText(page: Page): Promise<string> {
  return page.locator('[data-thread-role="assistant"]').evaluateAll(els => els.map(el => {
    const copy = el.cloneNode(true) as HTMLElement
    copy.querySelectorAll('.bubble__meta, .bubble__cursor').forEach(node => node.remove())
    return (copy.textContent ?? '').trim()
  }).join('\n'))
}
type ModelEvidence = {
  models: readonly WireModelOption[]; announced: string[]; accepted: number; rejected: number; stop: () => void
}
type EvidenceWindow = Window & {
  questionModelEvidence: ModelEvidence
  questionAnswerEvidence: ReturnType<typeof createQuestionAnswerEvidence>
}

test('real claude changes model during a question and resumes with the original answer', async ({ relay, daemon, page }, testInfo) => {
  test.setTimeout(480_000)
  const message = questionAnswerTrigger(scenarioNonce())
  const payload = encodePairingPayload({ server: daemon.pairFields.server, relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token, server_static_pubkey: daemon.pairFields.server_static_pubkey })
  const sendButton = page.getByRole('button', { name: 'Send' })
  const composer = page.getByPlaceholder('Message…')
  const panel = page.locator(PANEL)
  const cards = panel.locator(CARD)
  const trailing = panel.locator('.question-panel__continue')
  await pairFromUnpairedLaunch(page, payload)
  await expect(page.locator('.channel-list__row-open')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await page.evaluate(createQuestionAnswerEvidence, true)
  await confirmCreateChat(page)
  await expect(page.locator('.conversation')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  await page.evaluate(() => {
    const evidence: ModelEvidence = { models: [], announced: [], accepted: 0, rejected: 0, stop: () => {} }
    evidence.stop = window.pyry.onDaemonEvent((event: DaemonEvent) => {
      if (event.type === 'modelList') evidence.models = event.models
      if (event.type === 'modelAnnounced') evidence.announced.push(event.model)
      if (event.type === 'sessionSettingsUpdated') evidence.accepted += 1
      if (event.type === 'sessionSettingsRejected') evidence.rejected += 1
    })
    ;(window as unknown as EvidenceWindow).questionModelEvidence = evidence
  })
  // Read-only breakpoint: project just the public route, batch and indexed answers. The command has no
  // conversation field: the original daemon question binds its batch to the conversation. No token is read.
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Debugger.enable')
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'window.pyry.sendCommand' })
    if (!result.objectId) throw new Error('Question answer observation unavailable')
    await cdp.send('Debugger.setBreakpointOnFunctionCall', {
      objectId: result.objectId,
      condition: `(arguments[0].type === 'answerQuestions' && globalThis.questionAnswerEvidence.submit({
        serverId: arguments[0].serverId,
        conversationId: globalThis.questionAnswerEvidence.identity().conversation,
        batchId: arguments[0].payload.question_batch_id,
        answers: arguments[0].payload.answers.map(a => ({ question_index: a.question_index, values: [...a.values] }))
      }), false)`
    })
    await composer.fill(message)
    await sendButton.click()
    await expect(panel).toBeVisible({ timeout: QUESTION_SURFACE_TIMEOUT_MS })
    await expect(cards).toHaveCount(2)
    // Generate this only AFTER the batch surfaces. The initial prompt cannot supply the witness.
    const confirmation = scenarioInput('question-confirmation', () => `confirmed-${randomUUID()}`)
    expect(message.includes(confirmation)).toBe(false)
    await expect.poll(() => page.evaluate(() => (window as unknown as EvidenceWindow).questionAnswerEvidence.identity().turn),
      { timeout: HANDSHAKE_TIMEOUT_MS }).not.toBe('')
    const original = await page.evaluate(() => (window as unknown as EvidenceWindow).questionAnswerEvidence.identity())
    expect(original.outstanding && Boolean(original.batch)).toBe(true)
    await expect.poll(() => page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.models.length),
      { timeout: HANDSHAKE_TIMEOUT_MS }).toBeGreaterThan(0)
    const published = await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.models)
    const previous = await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.announced.at(-1))
    expect(Boolean(previous)).toBe(true)
    const visibleModels = published.filter(row => (row.agent ?? 'claude') === 'claude' && row.value !== 'default')
    const targetIndex = visibleModels.findIndex(row => row.value !== '' && row.value !== QUESTION_MODEL &&
      row.resolved_model !== previous && row.value.startsWith('opus'))
    expect(targetIndex, 'daemon must publish a different non-empty Opus model').toBeGreaterThanOrEqual(0)
    const target = visibleModels[targetIndex]
    const acceptedBefore = await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.accepted)
    await page.locator('.composer__footer:visible .composer__model').click()
    const modelMenu = page.getByRole('menu', { name: 'Model', exact: true })
    await expect(modelMenu.getByRole('menuitem')).toHaveCount(visibleModels.length)
    const targetItem = modelMenu.getByRole('menuitem').nth(targetIndex)
    await expect(targetItem).toHaveText('Opus')
    await targetItem.click()
    await expect.poll(() => page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.accepted),
      { timeout: HANDSHAKE_TIMEOUT_MS }).toBeGreaterThan(acceptedBefore)
    expect(await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.rejected)).toBe(0)
    expect(await page.evaluate(() => (window as unknown as EvidenceWindow).questionAnswerEvidence.identity())).toEqual(original)
    await expect(panel).toBeVisible()

    const labels = await cards.nth(0).locator(OPTION_LABEL).allTextContents()
    expect(labels.length).toBeGreaterThanOrEqual(2)
    const chosen = labels[labels.length - 1]
    expect(chosen.trim().length).toBeGreaterThan(0)
    await cards.nth(0).locator(OPTION_LABEL).last().click()
    const other = cards.nth(1).getByRole('textbox', { name: 'Other. Type something.', exact: true })
    await other.fill(confirmation)
    await expect(trailing).toHaveText('Continue')
    await expect(trailing).toBeEnabled()
    const answers = [{ question_index: 0, values: [chosen] }, { question_index: 1, values: [confirmation] }]
    expect(await page.evaluate(value => (window as unknown as EvidenceWindow).questionAnswerEvidence.arm(value),
      { confirmation, answers })).toBe(true)
    await trailing.click()
    await expect(panel).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => (window as unknown as EvidenceWindow).questionAnswerEvidence.snapshot()),
      { timeout: TURN_TIMEOUT_MS, message: 'original batch requires matching answer, daemon dismissal, fresh confirmation and normal original-turn completion' })
      .toEqual({ armed: true, submitted: true, dismissed: true, witnessed: true, completed: true, invalid: false, failure: '' })
    await expect(page.locator('[data-thread-role="assistant"]').filter({ hasText: confirmation })).toHaveCount(1)
    await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })
    await page.evaluate(() => (window as unknown as EvidenceWindow).questionAnswerEvidence.stop())

    // system/init announces the changed resolved model on the ensuing user turn, after original completion.
    const announcementCount = await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.announced.length)
    const beforeProbe = await assistantText(page)
    await expect(composer).toBeVisible()
    await composer.fill('Reply with OK only. Do not use tools.')
    await sendButton.click()
    await expect.poll(() => page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.announced.length),
      { timeout: TURN_TIMEOUT_MS }).toBeGreaterThan(announcementCount)
    // The native live-state read can reassert the previous model before the new system/init arrives.
    await expect.poll(() => page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.announced.at(-1) ?? ''),
      { timeout: TURN_TIMEOUT_MS }).toMatch(/^claude-opus/)
    const resolved = await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.announced.at(-1))
    expect(typeof resolved === 'string' && resolved.length > 0 && resolved !== previous).toBe(true)
    expect(resolved?.startsWith('claude-opus')).toBe(true)
    await testInfo.attach('resolved-target-model', { body: JSON.stringify({ requested: target.value.slice(0, 256),
      resolved: resolved?.slice(0, 256) }), contentType: 'application/json' })
    await expect.poll(async () => {
      const after = await assistantText(page)
      return after.startsWith(beforeProbe) ? after.slice(beforeProbe.length).trim().length : 0
    }, { timeout: TURN_TIMEOUT_MS }).toBeGreaterThan(0)
    await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })
  } finally {
    await testInfo.attach('question-answer-evidence', { contentType: 'application/json', body: JSON.stringify(
      await page.evaluate(() => {
        const proof = (window as unknown as EvidenceWindow).questionAnswerEvidence
        return { identity: proof.identity(), gates: proof.snapshot() }
      })) })
    await page.evaluate(() => {
      const w = window as unknown as EvidenceWindow
      w.questionModelEvidence.stop(); w.questionAnswerEvidence.stop()
    })
    await cdp.detach()
  }
})
