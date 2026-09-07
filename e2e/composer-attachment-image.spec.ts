import { createHash } from 'node:crypto'
import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentUploadEvent } from '../src/shared/ipc/attachmentUpload'
import { ATTACHMENT_IMAGE_ALT } from '../src/renderer/src/screens/conversation/BubbleAttachmentImage'
import type { AttachmentChunkPayload, RequestAttachmentPayload } from '../src/shared/wire/types'

// #1263 — the picture in a pending attachment's tile, end to end. This tier owns everything the static renderer
// tier cannot see: `vitest.config.ts` sets `environment: 'node'`, so ComposerAttachmentImage.test.tsx is a
// `renderToStaticMarkup` string with no DOM, no stylesheet and no effects. It pins the markup of each state and
// the untrusted-name posture; it cannot load an image, measure a box, or watch a tile move from one state to the
// next. That is all here.
//
// ⭐ A SEPARATE SPEC RATHER THAN AN ADDITION TO composer-attach.spec.ts. That file is one continuous drive over a
// single launch, and it takes the fixture's DEFAULT daemon; serving attachment bytes means passing a
// `buildReplyFrames`, which would change the daemon under all 385 lines of it for the sake of four tiles. Its
// own names (`e2e-report.pdf`, `e2e-bundle.zip`) are not image names, so this ticket's branch leaves it alone.
//
// ⭐ THE FETCH IS DRIVEN TO COMPLETION, attachment-image-thumbnail.spec.ts's inversion carried over: the upload
// leg keeps no local copy of what it streams, so the only way real bytes reach an `<img>` is to fetch them back
// from the host. Completion is safe here for that spec's recorded reason — the bytes land in the app-private
// attachment directory under the throwaway `--user-data-dir` and go nowhere else. There is no save leg.
//
// ⭐ WHAT THIS TIER CANNOT PROVE IS AC4. The fake daemon below answers `request_attachment` itself, so a green
// run says the CLIENT asks correctly and draws what comes back — it says nothing about whether a REAL host
// answers for an attachment no message references yet. That is e2e/real-claude-attachment.spec.ts's, behind the
// operator's `npm run e2e:real:gate`.
//
// SECRET HYGIENE, the sibling specs' rule carried verbatim: every literal is an invented non-secret name or an
// invented image, and every assertion reads DOM state, computed style or geometry. The one `blob:` URL read is
// matched against its scheme and never printed — it is a capability handle to the file's bytes in this origin.

const TILE_TIMEOUT_MS = 15_000

// Sub-pixel tolerance: the browser lays out in fractional pixels and the values compared are integer design
// constants against measured boxes.
const EPSILON_PX = 1.5

// The drawn frame, off Figma `Input attachment` 390:7199 and `Slot` 390:7182.
const TILE_WIDTH_PX = 45
const TILE_HEIGHT_PX = 60
// --space-3, the strip's gap. 45 + 12 is the pitch every position assertion below is built from.
const TILE_PITCH_PX = TILE_WIDTH_PX + 12
// --radius-xs — the frame's clip, which is what the picture is drawn inside.
const RADIUS_PX = 6

// ⭐ CANONICAL ATTACHMENT IDS — hex digits and hyphen only. `resolveAttachmentPath`'s CANONICAL_ATTACHMENT_ID is
// /^[0-9a-f-]{1,64}$/ and it gates the store write and the read back, so a `e2e-upload-3`-shaped id would be
// refused at storage and turn every picture into the fallback. These ride the pending set as `attachmentId`,
// which `reducePendingAttachments` takes from the completion's `uploadId`.
const ID_NEVER_ANSWERED = '5a6b7c8d-9e0f-4a1b-8c9d-5e6f7a8b9c0d'
const ID_DOCUMENT = '6a7b8c9d-0e1f-4a2b-8c9d-6e7f8a9b0c1d'
const ID_PICTURE = '7a8b9c0d-1e2f-4a3b-8c9d-7e8f9a0b1c2d'
const ID_LIAR = '8a9b0c1d-2e3f-4a4b-8c9d-8e9f0a1b2c3d'

// An 800x100 PNG, generated for this spec and carrying no information at all — a few hundred bytes, far under
// ATTACHMENT_CHUNK_DATA_BYTES (45000), so it rides exactly one chunk.
//
// ⭐ THE SHAPE IS THE TEST. Its natural ratio is 8, where the tile's is 0.75, so the picture cannot fill the
// 45x60 frame in both axes without something being cut off — which is what separates `cover` from `contain`
// (letterboxed) and from `fill` (squashed) as a VISIBLE outcome rather than only a computed one.
const WIDE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAyAAAABkCAIAAADxM8PYAAABkUlEQVR42u3WMQ0AAAzDsEIZlEEd1JHoackIciW3AwBAUSQAADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAIDBAgAwWAAABgsAwGABAGCwAAAMFgCAwQIAwGABABgsAACDBQCAwQIAMFgAAAYLAACDBQBgsAAADBYAgMECAMBgAQAYLAAAgwUAgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAIMFAIDBAgAwWAAABgsAAIMFAGCwAAAMFgAABgsAwGABABgsAAAMFgCAwQIAMFgAAAYLAACDBQBgsAAADBYAAAYLAMBgAQAYLAAADBYAgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAAwWAIDBAgAwWAAAGCwAAIMFAGCwAAAMFgAABgsAwGABABgsAAAMFgCAwQIAMFgAABgsAACDBQBgsAAAMFgAAAYLAMBgAQAYLAAADBYAgMECADBYAAAYLAAAgwUAYLAAADBYAAAGCwDAYAEAYLAAANoej5+SST6U8/EAAAAASUVORK5CYII='
const PICTURE_NATURAL = { width: 800, height: 100 }

// A name that LIES. The extension says `.png`, so `isImageAttachmentName` admits it and a picture is attempted;
// the bytes are ASCII and no decoder will take them, so `<img>` raises `error` and the file tile draws in its
// place. Nothing about the fetch differs — that is the point: an untrusted name decides what is DRAWN, never
// what is fetched or from where.
const LIAR_BYTES = Buffer.from('this is not an image, whatever the name says', 'ascii')

const SERVED = new Map<string, Buffer>([
  [ID_PICTURE, Buffer.from(WIDE_PNG_BASE64, 'base64')],
  [ID_LIAR, LIAR_BYTES]
])

/**
 * The daemon's answer to one `request_attachment`: a single `attachment_chunk` carrying the whole file.
 *
 * ⭐ AN ID NOT IN `SERVED` IS ANSWERED WITH NOTHING AT ALL, and that is a deliberate fixture rather than a gap.
 * `attachmentRetrieval` sets no deadline, so an unanswered ask stays in flight for the window's lifetime — which
 * is the only way to hold a tile in its IN-FLIGHT state long enough to measure it. AC2's first half is otherwise
 * a race against the fetch.
 *
 * THE DIGEST IS COMPUTED, NEVER WRITTEN BY HAND: `attachmentReassembler` verifies the assembled bytes against
 * the declared length AND an exact lowercase-hex SHA-256, so a hand-written digest fails closed as
 * `verification-failed` and every picture silently becomes the fallback.
 */
function serveAttachmentFrame(requestId: number, ask: RequestAttachmentPayload): Uint8Array[] {
  const bytes = SERVED.get(ask.attachment_id)
  if (bytes === undefined) return []
  const payload: AttachmentChunkPayload = {
    // EMPTY ON THE RETRIEVAL DIRECTION, which is what the field's own contract says: a retrieval chunk is
    // correlated by `in_reply_to` to a request that already named the conversation, so this is emitted empty
    // and ignored. (attachment-image-thumbnail.spec.ts omits the field outright and nothing catches it — no
    // tsconfig includes `e2e/` and Playwright strips types with esbuild, so a type error in a spec surfaces in
    // no gate. Typechecked here by hand.)
    conversation_id: '',
    attachment_id: ask.attachment_id,
    index: 0,
    total_chunks: 1,
    filename: 'served-bytes',
    // The channel between main and the window carries no media type and the reassembler reads this field for
    // nothing at all, so it is what a real daemon would sniff and is relied on by no assertion below.
    mime_type: 'image/png',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    data: bytes.toString('base64')
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
  return envelope.type === 'send_message' ? [] : [seedConversationsFrame()]
}

/** A settled upload exactly as `src/main/attachmentUpload` emits it. The SENDER is the only thing standing in for
 *  production, because the alternative is a native file dialog no Playwright locator can dismiss —
 *  composer-attach.spec.ts's established seam. `uploadId` becomes the pending record's `attachmentId`. */
const upload = (uploadId: string, filename: string): AttachmentUploadEvent => ({
  type: 'completed',
  uploadId,
  filename
})

test('a pending image attachment draws its own picture, clipped to the tile (#1263 AC1-AC3)', async ({
  launchPairedApp
}) => {
  const { page, app } = await launchPairedApp({ buildReplyFrames })

  const pushCompleted = (event: AttachmentUploadEvent): Promise<void> =>
    app.evaluate(
      ({ BrowserWindow }, payload) => {
        const [window] = BrowserWindow.getAllWindows()
        window.webContents.send(payload.channel, payload.event)
      },
      { channel: ATTACHMENT_UPLOAD_EVENT_CHANNEL, event }
    )

  const strip = page.locator('.composer__attachments')
  const tiles = page.locator('.composer__attachment')
  const pictures = page.locator('.composer__attachment-image')

  // --- The four tiles, pushed in an order that is itself the proof. Index 0 is an image whose bytes never
  // arrive, so it holds the IN-FLIGHT state for the whole run; index 1 is the neighbour whose position measures
  // it. Indexes 2 and 3 are the picture and the name that lied.
  await pushCompleted(upload(ID_NEVER_ANSWERED, 'still-uploading.png'))
  await pushCompleted(upload(ID_DOCUMENT, 'quarterly-notes.pdf'))
  await pushCompleted(upload(ID_PICTURE, 'panorama.png'))
  await pushCompleted(upload(ID_LIAR, 'pretend-picture.png'))

  await expect(tiles).toHaveCount(4, { timeout: TILE_TIMEOUT_MS })

  // --- AC1: the picture draws, and it is the bytes the host sent. `naturalWidth` is also the CSP detector — a
  // source the policy refuses never decodes and reads 0, and its <img> would have raised `error` and unmounted
  // into the file tile, so the count below would read 0 rather than 1.
  await expect(pictures).toHaveCount(1, { timeout: TILE_TIMEOUT_MS })
  const picture = pictures.first()
  const natural = await picture.evaluate((element) => ({
    width: (element as HTMLImageElement).naturalWidth,
    height: (element as HTMLImageElement).naturalHeight,
    complete: (element as HTMLImageElement).complete
  }))
  expect(natural.complete).toBe(true)
  expect(natural).toMatchObject(PICTURE_NATURAL)

  // --- AC1: `object-fit: cover`, centred, at the picture's own aspect ratio.
  //
  // ⭐ THE COMPUTED VALUE IS THE DETECTOR, and it is named because the box alone is not one: an <img> given
  // width/height 100% lays out at 45x60 under `fill`, `contain` AND `cover` — only what it PAINTS inside that
  // box differs, and computed style is the only thing this tier can read of it. Deleting the rule reverts
  // `objectFit` to `fill` and fails the first line here. The box read beside it proves the picture fills the
  // frame in BOTH axes, which is what "never letterboxed" means for the element; `objectPosition` is asserted
  // at its default because that default IS the criterion's "centred" and the production rule declares nothing.
  const style = await picture.evaluate((element) => {
    const computed = getComputedStyle(element)
    const frame = getComputedStyle(element.parentElement as HTMLElement)
    return {
      objectFit: computed.objectFit,
      objectPosition: computed.objectPosition,
      frameOverflow: frame.overflow,
      frameRadius: frame.borderTopLeftRadius
    }
  })
  expect(style.objectFit).toBe('cover')
  expect(style.objectPosition).toBe('50% 50%')
  // The clip AC1 names: the picture is drawn INSIDE the frame the strip already rounds, not inside a second
  // frame of its own. Both are read off the parent, which is where #1262 put them.
  expect(style.frameOverflow).toBe('hidden')
  expect(parseFloat(style.frameRadius)).toBeCloseTo(RADIUS_PX, 1)

  const pictureBox = (await picture.boundingBox())!
  expect(Math.abs(pictureBox.width - TILE_WIDTH_PX)).toBeLessThan(EPSILON_PX)
  expect(Math.abs(pictureBox.height - TILE_HEIGHT_PX)).toBeLessThan(EPSILON_PX)

  // --- AC2, first half, and the reason index 0 exists. Its bytes never arrive, so its frame is drawn and empty
  // for the whole run: no <img>, no glyph, no text. The DETECTOR is its neighbour's position — had the in-flight
  // arm drawn nothing, the document tile would sit at x=0 instead of one pitch in, and would then SHIFT the
  // moment a picture arrived. Measured relative to the strip so the window's own width takes no part.
  const inFlight = tiles.nth(0)
  await expect(inFlight.locator('img')).toHaveCount(0)
  await expect(inFlight.locator('svg')).toHaveCount(0)
  expect(await inFlight.textContent()).toBe('')

  const stripBox = (await strip.boundingBox())!
  const offsets: number[] = []
  for (let index = 0; index < 4; index += 1) {
    const box = (await tiles.nth(index).boundingBox())!
    offsets.push(box.x - stripBox.x)
    // AC2's other half: every tile is the same 45x60 box whatever state it is in, so nothing can shift.
    expect(Math.abs(box.width - TILE_WIDTH_PX)).toBeLessThan(EPSILON_PX)
    expect(Math.abs(box.height - TILE_HEIGHT_PX)).toBeLessThan(EPSILON_PX)
  }
  for (let index = 0; index < 4; index += 1) {
    // #868's rule: a rounded delta compared with `toBe(0)` normalises -0 first, since Object.is(-0, 0) is false.
    const delta = Math.round(offsets[index] - index * TILE_PITCH_PX) + 0
    expect(delta === 0 ? 0 : delta).toBe(0)
  }

  // --- AC2, second half: a picture that fails to DECODE draws the file tile in its place, never a broken-image
  // icon. Index 3's bytes are ASCII behind a `.png` name, so its <img> raised `error` and unmounted — which is
  // also why `pictures` counts 1 above and not 2.
  const liar = tiles.nth(3)
  await expect(liar.locator('svg')).toHaveCount(1, { timeout: TILE_TIMEOUT_MS })
  await expect(liar.locator('img')).toHaveCount(0)
  await expect(liar).toHaveText('PNG')

  // The document tile is unaffected by the branch — the shipped file tile under a non-image name.
  await expect(tiles.nth(1)).toHaveText('PDF')

  // --- AC3: the name reaches no attribute, and the only source is the blob: URL the shipped module minted.
  const attributes = await picture.evaluate((element) => ({
    alt: element.getAttribute('alt'),
    title: element.getAttribute('title'),
    ariaLabel: element.getAttribute('aria-label'),
    scheme: (element.getAttribute('src') ?? '').split(':')[0]
  }))
  expect(attributes.alt).toBe(ATTACHMENT_IMAGE_ALT)
  expect(attributes.title).toBeNull()
  expect(attributes.ariaLabel).toBeNull()
  expect(attributes.scheme).toBe('blob')

  // No file name, no host-side storage handle, and no path anywhere in the strip. The extension labels the file
  // tiles draw are derived, at most four characters, and are the only thing of a record that may be shown.
  for (const leaked of [
    'still-uploading.png',
    'quarterly-notes.pdf',
    'panorama.png',
    'pretend-picture.png',
    ID_PICTURE,
    ID_LIAR,
    ID_NEVER_ANSWERED,
    ID_DOCUMENT
  ]) {
    await expect(strip).not.toContainText(leaked)
  }
})
