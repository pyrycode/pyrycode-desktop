import { createHash } from 'node:crypto'
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
const noteText = (): string =>
  [
    `# Plan version ${version}`,
    '',
    'See [the refiner](https://example.com/refiner) and *tokens*.',
    '',
    '<script>alert(1)</script>',
    '',
    '<img src="x" onerror="alert(1)">'
  ].join('\n')
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
  await expect(items).toHaveCount(4)
  expect(await items.evaluateAll((rows) => rows.map((row) => row.firstChild?.textContent))).toEqual([
    'Copy as markdown',
    'Copy as plain text',
    'Copy as HTML',
    'Refresh'
  ])
  for (const name of ['Copy as markdown', 'Copy as plain text', 'Copy as HTML']) {
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
  await expect(items).toHaveCount(4)
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
