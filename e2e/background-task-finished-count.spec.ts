import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { createCanonicalThread } from './fixtures/canonicalThread'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { Envelope } from '../src/shared/wire/types'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

// Every authored field is synthetic. Membership, activity and outcomes are explicit daemon facts.
const session = 'finished-count-session'
const route = { conversation_id: SEEDED_ROW.id, epoch: 'finished-count-epoch' }
const frame = (update: ThreadUpdate): Uint8Array =>
  encodeEnvelope({ id: 1561, ts: '2026-09-23T09:00:00Z', ...update })
const task = (id: number, task_id: string, description: string) => ({
  id, order: id * 10, rev: 1, kind: 'tool_call', status: 'running', active: true, shown: true,
  session, agent: 'claude', summary: description,
  content: { name: 'Bash', tool_use_id: `call-${id}`, task_id, input_summary: description,
    task_link: { task_id, tool_call_id: `call-${id}`, description } }
} satisfies ThreadItem)

// Mutually non-substring, because the panel assertions pair `toContainText` across both.
const FIRST = 'first synthetic background task'
const SECOND = 'second synthetic background job'

const panelFor = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Background tasks', exact: true })

test('a terminal status takes a listed task out of the pill count but not out of the panel', async ({
  launchPairedApp
}) => {
  const requests: Envelope[] = []
  const first = task(1, 'task-first', FIRST), second = task(2, 'task-second', SECOND)
  const thread = createCanonicalThread({ conversations: [{
    summary: { ...SEEDED_ROW, current_session_id: session, agent: 'claude' },
    epoch: route.epoch, version: 1, items: [first, second]
  }] })
  const { page, daemon } = await launchPairedApp({ threadMode: 'canonical', thread,
    helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
      requests.push(decodeEnvelope(bytes)); return []
    }
  })
  await page.setViewportSize({ width: 1280, height: 800 })

  // Canonical opening facts must already supply both tasks before any pushed update.
  const pill = page.locator('.composer-status__tasks')
  await expect(pill).toHaveText('2 tasks running')
  await pill.click()
  const panel = panelFor(page)
  const firstRow = panel.locator('.background-task-panel__row').filter({ hasText: FIRST })
  const secondRow = panel.locator('.background-task-panel__row').filter({ hasText: SECOND })
  await expect(firstRow).toBeVisible()
  await expect(secondRow).toBeVisible()
  expect(requests.find(request => request.type === 'thread_catch_up')?.payload).toMatchObject({
    conversation_id: SEEDED_ROW.id, version: 0
  })

  daemon.pushFrame(frame({ type: 'thread_item_changed', payload: { ...route, version: 2,
    item_id: first.id, base_rev: 1, rev: 2, changes: { status: 'finished', active: false } } }))
  await expect(firstRow.getByText('Completed', { exact: true })).toBeVisible()
  await expect(pill).toHaveText('1 task running')

  // Positive rendered markers prove each intermediate revision applied before its unchanged count.
  const patch = '{"is_backgrounded":true}'
  daemon.pushFrame(frame({ type: 'thread_item_changed', payload: { ...route, version: 3,
    item_id: second.id, base_rev: 1, rev: 2, changes: { status: 'running', active: true,
      content: { ...second.content, task_update: { patch } } } } }))
  await expect(secondRow).toContainText(patch)
  await expect(pill).toHaveText('1 task running')
  const refresh = 'synthetic settled task refreshed'
  daemon.pushFrame(frame({ type: 'thread_item_changed', payload: { ...route, version: 4,
    item_id: first.id, base_rev: 2, rev: 3, changes: { status: 'finished', active: false,
      content: { ...first.content, task_report: { summary: refresh } } } } }))
  await expect(firstRow).toContainText(refresh)
  await expect(firstRow.getByText('Completed', { exact: true })).toBeVisible()
  await expect(pill).toHaveText('1 task running')

  // The final ordered barrier detects a refreshed first task wrongly returning to the running count.
  daemon.pushFrame(frame({ type: 'thread_item_changed', payload: { ...route, version: 5,
    item_id: second.id, base_rev: 2, rev: 3, changes: { status: 'stopped', active: false } } }))
  await expect(secondRow.getByText('Stopped', { exact: true })).toBeVisible()
  await expect(pill).toHaveCount(0)

  // Retained shown facts remain reachable through the fixed opener after the pill disappears.
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Background tasks', exact: true }).click()
  await expect(panel).toBeVisible()
  await expect(panel.locator('.background-task-panel__row')).toHaveCount(2)
  await expect(panel.locator('.background-task-panel__group-header')).toHaveText(['Finished · 2'])
  await expect(panel.locator('.background-task-panel__row--finished')).toHaveCount(2)
  await expect(panel).toContainText(FIRST)
  await expect(panel).toContainText(SECOND)
  await expect(firstRow.getByText('Completed', { exact: true })).toBeVisible()
  await expect(secondRow.getByText('Stopped', { exact: true })).toBeVisible()
  expect(requests.some(request => request.type === 'request_history')).toBe(false)
})
