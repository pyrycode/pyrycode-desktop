import type { Locator } from '@playwright/test'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentUploadEvent } from '../src/shared/ipc/attachmentUpload'
import type { SendMessagePayload } from '../src/shared/wire/types'

const TS = '2026-10-05T12:00:00Z'
const LONG = 'Long message uses the available thread width. '.repeat(45)
const SHORT = 'Hi'
let dequeues = 0
const frames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  if (envelope.type === 'dequeue_message') { dequeues++; return [] }
  if (envelope.type !== 'send_message') return [seedConversationsFrame()]
  const payload = envelope.payload as SendMessagePayload
  const turnId = payload.message_id
  return [
    encodeEnvelope({ id: 20, type: 'assistant_delta', ts: TS, payload: {
      conversation_id: SEEDED_ROW.id, turn_id: turnId, seq: 0, text: payload.text
    } }),
    encodeEnvelope({ id: 21, type: 'turn_end', ts: TS, payload: {
      conversation_id: SEEDED_ROW.id, turn_id: turnId, stop_reason: 'end_turn'
    } })
  ]
}

const geometry = (bubble: Locator) => bubble.evaluate(el => {
  const row = el.parentElement!
  const thread = row.parentElement!
  const actions = row.querySelector('.message-actions')!
  const copy = actions.querySelector('button[aria-label="Copy message"]')!
  const reply = actions.querySelector('button[aria-label="Reply to message"]')!
  const copyGlyph = copy.querySelector('svg')!
  const replyGlyph = reply.querySelector('.bubble__reply-icon')!
  const box = (node: Element) => {
    const r = node.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
  }
  const style = getComputedStyle(thread)
  return {
    bubble: box(el), row: box(row), actions: box(actions),
    copy: box(copy), reply: box(reply), copyGlyph: box(copyGlyph), replyGlyph: box(replyGlyph),
    available: thread.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    threadCenter: box(thread).x + parseFloat(style.paddingLeft) +
      (thread.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / 2,
    overflow: thread.scrollWidth - thread.clientWidth
  }
})

const dimensions = (bubble: Locator) => bubble.evaluate(el => {
  const b = el.getBoundingClientRect()
  const r = el.parentElement!.getBoundingClientRect()
  return [b.width, b.height, r.width, r.height]
})

test('copy and reply do not increase short or multi-line bubble heights or neighbour gaps', async ({ launchPairedApp }) => {
  const { page, app } = await launchPairedApp({ buildReplyFrames: frames })
  for (const [index, text] of [SHORT, LONG.slice(0, 240), SHORT].entries()) {
    await page.getByPlaceholder('Message…').fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('.bubble__markdown')).toHaveCount(index + 1)
  }
  for (const width of [800, 1280]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 1000), width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    const measure = () => page.locator('.conversation__thread').evaluate(thread => {
      const rows = [...thread.querySelectorAll('.message-row--text')]
      return rows.map((row, index) => {
        const bubble = row.querySelector('.bubble')!.getBoundingClientRect()
        const rect = row.getBoundingClientRect()
        const previous = rows[index - 1]?.querySelector('.bubble')?.getBoundingClientRect()
        return { bubbleHeight: bubble.height, rowHeight: rect.height,
          gap: previous ? bubble.top - previous.bottom : null }
      })
    })
    const normal = await measure()
    // Force the ticket's taller-than-bubble stack: normal glyphs currently fit inside the meta slot.
    // This exercises intrinsic sizing independently of today's button dimensions.
    await page.locator('.message-actions button').evaluateAll(buttons => {
      buttons.forEach(button => button.style.minHeight = '60px')
    })
    const withActions = await measure()
    await page.locator('.message-actions').evaluateAll(columns => {
      columns.forEach(column => column.querySelectorAll('button').forEach(button => {
        button.style.display = 'none'
      }))
    })
    const withoutActions = await measure()
    expect(withActions).toEqual(withoutActions)
    expect(normal).toEqual(withoutActions)
    expect(withActions).toHaveLength(6)
    // The two roles each have a wrapped row between short rows; this guards the fixture.
    expect(withActions[2].bubbleHeight).toBeGreaterThan(withActions[0].bubbleHeight)
    expect(withActions[3].bubbleHeight).toBeGreaterThan(withActions[1].bubbleHeight)
    for (const row of withActions) expect(row.rowHeight).toBe(row.bubbleHeight)
    await page.locator('.message-actions button').evaluateAll(buttons => {
      buttons.forEach(button => {
        button.style.removeProperty('display')
        button.style.removeProperty('min-height')
      })
    })
    await page.locator('.bubble[data-thread-role="user"]').last().scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/builder-1896/messages-${width}.png`, animations: 'disabled' })
  }
})

test('copy and reply hover layers surround only the pointed glyph without changing layout or keyboard focus', async ({ launchPairedApp }) => {
  const { page, app } = await launchPairedApp({ buildReplyFrames: frames })
  await page.getByPlaceholder('Message…').fill(SHORT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.locator('.bubble__markdown')).toHaveCount(1)
  const layer = (button: Locator) => button.evaluate(el => {
    const style = getComputedStyle(el, '::before')
    const probe = document.createElement('span')
    probe.style.background = 'var(--color-state-hover)'
    el.append(probe)
    const fill = getComputedStyle(probe).backgroundColor
    probe.remove()
    return { content: style.content, fill: style.backgroundColor, expectedFill: fill,
      radius: style.borderRadius, top: parseFloat(style.top), bottom: parseFloat(style.bottom),
      left: parseFloat(style.left), right: parseFloat(style.right) }
  })
  const focus = (button: Locator) => button.evaluate(el => {
    const style = getComputedStyle(el)
    return { visible: el.matches(':focus-visible'), outline: style.outlineStyle,
      width: style.outlineWidth, color: style.outlineColor, radius: style.borderRadius }
  })
  for (const width of [800, 1280]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    for (const role of ['user', 'assistant']) {
      const bubble = page.locator(`.bubble[data-thread-role="${role}"]`)
      const row = bubble.locator('..')
      const copy = row.getByRole('button', { name: 'Copy message' })
      const reply = row.getByRole('button', { name: 'Reply to message' })
      await bubble.scrollIntoViewIfNeeded()
      await page.mouse.move(0, 0)
      await page.getByPlaceholder('Message…').focus()
      // Keep metadata revealed so this test isolates action paint geometry.
      await copy.focus()
      const before = await geometry(bubble)
      for (const [button, sibling, box, glyph, name] of [
        [copy, reply, before.copy, before.copyGlyph, 'copy'],
        [reply, copy, before.reply, before.replyGlyph, 'reply']
      ] as const) {
        expect((await layer(button)).content).toBe('none')
        await button.hover()
        const hovered = await layer(button)
        expect(hovered.content).toBe('""')
        expect(hovered.fill).toBe(hovered.expectedFill)
        expect(hovered.radius).toBe('6px')
        expect(box.x + hovered.left).toBeCloseTo(glyph.x - 4, 5)
        expect(box.y + hovered.top).toBeCloseTo(glyph.y - 4, 5)
        expect(box.right - hovered.right).toBeCloseTo(glyph.right + 4, 5)
        expect(box.bottom - hovered.bottom).toBeCloseTo(glyph.bottom + 4, 5)
        expect((await layer(sibling)).content).toBe('none')
        expect(await geometry(bubble)).toEqual(before)
        if (role === 'assistant') await row.screenshot({ path: `/tmp/builder-1864/${name}-hover-${width}.png` })
        await page.mouse.move(0, 0)
        expect((await layer(button)).content).toBe('none')
        expect(await geometry(bubble)).toEqual(before)
      }
      // Enter keyboard modality and reach each action with a real Tab transition.
      await reply.focus()
      await page.keyboard.press('Shift+Tab')
      for (const button of [copy, reply]) {
        await expect(button).toBeFocused()
        const focused = await focus(button)
        expect(focused.visible).toBe(true)
        expect(focused.outline).toBe('solid')
        expect(focused.width).toBe('1px')
        expect(focused.color).toBe(await button.evaluate(el => {
          const probe = document.createElement('span')
          probe.style.color = 'var(--color-outline)'
          el.append(probe)
          const color = getComputedStyle(probe).color
          probe.remove()
          return color
        }))
        expect(focused.radius).toBe('9999px')
        expect((await layer(button)).content).toBe('none')
        expect(await geometry(bubble)).toEqual(before)
        if (role === 'assistant') await row.screenshot({ path: `/tmp/builder-1864/${button === copy ? 'copy' : 'reply'}-focus-${width}.png` })
        await page.keyboard.press('Tab')
      }
    }
  }
})

test('side copy and row cap retain sizing while metadata expands on hover and focus', async ({ launchPairedApp }) => {
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: frames })
  for (const text of [LONG, SHORT]) {
    await page.getByPlaceholder('Message…').fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('.bubble__markdown')).toHaveCount(text === SHORT ? 2 : 1)
  }
  const users = page.locator('.bubble[data-thread-role="user"]')
  const assistants = page.locator('.bubble[data-thread-role="assistant"]')
  for (const width of [800, 1280, 1800]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 1000), width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    for (const [bubbles, user] of [[users, true], [assistants, false]] as const) {
      const long = await geometry(bubbles.nth(0))
      const short = await geometry(bubbles.nth(1))
      expect(long.row.width).toBeCloseTo(Math.min(900, long.available), 0)
      expect(long.row.x + long.row.width / 2).toBeCloseTo(long.threadCenter, 0)
      expect(long.bubble.width).toBeCloseTo(long.row.width - 40 - 13 - 12, 0)
      expect(short.bubble.width).toBeLessThan(long.bubble.width)
      for (const g of [long, short]) {
        expect(g.actions.width).toBe(13)
        expect(g.actions.height).toBe(g.bubble.height)
        expect(g.copyGlyph.width).toBe(11)
        expect(g.copyGlyph.height).toBe(12)
        expect(g.replyGlyph.width).toBe(13)
        expect(g.replyGlyph.height).toBe(12)
        expect(g.replyGlyph.y - g.copyGlyph.bottom).toBeCloseTo(12, 0)
        expect((g.copyGlyph.y + g.replyGlyph.bottom) / 2).toBeCloseTo(g.bubble.y + g.bubble.height / 2, 0)
        for (const glyph of [g.copyGlyph, g.replyGlyph]) {
          expect(glyph.x + glyph.width / 2).toBeCloseTo(g.actions.x + g.actions.width / 2, 0)
        }
        expect(g.copy.bottom).toBeLessThanOrEqual(g.reply.y)
        expect(g.reply.y - g.copy.bottom).toBeCloseTo(4, 0)
        expect(user ? g.bubble.x - g.actions.right : g.actions.x - g.bubble.right).toBeCloseTo(12, 0)
        expect(user ? g.bubble.right - g.row.right : g.bubble.x - g.row.x).toBeCloseTo(0, 0)
        expect(g.overflow).toBeLessThanOrEqual(1)
      }
    }
    await users.nth(1).scrollIntoViewIfNeeded()
    await page.mouse.move(0, 0)
    await page.getByPlaceholder('Message…').focus()
    await page.screenshot({ path: `/tmp/builder-1778/messages-${width}.png`, animations: 'disabled' })
  }

  // The pointer can be over empty row space; focus can be inside copy or an attachment.
  for (const bubble of [users.nth(1), assistants.nth(1)]) {
    const row = bubble.locator('..')
    const time = bubble.locator('.bubble__meta-time')
    const copy = row.getByRole('button', { name: 'Copy message' })
    await bubble.scrollIntoViewIfNeeded()
    await page.mouse.move(0, 0)
    await page.getByPlaceholder('Message…').focus()
    await expect(time).toBeHidden()
    const size = await dimensions(bubble)
    await row.hover({ position: { x: 2, y: 2 } })
    await expect(time).toBeVisible()
    expect((await dimensions(bubble))[1]).toBeGreaterThan(size[1])
    await page.mouse.move(0, 0)
    await expect(time).toBeHidden()
    await page.keyboard.press('Tab')
    await copy.focus()
    await expect(time).toBeVisible()
    expect((await dimensions(bubble))[1]).toBeGreaterThan(size[1])
    expect(await copy.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')
    if (await bubble.getAttribute('data-thread-role') === 'assistant') await page.screenshot({ path: '/tmp/builder-1778/messages-focus-1800.png' })
    const ink = await copy.evaluate(el => getComputedStyle(el).color)
    const token = await row.locator('.message-actions').evaluate(el => getComputedStyle(el).color)
    expect(ink).toBe(token)
    await copy.hover()
    expect(await copy.evaluate(el => getComputedStyle(el).color)).toBe(ink)
    await page.mouse.down()
    expect(await copy.evaluate(el => getComputedStyle(el).color)).toBe(ink)
    await page.mouse.up()
    await page.getByPlaceholder('Message…').focus()
    await page.mouse.move(0, 0)
    await expect(time).toBeHidden()
    expect(await dimensions(bubble)).toEqual(size)
    await expect(bubble.locator('.bubble__meta button')).toHaveCount(0)
  }

  // Upload completion is the production IPC event seam used by attachment-file-row.spec.ts.
  await app.evaluate(({ BrowserWindow }, payload) => {
    BrowserWindow.getAllWindows()[0].webContents.send(payload.channel, payload.event)
  }, { channel: ATTACHMENT_UPLOAD_EVENT_CHANNEL, event: {
    type: 'completed', uploadId: 'side-copy-upload', filename: 'report.pdf'
  } satisfies AttachmentUploadEvent })
  await page.getByPlaceholder('Message…').fill('Attached report')
  await page.getByRole('button', { name: 'Send' }).click()
  const attached = users.last()
  const attachment = attached.locator('.bubble__file')
  await expect(attachment).toBeVisible()
  await page.mouse.move(0, 0)
  await page.getByPlaceholder('Message…').focus()
  const attachedSize = await dimensions(attached)
  await expect(attached.locator('.bubble__meta-time')).toBeHidden()
  await attachment.focus()
  await expect(attached.locator('.bubble__meta-time')).toBeVisible()
  expect((await dimensions(attached))[1]).toBeGreaterThan(attachedSize[1])

  daemon.pushFrame(encodeEnvelope({ id: 30, type: 'assistant_delta', ts: TS, payload: {
    conversation_id: SEEDED_ROW.id, turn_id: 'stream', seq: 0, text: 'Streaming partial reply'
  } }))
  const tail = assistants.last()
  await expect(tail.locator('.bubble__cursor')).toBeVisible()
  await tail.locator('..').getByRole('button', { name: 'Copy message' }).click()
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Streaming partial reply')

  daemon.pushFrame(encodeEnvelope({ id: 31, type: 'queue_state', ts: TS, payload: {
    conversation_id: SEEDED_ROW.id, queued: [{ queued_msg_id: 1, text: LONG, ts: TS }]
  } }))
  const queued = page.locator('.message-row--queued')
  await expect(queued).toBeVisible()
  await expect(queued.locator('.message-actions--queued')).toHaveCount(1)
  await expect(queued.locator('.bubble__copy, .bubble__meta')).toHaveCount(0)
  const q = await queued.evaluate(el => {
    const b = el.querySelector('.bubble')!.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const actions = el.querySelector('.message-actions--queued')!.getBoundingClientRect()
    const drop = el.querySelector('.queued-row__drop-icon')!.getBoundingClientRect()
    return { width: r.width, bubbleWidth: b.width, actionsWidth: actions.width,
      inset: getComputedStyle(el).paddingLeft, opacity: getComputedStyle(el).opacity, bubbleOpacity: getComputedStyle(el.querySelector('.bubble')!).opacity,
      gap: b.x - actions.right, centered: drop.y + drop.height / 2 - b.y - b.height / 2 }
  })
  expect(q.width).toBe(900)
  expect(q.bubbleWidth).toBeCloseTo(900 - 40 - q.actionsWidth - 12, 0)
  expect(q.inset).toBe('40px')
  expect(q.opacity).toBe('1')
  expect(q.bubbleOpacity).toBe('0.5')
  expect(q.actionsWidth).toBe(12)
  expect(q.gap).toBeCloseTo(12, 0)
  expect(q.centered).toBeCloseTo(0, 0)
  await queued.getByRole('button', { name: 'Drop queued message' }).click()
  await expect.poll(() => dequeues).toBe(1)

  // Standalone file offers share base row classes but keep their original width and chrome.
  daemon.pushFrame(encodeEnvelope({ id: 32, type: 'attachment_offered', ts: TS, payload: {
    conversation_id: SEEDED_ROW.id,
    attachment_id: '4a5b6c7d-8e9f-4a0b-8c9d-4e5f6a7b8c9d',
    filename: 'report'.repeat(40) + '.pdf'
  } }))
  const offer = page.locator('.bubble--attachment-offer')
  await expect(offer).toBeVisible()
  await expect(offer.locator('..')).not.toHaveClass(/message-row--text/)
  await expect(offer.locator('..').locator('.message-actions, .bubble__meta')).toHaveCount(0)
  const offered = await offer.evaluate(el => ({
    rowWidth: el.parentElement!.getBoundingClientRect().width,
    bubbleWidth: el.getBoundingClientRect().width,
    bubblePadding: parseFloat(getComputedStyle(el).paddingLeft) + parseFloat(getComputedStyle(el).paddingRight),
    padding: getComputedStyle(el.parentElement!).paddingRight
  }))
  expect(offered.rowWidth).toBeGreaterThan(900)
  expect(offered.bubbleWidth).toBeLessThanOrEqual(680 + offered.bubblePadding)
  expect(offered.padding).toBe('0px')

})
