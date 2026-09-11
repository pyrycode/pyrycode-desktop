import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { SessionFactsPayload } from '../src/shared/wire/types'

const second = { ...SEEDED_ROW, id: 'facts-second', name: 'Second facts chat' }
const frame = (type: string, payload: unknown) =>
  encodeEnvelope({ id: 1, type, ts: '2026-09-11T12:00:00Z', payload })

test('Session retains closed-sheet facts, updates live and isolates conversations', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] })
  })
  const pushFacts = (payload: SessionFactsPayload) => daemon.pushFrame(frame('session_facts', payload))
  pushFacts({
    conversation_id: SEEDED_ROW.id, claude_code_version: 'preview-alpha',
    permission_mode: 'futureAlpha', truncated_fields: null
  })
  pushFacts({
    conversation_id: second.id, claude_code_version: 'preview-beta',
    permission_mode: 'futureBeta', truncated_fields: ['permission_mode']
  })
  // The later list frame is an observable delivery barrier while the sheet is closed.
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, second] }))
  await expect(page.locator('.channel-list__row-open').filter({ hasText: second.name })).toBeVisible()
  const open = async () => {
    await page.locator('.conversation__overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Channel info' }).click()
  }
  await open()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('preview-alpha', { exact: true })).toBeVisible()
  await expect(sheet.getByText('futureAlpha', { exact: true })).toBeVisible()
  await expect(sheet.getByText('futureBeta', { exact: true })).toHaveCount(0)

  pushFacts({
    conversation_id: SEEDED_ROW.id, claude_code_version: 'nightly <preview>',
    permission_mode: '', truncated_fields: ['claude_code_version']
  })
  await expect(sheet.getByText('nightly <preview>', { exact: true })).toBeVisible()
  await expect(sheet.getByText('Not reported', { exact: true })).toBeVisible()
  await expect(sheet.getByText('Truncated', { exact: true })).toBeVisible()
  await expect(sheet.getByText('futureAlpha', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: '/tmp/1241-session-facts.png' })
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()

  await page.locator('.channel-list__row-open').filter({ hasText: second.name }).click()
  await open()
  await expect(sheet.getByText('preview-beta', { exact: true })).toBeVisible()
  await expect(sheet.getByText('futureBeta', { exact: true })).toBeVisible()
  await expect(sheet.getByText('Truncated', { exact: true })).toBeVisible()
  await expect(sheet.getByText('nightly <preview>', { exact: true })).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await page.locator('.channel-list__row-open').filter({ hasText: SEEDED_ROW.name ?? '' }).click()
  await open()
  await expect(sheet.getByText('nightly <preview>', { exact: true })).toBeVisible()
  await expect(sheet.getByText('futureBeta', { exact: true })).toHaveCount(0)
})
