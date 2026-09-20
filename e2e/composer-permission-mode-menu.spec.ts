import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, EnvelopeType, SetSessionSettingsPayload } from '../src/shared/wire/types'

const SESSION = 'session-1544'
type ProbeWindow = typeof window & { permissionEvents: string[] }
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
  await page.evaluate(() => {
    const probe = window as ProbeWindow
    probe.permissionEvents = []
    window.pyry.onDaemonEvent(event => probe.permissionEvents.push(event.type))
  })
  const received = (type: string) => page.evaluate(type =>
    (window as ProbeWindow).permissionEvents.filter(event => event === type).length, type)
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
  mode = 'default'
  daemon.pushFrame(reading(retry))
  await expect(label).toHaveText('Manual approval')

  await pick('Auto-approve edits')
  await expect.poll(() => writes().length).toBe(2)
  expect(writes()[1].payload).toEqual({ session_id: SESSION, permission_mode: 'acceptEdits' } satisfies SetSessionSettingsPayload)
  await expect(label).toHaveText('Manual approval')
  const beforeEdits = requests().length
  daemon.pushFrame(frame('session_settings_updated', { session_id: SESSION }, writes()[1].id))
  daemon.pushFrame(reading(await nextRead(beforeEdits)))
  const editsRead = await nextRead(beforeEdits + 1)
  await expect(label).toHaveText('Manual approval')
  await page.locator('.composer__permission').click()
  await expect(panel.locator('[aria-current="true"]')).toHaveText('Manual approval')
  await panel.getByRole('menuitem', { name: 'Approved actions only', exact: true }).click()
  await expect.poll(() => writes().length).toBe(3)
  await expect(label).toHaveText('Manual approval')
  const beforeReject = requests().length
  daemon.pushFrame(frame('error', {}, writes()[2].id))
  await expect.poll(() => received('sessionSettingsRejected')).toBe(1)
  expect(requests().length).toBe(beforeReject)
  daemon.pushFrame(reading(editsRead))
  const confirmationRead = await nextRead(beforeReject)
  await expect(label).toHaveText('Manual approval')
  mode = 'acceptEdits'
  daemon.pushFrame(reading(confirmationRead))
  await expect(label).toHaveText('Auto-approve edits')
  await page.locator('.composer__permission').click()
  await expect(panel.locator('[aria-current="true"]')).toHaveText('Auto-approve edits')
  await page.keyboard.press('Escape')
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)

  // Empty confirmation is unavailable even with a real session and yolo:false.
  daemon.pushFrame(reading(await refresh(), ''))
  await expect(label).toHaveCount(0)
  daemon.pushFrame(reading(await refresh()))
  await expect(label).toHaveText('Auto-approve edits')
  const oldRead = await refresh()
  daemon.pushFrame(frame('resetting', { conversation_id: SEEDED_ROW.id, active: true, phase: 'restarting', handoff: 'skipped' }))
  await expect(label).toHaveCount(0)
  daemon.pushFrame(reading(oldRead, 'default'))
  await expect(label).toHaveCount(0)
  const beforeReset = requests().length
  session = 'replacement'
  daemon.pushFrame(frame('session_transition', { conversation_id: SEEDED_ROW.id, previous_session_id: SESSION,
    new_session_id: session, reason: 'clear', occurred_at: '2026-09-20T00:00:00Z', workspace_cwd: null }))
  await expect.poll(() => received('sessionTransition')).toBe(1)
  expect(requests().length).toBe(beforeReset)
  const beforeSuppressed = await received('runConfigReceived')
  daemon.pushFrame(reading(await refresh(), 'default'))
  await expect.poll(() => received('runConfigReceived')).toBe(beforeSuppressed + 1)
  await expect(label).toHaveCount(0)
  const beforeComplete = requests().length
  daemon.pushFrame(frame('resetting', { conversation_id: SEEDED_ROW.id, active: false, phase: '', handoff: '' }))
  const resetRead = await nextRead(beforeComplete)
  daemon.pushFrame(reading(resetRead, 'default', SESSION))
  await expect.poll(() => received('runConfigReceived')).toBe(beforeSuppressed + 2)
  await expect(label).toHaveCount(0)
  daemon.pushFrame(reading(await refresh(), 'bypassPermissions'))
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
