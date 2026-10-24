import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { createCanonicalThread } from './fixtures/canonicalThread'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, SendMessagePayload } from '../src/shared/wire/types'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

test('idle and running composer submissions reach diagnostics, and drop is a local request', async ({ launchPairedApp }) => {
  const sent: SendMessagePayload[] = []
  const requests: Envelope[] = [], drops: Envelope[] = []
  const ts = '2026-10-05T12:00:00Z'
  const summary = { ...SEEDED_ROW, current_session_id: 'diagnostics-session' }
  const epoch = 'diagnostics-epoch'
  const route = { conversation_id: summary.id, epoch }
  let version = 1
  const item = (id: number, text: string): ThreadItem => ({
    id, order: id * 10, rev: 1, kind: 'assistant_message', status: 'done', active: false, shown: true,
    summary: '', session: summary.current_session_id, content: { text, ts }
  })
  const opening = item(1, 'Canonical diagnostics ready')
  const thread = createCanonicalThread({ conversations: [{ summary, epoch, version, items: [opening] }] })
  // Native delivery lets identical full-item acceptance facts reach the app's deduplication.
  const { page, app, daemon } = await launchPairedApp({ threadMode: 'native', buildReplyFrames: bytes => {
    const frame = decodeEnvelope(bytes)
    requests.push(frame)
    if (frame.type === 'send_message') sent.push(frame.payload as SendMessagePayload)
    if (frame.type === 'dequeue_message') drops.push(frame)
    return thread.reply(bytes, [])
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
  const envelope = (type: string, payload: unknown) => encodeEnvelope({
    id: 77, type, ts, conversation_id: summary.id, session_id: summary.current_session_id, payload
  })
  const push = (update: ThreadUpdate) => {
    thread.publish(envelope(update.type, update.payload)).forEach(bytes => daemon.pushFrame(bytes))
  }
  const add = (fact: ThreadItem) => push({ type: 'thread_item_added', payload: { ...route, version: ++version, item: fact } })
  const events = (id: string) => records.filter(record => record.messageId === id)
  try {
    await expect(page.locator('[data-thread-role="assistant"]', { hasText: 'Canonical diagnostics ready' })).toBeVisible()
    expect(requests).toContainEqual(expect.objectContaining({ type: 'thread_catch_up',
      payload: expect.objectContaining({ conversation_id: summary.id, version: 0 }) }))
    const identity = await page.evaluate(() => window.pyry.deviceIdentity())
    expect(identity.ok).toBe(true)
    if (!identity.ok) throw new Error(identity.error)
    const composer = page.getByPlaceholder('Message…')
    await composer.fill('  ')
    await composer.press('Enter')
    await expect(composer).toHaveValue('  ')
    expect(sent).toHaveLength(0)
    expect(records.filter(record => record.event === 'message-queued')).toHaveLength(0)
    await composer.fill('IDLE_TEXT_SECRET')
    await composer.press('Enter')
    await expect.poll(() => sent.length).toBe(1)
    await expect.poll(() => events(sent[0].message_id).map(record => record.event)).toEqual(['message-queued', 'message-sent'])
    thread.publish(envelope('turn_state', { conversation_id: summary.id, state: 'responding' }))
      .forEach(bytes => daemon.pushFrame(bytes))
    await expect(page.getByRole('button', { name: 'Stop the running turn' })).toBeVisible()
    await composer.fill('RUNNING_TEXT_SECRET')
    await composer.press('Enter')
    await expect.poll(() => sent.length).toBe(2)
    const id = sent[1].message_id
    expect(sent.map(message => message.conversation_id)).toEqual([summary.id, summary.id])
    expect(sent.map(message => message.text)).toEqual(['IDLE_TEXT_SECRET', 'RUNNING_TEXT_SECRET'])
    const activity = item(2, 'Assistant activity before explicit acceptance')
    add(activity)
    await expect(page.locator('[data-thread-role="assistant"]', { hasText: 'Assistant activity before explicit acceptance' })).toBeVisible()
    expect(events(id).map(record => record.event)).toEqual(['message-queued', 'message-sent'])
    expect(events(sent[0].message_id).map(record => record.event)).toEqual(['message-queued', 'message-sent'])
    await expect(page.locator('[data-read-row] .message-row--user')).toHaveCount(0)
    const accepted: ThreadItem = { ...item(3, ''), kind: 'user_message', status: 'queued', active: true,
      content: { queued_msg_id: 47, device_id: identity.deviceId, message_id: id,
        text: 'RUNNING_TEXT_SECRET — authoritative queued text', ts } }
    add(accepted)
    const queued = page.locator('.message-row--queued', { hasText: 'RUNNING_TEXT_SECRET — authoritative queued text' })
    await expect(queued).toBeVisible()
    const queuedHandle = await queued.elementHandle()
    expect(queuedHandle).not.toBeNull()
    // Keep item identity/revision/content fixed while advancing the delivery versions.
    for (let repeat = 0; repeat < 2; repeat++) daemon.pushFrame(envelope('thread_item_added',
      { ...route, version: ++version, item: accepted }))
    thread.setConversation({ summary, epoch, version, items: [opening, activity, accepted] })
    add(item(4, 'Repeated acceptance processed'))
    await expect(page.locator('[data-thread-role="assistant"]', { hasText: 'Repeated acceptance processed' })).toBeVisible()
    await expect(queued).toHaveCount(1)
    await expect(page.locator('.message-row--queued')).toHaveCount(1)
    expect(await queuedHandle?.evaluate(element => element.isConnected)).toBe(true)
    await expect(queued).toContainText('RUNNING_TEXT_SECRET — authoritative queued text')
    await expect(queued.getByRole('button', { name: 'Drop queued message' })).toBeVisible()
    expect(events(sent[0].message_id).map(record => record.event)).toEqual(['message-queued', 'message-sent'])
    await expect.poll(() => events(id).map(record => record.event)).toEqual(['message-queued', 'message-sent', 'message-acknowledged'])
    await queued.getByRole('button', { name: 'Drop queued message' }).click()
    await expect.poll(() => drops.length).toBe(1)
    expect(drops[0].payload).toEqual({ conversation_id: summary.id, queued_msg_id: 47 })
    await expect.poll(() => events(id).map(record => record.code).filter(Boolean)).toEqual(['user-cancel-request'])
    expect(events(id).map(record => record.event)).toEqual(['message-queued', 'message-sent', 'message-acknowledged', 'message-dropped'])
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
    expect(drops).toHaveLength(1)
    expect(requests.map(request => request.type)).not.toContain('request_history')
    expect(JSON.stringify(records)).not.toContain('TEXT_SECRET')
  } finally {
    app.process().stdout?.removeListener('data', collect)
  }
})
