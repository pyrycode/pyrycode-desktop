import { createHash } from 'node:crypto'
import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  AttachmentChunkPayload,
  RequestAttachmentPayload,
  SendMessagePayload
} from '../src/shared/wire/types'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentUploadEvent } from '../src/shared/ipc/attachmentUpload'
import { REMOVE_ATTACHMENT_LABEL } from '../src/renderer/src/screens/conversation/ComposerAttach'

// #1264 — the remove control on a pending attachment tile, in the one tier that can press it. Renderer
// specs are `renderToStaticMarkup` under `environment: 'node'` with no DOM, no stylesheet and no handlers,
// so ComposerAttach.test.tsx owns the fold (`removePendingAttachment`) and the markup (one control per
// tile, outside the frame, named by a constant), and everything below is what only a running window can
// answer: that the control is PAINTED where the design hangs it rather than clipped away by the frame,
// that a click removes that tile and only that one, that NO frame reaches the host in between, and that
// the send which follows names exactly the ids still standing.
//
// ONE test() block, ONE launch, ONE continuous drive (the sibling attach specs' shape): each launch pays a
// full handshake, and the ordering is load-bearing — the envelope baseline must be read before the click.
//
// ⭐ THE OUTBOUND CAPTURE, WHICH THIS TIER HAS NOT HAD BEFORE. `attachment_ids` was asserted only in
// real-claude-attachment.spec.ts. `startFakeDaemon` calls `buildReplyFrames` with every decrypted inbound
// plaintext, in THIS process, so a spec-local closure sees every envelope the client sends and can record
// what each one named. The WebSocket keepalive is a protocol-level ping rather than a noise_msg, so it
// never reaches this seam and the count below is stable.
//
// THE STANDING RULE IS KEPT — nothing here supplies an input production does not produce. The two tiles
// are minted by pushing `completed` members of `AttachmentUploadEvent` on the channel
// `src/main/attachmentUpload` sends its terminals on (composer-attach.spec.ts's seam, and the reason it
// exists: a real attach opens a NATIVE file dialog no locator can dismiss).

const TIMEOUT_MS = 15_000

// Two completions, so "only that tile" has something to be only. Distinct uploadIds — two transfers can be
// live at once — and extensions that share no character, so the survivor is identifiable by its own label
// and a wrong-tile removal cannot read as a right one.
const FIRST: AttachmentUploadEvent = {
  type: 'completed',
  uploadId: 'e2e-remove-1',
  filename: 'e2e-report.pdf'
}
const SECOND: AttachmentUploadEvent = {
  type: 'completed',
  uploadId: 'e2e-remove-2',
  filename: 'e2e-bundle.zip'
}

const TYPED_TEXT = 'the second file is still attached'

// The design's own numbers for the control against its 45x60 tile (Figma `Icon` 390:7183 at x=30, y=-5,
// 20x20), and the offsets of two probe points used to prove the overhang is PAINTED rather than merely
// laid out. Both sit inside the disc (radius 7 about the control's centre) and outside the tile's frame —
// one past its right edge, one above its top edge. A boundingBox() read cannot make that distinction:
// layout boxes are reported whether or not an ancestor's `overflow: hidden` cut the pixels away.
const CONTROL_DX = 30
const CONTROL_DY = -5
const CONTROL_SIZE = 20
const RIGHT_PROBE = { dx: 46.5, dy: 5 }
const TOP_PROBE = { dx: 40, dy: -1.5 }

// Sub-pixel tolerance, the sibling specs' EPSILON.
const EPSILON_PX = 1.5

test('a tile’s remove control takes that file back before send, and sends nothing doing it', async ({
  launchPairedApp
}) => {
  // Every inbound envelope the daemon decrypts, in arrival order. `send_message` is answered with NO
  // frames — the optimistic echo renders on its own (the thread-scroll-pin plant idiom) — and every other
  // inbound gets the shared one-row seed, since a scripted builder overrides the fixture's default arm.
  const inbound: { type: string; attachmentIds?: readonly string[] }[] = []
  const { page, app } = await launchPairedApp({
    buildReplyFrames: (plaintext: Uint8Array): Uint8Array[] => {
      const envelope = decodeEnvelope(plaintext)
      if (envelope.type === 'send_message') {
        const payload = envelope.payload as SendMessagePayload
        inbound.push({ type: envelope.type, attachmentIds: payload.attachment_ids })
        return []
      }
      inbound.push({ type: envelope.type })
      return [seedConversationsFrame()]
    }
  })

  const strip = page.locator('.composer__attachments')
  const tiles = page.locator('.composer__attachment')
  const composer = page.locator('.composer')
  // Located by ROLE AND ACCESSIBLE NAME, which makes this an accessibility assertion as well as a locator:
  // a control with no name resolves to nothing here. `exact` is load-bearing — getByRole matches `name`
  // as a case-insensitive substring by default.
  const controls = page.getByRole('button', { name: REMOVE_ATTACHMENT_LABEL, exact: true })

  await expect(tiles).toHaveCount(0)
  await expect(controls).toHaveCount(0)

  const push = (event: AttachmentUploadEvent): Promise<void> =>
    app.evaluate(
      ({ BrowserWindow }, payload) => {
        const [window] = BrowserWindow.getAllWindows()
        window.webContents.send(payload.channel, payload.event)
      },
      { channel: ATTACHMENT_UPLOAD_EVENT_CHANNEL, event }
    )

  await push(FIRST)
  await push(SECOND)
  await expect(tiles).toHaveCount(2, { timeout: TIMEOUT_MS })
  await expect(tiles.nth(0)).toHaveText('PDF')
  await expect(tiles.nth(1)).toHaveText('ZIP')

  // --- AC1: one control per tile, hung 20x20 off the tile's top-right corner and overhanging it by 5px on
  // both axes. The design's own node box, read against the tile the control belongs to. ---
  await expect(controls).toHaveCount(2)
  const firstTileBox = (await tiles.nth(0).boundingBox())!
  const firstControlBox = (await controls.nth(0).boundingBox())!
  expect(firstControlBox.width).toBeCloseTo(CONTROL_SIZE, 0)
  expect(firstControlBox.height).toBeCloseTo(CONTROL_SIZE, 0)
  expect(firstControlBox.x - firstTileBox.x).toBeCloseTo(CONTROL_DX, 0)
  expect(firstControlBox.y - firstTileBox.y).toBeCloseTo(CONTROL_DY, 0)
  // The 5px top overhang hangs into `.composer`'s own padding-top rather than out of the composer: the
  // strip needed no extra headroom, and this is the assertion that reddens if that arithmetic is wrong.
  const composerBox = (await composer.boundingBox())!
  expect(firstControlBox.y).toBeGreaterThanOrEqual(composerBox.y - EPSILON_PX)

  // ⭐ AC1'S LAST CLAUSE, AND THE ONLY DETECTOR FOR IT. `.composer__attachment` declares `overflow: hidden`
  // for #1263's `cover` picture; a control rendered inside that frame is laid out exactly where these
  // boxes say and PAINTED nowhere past the frame's edge. So the proof is hit-testing, not geometry: at a
  // point inside the control's disc and outside the tile's frame, the topmost element must be the control.
  // Rendered inside the frame, both probes land on whatever is behind instead.
  const labelAt = (x: number, y: number): Promise<string | null> =>
    page.evaluate(
      ({ px, py }) => {
        const element = document.elementFromPoint(px, py)
        return element === null ? null : (element.closest('button')?.getAttribute('aria-label') ?? null)
      },
      { px: x, py: y }
    )
  expect(await labelAt(firstTileBox.x + RIGHT_PROBE.dx, firstTileBox.y + RIGHT_PROBE.dy)).toBe(
    REMOVE_ATTACHMENT_LABEL
  )
  expect(await labelAt(firstTileBox.x + TOP_PROBE.dx, firstTileBox.y + TOP_PROBE.dy)).toBe(
    REMOVE_ATTACHMENT_LABEL
  )

  // --- AC4, read off the LIVE DOM while both tiles stand: the control is named by the client-owned
  // constant, and no part of either file name reached any attribute of the strip. The static tier asserts
  // this on the render; here it is the shipped stylesheet's own markup, after every effect has run. ---
  const stripMarkup = await page.evaluate(
    () => document.querySelector('.composer__attachments')?.outerHTML ?? ''
  )
  expect(stripMarkup).toContain(`aria-label="${REMOVE_ATTACHMENT_LABEL}"`)
  expect(stripMarkup).not.toContain(FIRST.uploadId)
  expect(stripMarkup).not.toContain(SECOND.uploadId)
  // ⭐ #1265 RE-AIMED THE TWO NAME NEGATIVES FROM THE MARKUP TO THE ATTRIBUTES. They read
  // `not.toContain('e2e-report')` while the strip rendered no name anywhere, which asserted "the name
  // reaches no attribute" BY asserting it reached nothing at all. #1265 draws each name in a pill, as
  // escaped children, so the premise is false by design and the claim is restated as what it always
  // meant — an enumeration of every attribute of every element in the strip, none of which may carry any
  // fragment of a name. Strictly stronger than the substring negative it replaces: that one could not
  // have told a name in an attribute from a name in a text node.
  const stripAttributes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.composer__attachments, .composer__attachments *')).flatMap(
      (element) => Array.from(element.attributes).map((attribute) => attribute.value)
    )
  )
  expect(stripAttributes.filter((value) => /e2e-report|e2e-bundle/.test(value))).toEqual([])
  const namesInStrip = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.composer__attachments [aria-label]')).map((element) =>
      element.getAttribute('aria-label')
    )
  )
  expect(namesInStrip).toEqual([REMOVE_ATTACHMENT_LABEL, REMOVE_ATTACHMENT_LABEL])

  // --- AC3's baseline, read BEFORE the click. A bare count asserted after it would pass before the
  // click's own work had resolved, which is why the positive read below is ordered first. ---
  const envelopesBeforeClick = inbound.length
  expect(envelopesBeforeClick).toBeGreaterThan(0) // the launch drive itself sent frames

  // --- AC2: the FIRST control removes the FIRST tile and only it. The positive, auto-waiting read of the
  // click's own effect comes first — one tile left, and it is the one the click did not name. ---
  await controls.nth(0).click()
  await expect(tiles).toHaveCount(1, { timeout: TIMEOUT_MS })
  await expect(tiles.nth(0)).toHaveText('ZIP')
  await expect(controls).toHaveCount(1)

  // --- AC3: nothing went to the host. Held over a real interval rather than read once, so a frame sent
  // late would still fail this. ---
  await page.waitForTimeout(250)
  expect(inbound.length).toBe(envelopesBeforeClick)

  // --- AC2's second half, on the wire. The send is also the MUTATION CHECK for the absence above: the
  // count was capable of moving all along, so "unchanged" measured the client rather than the capture. ---
  await page.getByPlaceholder('Message…').fill(TYPED_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(strip).toHaveCount(0, { timeout: TIMEOUT_MS })
  await expect
    .poll(() => inbound.filter((envelope) => envelope.type === 'send_message').length, {
      timeout: TIMEOUT_MS
    })
    .toBe(1)
  expect(inbound.length).toBeGreaterThan(envelopesBeforeClick)
  const sent = inbound.filter((envelope) => envelope.type === 'send_message')[0]
  // The removed file's id is NOT named, and the surviving one IS — the two halves of the criterion, which
  // an assertion on either alone would leave half open.
  expect(sent.attachmentIds).toEqual([SECOND.uploadId])
})

// ================================================================================================
// ⭐ THE SECOND DRIVE, AND WHY IT IS OVER TWO IMAGE TILES. The drive above removes a `.pdf` in front of a
// `.zip`, and both draw `AttachmentFileIcon` — a hook-free component with no state and nothing held. So it
// cannot reach the defect a mid-list removal actually creates: the tile behind an image name is
// `ComposerAttachmentImage`, which owns a `useState` and a refcounted `blob:` URL, and reconciliation
// decides which fiber a survivor is drawn by.
//
// Under the array-index key this strip inherited from #1262, `[A, B] → [B]` reuses A's fiber for B — A's
// state, A's `<img src>` — while React's passive phase revokes B's URL before the reused fiber asks for it
// again, sending the survivor back to the host on the cold path. The operator watches the picture they just
// removed sit on the tile that survived. `pendingAttachmentKeys` is the fix; the two assertions below are
// its detector, and BOTH are timing-free rather than a race against the refetch:
//
//   - the survivor's `src` is the SAME blob: URL it held before the click. Under the bug it is A's URL for
//     the length of a round trip and a FRESHLY MINTED one after (the old one was revoked and
//     `createObjectURL` mints a random UUID), so no reading of it can equal what was captured.
//   - no envelope reaches the host. The refetch is a `request_attachment` on the wire, so AC3's own absence
//     assertion — baseline before, unchanged after — is what catches it, on image tiles.
// ================================================================================================

// Canonical ids: `resolveAttachmentPath`'s CANONICAL_ATTACHMENT_ID is /^[0-9a-f-]{1,64}$/ and it gates both
// the store write and the read back, so a `e2e-remove-1`-shaped id would be refused at storage and turn
// every picture into the file-tile fallback — which would quietly put this spec back on hook-free tiles.
const ID_WIDE = '1a2b3c4d-5e6f-4a7b-8c9d-1e2f3a4b5c6d'
const ID_SHORT = '2b3c4d5e-6f7a-4b8c-9d0e-2f3a4b5c6d7e'

// Two pictures with DIFFERENT natural sizes, so "which file's picture is this tile drawing" is answerable
// from the DOM rather than only inferable. The first is composer-attachment-image.spec.ts's 800x100; the
// second is a 120x40 generated for this spec. Both are a few hundred bytes, far under
// ATTACHMENT_CHUNK_DATA_BYTES, so each rides exactly one chunk. Neither carries any information.
const WIDE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAyAAAABkCAIAAADxM8PYAAABkUlEQVR42u3WMQ0AAAzDsEIZlEEd1JHoackIciW3AwBAUSQAADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAIDBAgAwWAAABgsAwGABAGCwAAAMFgCAwQIAwGABABgsAACDBQCAwQIAMFgAAAYLAACDBQBgsAAADBYAgMECAMBgAQAYLAAAgwUAgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAIMFAIDBAgAwWAAABgsAAIMFAGCwAAAMFgAABgsAwGABABgsAAAMFgCAwQIAMFgAAAYLAACDBQBgsAAADBYAAAYLAMBgAQAYLAAADBYAgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAAwWAIDBAgAwWAAAGCwAAIMFAGCwAAAMFgAABgsAwGABABgsAAAMFgCAwQIAMFgAABgsAACDBQBgsAAAMFgAAAYLAMBgAQAYLAAADBYAgMECADBYAAAYLAAAgwUAYLAAADBYAAAGCwDAYAEAYLAAANoej5+SST6U8/EAAAAASUVORK5CYII='
const SHORT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAIAAAC6iKlyAAAAUklEQVR42u3QQQ0AAAgEoItjHCMa1RbOBxsJSPVwIApEi0a0aNEWRItGtGjRFkSLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0Yj+ZwG7nYMtQsFOZQAAAABJRU5ErkJggg=='
const WIDE_NATURAL_WIDTH = 800
const SHORT_NATURAL_WIDTH = 120

const SERVED = new Map<string, Buffer>([
  [ID_WIDE, Buffer.from(WIDE_PNG_BASE64, 'base64')],
  [ID_SHORT, Buffer.from(SHORT_PNG_BASE64, 'base64')]
])

/** The daemon's answer to one `request_attachment`: a single `attachment_chunk` carrying the whole file —
 *  composer-attachment-image.spec.ts's own fixture, whose digest is COMPUTED because `attachmentReassembler`
 *  verifies an exact lowercase-hex SHA-256 and a hand-written one fails closed into the fallback tile. */
function serveAttachmentFrame(requestId: number, ask: RequestAttachmentPayload): Uint8Array[] {
  const bytes = SERVED.get(ask.attachment_id)
  if (bytes === undefined) return []
  const payload: AttachmentChunkPayload = {
    // Empty on the retrieval direction: the chunk is correlated by `in_reply_to` to a request that already
    // named the conversation, so the field is emitted empty and ignored.
    conversation_id: '',
    attachment_id: ask.attachment_id,
    index: 0,
    total_chunks: 1,
    filename: 'served-bytes',
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

test('removing an image tile leaves the survivor drawing its own picture, and asks the host for nothing', async ({
  launchPairedApp
}) => {
  const inbound: { type: string; attachmentIds?: readonly string[] }[] = []
  const { page, app } = await launchPairedApp({
    buildReplyFrames: (plaintext: Uint8Array): Uint8Array[] => {
      const envelope = decodeEnvelope(plaintext)
      inbound.push(
        envelope.type === 'send_message'
          ? {
              type: envelope.type,
              attachmentIds: (envelope.payload as SendMessagePayload).attachment_ids
            }
          : { type: envelope.type }
      )
      if (envelope.type === 'request_attachment') {
        return serveAttachmentFrame(envelope.id, envelope.payload as RequestAttachmentPayload)
      }
      return envelope.type === 'send_message' ? [] : [seedConversationsFrame()]
    }
  })

  const tiles = page.locator('.composer__attachment')
  const pictures = page.locator('.composer__attachment-image')
  const controls = page.getByRole('button', { name: REMOVE_ATTACHMENT_LABEL, exact: true })

  const push = (event: AttachmentUploadEvent): Promise<void> =>
    app.evaluate(
      ({ BrowserWindow }, payload) => {
        const [window] = BrowserWindow.getAllWindows()
        window.webContents.send(payload.channel, payload.event)
      },
      { channel: ATTACHMENT_UPLOAD_EVENT_CHANNEL, event }
    )

  await push({ type: 'completed', uploadId: ID_WIDE, filename: 'panorama.png' })
  await push({ type: 'completed', uploadId: ID_SHORT, filename: 'thumbnail.png' })

  // Both pictures have to be DRAWN before the removal, not merely requested: a survivor that never had a URL
  // of its own could not be shown to have kept it.
  await expect(tiles).toHaveCount(2, { timeout: TIMEOUT_MS })
  await expect(pictures).toHaveCount(2, { timeout: TIMEOUT_MS })
  const drawnBefore = await pictures.evaluateAll((elements) =>
    elements.map((element) => ({
      src: element.getAttribute('src') ?? '',
      naturalWidth: (element as HTMLImageElement).naturalWidth
    }))
  )
  expect(drawnBefore.map((picture) => picture.naturalWidth)).toEqual([
    WIDE_NATURAL_WIDTH,
    SHORT_NATURAL_WIDTH
  ])
  // Two distinct object URLs — one per attachment, which is what makes the equality below say something.
  expect(drawnBefore[0].src).not.toBe(drawnBefore[1].src)

  const envelopesBeforeClick = inbound.length
  const fetchesBeforeClick = inbound.filter(
    (envelope) => envelope.type === 'request_attachment'
  ).length
  expect(envelopesBeforeClick).toBeGreaterThan(0)
  // Each picture cost one fetch, and that is the baseline a third would show against.
  expect(fetchesBeforeClick).toBeGreaterThanOrEqual(2)

  // The positive, auto-waiting read of the click's own effect comes first, ahead of every absence below.
  await controls.nth(0).click()
  await expect(tiles).toHaveCount(1, { timeout: TIMEOUT_MS })
  await expect(pictures).toHaveCount(1, { timeout: TIMEOUT_MS })

  // ⭐ THE DETECTOR. Read ONCE rather than polled: an auto-retrying assertion would wait out the bug's cold
  // refetch and pass on the replacement URL. Under the fix the survivor's fiber was never touched, so this is
  // the identical URL it was drawing before the click; under the bug it is the removed tile's URL, or a fresh
  // one minted after its own was revoked — never this one.
  const drawnAfter = await pictures.evaluateAll((elements) =>
    elements.map((element) => ({
      src: element.getAttribute('src') ?? '',
      naturalWidth: (element as HTMLImageElement).naturalWidth,
      complete: (element as HTMLImageElement).complete
    }))
  )
  expect(drawnAfter[0].src).toBe(drawnBefore[1].src)
  expect(drawnAfter[0].naturalWidth).toBe(SHORT_NATURAL_WIDTH)
  // Never a blink through the empty frame either: the picture was decoded before the click and stayed so.
  expect(drawnAfter[0].complete).toBe(true)

  // AC3, on image tiles: the removal sent nothing. The cold refetch the index key forced IS a
  // `request_attachment` on the wire, so this is the same absence the first drive asserts, now with a second
  // way to fail. Held over a real interval so a frame sent late still fails it.
  await page.waitForTimeout(250)
  expect(inbound.filter((envelope) => envelope.type === 'request_attachment').length).toBe(
    fetchesBeforeClick
  )
  expect(inbound.length).toBe(envelopesBeforeClick)

  // The mutation check for that count, and AC2 on the wire for an image attachment: the send that follows
  // moves it, and names only the tile still standing.
  await page.getByPlaceholder('Message…').fill('the thumbnail is still attached')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect
    .poll(() => inbound.filter((envelope) => envelope.type === 'send_message').length, {
      timeout: TIMEOUT_MS
    })
    .toBe(1)
  expect(inbound.length).toBeGreaterThan(envelopesBeforeClick)
  expect(inbound.filter((envelope) => envelope.type === 'send_message')[0].attachmentIds).toEqual([
    ID_SHORT
  ])
})
