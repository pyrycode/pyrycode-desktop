import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { createCanonicalThread } from './fixtures/canonicalThread'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, Envelope, EnvelopeType } from '../src/shared/wire/types'
import type { ThreadItem } from '../src/shared/wire/thread'

// #1640: a running background task shows what it is doing and how far it has got. The store and panel
// unit tests prove the join, the formatting and the escaping; this spec is the proof that a
// `background_task_progress` frame survives the whole path — the real transport's decode (#1638), the
// session-scoped live reading and the canonical task join — into the open panel's running row.
//
// SECRET HYGIENE (the sibling specs' rule): every task field below is a CLIENT-OWNED SYNTHETIC LITERAL,
// so a failure diff discloses nothing.

const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number, session_id?: string): Uint8Array =>
  encodeEnvelope({ id: 1640, type, ts: '2026-09-25T10:00:00Z', payload, in_reply_to, session_id })

const SESSION = 'progress-seeded-session'
const ROW: ConversationSummary = { ...SEEDED_ROW, current_session_id: SESSION }

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
  }, undefined, SESSION)

const BUILD = 'synthetic build command'
const FIRST_ACTIVITY = 'synthetic activity reading alpha'
const LATER_ACTIVITY = 'synthetic activity writing beta'

/** Observe actual requests; the canonical publisher supplies content and query certificates. */
function capturingFake(captured: Envelope[]) {
  return (bytes: Uint8Array): Uint8Array[] => {
    const env = decodeEnvelope(bytes)
    captured.push(env)
    if (env.type === 'list_conversations') return [frame('conversations', { conversations: [ROW] }, env.id)]
    return []
  }
}

const panelFor = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Background tasks', exact: true })

test('a progress frame for a listed running task draws its activity and meta line in the open panel', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const task: ThreadItem = {
    id: 1, order: 10, rev: 1, kind: 'tool_call', status: 'running', active: true, shown: true,
    summary: BUILD, session: SESSION, agent: 'claude',
    content: { name: 'Bash', task_id: 'task-build', tool_use_id: 'call-task-build',
      task_link: { task_id: 'task-build', tool_call_id: 'call-task-build', description: BUILD } }
  }
  const thread = createCanonicalThread({ conversations: [
    { summary: ROW, epoch: 'progress-seeded-epoch', version: 1, items: [task] }
  ] })
  const { page, daemon } = await launchPairedApp({ threadMode: 'canonical', thread,
    helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: capturingFake(captured) })
  await page.setViewportSize({ width: 1280, height: 800 })

  await expect(page.locator('.composer-status__tasks')).toHaveText('1 task running')

  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Background tasks', exact: true }).click()
  const panel = panelFor(page)
  await expect(panel).toBeVisible()
  const row = panel.locator('.background-task-panel__row', { hasText: BUILD })
  await expect(row).toBeVisible()
  expect(captured).toContainEqual(expect.objectContaining({ type: 'thread_catch_up',
    payload: expect.objectContaining({ conversation_id: SEEDED_ROW.id, version: 0 }) }))
  expect(captured.filter(env => env.type === 'request_history')).toHaveLength(0)
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
