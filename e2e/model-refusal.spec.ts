import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, EnvelopeType } from '../src/shared/wire/types'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'

const other = { ...SEEDED_ROW, id: 'refusal-other', name: 'Other refusal discussion' }
const original = 'claude-opus-4-1[1m]', fallback = 'claude-sonnet-4-5'
const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number) => encodeEnvelope({
  id: 1, type, ts: '2026-09-11T12:00:00Z', payload, in_reply_to
})
const refusal = (conversation_id = SEEDED_ROW.id, scope = 'session') => ({
  conversation_id, original_model: original, fallback_model: fallback, scope, refusal_category: 'future',
  banner: '<script>Claude refused this request</script>', truncated_fields: null, dropped_fields: null
})
function fake(captured: Envelope[]) {
  return (bytes: Uint8Array): Uint8Array[] => {
    const env = decodeEnvelope(bytes)
    captured.push(env)
    switch (env.type) {
      case 'list_conversations': return [seedConversationsFrame()]
      case 'request_session_settings': return [frame('session_settings', {
        session_id: 'addressable-session', model: 'haiku', effort: 'low', permission_mode: 'default',
        yolo: false, used_tokens: 100, window_tokens: 200000
      }, env.id)]
      case 'request_history': return [frame('history_page', { entries: [], cursor: '', at_start: true }, env.id)]
      default: return []
    }
  }
}
const writes = (captured: Envelope[]) => captured.filter(env => env.type === 'set_session_settings')

test('session fallback discloses Claude text, keeps the draft, rejects then confirms Switch back', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: fake(captured) })
  const rows = page.locator('.model-refusal'), action = page.getByRole('button', { name: 'Switch back', exact: true })
  const label = page.locator('.composer__model-label'), draft = page.locator('textarea.composer__input')
  await expect(label).toHaveText('Haiku')
  daemon.pushFrame(frame('model_refusal_fallback', refusal()))
  await expect(rows).toHaveText(`Refused on ${original}, continued on ${fallback}`)
  await expect(label).toHaveText('Haiku')
  await expect(action).toBeEnabled()
  const disclosure = rows.getByRole('button')
  await disclosure.focus()
  await page.keyboard.press('Enter')
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  await expect(rows.locator('.model-refusal__body')).toHaveText('Claude: <script>Claude refused this request</script>')
  await expect(rows.locator('script')).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(rows.locator('.model-refusal__body')).toHaveCount(0)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600))
  await expect(rows.locator('.model-refusal__title')).toHaveCSS('white-space', 'nowrap')
  await expect.poll(() => page.locator('.conversation').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  await expect(rows.locator('.model-refusal__title')).toHaveCSS('font-size', '12px')
  await expect(rows.locator('.model-refusal__title')).toHaveCSS('font-family', await page.locator('.conversation').evaluate(el => getComputedStyle(el).fontFamily))
  await page.screenshot({ path: '/tmp/1242-refusal-collapsed.png' })
  daemon.pushFrame(frame('model_announced', { conversation_id: SEEDED_ROW.id, model: fallback, truncated: false }))
  await expect(label).toHaveText('Sonnet')
  daemon.pushFrame(frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'thinking' }))
  daemon.pushFrame(frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'idle' }))
  await expect(action).toBeEnabled()
  await draft.fill('Preserve this draft')
  await action.click()
  await expect.poll(() => writes(captured).length).toBe(1)
  expect(writes(captured)[0].payload).toEqual({ session_id: 'addressable-session', model: original })
  await expect(action).toBeDisabled()
  await expect(draft).toHaveValue('Preserve this draft')
  daemon.pushFrame(frame('error', {}, writes(captured)[0].id))
  await expect(action).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveText('Could not change the model — try again.')
  await expect(label).toHaveText('Sonnet')
  await expect(rows).toHaveCount(1)
  await page.screenshot({ path: '/tmp/1242-refusal-rejected.png' })
  await action.click()
  await expect.poll(() => writes(captured).length).toBe(2)
  daemon.pushFrame(frame('session_settings_updated', { session_id: 'addressable-session' }, writes(captured)[1].id))
  await expect(label).toHaveText('Opus')
  await expect(action).toHaveCount(0)
  await expect(rows).toHaveCount(1)
  await expect(draft).toHaveValue('Preserve this draft')
  expect(captured.filter(env => env.type === 'send_message')).toHaveLength(0)
})

test('local/no fallback, conversations, superseding swaps, manual picks and later model/session changes', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake(captured) })
  const rows = page.locator('.model-refusal'), action = page.getByRole('button', { name: 'Switch back', exact: true })
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, other] }))
  daemon.pushFrame(frame('model_refusal_fallback', refusal(other.id)))
  daemon.pushFrame(frame('model_refusal_fallback', refusal(SEEDED_ROW.id, 'local')))
  daemon.pushFrame(frame('model_refusal_no_fallback', {
    conversation_id: SEEDED_ROW.id, original_model: '', refusal_category: '', banner: '', truncated_fields: [], dropped_fields: null
  }))
  await expect(rows).toHaveCount(2)
  await expect(rows.last()).toHaveText('Refused by unknown model')
  await expect(rows.last().getByRole('button')).toHaveCount(0)
  await expect(action).toHaveCount(0)
  await page.locator('.channel-list__row-open').filter({ hasText: other.name }).click()
  await expect(rows).toHaveCount(1)
  await expect(action).toBeEnabled()
  await action.click()
  await expect.poll(() => writes(captured).length).toBe(1)
  daemon.pushFrame(frame('model_refusal_fallback', { ...refusal(other.id), original_model: 'haiku' }))
  await expect(rows).toHaveCount(2)
  daemon.pushFrame(frame('session_settings_updated', { session_id: 'addressable-session' }, writes(captured)[0].id))
  await expect(action).toBeEnabled()
  daemon.pushFrame(frame('model_list', { conversation_id: other.id, dropped_models: 0,
    models: [{ value: 'haiku', display_name: 'Haiku', resolved_model: 'haiku', effort_levels: [], supports_auto_mode: false, truncated_fields: null }] }))
  await page.getByRole('button', { name: 'Opus', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Haiku', exact: true }).click()
  await expect.poll(() => writes(captured).length).toBe(2)
  await expect(action).toHaveCount(0)
  daemon.pushFrame(frame('session_settings_updated', { session_id: 'addressable-session' }, writes(captured)[1].id))
  daemon.pushFrame(frame('model_refusal_fallback', refusal(other.id)))
  await expect(action).toBeEnabled()
  daemon.pushFrame(frame('model_announced', { conversation_id: other.id, model: 'different-model', truncated: false }))
  await expect(action).toHaveCount(0)
  daemon.pushFrame(frame('model_refusal_fallback', refusal(other.id)))
  await expect(action).toBeEnabled()
  daemon.pushFrame(frame('session_transition', { conversation_id: other.id, previous_session_id: 'addressable-session',
    new_session_id: 'replacement', reason: 'clear', occurred_at: '2026-09-11T12:01:00Z', workspace_cwd: null }))
  await expect(page.locator('.session-delimiter')).toBeVisible()
  await expect(action).toHaveCount(0)
  await expect(rows).toHaveCount(4)
  await page.locator('.channel-list__row-open').filter({ hasText: SEEDED_ROW.name }).click()
  await expect(rows).toHaveCount(2)
  await expect(action).toHaveCount(0)
})

test('connection errors and stopped-turn recovery take priority over the offer, which precedes usage', async ({ launchPairedApp }) => {
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: fake([]) })
  const action = page.getByRole('button', { name: 'Switch back', exact: true }), usage = page.locator('.composer-status__usage')
  daemon.pushFrame(frame('rate_limited', { conversation_id: SEEDED_ROW.id, status: 'rejected', limit_type: 'five_hour', resets_at: 4102444800, truncated_fields: null }))
  await expect(usage).toBeVisible()
  daemon.pushFrame(frame('model_refusal_fallback', refusal()))
  await expect(action).toBeVisible()
  await expect(usage).toHaveCount(0)
  daemon.pushFrame(frame('turn_end', { conversation_id: SEEDED_ROW.id, turn_id: 'stopped', stop_reason: 'end_turn',
    is_error: true, terminal_reason: 'api_error', error_category: 'billing_error' }))
  await expect(page.locator('.stopped-turn-recovery')).toContainText('billing error')
  await expect(action).toHaveCount(0)
  daemon.pushFrame(frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'thinking' }))
  await expect(action).toBeVisible()
  for (const retryable of [true, false]) {
    await app.evaluate(({ BrowserWindow }, { channel, retryable }) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel, {
        type: 'failed', serverId: 'fake-daemon', error: { code: 'transport', message: '', retryable }
      })
    }, { channel: DAEMON_EVENT_CHANNEL, retryable })
    if (retryable) await expect(page.locator('.composer-status__error')).toBeVisible()
    else await expect(page.getByRole('button', { name: /Re-pair/ })).toBeVisible()
    await expect(action).toHaveCount(0)
    await expect(usage).toHaveCount(0)
    await expect(page.locator('.model-refusal')).toHaveCount(1)
  }
})
