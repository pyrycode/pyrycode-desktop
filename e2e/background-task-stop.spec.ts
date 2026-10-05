import type { Page } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { BackgroundTask, BackgroundTaskProgressPayload, ConversationSummary, EnvelopeType } from '../src/shared/wire/types'

const frame = (type: EnvelopeType, payload: unknown) => encodeEnvelope({ id: 1771, type, ts: '2026-10-05T00:00:00Z', payload })
const task = (task_id: string, description: string): BackgroundTask => ({ task_id, description, task_type: 'local_bash', truncated_fields: null })
const rows = [task('terminal', 'Synthetic terminal work'), task('omitted', 'Synthetic roster work'), task('refused', 'Synthetic refused work')]
const second: ConversationSummary = { ...SEEDED_ROW, id: 'stop-other-conversation', name: 'Other stop room' }
const openPanel = async (page: Page) => {
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Background tasks', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Background tasks', exact: true })
  await expect(panel).toBeVisible()
  return panel
}

test('silent stops survive navigation and settle on stopped, omission and correlated refusal', async ({ launchPairedApp }) => {
  test.setTimeout(90_000)
  const fake = conversationStateFake({ conversations: [SEEDED_ROW] })
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake, helloAck: { capabilities: ['stop_background_task'] } })
  await page.setViewportSize({ width: 1280, height: 800 })
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, second] }))
  daemon.pushFrame(frame('background_task_roster', { conversation_id: SEEDED_ROW.id, tasks: rows, dropped_tasks: 0 }))
  let panel = await openPanel(page)
  const terminalRow = () => panel.locator('li').filter({ hasText: 'Synthetic terminal work' })
  const terminalButton = () => terminalRow().getByRole('button', { name: 'Stop task', exact: true })
  await expect(panel.getByRole('button', { name: 'Stop task', exact: true })).toHaveCount(3)
  await terminalButton().click()
  await expect(terminalButton()).toBeDisabled()
  await expect.poll(() => fake.backgroundTaskStopRequests()).toEqual([{ conversation_id: SEEDED_ROW.id, task_id: 'terminal' }])
  await expect(panel.locator('li').filter({ hasText: 'Synthetic refused work' }).getByRole('button', { name: 'Stop task' })).toBeEnabled()
  await terminalButton().dispatchEvent('click')
  daemon.pushFrame(frame('background_task_progress', {
    conversation_id: SEEDED_ROW.id, task_id: 'terminal', description: 'Synthetic progress',
    subagent_type: '', last_tool_name: 'Bash', total_tokens: 18000, tool_uses: 4, duration_ms: 161000,
    truncated_fields: null
  } satisfies BackgroundTaskProgressPayload))
  daemon.pushFrame(frame('background_task_updated', {
    conversation_id: SEEDED_ROW.id, task_id: 'terminal', patch: 'Synthetic latest update',
    status: '', summary: '', truncated_fields: ['patch']
  }))
  await expect(terminalRow()).toContainText('Synthetic progress')
  await expect(terminalRow()).toContainText('Synthetic latest update')
  await expect(terminalButton()).toBeDisabled()
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  panel = await openPanel(page)
  await expect(terminalButton()).toBeDisabled()
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  const openChat = async (name: string) => {
    await page.locator('.channel-list__row').filter({ hasText: name }).locator('.channel-list__row-open').click()
  }
  await openChat(second.name ?? '')
  await openChat(SEEDED_ROW.name ?? '')
  panel = await openPanel(page)
  await expect(terminalButton()).toBeDisabled()
  expect(fake.backgroundTaskStopRequests()).toHaveLength(1)
  await page.screenshot({ path: '/tmp/builder-1771/stop-pending-1280.png', animations: 'disabled' })
  await page.setViewportSize({ width: 800, height: 600 })
  await expect(terminalButton()).toBeVisible()
  await page.screenshot({ path: '/tmp/builder-1771/stop-pending-800.png', animations: 'disabled' })
  await page.setViewportSize({ width: 1280, height: 800 })

  for (const response of fake.replyToBackgroundTaskStop(0, 'stopped')) daemon.pushFrame(response)
  const finished = panel.locator('.background-task-panel__group').filter({ hasText: 'Finished · 1' })
  await expect(finished.locator('li')).toContainText('Synthetic terminal work')
  await expect(finished.locator('.background-task-panel__tag')).toHaveText('Stopped')
  await expect(finished.getByRole('button', { name: 'Stop task' })).toHaveCount(0)

  // The next stop's accepted response is a roster that still lists the other two tasks.
  fake.setBackgroundTaskStopAnswer(SEEDED_ROW.id, 'omitted', { roster: [rows[0], rows[2]] })
  await panel.locator('li').filter({ hasText: 'Synthetic roster work' }).getByRole('button', { name: 'Stop task' }).click()
  await expect.poll(() => fake.backgroundTaskStopRequests().length).toBe(2)
  await expect(panel.getByRole('heading', { name: 'Running · 1', exact: true })).toBeVisible()
  await expect(panel.locator('li').filter({ hasText: 'Synthetic roster work' })).toHaveCount(0)
  await expect(finished.locator('.background-task-panel__tag')).toHaveText('Stopped')

  const refusedButton = panel.locator('li').filter({ hasText: 'Synthetic refused work' }).getByRole('button', { name: 'Stop task' })
  await refusedButton.click()
  await expect(refusedButton).toBeDisabled()
  await expect.poll(() => fake.backgroundTaskStopRequests().length).toBe(3)
  for (const response of fake.replyToBackgroundTaskStop(2, 'refused')) daemon.pushFrame(response)
  await expect(refusedButton).toBeEnabled()
  expect(fake.backgroundTaskStopRequests()).toEqual([
    { conversation_id: SEEDED_ROW.id, task_id: 'terminal' },
    { conversation_id: SEEDED_ROW.id, task_id: 'omitted' },
    { conversation_id: SEEDED_ROW.id, task_id: 'refused' }
  ])
  await page.screenshot({ path: '/tmp/builder-1771/stop-outcomes-1280.png', animations: 'disabled' })
})
