import { createHash } from 'node:crypto'
import type { Page } from '@playwright/test'
import { capturePairedApp } from './fixtures/capturePairedApp'
import { MARKDOWN_OPEN_CHANNEL } from '../src/shared/ipc/markdownOpen'
import { MARKDOWN_SAVE_CHANNEL } from '../src/shared/ipc/markdownSave'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  AttachmentChunkPayload,
  SendMessagePayload,
  TurnEndPayload
} from '../src/shared/wire/types'

// #1630 — the markdown reader's menu, end to end: opening it, its order and disabled rows while the first
// fetch is in flight, closing on Escape / outside click / a choice, each copy flavour read back from the
// OS clipboard through the MAIN process (never a renderer clipboard read, which no permission grants),
// and Refresh replacing the note or keeping it under the static notice when the fetch fails. Stale
// answers are the reducer's and are proven in MarkdownReader.test.tsx.
//
// SIDE EFFECT, ACCEPTED (message-copy.spec.ts's reasoning): this overwrites the machine's clipboard with
// the invented note below. SECRET HYGIENE: every literal is an invented note.

const TIMEOUT_MS = 15_000
const FIXED_TS = '2026-07-07T12:00:00.000Z'
const NOTE_PATH = 'notes/Plan.md'
const REPLY = `Read [the plan](${NOTE_PATH}).`

// How the fake host answers the next read: withheld, served, or served with a digest that cannot match
// (the reassembler fails it closed as a real `failed` outcome).
let serve: 'hold' | 'ok' | 'broken' = 'hold'
let version = 0
let longNote = false
const noteText = (): string =>
  [
    `# Plan version ${version}`,
    '',
    'See [the refiner](https://example.com/refiner) and *tokens*.',
    '',
    '<script>alert(1)</script>',
    '',
    '<img src="x" onerror="alert(1)">'
  ].join('\n') + (longNote ? '\n\n' + Array.from({ length: 45 }, (_, i) =>
    `## Synthetic section ${i}\n\nText stays visible behind the fixed reader header. Tokens first, running time second.`
  ).join('\n\n') : '')
const plainText = (): string =>
  [
    `Plan version ${version}`,
    '',
    'See the refiner and tokens.',
    '',
    '<script>alert(1)</script>',
    '',
    '<img src="x" onerror="alert(1)">'
  ].join('\n')

function readReply(requestId: number): Uint8Array[] {
  if (serve === 'hold') return []
  if (serve === 'ok') version += 1
  const bytes = Buffer.from(noteText(), 'utf8')
  const payload: AttachmentChunkPayload = {
    attachment_id: '6b7c8d9e-0f1a-4b2c-8d3e-6f7a8b9c0d1e',
    index: 0,
    total_chunks: 1,
    filename: 'Plan.md',
    mime_type: 'text/markdown',
    size: bytes.length,
    sha256: serve === 'broken' ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex'),
    data: bytes.toString('base64')
  }
  return [
    encodeEnvelope({ id: 900 + requestId, type: 'attachment_chunk', ts: FIXED_TS, in_reply_to: requestId, payload })
  ]
}

const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  switch (envelope.type) {
    case 'read_workspace_file':
      return readReply(envelope.id)
    case 'send_message': {
      const { conversation_id } = envelope.payload as SendMessagePayload
      if (conversation_id !== SEEDED_ROW.id) return []
      return [
        encodeEnvelope({
          id: 99,
          type: 'assistant_delta',
          ts: FIXED_TS,
          payload: { conversation_id, turn_id: 'turn-1', seq: 0, text: REPLY } satisfies AssistantDeltaPayload
        }),
        encodeEnvelope({
          id: 100,
          type: 'turn_end',
          ts: FIXED_TS,
          payload: { conversation_id, turn_id: 'turn-1', stop_reason: 'end_turn' } satisfies TurnEndPayload
        })
      ]
    }
    default:
      return [seedConversationsFrame()]
  }
}

test('the reader menu copies the note three ways and refreshes it (#1630)', async ({ launchPairedApp }) => {
  const { page, app } = await launchPairedApp({ buildReplyFrames })
  const readText = (): Promise<string> => app.evaluate(({ clipboard }) => clipboard.readText())
  const readHtml = (): Promise<string> => app.evaluate(({ clipboard }) => clipboard.readHTML())
  await app.evaluate(({ clipboard }) => clipboard.writeText('sentinel-before-any-copy'))

  await page.getByPlaceholder('Message…').fill('where is the plan?')
  await page.getByRole('button', { name: 'Send' }).click()
  const planLink = page.locator('.bubble[data-thread-role="assistant"]').getByRole('button', { name: 'the plan' })
  await expect(planLink).toBeVisible({ timeout: TIMEOUT_MS })

  const reader = page.locator('.markdown-reader')
  const trigger = reader.getByRole('button', { name: 'Note actions' })
  const items = page.getByRole('menuitem')
  const item = (name: string) => page.getByRole('menuitem', { name })
  const confirmation = reader.locator('.markdown-reader__copied')
  const notice = reader.locator('.markdown-reader__notice')

  // --- 1. The first fetch is withheld: the button is already in the bar, the rows are in order, and
  // every row except Refresh is disabled. Escape closes the menu. ---
  await planLink.click()
  await expect(reader.locator('.markdown-reader__body[aria-busy="true"]')).toBeVisible({ timeout: TIMEOUT_MS })
  await trigger.click()
  await expect(items).toHaveCount(6)
  expect(await items.evaluateAll((rows) => rows.map((row) => row.firstChild?.textContent))).toEqual([
    'Copy as markdown',
    'Copy as plain text',
    'Copy as HTML',
    'Refresh',
    // #1631: listed and gated here, never chosen — an e2e run must not launch a real external app.
    'Open in another app',
    // #1632: likewise never chosen — an e2e run must not write into the real Downloads or open Finder.
    'Save to device'
  ])
  for (const name of ['Copy as markdown', 'Copy as plain text', 'Copy as HTML', 'Open in another app', 'Save to device']) {
    await expect(item(name)).toHaveAttribute('aria-disabled', 'true')
  }
  await expect(item('Refresh')).not.toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')
  await expect(items).toHaveCount(0)

  // --- 2. Refresh fetches again and the note arrives; the choice closes the menu. ---
  serve = 'ok'
  await trigger.click()
  await item('Refresh').click()
  await expect(items).toHaveCount(0)
  await expect(reader.locator('h1')).toHaveText('Plan version 1', { timeout: TIMEOUT_MS })
  // Raw HTML in the note is visible text, never markup.
  await expect(reader.locator('.bubble__markdown script, .bubble__markdown img')).toHaveCount(0)

  // --- 3. Copy as markdown: the raw file text, with the client's confirmation. ---
  await trigger.click()
  await item('Copy as markdown').click()
  await expect(items).toHaveCount(0)
  await expect.poll(readText, { timeout: TIMEOUT_MS }).toBe(noteText())
  await expect(confirmation).toHaveText('Copied to the clipboard.')

  // --- 4. Copy as plain text: the rendered text without markdown syntax. ---
  await trigger.click()
  await item('Copy as plain text').click()
  await expect.poll(readText, { timeout: TIMEOUT_MS }).toBe(plainText())

  // --- 5. Copy as HTML: the rendered HTML with raw HTML escaped, and the plain text as its fallback. ---
  await trigger.click()
  await item('Copy as HTML').click()
  await expect.poll(readHtml, { timeout: TIMEOUT_MS }).toContain('<h1>Plan version 1</h1>')
  const html = await readHtml()
  expect(html).toContain('<a href="https://example.com/refiner"')
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).not.toContain('<script')
  expect(html).not.toMatch(/<img/)
  expect(await readText()).toBe(plainText())

  // --- 6. A click outside the menu closes it. ---
  await trigger.click()
  await expect(items).toHaveCount(6)
  await expect(item('Open in another app')).not.toHaveAttribute('aria-disabled', 'true')
  await expect(item('Save to device')).not.toHaveAttribute('aria-disabled', 'true')
  await reader.locator('h1').click()
  await expect(items).toHaveCount(0)

  // --- 7. A failed refresh keeps the reader and its content, with the static notice inside it. ---
  serve = 'broken'
  await trigger.click()
  await item('Refresh').click()
  await expect(notice).toHaveText('Could not open the file.', { timeout: TIMEOUT_MS })
  await expect(reader).toBeVisible()
  await expect(reader.locator('h1')).toHaveText('Plan version 1')
  expect((await notice.textContent()) ?? '').not.toContain('Plan.md')

  // --- 8. A later successful refresh replaces the content and clears the notice. ---
  serve = 'ok'
  await trigger.click()
  await item('Refresh').click()
  await expect(reader.locator('h1')).toHaveText('Plan version 2', { timeout: TIMEOUT_MS })
  await expect(notice).toHaveCount(0)
})

const readerGeometry = (page: Page) => page.evaluate(() => {
  const rect = (selector: string) => {
    const r = document.querySelector(selector)!.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }
  }
  const body = document.querySelector<HTMLElement>('.markdown-reader__body')!
  return { pane: rect('.conversation'), body: rect('.markdown-reader__body'),
    first: rect('.markdown-reader h1'), last: rect('.markdown-reader .bubble__markdown > :last-child'),
    padding: parseFloat(getComputedStyle(body).paddingTop), scrollTop: body.scrollTop }
})

for (const size of [{ width: 1280, height: 800 }, { width: 800, height: 600 }]) {
  test(`reader scrolls under sharp chrome with dynamic clearance and input at ${size.width}`, async ({ launchPairedApp }) => {
    test.setTimeout(60_000)
    serve = 'ok'
    version = 0
    longNote = true
    const { page, app } = await launchPairedApp({ buildReplyFrames: bytes => {
      const env = decodeEnvelope(bytes)
      if (env.type !== 'send_message') return buildReplyFrames(bytes)
      const history = Array.from({ length: 12 }, (_, i) => [
        encodeEnvelope({ id: 200 + i, type: 'assistant_delta', ts: FIXED_TS,
          payload: { conversation_id: SEEDED_ROW.id, turn_id: `history-${i}`, seq: 0,
            text: `Synthetic history ${i}.\n\nA second paragraph preserves a meaningful thread scroll position.` } }),
        encodeEnvelope({ id: 300 + i, type: 'turn_end', ts: FIXED_TS,
          payload: { conversation_id: SEEDED_ROW.id, turn_id: `history-${i}`, stop_reason: 'end_turn' } })
      ]).flat()
      return [...history, ...buildReplyFrames(bytes)]
    } })
    // Inject failures at the IPC handler seam: no OS app, filesystem write or reveal is invoked.
    await app.evaluate(({ ipcMain }, channels) => {
      for (const channel of channels) {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, () => ({ type: 'failed', reason: 'refused' }))
      }
    }, [MARKDOWN_OPEN_CHANNEL, MARKDOWN_SAVE_CHANNEL])
    const resize = (dimensions: { width: number; height: number }) => app.evaluate(({ BrowserWindow }, next) => {
      BrowserWindow.getAllWindows()[0].setSize(next.width, next.height)
    }, dimensions)
    await resize(size)
    const composer = page.getByPlaceholder('Message…')
    await composer.fill('Synthetic primer')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const link = page.getByRole('button', { name: 'the plan', exact: true })
    await expect(link).toBeVisible({ timeout: TIMEOUT_MS })
    await composer.fill('Draft survives the reader')
    await link.click()
    const threadPosition = await page.locator('.conversation__thread').evaluate(node => node.scrollTop)
    expect(threadPosition).toBeGreaterThan(0)
    const reader = page.locator('.markdown-reader')
    const body = reader.locator('.markdown-reader__body')
    const trigger = reader.getByRole('button', { name: 'Note actions', exact: true })
    const back = reader.getByRole('button', { name: 'Back', exact: true })
    const menu = page.getByRole('menu', { name: 'Note actions', exact: true })
    const item = (name: string) => menu.getByRole('menuitem', { name, exact: true })
    await expect(reader.locator('h1')).toHaveText('Plan version 1')
    let b = await readerGeometry(page)
    // Fails on the old below-header scroller, before querying any new markup.
    expect(b.body.top).toBe(b.pane.top)
    expect(b.body.bottom).toBe(b.pane.bottom)
    expect(b.first.left).toBe(b.pane.left + 20)
    expect(b.first.top).toBe(b.pane.top + 85)
    const clearStart = async () => {
      await body.evaluate(node => { node.scrollTop = 0 })
      await expect.poll(() => page.evaluate(() => {
        const header = document.querySelector('.markdown-reader__chrome')!.getBoundingClientRect()
        const first = document.querySelector('.markdown-reader h1')!.getBoundingClientRect()
        return Math.abs(first.top - header.bottom)
      })).toBeLessThan(1)
    }
    await clearStart()
    await capturePairedApp(app, page, `/tmp/builder-1734/resting-${size.width}.png`)
    const overlap = async () => {
      await body.evaluate(node => { node.scrollTop = parseFloat(getComputedStyle(node).paddingTop) - 30 })
      const first = await reader.locator('h1').boundingBox()
      const button = await trigger.boundingBox()
      if (!first || !button) throw new Error('Missing overlap geometry')
      expect(first.y).toBeLessThan(button.y + button.height)
      expect(first.y + first.height).toBeGreaterThan(button.y)
      expect(first.x + first.width).toBeGreaterThan(button.x)
      expect(first.x).toBeLessThan(button.x + button.width)
    }
    await overlap()
    await capturePairedApp(app, page, `/tmp/builder-1734/scrolled-${size.width}.png`)
    const treatment = await reader.evaluate(node => {
      const blur = node.querySelector('.conversation__blur')!
      const samples = [...blur.querySelectorAll('i')].map(el => getComputedStyle(el))
      return { gradient: getComputedStyle(blur, '::after').backgroundImage,
        blur: samples.map(style => style.backdropFilter),
        pointer: samples.map(style => style.pointerEvents),
        title: getComputedStyle(node.querySelector('.markdown-reader__title')!).textShadow,
        back: getComputedStyle(node.querySelector('.markdown-reader__back')!).filter,
        controlBlur: getComputedStyle(node.querySelector('.markdown-reader__bar-content')!).filter }
    })
    expect(treatment.gradient).toContain('rgb(9, 20, 29)')
    expect(treatment.gradient).toContain('rgba(0, 0, 0, 0)')
    expect(treatment.blur).toEqual(['blur(10px)', 'blur(8px)', 'blur(5px)', 'blur(2px)'])
    expect(treatment.pointer).toEqual(['none', 'none', 'none', 'none'])
    expect(treatment.title).not.toBe('none')
    expect(treatment.back).toContain('drop-shadow')
    expect(treatment.controlBlur).toBe('none')

    await trigger.click()
    const copyBox = await item('Copy as markdown').boundingBox()
    const textBox = await reader.locator('.bubble__markdown').boundingBox()
    if (!copyBox || !textBox) throw new Error('Missing menu overlap')
    expect(copyBox.y + copyBox.height).toBeGreaterThan(textBox.y)
    expect(copyBox.y).toBeLessThan(textBox.y + textBox.height)
    await item('Copy as markdown').click()
    await expect(reader.locator('.markdown-reader__copied')).toBeVisible()
    await clearStart()
    b = await readerGeometry(page)
    expect(b.padding).toBeGreaterThan(85)
    await expect(reader.locator('.markdown-reader__copied')).toHaveCount(0, { timeout: 5000 })
    await clearStart()
    expect((await readerGeometry(page)).padding).toBe(85)
    serve = 'broken'
    await trigger.click()
    await item('Refresh').click()
    await expect(reader.locator('.markdown-reader__notice')).toHaveText('Could not open the file.')
    await clearStart()
    for (const action of ['Open in another app', 'Save to device']) {
      const previous = (await readerGeometry(page)).padding
      await trigger.click()
      await item(action).click()
      await expect.poll(async () => (await readerGeometry(page)).padding).toBeGreaterThan(previous)
      await clearStart()
    }
    await expect(reader.locator('.markdown-reader__notice')).toHaveCount(3)
    await capturePairedApp(app, page, `/tmp/builder-1734/notices-${size.width}.png`)
    serve = 'ok'
    await trigger.click()
    await item('Refresh').click()
    await expect(reader.locator('h1')).toHaveText('Plan version 2')
    await expect(reader.locator('.markdown-reader__notice')).toHaveCount(2)
    await clearStart()

    for (const dimensions of [size.width === 1280 ? { width: 800, height: 600 } : { width: 1280, height: 800 }, size]) {
      await resize(dimensions)
      for (const zoom of [1.25, 1]) {
        await app.evaluate(({ BrowserWindow }, factor) => {
          BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor)
        }, zoom)
        const contentSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
        await expect.poll(() => page.evaluate(({ width, height }) =>
          Math.max(Math.abs(window.innerWidth - width), Math.abs(window.innerHeight - height)),
        { width: contentSize[0] / zoom, height: contentSize[1] / zoom })).toBeLessThanOrEqual(1)
        await page.evaluate(() => new Promise<void>(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }))
        await clearStart()
        await body.evaluate(node => { node.scrollTop = node.scrollHeight })
        b = await readerGeometry(page)
        expect(b.last.bottom).toBeLessThanOrEqual(b.pane.bottom - 15)
        expect(b.last.bottom).toBeGreaterThan(b.pane.top + b.padding)
        await overlap()
        await trigger.click()
        const menuBox = await menu.boundingBox()
        if (!menuBox) throw new Error('Missing menu bounds')
        expect(menuBox.x).toBeGreaterThanOrEqual(b.pane.left)
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(b.pane.right)
        expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(b.pane.bottom)
        const labelLines = await menu.getByRole('menuitem').evaluateAll(rows => rows.flatMap(row => {
          const range = document.createRange()
          range.selectNodeContents(row.firstChild!)
          return [...range.getClientRects()].map(line => ({ left: line.left, right: line.right }))
        }))
        expect(labelLines.length).toBeGreaterThanOrEqual(6)
        for (const line of labelLines) {
          expect(line.left).toBeGreaterThanOrEqual(menuBox.x)
          expect(line.right).toBeLessThanOrEqual(menuBox.x + menuBox.width)
        }
        await capturePairedApp(app, page, `/tmp/builder-1734/menu-${dimensions.width}-${zoom}.png`)
        await expect(item('Copy as markdown')).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(trigger).toBeFocused()
        await trigger.press('Enter')
        await expect(menu).toBeVisible()
        await body.click({ position: { x: 5, y: 350 } })
        await expect(menu).toHaveCount(0)
      }
    }
    await overlap()
    await back.click()
    await expect(reader).toHaveCount(0)
    await expect(composer).toHaveValue('Draft survives the reader')
    expect(await page.locator('.conversation__thread').evaluate(node => node.scrollTop)).toBe(threadPosition)
    await link.click()
    await expect(reader.locator('h1')).toBeVisible()
    await back.focus()
    await back.press('Enter')
    await expect(reader).toHaveCount(0)
  })
}
