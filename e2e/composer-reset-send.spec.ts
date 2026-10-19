import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { SendMessagePayload } from '../src/shared/wire/types'
import type { ThreadItem } from '../src/shared/wire/thread'

const stamp = '2026-10-19T00:00:00Z'
const frame = (type: string, payload: unknown, reply?: number) =>
  encodeEnvelope({ id: 100, type, ts: stamp, payload, in_reply_to: reply })
const item = (id: number, kind: string, content: unknown): ThreadItem => ({
  id, rev: 1, order: id, kind, status: 'delivered', active: false, shown: true,
  session: 'session', summary: '', content
})

test('typed resets receive only ack and leave no Sending or tail row after later delivery', async ({ launchPairedApp }) => {
  const sends: SendMessagePayload[] = []
  const { page, app, daemon } = await launchPairedApp({ threadMode: 'native',
    helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
      const request = decodeEnvelope(bytes)
      if (request.type === 'list_conversations') return [seedConversationsFrame()]
      if (request.type === 'thread_catch_up') return [
        frame('thread_items', { conversation_id: SEEDED_ROW.id, epoch: 'fixture-epoch', version: 1,
          items: [item(1, 'assistant_message', { text: 'Before reset' })], final: false }, request.id),
        frame('thread_items', { conversation_id: SEEDED_ROW.id, epoch: 'fixture-epoch', version: 1,
          items: [], final: true, lower_order: 0, upper_order: 2, continuation: 0, older_exists: false }, request.id)
      ]
      if (request.type === 'send_message') {
        sends.push(request.payload as SendMessagePayload)
        // Native mode is essential: no fixture-generated user_message may settle a reset.
        return [frame('ack', {}, request.id)]
      }
      return []
    } })
  let acknowledgements = 0, buffered = ''
  const stdout = app.process().stdout!
  const observe = (chunk: Buffer) => {
    buffered += chunk.toString()
    const lines = buffered.split('\n'); buffered = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('{')) continue
      const record = JSON.parse(line)
      if (record.event === 'inbound-unmodeled' && record.code === 'ack') acknowledgements++
    }
  }
  stdout.on('data', observe)
  try {
    await expect(page.getByText('Before reset', { exact: true })).toBeVisible()
    const identity = await page.evaluate(() => window.pyry.deviceIdentity())
    expect(identity.ok).toBe(true)
    if (!identity.ok) throw Error('fixture identity unavailable')
    const box = page.locator('.composer__input')
    let version = 1, nextItem = 2
    const add = (value: ThreadItem) => daemon.pushFrame(frame('thread_item_added', {
      conversation_id: SEEDED_ROW.id, epoch: 'fixture-epoch', version: ++version, item: value
    }))
    for (const command of ['/clear', '/reset']) {
      const before = sends.length, ackBefore = acknowledgements
      await box.fill(`  ${command}  `)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await expect.poll(() => sends.length).toBe(before + 1)
      expect(sends[before]).toMatchObject({ conversation_id: SEEDED_ROW.id, text: command })
      // Observe actual parser progress for this ack before any absence assertion.
      await expect.poll(() => acknowledgements).toBe(ackBefore + 1)
      const marker = `Processed reset ${before}`
      await add(item(nextItem++, 'assistant_message', { text: marker }))
      await expect(page.getByText(marker, { exact: true })).toBeVisible()
      await expect(box).toHaveValue('')
      await expect(page.getByText('Sending…', { exact: true })).toHaveCount(0)
      await expect(page.locator('[data-thread-role="user"]').filter({ hasText: command })).toHaveCount(0)

      const dividerId = nextItem++
      await add(item(dividerId, 'session_divider', { cause: 'operator_reset', occurred_at: stamp }))
      await expect(page.locator('.session-delimiter')).toHaveCount(before / 2 + 1)
      const later = `Later delivered message ${before}`
      await box.fill(later)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await expect.poll(() => sends.length).toBe(before + 2)
      await expect.poll(() => acknowledgements).toBe(ackBefore + 2)
      // The ordinary message still retains its local row after ack alone.
      await expect(page.getByText('Sending…', { exact: true })).toBeVisible()
      await expect(page.locator('[data-thread-role="user"]').filter({ hasText: later })).toHaveCount(1)
      const deliveredId = nextItem++
      await add(item(deliveredId, 'user_message', { text: later,
        device_id: identity.deviceId, message_id: sends[before + 1].message_id }))
      await expect(page.locator(`[data-read-row="${deliveredId}"]`)).toContainText(later)
      await expect(page.getByText('Sending…', { exact: true })).toHaveCount(0)
      await expect(page.locator('[data-thread-role="user"]')).toHaveText(
        sends.filter(send => !send.text.startsWith('/')).map(send => send.text))
      expect(await page.locator('[data-read-row]').evaluateAll(rows => rows.map(row =>
        Number(row.getAttribute('data-read-row'))))).toEqual(Array.from({ length: nextItem - 1 }, (_, i) => i + 1))
      for (const width of [1280, 800]) {
        await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
        await page.screenshot({ path: `/tmp/builder-2134/${command.slice(1)}-${width}.png`, animations: 'disabled' })
      }
    }
  } finally { stdout.off('data', observe) }
})
