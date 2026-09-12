import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, EnvelopeType } from '../src/shared/wire/types'

const other = { ...SEEDED_ROW, id: 'banner-other', name: 'Other banner discussion' }
const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number) => encodeEnvelope({
  id: 913, type, ts: '2026-09-10T09:14:02Z', payload, in_reply_to
})
const banner = (text: string, level = 'warning', stops_turn = true, truncated = false, conversation_id = SEEDED_ROW.id) =>
  frame('banner', { conversation_id, level, text, stops_turn, truncated })
const idle = () => frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'idle' })
function fake(captured: Envelope[], conversations = [SEEDED_ROW]) {
  return (bytes: Uint8Array): Uint8Array[] => {
    const env = decodeEnvelope(bytes)
    captured.push(env)
    if (env.type === 'list_conversations') return [frame('conversations', { conversations })]
    if (env.type === 'request_history') return [frame('history_page', { entries: [], cursor: '', at_start: true }, env.id)]
    return []
  }
}

test('hook reports survive activity, navigation and reconnect; accepted sends clear only the status', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const conversations = [SEEDED_ROW]
  const { page, daemon, forwarder } = await launchPairedApp({
    buildReplyFrames: fake(captured, conversations),
    reconnectResendFrames: [frame('assistant_delta', {
      conversation_id: SEEDED_ROW.id, turn_id: 'reconnect', seq: 1, text: 'Handshake completed again'
    })]
  })
  conversations.push(other)
  daemon.pushFrame(frame('conversations', { conversations }))
  const rows = page.locator('.claude-banner')
  const status = page.locator('.composer-status__banner')
  const draft = page.locator('textarea.composer__input')
  const echoes = page.locator('[data-thread-role="user"]')
  const open = async (name: string) => page.locator('.channel-list__row-open').filter({ hasText: name }).click()
  const hook = 'UserPromptSubmit operation blocked by hook'
  await expect(rows).toHaveCount(0)
  await expect(status).toHaveCount(0)
  daemon.pushFrame(banner(hook))
  await expect(rows).toHaveText([`Claude: ${hook}`])
  await expect(status).toHaveText(`Claude: ${hook}`)
  daemon.pushFrame(idle())
  await draft.fill(' \t ')
  await draft.press('Enter')
  daemon.pushFrame(banner('Non-stopping report', 'notice', false))
  await expect(rows).toHaveCount(2)
  await expect(status).toHaveText(`Claude: ${hook}`)
  await expect(echoes).toHaveCount(0)
  expect(captured.filter(env => env.type === 'send_message')).toHaveLength(0)

  await open(other.name)
  daemon.pushFrame(banner('Hidden info report', 'info', true, false, other.id))
  await expect(status).toHaveText('Claude: Hidden info report')
  await expect(rows).toHaveCount(0)
  daemon.pushFrame(banner('Later hook refusal'))
  await open(SEEDED_ROW.name)
  await expect(rows).toHaveCount(3)
  await expect(status).toHaveText('Claude: Later hook refusal')
  forwarder.dropClientLeg()
  await expect(page.locator('[data-thread-role="assistant"]').last()).toHaveText(/Handshake completed again/, { timeout: 15000 })
  await expect(status).toHaveText('Claude: Later hook refusal')

  for (const [index, text] of ['Accepted typed message', '/cost'].entries()) {
    if (index > 0) {
      daemon.pushFrame(banner('Another hook refusal'))
      await expect(status).toHaveText('Claude: Another hook refusal')
    }
    const before = await rows.count()
    await draft.fill(text)
    await draft.press('Enter')
    await expect(echoes).toHaveCount(index + 1)
    await expect(echoes.last()).toContainText(text)
    await expect.poll(() => captured.filter(env => env.type === 'send_message').length).toBe(index + 1)
    await expect(status).toHaveCount(0)
    await expect(rows).toHaveCount(before)
    daemon.pushFrame(idle())
  }
  await open(other.name)
  await expect(status).toHaveText('Claude: Hidden info report')
})

test('synthetic cost output is inert multiline text with producer-owned truncation at 800px', async ({ launchPairedApp }) => {
  const { app, page, daemon } = await launchPairedApp({ buildReplyFrames: fake([]) })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600))
  const prose = '**/cost**\n\tTotal: $1.23\n<script>not markup</script> https://example.test/' + 'long'.repeat(40)
  daemon.pushFrame(banner('\x1b[33m' + prose + '\x1b[0m\x00', 'notice', false, true))
  const rows = page.locator('.claude-banner')
  await expect(rows).toHaveCount(1)
  expect(await rows.first().textContent()).toBe(`Claude: ${prose}…`)
  await expect(rows.locator('a, script, strong')).toHaveCount(0)
  await expect(rows.first()).not.toHaveAttribute('title')
  await expect(rows.first()).toHaveCSS('white-space', 'pre-wrap')
  await expect(rows.first()).toHaveCSS('text-align', 'left')
  await expect(rows.first()).toHaveCSS('font-size', '12px')
  daemon.pushFrame(banner(prose, 'warning', true, false))
  const status = page.locator('.composer-status__banner')
  await expect(status).toBeVisible()
  expect(await status.textContent()).toBe(`Claude: ${prose}`)
  expect(await rows.nth(1).textContent()).toBe(`Claude: ${prose}`)
  await expect(status.locator('a, script, strong')).toHaveCount(0)
  await expect(rows.nth(1)).toHaveClass(/claude-banner--warning/)
  for (const [element, token] of [[rows.first(), '--color-on-surface-variant'], [rows.nth(1), '--color-warning']] as const) {
    expect(await element.evaluate((el, name) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${name})`
      el.append(probe)
      const matches = getComputedStyle(el).color === getComputedStyle(probe).color
      probe.remove()
      return matches
    }, token)).toBe(true)
  }
  for (const element of [rows.first(), rows.nth(1), status, page.locator('.composer-status')]) {
    expect(await element.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  }
  await page.screenshot({ path: '/tmp/1341-banner-reports.png' })
})
