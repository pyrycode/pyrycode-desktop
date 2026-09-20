import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, EnvelopeType, SetSessionSettingsPayload } from '../src/shared/wire/types'

const SESSION = 'session-1544'
const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number): Uint8Array =>
  encodeEnvelope({ id: 1, type, ts: '2026-09-20T00:00:00Z', payload, in_reply_to })

test('permission footer follows confirmation through held writes, reads and session boundaries', async ({ launchPairedApp }, testInfo) => {
  const captured: Envelope[] = []
  let held = false
  let mode = 'bypassPermissions'
  let session = SESSION
  const reading = (id: number, permission_mode = mode, session_id = session) => frame('session_settings', {
    session_id, model: 'seed-model', effort: '', yolo: false, permission_mode,
    used_tokens: 50_000, window_tokens: 200_000
  }, id)
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes)
    captured.push(request)
    if (request.type === 'list_conversations') return [seedConversationsFrame()]
    if (request.type === 'request_session_settings' && !held) return [reading(request.id)]
    return []
  } })
  const requests = () => captured.filter(e => e.type === 'request_session_settings')
  const writes = () => captured.filter(e => e.type === 'set_session_settings')
  const label = page.locator('.composer__permission-label')
  const panel = page.getByRole('menu', { name: 'Permission mode', exact: true })
  const pick = async (name: string) => {
    await page.locator('.composer__permission').click()
    await panel.getByRole('menuitem', { name, exact: true }).click()
    await expect(panel).toBeHidden()
  }
  const nextRead = async (before: number) => {
    await expect.poll(() => requests().length).toBeGreaterThan(before)
    return requests().at(-1)!.id
  }
  const refresh = async () => {
    const before = requests().length
    await page.locator('.channel-list__row-open[aria-current="true"]').click()
    return nextRead(before)
  }
  await expect(label).toHaveText('Bypass approvals')
  await page.locator('.composer__permission').click()
  await expect(panel.getByRole('menuitem')).toHaveText([
    'Manual approval', 'Auto-approve edits', 'Plan', 'Auto approval', 'Approved actions only'
  ])
  await expect(panel.locator('[aria-current="true"]')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('permission-menu-1100.png'), animations: 'disabled' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600))
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(800)
  const box = await panel.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(800)
  for (const item of await panel.getByRole('menuitem').all()) {
    expect(await item.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
  await page.screenshot({ path: testInfo.outputPath('permission-menu-800.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')

  held = true
  await pick('Manual approval')
  await expect.poll(() => writes().length).toBe(1)
  expect(isDeepStrictEqual(writes()[0].payload, { session_id: SESSION, permission_mode: 'default' })).toBe(true)
  await expect(label).toHaveText('Bypass approvals')
  const beforeAck = requests().length
  daemon.pushFrame(frame('session_settings_updated', { session_id: SESSION }, writes()[0].id))
  daemon.pushFrame(reading(await nextRead(beforeAck)))
  await expect(label).toHaveText('Bypass approvals')
  // An old-mode reply does not exhaust the confirmation refresh. Hold its successor.
  const retry = await nextRead(beforeAck + 1)
  await expect(label).toHaveText('Bypass approvals')
  daemon.pushFrame(reading(retry))

  await pick('Plan')
  await expect.poll(() => writes().length).toBe(2)
  expect(writes()[1].payload).toEqual({ session_id: SESSION, permission_mode: 'plan' } satisfies SetSessionSettingsPayload)
  await expect(label).toHaveText('Bypass approvals')
  const beforePlan = requests().length
  daemon.pushFrame(frame('session_settings_updated', { session_id: SESSION }, writes()[1].id))
  const planRead = await nextRead(beforePlan)
  await expect(label).toHaveText('Bypass approvals')
  mode = 'plan'
  daemon.pushFrame(reading(planRead))
  await expect(label).toHaveText('Plan')
  await page.locator('.composer__permission').click()
  await expect(panel.locator('[aria-current="true"]')).toHaveText('Plan')
  await panel.getByRole('menuitem', { name: 'Approved actions only', exact: true }).click()
  await expect.poll(() => writes().length).toBe(3)
  await expect(label).toHaveText('Plan')
  const beforeReject = requests().length
  daemon.pushFrame(frame('error', {}, writes()[2].id))
  daemon.pushFrame(reading(await nextRead(beforeReject)))
  await expect(label).toHaveText('Plan')
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)

  // Empty confirmation is unavailable even with a real session and yolo:false.
  daemon.pushFrame(reading(await refresh(), ''))
  await expect(label).toHaveCount(0)
  daemon.pushFrame(reading(await refresh()))
  await expect(label).toHaveText('Plan')
  const oldRead = await refresh()
  daemon.pushFrame(frame('resetting', { conversation_id: SEEDED_ROW.id, active: true, phase: 'restarting', handoff: 'skipped' }))
  await expect(label).toHaveCount(0)
  daemon.pushFrame(reading(oldRead, 'default'))
  await expect(label).toHaveCount(0)
  const beforeReset = requests().length
  daemon.pushFrame(frame('resetting', { conversation_id: SEEDED_ROW.id, active: false, phase: '', handoff: '' }))
  const resetRead = await nextRead(beforeReset)
  session = 'replacement'
  daemon.pushFrame(frame('session_transition', { conversation_id: SEEDED_ROW.id, previous_session_id: SESSION,
    new_session_id: session, reason: 'clear', occurred_at: '2026-09-20T00:00:00Z', workspace_cwd: null }))
  const replacementRead = await nextRead(beforeReset + 1)
  daemon.pushFrame(reading(resetRead, 'default', SESSION))
  await expect(label).toHaveCount(0)
  daemon.pushFrame(reading(replacementRead, 'bypassPermissions'))
  await expect(label).toHaveText('Bypass approvals')

  // A held reply for the departed chat cannot populate the newly opened chat.
  const departingRead = await refresh()
  const other = { ...SEEDED_ROW, id: 'other-chat', name: 'Other chat' }
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, other] }))
  await page.getByRole('button', { name: other.name, exact: true }).click()
  const otherRead = await nextRead(requests().findIndex(e => e.id === departingRead) + 1)
  daemon.pushFrame(reading(departingRead, 'default'))
  await expect(label).toHaveCount(0)
  daemon.pushFrame(reading(otherRead, 'plan', 'other-session'))
  await expect(label).toHaveText('Plan')
})
