import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, SendMessagePayload } from '../src/shared/wire/types'
import { installDeliveryInterception, readDeliveryObservation, withDeliveryCleanup } from './fixtures/disconnectedDelivery'
import { NOT_YET_AVAILABLE, readMainProcess } from './fixtures/mainProcessRead'
import { createCanonicalThread } from './fixtures/canonicalThread'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

const SESSION = 'held-delivery-session'
const route = { conversation_id: SEEDED_ROW.id, epoch: 'held-delivery-epoch' }
const item = (id: number, kind: 'user_message' | 'assistant_message',
  status: 'running' | 'finished' | 'queued', content: unknown): ThreadItem => ({
  id, order: id, rev: 1, kind, status, active: status === 'running' || status === 'queued',
  shown: true, summary: '', session: SESSION, content
})

function luminance(colour: string): number {
  const channels = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(colour)
  if (channels === null) throw new Error(`Expected opaque RGB colour: ${colour}`)
  const [r, g, b] = channels.slice(1).map(value => {
    const channel = Number(value) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

for (const mode of ['automatic', 'explicit', 'terminal'] as const) {
  test(`accepted disconnected messages drain and settle: ${mode}`, async ({ launchPairedApp }) => {
    const sends: SendMessagePayload[] = []
    const otherSends: SendMessagePayload[] = []
    const requests: Envelope[] = []
    const thread = createCanonicalThread({ conversations: [{ summary: { ...SEEDED_ROW,
      current_session_id: SESSION }, epoch: route.epoch, version: 1,
      items: [item(10, 'assistant_message', 'running', { text: 'Earlier running reply' })] }] })
    const otherThread = createCanonicalThread({ conversations: [{ summary: { ...SECOND_SEEDED_ROW,
      current_session_id: SESSION }, epoch: 'other-held-epoch', version: 1, items: [] }] })
    const { page, app, daemon, forwarder, servers } = await launchPairedApp({ threadMode: 'canonical', thread,
      buildReplyFrames: bytes => {
        const frame = decodeEnvelope(bytes)
        requests.push(frame)
        if (frame.type === 'send_message') sends.push(frame.payload as SendMessagePayload)
        return []
    } }, { secondServer: mode === 'terminal' ? { threadMode: 'canonical', thread: otherThread, buildReplyFrames: bytes => {
      const frame = decodeEnvelope(bytes)
      if (frame.type === 'send_message') otherSends.push(frame.payload as SendMessagePayload)
      return []
    } } : undefined })
    await page.setViewportSize({ width: mode === 'terminal' ? 800 : 1280, height: 800 })
    if (mode === 'terminal') await page.locator('.channel-list__row').filter({ hasText: SEEDED_ROW.name ?? '' }).locator('.channel-list__row-open').click()
    let version = 1
    const push = (update: ThreadUpdate) => daemon.pushFrame(encodeEnvelope({
      id: 77, ts: '2026-10-07T12:00:00Z', ...update
    }))
    daemon.pushFrame(encodeEnvelope({ id: 78, type: 'turn_state', ts: '2026-10-07T12:00:00Z',
      session_id: SESSION, payload: { conversation_id: SEEDED_ROW.id, state: 'responding' } }))
    await expect(page.getByText('Earlier running reply', { exact: false })).toBeVisible()
    expect(requests.find(r => r.type === 'thread_catch_up')?.payload).toMatchObject({ version: 0 })
    const identity = await page.evaluate(() => window.pyry.deviceIdentity())
    if (!identity.ok) throw new Error('authenticated device identity unavailable')

    // Hold accepted renderer commands at the existing IPC boundary, then deliver them during
    // the real reconnect gap. Pause only the synthetic pairing read to make that gap observable.
    await withDeliveryCleanup(app, async () => {
    await app.evaluate(installDeliveryInterception)
    const composer = page.getByPlaceholder('Message…')
    for (const text of ['Held message one', 'Held message two']) {
      await composer.fill(text)
      await composer.press('Enter')
      await expect(page.locator('.message-row--user', { hasText: text })).toHaveCount(1)
    }
    let accepted: SendMessagePayload[] = []
    await expect.poll(async () => {
      const payloads = await readMainProcess<SendMessagePayload[]>(app, () =>
        (globalThis as any).__delivery1853.pending.map((entry: any) => entry.command.payload))
      if (payloads === NOT_YET_AVAILABLE) return NOT_YET_AVAILABLE
      accepted = payloads
      return payloads.length
    }, { timeout: 5_000 }).toBe(2)
    if (mode === 'automatic') {
      forwarder.dropClientLeg()
      await expect(page.getByRole('button', { name: 'Stop the running turn', exact: true })).toBeDisabled()
    } else await page.evaluate(serverId => window.pyry.reconnectServer(serverId), servers[0].serverId)
    const writesBeforeForward = await readDeliveryObservation(app, () => (globalThis as any).__delivery1853.socketWrites())
    await app.evaluate(() => (globalThis as any).__delivery1853.forward())
    await expect(page.getByText('Waiting for connection', { exact: true })).toHaveCount(2)
    await expect(page.locator('.message-row--queued')).toHaveCount(0)
    expect(sends).toHaveLength(0)
    expect(await readDeliveryObservation(app, () => (globalThis as any).__delivery1853.socketWrites())).toBe(writesBeforeForward)
    const colours = await page.getByText('Waiting for connection', { exact: true }).first().evaluate(label => {
      const bubble = label.closest('.bubble--user')
      if (bubble === null) throw new Error('Waiting label must belong to its user bubble')
      return { text: getComputedStyle(label).color, fill: getComputedStyle(bubble).backgroundColor }
    })
    const levels = [luminance(colours.text), luminance(colours.fill)]
    const contrast = (Math.max(...levels) + 0.05) / (Math.min(...levels) + 0.05)
    await page.screenshot({ path: `/tmp/builder-2222/waiting-${mode}.png` })
    expect(contrast).toBeGreaterThanOrEqual(4.5)
    expect(colours).toEqual({ text: 'rgb(207, 228, 255)', fill: 'rgb(0, 51, 85)' })
    if (mode === 'terminal') {
      await page.locator('.channel-list__row').filter({ hasText: SECOND_SEEDED_ROW.name ?? '' }).locator('.channel-list__row-open').click()
      await expect(page.getByText('Waiting for connection', { exact: true })).toHaveCount(0)
      await composer.fill('Other host draft stays here')
    }
    await app.evaluate((_electron, fail) => (globalThis as any).__delivery1853.resume(fail), mode === 'terminal')
    if (mode === 'terminal') {
      await page.locator('.channel-list__row').filter({ hasText: SEEDED_ROW.name ?? '' }).locator('.channel-list__row-open').click()
      await expect(page.getByText('Not sent', { exact: true })).toHaveCount(2)
      await page.screenshot({ path: '/tmp/builder-2222/not-sent-800.png' })
      expect(sends).toHaveLength(0)
      await page.getByRole('button', { name: 'Connection error - Reconnect', exact: true }).click()
    }
    await expect.poll(() => sends).toEqual(accepted)
    expect(await readDeliveryObservation(app, () => (globalThis as any).__delivery1853.socketWrites())).toBeGreaterThan(writesBeforeForward)
    await expect(page.getByText('Waiting for connection', { exact: true })).toHaveCount(0)
    const queued = sends.map((p, i) => ({ queued_msg_id: i + 7, message_id: p.message_id, text: p.text, ts: '' }))
    const acceptedItems = queued.map((content, i) => item(20 + i * 20, 'user_message', 'queued',
      { ...content, device_id: identity.deviceId }))
    for (const item of acceptedItems)
      push({ type: 'thread_item_added', payload: { ...route, version: ++version, item } })
    await expect(page.locator('.message-row--queued')).toHaveCount(2)
    push({ type: 'thread_item_changed', payload: { ...route, version: ++version,
      item_id: 10, base_rev: 1, rev: 2, changes: { status: 'finished', active: false } } })
    for (let i = 0; i < 2; i++) {
      push({ type: 'thread_item_changed', payload: { ...route, version: ++version,
        item_id: acceptedItems[i].id, base_rev: 1, rev: 2, changes: { status: 'delivered', active: false } } })
      await expect(page.locator('.message-row--queued')).toHaveCount(1 - i)
      push({ type: 'thread_item_added', payload: { ...route, version: ++version,
        item: item(30 + i * 20, 'assistant_message', 'running', { text: `Answer ${i}` }) } })
      await expect(page.getByText(`Answer ${i}`, { exact: false })).toBeVisible()
      // Exercise a separate render of the running item before its settlement frame. Text visibility
      // alone cannot establish that the row is ready for the replay-stability snapshot.
      const answer = page.locator('[data-thread-role="assistant"]', { hasText: `Answer ${i}` })
      await expect(answer.locator('.bubble__cursor')).toHaveCount(1)
      push({ type: 'thread_item_changed', payload: { ...route, version: ++version,
        item_id: 30 + i * 20, base_rev: 1, rev: 2, changes: { status: 'finished', active: false } } })
      await expect(answer.locator('.bubble__cursor')).toHaveCount(0)
    }
    const rows = page.locator('.conversation__thread [data-thread-role]')
    const before = await rows.allTextContents()
    // Redeliver the accepted identity through a supported authoritative revision.
    push({ type: 'thread_item_changed', payload: { ...route, version: ++version,
      item_id: acceptedItems[0].id, base_rev: 2, rev: 3,
      changes: { content: { ...queued[0], device_id: identity.deviceId }, status: 'delivered', active: false } } })
    push({ type: 'thread_item_added', payload: { ...route, version: ++version,
      item: item(60, 'assistant_message', 'running', { text: 'Replay barrier' }) } })
    await expect(page.getByText('Replay barrier', { exact: false })).toBeVisible()
    expect((await rows.allTextContents()).filter(text => !text.includes('Replay barrier'))).toEqual(before)
    await expect(page.locator('.message-row--user')).toHaveCount(2)
    for (let i = 0; i < 2; i++) {
      await expect(page.locator('.message-row--user', { hasText: accepted[i].text })).toHaveCount(1)
      expect(before.findIndex(text => text.includes(i === 0 ? 'Held message one' : 'Held message two')))
        .toBeLessThan(before.findIndex(text => text.includes(`Answer ${i}`)))
    }
    await expect(page.getByText('receipt must preserve original text', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Not sent', { exact: true })).toHaveCount(0)
    expect(sends).toEqual(accepted)
    expect(otherSends).toHaveLength(0)
    expect(requests.filter(r => r.type === 'request_history' || r.type === 'history_page')).toEqual([])
    if (mode === 'terminal') {
      await page.locator('.channel-list__row').filter({ hasText: SECOND_SEEDED_ROW.name ?? '' }).locator('.channel-list__row-open').click()
      await expect(composer).toHaveValue('Other host draft stays here')
    }
    })
  })
}
