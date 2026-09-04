import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import { pasteCarriesImageOnly } from '../src/renderer/src/screens/conversation/ComposerAttach'
import { attachmentUploadOutcomeCopy } from '../src/renderer/src/screens/conversation/attachmentUploadCopy'
import type { AttachmentUploadEvent } from '../src/shared/ipc/attachmentUpload'
import type { ErrorPayload } from '../src/shared/wire/types'

// Fake-stack UI e2e for the composer's PASTE entry (#1033) — the interaction proof the static tier
// cannot reach. vitest runs the `node` environment, so every renderer test in this repo is a
// renderToStaticMarkup string assertion with no DOM, no effects and no key handlers: the static tier
// pins every branch of the decision (ComposerAttach.test.tsx's `pasteCarriesImageOnly`) and the shared
// guard's own refusals (src/shared/ipc/attachmentUpload.test.ts), and only a real window can prove that
// a paste reaches that decision at all.
//
// ⭐ THIS SPEC IS ALSO THE FIRST PROOF THAT THE WHOLE PASTE CHAIN JOINS, which #1032 deliberately left
// unproven and assigned here (docs/knowledge/features/attachment-upload.md). It is why the drive has two
// halves rather than one, and they prove different things:
//
//   1. THE BRANCH MATRIX, SYNTHETICALLY — composer-file-drop.spec.ts's shape applied to `paste`. A
//      DataTransfer is built in page context and a ClipboardEvent dispatched on the message box, and
//      `dispatchEvent`'s own return is read: false means preventDefault ran. That is the ONLY observable
//      detector for the prevention, because an UNTRUSTED event performs no default action — watching the
//      textarea would prove nothing, since nothing would have been inserted either way.
//   2. THE WHOLE CHAIN, FOR REAL — a real bitmap seeded onto the real OS clipboard, and a TRUSTED paste
//      driven through `webContents.paste()`, which runs Chromium's own Paste editing command against the
//      focused element. That is what carries the drive across the bridge, into #1032's main-side
//      clipboard read, the PNG encode, the byte guard, the transfer, a real frame on the wire, and back
//      to a terminal in the composer. `page.keyboard.press` is NOT used: a synthesised key event does not
//      run the editing command, so it would deliver no clipboard at all.
//
// ⭐ THE FAKE DAEMON MUST ANSWER THE CHUNK, AND THAT IS NOT OPTIONAL. attachmentTransfer.ts has NO
// per-transfer deadline by design — a transfer whose chunks all went out waits indefinitely for its
// answer — so an unanswered chunk yields no terminal at all and the assertion below would hang to the
// suite timeout rather than fail. `buildReplyFrames` therefore rejects the chunk with a real `error`
// frame, which daemonConnection correlates through `sentEnvelope` into a `failed` terminal.
//
// THE STANDING RULE IS KEPT — a fake-tier spec may not supply an input production does not produce.
// Every frame below is one a real daemon emits, in the shape the wire declares; the only thing standing
// in for production is the operator's fingers, and the clipboard those fingers would have filled is
// filled here with an invented bitmap.
//
// SIDE EFFECT, ACCEPTED (message-copy.spec.ts's recorded decision, carried verbatim): this spec
// overwrites the machine's clipboard with its own non-secret literals, and deliberately does NOT read
// the prior contents in order to restore them — the clipboard routinely holds a password-manager secret,
// and pulling that into a test process where a failure diagnostic could serialise it is a worse trade
// than a clobbered clipboard.
//
// SECRET HYGIENE (the sibling specs' standing rule): every literal is an invented non-secret value and
// every assertion reads DOM text, counts, a boolean, or a list of clipboard FORMAT NAMES — never a
// clipboard value. Nothing here could leak one anyway: no member of `AttachmentUploadEvent` can hold a
// path, a filename or a byte, which is the property #862 built the channel around.

const OUTCOME_TIMEOUT_MS = 15_000
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// A 16x16 solid PNG, invented here and carrying no information at all. Small enough to plan into a
// single chunk (so exactly one `attachment_chunk` reaches the fake daemon) and comfortably under the
// client's own byte guard, which this spec is not testing — #862's unit tests own that bound.
const SEEDED_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGOYe/oPSYhhVMOohuGrAQD66GQfBKFH6AAAAABJRU5ErkJggg=='

// Distinct from anything the app renders, so a stale value cannot be mistaken for a successful paste.
const SEEDED_TEXT = 'pasted text stays text'

// The main-process global the page probe reports through. `page.evaluate` serialises its callback, so
// nothing is captured from this module's scope — the key is passed in and read back out by name.
const PASTE_TYPES_KEY = '__pyryPasteTypes'

/**
 * ⭐ THE TWO UPLOADS THIS SPEC DRIVES EARN DIFFERENT SENTENCES, AND THAT IS A DETECTOR RATHER THAN
 * decoration. Both the synthetic arm and the trusted arm end in a terminal in the same single slot, so
 * a second assertion that the same sentence is present would pass on the FIRST arm's line and prove
 * nothing about the second. Rejecting the first upload and every later one with different daemon codes
 * makes the trusted paste's terminal distinguishable from the synthetic paste's, so the transition is
 * observable rather than assumed.
 *
 * `uploadId` is minted in main by `randomUUID` and is unknowable here — which is fine, because the copy
 * module selects on `reason` alone and puts the id nowhere. The literals below exist only to call it.
 */
const FIRST_TERMINAL: AttachmentUploadEvent = {
  type: 'failed',
  uploadId: 'unknowable-minted-in-main',
  reason: 'attachment-storage-failed'
}
const LATER_TERMINAL: AttachmentUploadEvent = {
  type: 'failed',
  uploadId: 'unknowable-minted-in-main',
  reason: 'attachment-too-many-uploads'
}

/** How many uploads the fake daemon has rejected, which is what selects the code above. The fake daemon
 *  runs in THIS process, so a module-level counter is deterministic — no clock and no randomness, the
 *  fakeDaemon convention. */
let rejectedUploads = 0

/**
 * Reject the upload's chunk the way a real host would, and seed the conversations row on every other
 * frame. A scripted `buildReplyFrames` overrides the fixture's default reply, so this spec owns the
 * seeding (message-copy.spec.ts's shape).
 *
 * The reject is a real `error` frame: `in_reply_to` names the chunk envelope this transfer sent, which
 * is the correlation daemonConnection's `daemon-error` case performs through `sentEnvelope`, and both
 * codes are narrowed at the decode boundary into the outcomes above. The reply id is derived from the
 * frame it answers rather than fixed, so a file that ever planned into more than one chunk still
 * produces distinct envelopes.
 */
const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  if (envelope.type === 'attachment_chunk') {
    rejectedUploads += 1
    return [
      encodeEnvelope({
        id: envelope.id + 1000,
        type: 'error',
        ts: FIXED_TS,
        in_reply_to: envelope.id,
        payload: {
          code: rejectedUploads === 1 ? 'attachment.storage_failed' : 'attachment.too_many_uploads',
          message: 'e2e: the host refused the bytes',
          retryable: false
        } satisfies ErrorPayload
      })
    ]
  }
  return [seedConversationsFrame()]
}

test('composer: a pasted image attaches and a pasted text stays text (AC1-AC4)', async ({
  launchPairedApp
}) => {
  const { page, app } = await launchPairedApp({ buildReplyFrames })

  const input = page.locator('.composer__input')
  const outcome = page.locator('.composer__attach-outcome')

  await expect(input).toHaveCount(1)
  await expect(outcome).toHaveCount(0)

  // ⭐ SEED THE REAL CLIPBOARD BEFORE ANYTHING CAN PASTE, and this ordering is load-bearing rather than
  // tidy. The ask is NOT intercepted anywhere in this tier: it crosses to the real main handler, which
  // reads the real OS clipboard — so an image-advertising paste, synthetic or not, earns whatever
  // terminal the machine's actual clipboard happens to produce. Driving the matrix below against an
  // unseeded clipboard makes this spec's result depend on what the operator last copied. Seeded from
  // the MAIN process, where `nativeImage` and `clipboard` sit outside the renderer permission model
  // entirely — which is what makes the read on the far end a genuine proof rather than a self-report.
  await app.evaluate(({ clipboard, nativeImage }, dataUrl) => {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
  }, SEEDED_PNG_DATA_URL)

  // ---------------------------------------------------------------------------------------------
  // HALF 1 — the branch matrix, driven synthetically.
  // ---------------------------------------------------------------------------------------------

  // Dispatch one `paste` carrying exactly the advertised flavours named, and report BOTH what the event
  // actually carried and whether its default was prevented.
  //
  // ⭐ `carried` IS AN ANTI-VACUITY GUARD, not diagnostics. If Chromium ever dropped the `clipboardData`
  // init member, `event.clipboardData` would be null, the handler would take its `undefined` arm, every
  // `prevented === false` assertion below would pass — and this spec would be proving nothing at all
  // while staying green. Asserting the event carried what it was built with is what keeps the false
  // arms falsifiable.
  const paste = (
    flavours: readonly string[]
  ): Promise<{ carried: string[]; prevented: boolean }> =>
    page.evaluate((advertised) => {
      const target = document.querySelector('.composer__input')
      if (target === null) throw new Error('no message box')
      const transfer = new DataTransfer()
      for (const flavour of advertised) {
        // 'Files' is not a settable format — it is what a transfer advertises once it holds a file, so
        // it is produced the only way a browser produces it. Every other flavour is set directly, with
        // a value no assertion ever reads.
        if (flavour === 'Files') {
          transfer.items.add(new File(['pyry'], 'pasted.png', { type: 'image/png' }))
        } else {
          transfer.setData(flavour, 'invented, never read')
        }
      }
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer
      })
      return {
        carried: [...(event.clipboardData?.types ?? [])],
        // false ⇒ preventDefault ran on this event.
        prevented: target.dispatchEvent(event) === false
      }
    }, flavours)

  // --- AC1: an image with no plain text is intercepted. The default paste is prevented, and the ask it
  // fires reaches the flow for real — the seeded bitmap comes back as the first terminal. ---
  const imageOnly = await paste(['Files'])
  expect(imageOnly.carried).toContain('Files')
  expect(imageOnly.prevented).toBe(true)
  await expect(outcome).toHaveText(attachmentUploadOutcomeCopy(FIRST_TERMINAL), {
    timeout: OUTCOME_TIMEOUT_MS
  })
  // AC1's last clause: the message box's text is unchanged by the attach.
  await expect(input).toHaveValue('')

  // --- AC2: plain text alongside an image is NOT intercepted, which is the security bound and the case
  // a copied web-page selection produces every day. The event is not consumed, so the default paste runs
  // exactly as it does today.
  //
  // ⭐ THE OUTCOME LINE IS THE SECOND DETECTOR HERE, and the stronger of the two. Reading
  // `prevented === false` proves the default survived; the line still standing proves NO ASK FIRED,
  // because clearing it on the gesture is something only the attach path does (`pasteImage`). A handler
  // that prevented nothing but asked anyway would pass the first check and fail this one. ---
  const withText = await paste(['text/plain', 'Files'])
  expect(withText.carried).toEqual(expect.arrayContaining(['text/plain', 'Files']))
  expect(withText.prevented).toBe(false)
  await expect(outcome).toHaveText(attachmentUploadOutcomeCopy(FIRST_TERMINAL))

  // --- AC2's other half: an ordinary text paste is untouched, by both detectors. ---
  const textOnly = await paste(['text/plain'])
  expect(textOnly.carried).toContain('text/plain')
  expect(textOnly.prevented).toBe(false)
  await expect(outcome).toHaveText(attachmentUploadOutcomeCopy(FIRST_TERMINAL))

  // Nothing above was inserted into the message box, and exactly one line is on screen throughout —
  // the composer states an outcome, it does not accumulate a log (AC4).
  await expect(input).toHaveValue('')
  await expect(outcome).toHaveCount(1)

  // ---------------------------------------------------------------------------------------------
  // HALF 2 — the whole chain, for real. From here on every clipboard is the machine's own and every
  // paste is a trusted one Chromium performed itself.
  // ---------------------------------------------------------------------------------------------

  // Record the flavour list a REAL paste advertises, so the predicate's breadth is measured rather than
  // assumed — the open question the plan carried into Phase B. A capture-phase listener on `document`
  // sees the event before React's root listener; it only reads, and it reads FORMAT NAMES, never a value.
  await page.evaluate((key) => {
    const store = globalThis as unknown as Record<string, string[] | null>
    store[key] = null
    document.addEventListener(
      'paste',
      (event) => {
        store[key] = [...((event as ClipboardEvent).clipboardData?.types ?? [])]
      },
      { capture: true }
    )
  }, PASTE_TYPES_KEY)

  const readPasteTypes = (): Promise<string[] | null> =>
    page.evaluate((key) => (globalThis as unknown as Record<string, string[] | null>)[key], PASTE_TYPES_KEY)

  await input.focus()
  await expect(input).toBeFocused()

  // The trusted paste. `webContents.paste()` runs Chromium's own Paste editing command against the
  // focused element, which is the only way to deliver the REAL clipboard to a page from a test.
  const trustedPaste = (): Promise<void> =>
    app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows()
      window.webContents.paste()
    })

  await trustedPaste()

  // ⭐ THE CHAIN, CLOSED, AND CLOSED BY A GESTURE CHROMIUM ITSELF PERFORMED. Nothing between the
  // keystroke and this line was stubbed: the handler decided, the content-free ask crossed the bridge,
  // main read the operator's clipboard, encoded the PNG, minted the name, passed the byte guard, chunked
  // the bytes onto a real Noise session, and the daemon's reject came back correlated. It is the SECOND
  // sentence, which is what makes this a fresh observation rather than the synthetic arm's line still
  // standing. The copy is DERIVED by calling the production module, never typed out here.
  await expect(outcome).toHaveText(attachmentUploadOutcomeCopy(LATER_TERMINAL), {
    timeout: OUTCOME_TIMEOUT_MS
  })
  // AC4: exactly one line, and it is the polite live region #863 shipped — no second indicator beside it.
  await expect(outcome).toHaveCount(1)
  await expect(outcome).toHaveAttribute('role', 'status')
  await expect(page.locator('.composer__attach-progress')).toHaveCount(0)
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)

  // AC1's last clause again, now for a paste whose default Chromium really would have performed.
  await expect(input).toHaveValue('')

  // --- THE MEASUREMENT the predicate's disjunction was written against. Whatever spelling Chromium
  // chose for a real bitmap, the production function must answer true for it — asserted by calling that
  // very function on the list a real paste carried. The non-empty check is what stops a probe that never
  // fired from passing this vacuously. ---
  const measured = await readPasteTypes()
  expect(measured).not.toBeNull()
  expect(measured?.length ?? 0).toBeGreaterThan(0)
  expect(measured).not.toContain('text/plain')
  expect(pasteCarriesImageOnly(measured ?? undefined)).toBe(true)

  // --- AC2, for real and at full strength. A text clipboard pasted the same trusted way lands in the
  // message box — and CRUCIALLY leaves the outcome line above untouched, because no ask fired. That is
  // the detector: had this paste taken the attach branch, `pasteImage` would have cleared the line on
  // the gesture, which is something only the attach path does. ---
  await app.evaluate(({ clipboard }, seed) => clipboard.writeText(seed), SEEDED_TEXT)
  await input.focus()
  await trustedPaste()

  await expect(input).toHaveValue(SEEDED_TEXT, { timeout: OUTCOME_TIMEOUT_MS })
  await expect(outcome).toHaveText(attachmentUploadOutcomeCopy(LATER_TERMINAL))
  await expect(outcome).toHaveCount(1)

  // And the real text paste advertised plain text, which is the flavour the predicate refuses on —
  // the same fact the synthetic arm asserts, now measured off a clipboard the OS actually filled.
  const measuredText = await readPasteTypes()
  expect(measuredText).toContain('text/plain')
  expect(pasteCarriesImageOnly(measuredText ?? undefined)).toBe(false)
})
