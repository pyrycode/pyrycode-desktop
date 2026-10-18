import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW, FIRST_SERVER_ID, SECOND_SERVER_ID } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, Envelope, EnvelopeType } from '../src/shared/wire/types'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'

const ts = '2026-10-18T00:00:00Z'
const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number) =>
  encodeEnvelope({ id: 100, type, ts, payload, in_reply_to })
const updated = (row: ConversationSummary, reply?: number) => frame('conversation_updated', row, reply)
function host(initial: ConversationSummary[]) {
  let rows = initial
  let refuse = false
  const requests: Envelope[] = []
  const fallback = conversationStateFake({ conversations: initial })
  return {
    requests, rows: () => rows, set: (next: ConversationSummary[]) => { rows = next },
    refuse: () => { refuse = true },
    writes: () => requests.filter(r => r.type === 'set_conversation_pinned'),
    confirm(request: Envelope) {
      const p = request.payload as { conversation_id: string; pinned: boolean }
      rows = rows.map(r => r.id === p.conversation_id ? { ...r, pinned_at: p.pinned ? r.pinned_at ?? ts : null } : r)
      return updated(rows.find(r => r.id === p.conversation_id)!, request.id)
    },
    reply(bytes: Uint8Array) {
      const request = decodeEnvelope(bytes); requests.push(request)
      if (request.type === 'list_conversations') return [frame('conversations', { conversations: rows }, request.id)]
      if (request.type === 'set_conversation_pinned') return refuse
        ? [frame('error', { code: 'protocol.unknown_type', message: 'unsupported', retryable: false }, request.id)] : []
      return fallback(bytes)
    }
  }
}

test('sidebar pin actions route uniquely and wait for owning-host confirmation', async ({ launchPairedApp }) => {
  const aRows = [{ ...SEEDED_ROW, name: 'Zulu '.repeat(30), is_promoted: true, pinned_at: null },
    { ...SEEDED_ROW, id: 'alpha', name: 'Alpha', is_promoted: true, pinned_at: null },
    { ...SEEDED_ROW, id: 'chat', name: 'Chat', is_promoted: false }]
  // The shared launch drive opens exactly one seed before it pairs the second host.
  const a = host([aRows[0]])
  const b = host([{ ...SECOND_SEEDED_ROW, name: 'Beta', is_promoted: true, pinned_at: null }])
  const { page, app, servers } = await launchPairedApp({ buildReplyFrames: a.reply }, {
    hostLabel: 'Pyry', secondServer: { buildReplyFrames: b.reply }
  })
  const pinned = page.locator('.channel-list__pinned')
  const row = (name: string) => page.locator('.channel-list__row').filter({ has: page.locator('.channel-list__title').filter({ hasText: name }) })
  // Received list events fence both IPC processing and the rendered authoritative snapshot.
  await page.evaluate(() => {
    const probe = window as typeof window & { pinLists: Record<string, number> }
    probe.pinLists = {}
    window.pyry.onDaemonEvent(event => {
      if (event.type === 'conversationsReceived' && 'serverId' in event && typeof event.serverId === 'string')
        probe.pinLists[event.serverId] = (probe.pinLists[event.serverId] ?? 0) + 1
    })
  })
  const barrier = async (serverId = FIRST_SERVER_ID) => {
    const before = await page.evaluate(id => (window as typeof window & { pinLists: Record<string, number> }).pinLists[id] ?? 0, serverId)
    await page.evaluate(serverId => window.pyry.sendCommand({ type: 'requestConversations', serverId }), serverId)
    await expect.poll(() => page.evaluate(id => (window as typeof window & { pinLists: Record<string, number> }).pinLists[id] ?? 0, serverId)).toBeGreaterThan(before)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  }
  a.set(aRows); await barrier()
  await expect(row('Chat').getByRole('button', { name: 'Pin channel', exact: true })).toHaveCount(0)
  const zulu = row('Zulu')
  for (const size of [{ width: 1280, height: 800 }, { width: 800, height: 600 }]) {
    await page.setViewportSize(size)
    await page.mouse.move(0, 0)
    const pin = zulu.getByRole('button', { name: 'Pin channel', exact: true })
    await expect(pin).toHaveCSS('opacity', '1')
    await expect(zulu.locator('.channel-list__rename')).toHaveCSS('opacity', '0')
    const boxes = await zulu.evaluate(el => {
      const box = (selector: string) => el.querySelector(selector)!.getBoundingClientRect().toJSON()
      return { title: box('.channel-list__title'), pin: box('.channel-list__pin'), pen: box('.channel-list__rename'),
        glyph: box('.channel-list__pin svg') }
    })
    expect(boxes.pin.width).toBe(boxes.pen.width); expect(boxes.pin.height).toBe(boxes.pen.height)
    expect(boxes.glyph.width).toBe(12); expect(boxes.glyph.height).toBe(12)
    expect(boxes.title.right).toBeLessThanOrEqual(boxes.pin.left)
    expect(boxes.pin.x).toBeLessThan(boxes.pen.x)
    expect(boxes.pin.right).toBeLessThanOrEqual(boxes.pen.left)
    await page.screenshot({ path: `/tmp/builder-2085/controls-${size.width}.png`, animations: 'disabled' })
  }
  await zulu.hover()
  await expect(zulu.locator('.channel-list__rename')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: '/tmp/builder-2085/hover-800.png', animations: 'disabled' })
  const selection = await page.locator('.channel-list__row-open[aria-current="true"]').allTextContents()
  await zulu.getByRole('button', { name: 'Pin channel', exact: true }).click()
  await expect.poll(() => a.writes().length).toBe(1)
  await barrier()
  await expect(pinned).toHaveCount(0)
  expect(await page.locator('.channel-list__row-open[aria-current="true"]').allTextContents()).toEqual(selection)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(a.writes()[0].payload).toEqual({ conversation_id: SEEDED_ROW.id, pinned: true })
  expect(b.writes()).toEqual([])
  const bLists = b.requests.filter(r => r.type === 'list_conversations').length
  await servers[0].daemon.pushFrame(a.confirm(a.writes()[0]))
  await expect(pinned.locator('.channel-list__row-open')).toContainText(['Zulu'])
  expect(b.requests.filter(r => r.type === 'list_conversations')).toHaveLength(bLists)
  // Repeated pin uses the same host contract and does not mint client timestamp/order state.
  await page.evaluate(({ serverId, id }) => window.pyry.sendCommand({ type: 'setConversationPinned', serverId,
    payload: { conversation_id: id, pinned: true } }), { serverId: FIRST_SERVER_ID, id: SEEDED_ROW.id })
  await expect.poll(() => a.writes().length).toBe(2)
  await servers[0].daemon.pushFrame(a.confirm(a.writes()[1]))
  await barrier(); expect(a.rows()[0].pinned_at).toBe(ts)
  await pinned.getByRole('button', { name: 'Unpin channel', exact: true }).focus()
  await pinned.getByRole('button', { name: 'Unpin channel', exact: true }).press('Enter')
  await expect.poll(() => a.writes().length).toBe(3)
  await barrier(); await expect(pinned).toBeVisible()
  expect(a.writes()[2].payload).toEqual({ conversation_id: SEEDED_ROW.id, pinned: false })
  await servers[0].daemon.pushFrame(a.confirm(a.writes()[2]))
  await expect(pinned).toHaveCount(0)
  await expect(page.locator('.channel-list__host-content .channel-list__row-open')).toHaveText(['Alpha', 'Zulu '.repeat(30).trim(), 'Chat', 'Beta'])
  // Another device's unsolicited pin still refreshes only its host.
  b.set(b.rows().map(r => ({ ...r, pinned_at: ts })))
  await servers[1].daemon.pushFrame(updated(b.rows()[0]))
  await expect(pinned.locator('.channel-list__row-open')).toHaveText(['Beta · Server'])
  b.refuse()
  await pinned.getByRole('button', { name: 'Unpin channel', exact: true }).click()
  await expect.poll(() => b.writes().length).toBe(1)
  await barrier(SECOND_SERVER_ID)
  await expect(pinned.locator('.channel-list__row-open')).toHaveText(['Beta · Server'])
  expect(b.writes()[0].payload).toEqual({ conversation_id: SECOND_SEEDED_ROW.id, pinned: false })
  // Unknown, mismatched and ambiguous ownership must not use an explicit-host bypass.
  for (const [conversation_id, serverId] of [['unknown', FIRST_SERVER_ID], [SEEDED_ROW.id, SECOND_SERVER_ID]])
    await page.evaluate(command => window.pyry.sendCommand(command), { type: 'setConversationPinned', serverId, payload: { conversation_id, pinned: true } })
  b.set([...b.rows(), { ...SEEDED_ROW, is_promoted: true, pinned_at: null }])
  await barrier(SECOND_SERVER_ID)
  await zulu.getByRole('button', { name: 'Pin channel', exact: true }).first().click()
  await barrier(); await barrier(SECOND_SERVER_ID)
  expect(a.writes()).toHaveLength(3); expect(b.writes()).toHaveLength(1)
  b.set(b.rows().filter(r => r.id !== SEEDED_ROW.id)); await barrier(SECOND_SERVER_ID)
  // Capture the pre-commit handler, then activate it after the status store consumes disconnect.
  await page.evaluate(({ first, second }) => {
    const probe = window as typeof window & { stalePins: string[] }; probe.stalePins = []
    for (const [label, host] of [['Pin channel', first], ['Unpin channel', second]]) {
      const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
      const props = Object.keys(button).find(k => k.startsWith('__reactProps'))!
      const handler = (button as unknown as Record<string, { onClick: () => void }>)[props].onClick
      const off = window.pyry.onDaemonEvent(event => {
        if (event.type === 'disconnected' && 'serverId' in event && event.serverId === host) {
          handler(); probe.stalePins.push(label); off()
        }
      })
    }
  }, { first: FIRST_SERVER_ID, second: SECOND_SERVER_ID })
  const status = async (type: 'disconnected' | 'connecting' | 'error', serverId = FIRST_SERVER_ID) => {
    await app.evaluate(({ BrowserWindow }, { channel, event }) => BrowserWindow.getAllWindows()[0].webContents.send(channel, event), {
      channel: DAEMON_EVENT_CHANNEL, event: type === 'error'
        ? { type, serverId, error: { code: 'transport', message: 'Offline', retryable: true } } : { type, serverId }
    })
  }
  await status('disconnected')
  await expect.poll(() => page.evaluate(() => (window as typeof window & { stalePins: string[] }).stalePins)).toEqual(['Pin channel'])
  await expect(zulu.getByRole('button', { name: 'Pin channel', exact: true })).toBeDisabled()
  await barrier(); expect(a.writes()).toHaveLength(3)
  for (const type of ['disconnected', 'error', 'connecting'] as const) {
    await status(type, SECOND_SERVER_ID)
    await expect(pinned.getByRole('button', { name: 'Unpin channel', exact: true })).toBeDisabled()
    await expect(pinned.locator('.channel-list__row')).toHaveCSS('opacity', type === 'connecting' ? '1' : '0.6')
    await pinned.getByRole('button', { name: 'Unpin channel', exact: true }).evaluate((el: HTMLButtonElement) => el.click())
    await barrier(SECOND_SERVER_ID); expect(b.writes()).toHaveLength(1)
    await page.screenshot({ path: `/tmp/builder-2085/${type}-800.png`, animations: 'disabled' })
  }
  await expect.poll(() => page.evaluate(() => (window as typeof window & { stalePins: string[] }).stalePins)).toEqual(['Pin channel', 'Unpin channel'])
  await page.screenshot({ path: '/tmp/builder-2085/connecting-800.png', animations: 'disabled' })
  await page.evaluate(serverId => window.pyry.reconnectServer(serverId), FIRST_SERVER_ID)
  await expect(zulu.getByRole('button', { name: 'Pin channel', exact: true })).toBeEnabled()
  await page.evaluate(serverId => window.pyry.reconnectServer(serverId), SECOND_SERVER_ID)
  await expect(pinned.getByRole('button', { name: 'Unpin channel', exact: true })).toBeEnabled()
  await zulu.getByRole('button', { name: 'Edit channel', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Edit channel', exact: true })).toBeVisible()
})
