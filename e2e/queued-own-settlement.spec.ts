import { test, expect } from './fixtures/launchPairedApp'
import { createQueueSettlementThread } from './fixtures/queueSettlementThread'

for (const order of ['removal-first', 'receipt-first', 'sent-now', 'mixed-removal-first', 'mixed-receipt-first'] as const) {
  test(`queued own rows settle in stream order: ${order}`, async ({ launchPairedApp }) => {
    const forced = order === 'sent-now' || order.startsWith('mixed-')
    const removalFirst = order === 'removal-first' || order === 'mixed-removal-first'
    const facts = createQueueSettlementThread(true)
    const { sends, item, add, change, append } = facts
    const { page, daemon } = await launchPairedApp(facts.options)
    facts.attach(daemon)
    await page.setViewportSize({ width: 1280, height: 800 })
    const deviceId = await facts.ready(page)
    const composer = page.getByPlaceholder('Message…')
    const thread = page.locator('.conversation__thread')
    const orderOf = () => thread.locator('[data-thread-role]').allTextContents()
    facts.live('responding')
    add(item(1, 10, 'assistant_message', { text: 'First reply before queue' }, { turn: 'first', status: 'running', active: true }))
    await expect(thread.getByText('First reply before queue', { exact: false })).toBeVisible()
    for (const text of ['Own follow-up one', 'Own follow-up two']) {
      await composer.fill(text)
      await composer.press('Enter')
      await expect.poll(() => sends.length).toBe(text.endsWith('one') ? 1 : 2)
    }
    append(1, 'First reply continues after queue')
    await expect(thread.getByText('First reply continues after queue', { exact: false })).toBeVisible()
    // Command receipt and assistant activity leave the own sends local until explicit acceptance.
    await expect(page.locator('[data-read-row] .message-row--user')).toHaveCount(0)
    const entries = sends.map((s, i) => ({ queued_msg_id: i + 7, device_id: deviceId, message_id: s.message_id, text: s.text }))
    entries.forEach((content, i) => add(item(10 + i, 1000 + i * 100, 'user_message', content, { status: 'queued', active: true })))
    const foreign = { queued_msg_id: 99, device_id: 'synthetic-phone', message_id: entries[0].message_id, text: 'Foreign queued collision' }
    add(item(12, 1200, 'user_message', foreign, { status: 'queued', active: true }))
    change(1, { status: 'done', active: false })
    add(item(2, 20, 'agent', { tool_use_id: 'agent', name: 'Agent', input_summary: 'queue test agent' }, { turn: 'first', status: 'running', active: true }))
    add(item(3, 30, 'tool_call', { tool_use_id: 'tool', name: 'Read', input_summary: 'queue test file',
      result: { is_error: false, result_summary: 'Preserved tool result' } }, { turn: 'first', parent: 2 }))
    change(12, { status: 'delivered', active: false, order: 35, content: { ...foreign, text: 'Foreign delivered collision' } })
    facts.repeat(12, 'Foreign duplicate must disappear')
    add(item(4, 40, 'assistant_message', { text: 'First reply final output' }, { turn: 'first', status: 'running', active: true }))
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
    const deliver = (index: number, sent_now = false) => change(10 + index, {
      status: 'delivered', active: false, order: index === 0 ? 70 : 100, content: { ...entries[index], sent_now }
    })
    const remove = (index: number) => change(10 + index, { status: 'written', active: true, order: index === 0 ? 70 : 100 })
    change(4, { status: 'done', active: false })
    add(item(20, 50, 'turn_end', { stop_reason: 'end_turn', outcome: 'success' }, { turn: 'first', shown: false }))
    if (forced) add(item(5, 60, 'assistant_message', { text: 'Running turn before Send now' }, {
      turn: order === 'sent-now' ? 'intervening' : 'answer', status: 'running', active: true }))
    if (removalFirst) remove(0)
    deliver(0, forced)
    add(item(6, 80, 'assistant_message', { text: 'Answer to first follow-up' }, { turn: 'answer', status: 'running', active: true }))
    await expect(thread.getByText('Answer to first follow-up', { exact: false })).toBeVisible()
    if (!removalFirst) {
      // Canonical delivery changes the row immediately, before queue reconciliation.
      await expect(own).toHaveCount(0)
      // A later queue-removal reading cannot move the delivered fact backwards.
      facts.repeat(10, entries[0].text, true)
    }
    await expect(page.locator('.message-row--user:not(.message-row--queued)', { hasText: 'Own follow-up one' })).toHaveCount(1)
    await expect(page.locator('.message-row--queued', { hasText: 'Own follow-up two' })).toHaveCount(1)
    expect(await ownHandle?.evaluate(node => node.isConnected)).toBe(true)
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    await expect(tool).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText('Preserved tool result', { exact: true })).toBeVisible()
    change(6, { status: 'done', active: false })
    add(item(21, 90, 'turn_end', { stop_reason: 'end_turn', outcome: 'success' }, { turn: 'answer', shown: false }))
    remove(1)
    deliver(1, order === 'sent-now')
    add(item(7, 110, 'assistant_message', { text: 'Answer to second follow-up' }, { turn: 'last', status: 'running', active: true }))
    // Duplicate/late receipts must not split or terminate the current reply.
    facts.repeat(10, entries[0].text)
    facts.repeat(11, entries[1].text)
    facts.repeat(10, 'receipt must preserve own copy')
    facts.repeat(11, 'receipt must preserve own copy', true)
    append(7, ' continues')
    await expect(thread.getByText('Answer to second follow-up continues', { exact: false })).toBeVisible()
    await expect(thread.getByText('Answer to second follow-up continues', { exact: false })).toHaveCount(1)
    await expect(page.locator('.bubble', { hasText: 'Answer to second follow-up continues' }).locator('.bubble__cursor')).toHaveCount(1)
    const transcript = await orderOf()
    const position = (text: string) => transcript.findIndex(row => row.includes(text))
    expect(position('First reply final output')).toBeLessThan(position('Own follow-up one'))
    if (forced) {
      await expect(thread.getByText('Running turn before Send now', { exact: false })).toBeVisible()
      expect(position('Running turn before Send now')).toBeLessThan(position('Own follow-up one'))
    }
    expect(position('Own follow-up one')).toBeLessThan(position('Answer to first follow-up'))
    expect(position('Answer to first follow-up')).toBeLessThan(position('Own follow-up two'))
    expect(position('Own follow-up two')).toBeLessThan(position('Answer to second follow-up'))
    await expect(thread.getByText('receipt must preserve own copy', { exact: true })).toHaveCount(0)
    await expect(page.locator('.message-row--user', { hasText: 'Own follow-up one' })).toHaveCount(1)
    await expect(page.locator('.message-row--user', { hasText: 'Own follow-up two' })).toHaveCount(1)
    change(2, { status: 'finished', active: false, content: { tool_use_id: 'agent', name: 'Agent', input_summary: 'queue test agent',
      result: { is_error: false, result_summary: 'Agent completed' } } })
    change(7, { status: 'done', active: false })
    add(item(22, 120, 'turn_end', { stop_reason: 'end_turn', outcome: 'success' }, { turn: 'last', shown: false }))
    facts.live('idle')
    await expect(page.locator('.bubble', { hasText: 'Answer to second follow-up continues' }).locator('.bubble__cursor')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Stop the running turn', exact: true })).toHaveCount(0)
    facts.assertRequests()
  })
}

test('queued and delivered treatments retain the message-area design', async ({ launchPairedApp }) => {
  const facts = createQueueSettlementThread()
  const { item, add, change, sends } = facts
  const { page, daemon } = await launchPairedApp(facts.options)
  facts.attach(daemon)
  await page.setViewportSize({ width: 1280, height: 800 })
  const deviceId = await facts.ready(page)
  facts.live('responding')
  add(item(1, 10, 'assistant_message', { text: 'The first reply is still running.' }, { turn: 'first', status: 'running', active: true }))
  await expect(page.getByText('The first reply is still running.', { exact: false })).toBeVisible()
  await page.getByPlaceholder('Message…').fill('A queued follow-up')
  await page.getByPlaceholder('Message…').press('Enter')
  await expect.poll(() => sends.length).toBe(1)
  await expect(page.locator('[data-read-row] .message-row--user')).toHaveCount(0)
  const content = { queued_msg_id: 7, device_id: deviceId, message_id: sends[0].message_id, text: 'A queued follow-up' }
  add(item(2, 1000, 'user_message', content, { status: 'queued', active: true }))
  await expect(page.locator('.message-row--queued', { hasText: 'A queued follow-up' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Drop queued message' })).toBeVisible()
  await page.screenshot({ path: '/tmp/builder-2254/visual-queued.png' })
  change(1, { status: 'done', active: false })
  add(item(3, 20, 'turn_end', { stop_reason: 'end_turn' }, { turn: 'first', shown: false }))
  change(2, { status: 'delivered', active: false, order: 30 })
  add(item(4, 40, 'assistant_message', { text: 'The answering reply follows the delivered message.' }, { turn: 'answer', status: 'running', active: true }))
  await expect(page.getByText('The answering reply follows the delivered message.', { exact: false })).toBeVisible()
  await expect(page.locator('.message-row--queued')).toHaveCount(0)
  await expect(page.locator('.message-row--user', { hasText: 'A queued follow-up' })).toHaveCount(1)
  await page.screenshot({ path: '/tmp/builder-2254/visual-settled.png' })
  facts.assertRequests()
})
