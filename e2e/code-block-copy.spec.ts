import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'

const HEADED_CODE = 'function example() {\n  const literal = "<b>&amp;</b>"\n\n\treturn `literal ${value} \\\\ path`\n}\n'
const SIMPLE_CODE = '  plain <script> & "quotes"\n\nlast line\n\n'
const LONG_CODE = `const long = "${'abcdefghij'.repeat(30)}"\n`
const SOURCE = [
  'Before the blocks, with `inline code`.', '',
  '```typescript', HEADED_CODE + '```', '',
  'Between blocks.', '', '```', SIMPLE_CODE + '```', '',
  '```text', LONG_CODE + '```', '', '```text', '```', '', 'After the blocks.'
].join('\n')

function buildReplyFrames(inbound: Uint8Array): Uint8Array[] {
  const envelope = decodeEnvelope(inbound)
  if (envelope.type !== 'send_message') return [seedConversationsFrame()]
  const common = { conversation_id: SEEDED_ROW.id, turn_id: 'code-copy-turn' }
  return [
    encodeEnvelope({
      id: 99, type: 'assistant_delta', ts: '2026-09-19T12:00:00.000Z',
      payload: { ...common, seq: 0, text: SOURCE }
    }),
    encodeEnvelope({
      id: 100, type: 'turn_end', ts: '2026-09-19T12:00:00.000Z',
      payload: { ...common, stop_reason: 'end_turn' }
    })
  ]
}

test('copies only the activated block, preserving literal text and whitespace', async ({ launchPairedApp }) => {
  const { page, app } = await launchPairedApp({ buildReplyFrames })
  await page.getByPlaceholder('Message…').fill('Show code')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const blocks = page.locator('.bubble__markdown .code-block')
  await expect(blocks).toHaveCount(4)
  await expect(blocks.nth(0).locator('.code-block__header')).toHaveText('typescript')
  await expect(blocks.nth(1).locator('.code-block__header')).toHaveCount(0)
  const copies = page.getByRole('button', { name: 'Copy code', exact: true })
  await expect(copies).toHaveCount(4)

  // Read only synthetic values we have written, never the clipboard's prior contents.
  const seed = async (): Promise<void> => {
    await app.evaluate(({ clipboard }) => clipboard.writeText('code-copy-sentinel'))
  }
  const expectClipboard = async (expected: string): Promise<void> => {
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(expected)
    // macOS readHTML can fall back to plain text; inspect advertised formats instead.
    expect(await app.evaluate(({ clipboard }) => clipboard.availableFormats())).not.toContain('text/html')
  }

  for (const [index, text] of [HEADED_CODE, SIMPLE_CODE, LONG_CODE, ''].entries()) {
    await seed()
    await copies.nth(index).click()
    await expectClipboard(text)
  }

  // Tab navigation proves the controls participate in native keyboard order.
  await copies.nth(0).focus()
  await page.keyboard.press('Tab')
  await expect(copies.nth(1)).toBeFocused()
  const focus = await copies.nth(1).evaluate((button) => {
    const style = getComputedStyle(button)
    return {
      visible: button.matches(':focus-visible'),
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
      color: style.outlineColor
    }
  })
  expect(focus.visible).toBe(true)
  expect(focus.style).toBe('solid')
  expect(focus.width).toBeGreaterThan(0)
  expect(focus.color).not.toBe('rgba(0, 0, 0, 0)')
  for (const key of ['Enter', 'Space']) {
    await seed()
    await page.keyboard.press(key)
    await expectClipboard(SIMPLE_CODE)
  }

  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, windowWidth) => {
      BrowserWindow.getAllWindows()[0].setSize(windowWidth, 900)
    }, width)
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
    for (const block of await blocks.all()) {
      const geometry = await block.evaluate((element) => {
        const pre = element.querySelector('pre')!
        const code = element.querySelector('code')!
        const button = element.querySelector('button')!
        const bodyBox = pre.getBoundingClientRect()
        const buttonBox = button.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(code)
        return {
          contained: buttonBox.top >= bodyBox.top && buttonBox.bottom <= bodyBox.bottom &&
            buttonBox.right <= bodyBox.right,
          rightGap: bodyBox.right - buttonBox.right,
          bottomGap: bodyBox.bottom - buttonBox.bottom,
          expectedGap: parseFloat(getComputedStyle(button).getPropertyValue('--space-1')),
          overlaps: [...range.getClientRects()].some(rect =>
            rect.right > buttonBox.left && rect.left < buttonBox.right &&
            rect.bottom > buttonBox.top && rect.top < buttonBox.bottom)
        }
      })
      expect(geometry.contained).toBe(true)
      expect(geometry.rightGap).toBeCloseTo(geometry.expectedGap, 0)
      expect(geometry.bottomGap).toBeCloseTo(geometry.expectedGap, 0)
      expect(geometry.overlaps).toBe(false)
    }
    await blocks.nth(1).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/builder-1540-code-copy-${width}.png`, animations: 'disabled' })
  }
})
