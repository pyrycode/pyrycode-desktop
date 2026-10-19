import { createHash } from 'node:crypto'
import { test, expect, seedConversationsFrame, SEEDED_ROW, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import { capturePairedApp } from './fixtures/capturePairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  AttachmentChunkPayload,
  ConversationsPayload,
  RateLimitedPayload,
  ReadWorkspaceFilePayload,
  SendMessagePayload,
  TurnEndPayload
} from '../src/shared/wire/types'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentUploadEvent } from '../src/shared/ipc/attachmentUpload'

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
const noteText = (): string => [
  `# Plan version ${reads}`, 'Tokens first, running time second.',
  '- Pin the dispatcher\n- Measure running time',
  '| Stage | Status |\n| --- | --- |\n| Build | Ready |',
  '> Keep the quote treatment.',
  'See [the refiner](https://example.com/refiner).',
  '```\npyry release --both\npyry status\n```'
].join('\n\n')

function readReply(requestId: number, ask: ReadWorkspaceFilePayload, text?: string): Uint8Array[] {
  if (text === undefined) reads += 1
  const bytes = Buffer.from(text ?? noteText(), 'utf8')
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

test('reader headings share the scale, spacing and first-block clearance (#2100)', async ({ launchPairedApp }) => {
  const levels = [1, 2, 3, 4, 5, 6]
  const note = [
    '# First heading',
    'Before headings.',
    ...levels.flatMap(level => [`${'#'.repeat(level)} Heading ${level}`, `After heading ${level}.`]),
    ...levels.map(level => `${'#'.repeat(level)} Adjacent ${level}`)
  ].join('\n\n')
  let servedText = note
  const { page, app } = await launchPairedApp({ buildReplyFrames: inbound => {
    const frame = decodeEnvelope(inbound)
    return frame.type === 'read_workspace_file'
      ? readReply(frame.id, frame.payload as ReadWorkspaceFilePayload, servedText)
      : buildReplyFrames(inbound)
  } })
  await page.getByPlaceholder('Message…').fill('show the heading note')
  await page.getByRole('button', { name: 'Send' }).click()
  const link = page.locator('[data-thread-role="assistant"]').getByRole('button', { name: 'the plan' })
  const reader = page.locator('.markdown-reader')
  const markdown = reader.locator('.bubble__markdown')
  const firstClearance = () => reader.evaluate(element => {
    const body = element.querySelector('.markdown-reader__body')!
    const first = element.querySelector('.bubble__markdown > :first-child')!
    const chrome = element.querySelector('.markdown-reader__chrome')!
    return { scrollTop: body.scrollTop,
      gap: first.getBoundingClientRect().top - chrome.getBoundingClientRect().bottom }
  })
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setSize(value, 800), width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    servedText = note
    await link.click()
    await expect(markdown.locator(':scope > h1').first()).toHaveText('First heading')
    await page.evaluate(() => document.fonts.ready)
    const ink = await reader.evaluate(element => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-on-secondary-container)'
      element.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })
    for (const level of levels) {
      const heading = markdown.locator(`:scope > h${level}`).first()
      const [size, line, weight, tracking] = [
        ['20px', '28px', '500', '0px'], ['18px', '26px', '500', '0px'],
        ['16px', '24px', '500', '0.15px'], ...levels.slice(3).map(() => ['14px', '20px', '700', '0.25px'])
      ][level - 1]
      await expect(heading).toHaveCSS('font-family', /^Roboto,/)
      await expect(heading).toHaveCSS('font-size', size)
      await expect(heading).toHaveCSS('line-height', line)
      await expect(heading).toHaveCSS('font-weight', weight)
      await expect(heading).toHaveCSS('letter-spacing', tracking)
      await expect(heading).toHaveCSS('color', ink)
    }
    const geometry = await markdown.evaluate(element => {
      const blocks = [...element.children]
      const headings = blocks.filter(child => /^Heading [1-6]$/.test(child.textContent ?? ''))
      const adjacent = blocks.filter(child => /^Adjacent [1-6]$/.test(child.textContent ?? ''))
      return {
        gaps: headings.map(child => {
          const rect = child.getBoundingClientRect()
          return [rect.top - child.previousElementSibling!.getBoundingClientRect().bottom,
            child.nextElementSibling!.getBoundingClientRect().top - rect.bottom]
        }),
        adjacent: adjacent.slice(1).map((child, index) =>
          child.getBoundingClientRect().top - adjacent[index].getBoundingClientRect().bottom),
        firstInset: blocks[0].getBoundingClientRect().top - element.getBoundingClientRect().top,
        lastInset: element.getBoundingClientRect().bottom - blocks.at(-1)!.getBoundingClientRect().bottom
      }
    })
    expect(geometry.gaps).toHaveLength(6)
    for (const [before, after] of geometry.gaps) {
      expect(before).toBeCloseTo(20, 1)
      expect(after).toBeCloseTo(12, 1)
    }
    expect(geometry.adjacent).toHaveLength(5)
    for (const gap of geometry.adjacent) expect(gap).toBeCloseTo(16, 1)
    expect(geometry.firstInset).toBeCloseTo(0, 1)
    expect(geometry.lastInset).toBeCloseTo(0, 1)
    const headingClearance = await firstClearance()
    expect(headingClearance.scrollTop).toBe(0)
    expect(headingClearance.gap).toBeGreaterThanOrEqual(0)
    await capturePairedApp(app, page, `/tmp/builder-2100/reader-headings-${width}.png`)
    await reader.getByRole('button', { name: 'Back', exact: true }).click()
    servedText = 'First paragraph.'
    await link.click()
    await expect(markdown.locator(':scope > p')).toHaveText('First paragraph.')
    const paragraphClearance = await firstClearance()
    expect(paragraphClearance.scrollTop).toBe(0)
    expect(headingClearance.gap).toBeCloseTo(paragraphClearance.gap, 1)
    await reader.getByRole('button', { name: 'Back', exact: true }).click()
  }
})

test('a markdown link in a reply opens the note in the reader, refetched on every open, and back returns (#1627)', async ({
  launchPairedApp
}) => {
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames })
  // A completed upload, pushed on the channel main sends its terminals on (composer-attach.spec.ts's seam:
  // a real attach opens a native file dialog no locator can dismiss).
  const pushUpload = (event: AttachmentUploadEvent): Promise<void> =>
    app.evaluate(
      ({ BrowserWindow }, payload) => {
        const [window] = BrowserWindow.getAllWindows()
        window.webContents.send(payload.channel, payload.event)
      },
      { channel: ATTACHMENT_UPLOAD_EVENT_CHANNEL, event }
    )
  const tiles = page.locator('.composer__attachment')

  await page.getByPlaceholder('Message…').fill('where is the plan?')
  await page.getByRole('button', { name: 'Send' }).click()

  const assistant = page.locator('[data-thread-role="assistant"]')
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

  // The composer holds a pending attachment when the reader opens (the verifier's MUST FIX on PR #1629).
  await pushUpload({ type: 'completed', uploadId: 'e2e-reader-1', filename: 'e2e-report.pdf' })
  await expect(tiles).toHaveCount(1, { timeout: TIMEOUT_MS })

  // --- 1. Open: the reader covers the pane, composer included; the title is the last component. ---
  await planLink.click()
  await expect(reader).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(reader.locator('.markdown-reader__title')).toHaveText('Plan.md')
  await expect(reader.locator('h1')).toHaveText('Plan version 1', { timeout: TIMEOUT_MS })
  // Browser-computed inheritance and actual block rectangles prove the reader's shared text family.
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setSize(value, 800), width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    const markdown = reader.locator('.bubble__markdown')
    for (const selector of ['p', 'li', 'th', 'td', 'blockquote', 'a']) {
      const elements = markdown.locator(selector)
      expect(await elements.count()).toBeGreaterThan(0)
      for (const element of await elements.all()) {
        await expect(element).toHaveCSS('font-family', /Roboto/)
        await expect(element).toHaveCSS('font-size', '14px')
        await expect(element).toHaveCSS('line-height', '20px')
        await expect(element).toHaveCSS('letter-spacing', '0.25px')
      }
    }
    const colors = await reader.evaluate(element => {
      const probe = document.createElement('span')
      element.append(probe)
      const resolve = (token: string): string => {
        probe.style.color = `var(${token})`
        return getComputedStyle(probe).color
      }
      const result = { body: resolve('--color-on-secondary-container'), primary: resolve('--color-primary'),
        outline: resolve('--color-outline'), stroke: resolve('--color-primary-container') }
      probe.remove()
      return result
    })
    for (const selector of ['p', 'li', 'th', 'td']) {
      for (const element of await markdown.locator(selector).all()) {
        await expect(element).toHaveCSS('color', colors.body)
      }
    }
    await expect(markdown.locator('a')).toHaveCSS('color', colors.primary)
    await expect(markdown.locator('a')).toHaveCSS('text-decoration-line', 'underline')
    await expect(markdown.locator('blockquote')).toHaveCSS('border-left-color', colors.outline)
    await expect(markdown.locator('blockquote')).toHaveCSS('border-left-width', '4px')
    const code = markdown.locator('.code-block__body')
    await expect(code).toHaveCSS('font-family', /Roboto Mono/)
    await expect(code).toHaveCSS('font-size', '12px')
    await expect(code).toHaveCSS('line-height', '20px')
    await expect(markdown.locator('.code-block')).toHaveCSS('border-top-color', colors.stroke)
    await expect(markdown.locator('.code-block')).toHaveCSS('border-radius', '6px')
    await expect(markdown.getByRole('button', { name: 'Copy code', exact: true })).toBeVisible()
    await expect(markdown.locator('.code-block__copy-icon')).toBeVisible()
    const gaps = await markdown.evaluate(element => {
      const blocks = [...element.children].map(child => child.getBoundingClientRect())
      return blocks.slice(2).map((block, index) => block.top - blocks[index + 1].bottom)
    })
    expect(gaps).toHaveLength(5)
    for (const gap of gaps) expect(gap).toBeCloseTo(16, 1)
    await capturePairedApp(app, page, `/tmp/builder-2099/reader-body-${width}.png`)
  }
  // Hidden, NOT unmounted: the Composer's pending set and upload listener are mount-local.
  await expect(composer).toBeHidden()
  await expect(assistant).toBeHidden()
  // The sidebar stays.
  await expect(page.locator('.paired-shell__pane')).toBeVisible()
  // An upload that completes while the reader is open still reaches the composer's live listener.
  await pushUpload({ type: 'completed', uploadId: 'e2e-reader-2', filename: 'e2e-bundle.zip' })

  // --- 2. Back returns to the same conversation's thread, with both pending attachments still held. ---
  await reader.getByRole('button', { name: 'Back' }).click()
  await expect(reader).toHaveCount(0)
  await expect(composer).toBeVisible()
  await expect(planLink).toBeVisible()
  await expect(tiles).toHaveCount(2, { timeout: TIMEOUT_MS })
  await expect(tiles.nth(0)).toHaveText('PDF')
  await expect(tiles.nth(1)).toHaveText('ZIP')

  // --- 3. Reopen fetches again: the note changed on the host, so the new text shows. ---
  await planLink.click()
  await expect(reader.locator('h1')).toHaveText('Plan version 2', { timeout: TIMEOUT_MS })
  await reader.getByRole('button', { name: 'Back' }).click()

  // --- 4. A failed fetch closes the reader and shows one static notice, never the path or reason. ---
  await expect(composer).toBeVisible()
  const thread = page.locator('.conversation__thread')
  // Hovering the link reveals message metadata; its height is independent of notice placement.
  const messagePosition = () => assistant.evaluate(element => {
    const { x, y } = element.getBoundingClientRect()
    return { x, y }
  })
  const beforeFailure = {
    thread: await thread.boundingBox(), message: await messagePosition(), composer: await composer.boundingBox()
  }
  await assistant.getByRole('button', { name: 'the other' }).click()
  const overlay = page.locator('.conversation__top-overlay')
  const notice = overlay.locator('.top-overlay-pill--error', { hasText: 'Could not open the file.' })
  await expect(notice).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(notice).toHaveCount(1)
  await expect(notice).toHaveText('Could not open the file.')
  await expect(notice).toHaveAttribute('role', 'status')
  await expect(notice.getByRole('button')).toHaveCount(0)
  await expect(page.locator('.conversation__banner', { hasText: 'Could not open the file.' })).toHaveCount(0)
  await expect(reader).toHaveCount(0)
  await expect(composer).toBeVisible()
  expect(beforeFailure.thread).not.toBeNull()
  expect(beforeFailure.composer).not.toBeNull()
  expect({ thread: await thread.boundingBox(), message: await messagePosition(), composer: await composer.boundingBox() })
    .toEqual(beforeFailure)
  const noticeText = (await notice.textContent()) ?? ''
  expect(noticeText).not.toContain('Broken-Secret')
  expect(noticeText).not.toContain('verification')

  // The failure coexists with a usage pill, floats above the thread, and fits the minimum window.
  daemon.pushFrame(encodeEnvelope({ id: 1100, type: 'rate_limited', ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, status: 'allowed_warning', limit_type: 'seven_day',
      resets_at: 4_102_444_800, truncated_fields: null } satisfies RateLimitedPayload }))
  await expect(overlay.locator('.top-overlay-pill')).toHaveCount(2)
  for (const size of [{ width: 1100, height: 800 }, { width: 800, height: 600 }]) {
    await app.evaluate(({ BrowserWindow }, dimensions) => {
      BrowserWindow.getAllWindows()[0].setSize(dimensions.width, dimensions.height)
    }, size)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(size.width)
    const geometry = await notice.evaluate(element => {
      const pill = element.getBoundingClientRect()
      const area = document.querySelector('.conversation__message-area')!.getBoundingClientRect()
      return { inside: pill.left >= area.left && pill.right <= area.right, compact: pill.width < area.width }
    })
    expect(geometry).toEqual({ inside: true, compact: true })
    await capturePairedApp(app, page, `/tmp/builder-2077/markdown-failure-${size.width}.png`)
  }

  // --- 5. Opening another markdown link clears the notice. ---
  await planLink.click()
  await expect(reader.locator('h1')).toHaveText('Plan version 4', { timeout: TIMEOUT_MS })
  await expect(notice).toHaveCount(0)
  await reader.getByRole('button', { name: 'Back' }).click()
  await expect(composer).toBeVisible()
  await expect(notice).toHaveCount(0)

  // A second failure followed by a conversation switch drops the notice, including on return.
  await assistant.getByRole('button', { name: 'the other' }).click()
  await expect(notice).toBeVisible({ timeout: TIMEOUT_MS })
  daemon.pushFrame(encodeEnvelope({ id: 1101, type: 'conversations', ts: FIXED_TS,
    payload: { conversations: [SEEDED_ROW, SECOND_SEEDED_ROW] } satisfies ConversationsPayload }))
  await page.getByText(SECOND_SEEDED_ROW.name!, { exact: true }).first().click()
  await expect(page.locator('.conversation__thread')).toBeVisible()
  await expect(page.locator('.conversation__overflow-title')).toHaveText(SECOND_SEEDED_ROW.name!)
  await expect(notice).toHaveCount(0)
  await page.getByText(SEEDED_ROW.name!, { exact: true }).first().click()
  await expect(planLink).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(notice).toHaveCount(0)
})
