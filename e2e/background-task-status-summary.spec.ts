import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { BackgroundTask, ConversationSummary, EnvelopeType } from '../src/shared/wire/types'

// #1639: a finished background task's tag names how it ended and its row shows the summary claude sent
// with the terminal status. The store and panel unit tests prove the mapping and the escaping; this spec
// is the proof that `status` and `summary` survive the whole path — the real transport, the translator
// that now copies `summary`, the store record and the container's read — into the drawn rows.
//
// SECRET HYGIENE (the sibling specs' rule): every task field and summary below is a CLIENT-OWNED
// SYNTHETIC LITERAL, so a failure diff discloses nothing. The helpers mirror
// background-task-finished-count.spec.ts rather than importing from it, as the sibling specs do.

const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number): Uint8Array =>
  encodeEnvelope({ id: 1639, type, ts: '2026-09-25T09:00:00Z', payload, in_reply_to })

const roster = (conversation_id: string, tasks: BackgroundTask[]): Uint8Array =>
  frame('background_task_roster', { conversation_id, tasks, dropped_tasks: 0 })

const task = (task_id: string, description: string): BackgroundTask => ({
  task_id,
  task_type: 'local_bash',
  description,
  truncated_fields: null
})

/** The terminal half of the family's update: `status` and `summary` set, `patch` empty. */
const finished = (conversation_id: string, task_id: string, status: string, summary: string): Uint8Array =>
  frame('background_task_updated', {
    conversation_id,
    task_id,
    patch: '',
    status,
    summary,
    truncated_fields: null
  })

// The first four are mutually non-substring, because the row locators filter on `hasText`.
const BUILD = 'synthetic build command'
const RELAY = 'synthetic relay container'
const BUILD_SUMMARY = 'synthetic build finished cleanly'
const RELAY_SUMMARY = 'synthetic relay exited with code one'
// The build task's label as a later roster reports it.
const RELISTED = 'synthetic build command, relisted'

/** Answers the list and history requests the drive provokes (the sibling spec's `fake`). */
function fake(rows: ConversationSummary[]) {
  return (bytes: Uint8Array): Uint8Array[] => {
    const env = decodeEnvelope(bytes)
    if (env.type === 'list_conversations') return [frame('conversations', { conversations: rows })]
    if (env.type === 'request_history') {
      return [frame('history_page', { entries: [], cursor: '', at_start: true }, env.id)]
    }
    return []
  }
}

const panelFor = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Background tasks', exact: true })

test('a completed and a failed task move to Finished with their own tags and summaries', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake([SEEDED_ROW]) })
  await page.setViewportSize({ width: 1280, height: 800 })

  daemon.pushFrame(roster(SEEDED_ROW.id, [task('task-build', BUILD), task('task-relay', RELAY)]))
  const pill = page.locator('.composer-status__tasks')
  await expect(pill).toHaveText('2 tasks running')

  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Background tasks', exact: true }).click()
  const panel = panelFor(page)
  await expect(panel).toBeVisible()
  await expect(panel.locator('.background-task-panel__group-header')).toHaveText(['Running · 2'])
  await expect(panel.locator('.background-task-panel__tag--running')).toHaveCount(2)
  await expect(panel.locator('.background-task-panel__summary')).toHaveCount(0)

  // The open panel re-renders from the store as each terminal frame lands.
  daemon.pushFrame(finished(SEEDED_ROW.id, 'task-build', 'completed', BUILD_SUMMARY))
  daemon.pushFrame(finished(SEEDED_ROW.id, 'task-relay', 'failed', RELAY_SUMMARY))
  await expect(panel.locator('.background-task-panel__group-header')).toHaveText(['Finished · 2'])

  const build = panel.locator('.background-task-panel__row', { hasText: BUILD })
  await expect(build.locator('.background-task-panel__tag--completed')).toHaveText('Completed')
  await expect(build.locator('.background-task-panel__summary')).toHaveText(BUILD_SUMMARY)

  const relay = panel.locator('.background-task-panel__row', { hasText: RELAY })
  await expect(relay.locator('.background-task-panel__tag--failed')).toHaveText('Failed')
  await expect(relay.locator('.background-task-panel__summary')).toHaveText(RELAY_SUMMARY)

  // A roster that still lists both keeps the words and the summaries (the rebuild carries them). Its
  // refreshed label is what proves the roster was APPLIED before the tags are read again.
  daemon.pushFrame(roster(SEEDED_ROW.id, [task('task-build', RELISTED), task('task-relay', RELAY)]))
  await expect(panel).toContainText(RELISTED)
  await expect(pill).toHaveCount(0)
  await expect(panel.locator('.background-task-panel__tag--completed')).toHaveCount(1)
  await expect(panel.locator('.background-task-panel__tag--failed')).toHaveCount(1)
  await expect(panel.locator('.background-task-panel__summary')).toHaveText([BUILD_SUMMARY, RELAY_SUMMARY])
})
