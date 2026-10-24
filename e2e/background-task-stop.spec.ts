import type { Page } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { createCanonicalThread } from './fixtures/canonicalThread'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { BackgroundTaskProgressPayload, ConversationSummary, Envelope, EnvelopeType } from '../src/shared/wire/types'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

const session = 'stop-session'
const first: ConversationSummary = { ...SEEDED_ROW, current_session_id: session, agent: 'claude' }
const second: ConversationSummary = { ...SEEDED_ROW, id: 'stop-other-conversation', name: 'Other stop room',
  current_session_id: 'other-stop-session', agent: 'claude' }
const route = { conversation_id: first.id, epoch: 'stop-epoch' }
const frame = (type: EnvelopeType, payload: unknown, session_id?: string) =>
  encodeEnvelope({ id: 1771, type, ts: '2026-10-05T00:00:00Z', payload, session_id })
const task = (id: number, task_id: string, description: string, session: string) => ({
  id, order: id * 10, rev: 1, kind: 'tool_call', status: 'running', active: true, shown: true,
  summary: description, session, agent: 'claude',
  content: { name: 'Bash', task_id, tool_use_id: `call-${id}`,
    task_link: { task_id, tool_call_id: `call-${id}`, description } }
} satisfies ThreadItem)
const openPanel = async (page: Page) => {
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Background tasks', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Background tasks', exact: true })
  await expect(panel).toBeVisible()
  return panel
}

test('silent stops survive navigation and settle on stopped, omission and correlated refusal', async ({ launchPairedApp }) => {
  test.setTimeout(90_000)
  const terminal = task(1, 'terminal', 'Synthetic terminal work', session)
  const omitted = task(2, 'omitted', 'Synthetic roster work', session)
  const refused = task(3, 'refused', 'Synthetic refused work', session)
  const thread = createCanonicalThread({ conversations: [
    { summary: first, epoch: route.epoch, version: 1, items: [terminal, omitted, refused] },
    { summary: second, epoch: 'other-stop-epoch', version: 1,
      items: [task(1, 'other-task', 'Other scoped task', 'other-stop-session')] }
  ] })
  const requests: Envelope[] = []
  const fake = conversationStateFake({ conversations: [first] })
  const { page, daemon } = await launchPairedApp({ threadMode: 'canonical', thread,
    buildReplyFrames: bytes => { requests.push(decodeEnvelope(bytes)); return fake(bytes) },
    helloAck: { capabilities: ['interactive', 'thread', 'stop_background_task'] } })
  await page.setViewportSize({ width: 1280, height: 800 })
  daemon.pushFrame(frame('conversations', { conversations: [first, second] }))
  let panel = await openPanel(page)
  const terminalRow = () => panel.locator('li').filter({ hasText: 'Synthetic terminal work' })
  const terminalButton = () => terminalRow().getByRole('button', { name: 'Stop task', exact: true })
  await expect(panel.getByRole('button', { name: 'Stop task', exact: true })).toHaveCount(3)
  expect(requests.find(request => request.type === 'thread_catch_up')?.payload).toMatchObject({
    conversation_id: first.id, version: 0
  })
  expect(requests.filter(request => request.type === 'request_history')).toHaveLength(0)
  await terminalButton().click()
  await expect(terminalButton()).toBeDisabled()
  await expect.poll(() => fake.backgroundTaskStopRequests()).toEqual([{ conversation_id: SEEDED_ROW.id, task_id: 'terminal' }])
  await expect(panel.locator('li').filter({ hasText: 'Synthetic refused work' }).getByRole('button', { name: 'Stop task' })).toBeEnabled()
  await terminalButton().dispatchEvent('click')
  daemon.pushFrame(frame('background_task_progress', {
    conversation_id: SEEDED_ROW.id, task_id: 'terminal', description: 'Synthetic progress',
    subagent_type: '', last_tool_name: 'Bash', total_tokens: 18000, tool_uses: 4, duration_ms: 161000,
    truncated_fields: null
  } satisfies BackgroundTaskProgressPayload, session))
  const patchedContent = { ...terminal.content,
    task_update: { patch: 'Synthetic latest update', truncated_fields: ['patch'] } }
  daemon.pushFrame(frame('thread_item_changed', { ...route, version: 2,
    item_id: terminal.id, base_rev: 1, rev: 2, changes: { content: patchedContent }
  } satisfies Extract<ThreadUpdate, { type: 'thread_item_changed' }>['payload']))
  await expect(terminalRow()).toContainText('Synthetic progress')
  await expect(terminalRow()).toContainText('Synthetic latest update')
  await expect(terminalRow().locator('.background-task-panel__cut-patch')).toBeVisible()
  await expect(terminalButton()).toBeDisabled()
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  panel = await openPanel(page)
  await expect(terminalButton()).toBeDisabled()
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  const openChat = async (name: string) => {
    await page.locator('.channel-list__row').filter({ hasText: name }).locator('.channel-list__row-open').click()
  }
  await openChat(second.name ?? '')
  panel = await openPanel(page)
  await expect(panel).toContainText('Other scoped task')
  await expect(panel.getByRole('button', { name: 'Stop task' })).toBeEnabled()
  expect(requests.filter(request => request.type === 'thread_catch_up').map(request => request.payload))
    .toContainEqual(expect.objectContaining({ conversation_id: second.id, version: 0 }))
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await openChat(SEEDED_ROW.name ?? '')
  panel = await openPanel(page)
  await expect(terminalRow()).toContainText('Synthetic latest update')
  await expect(terminalButton()).toBeDisabled()
  expect(fake.backgroundTaskStopRequests()).toHaveLength(1)
  await page.screenshot({ path: '/tmp/builder-2283/stop-pending-1280.png', animations: 'disabled' })
  await page.setViewportSize({ width: 800, height: 600 })
  await terminalButton().scrollIntoViewIfNeeded()
  await expect(terminalButton()).toBeVisible()
  await page.screenshot({ path: '/tmp/builder-2283/stop-pending-800.png', animations: 'disabled' })
  await page.setViewportSize({ width: 1280, height: 800 })

  for (const response of fake.replyToBackgroundTaskStop(0, { type: 'thread_item_changed', payload: {
    ...route, version: 3, item_id: terminal.id, base_rev: 2, rev: 3,
    changes: { status: 'stopped', active: false }
  } })) daemon.pushFrame(response)
  const finished = panel.locator('.background-task-panel__group').filter({ hasText: 'Finished · 1' })
  await expect(finished.locator('li')).toContainText('Synthetic terminal work')
  await expect(finished.locator('.background-task-panel__tag')).toHaveText('Stopped')
  await expect(finished.getByRole('button', { name: 'Stop task' })).toHaveCount(0)

  // The former roster omission is now an authoritative inactive item with unknown outcome.
  fake.setBackgroundTaskStopAnswer(SEEDED_ROW.id, 'omitted', { type: 'thread_item_changed', payload: {
    ...route, version: 4, item_id: omitted.id, base_rev: 1, rev: 2,
    changes: { status: 'gone', active: false }
  } })
  await panel.locator('li').filter({ hasText: 'Synthetic roster work' }).getByRole('button', { name: 'Stop task' }).click()
  await expect.poll(() => fake.backgroundTaskStopRequests().length).toBe(2)
  await expect(panel.getByRole('heading', { name: 'Running · 1', exact: true })).toBeVisible()
  // Settling another item cannot rewrite the previously recorded stopped outcome.
  await expect(panel.locator('li').filter({ hasText: 'Synthetic roster work' })).toContainText('Outcome unknown')
  await expect(panel.locator('li').filter({ hasText: 'Synthetic roster work' }).getByRole('button', { name: 'Stop task' })).toHaveCount(0)
  await expect(panel.locator('li').filter({ hasText: 'Synthetic terminal work' }).locator('.background-task-panel__tag')).toHaveText('Stopped')

  const refusedButton = panel.locator('li').filter({ hasText: 'Synthetic refused work' }).getByRole('button', { name: 'Stop task' })
  await refusedButton.click()
  await expect(refusedButton).toBeDisabled()
  await expect.poll(() => fake.backgroundTaskStopRequests().length).toBe(3)
  for (const response of fake.replyToBackgroundTaskStop(2, 'refused')) daemon.pushFrame(response)
  await expect(refusedButton).toBeEnabled()
  await expect(panel.getByRole('heading', { name: 'Running · 1', exact: true })).toBeVisible()
  await expect(panel.locator('li').filter({ hasText: 'Synthetic refused work' }).locator('.background-task-panel__tag')).toHaveText('Running')
  await expect(panel.locator('li').filter({ hasText: 'Synthetic terminal work' }).locator('.background-task-panel__tag')).toHaveText('Stopped')
  await expect(panel.locator('li').filter({ hasText: 'Synthetic roster work' })).toContainText('Outcome unknown')
  expect(fake.backgroundTaskStopRequests()).toEqual([
    { conversation_id: SEEDED_ROW.id, task_id: 'terminal' },
    { conversation_id: SEEDED_ROW.id, task_id: 'omitted' },
    { conversation_id: SEEDED_ROW.id, task_id: 'refused' }
  ])
  expect(requests.filter(request => request.type === 'request_history')).toHaveLength(0)
  await page.screenshot({ path: '/tmp/builder-2283/stop-outcomes-1280.png', animations: 'disabled' })
})
