import { createHash } from 'node:crypto'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  AttachmentChunkPayload,
  ReadWorkspaceFilePayload,
  SendMessagePayload,
  TurnEndPayload
} from '../src/shared/wire/types'

// #1627 — a markdown link in an assistant reply opens the in-app reader, end to end. The renderer tier
// is static markup and cannot click, so the transition (thread → reader → thread), the fresh fetch on
// every open and the failure notice are proven here, with the fake daemon answering
// `read_workspace_file` the way e2e/attachment-image-thumbnail.spec.ts answers `request_attachment`: one
// chunk carrying the whole file, correlated by `in_reply_to`, with a COMPUTED digest.
//
// SECRET HYGIENE: every literal is an invented note name or invented markdown.

const TIMEOUT_MS = 15_000
const FIXED_TS = '2026-07-07T12:00:00.000Z'

const GOOD_PATH = 'notes/Plan.md'
const BROKEN_PATH = 'notes/Broken-Secret.md'
const REPLY = `Read [the plan](${GOOD_PATH}) and [the other](${BROKEN_PATH}).`

// The note changes on the host between opens; the reader must show the new text on the second open.
let reads = 0
const noteText = (): string => `# Plan version ${reads}\n\nTokens first, running time second.`

function readReply(requestId: number, ask: ReadWorkspaceFilePayload): Uint8Array[] {
  reads += 1
  const bytes = Buffer.from(noteText(), 'utf8')
  const payload: AttachmentChunkPayload = {
    attachment_id: '5a6b7c8d-9e0f-4a1b-8c9d-5e6f7a8b9c0d',
    index: 0,
    total_chunks: 1,
    filename: 'Plan.md',
    mime_type: 'text/markdown',
    size: bytes.length,
    // The broken note is served with a digest that cannot match, so the reassembler fails it closed as
    // `verification-failed` — a real failure outcome through the real verification path.
    sha256:
      ask.path === BROKEN_PATH
        ? '0'.repeat(64)
        : createHash('sha256').update(bytes).digest('hex'),
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
      return readReply(envelope.id, envelope.payload as ReadWorkspaceFilePayload)
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

test('a markdown link in a reply opens the note in the reader, refetched on every open, and back returns (#1627)', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })

  await page.getByPlaceholder('Message…').fill('where is the plan?')
  await page.getByRole('button', { name: 'Send' }).click()

  const assistant = page.locator('.bubble[data-thread-role="assistant"]')
  const planLink = assistant.getByRole('button', { name: 'the plan' })
  await expect(planLink).toBeVisible({ timeout: TIMEOUT_MS })
  // The path is in no attribute of the rendered reply.
  const attributes = await assistant.evaluate((element) =>
    [element, ...element.querySelectorAll('*')].flatMap((node) => [...node.attributes].map((a) => a.value))
  )
  for (const value of attributes) {
    expect(value).not.toContain('Plan.md')
    expect(value).not.toContain('Broken-Secret')
  }

  const reader = page.locator('.markdown-reader')
  const composer = page.getByPlaceholder('Message…')

  // --- 1. Open: the reader replaces the pane, composer included; the title is the last component. ---
  await planLink.click()
  await expect(reader).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(reader.locator('.markdown-reader__title')).toHaveText('Plan.md')
  await expect(reader.locator('h1')).toHaveText('Plan version 1', { timeout: TIMEOUT_MS })
  await expect(composer).toHaveCount(0)
  await expect(assistant).toHaveCount(0)
  // The sidebar stays.
  await expect(page.locator('.paired-shell__pane')).toBeVisible()

  // --- 2. Back returns to the same conversation's thread. ---
  await reader.getByRole('button', { name: 'Back' }).click()
  await expect(reader).toHaveCount(0)
  await expect(composer).toBeVisible()
  await expect(planLink).toBeVisible()

  // --- 3. Reopen fetches again: the note changed on the host, so the new text shows. ---
  await planLink.click()
  await expect(reader.locator('h1')).toHaveText('Plan version 2', { timeout: TIMEOUT_MS })
  await reader.getByRole('button', { name: 'Back' }).click()

  // --- 4. A failed fetch closes the reader and shows one static notice, never the path or reason. ---
  await assistant.getByRole('button', { name: 'the other' }).click()
  const notice = page.locator('.conversation__banner', { hasText: 'Could not open the file.' })
  await expect(notice).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(reader).toHaveCount(0)
  await expect(composer).toBeVisible()
  const noticeText = (await notice.textContent()) ?? ''
  expect(noticeText).not.toContain('Broken-Secret')
  expect(noticeText).not.toContain('verification')

  // --- 5. Opening another markdown link clears the notice. ---
  await planLink.click()
  await expect(reader.locator('h1')).toHaveText('Plan version 4', { timeout: TIMEOUT_MS })
  await reader.getByRole('button', { name: 'Back' }).click()
  await expect(composer).toBeVisible()
  await expect(notice).toHaveCount(0)
})
