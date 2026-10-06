import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, EnvelopeType } from '../src/shared/wire/types'

const other = { ...SEEDED_ROW, id: 'other-suggestion', name: 'Other suggestion chat' }
const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number) => encodeEnvelope({ id: 91, type, ts: '2026-10-06T00:00:00Z', payload, in_reply_to })
const suggestion = (revision = 1, suggested_reply: string | null = 'Please continue', conversation_id = SEEDED_ROW.id, session_id = 's') =>
  frame('reply_suggestion', { conversation_id, session_id, revision, suggested_reply })
const transition = (new_session_id: string, conversation_id = SEEDED_ROW.id) => frame('session_transition', {
  conversation_id, previous_session_id: 's', new_session_id, reason: 'clear', occurred_at: '2026-10-06T00:00:00Z', workspace_cwd: null
})
function replies(captured: Envelope[], conversations = [SEEDED_ROW]) {
  return (bytes: Uint8Array): Uint8Array[] => {
    const env = decodeEnvelope(bytes)
    captured.push(env)
    if (env.type === 'list_conversations') return [frame('conversations', { conversations })]
    if (env.type === 'request_history') return [frame('history_page', { entries: [], cursor: '', at_start: true }, env.id)]
    return []
  }
}

test('mounted suggestions remain placeholder text and Tab accepts an editable draft without sending', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: replies(captured) })
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, other] }))
  const input = page.locator('textarea.composer__input')
  const text = 'Continue with <escaped> & editable text 😀'
  daemon.pushFrame(suggestion(1, text))
  await expect(input).toHaveAttribute('placeholder', text)
  await expect(input).toHaveValue('')
  await input.fill(' '); await expect(input).toHaveAttribute('placeholder', 'Message…')
  await input.fill(''); await expect(input).toHaveAttribute('placeholder', text)
  for (const key of ['Shift+Tab', 'Control+Tab', 'Alt+Tab', 'Meta+Tab']) {
    await input.focus(); await input.press(key); await expect(input).toHaveValue('')
  }
  await input.focus()
  await input.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, isComposing: true })))
  await expect(input).toHaveValue('')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
  await page.screenshot({ path: '/tmp/builder-1761/placeholder-1280.png', animations: 'disabled' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600))
  await page.screenshot({ path: '/tmp/builder-1761/placeholder-800.png', animations: 'disabled' })
  await input.focus(); await input.press('Tab')
  await expect(input).toHaveValue(text); await expect(input).toBeFocused()
  expect(await input.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([text.length, text.length])
  await input.press('End'); await input.press('!'); await expect(input).toHaveValue(text + '!')
  daemon.pushFrame(suggestion(2, null)); await expect(input).toHaveValue(text + '!')
  await input.press('Tab'); await expect(input).not.toBeFocused()
  await input.fill(''); await input.focus(); await input.press('Tab'); await expect(input).not.toBeFocused()
  expect(captured.filter(e => e.type === 'send_message')).toHaveLength(0)
  await expect(page.locator('[data-thread-role="user"]')).toHaveCount(0)
  daemon.pushFrame(suggestion(3, 'Still valid'))
  await input.fill('/cos')
  daemon.pushFrame(frame('slash_command_list', { conversation_id: SEEDED_ROW.id, commands: [
    { name: 'cost', argument_hint: '', description: 'Show cost', aliases: [], truncated_fields: null }
  ], dropped_commands: 0 }))
  await expect(page.getByRole('menuitem').filter({ hasText: 'cost' })).toBeVisible()
  await input.press('Tab'); await expect(input).toHaveValue('/cos')
  await input.focus(); await input.press('Enter'); await expect(input).toHaveValue('/cost')
  expect(captured.filter(e => e.type === 'send_message')).toHaveLength(0)
})

test('new revisions, activity and transitions clear only their suggestion and preserve drafts', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: replies([]) })
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, other] }))
  const input = page.locator('textarea.composer__input')
  const open = async (name: string) => page.locator('.channel-list__row-open').filter({ hasText: name }).click()
  daemon.pushFrame(suggestion(10))
  await expect(input).toHaveAttribute('placeholder', 'Please continue')
  daemon.pushFrame(suggestion(9, 'Older')); daemon.pushFrame(suggestion(10, 'Duplicate'))
  daemon.pushFrame(suggestion(11, null)); daemon.pushFrame(suggestion(10))
  await expect(input).toHaveAttribute('placeholder', 'Message…')
  daemon.pushFrame(suggestion(12, 'Restored'))
  await expect(input).toHaveAttribute('placeholder', 'Restored')
  daemon.pushFrame(frame('reply_suggestion', { conversation_id: SEEDED_ROW.id, session_id: 's', revision: 13, suggested_reply: '' }))
  await expect(input).toHaveAttribute('placeholder', 'Restored')
  await open(other.name)
  daemon.pushFrame(suggestion(1, 'Off-screen', SEEDED_ROW.id, 's'))
  daemon.pushFrame(suggestion(1, 'Other', other.id))
  await expect(input).toHaveAttribute('placeholder', 'Other')
  daemon.pushFrame(frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'thinking' }))
  await open(SEEDED_ROW.name); await expect(input).toHaveAttribute('placeholder', 'Message…')
  daemon.pushFrame(suggestion(14, 'Accepted'))
  await expect(input).toHaveAttribute('placeholder', 'Accepted')
  await input.focus(); await input.press('Tab')
  daemon.pushFrame(transition('new'))
  await expect(input).toHaveValue('Accepted')
  await input.fill('')
  daemon.pushFrame(suggestion(50, 'Old session'))
  await expect(input).toHaveAttribute('placeholder', 'Message…')
  daemon.pushFrame(suggestion(1, 'New session', SEEDED_ROW.id, 'new'))
  await expect(input).toHaveAttribute('placeholder', 'New session')
  await open(other.name); await expect(input).toHaveAttribute('placeholder', 'Other')
})

test('host handshake drops off-screen state and watermarks before low revision reconciliation', async ({ launchPairedApp }) => {
  const conversations = [SEEDED_ROW]
  const { page, daemon, forwarder, servers } = await launchPairedApp({
    buildReplyFrames: replies([], conversations), reconnectResendFrames: [suggestion(1, 'Reconciled')]
  }, { secondServer: { buildReplyFrames: replies([], [SECOND_SEEDED_ROW]) } })
  conversations.push(other)
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, other] }))
  const input = page.locator('textarea.composer__input')
  const open = async (name: string) => page.locator('.channel-list__row-open').filter({ hasText: name }).click()
  daemon.pushFrame(suggestion(40, 'Before reconnect'))
  daemon.pushFrame(suggestion(40, 'Hidden', other.id))
  servers[1].daemon.pushFrame(suggestion(40, 'Host two', SECOND_SEEDED_ROW.id))
  await open(SEEDED_ROW.name); await expect(input).toHaveAttribute('placeholder', 'Before reconnect')
  await input.fill('Keep draft')
  await open(SECOND_SEEDED_ROW.name); await expect(input).toHaveAttribute('placeholder', 'Host two')
  forwarder.dropClientLeg()
  await open(SEEDED_ROW.name)
  await expect(input).toHaveValue('Keep draft')
  await input.fill('')
  await expect(input).toHaveAttribute('placeholder', 'Reconciled', { timeout: 15000 })
  await open(other.name); await expect(input).toHaveAttribute('placeholder', 'Message…')
  daemon.pushFrame(suggestion(1, 'Low revision hidden', other.id))
  await expect(input).toHaveAttribute('placeholder', 'Low revision hidden')
  await open(SECOND_SEEDED_ROW.name); await expect(input).toHaveAttribute('placeholder', 'Host two')
})

test('reconciled old-session null does not pin an off-screen chat after a missed rotation', async ({ launchPairedApp }) => {
  const conversations = [SEEDED_ROW]
  const { page, daemon, forwarder } = await launchPairedApp({
    buildReplyFrames: replies([], conversations),
    reconnectResendFrames: [suggestion(11, null, other.id, 'old'), suggestion(1, 'Reconnect complete')]
  })
  conversations.push(other)
  daemon.pushFrame(frame('conversations', { conversations }))
  const input = page.locator('textarea.composer__input')
  const open = async (name: string) => page.locator('.channel-list__row-open').filter({ hasText: name }).click()
  daemon.pushFrame(suggestion(10, 'Old session', other.id, 'old'))
  await open(other.name); await expect(input).toHaveAttribute('placeholder', 'Old session')
  await open(SEEDED_ROW.name)
  // Another client rotated the hidden chat while disconnected; only its old clear reconciles.
  forwarder.dropClientLeg()
  await expect(input).toHaveAttribute('placeholder', 'Reconnect complete', { timeout: 15000 })
  await open(other.name); await expect(input).toHaveAttribute('placeholder', 'Message…')
  daemon.pushFrame(frame('turn_state', { conversation_id: other.id, state: 'thinking' }))
  daemon.pushFrame(frame('turn_state', { conversation_id: other.id, state: 'idle' }))
  daemon.pushFrame(suggestion(12, 'Current session reply', other.id, 'current'))
  await expect(input).toHaveAttribute('placeholder', 'Current session reply')
  await input.focus(); await input.press('Tab')
  await expect(input).toHaveValue('Current session reply')
  await expect(input).toBeFocused()
  daemon.pushFrame(suggestion(13, null, other.id, 'current'))
  await open(SEEDED_ROW.name); await expect(input).toHaveAttribute('placeholder', 'Reconnect complete')
  await open(other.name); await expect(input).toHaveValue('Current session reply')
  await input.fill(''); await expect(input).toHaveAttribute('placeholder', 'Message…')
})
