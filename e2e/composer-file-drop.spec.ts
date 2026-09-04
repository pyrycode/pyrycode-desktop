import { test, expect } from './fixtures/launchPairedApp'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentUploadEvent } from '../src/shared/ipc/attachmentUpload'
import { COMPOSER_DROP_ACTIVE_CLASS } from '../src/renderer/src/screens/conversation/ComposerAttach'
import { attachmentUploadOutcomeCopy } from '../src/renderer/src/screens/conversation/attachmentUploadCopy'

// Fake-stack UI e2e for the composer's DROP entry (#890) — the interaction proof the static tier cannot
// reach. vitest runs the `node` environment, so every renderer test in this repo is a
// renderToStaticMarkup string assertion with no DOM, no effects and no event handlers: the static tier
// pins each branch of the decision (ComposerAttach.test.tsx's four pure functions) and the shared guard's
// own refusals (src/shared/ipc/attachmentUpload.test.ts), and only a real window can prove that a drag
// reaches those functions at all, that the edge appears and clears, that it does NOT flicker as the
// pointer crosses a child, and that a drop reaches the upload flow.
//
// ⭐ WHY THE DRAG IS SYNTHESISED IN THE PAGE, and what that route can and cannot prove. Playwright cannot
// originate an operating-system drag from Finder or Explorer, so the drive builds a `DataTransfer` in page
// context and dispatches `DragEvent`s onto real elements. Two consequences, both load-bearing:
//
//   1. A page-built `File` HAS NO PATH — `webUtils.getPathForFile` answers '' for one — so this tier
//      cannot carry a real path across the boundary, and deliberately does not try. The path-carrying leg
//      is proven by the shared guard's unit tests plus #862's existing real-temp-file coverage of
//      `uploadAttachmentFile`; the preload and the composition-root join are this repo's untested glue,
//      as they are for every other channel. CDP's `Input.dispatchDragEvent` was considered and NOT
//      attempted: it cannot back a `File` with a real OS path either, so it would not close that gap.
//   2. An UNTRUSTED event performs no default action, so "the window did not navigate" cannot be observed
//      by watching the URL — it would hold whether or not the guard existed. What IS observable, and what
//      this spec asserts instead, is `dispatchEvent`'s own return: `false` means `preventDefault` ran.
//      That is the guard firing, read directly, and it reddens if the listener is unmounted or its
//      file-drag gate is inverted. The URL is checked alongside as corroboration, not as the detector.
//
// The JOIN is still proven here, without a path: an outcome is pushed on the outcome channel first
// (`composer-attach.spec.ts`'s shipped `app.evaluate` seam), and the drop CLEARS it — which only
// `useAttachmentUpload`'s `dropFile` does.
//
// ONE test() block, ONE launch, ONE continuous drive (the sibling attach spec's shape): each launch pays a
// full handshake, the ordering is load-bearing, and no step mutates persistent state.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, classes,
// counts and a boolean. Nothing serialises a token, a key or plaintext — and nothing here could: the file
// is invented in page context and no member of `AttachmentUploadEvent` can hold a path, a filename or a
// byte, which is the property #862 built the channel around.

const OUTCOME_TIMEOUT_MS = 15_000

/** The one terminal pushed below, so the drop has something visible to clear. A member of
 *  `AttachmentUploadEvent` exactly as `src/main/attachmentUpload` builds it. */
const FAILED: AttachmentUploadEvent = {
  type: 'failed',
  uploadId: 'e2e-drop-1',
  reason: 'attachment-storage-failed'
}

/** What a synthesised drag carries. `file` puts a `File` on the transfer, which is what makes
 *  `DataTransfer.types` contain `'Files'` — the one list a browser exposes during a drag, and the whole
 *  input to `dragCarriesFiles`. `text` sets `text/plain` instead, which must not be intercepted. */
type DragKind = 'file' | 'files' | 'text'

test('composer: a dropped file attaches, a dragged file lights the edge, and neither navigates (AC1-AC4)', async ({
  launchPairedApp
}) => {
  const { page, app } = await launchPairedApp()

  const composer = page.locator('.composer')
  const outcome = page.locator('.composer__attach-outcome')
  const active = page.locator(`.${COMPOSER_DROP_ACTIVE_CLASS}`)
  const input = page.locator('.composer__input')

  await expect(composer).toHaveCount(1)
  await expect(active).toHaveCount(0)

  // Dispatch one drag event onto one element in page context, and report whether the default was
  // PREVENTED. `dispatchEvent` returns false exactly when something called preventDefault, so the return
  // is the guard's own signal rather than a proxy for it. Nothing is captured from this module's scope —
  // every value is passed as the argument, the `app.evaluate` discipline applied to a page evaluate.
  const drag = (selector: string, type: string, kind: DragKind): Promise<boolean> =>
    page.evaluate(
      (payload) => {
        const target = document.querySelector(payload.selector)
        if (target === null) throw new Error(`no element for ${payload.selector}`)
        const transfer = new DataTransfer()
        if (payload.kind === 'text') {
          transfer.setData('text/plain', 'dragged text')
        } else {
          transfer.items.add(new File(['pyry'], 'dropped.txt', { type: 'text/plain' }))
          // The multi-file case: a second file on the same transfer. `fileToAttach` answers null for it,
          // so the drop is swallowed and nothing is attached and nothing is said.
          if (payload.kind === 'files') {
            transfer.items.add(new File(['pyry'], 'second.txt', { type: 'text/plain' }))
          }
        }
        const event = new DragEvent(payload.type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer
        })
        // false ⇒ preventDefault ran on this event.
        return target.dispatchEvent(event) === false
      },
      { selector, type, kind }
    )

  // --- AC1: dragging a file over the composer marks it. ---
  await drag('.composer', 'dragenter', 'file')
  await expect(active).toHaveCount(1)
  await expect(composer).toHaveClass(new RegExp(`(^|\\s)${COMPOSER_DROP_ACTIVE_CLASS}(\\s|$)`))

  // ⭐ THE FLICKER CASE, and the reason the state is a depth counter rather than a boolean. Crossing onto
  // a child fires the child's dragenter and the composer-relative dragleave as a PAIR, both bubbling to
  // the same handler. A boolean flipped on dragleave would clear here and the edge would strobe as the
  // pointer moved over the textarea, the footer row and each of its five controls.
  await drag('.composer__input', 'dragenter', 'file')
  await drag('.composer__input', 'dragleave', 'file')
  await expect(active).toHaveCount(1)

  // --- AC1's second half: leaving clears it. ONE leave, because the child crossing above was an
  // enter/leave PAIR and netted zero — which is exactly the arithmetic the counter exists to get right. ---
  await drag('.composer', 'dragleave', 'file')
  await expect(active).toHaveCount(0)

  // --- AC3: a drag carrying NO file is not intercepted at all. The edge never appears, and the default
  // is not prevented — which is what leaves text dropped into the message box doing what it does today. ---
  expect(await drag('.composer', 'dragenter', 'text')).toBe(false)
  expect(await drag('.composer', 'dragover', 'text')).toBe(false)
  await expect(active).toHaveCount(0)
  expect(await drag('.composer', 'drop', 'text')).toBe(false)
  await expect(active).toHaveCount(0)

  // --- AC3: the window-level guard. A FILE drag anywhere in the window has its default prevented, so a
  // missed drop cannot navigate the window to the file it landed on; the same gesture carrying text is
  // left alone. Read off dispatchEvent rather than off the URL, because an untrusted event performs no
  // default action and a URL check would hold with no guard at all. ---
  expect(await drag('body', 'dragover', 'file')).toBe(true)
  expect(await drag('body', 'drop', 'file')).toBe(true)
  expect(await drag('body', 'dragover', 'text')).toBe(false)
  // Corroboration, not the detector: the window is still showing the conversation screen, on its own URL.
  const urlBefore = page.url()
  await expect(input).toHaveCount(1)
  await expect(active).toHaveCount(0)

  // --- AC2: the join. An outcome is pushed first so the drop has something to clear — `webContents.send`
  // is exactly what `src/main/attachmentUpload`'s `emit` does, so the renderer cannot tell this from a
  // real terminal — and the clear is something ONLY dropFile performs. ---
  await app.evaluate(
    ({ BrowserWindow }, payload) => {
      const [window] = BrowserWindow.getAllWindows()
      window.webContents.send(payload.channel, payload.event)
    },
    { channel: ATTACHMENT_UPLOAD_EVENT_CHANNEL, event: FAILED }
  )
  await expect(outcome).toHaveText(attachmentUploadOutcomeCopy(FAILED), {
    timeout: OUTCOME_TIMEOUT_MS
  })

  // A MULTI-FILE drop first: it is swallowed — nothing navigates — but it attaches nothing, so the
  // outcome on screen is untouched. That last part is what tells this apart from the single-file drop
  // below, which clears it.
  await drag('.composer', 'dragenter', 'files')
  await expect(active).toHaveCount(1)
  expect(await drag('.composer', 'drop', 'files')).toBe(true)
  await expect(active).toHaveCount(0)
  await expect(outcome).toHaveText(attachmentUploadOutcomeCopy(FAILED))

  // --- AC2, closed: one file dropped on the composer clears the outcome line, and AC1's third clear —
  // a drop fires no matching dragleave, so the edge has to come down on the drop itself. ---
  await drag('.composer', 'dragenter', 'file')
  await expect(active).toHaveCount(1)
  expect(await drag('.composer', 'drop', 'file')).toBe(true)
  await expect(active).toHaveCount(0)
  await expect(outcome).toHaveCount(0, { timeout: OUTCOME_TIMEOUT_MS })

  // --- AC3's first half, closed: nothing was inserted into the message box by any drop above, and the
  // window never left the conversation screen. A page-built File carries no path, so no upload started
  // and no new outcome can arrive to contradict the clear. ---
  await expect(input).toHaveValue('')
  expect(page.url()).toBe(urlBefore)
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)
})
