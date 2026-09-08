import { test, expect } from './fixtures/launchPairedApp'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentUploadEvent } from '../src/shared/ipc/attachmentUpload'
import { COMPOSER_ATTACH_LABEL } from '../src/renderer/src/screens/conversation/ComposerAttach'
import { attachmentUploadOutcomeCopy } from '../src/renderer/src/screens/conversation/attachmentUploadCopy'

// Fake-stack UI e2e for the COMPOSER FOOTER's attach button (#863, extended by #864's in-flight
// progress) — the interaction proof the static tier cannot reach. vitest runs the `node` environment, so every renderer test here is a renderToStaticMarkup
// string assertion with no DOM, no effects and no click handlers: the static tier pins the button's shape,
// the copy map and the outcome's present/absent matrix (ComposerAttach.test.tsx, attachmentUploadCopy.test.ts,
// and the three mount proofs in ConversationScreen.test.tsx), and only a real window can prove that the
// click reaches the background process, that a pushed outcome renders, that the LATEST one wins, and that
// starting a new attach clears the one before it.
//
// ⭐ WHY THIS SPEC STUBS THE MAIN PROCESS BEFORE IT CLICKS, and why it is not optional. This tier launches
// the BUILT app, so its main process is the production one: a click reaches the real
// `dialog.showOpenDialog`, which opens a NATIVE OS window that no Playwright locator can see or dismiss —
// the run would hang until the suite timeout. `assistant-link-opens-externally.spec.ts` established the
// seam for exactly this reason (it stubs `shell.openExternal` the same way), and this spec uses it twice:
// once to make the click safe, and once to push an outcome on the channel with no dialog involved at all.
//
// ONE test() block, ONE launch, ONE continuous drive (paired-shell-navigation.spec.ts's shape): each launch
// pays a full handshake, the ordering is load-bearing (the no-outcome baseline must be read BEFORE anything
// is pushed), and no step mutates persistent state.
//
// THE STANDING RULE IS KEPT — a fake-tier spec may not supply an input production does not produce. Every
// event pushed below is a member of `AttachmentUploadEvent` sent on the channel `src/main/attachmentUpload`
// sends its terminals on, in the shape that module builds them; the only thing standing in for production
// is the SENDER, because the alternative is a native file dialog. The copy itself is never invented here:
// it is derived by calling the production copy module, so this spec cannot drift from it.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, roles, counts
// and geometry. Nothing serialises a token, a key or plaintext — and nothing here could: no member of
// `AttachmentUploadEvent` can hold a path or a byte, which is the property #862 built the channel around.
// The stub records only that the dialog was ASKED for, never a path, because there is none.
// SINCE #1038 the completed terminal carries the stored file's display NAME. That does not weaken the rule
// here: the name this spec pushes is an invented literal like every other, and the spec asserts the
// composer renders it nowhere. A real name is one path component — never a directory — and its only
// onward use is the save leg, which re-sanitises whatever the window hands back.

const OUTCOME_TIMEOUT_MS = 15_000

// The main-process globals the two `app.evaluate` stubs communicate through. `app.evaluate` serialises its
// callback, so nothing is captured from this module's scope — every value a stub needs is passed as its
// argument, and every value it reports comes back through a global read by a later evaluate.
const PICKER_CALLS_KEY = '__pyryAttachPickerCalls'

// The row's own horizontal inset (`padding: 0 var(--space-4)` on .composer__footer). The button's right
// edge lands here, which is the design's x=714 + 11 = 725 against a 741-wide row restated as a rule the
// window's width cannot change.
const FOOTER_INSET_PX = 16

// Sub-pixel tolerance for the geometry reads. The glyph's box is 11 x 12 from a fractional Figma frame
// (10.9989 x 11.9678), so an exact equality would be measuring the rounding rather than the alignment.
const EPSILON_PX = 1.5

// The three outcomes driven below, in order. Each is a member of AttachmentUploadEvent exactly as
// src/main/attachmentUpload builds it — a refusal carrying the client's own bound, a failure carrying a
// reason from the closed set, and a completion. Distinct uploadIds, because two transfers CAN be live at
// once (the main-side guard is scoped to the dialog, not the transfer) and this spec is what proves the
// composer states the latest to arrive rather than the first.
const REFUSED: AttachmentUploadEvent = {
  type: 'refused',
  uploadId: 'e2e-upload-1',
  reason: 'too-large',
  limitBytes: 23_040_000
}
const FAILED: AttachmentUploadEvent = {
  type: 'failed',
  uploadId: 'e2e-upload-2',
  reason: 'attachment-storage-failed'
}
// The `filename` is #1038's field and is an INVENTED non-secret name, like every other literal here. It
// is deliberately distinctive so the assertion that the composer does not render it can tell a partial
// interpolation from a clean absence.
const COMPLETED: AttachmentUploadEvent = {
  type: 'completed',
  uploadId: 'e2e-upload-3',
  filename: 'e2e-report.pdf'
}

// #1262's second file, so the strip can be proved to be the pending SET rather than the latest event: a
// distinct uploadId (two transfers can be live at once) and an extension that shares no character with the
// first's, so the two tiles' labels tell them apart and their ORDER is observable.
const COMPLETED_SECOND: AttachmentUploadEvent = {
  type: 'completed',
  uploadId: 'e2e-upload-5',
  filename: 'e2e-bundle.zip'
}

// #864's two in-flight reports and the terminal that ends them. `totalChunks` is 200 — a ~9 MB file,
// comfortably over the background process's ATTACHMENT_PROGRESS_MIN_CHUNKS, which is what a real
// transfer of this size would report. The two figures are far apart so an advancing line is
// distinguishable from a stuck one, and the terminal is a `connection-lost` because AC3 asks
// specifically that a connection lost mid-transfer clears the indicator on the completion's own path.
const PROGRESS_EARLY: AttachmentUploadEvent = {
  type: 'progress',
  uploadId: 'e2e-upload-4',
  sentChunks: 20,
  totalChunks: 200
}
const PROGRESS_LATE: AttachmentUploadEvent = {
  type: 'progress',
  uploadId: 'e2e-upload-4',
  sentChunks: 180,
  totalChunks: 200
}
const LOST: AttachmentUploadEvent = {
  type: 'failed',
  uploadId: 'e2e-upload-4',
  reason: 'connection-lost'
}

test('composer footer: the attach button dispatches the intent and states the latest outcome (AC1-AC5)', async ({
  launchPairedApp
}) => {
  const { page, app } = await launchPairedApp()

  // Located by ROLE AND ACCESSIBLE NAME rather than by class, which is what makes this an accessibility
  // assertion as well as a locator (AC2's first half): a button with no name resolves to nothing here.
  // `exact` is load-bearing on every trigger locator in this family — getByRole's `name` matches as a
  // case-insensitive SUBSTRING by default.
  const attach = page.getByRole('button', { name: COMPOSER_ATTACH_LABEL, exact: true })
  const footer = page.locator('.composer__footer')
  const outcome = page.locator('.composer__attach-outcome')
  const progress = page.locator('.composer__attach-progress')
  const messageBox = page.locator('.composer__row')
  // #1262: the pending strip and its tiles. Both located by the production classes, which share no whole
  // class token with the three above — a prefix is not a match for a class selector, so `.composer__attach`
  // and `.composer__attachment` cannot collide under strict mode.
  const strip = page.locator('.composer__attachments')
  const tiles = page.locator('.composer__attachment')
  const statusRow = page.locator('.composer-status')
  const composer = page.locator('.composer')

  await expect(attach).toHaveCount(1)
  await expect(attach).toBeVisible()
  // It renders on a FRESH LAUNCH with no run-config snapshot — the one item in this row that does. Its
  // three neighbours each wait on a snapshot, and this control has no daemon-published anything to be
  // missing, so a gate accidentally copied from them would fail right here.
  await expect(attach).toBeEnabled()

  // --- AC1: the row's LAST item, right-aligned past all four controls and the reading. ---
  const footerBox = (await footer.boundingBox())!
  const attachBox = (await attach.boundingBox())!
  // ⭐ THIS is the assertion that reddens if `margin-left: auto` is dropped, and it is the reason the
  // geometry is read at all. The button's right edge sits on the row's content-box right edge; without the
  // auto margin it would sit one 20px gap after the Actions trigger, hundreds of pixels to the left.
  expect(attachBox.x + attachBox.width).toBeCloseTo(
    footerBox.x + footerBox.width - FOOTER_INSET_PX,
    0
  )
  // Past everything else in the row: nothing the footer holds starts to the right of this button.
  const others = await footer.locator('> *').all()
  for (const other of others) {
    const box = await other.boundingBox()
    if (box === null) continue
    if (Math.abs(box.x - attachBox.x) < EPSILON_PX) continue // the button itself
    expect(box.x).toBeLessThan(attachBox.x)
  }

  // --- AC5's first half: the button's presence does not change the row. The height assertion matches the
  // three sibling specs — and is stated here as CONTAINMENT rather than as a bare `toBe(20)`, because the
  // row's height is hard-declared in the stylesheet and therefore cannot redden from anything this ticket
  // does. What CAN go wrong is the glyph overflowing a row that will not grow for it, which is what these
  // two lines actually detect. ---
  expect(footerBox.height).toBe(20)
  expect(attachBox.height).toBeLessThanOrEqual(footerBox.height)
  expect(attachBox.y).toBeGreaterThanOrEqual(footerBox.y - EPSILON_PX)

  // --- AC5's second half: nothing is reserved for the outcome while none is showing. A COUNT, not a
  // visibility check — an empty element holding the slot open would be invisible and still wrong. The
  // message box's position is recorded here so the clear at the end can be proven to restore it. ---
  await expect(outcome).toHaveCount(0)
  const messageBoxYBefore = (await messageBox.boundingBox())!.y
  // #1262, AC1's last clause, and the same shape of assertion for the same reason: with nothing pending
  // the strip mounts NO ELEMENT. A count, because an element that mounted empty would be invisible and
  // would still cost the column's gap plus its own margin on every launch forever. The composer's launch
  // height is recorded so the clear at the end can prove it reserved nothing on its way in or out.
  await expect(strip).toHaveCount(0)
  const composerHeightBefore = (await composer.boundingBox())!.height

  // --- Stub the picker in the MAIN process, recording that it was asked for and answering as a cancelled
  // dialog. defineProperty rather than a plain assignment: it succeeds against a data property and an
  // accessor alike, and `configurable: true` leaves the stub replaceable. The app reads
  // `dialog.showOpenDialog` at call time, so the patched property is what it reaches.
  //
  // IT ANSWERS `canceled`, WHICH IS ALSO A TEST. A cancelled picker is a total no-op on the main side —
  // nothing read, nothing sent, NO event emitted — so this one stub proves the click reaches the process
  // AND that a cancelled pick leaves the composer silent. ---
  await app.evaluate(({ dialog }, key) => {
    const calls: number[] = []
    ;(globalThis as unknown as Record<string, number[]>)[key] = calls
    Object.defineProperty(dialog, 'showOpenDialog', {
      value: () => {
        calls.push(1)
        return Promise.resolve({ canceled: true, filePaths: [] })
      },
      configurable: true,
      writable: true
    })
  }, PICKER_CALLS_KEY)

  // --- AC2: activating the button dispatches the attach intent. The recorder firing is the proof it
  // crossed the bridge and reached the composition root; polled, because the click crosses a process
  // boundary. Nothing that could name a file was sent — there is nothing in the renderer to send, which is
  // a property of the channel (`requestAttachmentUpload` takes no argument) rather than of this click. ---
  await attach.click()
  await expect
    .poll(
      () =>
        app.evaluate(
          (_electron, key) => (globalThis as unknown as Record<string, number[]>)[key].length,
          PICKER_CALLS_KEY
        ),
      { timeout: OUTCOME_TIMEOUT_MS }
    )
    .toBe(1)

  // AC4's cancellation half: the picker reported NOTHING, so nothing appeared. Held over a real interval
  // rather than read once, so a late-arriving event would still fail this.
  await expect(outcome).toHaveCount(0)
  await page.waitForTimeout(250)
  await expect(outcome).toHaveCount(0)

  // --- AC3, all three arms, pushed on the outcome channel through the same seam. `webContents.send` is
  // exactly what src/main/attachmentUpload's `emit` does, so the renderer cannot tell this from a real
  // terminal. The expected sentence is DERIVED by calling the production copy module — never typed out
  // here — so this spec proves the wiring and cannot drift from the copy. ---
  const push = (event: AttachmentUploadEvent): Promise<void> =>
    app.evaluate(({ BrowserWindow }, payload) => {
      const [window] = BrowserWindow.getAllWindows()
      window.webContents.send(payload.channel, payload.event)
    }, { channel: ATTACHMENT_UPLOAD_EVENT_CHANNEL, event })

  await push(REFUSED)
  await expect(outcome).toHaveText(attachmentUploadOutcomeCopy(REFUSED), {
    timeout: OUTCOME_TIMEOUT_MS
  })
  // A polite live region, so a screen reader is told without focus moving. NOT role="alert" — four shipped
  // sibling specs count alerts inside this row, and a success announced assertively would be wrong anyway.
  await expect(outcome).toHaveAttribute('role', 'status')
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)
  // The refusal names the limit it carried, and names it as THIS APP's rather than the host's: the client's
  // bound is not the daemon's, and a file under it can still come back `attachment-too-large`.
  await expect(outcome).toContainText('23 MB')

  // --- AC4's first half: the LATEST outcome to arrive, not the first. Two more terminals with different
  // uploadIds — which is the real case, since two transfers can be live at once — each replacing the one
  // before it. Exactly one line is on screen throughout; the composer does not accumulate a log. ---
  await push(FAILED)
  await expect(outcome).toHaveText(attachmentUploadOutcomeCopy(FAILED), {
    timeout: OUTCOME_TIMEOUT_MS
  })
  await expect(outcome).toHaveCount(1)

  // ⭐ #1262 REPLACED THIS ARM'S SENTENCE WITH A TILE, and the two halves are asserted together because
  // they are one swap: the tile draws, and the line that used to say 'File attached.' does not mount at
  // all. The rest of the drive continues past this point with one tile on screen, which is deliberate —
  // the progress and connection-lost arms below must keep behaving identically while it is up.
  await push(COMPLETED)
  await expect(tiles).toHaveCount(1, { timeout: OUTCOME_TIMEOUT_MS })
  // AC2: a completed upload writes NOTHING beneath the footer. A count, not a text comparison — the
  // element does not mount for a completion, so there is no text to compare.
  await expect(outcome).toHaveCount(0)
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)
  // AC5, RE-AIMED. These two assertions shipped against the outcome line; against an element that no
  // longer mounts for a completion they would pass vacuously and guard nothing, so they now read the
  // element that DOES mount. The uploadId is a host-side storage handle the window cannot use, and the
  // stored file's NAME is untrusted display text — the tile draws its derived extension label and nothing
  // else. Asserted through the running app rather than only in a unit render, because the bridge is the
  // half a unit test cannot reach: a preload that helpfully stringified the whole event into the strip
  // would pass ComposerAttach.test.tsx and fail here.
  await expect(strip).not.toContainText(COMPLETED.uploadId)
  // ⭐ #1265 RE-AIMED THE NAME HALF, for the reason the paragraph above re-aimed both in the first place:
  // its premise stopped being true. The tile now hangs a PILL carrying its file's name, drawn on hover and
  // on focus, so "the name is nowhere in the strip" is false BY DESIGN — while the claim it stood for is
  // not. That claim is CLAUDE.md's 2026-08-20 ruling: the name may be rendered, escaped and bounded, and
  // may reach no attribute, no URL and no log. So the text assertion becomes an enumeration of every
  // attribute of every element in the strip, which is what the bridge half of this test was always about:
  // a preload that stringified the whole event into an attribute still fails here.
  const stripAttributes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.composer__attachments, .composer__attachments *')).flatMap(
      (element) => Array.from(element.attributes).map((attribute) => attribute.value)
    )
  )
  expect(stripAttributes.filter((value) => value.includes(COMPLETED.filename))).toEqual([])
  expect(stripAttributes.filter((value) => value.includes(COMPLETED.uploadId))).toEqual([])
  // The label is what draws INSIDE the tile, and it is the extension of that name — the pill is the tile's
  // sibling in the slot, not its child, so it contributes no text here.
  await expect(tiles.first()).toHaveText('PDF')

  // --- #864, AC1 and AC3: an in-flight report takes the slot the terminal was in, ADVANCES as further
  // chunks go out, and is then replaced by a terminal of its own. Pushed on the same channel through
  // the same seam, so the composer cannot tell these from a real transfer's reports. ---
  await push(PROGRESS_EARLY)
  await expect(progress).toHaveText(attachmentUploadOutcomeCopy(PROGRESS_EARLY), {
    timeout: OUTCOME_TIMEOUT_MS
  })
  // ⭐ AC1's "no second indicator appears beside it": the terminal that was on screen a moment ago is
  // GONE, not pushed aside. One line in the column, and it is this one.
  await expect(outcome).toHaveCount(0)
  await expect(progress).toHaveCount(1)
  // Not a live region while in flight — a report per chunk would announce two hundred times for one
  // file. The terminal above and below this block is the polite one; this is deliberately silent.
  await expect(progress).not.toHaveAttribute('role', 'status')
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)

  const earlyText = await progress.textContent()
  await push(PROGRESS_LATE)
  await expect(progress).toHaveText(attachmentUploadOutcomeCopy(PROGRESS_LATE), {
    timeout: OUTCOME_TIMEOUT_MS
  })
  // It MOVED. A line that rendered a constant would satisfy every assertion above this one.
  expect(await progress.textContent()).not.toBe(earlyText)

  // AC3: a connection lost mid-transfer clears the indicator on the same path a completion does — the
  // terminal simply replaces it, because both are the latest event to arrive.
  await push(LOST)
  await expect(outcome).toHaveText(attachmentUploadOutcomeCopy(LOST), {
    timeout: OUTCOME_TIMEOUT_MS
  })
  await expect(progress).toHaveCount(0)
  await expect(outcome).toHaveAttribute('role', 'status')

  // --- AC4's second half: starting a NEW attach clears the one before it. The clear happens on the click
  // and not on an arriving event, which is the only ordering that works: this second pick is cancelled too
  // and reports nothing at all, so an event-driven clear would leave the terminal now on screen — the
  // connection-lost line pushed just above, since #864's progress block runs before this — there forever. ---
  await attach.click()
  await expect(outcome).toHaveCount(0, { timeout: OUTCOME_TIMEOUT_MS })

  // --- AC5, closed: with the outcome gone the message box is back exactly where it started, so the line
  // reserved nothing on its way in or out. (While it WAS showing the box moved up by the line's height,
  // which is intended — the criterion forbids reserving space for an absent outcome, not showing a
  // present one.) ---
  await expect
    .poll(async () => (await messageBox.boundingBox())!.y, { timeout: OUTCOME_TIMEOUT_MS })
    .toBeCloseTo(messageBoxYBefore, 0)
  expect((await footer.boundingBox())!.height).toBe(20)

  // ================================================================================================
  // #1262 — the strip's own drive, continuing from the one tile the completion above drew. Geometry
  // first (the drawing), then a second tile (the row), then the two ways a submit may not take
  // (unchanged) and the one that does.
  // ================================================================================================

  // --- AC1's measurements, all four from the design's own node boxes: the area at x=0 with 45x60 tiles,
  // 8px clear of the status area above (32 -> 40) and of the input below (100 -> 108). Deltas are compared
  // with toBeCloseTo rather than a rounded toBe, #868's rule for a signed-zero difference. ---
  const firstTile = (await tiles.first().boundingBox())!
  const statusBox = (await statusRow.boundingBox())!
  const messageBoxBox = (await messageBox.boundingBox())!
  expect(firstTile.width).toBeCloseTo(45, 0)
  expect(firstTile.height).toBeCloseTo(60, 0)
  // ⭐ LEFT-ALIGNED WITH THE MESSAGE BOX'S OWN EDGE, which is the design's x=0 — deliberately NOT the x=16
  // its TEXT starts at and that `.composer__attach-outcome` pads to reach. This is the assertion that
  // reddens if the strip ever acquires that padding by analogy with the line beneath the footer.
  expect(firstTile.x).toBeCloseTo(messageBoxBox.x, 0)
  expect(firstTile.y - (statusBox.y + statusBox.height)).toBeCloseTo(8, 0)
  expect(messageBoxBox.y - (firstTile.y + firstTile.height)).toBeCloseTo(8, 0)

  // --- A second completion joins the row rather than replacing it: the strip is the pending SET, where
  // the line beneath the footer was only ever the latest event. 12px apart, in completion order. ---
  await push(COMPLETED_SECOND)
  await expect(tiles).toHaveCount(2, { timeout: OUTCOME_TIMEOUT_MS })
  await expect(tiles.nth(0)).toHaveText('PDF')
  await expect(tiles.nth(1)).toHaveText('ZIP')
  const secondTile = (await tiles.nth(1).boundingBox())!
  const firstAgain = (await tiles.nth(0).boundingBox())!
  expect(secondTile.x - (firstAgain.x + firstAgain.width)).toBeCloseTo(12, 0)
  expect(secondTile.y).toBeCloseTo(firstAgain.y, 0)
  // Still nothing beneath the footer, and the footer itself is untouched by a strip two tiles wide.
  await expect(outcome).toHaveCount(0)
  expect((await footer.boundingBox())!.height).toBe(20)

  // --- AC4's two non-takes. A blank Enter never reaches the take — `submitMessage` reads its
  // `takeAttachments` dep below both of its `false` returns — so the operator's attached files survive for
  // the send they were attached for. (Its sibling, a submit with no active conversation, is the same
  // `false` return one branch up and is unreachable from a paired launch; `composerSend.test.ts` owns it.)
  // Held over a real interval rather than read once, so a late clear would still fail this. ---
  const input = page.getByPlaceholder('Message…')
  await input.click()
  await input.press('Enter')
  await page.waitForTimeout(250)
  await expect(tiles).toHaveCount(2)

  // --- AC4's take: sending empties the strip in one act, because `drainPendingAttachments` empties the
  // set in one act. ---
  await input.fill('the files are attached')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(strip).toHaveCount(0, { timeout: OUTCOME_TIMEOUT_MS })

  // --- AC1's last clause, closed: with the strip gone the composer is exactly the height it launched at,
  // so the tiles reserved nothing on their way in or out — and the message box is still where it started,
  // which is what makes the composer's growth upward into the thread rather than downward. ---
  expect((await composer.boundingBox())!.height).toBeCloseTo(composerHeightBefore, 0)
  expect((await messageBox.boundingBox())!.y).toBeCloseTo(messageBoxYBefore, 0)
})
