import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import { capturePairedApp } from './fixtures/capturePairedApp'
import type { Page } from '@playwright/test'

const frame = (type: Parameters<typeof encodeEnvelope>[0]['type'], payload: unknown) =>
  encodeEnvelope({ id: 1733, type, ts: '2026-10-03T12:00:00Z', payload })
const replies = () => Array.from({ length: 24 }, (_, index) => [
  frame('assistant_delta', { conversation_id: SEEDED_ROW.id, turn_id: `t-${index}`, seq: 0,
    text: `Synthetic reply ${index}. Messages remain readable through the translucent controls.\nSecond line of the reply.` }),
  frame('turn_end', { conversation_id: SEEDED_ROW.id, turn_id: `t-${index}`, stop_reason: 'end_turn' })
]).flat()
const boxes = (page: Page) => page.evaluate(() => {
  const rect = (selector: string) => {
    const node = document.querySelector(selector)
    if (!node) throw new Error(`Missing ${selector}`)
    const r = node.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }
  }
  const thread = document.querySelector<HTMLElement>('.conversation__thread')!
  return { pane: rect('.conversation'), thread: rect('.conversation__thread'),
    header: rect('.conversation__overflow'), input: rect('.composer'),
    last: rect('.conversation__thread > :last-child'), first: rect('.conversation__thread > :first-child'),
    distance: thread.scrollHeight - thread.clientHeight - thread.scrollTop }
})
const clearBottom = async (page: Page) => {
  await expect.poll(async () => (await boxes(page)).distance).toBeLessThanOrEqual(2)
  await expect.poll(async () => {
    const b = await boxes(page)
    return b.last.bottom - b.input.top + 12
  }).toBeLessThanOrEqual(1)
}

for (const size of [{ width: 1280, height: 800 }, { width: 800, height: 600 }]) {
  test(`translucent controls overlap rows and track occupied height at ${size.width}`, async ({ launchPairedApp }) => {
    const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
      const env = decodeEnvelope(bytes)
      if (env.type === 'send_message') return [...replies(), frame('turn_state', {
        conversation_id: SEEDED_ROW.id, state: 'idle'
      })]
      return [seedConversationsFrame()]
    } })
    await app.evaluate(({ BrowserWindow }, dimensions) => {
      BrowserWindow.getAllWindows()[0].setSize(dimensions.width, dimensions.height)
    }, size)
    await page.getByRole('textbox', { name: 'Message…', exact: true }).fill('Synthetic primer')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.locator('[data-thread-role="assistant"]')).toHaveCount(24)
    let b = await boxes(page)
    expect(b.thread.top).toBe(b.pane.top)
    expect(b.thread.bottom).toBe(b.pane.bottom)
    await clearBottom(page)
    await capturePairedApp(app, page, `/tmp/builder-1733/resting-${size.width}.png`)

    await page.locator('.conversation__thread').evaluate(node => { node.scrollTop = 0 })
    await expect.poll(async () => (await boxes(page)).first.top).toBe(b.pane.top + 97)
    b = await boxes(page)
    expect(b.first.left).toBe(b.pane.left + 20)
    await page.locator('.conversation__thread').evaluate(node => { node.scrollTop = 55 })
    b = await boxes(page)
    expect(b.first.top).toBeLessThan(b.header.bottom)
    expect(b.first.bottom).toBeGreaterThan(b.header.top)
    await capturePairedApp(app, page, `/tmp/builder-1733/under-header-${size.width}.png`)
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Channel info', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.locator('.conversation__thread').evaluate(node => { node.scrollTop = node.scrollHeight - node.clientHeight - 110 })
    b = await boxes(page)
    expect(b.last.bottom).toBeGreaterThan(b.input.top)
    await capturePairedApp(app, page, `/tmp/builder-1733/under-composer-${size.width}.png`)
    await page.getByRole('button', { name: 'Actions', exact: true }).click()
    const footerMenu = page.getByRole('menu', { name: 'Actions', exact: true })
    await expect(footerMenu).toBeVisible()
    const compact = footerMenu.getByRole('menuitem', { name: 'Compact session', exact: true })
    const menuRect = await footerMenu.boundingBox()
    const itemRect = await compact.boundingBox()
    if (!menuRect || !itemRect) throw new Error('Missing footer menu geometry')
    expect(menuRect.x).toBeGreaterThanOrEqual(b.pane.left)
    expect(menuRect.x + menuRect.width).toBeLessThanOrEqual(b.pane.right)
    expect(itemRect.y).toBeLessThan(b.last.bottom)
    expect(itemRect.y + itemRect.height).toBeGreaterThan(b.last.top)
    await compact.click()
    await expect(footerMenu).toHaveCount(0)
    await page.getByRole('button', { name: 'Actions', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(footerMenu).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Actions', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Actions', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message…', exact: true }).click()
    await expect(footerMenu).toHaveCount(0)
    // The successful menu command resumes following too. Park again before testing held updates.
    await clearBottom(page)
    await page.locator('.conversation__thread').evaluate(node => {
      node.scrollTop = node.scrollHeight - node.clientHeight - 110
    })
    await page.evaluate(() => new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    b = await boxes(page)
    const input = page.getByRole('textbox', { name: 'Message…', exact: true })
    const target = await input.boundingBox()
    if (!target) throw new Error('Missing composer input box')
    expect(b.last.bottom).toBeGreaterThan(target.y + 5)
    await input.click({ position: { x: 10, y: 5 } })
    await input.fill('One\nTwo\nThree\nFour\nFive\nSix')
    const held = await page.locator('.conversation__thread').evaluate(node => node.scrollTop)
    daemon.pushFrame(frame('assistant_delta', { conversation_id: SEEDED_ROW.id, turn_id: 'held', seq: 0, text: 'Held new reply' }))
    await expect(page.locator('[data-thread-role="assistant"]').filter({ hasText: 'Held new reply' })).toBeVisible()
    expect(await page.locator('.conversation__thread').evaluate(node => node.scrollTop)).toBe(held)
    await input.fill('Resume following')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await clearBottom(page)
    await input.fill('One\nTwo\nThree\nFour\nFive\nSix')
    await expect.poll(async () => (await boxes(page)).input.height).toBeGreaterThan(140)
    await clearBottom(page)
    await capturePairedApp(app, page, `/tmp/builder-1733/expanded-${size.width}.png`)
    await input.fill('Shrunk')
    await clearBottom(page)
    await app.evaluate(({ BrowserWindow }, channel) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel, {
        type: 'completed', uploadId: 'synthetic-file', filename: 'synthetic.pdf'
      })
    }, ATTACHMENT_UPLOAD_EVENT_CHANNEL)
    await expect(page.getByRole('button', { name: 'Remove attachment', exact: true })).toBeVisible()
    await clearBottom(page)
    await page.getByRole('button', { name: 'Remove attachment', exact: true }).click()
    await clearBottom(page)
    daemon.pushFrame(frame('question_shown', { conversation_id: SEEDED_ROW.id,
      question_batch_id: 'synthetic-question', questions: [{ header: 'Choice', question: 'Pick a synthetic option',
        options: [{ label: 'First', description: 'Synthetic first option' },
          { label: 'Second', description: 'Synthetic second option' }], multi_select: false }] }))
    await expect(page.locator('.question-panel')).toBeVisible()
    await expect.poll(async () => page.locator('.conversation__thread').evaluate(node =>
      node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(2)
    await expect.poll(() => page.evaluate(() => {
      const last = document.querySelector('.conversation__thread > :last-child')!.getBoundingClientRect()
      const input = document.querySelector('.conversation__input-chrome')!.getBoundingClientRect()
      return input.top - last.bottom
    })).toBeGreaterThanOrEqual(-1)
    await page.locator('.question-panel__option').first().click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('.question-panel')).toHaveCount(0)
    await clearBottom(page)
    await app.evaluate(({ BrowserWindow }, dimensions) => {
      BrowserWindow.getAllWindows()[0].setSize(dimensions.width, dimensions.height)
    }, size.width === 1280 ? { width: 800, height: 600 } : { width: 1280, height: 800 })
    await clearBottom(page)
    await app.evaluate(({ BrowserWindow }, dimensions) => {
      BrowserWindow.getAllWindows()[0].setSize(dimensions.width, dimensions.height)
    }, size)
    await clearBottom(page)
    for (const zoom of [1.25, 1]) {
      await app.evaluate(({ BrowserWindow }, factor) => {
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor)
      }, zoom)
      await clearBottom(page)
      await input.fill('One\nTwo\nThree\nFour')
      await clearBottom(page)
      await input.fill('Shrunk')
    }
  })
}

test('empty offline thread keeps pills below the occupied header', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp()
  daemon.pushFrame(frame('error', { code: 'auth.invalid_token', message: 'Synthetic rejection', retryable: false }))
  const pill = page.getByRole('button', { name: 'Pairing error - Re-pair', exact: true })
  await expect(pill).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const header = document.querySelector('.conversation__top-chrome')!.getBoundingClientRect()
    const pill = document.querySelector('.top-overlay-pill')!.getBoundingClientRect()
    return pill.top - header.bottom
  })).toBeGreaterThanOrEqual(0)
  await pill.click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
