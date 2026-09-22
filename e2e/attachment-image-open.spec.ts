import { createHash } from 'node:crypto'
import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { pushConfirmingDelivery } from './fixtures/confirmedPush'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentUploadEvent } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentChunkPayload, RequestAttachmentPayload } from '../src/shared/wire/types'

// #869 — the drawn thumbnail is the control that opens the picture in the OS viewer. This tier owns the
// ACTIVATION half of AC1, all of AC2's hand-off, AC3's geometry and affordance, and the whole of AC4,
// because every one of them is a click, a key, a box or a call into the main process. `vitest.config.ts`
// sets `environment: 'node'`, so the renderer tier is a `renderToStaticMarkup` string with no DOM and no
// handlers: BubbleAttachmentImage.test.tsx can prove WHICH state renders a <button> and nothing about
// what pressing it does.
//
// ⭐ THE OS HAND-OFF IS RECORDED, NOT SUPPRESSED, AND NOT LEFT LIVE. An unstubbed run would open an image
// viewer on whoever executes the suite — the trap each sibling answered differently:
// `attachment-file-row.spec.ts` deliberately never completes its fetch, because #816's next step was a
// Finder window; `attachment-image-thumbnail.spec.ts` drives the fetch to completion precisely because
// #1045 had no hand-off at all. This slice HAS one, so the answer is
// `e2e/assistant-link-opens-externally.spec.ts`'s: `app.evaluate` plus `Object.defineProperty` replaces
// the `shell` method with a recorder in the MAIN process. It works for the same reason it works there —
// the composition root reads `shell.openPath` at call time, so there is no production seam to add — and
// because it records, what is asserted is the path the app actually handed over.
//
// ⭐ THE FETCH IS DRIVEN TO COMPLETION, and that is what makes ONE ask sufficient. A thumbnail only
// reaches `ready` after the retrieval leg wrote the app-private attachment directory that
// `src/main/attachmentOpen.ts` reads, so by the time there is a picture to press, the file the open
// resolves to is present. No fetch-then-act sequencing is under test here because none is built.
//
// ⭐ CANONICAL ATTACHMENT IDS — hex digits and hyphen only, `attachment-image-thumbnail.spec.ts`'s
// recorded constraint. `resolveAttachmentPath`'s canonical-id pattern gates the store write AND the read
// back, so `attachment-file-row.spec.ts`'s `e2e-download-1` shape would be refused, the picture would
// never draw, and there would be nothing to press.
//
// NO `bubbleTextExactly`: that helper is an anchored WHOLE-bubble matcher and these bubbles carry
// text-bearing children. Every read below is a scoped locator, a geometry read, a computed style or the
// main-process recorder. The two sweeps this ticket owes were run across `e2e/` with no tier filter —
// `toHaveText|toContainText` (151 sites) and `textContent|allTextContents|innerText` (31) — and none can
// shift: a <button> wrapping the existing <img> adds no text-bearing element to any bubble.
//
// SECRET HYGIENE, the siblings' rule carried verbatim: every literal is an invented non-secret name or an
// invented image. The one path asserted on is the app's OWN derived path under the throwaway
// `--user-data-dir` — the identifier plus a suffix chosen from a set this app writes down — and carries
// no daemon text and no secret.

const ROW_TIMEOUT_MS = 15_000

// The activation crosses from the renderer into the main process and the assertion reads the far side.
const OPEN_TIMEOUT_MS = 10_000

// Sub-pixel tolerance: the browser lays out in fractional pixels.
const EPSILON_PX = 1.5

// The drawn height (Figma `Slot` I132:4567;132:4465) and the rhythm (--space-3) either side of it.
const THUMBNAIL_HEIGHT_PX = 160
const RHYTHM_PX = 12

const ID_PICTURE = '7a8b9c0d-1e2f-4a3b-8c9d-7e8f9a0b1c2d'
const ID_DOCUMENT = '8a9b0c1d-2e3f-4a4b-8c9d-8e9f0a1b2c3d'
const ID_LIAR = '9a0b1c2d-3e4f-4a5b-8c9d-9e0f1a2b3c4d'

// A 200x400 solid-colour PNG, generated for this spec and carrying no information at all. PORTRAIT ON
// PURPOSE: at 160 tall it draws 80 wide, so the button's box comes from a width the picture's own
// `max-height` produced rather than from its 200px intrinsic width — the exact case where a control that
// failed to shrink-wrap would ring 120px of empty bubble. A few hundred bytes, so it rides one chunk.
const PORTRAIT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAAGQCAIAAABkkLjnAAACz0lEQVR42u3SQQkAAAgEwYtiLtMZ1RKCn4FJsGyqB85FAoyFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsbCWGAsjIWxwFgYC2NhLBUwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsbCWGAsjIWxwFgYC2OBsTAWxsJYKmAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBbGkgBjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2NhLBUwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbH4sADgZVQK/cnv+wAAAABJRU5ErkJggg=='

const PORTRAIT_NATURAL = { width: 200, height: 400 }

// A name that LIES: the extension admits it for drawing, the ASCII bytes decode in no browser, so the
// <img> raises `error` and the fallback replaces it. AC1's negative half — the state that draws no
// control — needs a bubble that reached `failed`, and this is the only way a spec can reach one.
const LIAR_BYTES = Buffer.from('this is not an image, whatever the name says', 'ascii')

interface ServedAttachment {
  bytes: Buffer
  filename: string
}

const SERVED = new Map<string, ServedAttachment>([
  [ID_PICTURE, { bytes: Buffer.from(PORTRAIT_PNG_BASE64, 'base64'), filename: 'portrait.png' }],
  [ID_LIAR, { bytes: LIAR_BYTES, filename: 'pretend-picture.png' }]
])

/**
 * The daemon's answer to one `request_attachment`: a single `attachment_chunk` carrying the whole file.
 *
 * ⭐ THE DIGEST IS COMPUTED, NEVER WRITTEN BY HAND — `attachmentReassembler` verifies the assembled bytes
 * against an exact lowercase-hex SHA-256, so a hand-written one fails closed as `verification-failed` and
 * the picture silently becomes the fallback. Correlation rides `Envelope.in_reply_to`; the payload
 * `attachment_id` is re-checked one layer down by the reassembler.
 */
function serveAttachmentFrame(requestId: number, ask: RequestAttachmentPayload): Uint8Array[] {
  const served = SERVED.get(ask.attachment_id)
  if (served === undefined) return []
  const payload: AttachmentChunkPayload = {
    attachment_id: ask.attachment_id,
    index: 0,
    total_chunks: 1,
    filename: served.filename,
    // Read by nothing in the flow under test: the type the OS is told is decided in the background
    // process from the file's own leading bytes, never from a declared one.
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
  // A send is answered with nothing: the user echo is renderer-sourced, so the bubble under test appears
  // without a daemon frame, and no assistant bubble lands in the way of the scoped locators below.
  return envelope.type === 'send_message' ? [] : [seedConversationsFrame()]
}

const upload = (uploadId: string, filename: string): AttachmentUploadEvent => ({
  type: 'completed',
  uploadId,
  filename
})

// The main-process global the recorder writes into — a property on globalThis rather than a closure
// variable, because each `app.evaluate` call runs its own function in that process and shares nothing.
const RECORDER_KEY = '__pyryOpenedPaths'

// The derived directory's name (ATTACHMENT_OPEN_DIR_NAME), restated rather than imported: importing from
// `src/main/attachmentOpen` would pull `node:fs/promises` and the signature module into the spec for one
// string, and a rename that this literal missed is exactly what the assertion should catch.
const OPEN_DIR_NAME = 'attachment-views'

test('the drawn thumbnail opens its picture in the OS viewer, by click and by keyboard (#869)', async ({
  launchPairedApp
}) => {
  const { page, app } = await launchPairedApp({ buildReplyFrames })

  // #1569 — a push that raised the transient context loss is sent again only if its pending tile has
  // not shown. Never blindly: `reducePendingAttachments` appends every `completed` with no dedup by id,
  // so a replayed one would carry the attachment twice. `tilesAfter` is the strip's count after this
  // push — the nth push since the last send leaves n tiles — stated absolutely, so a previous push's
  // late tile cannot pass for this one's.
  const pendingTiles = page.locator('.composer__attachment-slot')
  const pushCompleted = (event: AttachmentUploadEvent, tilesAfter: number): Promise<void> =>
    pushConfirmingDelivery(
      () =>
        app.evaluate(
          ({ BrowserWindow }, payload) => {
            const [window] = BrowserWindow.getAllWindows()
            window.webContents.send(payload.channel, payload.event)
          },
          { channel: ATTACHMENT_UPLOAD_EVENT_CHANNEL, event }
        ),
      async () => (await pendingTiles.count()) >= tilesAfter
    )

  const send = async (text: string): Promise<void> => {
    await page.getByPlaceholder('Message…').fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
  }

  const bubble = (index: number) => page.locator('.bubble[data-thread-role="user"]').nth(index)

  /** Every path the app has handed to `shell.openPath` so far, read out of the main process. */
  const handedOver = (): Promise<string[]> =>
    app.evaluate(
      (_electron, key) => (globalThis as unknown as Record<string, string[]>)[key] ?? [],
      RECORDER_KEY
    )

  /** The focused element as `tag.class`, so a walk over the tab order is legible in a failure message.
   *  `getAttribute('class')` rather than `.className`, which is an SVGAnimatedString on an svg. */
  const focused = (): Promise<string> =>
    page.evaluate(() => {
      const element = document.activeElement
      if (element === null) return 'none'
      return `${element.tagName.toLowerCase()}.${element.getAttribute('class') ?? ''}`
    })

  // --- 1. A message carrying a real picture AND a document, so the bubble holds both controls: the one
  // this ticket adds and the file row whose focus treatment AC3 says it must match. ---
  await pushCompleted(upload(ID_PICTURE, 'portrait.png'), 1)
  await pushCompleted(upload(ID_DOCUMENT, 'quarterly-report.pdf'), 2)
  await send('a picture and a document')

  const first = bubble(0)
  const control = first.locator('button.bubble__image-button')
  const picture = control.locator('img.bubble__image')
  await expect(control).toHaveCount(1, { timeout: ROW_TIMEOUT_MS })

  // The bytes really arrived and really decoded: `naturalWidth` is 0 for a source that never loaded, so
  // this is the positive control for everything below — a control pressed over an undrawn picture would
  // otherwise look the same as a working one.
  await expect
    .poll(
      () => picture.evaluate((element) => (element as HTMLImageElement).naturalWidth),
      { timeout: ROW_TIMEOUT_MS }
    )
    .toBe(PORTRAIT_NATURAL.width)

  // --- 2. AC1's structure in the live DOM: one real <button>, named by the client-owned constant, with
  // the untrusted filename in no attribute of it or anything inside it. ---
  await expect(control).toHaveAttribute('type', 'button')
  await expect(control).toHaveAccessibleName('Attached image')
  const attributeValues = await control.evaluate((element) =>
    [element, ...element.querySelectorAll('*')].flatMap((node) =>
      [...node.attributes].map((attribute) => attribute.value)
    )
  )
  for (const value of attributeValues) expect(value).not.toContain('portrait')

  // --- 3. AC3's geometry half. The control's box IS the picture's box on both axes — the detector for
  // `.bubble__file`'s `width: 100%` being carried over, which would ring a bubble-width band around a
  // 160px-tall picture. The portrait draws 80 wide from its own `max-height`, so a control that failed to
  // shrink-wrap a replaced child would be caught here rather than at some other window size. ---
  const controlBox = (await control.boundingBox())!
  const pictureBox = (await picture.boundingBox())!
  expect(controlBox.width).toBeCloseTo(pictureBox.width, 0)
  expect(controlBox.height).toBeCloseTo(pictureBox.height, 0)
  expect(controlBox.x).toBeCloseTo(pictureBox.x, 0)
  expect(controlBox.y).toBeCloseTo(pictureBox.y, 0)
  expect(pictureBox.height).toBeCloseTo(THUMBNAIL_HEIGHT_PX, 0)
  // ...and it is a picture-sized box rather than a bubble-sized one, stated against the bubble's own
  // measured content width rather than against a constant.
  const contentWidth = await first.evaluate((element) => {
    const computed = getComputedStyle(element)
    return (
      element.getBoundingClientRect().width -
      parseFloat(computed.paddingLeft) -
      parseFloat(computed.paddingRight)
    )
  })
  expect(controlBox.width).toBeLessThan(contentWidth / 2)

  // The 12px rhythm either side survived the margin moving from the picture onto the control: the file
  // row sits --space-3 below the control's box, and the meta row --space-3 below that. A margin left
  // INSIDE the button would show up here as a picture whose box no longer starts where the control's
  // does, which assertion 3 above already covers, and as a doubled gap, which this one does.
  const rowBox = (await first.locator('.bubble__file').boundingBox())!
  const metaBox = (await first.locator('.bubble__meta').boundingBox())!
  expect(rowBox.y - (controlBox.y + controlBox.height)).toBeCloseTo(RHYTHM_PX, 0)
  expect(metaBox.y - (rowBox.y + rowBox.height)).toBeCloseTo(RHYTHM_PX, 0)

  // --- 4. ⭐ The recorder, installed BEFORE the first activation. `defineProperty` rather than an
  // assignment, so it succeeds against a data property and an accessor alike; the empty string is
  // `shell.openPath`'s own success value, so the app's `opened` path is the one exercised. ---
  await app.evaluate(({ shell }, key) => {
    const recorded: string[] = []
    ;(globalThis as unknown as Record<string, string[]>)[key] = recorded
    Object.defineProperty(shell, 'openPath', {
      value: (path: string) => {
        recorded.push(path)
        return Promise.resolve('')
      },
      configurable: true,
      writable: true
    })
  }, RECORDER_KEY)

  // --- 5. AC2 and AC4, by CLICK: exactly one hand-off, of THAT attachment's derived copy. ---
  await control.click()
  await expect.poll(handedOver, { timeout: OPEN_TIMEOUT_MS }).toHaveLength(1)
  const [openedPath] = await handedOver()
  // The identifier plus a suffix chosen from the closed signature set, inside the app-owned derived
  // directory. Asserting the WHOLE tail is what makes "that attachment's derived copy" a real claim: a
  // control wired to the wrong record would hand over a different identifier and pass a weaker check.
  expect(openedPath.endsWith(`/${OPEN_DIR_NAME}/${ID_PICTURE}.png`)).toBe(true)
  // Nothing daemon-supplied reached the path: the untrusted filename takes no part in it.
  expect(openedPath).not.toContain('portrait')

  // --- 6. ⭐ AC1's keyboard half and AC3's affordance half, from one walk. Shift+Tab from the composer
  // walks BACKWARDS through the thread, which is what proves the picture is a real tab stop rather than
  // something only a mouse can reach — and it is keyboard-driven focus, which is the only kind
  // `:focus-visible` matches, so the ring can be read while it is actually showing. ---
  await page.getByPlaceholder('Message…').click()
  const stops: string[] = []
  for (let press = 0; press < 12 && !stops.some((stop) => stop.includes('bubble__image-button')); press++) {
    await page.keyboard.press('Shift+Tab')
    stops.push(await focused())
  }
  expect(stops.filter((stop) => stop.includes('bubble__image-button'))).toHaveLength(1)
  // ONE tab stop, not two: the picture inside the control never takes focus of its own. An <img> given a
  // tabindex would appear here as a second stop on the same picture.
  expect(stops.filter((stop) => stop.startsWith('img.'))).toHaveLength(0)

  const ring = await control.evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      visible: element.matches(':focus-visible'),
      style: computed.outlineStyle,
      width: computed.outlineWidth,
      color: computed.outlineColor
    }
  })
  expect(ring.visible).toBe(true)
  expect(ring.style).toBe('solid')
  expect(ring.width).toBe('1px')

  // --- 7. AC1's activation half: Enter and Space both work, and each records exactly ONE hand-off.
  // Neither is handled in this app's code — both come from the platform <button>, which is the whole
  // reason no keydown handler was written. ---
  await page.keyboard.press('Enter')
  await expect.poll(handedOver, { timeout: OPEN_TIMEOUT_MS }).toHaveLength(2)
  await page.keyboard.press('Space')
  await expect.poll(handedOver, { timeout: OPEN_TIMEOUT_MS }).toHaveLength(3)
  // Every activation handed over the same derived copy, and no activation handed over anything else.
  expect(await handedOver()).toEqual([openedPath, openedPath, openedPath])

  // --- 8. AC3's "the affordance the file row already uses", asserted as an identity rather than as a
  // restated declaration: Tab forward from the picture lands on the file row in the same bubble — which
  // is also this spec's second reading of "one tab stop", since the next stop is a different control
  // rather than something else inside the picture — and its focused ring is compared triple for triple.
  // The row is FOCUSED AND NEVER ACTIVATED: pressing it would drive a save, which is a native dialog no
  // locator can dismiss (`attachment-file-row.spec.ts`'s recorded reason for never completing a fetch).
  const fileRow = first.locator('button.bubble__file')
  await page.keyboard.press('Tab')
  expect(await focused()).toContain('bubble__file')
  const rowRing = await fileRow.evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      visible: element.matches(':focus-visible'),
      style: computed.outlineStyle,
      width: computed.outlineWidth,
      color: computed.outlineColor
    }
  })
  expect(rowRing).toEqual(ring)
  // Nothing was handed over by moving focus around.
  expect(await handedOver()).toHaveLength(3)

  // --- 9. AC1's last clause, live: a thumbnail that FAILED draws its textual fallback and no control at
  // all. What a reader wants there is a re-fetch — a different leg — so the state gains no tab stop. The
  // in-flight state draws nothing whatsoever, which BubbleAttachmentImage.test.tsx owns as an empty
  // render, so there is nothing here for it to be. ---
  await pushCompleted(upload(ID_LIAR, 'pretend-picture.png'), 1)
  await send('this one lies')

  const second = bubble(1)
  await expect(second.locator('.bubble__image-fallback')).toHaveCount(1, { timeout: ROW_TIMEOUT_MS })
  await expect(second.locator('button.bubble__image-button')).toHaveCount(0)
  await expect(second.locator('img.bubble__image')).toHaveCount(0)

  // The first picture is untouched by the second message, and still exactly one control app-wide.
  await expect(page.locator('button.bubble__image-button')).toHaveCount(1)
  expect(await handedOver()).toHaveLength(3)
})
