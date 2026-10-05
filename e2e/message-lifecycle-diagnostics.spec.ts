import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { SendMessagePayload } from '../src/shared/wire/types'

test('idle and running composer submissions reach diagnostics, and drop is a local request', async ({ launchPairedApp }) => {
  const sent: SendMessagePayload[] = []
  let drops = 0
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const frame = decodeEnvelope(bytes)
    if (frame.type === 'list_conversations') return [seedConversationsFrame()]
    if (frame.type === 'send_message') sent.push(frame.payload as SendMessagePayload)
    if (frame.type === 'dequeue_message') drops++
    return []
  } })
  const records: Array<{ event: string; messageId?: string; connectionId?: string; code?: string }> = []
  let pending = ''
  const collect = (chunk: Buffer) => {
    pending += chunk.toString()
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('{')) records.push(JSON.parse(line))
    }
  }
  app.process().stdout?.on('data', collect)
  const push = (type: string, payload: Record<string, unknown>) => daemon.pushFrame(encodeEnvelope({
    id: 1, type, ts: '2026-10-05T12:00:00Z', payload: { conversation_id: SEEDED_ROW.id, ...payload }
  }))
  const events = (id: string) => records.filter(record => record.messageId === id)
  try {
    const composer = page.getByPlaceholder('Message…')
    await composer.fill('  ')
    await composer.press('Enter')
    await composer.fill('IDLE_TEXT_SECRET')
    await composer.press('Enter')
    await expect.poll(() => sent.length).toBe(1)
    await expect.poll(() => events(sent[0].message_id).map(record => record.event)).toEqual(['message-queued', 'message-sent'])
    push('turn_state', { state: 'responding' })
    await expect(page.getByRole('button', { name: 'Stop the running turn' })).toBeVisible()
    await composer.fill('RUNNING_TEXT_SECRET')
    await composer.press('Enter')
    await expect.poll(() => sent.length).toBe(2)
    const id = sent[1].message_id
    const snapshot = { queued: [{ queued_msg_id: 1, message_id: id, text: sent[1].text, ts: '2026-10-05T12:00:00Z' }] }
    push('queue_state', snapshot)
    push('queue_state', snapshot)
    await expect.poll(() => events(id).map(record => record.event)).toEqual(['message-queued', 'message-sent', 'message-acknowledged'])
    await page.getByRole('button', { name: 'Drop queued message' }).click()
    await expect.poll(() => drops).toBe(1)
    await expect.poll(() => events(id).map(record => record.code).filter(Boolean)).toEqual(['user-cancel-request'])
    expect(events(id)).toHaveLength(4)
    expect(records.filter(record => record.event === 'message-queued')).toHaveLength(2)
    expect(events(id)[1].connectionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.stringify(records)).not.toContain('TEXT_SECRET')
    // Drive the production routing refusal through the same two IPC channels.
    const refused = '32345678-1234-4123-8123-123456789abc'
    await page.evaluate(messageId => {
      window.pyry.sendDiagnostic({ event: 'message-queued', messageId, conversationId: 'unknown-chat' })
      window.pyry.sendCommand({ type: 'sendMessage', payload: { message_id: messageId, conversation_id: 'unknown-chat', text: 'REFUSED_TEXT_SECRET' } })
    }, refused)
    await expect.poll(() => events(refused).map(record => record.event)).toEqual(['message-queued', 'message-dropped'])
    expect(events(refused)[1].code).toBe('route-refused')
    expect(sent).toHaveLength(2)
    expect(JSON.stringify(records)).not.toContain('TEXT_SECRET')
  } finally {
    app.process().stdout?.removeListener('data', collect)
  }
})
