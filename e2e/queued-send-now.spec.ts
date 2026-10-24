import { isDeepStrictEqual } from 'node:util'
import type { Locator } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, SendMessagePayload, SessionSettingsPayload } from '../src/shared/wire/types'
import { createCanonicalThread } from './fixtures/canonicalThread'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

// #1726, fake transport: Send now on a queued row. The session-settings reply reports
// `mid_turn_input: true`, a message is queued behind a running turn, and Send now is clicked. The click
// sends exactly one `send_queued_now` naming the queue handle and writes nothing to the thread;
// an authoritative delivered revision changes the same item into one user row.
// Every assertion reads DOM roles/counts and captured frames; the texts and ids are non-secret literals.
const ROUNDTRIP_TIMEOUT_MS = 15_000
const FIXED_TS = '2026-10-05T12:00:00.000Z'
const QUEUED_TEXT = 'Send me now please'
const SESSION = 'session-1726'
const route = { conversation_id: SEEDED_ROW.id, epoch: 'queue-actions' }
const frame = (update: ThreadUpdate): Uint8Array => encodeEnvelope({ id: 1, ts: FIXED_TS, ...update })
const item = (id: number, kind: 'user_message' | 'assistant_message',
  status: 'queued' | 'delivered' | 'finished', content: Record<string, unknown>): ThreadItem => ({
  id, order: id, rev: 1, kind, status, active: status === 'queued', shown: true,
  summary: '', session: SESSION, content
})

const queuedGeometry = (row: Locator) => row.evaluate(el => {
  const bubble = el.querySelector('.bubble')!
  const actions = el.querySelector('.message-actions--queued')!
  const thread = el.parentElement!
  const box = (node: Element) => {
    const r = node.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
  }
  const glyphs = [...actions.querySelectorAll('button > span')].map(box)
  const buttons = [...actions.querySelectorAll('button')].map(button => ({
    ...box(button), opacity: getComputedStyle(button).opacity, color: getComputedStyle(button).color
  }))
  return { row: box(el), bubble: box(bubble), actions: box(actions), glyphs, buttons,
    opacity: getComputedStyle(el).opacity, bubbleOpacity: getComputedStyle(bubble).opacity,
    actionsOpacity: getComputedStyle(actions).opacity, tint: getComputedStyle(actions).color,
    thread: box(thread), overflow: thread.scrollWidth - thread.clientWidth }
})

const hoverLayer = (button: Locator) => button.evaluate(el => {
  const layer = getComputedStyle(el, '::before')
  const probe = document.createElement('span')
  probe.style.background = 'var(--color-state-hover)'
  probe.style.color = 'var(--color-inverse-primary)'
  el.append(probe)
  const fill = getComputedStyle(probe).backgroundColor
  const tint = getComputedStyle(probe).color
  probe.remove()
  return { content: layer.content, fill: layer.backgroundColor, expectedFill: fill, tint,
    radius: layer.borderRadius, opacity: layer.opacity, top: parseFloat(layer.top),
    bottom: parseFloat(layer.bottom), left: parseFloat(layer.left), right: parseFloat(layer.right) }
})

test('queued actions keep Figma geometry, full opacity, isolated hover and keyboard focus at 800 and 1280', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const thread = createCanonicalThread({ conversations: [{ summary: { ...SEEDED_ROW,
    current_session_id: SESSION }, epoch: route.epoch, version: 1,
    items: [item(10, 'assistant_message', 'finished', { text: 'Earlier reply' })] }] })
  const { page, app, daemon } = await launchPairedApp({ threadMode: 'canonical', thread,
    helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
    const envelope = decodeEnvelope(bytes)
    captured.push(envelope)
    if (envelope.type === 'request_session_settings') return [sessionSettingsFrame(envelope.id)]
    return []
  } })
  await expect(page.locator('.composer__context')).toHaveText('Context: 25%')
  await expect(page.locator('[data-thread-role="assistant"]')).toHaveCount(1)
  expect(captured.find(e => e.type === 'thread_catch_up')?.payload).toMatchObject({
    conversation_id: SEEDED_ROW.id, version: 0
  })
  daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 2,
    item: item(20, 'user_message', 'queued', { queued_msg_id: 1, text: 'Hi', ts: FIXED_TS }) } }))
  daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 3,
    item: item(30, 'user_message', 'queued', { queued_msg_id: 2,
      text: 'Wrapping queued message stays inside the thread. '.repeat(6) + 'x'.repeat(90), ts: FIXED_TS }) } }))
  const rows = page.locator('.message-row--queued')
  await expect(rows).toHaveCount(2)
  for (const width of [800, 1280]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    for (const index of [0, 1]) {
      const row = rows.nth(index)
      const send = row.getByRole('button', { name: 'Send queued message now' })
      const cancel = row.getByRole('button', { name: 'Drop queued message' })
      await row.scrollIntoViewIfNeeded()
      await page.mouse.move(0, 0)
      await page.getByPlaceholder('Message…').focus()
      const before = await queuedGeometry(row)
      expect(before.actions.width).toBe(12)
      expect(before.actions.height).toBe(before.bubble.height)
      expect(before.bubble.x - before.actions.right).toBeCloseTo(12, 5)
      expect(before.glyphs[1].y - before.glyphs[0].y).toBeCloseTo(25, 5)
      expect((before.glyphs[0].y + before.glyphs[1].bottom) / 2)
        .toBeCloseTo(before.bubble.y + before.bubble.height / 2, 5)
      expect(before.row.x).toBeGreaterThanOrEqual(before.thread.x)
      expect(before.bubble.right).toBeLessThanOrEqual(before.thread.right)
      expect(before.overflow).toBeLessThanOrEqual(1)
      expect(before.bubbleOpacity).toBe('0.5')
      expect(before.opacity).toBe('1')
      expect(before.actionsOpacity).toBe('1')
      if (index === 0) expect(before.bubble.height).toBe(52)
      else expect(before.bubble.height).toBeGreaterThan(52)
      await page.screenshot({ path: `/tmp/builder-2221/queued-rest-${width}-${index}.png` })
      for (const [button, sibling, ordinal] of [[send, cancel, 0], [cancel, send, 1]] as const) {
        const glyph = before.glyphs[ordinal]
        const bounds = before.buttons[ordinal]
        expect(glyph.width).toBe(12)
        expect(glyph.height).toBe(12)
        expect(bounds.opacity).toBe('1')
        expect(bounds.color).toBe((await hoverLayer(button)).tint)
        expect((await hoverLayer(button)).content).toBe('none')
        await button.hover()
        const hovered = await hoverLayer(button)
        expect(hovered.content).toBe('""')
        expect(hovered.fill).toBe(hovered.expectedFill)
        expect(hovered.radius).toBe('6px')
        expect(hovered.opacity).toBe('1')
        expect(bounds.x + hovered.left).toBeCloseTo(glyph.x - 4, 5)
        expect(bounds.y + hovered.top).toBeCloseTo(glyph.y - 4, 5)
        expect(bounds.right - hovered.right).toBeCloseTo(glyph.right + 4, 5)
        expect(bounds.bottom - hovered.bottom).toBeCloseTo(glyph.bottom + 4, 5)
        expect((await hoverLayer(sibling)).content).toBe('none')
        expect(await queuedGeometry(row)).toEqual(before)
        if (index === 0) await row.screenshot({ path: `/tmp/builder-2221/queued-hover-${width}-${ordinal}.png` })
        await page.mouse.move(0, 0)
        expect((await hoverLayer(button)).content).toBe('none')
      }
      await cancel.focus()
      await page.keyboard.press('Shift+Tab')
      for (const [ordinal, button] of [send, cancel].entries()) {
        await expect(button).toBeFocused()
        const focus = await button.evaluate(el => {
          const style = getComputedStyle(el)
          return { visible: el.matches(':focus-visible'), outline: style.outlineStyle, width: style.outlineWidth }
        })
        expect(focus).toEqual({ visible: true, outline: 'solid', width: '1px' })
        expect((await hoverLayer(button)).content).toBe('none')
        expect(await queuedGeometry(row)).toEqual(before)
        if (index === 0) await row.screenshot({ path: `/tmp/builder-2221/queued-focus-${width}-${ordinal}.png` })
        await page.keyboard.press('Tab')
      }
    }
  }
  expect(captured.filter(e => e.type === 'request_history')).toHaveLength(0)
})

function sessionSettingsFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: 900,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    session_id: SESSION,
    payload: {
      session_id: SESSION,
      model: 'seeded-model',
      effort: 'low',
      yolo: false,
      permission_mode: 'default',
      used_tokens: 50_000,
      window_tokens: 200_000,
      capabilities: { slash_commands: true, mcp_servers: true, context_usage_detail: true, mid_turn_input: true }
    } satisfies SessionSettingsPayload
  })
}

test('Send now sends one send_queued_now and keeps the message one row through delivery (#1726)', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const thread = createCanonicalThread({ conversations: [{ summary: { ...SEEDED_ROW,
    current_session_id: SESSION }, epoch: route.epoch, version: 1,
    items: [item(10, 'assistant_message', 'finished', { text: 'Send-now route ready' })] }] })
  const { page, daemon } = await launchPairedApp({
    threadMode: 'canonical', thread, helloAck: { capabilities: ['interactive', 'thread'] },
    buildReplyFrames: (bytes) => {
      const envelope = decodeEnvelope(bytes)
      captured.push(envelope)
      if (envelope.type === 'request_session_settings') return [sessionSettingsFrame(envelope.id)]
      return []
    }
  })
  const push = (type: string, payload: Record<string, unknown>): void => daemon.pushFrame(encodeEnvelope({
    id: 1, type, ts: FIXED_TS, session_id: SESSION, payload: { conversation_id: SEEDED_ROW.id, ...payload }
  }))
  const sent = (): SendMessagePayload[] =>
    captured.filter((e) => e.type === 'send_message').map((e) => e.payload as SendMessagePayload)
  const framesOf = (type: string): Envelope[] => captured.filter((e) => e.type === type)

  // The context reading arrives in the same reply as the flags, so once it shows the flag is held too.
  await expect(page.locator('.composer__context')).toHaveText('Context: 25%', { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.getByText('Send-now route ready', { exact: true })).toBeVisible()
  expect(framesOf('thread_catch_up')[0]?.payload).toMatchObject({ conversation_id: SEEDED_ROW.id, version: 0 })
  const identity = await page.evaluate(() => window.pyry.deviceIdentity())
  expect(identity.ok).toBe(true)
  if (!identity.ok) throw new Error('authenticated device identity unavailable')

  const composer = page.getByPlaceholder('Message…')
  await composer.fill('Start the first task')
  await composer.press('Enter')
  await expect.poll(() => sent().length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 2,
    item: item(20, 'user_message', 'delivered', { text: 'Start the first task',
      message_id: sent()[0].message_id, device_id: identity.deviceId, ts: FIXED_TS }) } }))
  push('turn_state', { state: 'responding' })
  await composer.fill(QUEUED_TEXT)
  await composer.press('Enter')
  await expect.poll(() => sent().length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(2)
  const messageId = sent()[1]?.message_id
  expect(messageId).toEqual(expect.any(String))
  const acceptedContent = { message_id: messageId, device_id: identity.deviceId, text: QUEUED_TEXT, ts: FIXED_TS }
  daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 3,
    item: item(30, 'user_message', 'queued', { ...acceptedContent, queued_msg_id: 1 }) } }))

  const queuedRow = page.locator('.conversation__thread .message-row--queued', { hasText: QUEUED_TEXT })
  const sendNow = queuedRow.getByRole('button', { name: 'Send queued message now' })
  const drop = queuedRow.getByRole('button', { name: 'Drop queued message' })
  const rowsFor = page.locator('[data-thread-role="user"], [data-thread-role="queued"]', { hasText: QUEUED_TEXT })
  await expect(queuedRow).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(sendNow).toBeEnabled()
  await expect(drop).toBeEnabled()

  // Reachable with Tab: from the thread itself, a bounded walk forward lands on Send now.
  await page.locator('.conversation__thread').focus()
  let reached = false
  for (let i = 0; i < 25 && !reached; i += 1) {
    await page.keyboard.press('Tab')
    reached = await sendNow.evaluate((el) => el === document.activeElement)
  }
  expect(reached).toBe(true)

  const userRowsBefore = await page.locator('[data-thread-role="user"]').count()
  await sendNow.click()
  await expect.poll(() => framesOf('send_queued_now').length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  expect(isDeepStrictEqual(framesOf('send_queued_now')[0]?.payload, {
    conversation_id: SEEDED_ROW.id, queued_msg_id: 1
  })).toBe(true)
  expect(framesOf('dequeue_message')).toHaveLength(0)
  expect(sent()).toHaveLength(2)

  // The click wrote nothing: the row is still queued with both controls, and no row appeared or left.
  await expect(queuedRow).toHaveCount(1)
  await expect(sendNow).toBeVisible()
  await expect(drop).toBeVisible()
  await expect(rowsFor).toHaveCount(1)
  await expect(page.locator('[data-thread-role="user"]')).toHaveCount(userRowsBefore)

  // Delivery revises the same daemon item, retaining authenticated message identity.
  daemon.pushFrame(frame({ type: 'thread_item_changed', payload: { ...route, version: 4,
    item_id: 30, base_rev: 1, rev: 2, changes: { status: 'delivered', active: false, content: acceptedContent } } }))
  await expect(queuedRow).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(rowsFor).toHaveCount(1)
  await expect(page.locator('[data-thread-role="user"]', { hasText: QUEUED_TEXT })).toHaveCount(1)
  // A later authoritative delivery of that identity must not add a second row.
  daemon.pushFrame(frame({ type: 'thread_item_changed', payload: { ...route, version: 5,
    item_id: 30, base_rev: 2, rev: 3, changes: { status: 'delivered', content: acceptedContent } } }))
  daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 6,
    item: item(40, 'assistant_message', 'finished', { text: 'Read it mid-turn.' }) } }))
  await expect(page.locator('[data-thread-role="assistant"]', { hasText: 'Read it mid-turn.' }))
    .toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(rowsFor).toHaveCount(1)
  await expect(page.locator('[data-thread-role="user"]', { hasText: QUEUED_TEXT })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Send queued message now' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Drop queued message' })).toHaveCount(0)
  expect(framesOf('send_queued_now')).toHaveLength(1)
  expect(framesOf('dequeue_message')).toHaveLength(0)
  expect(sent()).toHaveLength(2)
  expect(framesOf('request_history')).toHaveLength(0)
})
