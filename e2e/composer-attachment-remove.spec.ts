import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope } from '../src/main/transport/codec'
import type { SendMessagePayload } from '../src/shared/wire/types'
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
  expect(stripMarkup).not.toContain('e2e-report')
  expect(stripMarkup).not.toContain('e2e-bundle')
  expect(stripMarkup).not.toContain(FIRST.uploadId)
  expect(stripMarkup).not.toContain(SECOND.uploadId)
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
