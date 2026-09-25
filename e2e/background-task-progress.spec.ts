import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { BackgroundTask, ConversationSummary, EnvelopeType } from '../src/shared/wire/types'

// #1640: a running background task shows what it is doing and how far it has got. The store and panel
// unit tests prove the join, the formatting and the escaping; this spec is the proof that a
// `background_task_progress` frame survives the whole path — the real transport's decode (#1638), the
// fourth translator, the store record and the container's read — into the open panel's running row.
//
// SECRET HYGIENE (the sibling specs' rule): every task field below is a CLIENT-OWNED SYNTHETIC LITERAL,
// so a failure diff discloses nothing. The helpers mirror background-task-status-summary.spec.ts rather
// than importing from it, as the sibling specs do.

const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number): Uint8Array =>
  encodeEnvelope({ id: 1640, type, ts: '2026-09-25T10:00:00Z', payload, in_reply_to })

const roster = (conversation_id: string, tasks: BackgroundTask[]): Uint8Array =>
  frame('background_task_roster', { conversation_id, tasks, dropped_tasks: 0 })

const task = (task_id: string, description: string): BackgroundTask => ({
  task_id,
  task_type: 'local_bash',
  description,
  truncated_fields: null
})

/** The progress frame in wire shape: `description` is the task's CURRENT ACTIVITY on this frame. */
const progress = (
  conversation_id: string,
  task_id: string,
  description: string,
  counters: { last_tool_name: string; tool_uses: number; total_tokens: number; duration_ms: number }
): Uint8Array =>
  frame('background_task_progress', {
    conversation_id,
    task_id,
    description,
    subagent_type: '',
    ...counters,
    truncated_fields: null
  })

const BUILD = 'synthetic build command'
const FIRST_ACTIVITY = 'synthetic activity reading alpha'
const LATER_ACTIVITY = 'synthetic activity writing beta'

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

test('a progress frame for a listed running task draws its activity and meta line in the open panel', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake([SEEDED_ROW]) })
  await page.setViewportSize({ width: 1280, height: 800 })

  daemon.pushFrame(roster(SEEDED_ROW.id, [task('task-build', BUILD)]))
  await expect(page.locator('.composer-status__tasks')).toHaveText('1 task running')

  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Background tasks', exact: true }).click()
  const panel = panelFor(page)
  await expect(panel).toBeVisible()
  const row = panel.locator('.background-task-panel__row', { hasText: BUILD })
  await expect(row).toBeVisible()
  await expect(row.locator('.background-task-panel__progress')).toHaveCount(0)

  // The open panel re-renders from the store as the report lands.
  daemon.pushFrame(
    progress(SEEDED_ROW.id, 'task-build', FIRST_ACTIVITY, {
      last_tool_name: 'Bash',
      tool_uses: 4,
      total_tokens: 18000,
      duration_ms: 161000
    })
  )
  await expect(row.locator('.background-task-panel__activity')).toHaveText(FIRST_ACTIVITY)
  await expect(row.locator('.background-task-panel__progress-meta')).toHaveText(
    'Bash · 4 tools · 18k tokens · 2m 41s'
  )

  // A newer report replaces the older one rather than adding a second block.
  daemon.pushFrame(
    progress(SEEDED_ROW.id, 'task-build', LATER_ACTIVITY, {
      last_tool_name: '',
      tool_uses: 1,
      total_tokens: 850,
      duration_ms: 41000
    })
  )
  await expect(row.locator('.background-task-panel__activity')).toHaveText(LATER_ACTIVITY)
  await expect(row.locator('.background-task-panel__progress-meta')).toHaveText('1 tool · 850 tokens · 41s')
  await expect(row.locator('.background-task-panel__progress')).toHaveCount(1)
})
