import { createHash } from 'node:crypto'
import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { pushConfirmingDelivery } from './fixtures/confirmedPush'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentUploadEvent } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentChunkPayload, RequestAttachmentPayload } from '../src/shared/wire/types'

// #1045 — the image thumbnail in the message bubble, end to end. This is the tier that owns AC1's
// end-to-end half and ALL of AC3, AC4 and AC5, because every one of them is a box, a load or an event:
// `vitest.config.ts` sets `environment: 'node'`, so the renderer tier is a `renderToStaticMarkup` string
// with no DOM, no stylesheet and no effects. It can prove which attachment gets a picture and where the
// markup sits (ConversationScreen.test.tsx) and what each of the three states draws
// (BubbleAttachmentImage.test.tsx). It cannot load an image, measure a box, or resize a window.
//
// ⭐ THE FETCH IS DRIVEN TO COMPLETION, AND THAT IS THE INVERSION THIS SLICE OWNS.
// `attachment-file-row.spec.ts` deliberately answers `request_attachment` with NO frames, because #816's
// next step was a copy into the operator's real Downloads folder plus `shell.showItemInFolder` — a Finder
// window opening on whoever ran the suite. This slice has no save: the bytes land in the app-private
// attachment directory under the throwaway `--user-data-dir` and go nowhere else. So completion is safe,
// and it is the ONLY way real bytes reach an `<img>` — which is what AC1 asks to be proven.
//
// ⭐ IT ALSO PROVES THE CSP, and the detector was MEASURED rather than reasoned about. Reverting
// `src/renderer/index.html` to the pre-#1045 policy fails this spec at its FIRST picture assertion —
// `toHaveCount(1)` on `img.bubble__image` receives 0 — and the mechanism is worth recording because it is
// not the obvious one: a source the policy refuses raises `error` on the <img>, which is the same signal a
// name that lied raises, so the element unmounts into the fallback and there is no <img> left to read a
// `naturalWidth` off. That is the design working (a refused source and undecodable bytes are one outcome),
// and it means the count is the CSP detector while the `naturalWidth` reads below prove which BYTES
// arrived.
//
// ⭐ IT MUST NOT USE `bubbleTextExactly`. That helper is an anchored WHOLE-bubble matcher and this suite
// seeds bubbles with a text-bearing child. Every read below is a scoped locator or a geometry read. The
// two sweeps this ticket required were run across `e2e/` with no tier filter — `toHaveText|toContainText`
// (148 sites) and `textContent|allTextContents|innerText` (29) — and no existing site reddens: the `<img>`
// bears no text at all, and the only text-bearing child added is the fallback, which appears solely on a
// failed image, a state no other spec can reach.
//
// SECRET HYGIENE, the sibling specs' rule carried verbatim: every literal here is an invented non-secret
// name or an invented image, and every assertion reads DOM state, computed style or geometry.

const ROW_TIMEOUT_MS = 15_000

// Sub-pixel tolerance: the browser lays out in fractional pixels and the values compared are integer
// design constants or measured boxes.
const EPSILON_PX = 1.5

// The drawn height, off Figma `Slot` I132:4567;132:4465. The ONLY pixel constant this spec asserts against
// directly — every width assertion is relative to a MEASURED content box, which is what makes AC4's "no
// fixed pixel width is written anywhere" provable rather than restated.
const THUMBNAIL_HEIGHT_PX = 160
// --space-3, the rhythm the picture keeps with the text above and the meta row below.
const RHYTHM_PX = 12
// --radius-xs.
const RADIUS_PX = 6

// ⭐ CANONICAL ATTACHMENT IDS — hex digits and hyphen only, and this is load-bearing rather than cosmetic.
// `resolveAttachmentPath`'s CANONICAL_ATTACHMENT_ID is /^[0-9a-f-]{1,64}$/ and it gates the store write and
// the read back. `attachment-file-row.spec.ts`'s `e2e-download-1` shape would be REFUSED, and it gets away
// with it only because it never drives a retrieval as far as storage. This spec does, so a non-canonical id
// here would turn every picture into the fallback and every assertion below into a puzzle.
const ID_TALL = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d'
const ID_WIDE = '1a2b3c4d-5e6f-4a7b-8c9d-1e2f3a4b5c6d'
const ID_SMALL = '2a3b4c5d-6e7f-4a8b-8c9d-2e3f4a5b6c7d'
const ID_LIAR = '3a4b5c6d-7e8f-4a9b-8c9d-3e4f5a6b7c8d'
const ID_DOCUMENT = '4a5b6c7d-8e9f-4a0b-8c9d-4e5f6a7b8c9d'

// Three solid-colour PNGs, generated for this spec and carrying no information at all. Each is a few
// hundred bytes — far under ATTACHMENT_CHUNK_DATA_BYTES (45000), so each rides exactly one chunk.
//
// THE DIMENSIONS ARE THE TEST. Each one isolates one clause of AC3:
//   - 200x400 portrait: at 160 tall its width is 80, under the bubble's content box at EVERY window size,
//     so it proves "160 tall, width from the image's own aspect ratio" with no cap in play.
//   - 800x100, ratio 8: at 160 tall its width would be 1280, which exceeds the content box at every window
//     size (the bubble caps at 680px, so its content box caps at 640) — so the cap ALWAYS binds and it
//     proves "width caps at the content width, height falls proportionally".
//   - 40x40: naturally shorter than 160, so it proves the ruling's closing assumption — not scaled up.
const TALL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAAGQCAIAAABkkLjnAAACz0lEQVR42u3SQQkAAAgEwYtiLtMZ1RKCn4FJsGyqB85FAoyFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsbCWGAsjIWxwFgYC2NhLBUwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsbCWGAsjIWxwFgYC2OBsTAWxsJYKmAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBbGkgBjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2NhLBUwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbH4sADgZVQK/cnv+wAAAABJRU5ErkJggg=='
const WIDE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAyAAAABkCAIAAADxM8PYAAABkUlEQVR42u3WMQ0AAAzDsEIZlEEd1JHoackIciW3AwBAUSQAADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAIDBAgAwWAAABgsAwGABAGCwAAAMFgCAwQIAwGABABgsAACDBQCAwQIAMFgAAAYLAACDBQBgsAAADBYAgMECAMBgAQAYLAAAgwUAgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAIMFAIDBAgAwWAAABgsAAIMFAGCwAAAMFgAABgsAwGABABgsAAAMFgCAwQIAMFgAAAYLAACDBQBgsAAADBYAAAYLAMBgAQAYLAAADBYAgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAAwWAIDBAgAwWAAAGCwAAIMFAGCwAAAMFgAABgsAwGABABgsAAAMFgCAwQIAMFgAABgsAACDBQBgsAAAMFgAAAYLAMBgAQAYLAAADBYAgMECADBYAAAYLAAAgwUAYLAAADBYAAAGCwDAYAEAYLAAANoej5+SST6U8/EAAAAASUVORK5CYII='
const SMALL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAAMElEQVR42u3NQQkAAAgEsItkJKMZ1RKCn8H+S02/iFgsFovFYrFYLBaLxWKxWHxnAfNtbGoY3PNZAAAAAElFTkSuQmCC'

const TALL_NATURAL = { width: 200, height: 400 }
const WIDE_RATIO = 800 / 100
const SMALL_NATURAL = { width: 40, height: 40 }

// AC5's second half: a name that LIES. The extension says `.png`, so `isImageAttachmentName` admits it and
// a picture is attempted; the bytes are ASCII and no decoder will take them, so `<img>` raises `error` and
// the same fallback draws. Nothing about the fetch differs — that is the point of the criterion: an
// untrusted name decides what is DRAWN, never what is fetched or from where.
const LIAR_BYTES = Buffer.from('this is not an image, whatever the name says', 'ascii')

/** One attachment the fake daemon will serve, keyed by the id the window asks for. */
interface ServedAttachment {
  bytes: Buffer
  filename: string
}

const SERVED = new Map<string, ServedAttachment>([
  [ID_TALL, { bytes: Buffer.from(TALL_PNG_BASE64, 'base64'), filename: 'portrait.png' }],
  [ID_WIDE, { bytes: Buffer.from(WIDE_PNG_BASE64, 'base64'), filename: 'panorama.png' }],
  [ID_SMALL, { bytes: Buffer.from(SMALL_PNG_BASE64, 'base64'), filename: 'thumb.png' }],
  [ID_LIAR, { bytes: LIAR_BYTES, filename: 'pretend-picture.png' }]
])

/**
 * The daemon's answer to one `request_attachment`: a single `attachment_chunk` frame carrying the whole
 * file.
 *
 * ⭐ THE DIGEST IS COMPUTED, NEVER WRITTEN BY HAND. `attachmentReassembler` verifies the assembled bytes
 * against the declared length AND an exact lowercase-hex SHA-256 of the whole file, and the comparison is
 * deliberately neither prefix- nor case-insensitive — so a hand-written digest fails closed as
 * `verification-failed` and the picture silently becomes the fallback.
 *
 * CORRELATION RIDES THE ENVELOPE. `daemonConnection` routes a retrieval chunk by `Envelope.in_reply_to`
 * against the id of the `request_attachment` this client minted, and drops a frame matching no live
 * retrieval with no event and no log. The payload `attachment_id` is re-checked one layer down by the
 * reassembler, which refuses a chunk naming a different transfer — the two are not redundant.
 */
function serveAttachmentFrame(requestId: number, ask: RequestAttachmentPayload): Uint8Array[] {
  const served = SERVED.get(ask.attachment_id)
  if (served === undefined) return []
  const payload: AttachmentChunkPayload = {
    attachment_id: ask.attachment_id,
    index: 0,
    total_chunks: 1,
    filename: served.filename,
    // The channel between main and the window carries no media type and the reassembler reads this field
    // for nothing at all, so it is set to what a real daemon would sniff and relied on by no assertion.
    mime_type: 'image/png',
    size: served.bytes.length,
    sha256: createHash('sha256').update(served.bytes).digest('hex'),
    data: served.bytes.toString('base64')
  }
  return [
    encodeEnvelope({
      id: 900 + requestId,
      type: 'attachment_chunk',
      ts: '2026-07-07T12:00:00.000Z',
      in_reply_to: requestId,
      payload
    })
  ]
}

const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  if (envelope.type === 'request_attachment') {
    return serveAttachmentFrame(envelope.id, envelope.payload as RequestAttachmentPayload)
  }
  // A send is answered with nothing: the user echo is renderer-sourced, written by `composerSend` before
  // any reply, so no daemon frame is needed to make the bubble under test appear — and leaving sends
  // unanswered keeps assistant bubbles out of the way of the scoped locators below.
  return envelope.type === 'send_message' ? [] : [seedConversationsFrame()]
}

/** A settled upload exactly as `src/main/attachmentUpload` emits it. The SENDER is the only thing standing
 *  in for production, because the alternative is a native file dialog no Playwright locator can dismiss —
 *  `composer-attach.spec.ts`'s established seam. */
const upload = (uploadId: string, filename: string): AttachmentUploadEvent => ({
  type: 'completed',
  uploadId,
  filename
})

test('an image attachment draws as its own bytes, sized live, with the file row left to everything else (#1045)', async ({
  launchPairedApp
}) => {
  const { page, app } = await launchPairedApp({ buildReplyFrames })

  // A lost inspection context cannot tell us whether send ran. Observe this push's absolute tile
  // count before retrying; a previous upload's late tile must not stand in for the current one.
  const pendingTiles = page.locator('.composer__attachment-slot')
  const pushCompleted = (event: AttachmentUploadEvent, tilesAfter: number): Promise<void> =>
    pushConfirmingDelivery(
      () =>
        app.evaluate(
          ({ BrowserWindow }, payload) => {
            const [window] = BrowserWindow.getAllWindows()
            window.webContents.send(payload.channel, payload.event)
            // Exercise the ambiguous outcome: delivery happened before inspection reported a loss.
            // A blind resend duplicates the document; the pending strip and bubble assert exactly one.
            if (payload.event.uploadId === payload.loseContextAfterUploadId) {
              throw new Error('Execution context was destroyed, most likely because of a navigation.')
            }
          },
          { channel: ATTACHMENT_UPLOAD_EVENT_CHANNEL, event, loseContextAfterUploadId: ID_DOCUMENT }
        ),
      async () => (await pendingTiles.count()) >= tilesAfter
    )

  const send = async (text: string): Promise<void> => {
    await page.getByPlaceholder('Message…').fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
  }

  const bubble = (index: number) =>
    page.locator('.bubble[data-thread-role="user"]').nth(index)

  /** A drawn image's laid-out box plus the size its own bytes decoded to. `naturalWidth` is the CSP proof:
   *  a source the policy refuses never decodes and reads 0. */
  const drawn = async (image: ReturnType<typeof bubble>) => {
    const box = (await image.boundingBox())!
    const natural = await image.evaluate((element) => ({
      width: (element as HTMLImageElement).naturalWidth,
      height: (element as HTMLImageElement).naturalHeight,
      complete: (element as HTMLImageElement).complete
    }))
    return { box, natural }
  }

  /** The bubble's CONTENT width — its border box less its own inline padding, read live rather than
   *  computed from a constant. Every width assertion in this spec is relative to this, which is how AC4's
   *  "no fixed pixel width is written anywhere" is proven rather than asserted. */
  const contentWidth = (target: ReturnType<typeof bubble>): Promise<number> =>
    target.evaluate((element) => {
      const computed = getComputedStyle(element)
      return (
        element.getBoundingClientRect().width -
        parseFloat(computed.paddingLeft) -
        parseFloat(computed.paddingRight)
      )
    })

  // --- 1. A message carrying an image AND a document: one of each, in record order. AC1's last clause. ---
  await pushCompleted(upload(ID_TALL, 'portrait.png'), 1)
  await pushCompleted(upload(ID_DOCUMENT, 'quarterly-report.pdf'), 2)
  await expect(pendingTiles).toHaveCount(2)
  await send('a picture and a document')

  const first = bubble(0)
  const portrait = first.locator('img.bubble__image')
  await expect(portrait).toHaveCount(1, { timeout: ROW_TIMEOUT_MS })
  await expect(first.locator('.bubble__file')).toHaveCount(1)
  await expect(first.locator('.bubble__file-name')).toHaveText('quarterly-report.pdf')
  // Record order: the image was pushed first, so its element precedes the row's in the DOM.
  const imageBeforeRow = await first.evaluate((element) => {
    const img = element.querySelector('img.bubble__image')!
    const row = element.querySelector('.bubble__file')!
    // Node.DOCUMENT_POSITION_FOLLOWING === 4: `row` comes after `img`.
    return (img.compareDocumentPosition(row) & 4) !== 0
  })
  expect(imageBeforeRow).toBe(true)

  // --- 2. AC1's substance: the picture is the bytes the daemon actually served. `naturalWidth` is the
  // decoded intrinsic size, so this is simultaneously the round-trip proof (retrieval → store → bytes leg
  // → blob URL) and the CSP proof: under the pre-#1045 policy the blob: source loads at all, and both
  // naturals read 0. ---
  await expect
    .poll(async () => (await drawn(portrait)).natural.width, { timeout: ROW_TIMEOUT_MS })
    .toBe(TALL_NATURAL.width)
  const portraitDrawn = await drawn(portrait)
  expect(portraitDrawn.natural.height).toBe(TALL_NATURAL.height)
  expect(portraitDrawn.natural.complete).toBe(true)

  // --- 3. AC3, the uncapped case: 160 tall, width from the image's OWN aspect ratio. The 200x400 source
  // gives 80x160, and both halves are asserted — the height alone would pass for a stretched render. ---
  expect(portraitDrawn.box.height).toBeCloseTo(THUMBNAIL_HEIGHT_PX, 0)
  expect(portraitDrawn.box.width).toBeCloseTo(
    (THUMBNAIL_HEIGHT_PX * TALL_NATURAL.width) / TALL_NATURAL.height,
    0
  )
  // Not cropped, stretched or letterboxed: the drawn ratio IS the natural ratio.
  expect(portraitDrawn.box.width / portraitDrawn.box.height).toBeCloseTo(
    TALL_NATURAL.width / TALL_NATURAL.height,
    1
  )

  // --- 4. AC2: inside the bubble, below the text, above the meta row, --space-3 clear of each, at the
  // bubble's own horizontal padding, at --radius-xs. Only a real window can show that the margin actually
  // resolves through .bubble's padding box. ---
  await first.hover()
  const firstBox = (await first.boundingBox())!
  const metaBox = (await first.locator('.bubble__meta').boundingBox())!
  const rowBox = (await first.locator('.bubble__file').boundingBox())!
  // Text above → picture: the picture's top is --space-3 below the bottom of the message text. The text is
  // a bare text node, so the gap is measured against the row that follows the picture instead — the file
  // row is --space-3 below the picture, and the meta row --space-3 below that. Three consecutive gaps of
  // 12px is the rhythm the criterion names, and it is the mechanism (a margin on the FOLLOWING sibling)
  // that would break all three at once.
  expect(rowBox.y - (portraitDrawn.box.y + portraitDrawn.box.height)).toBeCloseTo(RHYTHM_PX, 0)
  expect(metaBox.y - (rowBox.y + rowBox.height)).toBeCloseTo(RHYTHM_PX, 0)
  // The picture sits at the bubble's own inline padding — --space-5, read live off the box rather than
  // written as 20.
  const inlinePadding = await first.evaluate((element) =>
    parseFloat(getComputedStyle(element).paddingLeft)
  )
  expect(portraitDrawn.box.x - firstBox.x).toBeCloseTo(inlinePadding, 0)
  expect(await portrait.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)).toBe(
    `${RADIUS_PX}px`
  )

  // --- 5. AC3's capped case. The 800x100 source would be 1280 wide at 160 tall, so the cap always binds:
  // the width lands ON the bubble's measured content width and the height falls proportionally. ---
  await pushCompleted(upload(ID_WIDE, 'panorama.png'), 1)
  await send('a very wide one')

  const second = bubble(1)
  const panorama = second.locator('img.bubble__image')
  await expect(panorama).toHaveCount(1, { timeout: ROW_TIMEOUT_MS })
  await expect
    .poll(async () => (await drawn(panorama)).natural.width, { timeout: ROW_TIMEOUT_MS })
    .toBe(800)

  const assertCapped = async (): Promise<void> => {
    const available = await contentWidth(second)
    const { box } = await drawn(panorama)
    expect(box.width).toBeCloseTo(available, 0)
    // The height FELL rather than staying at 160 — the exact failure a `height: 160px` rule would produce,
    // where max-width clamps the width and the fixed height distorts the picture.
    expect(box.height).toBeCloseTo(available / WIDE_RATIO, 0)
    expect(box.height).toBeLessThan(THUMBNAIL_HEIGHT_PX - EPSILON_PX)
    // Never stretched: the drawn ratio is still the natural one.
    expect(box.width / box.height).toBeCloseTo(WIDE_RATIO, 1)
    // Nothing widened the document, which is what a picture escaping its bubble would do.
    const overflows = await page.evaluate(
      () => document.body.scrollWidth > document.body.clientWidth
    )
    expect(overflows).toBe(false)
  }
  await assertCapped()

  // --- 6. ⭐ AC4: BOTH bounds hold LIVE as the window resizes. The cap is re-measured against the bubble's
  // new content width at the app's 800px minimum and at a wide size, so a rule that had computed a pixel
  // width once — from the launch geometry — reddens here rather than shipping. Every geometry read after a
  // setSize polls: setSize resolves in the main process before the renderer has laid out the new viewport
  // (composer-options-clamp.spec.ts's recorded rule). ---
  const widthAt = async (windowWidth: number): Promise<number> => {
    const height = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()[1]
    )
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
      { width: windowWidth, height }
    )
    // The two reads are taken TOGETHER inside the poll, so neither can be a value from before the resize
    // settled — reading `available` once outside would race a layout that had not caught up yet.
    await expect
      .poll(
        async () => {
          const available = await contentWidth(second)
          const { box } = await drawn(panorama)
          return Math.abs(box.width - available) <= EPSILON_PX
        },
        { timeout: ROW_TIMEOUT_MS }
      )
      .toBe(true)
    await assertCapped()
    return contentWidth(second)
  }

  // 800 is the app's own minWidth; the wide arm is a real widening from the 1100 launch size. Asserted as a
  // strict inequality so a picture that ignored the resize entirely — the whole failure AC4 names — cannot
  // pass both arms.
  const narrowAvailable = await widthAt(800)
  const wideAvailable = await widthAt(1400)
  expect(wideAvailable).toBeGreaterThan(narrowAvailable + EPSILON_PX)
  // The portrait was never capped and is unchanged by either resize: its size comes from its own ratio,
  // not from the window.
  const portraitAfterResize = await drawn(portrait)
  expect(portraitAfterResize.box.height).toBeCloseTo(THUMBNAIL_HEIGHT_PX, 0)

  // --- 7. AC3's closing assumption: an image naturally shorter than 160px is NOT scaled up. ---
  await pushCompleted(upload(ID_SMALL, 'thumb.png'), 1)
  await send('a small one')

  const third = bubble(2)
  const small = third.locator('img.bubble__image')
  await expect(small).toHaveCount(1, { timeout: ROW_TIMEOUT_MS })
  await expect
    .poll(async () => (await drawn(small)).natural.width, { timeout: ROW_TIMEOUT_MS })
    .toBe(SMALL_NATURAL.width)
  const smallDrawn = await drawn(small)
  expect(smallDrawn.box.width).toBeCloseTo(SMALL_NATURAL.width, 0)
  expect(smallDrawn.box.height).toBeCloseTo(SMALL_NATURAL.height, 0)

  // --- 8. ⭐ AC5: bytes arrive and do NOT decode, because the name lied. The fetch itself succeeds — same
  // two legs, same store, same blob URL — so this isolates the decode failure from every fetch failure.
  // The result is the plain textual fallback: no broken-image icon, no reason, and the name as escaped
  // children. ---
  await pushCompleted(upload(ID_LIAR, 'pretend-picture.png'), 1)
  await send('this one lies')

  const fourth = bubble(3)
  const fallback = fourth.locator('.bubble__image-fallback')
  await expect(fallback).toHaveCount(1, { timeout: ROW_TIMEOUT_MS })
  // No <img> survives: the element that raised the error is gone, which is what "never a broken-image
  // icon" means concretely — a broken <img> is exactly what would still be in the DOM otherwise.
  await expect(fourth.locator('img.bubble__image')).toHaveCount(0)
  await expect(fourth.locator('.bubble__file')).toHaveCount(0)
  await expect(fallback.locator('.bubble__image-fallback-name')).toHaveText('pretend-picture.png')
  // The name is text, not an attribute: no attribute on the fallback or its child carries it. Read as a
  // sweep over the real attribute lists rather than as a string search, so a `title` or a `data-` sink
  // added later reddens here.
  const attributeValues = await fallback.evaluate((element) =>
    [element, ...element.querySelectorAll('*')].flatMap((node) =>
      [...node.attributes].map((attribute) => attribute.value)
    )
  )
  for (const value of attributeValues) expect(value).not.toContain('pretend-picture')
  // No reason reaches the reader — the closed set #1044's union can carry, none of it drawn.
  const fallbackText = (await fallback.textContent()) ?? ''
  for (const reason of ['refused', 'unavailable', 'busy', 'not-found', 'verification-failed']) {
    expect(fallbackText).not.toContain(reason)
  }

  // The earlier pictures are untouched by the fourth message: a failed ask does not disturb a live one,
  // and the shared URL map did not revoke a URL another bubble still points at.
  expect((await drawn(portrait)).natural.width).toBe(TALL_NATURAL.width)
  expect((await drawn(panorama)).natural.width).toBe(800)
})
