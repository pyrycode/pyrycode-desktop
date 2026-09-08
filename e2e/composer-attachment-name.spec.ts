import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope } from '../src/main/transport/codec'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentUploadEvent } from '../src/shared/ipc/attachmentUpload'

// #1265 — the file-name pill on an attachment tile, in the one tier that can hover or focus anything.
// Renderer specs are `renderToStaticMarkup` under `environment: 'node'` with no DOM and no stylesheet, so
// ComposerAttach.test.tsx owns the markup (one pill per tile, LAST in the slot and outside the frame that
// clips, the name as escaped children and in no attribute) and everything below is what only a running
// window can answer: that the two triggers actually show and hide it, that it is drawn in the Pill's own
// treatment, that its box lands one row up over the status row inside every ancestor, that a showing pill
// moves nothing, and that hovering a tile sends nothing to the host.
//
// ⭐ THE STRUCTURAL CLAIM IS NOT MEASURED HERE, DELIBERATELY. `.composer__attachment` declares
// `overflow: hidden` for #1263's `cover` picture, and a pill rendered inside that frame is laid out exactly
// where these boxes would report and PAINTED nowhere — layout boxes come back whether or not an ancestor
// clipped the pixels away, so no geometry in this file can tell the two apart, and `toBeVisible()` cannot
// either. The detector for that trap is the unit tier's adjacency assertion, where "which element is this a
// child of" is a fact rather than an inference. What geometry proves here is the other half: that the box
// the design asks for is the box the stylesheet produces, and that it is inside the one ancestor that clips.
//
// ONE test() block, ONE launch, ONE continuous drive (the sibling attach specs' shape): each launch pays a
// full handshake, and the ordering is load-bearing throughout — every absence assertion below is placed
// after a positive, auto-waiting read of the same gesture's own effect.

const TIMEOUT_MS = 15_000

// Two completions whose names share no distinctive run, so "which pill is this" is answerable from the text
// alone. Neither is an image name, so both tiles take the hook-free `AttachmentFileIcon` branch and the
// strip's markup is settled the moment the tiles mount.
const FIRST: AttachmentUploadEvent = {
  type: 'completed',
  uploadId: 'e2e-name-1',
  filename: 'quarterly-report.pdf'
}
const SECOND: AttachmentUploadEvent = {
  type: 'completed',
  uploadId: 'e2e-name-2',
  filename: 'holiday-archive.zip'
}

const TYPED_TEXT = 'both files are still attached'

// The Pill's own drawing (Figma 347:6617), as computed values. ⭐ THE TWO COLOURS ARE THE TRANSPOSITION
// DETECTOR: the Figma export bakes #cfe4ff under the name `primary-container` and #134a74 under
// `on-primary-container`, which is the pair swapped against tokens.css — the light scheme, the trap #1262
// and #969 each hit. A rule that named the transposed pair computes to exactly these two values REVERSED,
// so this is the assertion that catches it, and nothing in the static tier can.
const PILL_GROUND = 'rgb(19, 74, 116)' /* --color-primary-container #134a74 */
const PILL_INK = 'rgb(207, 228, 255)' /* --color-on-primary-container #cfe4ff */
// body-small REGULAR — the one type value that differs from `.composer__attachment-ext` beside it, which
// wears the emphasized 500.
const PILL_WEIGHT = '400'
const PILL_HEIGHT = 24 // 4 + 16 + 4, the padding and the body-small line

// Sub-pixel tolerance, the sibling specs' EPSILON.
const EPSILON_PX = 1.5

test('a tile’s pill names its file on hover and on focus, one row up and moving nothing', async ({
  launchPairedApp
}) => {
  // Every inbound envelope the daemon decrypts, in arrival order — `composer-attachment-remove.spec.ts`'s
  // capture, reused for this ticket's own absence claim. `send_message` is answered with NO frames (the
  // optimistic echo renders on its own); everything else gets the shared one-row seed.
  const inbound: string[] = []
  const { page, app } = await launchPairedApp({
    buildReplyFrames: (plaintext: Uint8Array): Uint8Array[] => {
      const envelope = decodeEnvelope(plaintext)
      inbound.push(envelope.type)
      return envelope.type === 'send_message' ? [] : [seedConversationsFrame()]
    }
  })

  const strip = page.locator('.composer__attachments')
  const tiles = page.locator('.composer__attachment')
  const pills = page.locator('.composer__attachment-name')
  const controls = page.locator('.composer__attachment-remove')
  const composer = page.locator('.composer')
  const messageBox = page.locator('.composer__row')
  const pane = page.locator('.paired-shell__pane')

  await expect(tiles).toHaveCount(0)
  await expect(pills).toHaveCount(0)

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

  // --- Resting: both pills are MOUNTED and both are hidden. A count and a hidden-ness, not one or the
  // other: the count proves the element exists to be shown (an absent pill would satisfy `toBeHidden`
  // vacuously), and the hidden-ness is what the two triggers below have to change. ---
  await expect(pills).toHaveCount(2)
  await expect(pills.nth(0)).toBeHidden()
  await expect(pills.nth(1)).toBeHidden()

  // The strip's own geometry with no pill showing — the numbers AC3's second half compares against. Read
  // now, while nothing is hovered, so they are the resting values by construction.
  const stripHeightResting = (await strip.boundingBox())!.height
  const messageBoxYResting = (await messageBox.boundingBox())!.y

  // AC3's first half is also a security claim: a hover that reached the host would make a pointer movement
  // observable to an on-path relay as a timed frame. Baseline read BEFORE the first hover.
  const envelopesBeforeHover = inbound.length
  expect(envelopesBeforeHover).toBeGreaterThan(0) // the launch drive itself sent frames

  // --- AC1, the hover: the FIRST tile's pill shows and names the FIRST file. The positive read comes
  // first, and the sibling's continued absence beside it is what makes "that tile's pill" a claim rather
  // than "a pill somewhere". ---
  await tiles.nth(0).hover()
  await expect(pills.nth(0)).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(pills.nth(0)).toHaveText(FIRST.filename)
  await expect(pills.nth(1)).toBeHidden()

  // --- AC1's drawing, as computed values. The two colours are the transposition detector above; the
  // weight separates the pill from the emphasized extension label beside it; the ellipsis chain is the
  // bound an unbounded untrusted name needs, and `nowrap` is what makes it one line. ---
  const drawn = await pills.nth(0).evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      background: style.backgroundColor,
      color: style.color,
      fontWeight: style.fontWeight,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      radius: style.borderTopLeftRadius,
      paddingBlock: style.paddingTop,
      paddingInline: style.paddingLeft,
      whiteSpace: style.whiteSpace,
      textOverflow: style.textOverflow,
      overflow: style.overflowX,
      position: style.position,
      // The :focus-within case leaves the pointer free to roam while the pill sits over the status row, so
      // it must never take a hit test aimed at something there.
      pointerEvents: style.pointerEvents
    }
  })
  expect(drawn).toEqual({
    background: PILL_GROUND,
    color: PILL_INK,
    fontWeight: PILL_WEIGHT,
    fontSize: '12px',
    lineHeight: '16px',
    letterSpacing: '0.4px',
    radius: '6px',
    paddingBlock: '4px',
    paddingInline: '8px',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    position: 'absolute',
    pointerEvents: 'none'
  })

  // --- AC3: the box lands one row up, left-aligned to its tile, inside every ancestor. ---
  const pillBox = (await pills.nth(0).boundingBox())!
  const tileBox = (await tiles.nth(0).boundingBox())!
  const composerBox = (await composer.boundingBox())!
  const paneBox = (await pane.boundingBox())!

  expect(pillBox.height).toBeCloseTo(PILL_HEIGHT, 0)
  // Left-aligned to the tile, and entirely ABOVE it — `toBeCloseTo` rather than a rounded `toBe(0)`, which
  // is #868's `-0` trap avoided by never producing the rounded delta in the first place.
  expect(pillBox.x - tileBox.x).toBeCloseTo(0, 0)
  expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(tileBox.y + EPSILON_PX)
  // ⭐ THE ARITHMETIC, MEASURED. `bottom: calc(100% + --space-2)` puts the pill's bottom edge 8px above the
  // slot's top, and the slot's top IS .composer's content top (this column's padding-top is --space-2), so
  // the pill's bottom edge falls on .composer's border-box top and its 24px sits over .composer-status —
  // which paints nothing and clips nothing. Both lines redden if the offset changes.
  expect(pillBox.y + pillBox.height).toBeCloseTo(composerBox.y, 0)
  expect(pillBox.y).toBeLessThan(composerBox.y)
  // Inside the ONE clipping ancestor above the strip. `.composer`, `.composer__attachments`,
  // `.composer__attachment-slot` and `.conversation` each declare no overflow; `.paired-shell__pane` is
  // `overflow: hidden`, so containment here is the whole of "no ancestor clips it" that geometry can state.
  expect(pillBox.x).toBeGreaterThanOrEqual(paneBox.x - EPSILON_PX)
  expect(pillBox.y).toBeGreaterThanOrEqual(paneBox.y - EPSILON_PX)
  expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(paneBox.x + paneBox.width + EPSILON_PX)

  // --- AC3's second half: a showing pill moves nothing. Read WHILE the pill above is up, against the
  // resting numbers captured before any hover. ---
  expect((await strip.boundingBox())!.height).toBeCloseTo(stripHeightResting, 1)
  expect((await messageBox.boundingBox())!.y).toBeCloseTo(messageBoxYResting, 1)

  // --- AC2 on the LIVE DOM, after every effect has run and with the shipped stylesheet applied: each name
  // is TEXT, the hostile shape it could have taken is absent, and no attribute of any element in the strip
  // carries a fragment of either name. The static tier asserts this on the render; this is the same claim
  // against what the window actually holds. ---
  const stripMarkup = await page.evaluate(
    () => document.querySelector('.composer__attachments')?.outerHTML ?? ''
  )
  expect(stripMarkup).toContain(`>${FIRST.filename}<`)
  expect(stripMarkup).toContain(`>${SECOND.filename}<`)
  expect(stripMarkup).not.toContain('title=')
  const stripAttributes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.composer__attachments, .composer__attachments *')).flatMap(
      (element) => Array.from(element.attributes).map((attribute) => attribute.value)
    )
  )
  expect(stripAttributes.filter((value) => /quarterly|holiday|e2e-name/.test(value))).toEqual([])

  // --- AC1's other half of the hover: leaving hides it. Ordered after the positive read above, so the
  // hidden-ness measures the pointer leaving rather than a pill that was never up. ---
  await page.mouse.move(0, 0)
  await expect(pills.nth(0)).toBeHidden({ timeout: TIMEOUT_MS })

  // --- AC1, the focus: the SECOND tile's control shows the SECOND tile's pill, with the pointer parked
  // off the strip — so this can only be `:focus-within` firing, never a stray hover. Blurring hides it. ---
  await controls.nth(1).focus()
  await expect(pills.nth(1)).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(pills.nth(1)).toHaveText(SECOND.filename)
  await expect(pills.nth(0)).toBeHidden()
  await controls.nth(1).evaluate((element: HTMLElement) => element.blur())
  await expect(pills.nth(1)).toBeHidden({ timeout: TIMEOUT_MS })

  // --- AC3's security half: nothing reached the host across the whole hover-and-focus sequence. Held over
  // a real interval rather than read once, so a frame sent late would still fail it. ---
  await page.waitForTimeout(250)
  expect(inbound.length).toBe(envelopesBeforeHover)

  // --- The MUTATION CHECK for that absence: the count was capable of moving all along, so "unchanged"
  // measured the client rather than a capture that was never wired up. Both files ride the send, since
  // nothing in this drive removed either. ---
  await page.getByPlaceholder('Message…').fill(TYPED_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(strip).toHaveCount(0, { timeout: TIMEOUT_MS })
  await expect
    .poll(() => inbound.filter((type) => type === 'send_message').length, { timeout: TIMEOUT_MS })
    .toBe(1)
  expect(inbound.length).toBeGreaterThan(envelopesBeforeHover)
})
