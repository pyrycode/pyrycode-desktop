import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { BackgroundTask, ConversationSummary, EnvelopeType } from '../src/shared/wire/types'

// #1561: the composer's task-count pill counts only the tasks claude has not reported finished. A
// `background_task_updated` whose `status` is `completed` / `failed` / `stopped` takes a listed task out
// of the COUNT at once, without waiting for an emptier roster that nothing guarantees will come, while
// the panel still LISTS it until a roster omits it.
//
// The store's unit tests prove the arithmetic; this spec is the only proof that the pill in
// `ComposerErrorSlotControl` reads `selectLiveTaskCountFor` rather than the roster's size, through the
// real transport and the translator that now carries `status`.
//
// SECRET HYGIENE (the sibling specs' rule): every task field and `summary` below is a CLIENT-OWNED
// SYNTHETIC LITERAL, so a failure diff discloses nothing. The helpers mirror
// background-task-reconnect.spec.ts rather than importing from it, as the sibling specs do.

const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number): Uint8Array =>
  encodeEnvelope({ id: 1561, type, ts: '2026-09-23T09:00:00Z', payload, in_reply_to })

const roster = (conversation_id: string, tasks: BackgroundTask[]): Uint8Array =>
  frame('background_task_roster', { conversation_id, tasks, dropped_tasks: 0 })

const task = (task_id: string, description: string): BackgroundTask => ({
  task_id,
  task_type: 'local_bash',
  description,
  truncated_fields: null
})

/** The terminal half of the family's update (the daemon's `background_task_updated_terminal.json`
 *  shape): `status` and `summary` set, `patch` empty. A mid-life update is the other half: `patch` set,
 *  `status: ''`. */
const updated = (conversation_id: string, task_id: string, status: string, patch = ''): Uint8Array =>
  frame('background_task_updated', {
    conversation_id,
    task_id,
    patch,
    status,
    summary: status === '' ? '' : 'synthetic finished summary',
    truncated_fields: null
  })

// Mutually non-substring, because the panel assertions pair `toContainText` across both.
const FIRST = 'first synthetic background task'
const SECOND = 'second synthetic background job'

/** Answers the list and history requests the drive provokes; an unanswered history request would put a
 *  failure in the composer status slot, which outranks the task pill (see the reconnect spec's `fake`). */
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

test('a terminal status takes a listed task out of the pill count but not out of the panel', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake([SEEDED_ROW]) })
  await page.setViewportSize({ width: 1280, height: 800 })

  daemon.pushFrame(roster(SEEDED_ROW.id, [task('task-first', FIRST), task('task-second', SECOND)]))
  const pill = page.locator('.composer-status__tasks')
  await expect(pill).toHaveText('2 tasks running')

  // AC1: two listed tasks plus a terminal status for one render "1 task running".
  daemon.pushFrame(updated(SEEDED_ROW.id, 'task-first', 'completed'))
  await expect(pill).toHaveText('1 task running')

  // AC2: the `''` every patch-bearing frame carries removes nothing.
  daemon.pushFrame(updated(SEEDED_ROW.id, 'task-second', '', '{"is_backgrounded":true}'))
  // AC3: a later roster listing the finished task again does not return it to the count.
  daemon.pushFrame(roster(SEEDED_ROW.id, [task('task-first', FIRST), task('task-second', SECOND)]))
  await expect(pill).toHaveText('1 task running')

  // AC1: the last live task finishing renders no pill. The frames ride one ordered channel, so this is
  // also what proves the two above were APPLIED rather than merely not yet arrived: had the `''` update
  // removed `task-second`, or the re-listing restored `task-first`, the pill would not end at nothing.
  daemon.pushFrame(updated(SEEDED_ROW.id, 'task-second', 'stopped'))
  await expect(pill).toHaveCount(0)

  // The panel's list is unchanged: both finished tasks stay listed until a roster omits them.
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Background tasks', exact: true }).click()
  const panel = panelFor(page)
  await expect(panel).toBeVisible()
  await expect(panel.locator('.background-task-panel__row')).toHaveCount(2)
  await expect(panel).toContainText(FIRST)
  await expect(panel).toContainText(SECOND)
})
