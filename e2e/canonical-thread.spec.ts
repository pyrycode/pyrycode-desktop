import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { createCanonicalThread } from './fixtures/canonicalThread'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope } from '../src/shared/wire/types'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

const item = (id: number, text: string): ThreadItem => ({ id, order: id * 10, rev: 1, kind: 'assistant_message',
  status: 'finished', active: false, shown: true, summary: '', content: { text }, session: 'explicit-session' })
const route = { conversation_id: SEEDED_ROW.id, epoch: 'authored-epoch' }
const frame = (update: ThreadUpdate) => encodeEnvelope({ id: 100, ts: '2026-10-21T00:00:00Z', ...update })

test('canonical facts open, stream, page and reconnect without the adapter', async ({ launchPairedApp }) => {
  const requests: (Envelope & { payload: Record<string, unknown> })[] = []
  const thread = createCanonicalThread({ windowSize: 2, conversations: [{
    summary: { ...SEEDED_ROW, current_session_id: 'explicit-session' }, epoch: route.epoch, version: 1,
    items: [item(1, 'Canonical oldest'), item(2, 'Canonical middle'), item(3, 'Canonical opening')]
  }] })
  const { page, daemon, forwarder } = await launchPairedApp({ threadMode: 'canonical', thread,
    helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
      requests.push(decodeEnvelope(bytes) as Envelope & { payload: Record<string, unknown> }); return []
    }, buildReconnectFrames: () => [encodeEnvelope({ id: 101, type: 'turn_state', ts: '2026-10-21T00:00:00Z',
      session_id: 'explicit-session', payload: { conversation_id: SEEDED_ROW.id, state: 'idle' } })]
  })
  await expect(page.getByText('Canonical opening', { exact: true })).toBeVisible()
  expect(requests.filter(r => r.type === 'thread_catch_up')[0].payload).toMatchObject({ version: 0 })
  daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 2, item: item(4, 'Canonical live') } }))
  await expect(page.getByText('Canonical live', { exact: true })).toBeVisible()
  daemon.pushFrame(frame({ type: 'thread_text_append', payload: { ...route, version: 3,
    item_id: 4, base_rev: 1, rev: 2, text: ' appended' } }))
  await expect(page.getByText('Canonical live appended', { exact: true })).toBeVisible()
  await page.locator('.conversation__thread').press('Home')
  await expect.poll(() => requests.filter(r => r.type === 'thread_page').length).toBeGreaterThan(0)
  await expect(page.getByText('Canonical oldest', { exact: true })).toBeVisible()
  expect(requests.find(r => r.type === 'thread_page')?.payload.before_order).toBe(20)
  const before = requests.filter(r => r.type === 'thread_catch_up').length
  // Retain a new authoritative fact without sending it; reconnect must recover it through catch-up.
  thread.publish(frame({ type: 'thread_item_added', payload: { ...route, version: 4, item: item(5, 'Canonical recovered') } }))
  forwarder.dropClientLeg()
  await expect.poll(() => requests.filter(r => r.type === 'thread_catch_up').length).toBeGreaterThan(before)
  expect(requests.filter(r => r.type === 'thread_catch_up').at(-1)?.payload).toMatchObject({ epoch: route.epoch, version: 3 })
  await expect(page.getByText('Canonical recovered', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Canonical live appended', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Canonical oldest', { exact: true })).toHaveCount(1)
  expect(requests.some(r => r.type === 'request_history')).toBe(false)
})

test('canonical epoch replacement resets a positive checkpoint and recovers reused identity', async ({ launchPairedApp }) => {
  const requests: (Envelope & { payload: Record<string, unknown> })[] = []
  const thread = createCanonicalThread({ conversations: [{ summary: SEEDED_ROW, epoch: route.epoch,
    version: 7, items: [{ ...item(1, 'Retired epoch content'), rev: 5 }] }] })
  const { page, daemon, forwarder } = await launchPairedApp({ threadMode: 'canonical', thread,
    helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
      requests.push(decodeEnvelope(bytes) as Envelope & { payload: Record<string, unknown> }); return []
    } })
  await expect(page.getByText('Retired epoch content', { exact: true })).toBeVisible()
  thread.setConversation({ summary: SEEDED_ROW, epoch: 'replacement-epoch', version: 2,
    items: [item(1, 'Reused identity replacement'), item(2, 'Replacement epoch content')] })
  forwarder.dropClientLeg()
  await expect(page.getByText('Replacement epoch content', { exact: true })).toBeVisible()
  const catchups = requests.filter(r => r.type === 'thread_catch_up')
  expect(catchups.map(r => r.payload)).toEqual(expect.arrayContaining([
    expect.objectContaining({ epoch: route.epoch, version: 7 }),
    expect.objectContaining({ epoch: 'replacement-epoch', version: 0 })
  ]))
  await expect(page.getByText('Reused identity replacement', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Retired epoch content', { exact: true })).toHaveCount(0)
  daemon.pushFrame(frame({ type: 'thread_text_append', payload: { conversation_id: SEEDED_ROW.id,
    epoch: 'replacement-epoch', version: 3, item_id: 1, base_rev: 1, rev: 2, text: ' appended' } }))
  await expect(page.getByText('Reused identity replacement appended', { exact: true })).toBeVisible()
})

test('canonical defaults keep colliding conversation and item identities isolated per host', async ({ launchPairedApp }) => {
  const publisher = (name: string, text: string) => createCanonicalThread({ conversations: [{
    summary: { ...SEEDED_ROW, name, current_session_id: 'explicit-session' }, epoch: route.epoch,
    version: 1, items: [item(1, text)]
  }] })
  const { page, servers } = await launchPairedApp({ threadMode: 'canonical', thread: publisher('First canonical chat', 'First host fact') },
    { secondServer: { threadMode: 'canonical', thread: publisher('Second canonical chat', 'Second host fact') } })
  await page.locator('.channel-list__row-open').filter({ hasText: 'Second canonical chat' }).click()
  await expect(page.getByText('Second host fact', { exact: true })).toBeVisible()
  servers[0].daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 2,
    item: item(2, 'First host live fact') } }))
  await page.locator('.channel-list__row-open').filter({ hasText: 'First canonical chat' }).click()
  await expect(page.getByText('First host live fact', { exact: true })).toBeVisible()
  await expect(page.getByText('First host fact', { exact: true })).toBeVisible()
  await expect(page.getByText('Second host fact', { exact: true })).toHaveCount(0)
})
