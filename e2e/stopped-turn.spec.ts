import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { EnvelopeType, SendMessagePayload } from '../src/shared/wire/types'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'

const other = { ...SEEDED_ROW, id: 'other-chat', name: 'Other discussion' }
const frame = (type: EnvelopeType, payload: unknown) => encodeEnvelope({ id: 1, type, ts: '2026-09-11T12:00:00Z', payload })
const stop = (terminal_reason: string, extra = {}, conversation_id = SEEDED_ROW.id) => frame('turn_end', {
  conversation_id, turn_id: terminal_reason, stop_reason: 'end_turn', outcome: 'success', is_error: true, terminal_reason, ...extra
})
const commands = (available: boolean) => frame('slash_command_list', {
  conversation_id: SEEDED_ROW.id, dropped_commands: 0,
  commands: (available ? ['compact', 'clear'] : ['clear']).map(name => ({ name, description: '', argument_hint: '', aliases: [], truncated_fields: null }))
})

test('stopped records survive recovery, Compact uses the guarded composer path, and chats stay isolated', async ({ launchPairedApp }) => {
  const sent: SendMessagePayload[] = []
  let includeOther = false
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const message = decodeEnvelope(bytes)
    if (message.type === 'send_message') { sent.push(message.payload as SendMessagePayload); return [] }
    return [frame('conversations', { conversations: includeOther ? [SEEDED_ROW, other] : [SEEDED_ROW] })]
  } })
  includeOther = true
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, other] }))
  const recovery = page.locator('.stopped-turn-recovery')
  const record = page.locator('.stopped-turn')
  const draft = page.locator('textarea.composer__input')
  daemon.pushFrame(stop('max_turns'))
  await expect(record).toHaveText('Stopped: turn limit reached')
  await expect(recovery).toHaveCount(0)
  daemon.pushFrame(stop('prompt_too_long'))
  daemon.pushFrame(frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'idle' }))
  await expect(recovery).toContainText('Context too long.')
  await expect(recovery.getByRole('button', { name: 'Compact', exact: true })).toHaveCSS('padding-top', '8px')
  await expect(record).toHaveCount(2)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600))
  await expect.poll(() => page.locator('.composer-status').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  await page.screenshot({ path: '/tmp/1237-stopped-recovery.png' })
  daemon.pushFrame(commands(false))
  await expect(recovery.getByRole('button', { name: 'Compact', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: /Compact session/ })).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')
  await expect(recovery).toBeVisible()
  expect(sent).toHaveLength(0)
  daemon.pushFrame(commands(true))
  await expect(recovery.getByRole('button', { name: 'Compact', exact: true })).toBeEnabled()
  await draft.fill('Keep this draft')
  await recovery.getByRole('button', { name: 'Compact', exact: true }).click()
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0].text).toBe('/compact')
  expect(sent[0].conversation_id).toBe(SEEDED_ROW.id)
  await expect(draft).toHaveValue('Keep this draft')
  await expect(recovery).toHaveCount(0)
  await expect(record).toHaveCount(2)

  daemon.pushFrame(stop('api_error', { error_category: 'overloaded' }))
  await expect(record.last()).toHaveText('Stopped: API error (Claude reported: overloaded)')
  daemon.pushFrame(stop('api_error', { error_category: 'billing_error' }, other.id))
  await page.locator('.channel-list__row-open').filter({ hasText: other.name }).click()
  await expect(recovery).toHaveText('Claude reported a billing error. Check Claude billing on this server.')
  await expect(record).toHaveCount(1)
  await page.locator('.channel-list__row-open').filter({ hasText: SEEDED_ROW.name }).click()
  await expect(record).toHaveCount(3)
  await expect(recovery).toHaveCount(0)
  daemon.pushFrame(stop('prompt_too_long'))
  await expect(recovery).toBeVisible()
  daemon.pushFrame(frame('assistant_delta', { conversation_id: SEEDED_ROW.id, turn_id: 'new-turn', seq: 0, text: 'New turn activity' }))
  await expect(page.locator('[data-thread-role="assistant"]')).toContainText('New turn activity')
  await expect(recovery).toHaveCount(0)
  await expect(record).toHaveCount(4)
  daemon.pushFrame(stop('x'.repeat(256)))
  await expect(record.last()).toContainText('Stopped: xxx')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600))
  await expect.poll(() => page.locator('.conversation').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  await expect(record.last()).toHaveCSS('white-space', 'nowrap')
  expect(await record.last().evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/1237-stopped-turn.png' })
})

test('connection errors outrank recovery, recovery outranks usage, and trailing idle preserves it', async ({ launchPairedApp }) => {
  const { page, app, daemon } = await launchPairedApp()
  const recovery = page.locator('.stopped-turn-recovery')
  const notice = page.locator('.composer-status__usage')
  daemon.pushFrame(frame('rate_limited', { conversation_id: SEEDED_ROW.id, status: 'rejected', limit_type: 'five_hour', resets_at: 4102444800, truncated_fields: null }))
  await expect(notice).toBeVisible()
  daemon.pushFrame(stop('api_error', { error_category: 'authentication_failed' }))
  await expect(recovery).toHaveText('Claude reported an authentication failure. Check Claude sign-in on this server.')
  await expect(notice).toHaveCount(0)
  daemon.pushFrame(frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'idle' }))
  await expect(recovery).toBeVisible()
  // Inject the typed connection failure at the preload boundary; stop reports above use real decoding.
  await app.evaluate(({ BrowserWindow }, channel) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, {
      type: 'failed', serverId: 'fake-daemon', error: { code: 'transport', message: '', retryable: true }
    })
  }, DAEMON_EVENT_CHANNEL)
  await expect(page.locator('.composer-status__error')).toBeVisible()
  await expect(recovery).toHaveCount(0)
  await expect(notice).toHaveCount(0)
  await expect(page.locator('.stopped-turn')).toHaveCount(1)
  await app.evaluate(({ BrowserWindow }, channel) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, {
      type: 'failed', serverId: 'fake-daemon', error: { code: 'transport', message: '', retryable: false }
    })
  }, DAEMON_EVENT_CHANNEL)
  await expect(page.getByRole('button', { name: /Re-pair/ })).toBeVisible()
})
