import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope } from '../src/main/transport/codec'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentUploadEvent } from '../src/shared/ipc/attachmentUpload'
import type { RequestAttachmentPayload } from '../src/shared/wire/types'

// Fake-stack UI e2e for #815's file row in the message bubble — the LAYOUT half of the ticket, which is the
// half the static tier cannot reach at all. `vitest.config.ts` sets `environment: 'node'`, so every renderer
// spec is a `renderToStaticMarkup` string assertion with no DOM and no stylesheet: it can prove which items
// draw a row, where the row sits among the bubble's children and what the glyph is as an element
// (ConversationScreen.test.tsx), and it can prove the extension label's characters
// (attachmentExtensionLabel.test.ts). It cannot tell a wrapped name from a truncated one, an overflowing
// one, or one that pushed the icon out of the bubble — those are boxes, and only a real window has them.
//
// ⭐ AC5 IS WHY THIS SPEC EXISTS. Its failure mode is a flex item's AUTOMATIC MINIMUM SIZE, which holds an
// item at its longest unbreakable word: without `min-width: 0` the name would shove the 45px icon out of
// the bubble, and without `overflow-wrap: anywhere` a `min-width: 0` item spills its text instead of
// wrapping. The ticket is explicit that `.bubble`'s inherited `word-break: break-word` should NOT be assumed
// to cover this — it is a different mechanism — so the proof is measured here rather than reasoned about.
//
// THE STANDING RULE IS KEPT — a fake-tier spec may not supply an input production does not produce. The two
// events pushed below are members of `AttachmentUploadEvent` in the shape `src/main/attachmentUpload` builds
// them, sent on the channel that module emits on; the only thing standing in for production is the SENDER,
// because the alternative is a native file dialog no Playwright locator can dismiss. That seam is
// `composer-attach.spec.ts`'s, established for exactly this reason.
//
// ⭐ IT MUST NOT USE `bubbleTextExactly`. That helper is an ANCHORED WHOLE-BUBBLE matcher
// (`'^' + escaped + '\s*' + BUBBLE_META_TIME + '$'`) and this is the first bubble in the suite with a
// text-bearing child beside the message text. No existing spec seeds an attachment, so this ticket reddens
// none of its six current callers — the hazard runs only toward new specs, and this is one. Every assertion
// below reads a scoped locator inside the bubble instead.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, counts,
// computed style and geometry. Both filenames are INVENTED non-secret literals, which also matters because
// a Playwright failure prints the surrounding DOM — a later edit must not substitute a real name.

const ROW_TIMEOUT_MS = 15_000

// Sub-pixel tolerance for the geometry reads: the browser lays out in fractional pixels and the values
// asserted are integer design constants.
const EPSILON_PX = 1.5

// The drawn geometry, off Figma `File field` 132:4605 inside the bubble at 121:3860.
const ICON_WIDTH_PX = 45
const ICON_HEIGHT_PX = 60
// The extension slot is 44 of the icon's 45, left-aligned (Figma 132:4601 at x=0, width 44).
const EXT_SLOT_WIDTH_PX = 44
// --space-3, the rhythm the row keeps with the text above it and the meta row below.
const RHYTHM_PX = 12
// The row's top inside the bubble: --space-4 of padding + one 20px title-small line of message text +
// --space-3. The drawing's own number for the same three parts — it puts the text at 16→36 and the row at
// 48→108 — which is why this is the criterion rather than an over-specification of it.
const ROW_TOP_IN_BUBBLE_PX = 48
// --text-body-small-line. One line of the name is this tall, so a wrapped name is taller.
const NAME_LINE_PX = 16

// A settled upload exactly as `src/main/attachmentUpload` emits it. `filename` is #1038's field, carrying
// the operator's own display name — an invented literal here.
const FIRST_UPLOAD: AttachmentUploadEvent = {
  type: 'completed',
  uploadId: 'e2e-upload-1',
  filename: 'quarterly-report.pdf'
}

// AC5's pathological input: long, and with NO SPACE anywhere, so the only way it can fit is for the browser
// to break inside the word. A name with spaces would wrap on its own and prove nothing about either
// declaration under test. The `.pdf` tail is kept so the extension overlay still has something to draw and
// the row under test is the same row.
const LONG_NAME = `${'attachment-with-an-absurdly-long-unbroken-name'.repeat(4)}.pdf`
const SECOND_UPLOAD: AttachmentUploadEvent = {
  type: 'completed',
  uploadId: 'e2e-upload-2',
  filename: LONG_NAME
}

const FIRST_MESSAGE = 'here is the report'
const SECOND_MESSAGE = 'and the long one'

// The daemon answers a send with NOTHING. The user echo is a renderer-sourced timeline item written by
// `composerSend` before any reply, so no daemon frame is needed to make the bubble under test appear — and
// leaving the send unanswered keeps an assistant bubble out of the way of the scoped locators below. Every
// other inbound (the auto-fired `list_conversations`) gets the shared one-row seed, since a scripted
// buildReplyFrames overrides the fixture's default arm.
const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  return envelope.type === 'send_message' ? [] : [seedConversationsFrame()]
}

test('the attachment file row draws in the bubble, and a long name wraps beside the icon (#815)', async ({
  launchPairedApp
}) => {
  const { page, app } = await launchPairedApp({ buildReplyFrames })

  // `webContents.send` is exactly what `src/main/attachmentUpload`'s `emit` does, so the renderer cannot
  // tell this from a real terminal. Nothing is captured from this module's scope — `app.evaluate`
  // serialises its callback, so the channel and the event are passed as its argument.
  const pushCompleted = (event: AttachmentUploadEvent): Promise<void> =>
    app.evaluate(
      ({ BrowserWindow }, payload) => {
        const [window] = BrowserWindow.getAllWindows()
        window.webContents.send(payload.channel, payload.event)
      },
      { channel: ATTACHMENT_UPLOAD_EVENT_CHANNEL, event }
    )

  const send = async (text: string): Promise<void> => {
    await page.getByPlaceholder('Message…').fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
  }

  // --- One completed upload, then a send. The composer's pending set is TAKEN by the send, so the file
  // lands on the item this message produces and on no later one. ---
  await pushCompleted(FIRST_UPLOAD)
  await send(FIRST_MESSAGE)

  const firstBubble = page.locator('.bubble[data-thread-role="user"]').first()
  const firstRow = firstBubble.locator('.bubble__file')
  await expect(firstRow).toHaveCount(1, { timeout: ROW_TIMEOUT_MS })
  await expect(firstRow.locator('.bubble__file-name')).toHaveText(FIRST_UPLOAD.filename)
  await expect(firstRow.locator('.bubble__file-ext')).toHaveText('PDF')

  // --- AC1 as measured geometry: the row is --space-3 clear of the text above and of the meta row below,
  // and it sits BETWEEN them rather than at either end. The static tier already pins the DOM order; what
  // only a browser can show is that the margin actually resolves to 12px through .bubble's padding box
  // (a margin here neither collapses through it nor escapes it — the reason .bubble__meta uses one too). ---
  const bubbleBox = (await firstBubble.boundingBox())!
  const rowBox = (await firstRow.boundingBox())!
  const metaBox = (await firstBubble.locator('.bubble__meta').boundingBox())!

  expect(rowBox.y - bubbleBox.y).toBeCloseTo(ROW_TOP_IN_BUBBLE_PX, 0)
  expect(metaBox.y - (rowBox.y + rowBox.height)).toBeCloseTo(RHYTHM_PX, 0)
  expect(rowBox.height).toBeCloseTo(ICON_HEIGHT_PX, 0)

  // --- AC1's within-the-row half and AC3's overlay: the icon first at its drawn size, the name to its
  // right one --space-3 away, both vertically centred, and the extension across the icon's LOWER half. ---
  const firstIcon = firstRow.locator('.bubble__file-icon')
  const firstName = firstRow.locator('.bubble__file-name')
  const iconBox = (await firstIcon.boundingBox())!
  const nameBox = (await firstName.boundingBox())!
  const extBox = (await firstRow.locator('.bubble__file-ext').boundingBox())!

  expect(iconBox.width).toBeCloseTo(ICON_WIDTH_PX, 0)
  expect(iconBox.height).toBeCloseTo(ICON_HEIGHT_PX, 0)
  expect(nameBox.x - (iconBox.x + iconBox.width)).toBeCloseTo(RHYTHM_PX, 0)
  // Vertically centred against each other, which for a one-line name means their centres coincide.
  expect(nameBox.y + nameBox.height / 2).toBeCloseTo(iconBox.y + iconBox.height / 2, 0)
  // The overlay starts at or below the icon's midpoint — "top-aligned in the lower half" — and is centred
  // across the drawn 44px slot. Its centre is the SLOT's, at the icon's left edge + 22, which Figma states
  // directly as `left: 22px` with a -50% translate; that is a half-pixel left of the 45px frame's own
  // centre, and asserting the frame's centre instead fails by exactly that 0.5px.
  expect(extBox.y).toBeGreaterThanOrEqual(iconBox.y + iconBox.height / 2 - EPSILON_PX)
  expect(extBox.y + extBox.height).toBeLessThanOrEqual(iconBox.y + iconBox.height + EPSILON_PX)
  expect(extBox.width).toBeCloseTo(EXT_SLOT_WIDTH_PX, 0)
  expect(extBox.x + extBox.width / 2).toBeCloseTo(iconBox.x + EXT_SLOT_WIDTH_PX / 2, 0)

  // --- A second completed upload and a second send. The first message's row is unaffected and the second
  // message carries only the second file: the take is destructive, so a regression that accumulated instead
  // of clearing would put two rows in this bubble. ---
  await pushCompleted(SECOND_UPLOAD)
  await send(SECOND_MESSAGE)

  const secondBubble = page.locator('.bubble[data-thread-role="user"]').nth(1)
  const secondRow = secondBubble.locator('.bubble__file')
  await expect(secondRow).toHaveCount(1, { timeout: ROW_TIMEOUT_MS })
  await expect(firstRow).toHaveCount(1)

  // --- ⭐ AC5. Five reads, each ruling out one of the five failure modes the criterion names by name. ---
  const longIcon = secondRow.locator('.bubble__file-icon')
  const longName = secondRow.locator('.bubble__file-name')
  const secondBubbleBox = (await secondBubble.boundingBox())!
  const longIconBox = (await longIcon.boundingBox())!
  const longNameBox = (await longName.boundingBox())!

  // 1. NEVER squeezing the icon narrower than 45px. This is the one `flex: 0 0 auto` answers, and the one a
  //    missing `min-width: 0` would break first.
  expect(longIconBox.width).toBeCloseTo(ICON_WIDTH_PX, 0)
  expect(longIconBox.height).toBeCloseTo(ICON_HEIGHT_PX, 0)

  // 2. NEVER pushing the icon out of the bubble, and never overflowing it. Both edges of both boxes stay
  //    inside the bubble's border box.
  expect(longIconBox.x).toBeGreaterThanOrEqual(secondBubbleBox.x - EPSILON_PX)
  expect(longNameBox.x + longNameBox.width).toBeLessThanOrEqual(
    secondBubbleBox.x + secondBubbleBox.width + EPSILON_PX
  )
  // Nothing widened the document either — the whole point of a name with no space in it.
  const documentOverflows = await page.evaluate(
    () => document.body.scrollWidth > document.body.clientWidth
  )
  expect(documentOverflows).toBe(false)

  // 3. NEVER wrapped UNDER the icon — the name stays in its own column to the right, which is the half that
  //    separates "wrapped correctly" from "the flex row became a column".
  expect(longNameBox.x).toBeGreaterThan(longIconBox.x + longIconBox.width - EPSILON_PX)

  // 4. It actually WRAPPED: more than one line box. A single-line height here would mean the name was cut
  //    off, and this is the assertion that distinguishes wrapping from every form of truncation.
  expect(longNameBox.height).toBeGreaterThan(NAME_LINE_PX + EPSILON_PX)

  // 5. NEVER truncated or ellipsised — asserted three ways, because a clipped name still renders a full
  //    `textContent` and an ellipsis is invisible to a text assertion. The full string is present, no
  //    ellipsis mechanism is in effect, and nothing is clipped away.
  await expect(longName).toHaveText(LONG_NAME)
  const nameStyle = await longName.evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      textOverflow: computed.textOverflow,
      overflowX: computed.overflowX,
      whiteSpace: computed.whiteSpace,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    }
  })
  expect(nameStyle.textOverflow).toBe('clip')
  expect(nameStyle.overflowX).toBe('visible')
  expect(nameStyle.whiteSpace).toBe('normal')
  expect(nameStyle.scrollWidth).toBeLessThanOrEqual(nameStyle.clientWidth + EPSILON_PX)

  // The row still keeps its rhythm with the meta row below it now that it is two lines tall — the margin is
  // on the sibling, so a taller row must not have eaten the gap.
  const longRowBox = (await secondRow.boundingBox())!
  const secondMetaBox = (await secondBubble.locator('.bubble__meta').boundingBox())!
  expect(secondMetaBox.y - (longRowBox.y + longRowBox.height)).toBeCloseTo(RHYTHM_PX, 0)
})

// #816 — the row became a download control. This half of the coverage exists because NOTHING in `src/`
// can click: the renderer tier is `renderToStaticMarkup` under `environment: 'node'`, so the element and
// its accessible name are ConversationScreen.test.tsx's and the two-ask sequencing behind the handler is
// downloadAttachment.test.ts's, but the activation itself only exists in a real window.
//
// ⭐ THE ROUND TRIP IS DELIBERATELY NOT DRIVEN TO COMPLETION. This tier runs the real background process,
// so a fetch that actually reached `completed` would put a real file in the app's attachment directory and
// the save that follows would copy it into the REAL Downloads folder and call `shell.showItemInFolder` — a
// Finder window opening on whoever ran the suite. So `buildReplyFrames` answers `request_attachment` with
// no frames at all: the ask is observed on the wire, which is AC2, and nothing ever reaches the terminal
// AC3 sequences on. That division is the ticket's own.
//
// ⭐ THREE DISTINCT ATTACHMENTS, AND THAT IS LOAD-BEARING, not tidiness. `src/main/attachmentRetrieval.ts`
// keys its `inFlight` map by attachment id and returns early for an id already being fetched, so a second
// activation of the SAME row puts no second envelope on the wire — three activations of one row would
// assert one envelope and prove nothing about Enter or Space. Three ids stay under that module's
// ATTACHMENT_MAX_CONCURRENT_RETRIEVALS of 4, so none of the three is refused `busy` either.
//
// SECRET HYGIENE, as above: every literal here is invented non-secret display text, and every assertion
// reads DOM state, wire payload fields or geometry.

const THIRD_MESSAGE = 'and a third'

/** The three settled uploads, one per message, each with its own identifier. Typed to the `completed` arm
 *  rather than the whole union, so `filename` reads without a narrowing step at every use. */
const DOWNLOADABLE: Extract<AttachmentUploadEvent, { type: 'completed' }>[] = [
  { type: 'completed', uploadId: 'e2e-download-1', filename: 'first-report.pdf' },
  { type: 'completed', uploadId: 'e2e-download-2', filename: 'second-notes.txt' },
  { type: 'completed', uploadId: 'e2e-download-3', filename: 'third-archive.zip' }
]

test('activating the file row asks the host for that attachment, by click and by keyboard (#816)', async ({
  launchPairedApp
}) => {
  // Every `request_attachment` the window put on the wire, in order. Recorded rather than asserted inside
  // the callback so a failure prints the whole set instead of the first mismatch.
  const asked: RequestAttachmentPayload[] = []

  const { page, app } = await launchPairedApp({
    buildReplyFrames: (inbound: Uint8Array): Uint8Array[] => {
      const envelope = decodeEnvelope(inbound)
      if (envelope.type === 'request_attachment') {
        asked.push(envelope.payload as RequestAttachmentPayload)
        // No frames: the retrieval stays open, never reaches `completed`, and no save is ever asked.
        return []
      }
      return envelope.type === 'send_message' ? [] : [seedConversationsFrame()]
    }
  })

  const pushCompleted = (event: AttachmentUploadEvent): Promise<void> =>
    app.evaluate(
      ({ BrowserWindow }, payload) => {
        const [window] = BrowserWindow.getAllWindows()
        window.webContents.send(payload.channel, payload.event)
      },
      { channel: ATTACHMENT_UPLOAD_EVENT_CHANNEL, event }
    )

  const send = async (text: string): Promise<void> => {
    await page.getByPlaceholder('Message…').fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
  }

  // One upload per message, so each bubble carries exactly one row and the rows are in send order.
  for (const [index, upload] of DOWNLOADABLE.entries()) {
    await pushCompleted(upload)
    await send([FIRST_MESSAGE, SECOND_MESSAGE, THIRD_MESSAGE][index])
  }

  const rows = page.locator('.bubble[data-thread-role="user"] .bubble__file')
  await expect(rows).toHaveCount(3, { timeout: ROW_TIMEOUT_MS })

  // --- AC1's "one control, not two". The row IS the button; neither the icon nor the name is separately
  // focusable, which is what makes the pair one tab stop rather than two. ---
  const first = rows.nth(0)
  expect(await first.evaluate((element) => element.tagName)).toBe('BUTTON')
  await expect(first).toHaveJSProperty('type', 'button')
  for (const child of ['.bubble__file-icon', '.bubble__file-name']) {
    expect(
      await first.locator(child).evaluate((element) => element.hasAttribute('tabindex'))
    ).toBe(false)
  }
  // The accessible name is computed from the contents, so it is exactly the filename — the aria-hidden
  // extension overlay contributes nothing and no aria-label overrides it.
  await expect(first).toHaveAccessibleName(DOWNLOADABLE[0].filename)

  // --- AC1's "activating alike on click, Enter and Space", and AC2's ask. One activation per row, one
  // mechanism each, so a keyboard path that silently did nothing cannot hide behind the click's envelope.
  // `locator.press` focuses the element and dispatches a real key event, which is also what puts the row
  // into `:focus-visible` for the assertion below. ---
  await first.click()
  await expect.poll(() => asked.length, { timeout: ROW_TIMEOUT_MS }).toBe(1)

  await rows.nth(1).press('Enter')
  await expect.poll(() => asked.length, { timeout: ROW_TIMEOUT_MS }).toBe(2)

  await rows.nth(2).press(' ')
  await expect.poll(() => asked.length, { timeout: ROW_TIMEOUT_MS }).toBe(3)

  // AC2: the conversation and the attachment identifier AND NOTHING ELSE. An exact-object comparison per
  // envelope, so a stray `filename` key — the value sitting right there on the record — reddens here.
  expect(asked).toEqual(
    DOWNLOADABLE.map((upload) => ({
      conversation_id: SEEDED_ROW.id,
      attachment_id: upload.uploadId
    }))
  )
  // AC3's "no file name reaches a URL", proven where the name could actually have leaked: on the wire.
  for (const upload of DOWNLOADABLE) {
    expect(JSON.stringify(asked)).not.toContain(upload.filename)
  }

  // --- AC1's focus indicator. The drawing supplies no focus state, so the row takes .bubble__copy's
  // shipped `:focus-visible` outline; a keyboard-reachable control with no visible focus is the gap the
  // criterion closes. The last interaction above was a key press, which is what makes :focus-visible
  // match rather than plain :focus. ---
  const focused = rows.nth(2)
  expect(await focused.evaluate((element) => element === document.activeElement)).toBe(true)
  expect(await focused.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  expect(await focused.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')

  // --- The button reset put the drawn box back. These are the same constants the first test holds, re-read
  // on a row that is now a form control: a UA padding, border, font or text-align that survived would move
  // one of them, and #815's own record is that this row's layout defies prediction. ---
  const rowBox = (await first.boundingBox())!
  const iconBox = (await first.locator('.bubble__file-icon').boundingBox())!
  const nameBox = (await first.locator('.bubble__file-name').boundingBox())!
  const bubbleBox = (await page.locator('.bubble[data-thread-role="user"]').first().boundingBox())!
  const metaBox = (await page
    .locator('.bubble[data-thread-role="user"]')
    .first()
    .locator('.bubble__meta')
    .boundingBox())!

  expect(rowBox.height).toBeCloseTo(ICON_HEIGHT_PX, 0)
  expect(rowBox.y - bubbleBox.y).toBeCloseTo(ROW_TOP_IN_BUBBLE_PX, 0)
  expect(metaBox.y - (rowBox.y + rowBox.height)).toBeCloseTo(RHYTHM_PX, 0)
  expect(iconBox.width).toBeCloseTo(ICON_WIDTH_PX, 0)
  expect(iconBox.height).toBeCloseTo(ICON_HEIGHT_PX, 0)
  expect(nameBox.x - (iconBox.x + iconBox.width)).toBeCloseTo(RHYTHM_PX, 0)
  // The name still starts at the row's left edge rather than being centred by a button's UA text-align —
  // invisible on one line, and the failure AC5 of #815 measures on a wrapped one.
  expect(await first.evaluate((element) => getComputedStyle(element).textAlign)).toBe('left')
})
