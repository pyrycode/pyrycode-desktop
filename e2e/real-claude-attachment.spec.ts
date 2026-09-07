import { type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { COMPOSER_ATTACH_LABEL } from '../src/renderer/src/screens/conversation/ComposerAttach'
import { attachmentUploadOutcomeCopy } from '../src/renderer/src/screens/conversation/attachmentUploadCopy'

// #1055 — the live proof that an attached file actually REACHES claude. Every other tier in this repo can
// only prove client state: the fake tier stubs the upload's outcome and uploads nothing, and the unit tier
// asserts on the frame this window built. Neither can tell "the id rode the frame" from "the daemon
// resolved it, named its path in the prompt, and claude opened the file" — which is exactly the gap this
// ticket exists to close. An operator attached an image on 2026-09-04, asked whether it had come through,
// and it had not: claude's transcript for that turn held one text block and no reference of any kind.
//
// ⭐ THE ASSERTION IS ON THE REPLY'S TEXT, NEVER ON CLIENT STATE, and that is the whole point. A client
// that renders the thumbnail perfectly, records the attachment on its own timeline and sends no
// `attachment_ids` passes every other assertion in this repo and fails this one.
//
// It stubs `dialog.showOpenDialog` in the MAIN process for composer-attach.spec.ts's recorded reason: a
// click reaches the real picker, which opens a NATIVE OS window no Playwright locator can see or dismiss,
// so the run would hang until the suite timeout. It parts from that spec in the half that matters here —
// that one answers a cancelled dialog and pushes an invented outcome on the channel, while this one hands
// back a REAL FILE ON DISK and lets the production upload path chunk it to the real daemon. Nothing about
// the transfer is faked; the only thing standing in for production is the picker.
//
// `skipPermissions` stays at its `true` default (`--dangerously-skip-permissions`), so claude's read of
// the attached file does not block on a permission modal — this spec proves delivery, not the modal.
//
// ⭐ THE ATTACH HAPPENS BEFORE THE CONVERSATION'S FIRST MESSAGE, AND THAT IS A SECOND PROOF (#1205, #1076).
// Until pyrycode#2143 an `attachment_chunk` carried no conversation id and the daemon filed the bytes under
// its follow-active cursor — stamped only by a routed `send_message`, so a never-messaged conversation had
// no destination and the upload was refused with `attachment.storage_failed`. This spec then rode a prior
// "cursor-stamp" turn to get past it, and the operator's own version of the wall was filed as #1076. The
// daemon now REQUIRES the chunk to name its conversation, validates the id against its registry, and
// accepts a known but never-messaged one — the case #1076 is — so the stamp turn is gone and the attach is
// the FIRST thing this conversation does. If the chunk stopped carrying the id, or the daemon stopped
// accepting a childless conversation, the "File attached." assertion below reddens before any turn runs
// (with "The host rejected part of the upload."), which is exactly how the omission was found on
// 2026-09-06: every upload from this client refused, on every branch, after the gate host's daemon was
// rebuilt past #2143. The fake tier cannot see this — it stubs the upload — so this line is the proof.
//
// Current gate state (which real-claude specs pass/fail) lives in the live e2e runbook —
// docs/knowledge/features/live-e2e-runbook.md § Current real-claude gate state. This header stays
// state-free so it never drifts. THE TIER GREW BY ONE: the untracked `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED`
// floor must equal the exact spec count, so it needs bumping when this lands.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, roles and
// counts. Nothing serialises the pairing token, a key or the transcript. The fixture image is 132 bytes
// this file generates from a constant, carries no metadata and is reaped in a `finally`.

// #483/T9 — the stream-json interactive runner, matching production, exactly as the sibling specs.
test.use({ interactiveRunner: 'stream-json' })

// --- The fixture image -------------------------------------------------------
// A 64×64 field of pure #FF0000, as a base64 PNG. Solid rather than pictorial ON PURPOSE: the assertion
// below has to be a word a model reliably reaches for, and "red" is the only honest answer to "what colour
// is this". A photograph would be described a dozen defensible ways and the assertion would be a coin
// toss; a colour field makes the reply's CONTENT the evidence without making the test flaky.
const RED_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4' +
  'FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc' +
  '8OJg6Ln3AAAAAElFTkSuQmCC'
// The name the operator would see. It says nothing about the colour, so a reply that merely echoed the
// filename could not satisfy the assertion below.
const IMAGE_FILENAME = 'attached-swatch.png'
// The word the image's content compels. Case-insensitive and WORD-ANCHORED: "Red", "red." and "The image
// is red" all pass, while the substring form this started as would have accepted `colored`, `considered`,
// `rendered`, `required` and `hundred`. That is not a hypothetical here — the reply this assertion exists
// to REJECT is claude's prose about a missing image, which is exactly the text most likely to contain one
// of those words ("I don't see any image attached… could you re-send it?" answers `considered`/`required`
// on a bad day). The boundary is what makes the header's claim — that the assertion reads the reply's
// CONTENT — actually true. Nothing else in the drive says the bare word: not the prompt, not the filename.
const EXPECTED_COLOUR = /\bred\b/i

// --- Selectors (verbatim from real-claude.spec.ts; `rg META_SELECTOR e2e/` finds the family) ----------
const ASSISTANT_ROW = '[data-thread-role="assistant"]'
const CURSOR_CHAR = '▎'
const META_SELECTOR = '.bubble__meta'
// turn_end appends a turnBoundary that drops the cursor, so its ABSENCE is the per-turn quiesce signal —
// real-claude.spec.ts's idiom, and the gate between the stamp turn and the upload.
const CURSOR_SELECTOR = '.bubble__cursor'

// --- Timeouts ----------------------------------------------------------------
const HANDSHAKE_TIMEOUT_MS = 45_000
// Attach → picker → chunked upload → the daemon's attachment_stored → the composer's terminal line.
const UPLOAD_TIMEOUT_MS = 60_000
// One turn = cold claude (spawn + model load + a tool call that reads the file + the reply). Both turns
// get the same budget: turn 1 pays the cold spawn, turn 2 pays a `Read` of the attachment.
const TURN_TIMEOUT_MS = 180_000
// Handshake + upload + attachment turn + headroom, and it must be set here because the
// config's per-test `timeout` is 300_000 — under the sum below. Generous rather than tight on purpose:
// the happy path is fast (the whole 13-spec tier ran in ~130s), so this bound is only ever paid by a
// hang, where a diagnosis is worth more than an early red.
const SPEC_TIMEOUT_MS = 600_000

/**
 * The assistant rows' text, cursor and meta row stripped, joined. real-claude.spec.ts's
 * `nonEmptyAssistantCount` with the count replaced by the content: this spec has to read what claude
 * SAID, not merely that it said something. The strip is the same and for the same reason — the streaming
 * cursor and #1014's timestamp both live INSIDE the row — and it runs on a detached clone, so the live
 * DOM is untouched.
 *
 * `skip` drops that many leading assistant rows. Unused since #1205 removed the cursor-stamp turn — the
 * attachment turn is now the conversation's first, so there is no prior reply to exclude — and kept so a
 * future drive with a prior turn can keep that reply out of the assertion: a reply that happened to contain
 * the expected word would green this spec with no attachment delivered at all, the precise vacuity the
 * header says the assertion exists to refuse.
 */
function assistantText(page: Page, skip = 0): Promise<string> {
  return page
    .locator(ASSISTANT_ROW)
    .evaluateAll(
      (els, { cursor, meta, skip }) =>
        els
          .slice(skip)
          .map((el) => {
            const content = document.createElement('div')
            content.append(el.cloneNode(true))
            content.querySelectorAll(meta).forEach((node) => node.remove())
            return (content.textContent ?? '').split(cursor).join('')
          })
          .join('\n'),
      { cursor: CURSOR_CHAR, meta: META_SELECTOR, skip }
    )
}

test('an attached image reaches claude, which describes it back (#1055 AC4)', async ({
  relay,
  daemon
}, testInfo) => {
  testInfo.setTimeout(SPEC_TIMEOUT_MS)

  // The picker answers a path, so there must be a real file at it. Its own temp dir, reaped in the
  // `finally` below — never the daemon's workdir, so nothing claude can reach makes this file findable by
  // any route but the attachment the daemon stored.
  const imageDir = await mkdtemp(join(tmpdir(), 'pyry-e2e-attach-'))
  const imagePath = join(imageDir, IMAGE_FILENAME)
  await writeFile(imagePath, Buffer.from(RED_PNG_BASE64, 'base64'))

  try {
    // Driven through `withIsolatedElectronApp` rather than through the `page` fixture, because the stub
    // below needs the ElectronApplication handle and the fixture hands back only the page (#517 lifted
    // this function out for exactly this). One launch, one continuous drive.
    await withIsolatedElectronApp(async ({ page, app }) => {
      const payload = encodePairingPayload({
        server: daemon.pairFields.server,
        // The app dials this verbatim; NOT pyry's emitted relay, which points at prod.
        relay: `${relay.url}/v1/client`,
        token: daemon.pairFields.token,
        server_static_pubkey: daemon.pairFields.server_static_pubkey
      })

      const conversation = page.locator('.conversation')
      const sendButton = page.getByRole('button', { name: 'Send' })
      const composer = page.getByPlaceholder('Message…')
      const attach = page.getByRole('button', { name: COMPOSER_ATTACH_LABEL, exact: true })
      const outcome = page.locator('.composer__attach-outcome')

      await pairFromUnpairedLaunch(page, payload)

      // --- Create the conversation THROUGH THE UI (#448's rule) — the attachment is stored under the
      // conversation the send names, so the send must name a real daemon-minted id. ---
      await expect(page.locator('.channel-list__row-open')).toBeVisible({
        timeout: HANDSHAKE_TIMEOUT_MS
      })
      await page.getByRole('button', { name: 'New discussion' }).click()
      await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
      await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

      // --- No message has been sent on this conversation, and none will be before the attach (see the
      // header): the thread is empty, which is what makes the upload below #1076's case as well as
      // #1055's. Asserted rather than assumed, so a fixture change that seeds a turn cannot quietly turn
      // this back into the stamp-turn drive. ---
      await expect(page.locator(ASSISTANT_ROW)).toHaveCount(0)

      // --- The picker answers with the real file. `defineProperty` rather than assignment: it succeeds
      // against a data property and an accessor alike, and the app reads `dialog.showOpenDialog` at call
      // time, so the patched property is what it reaches. ---
      await app.evaluate(({ dialog }, path) => {
        Object.defineProperty(dialog, 'showOpenDialog', {
          value: () => Promise.resolve({ canceled: false, filePaths: [path] }),
          configurable: true,
          writable: true
        })
      }, imagePath)

      // --- The REAL upload, to a conversation that has never had a turn: production chunks the file to
      // the real daemon, naming this conversation on every chunk, and the composer states the terminal
      // the daemon's `attachment_stored` produced. A refusal here reads "The host rejected part of the
      // upload." and means the chunk named no conversation the daemon knows (#1205). The expected
      // sentence is DERIVED by calling the production copy module, never typed out here. ---
      await attach.click()
      await expect(outcome).toHaveText(
        attachmentUploadOutcomeCopy({
          type: 'completed',
          uploadId: 'unread-by-the-copy',
          filename: IMAGE_FILENAME
        }),
        { timeout: UPLOAD_TIMEOUT_MS }
      )

      // --- The send under test. The prompt names no colour and the filename carries none, so the only
      // way the word below can appear in the reply is if claude opened the file the daemon stored. ---
      await composer.fill(
        'Look at the image attached to this message and reply with its dominant colour as a single word.'
      )
      await sendButton.click()

      await expect
        .poll(() => assistantText(page), {
          timeout: TURN_TIMEOUT_MS,
          message:
            'claude never named the attached image colour: either no attachment_ids rode the send_message frame, or the daemon did not name the stored path in the prompt'
        })
        .toMatch(EXPECTED_COLOUR)
    })
  } finally {
    // Best-effort, the harness's teardown discipline: a throwing cleanup would REPLACE the causal error.
    // The target is always the value `mkdtemp` just returned, so this is never an arbitrary delete.
    await rm(imageDir, { recursive: true, force: true }).catch(() => undefined)
  }
})
