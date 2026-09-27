import { mkdir } from 'node:fs/promises'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { MemorySearchPayload, SessionSettingsPayload } from '../src/shared/wire/types'

const available: MemorySearchPayload = { availability: 'available', providers: [
  { id: 'local', display_name: 'Local index', installed: true, enabled: true, availability: 'available' },
  { id: 'paused', display_name: 'Paused index', installed: true, enabled: false, availability: 'unavailable' }
] }
const absent: MemorySearchPayload = { availability: 'absent', providers: [] }

test('Channel info refreshes the active conversation memory search report on each open', async ({ launchPairedApp }) => {
  const fake = conversationStateFake({ conversations: [SEEDED_ROW] })
  let report = available
  const requests: string[] = []
  const { page } = await launchPairedApp({
    buildReplyFrames: bytes => {
      const request = decodeEnvelope(bytes)
      if (request.type !== 'request_session_settings') return fake(bytes)
      const conversationId = (request.payload as { conversation_id: string }).conversation_id
      requests.push(conversationId)
      return [encodeEnvelope({
        id: 1, type: 'session_settings', ts: '2026-07-07T12:00:00.000Z', in_reply_to: request.id,
        payload: {
          session_id: 'memory-session', model: '', effort: '', yolo: false,
          permission_mode: 'default', used_tokens: 0, window_tokens: 0,
          memory_search: report
        } satisfies SessionSettingsPayload
      })]
    }
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  const open = async () => {
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Channel info', exact: true }).click()
  }
  const sheet = page.getByRole('dialog')
  const initialRequests = requests.length
  await open()
  await expect(sheet.getByText('Memory search available', { exact: true })).toBeVisible()
  await expect(sheet.getByText('Local index', { exact: true })).toBeVisible()
  await expect(sheet.getByText('Paused index', { exact: true })).toBeVisible()
  await expect(sheet.getByText('Installed, disabled', { exact: true })).toBeVisible()
  await expect.poll(() => requests.length).toBe(initialRequests + 1)
  expect(requests.at(-1)).toBe(SEEDED_ROW.id)
  await mkdir('/tmp/builder-1687-visual', { recursive: true })
  await page.screenshot({ path: '/tmp/builder-1687-visual/available-1280x800.png', animations: 'disabled' })
  await page.setViewportSize({ width: 800, height: 800 })
  await expect(sheet.getByText('Installed, disabled', { exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/builder-1687-visual/available-800x800.png', animations: 'disabled' })

  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  report = absent
  const beforeReopen = requests.length
  await open()
  await expect.poll(() => requests.length).toBe(beforeReopen + 1)
  await expect(sheet.getByText('No memory-search provider detected', { exact: true })).toBeVisible()
  await expect(sheet.getByText('Local index', { exact: true })).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: /install/i })).toHaveCount(0)
})
