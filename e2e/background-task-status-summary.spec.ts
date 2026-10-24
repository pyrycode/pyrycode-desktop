import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { createCanonicalThread } from './fixtures/canonicalThread'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { Envelope } from '../src/shared/wire/types'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

// Saved daemon facts own the task lifecycle, descriptions, summaries and drawer membership.
// Every task field is a client-owned synthetic literal, so failure diffs disclose nothing.
const SESSION = 'synthetic-task-session'
const route = { conversation_id: SEEDED_ROW.id, epoch: 'synthetic-task-epoch' }
const frame = (update: ThreadUpdate): Uint8Array =>
  encodeEnvelope({ id: 2272, ts: '2026-10-24T00:00:00Z', ...update })

const content = (task_id: string, description: string, summary?: string) => ({
  name: 'Bash', tool_use_id: `tool-${task_id}`, task_id, input_summary: description,
  task_link: { task_id, tool_call_id: `tool-${task_id}`, description },
  ...(summary === undefined ? {} : { task_report: { summary, patch: '' } })
})
const task = (id: number, task_id: string, description: string): ThreadItem => ({
  id, order: id * 10, rev: 1, kind: 'tool_call', status: 'running', active: true, shown: true,
  summary: description, content: content(task_id, description), session: SESSION, agent: 'claude'
})

// The first four are mutually non-substring, because the row locators filter on `hasText`.
const BUILD = 'synthetic build command'
const RELAY = 'synthetic relay container'
const BUILD_SUMMARY = 'synthetic build finished cleanly'
const RELAY_SUMMARY = 'synthetic relay exited with code one'
// The build task's saved description after an authoritative refresh.
const RELISTED = 'synthetic build command, relisted'

const panelFor = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Background tasks', exact: true })

test('a completed and a failed task move to Finished with their own tags and summaries', async ({
  launchPairedApp
}) => {
  const requests: Envelope[] = []
  const thread = createCanonicalThread({ conversations: [{
    summary: { ...SEEDED_ROW, current_session_id: SESSION }, epoch: route.epoch, version: 1,
    items: [task(1, 'task-build', BUILD), task(2, 'task-relay', RELAY)]
  }] })
  const { page, daemon } = await launchPairedApp({ threadMode: 'canonical', thread,
    helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
      requests.push(decodeEnvelope(bytes))
      return []
    }
  })
  await page.setViewportSize({ width: 1280, height: 800 })

  const pill = page.locator('.composer-status__tasks')
  await expect(pill).toHaveText('2 tasks running')

  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Background tasks', exact: true }).click()
  const panel = panelFor(page)
  await expect(panel).toBeVisible()
  await expect(panel.locator('.background-task-panel__group-header')).toHaveText(['Running · 2'])
  await expect(panel.locator('.background-task-panel__tag--running')).toHaveCount(2)
  await expect(panel.locator('.background-task-panel__summary')).toHaveCount(0)
  await expect(panel).toContainText(BUILD)
  await expect(panel).toContainText(RELAY)
  expect(requests.find(r => r.type === 'thread_catch_up')?.payload).toMatchObject({
    conversation_id: SEEDED_ROW.id, version: 0
  })

  // Terminal facts retain item/task identity and carry their distinct saved reports.
  daemon.pushFrame(frame({ type: 'thread_item_changed', payload: { ...route, version: 2,
    item_id: 1, base_rev: 1, rev: 2, changes: { status: 'finished', active: false,
      content: content('task-build', BUILD, BUILD_SUMMARY) } } }))
  daemon.pushFrame(frame({ type: 'thread_item_changed', payload: { ...route, version: 3,
    item_id: 2, base_rev: 1, rev: 2, changes: { status: 'failed', active: false,
      content: content('task-relay', RELAY, RELAY_SUMMARY) } } }))
  await expect(panel.locator('.background-task-panel__group-header')).toHaveText(['Finished · 2'])

  const build = panel.locator('.background-task-panel__row', { hasText: BUILD })
  await expect(build.locator('.background-task-panel__tag--completed')).toHaveText('Completed')
  await expect(build.locator('.background-task-panel__summary')).toHaveText(BUILD_SUMMARY)

  const relay = panel.locator('.background-task-panel__row', { hasText: RELAY })
  await expect(relay.locator('.background-task-panel__tag--failed')).toHaveText('Failed')
  await expect(relay.locator('.background-task-panel__summary')).toHaveText(RELAY_SUMMARY)

  // The refreshed description proves this revision was applied before retained facts are checked.
  daemon.pushFrame(frame({ type: 'thread_item_changed', payload: { ...route, version: 4,
    item_id: 1, base_rev: 2, rev: 3, changes: { status: 'finished', active: false,
      content: content('task-build', RELISTED, BUILD_SUMMARY) } } }))
  await expect(panel).toContainText(RELISTED)
  await expect(panel.locator('.background-task-panel__row')).toHaveCount(2)
  await expect(pill).toHaveCount(0)
  await expect(panel.locator('.background-task-panel__tag--completed')).toHaveCount(1)
  await expect(panel.locator('.background-task-panel__tag--failed')).toHaveCount(1)
  await expect(panel.locator('.background-task-panel__summary')).toHaveText([BUILD_SUMMARY, RELAY_SUMMARY])

  // Membership is authoritative: hiding one item removes only that task's drawer row.
  daemon.pushFrame(frame({ type: 'thread_item_changed', payload: { ...route, version: 5,
    item_id: 2, base_rev: 2, rev: 3, changes: { shown: false } } }))
  await expect(panel.locator('.background-task-panel__group-header')).toHaveText(['Finished · 1'])
  await expect(relay).toHaveCount(0)
  await expect(panel.locator('.background-task-panel__row')).toHaveCount(1)
  await expect(build).toContainText(RELISTED)
  await expect(build.locator('.background-task-panel__tag--completed')).toHaveText('Completed')
  await expect(build.locator('.background-task-panel__summary')).toHaveText(BUILD_SUMMARY)
  await expect(pill).toHaveCount(0)
  expect(requests.some(r => r.type === 'request_history')).toBe(false)
})
