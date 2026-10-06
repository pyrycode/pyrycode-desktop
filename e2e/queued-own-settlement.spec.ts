import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { SendMessagePayload } from '../src/shared/wire/types'

for (const historyFirst of [false, true]) {
  test(`restored tool identities survive live output and history prepends: history-first=${historyFirst}`, async ({ launchPairedApp }) => {
    let historyRequest: number | undefined
    const { page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
      const frame = decodeEnvelope(bytes)
      if (frame.type === 'list_conversations') return [seedConversationsFrame()]
      if (frame.type === 'request_history') historyRequest = frame.id
      return []
    } }, { onLaunched: async app => {
      await app.evaluate(({ ipcMain }) => {
        const previous = (ipcMain as any)._invokeHandlers.get('pyry:chat-history')
        ipcMain.removeHandler('pyry:chat-history')
        ipcMain.handle('pyry:chat-history', (event, request) => request.operation !== 'readTimeline' ? previous(event, request) : {
          status: 'stored', snapshot: { version: 1, kind: 'timeline', serverId: request.serverId,
            conversationId: request.conversationId, prependedRows: 1,
            coverage: { status: 'received', cursor: 'older', atStart: false }, items: [
              { kind: 'userText', text: 'Earlier restored message' },
              { kind: 'toolCall', turnId: 'saved', toolUseId: 'parent', name: 'Agent', inputSummary: 'Restored agent', result: null },
              { kind: 'toolCall', turnId: 'saved', toolUseId: 'child', parentToolUseId: 'parent', name: 'Read', inputSummary: 'Restored file', result: { isError: false, resultSummary: 'Restored child result' } },
              { kind: 'toolCall', turnId: 'saved', toolUseId: 'other', name: 'Read', inputSummary: 'Other restored file', result: null },
              { kind: 'assistantText', turnId: 'saved', text: 'Saved answer' },
              { kind: 'turnBoundary', turnId: 'saved', stopReason: 'end_turn' }
            ] }
        })
      })
    } })
    const run = page.getByRole('button', { name: 'Using tools: 2', exact: false })
    const parent = page.locator('.tool-row__chip--toggle', { hasText: 'Restored agent' })
    const child = page.locator('.tool-row__chip--toggle', { hasText: 'Restored file' })
    await run.click()
    await parent.click()
    await child.click()
    await expect(page.getByText('Restored child result', { exact: true })).toBeVisible()
    const handles = await Promise.all([run, parent, child].map(row => row.elementHandle()))
    const push = (type: string, payload: Record<string, unknown>, in_reply_to?: number) => daemon.pushFrame(encodeEnvelope({
      id: 77, type, ts: '2026-10-05T12:00:00Z', in_reply_to, payload: { conversation_id: SEEDED_ROW.id, ...payload }
    }))
    const live = async () => {
      push('assistant_delta', { turn_id: 'live', seq: 0, text: 'Live update receipt barrier' })
      await expect(page.getByText('Live update receipt barrier', { exact: false })).toBeVisible()
    }
    const prepend = async () => {
      await page.locator('.conversation__thread').focus()
      await page.keyboard.press('Home')
      await expect.poll(() => historyRequest).toBeDefined()
      push('history_page', { cursor: '', at_start: true, entries: [{ id: 1, type: 'message', ts: '2026-10-04T12:00:00Z',
        payload: { conversation_id: SEEDED_ROW.id, message_id: 'older-message', role: 'user', text: 'Older history prepend' } }] }, historyRequest)
      await expect(page.getByText('Older history prepend', { exact: true })).toBeVisible()
    }
    for (const update of historyFirst ? [prepend, live] : [live, prepend]) {
      await update()
      for (const row of [run, parent, child]) await expect(row).toHaveAttribute('aria-expanded', 'true')
      for (const handle of handles) expect(await handle?.evaluate(node => node.isConnected)).toBe(true)
      await expect(page.getByText('Restored child result', { exact: true })).toBeVisible()
    }
  })
}

for (const order of ['removal-first', 'receipt-first', 'sent-now', 'mixed-removal-first', 'mixed-receipt-first'] as const) {
  test(`queued own rows settle in stream order: ${order}`, async ({ launchPairedApp }) => {
    const forced = order === 'sent-now' || order.startsWith('mixed-')
    const removalFirst = order === 'removal-first' || order === 'mixed-removal-first'
    const sends: SendMessagePayload[] = []
    const { page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
      const frame = decodeEnvelope(bytes)
      if (frame.type === 'list_conversations') return [seedConversationsFrame()]
      if (frame.type === 'send_message') sends.push(frame.payload as SendMessagePayload)
      return []
    } })
    await page.setViewportSize({ width: 1280, height: 800 })
    const push = (type: string, fields: Record<string, unknown>) => daemon.pushFrame(encodeEnvelope({
      id: 77, type, ts: '2026-10-05T12:00:00Z', payload: { conversation_id: SEEDED_ROW.id, ...fields }
    }))
    const delta = (turn_id: string, text: string) => push('assistant_delta', { turn_id, seq: 1, text })
    const end = (turn_id: string) => push('turn_end', { turn_id, stop_reason: 'end_turn' })
    const composer = page.getByPlaceholder('Message…')
    const thread = page.locator('.conversation__thread')
    const orderOf = () => thread.locator('[data-thread-role]').allTextContents()
    push('turn_state', { state: 'responding' })
    delta('first', 'First reply before queue')
    await expect(thread.getByText('First reply before queue', { exact: false })).toBeVisible()
    for (const text of ['Own follow-up one', 'Own follow-up two']) {
      await composer.fill(text)
      await composer.press('Enter')
      await expect.poll(() => sends.length).toBe(text.endsWith('one') ? 1 : 2)
    }
    const entries = sends.map((s, i) => ({ queued_msg_id: i + 7, message_id: s.message_id, text: s.text, ts: '' }))
    const foreign = { queued_msg_id: 99, message_id: entries[0].message_id, text: 'Foreign queued collision', ts: '' }
    push('queue_state', { queued: [...entries, foreign] })
    delta('first', 'First reply continues after queue')
    push('tool_use', { turn_id: 'first', tool_use_id: 'agent', name: 'Agent', input_summary: 'queue test agent' })
    push('tool_use', { turn_id: 'first', tool_use_id: 'tool', parent_tool_use_id: 'agent', name: 'Read', input_summary: 'queue test file' })
    push('tool_result', { turn_id: 'first', tool_use_id: 'tool', is_error: false, result_summary: 'Preserved tool result' })
    push('message', { ...foreign, role: 'user', text: 'Foreign delivered collision' })
    push('message', { ...foreign, role: 'user', text: 'Foreign duplicate must disappear' })
    push('queue_state', { queued: entries })
    delta('first', 'First reply final output')
    await expect(thread.getByText('First reply final output', { exact: false })).toBeVisible()
    await expect(page.locator('.message-row--queued')).toHaveCount(2)
    await expect(page.locator('[data-thread-role="user"]', { hasText: 'Foreign delivered collision' })).toHaveCount(1)
    await expect(page.getByText('Foreign duplicate must disappear', { exact: true })).toHaveCount(0)
    const group = page.locator('.tool-row__chip--toggle', { hasText: 'queue test agent' })
    await group.click()
    const tool = page.locator('.tool-row__chip--toggle', { hasText: 'queue test file' })
    await tool.click()
    await expect(page.getByText('Preserved tool result', { exact: true })).toBeVisible()
    await expect(page.locator('.bubble', { hasText: 'First reply final output' }).locator('.bubble__cursor')).toHaveCount(1)
    expect((await orderOf()).findIndex(t => t.includes('Own follow-up one'))).toBeGreaterThan(
      (await orderOf()).findIndex(t => t.includes('First reply final output')))
    const own = page.locator('.message-row--queued', { hasText: 'Own follow-up one' })
    const ownHandle = await own.elementHandle()
    const deliver = (index: number, sent_now = false) => push('message', {
      ...entries[index], role: 'user', text: 'receipt must preserve own copy', sent_now
    })
    end('first')
    if (forced) delta(order === 'sent-now' ? 'intervening' : 'answer', 'Running turn before Send now')
    if (removalFirst) push('queue_state', { queued: entries.slice(1) })
    deliver(0, forced)
    delta('answer', 'Answer to first follow-up')
    await expect(thread.getByText('Answer to first follow-up', { exact: false })).toBeVisible()
    if (!removalFirst) {
      await expect(own).toHaveCount(1)
      push('queue_state', { queued: entries.slice(1) })
    }
    await expect(page.locator('.message-row--user:not(.message-row--queued)', { hasText: 'Own follow-up one' })).toHaveCount(1)
    await expect(page.locator('.message-row--queued', { hasText: 'Own follow-up two' })).toHaveCount(1)
    expect(await ownHandle?.evaluate(node => node.isConnected)).toBe(true)
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    await expect(tool).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText('Preserved tool result', { exact: true })).toBeVisible()
    end('answer')
    push('queue_state', { queued: [] })
    deliver(1, order === 'sent-now')
    delta('last', 'Answer to second follow-up')
    // Duplicate/late receipts must not split or terminate the current reply.
    deliver(0)
    deliver(1)
    delta('last', ' continues')
    await expect(thread.getByText('Answer to second follow-up continues', { exact: false })).toBeVisible()
    const transcript = await orderOf()
    const position = (text: string) => transcript.findIndex(row => row.includes(text))
    expect(position('First reply final output')).toBeLessThan(position('Own follow-up one'))
    if (forced) expect(position('Running turn before Send now')).toBeLessThan(position('Own follow-up one'))
    expect(position('Own follow-up one')).toBeLessThan(position('Answer to first follow-up'))
    expect(position('Answer to first follow-up')).toBeLessThan(position('Own follow-up two'))
    expect(position('Own follow-up two')).toBeLessThan(position('Answer to second follow-up'))
    await expect(thread.getByText('receipt must preserve own copy', { exact: true })).toHaveCount(0)
    await expect(page.locator('.message-row--user', { hasText: 'Own follow-up one' })).toHaveCount(1)
    await expect(page.locator('.message-row--user', { hasText: 'Own follow-up two' })).toHaveCount(1)
    push('tool_result', { turn_id: 'first', tool_use_id: 'agent', is_error: false, result_summary: 'Agent completed' })
    end('last')
    push('turn_state', { state: 'idle' })
    await expect(page.getByRole('button', { name: 'Stop the running turn', exact: true })).toHaveCount(0)
  })
}

test('queued and delivered treatments retain the message-area design', async ({ launchPairedApp }) => {
  let sent: SendMessagePayload | undefined
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const frame = decodeEnvelope(bytes)
    if (frame.type === 'list_conversations') return [seedConversationsFrame()]
    if (frame.type === 'send_message') sent = frame.payload as SendMessagePayload
    return []
  } })
  await page.setViewportSize({ width: 1280, height: 800 })
  const push = (type: string, fields: Record<string, unknown>) => daemon.pushFrame(encodeEnvelope({
    id: 77, type, ts: '2026-10-05T12:00:00Z', payload: { conversation_id: SEEDED_ROW.id, ...fields }
  }))
  push('turn_state', { state: 'responding' })
  push('assistant_delta', { turn_id: 'first', seq: 1, text: 'The first reply is still running.' })
  await expect(page.getByText('The first reply is still running.', { exact: false })).toBeVisible()
  await page.getByPlaceholder('Message…').fill('A queued follow-up')
  await page.getByPlaceholder('Message…').press('Enter')
  await expect.poll(() => sent?.message_id).toBeTruthy()
  push('queue_state', { queued: [{ queued_msg_id: 7, message_id: sent?.message_id, text: 'A queued follow-up', ts: '' }] })
  await expect(page.locator('.message-row--queued', { hasText: 'A queued follow-up' })).toBeVisible()
  await page.screenshot({ path: '/tmp/builder-1731/visual-queued.png' })
  push('turn_end', { turn_id: 'first', stop_reason: 'end_turn' })
  push('message', { queued_msg_id: 7, message_id: sent?.message_id, role: 'user', text: 'A queued follow-up' })
  push('queue_state', { queued: [] })
  push('assistant_delta', { turn_id: 'answer', seq: 1, text: 'The answering reply follows the delivered message.' })
  await expect(page.getByText('The answering reply follows the delivered message.', { exact: false })).toBeVisible()
  await expect(page.locator('.message-row--queued')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/builder-1731/visual-settled.png' })
})
