import { join } from 'node:path'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { createQueueTurnEvidence } from './fixtures/queueTurnEvidence'
import { createQueueSettlementThread } from './fixtures/queueSettlementThread'

type EvidenceWindow = typeof window & {
  queueTurnEvidence: Pick<ReturnType<typeof createQueueTurnEvidence>, 'snapshot'> & { stop: () => void }
}

// Verifies the live oracle's browser installation and real UI wiring; only the real-Claude
// scenarios can establish that a daemon actually drains the queue.
test('queue evidence follows a single user row through delivery in the built app', async ({ launchPairedApp }, testInfo) => {
  const facts = createQueueSettlementThread()
  const { sends: sent, item, add, change, append } = facts
  const { page, daemon } = await launchPairedApp(facts.options)
  facts.attach(daemon)
  await page.setViewportSize({ width: 1280, height: 800 })
  const deviceId = await facts.ready(page)
  await page.evaluate(createQueueTurnEvidence, {
    conversationId: SEEDED_ROW.id, markers: ['FIRST_DONE', 'SECOND_DONE'], subscribe: true
  })
  const evidence = () => page.evaluate(() => (window as EvidenceWindow).queueTurnEvidence.snapshot([0, 1]))
  try {
    const composer = page.getByPlaceholder('Message…')
    await composer.fill('Start the first task')
    await composer.press('Enter')
    await expect.poll(() => sent.length).toBe(1)
    facts.live('responding')
    add(item(1, 20, 'assistant_message', { text: 'The first task is running. ' }, { turn: 'first', status: 'running', active: true }))
    await expect(page.getByText('The first task is running.', { exact: false })).toBeVisible()
    await expect(page.locator('[data-read-row] .message-row--user')).toHaveCount(0)
    add(item(2, 10, 'user_message', { device_id: deviceId, message_id: sent[0].message_id, text: sent[0].text }, { status: 'delivered' }))
    await expect(page.getByRole('button', { name: 'Stop the running turn' })).toBeVisible()
    await composer.fill('Follow-up task')
    await composer.press('Enter')
    await expect.poll(() => sent.length).toBe(2)
    add(item(3, 1000, 'user_message', { queued_msg_id: 1, device_id: deviceId,
      message_id: sent[1].message_id, text: sent[1].text }, { status: 'queued', active: true }))
    const queued = page.locator('.message-row--queued', { hasText: 'Follow-up task' })
    await expect(queued).toHaveCount(1)
    await expect(queued.getByRole('button', { name: 'Drop queued message' })).toBeVisible()
    await expect.poll(async () => (await evidence()).queuedMessageIds).toEqual([sent[1].message_id])
    const queuedHandle = await queued.elementHandle()
    await page.screenshot({ path: join('/tmp/builder-2254', 'evidence-queued.png'), animations: 'disabled' })
    change(3, { status: 'delivered', active: false, order: 40 })
    await expect(queued).toHaveCount(0)
    await expect.poll(async () => (await evidence()).queuedMessageIds).toEqual([])
    expect((await evidence()).complete).toBe(false)
    expect(await queuedHandle?.evaluate(node => node.isConnected)).toBe(true)
    append(1, 'FIRST_DONE')
    await expect(page.getByText('The first task is running. FIRST_DONE', { exact: false })).toBeVisible()
    expect((await evidence()).complete).toBe(false)
    change(1, { status: 'done', active: false })
    add(item(4, 30, 'turn_end', { stop_reason: 'end_turn', outcome: 'success' }, { turn: 'first', shown: false }))
    add(item(5, 50, 'assistant_message', { text: 'SECOND_' }, { turn: 'second', status: 'running', active: true }))
    await expect(page.getByText('SECOND_', { exact: false })).toBeVisible()
    expect((await evidence()).complete).toBe(false)
    append(5, 'DONE')
    await expect(page.getByText('SECOND_DONE', { exact: false })).toBeVisible()
    expect((await evidence()).complete).toBe(false)
    change(5, { status: 'done', active: false })
    add(item(6, 60, 'turn_end', { stop_reason: 'end_turn', outcome: 'success' }, { turn: 'second', shown: false }))
    facts.live('idle')
    await expect.poll(async () => (await evidence()).complete).toBe(true)
    await expect(page.locator('[data-thread-role="user"]', { hasText: 'Follow-up task' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Drop queued message' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Stop the running turn' })).toHaveCount(0)
    expect(sent).toHaveLength(2)
    expect((await evidence()).turns.map(turn => ({ completions: turn.completions, normal: turn.normal, markers: turn.markers })))
      .toEqual([{ completions: 1, normal: true, markers: [0] }, { completions: 1, normal: true, markers: [1] }])
    facts.assertRequests()
    await page.screenshot({ path: join('/tmp/builder-2254', 'evidence-delivered.png'), animations: 'disabled' })
    testInfo.annotations.push({ type: 'visual-review', description: '1280x800; /tmp/builder-2254/evidence-{queued,delivered}.png' })
  } finally {
    await page.evaluate(() => (window as EvidenceWindow).queueTurnEvidence.stop())
  }
})
