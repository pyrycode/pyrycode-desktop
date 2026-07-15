import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  Envelope,
  ModalAnswerPayload,
  ModalCancelPayload,
  ModalDismissedPayload,
  ModalShownPayload,
  WireModalOption
} from '../src/shared/wire/types'

// Fake-stack UI e2e for the PERMISSION/TRUST MODAL's five answer paths (#426, split-lineage from #421
// via #433/#434): default one-tap, non-default second-confirm, cancel, remote dismiss, and reject —
// none covered end-to-end today (only the unit tests interactiveRoundtrip / PermissionModal /
// modalResolution touch them). It drives the already-shipped stack (decode #201, answerable dialog
// #224/#237, confirm sub-step #226, outbound modal_answer/modal_cancel #236, rejection banner
// #248/#249, modal_dismissed clear #122/#201) through renderer → IPC → main → Noise wire → decode →
// the spec-local capturing reply factory on the launchPairedApp fixture (#433). Zero production code.
//
// The modal is NOT interactive-gated (unlike run-config's controls): PermissionModal is mounted
// unconditionally on the conversation surface and renders whenever modalStore.outstanding[0] exists,
// driven purely by a pushed modal_shown — so no un-inert step is needed. Each prompt is surfaced via
// daemon.pushFrame after launch (the server-push hook run-config-settings.spec.ts #425 uses).
//
// TWO test() blocks (the #423 one-way-per-launch precedent), split by the FIFO reject subtlety, NOT by
// convenience. The reject is FIFO BY SEND ORDER, not in_reply_to: a daemon `error` with no in_reply_to
// falls through the settings/folder correlation to outstandingAnswers.shift() (daemonConnection.ts
// :530-540), which dequeues the OLDEST outstanding answer. outstandingAnswers is pushed only by an
// answer (:1339), drained by a matching modal_dismissed (:788) or an error, and reset per dial()
// (:1408). So block 1 (answer/confirm/cancel/dismiss) NEVER pushes an error → its answer residue is
// inert; block 2 (reject) takes a FRESH launch → empty queue → the one answer is the sole outstanding
// entry the reject dequeues, keeping the correlation precise without ordering tricks.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM text / roles / counts
// and captured wire frames only; modal_id / option_id / title / prompt are non-secret routing & display
// literals; answer_token is asserted present-but-opaque, never pinned or logged. No failure diagnostic
// serialises a token, key, or plaintext; the pairing plumbing lives in launchPairedApp, never echoed.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process, so a short headroom
// over Playwright's 5s default suffices for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes
// replies by envelope id, so one fixed REPLY_ENVELOPE_ID is reused across every reply.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The daemon option list every prompt carries. `deny` is the fail-safe default (one-tap straight
// through), `allow` the deliberate move-away (held pending a second confirm). Their labels are
// mutually non-substring so a scoped getByRole('button', { name }) is unambiguous. Non-secret display
// text. Array order IS selection order (ModalShownPayload.options is ORDERED).
const OPTIONS: WireModalOption[] = [
  { id: 'deny', label: 'Deny' },
  { id: 'allow', label: 'Allow' }
]

// The copy the rejection banner renders (RejectionSurfaceView REJECTION_COPY) — a client-owned category
// constant, never daemon text (the banner is content-free: no modal_id/code/message reaches the DOM).
const REJECTION_COPY = 'Your answer was rejected.'

// Spec-local frame builders (the conversationsFrame idiom): each seals one envelope via the production
// codec, deterministic id/ts.

// A permission modal_shown, surfaced via daemon.pushFrame. All six fields always present (no omitempty);
// class 'permission' is a shipped WireModalClass. `default_option_id` is the fail-safe deny default.
function modalShownFrame(
  modalId: string,
  opts: { title: string; prompt: string; options: WireModalOption[]; defaultOptionId: string }
): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'modal_shown',
    ts: FIXED_TS,
    payload: {
      modal_id: modalId,
      class: 'permission',
      title: opts.title,
      prompt: opts.prompt,
      options: opts.options,
      default_option_id: opts.defaultOptionId
    } satisfies ModalShownPayload
  })
}

// A remote modal_dismissed (AC6): clears the outstanding prompt by modal_id. `outcome` is opaque and
// never consulted by the reduce (only modal_id drives the clear); `source` is a WireModalSource.
function modalDismissedFrame(modalId: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'modal_dismissed',
    ts: FIXED_TS,
    payload: { modal_id: modalId, outcome: 'remote', source: 'remote' } satisfies ModalDismissedPayload
  })
}

// The reject (AC5): a BARE, content-free `error`. No in_reply_to — because the modal reject correlates by
// FIFO (not in_reply_to), an error with no in_reply_to short-circuits the settings/folder checks and
// falls straight to outstandingAnswers.shift(). decodeEnvelope requires a PRESENT payload, so `{}`.
function modalErrorFrame(): Uint8Array {
  return encodeEnvelope({ id: REPLY_ENVELOPE_ID, type: 'error', ts: FIXED_TS, payload: {} })
}

/**
 * The spec-local capturing reply factory (the #456 capturingWorkspaceFake shape). The fake daemon runs
 * in the TEST process (via the loopback forwarder), so a spec-held `captured` array written here is
 * directly readable from the test body. Per inbound verb: reuse seedConversationsFrame() so the launch
 * row renders; answer modal_answer with the reject error only when `rejectAnswers` (block 2), else a
 * no-op (the prompt already cleared optimistically, #237); every other inbound no-ops ([]) — harmless.
 * The payload cast is on the app's OWN trusted outbound (the fixture posture); the double-decode
 * (capture + discriminate) is pure and harmless, exactly as run-config's factory does.
 */
function capturingModalFake(
  captured: Envelope[],
  opts: { rejectAnswers: boolean }
): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    switch (env.type) {
      case 'list_conversations':
        return [seedConversationsFrame()]
      case 'modal_answer':
        return opts.rejectAnswers ? [modalErrorFrame()] : []
      default:
        return []
    }
  }
}

// Count captured modal_answer frames matching a modal_id + option_id, with a present non-empty
// answer_token. The token is main-minted (crypto.randomUUID) and non-deterministic, so it is asserted
// PRESENT-BUT-OPAQUE — never pinned (unlike run-config's whole-payload deep-equal).
function answersFor(captured: Envelope[], modalId: string, optionId: string): number {
  return captured.filter(
    (e) =>
      e.type === 'modal_answer' &&
      (e.payload as ModalAnswerPayload).modal_id === modalId &&
      (e.payload as ModalAnswerPayload).option_id === optionId &&
      typeof (e.payload as ModalAnswerPayload).answer_token === 'string' &&
      (e.payload as ModalAnswerPayload).answer_token.length > 0
  ).length
}

// Count captured modal_cancel frames for a modal_id (AC4). modal_id is the sole correlation key.
function cancelsFor(captured: Envelope[], modalId: string): number {
  return captured.filter(
    (e) => e.type === 'modal_cancel' && (e.payload as ModalCancelPayload).modal_id === modalId
  ).length
}

// Count ANY outbound resolution frame (answer or cancel) for a modal_id (AC6's guaranteed-absence
// guard): E's controls are never clicked, so no frame is ever sent for it.
function resolutionsFor(captured: Envelope[], modalId: string): number {
  return captured.filter(
    (e) =>
      (e.type === 'modal_answer' && (e.payload as ModalAnswerPayload).modal_id === modalId) ||
      (e.type === 'modal_cancel' && (e.payload as ModalCancelPayload).modal_id === modalId)
  ).length
}

test('permission modal: answer / confirm / cancel / remote-dismiss paths clear the prompt and hit the wire', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: capturingModalFake(captured, { rejectAnswers: false })
  })

  // The prompt renders one dialog for outstanding[0]; only one dialog exists at a time (single-dialog
  // FIFO), so scope the option / Cancel / Back / Confirm buttons inside it. Labels are distinct and
  // mutually non-substring, so a scoped getByRole is unambiguous across list and confirm modes.
  const dialog = page.getByRole('dialog')
  const optionButton = (name: string) => dialog.getByRole('button', { name })

  // AC2 — default option, one tap. Push prompt A (default 'deny'). Tapping the default routes straight
  // through answerPrompt (no confirm), so exactly one modal_answer for A rides the wire and the prompt
  // clears optimistically. The captured frame (modal_id + option_id + a present opaque answer_token) is
  // the contract; the DOM clear is the user-visible half.
  const A = 'modal-a-default-tap'
  daemon.pushFrame(
    modalShownFrame(A, {
      title: 'Permission A',
      prompt: 'Allow reading the file?',
      options: OPTIONS,
      defaultOptionId: 'deny'
    })
  )
  await expect(dialog).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(dialog).toContainText('Permission A')
  await optionButton('Deny').click()
  await expect.poll(() => answersFor(captured, A, 'deny'), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  await expect(dialog).toHaveCount(0)

  // AC3 — non-default option → second-confirm step; Back vs Confirm. Push prompt B. Tapping the
  // non-default 'allow' opens the confirm sub-step (Confirm/Back, no daemon options) and sends NOTHING.
  // Back returns to the option list (Allow visible again) — still nothing sent. Re-select → Confirm
  // sends exactly one modal_answer for B. The "exactly one" IS the negative-guard: had Back wrongly
  // sent a frame the count would be 2.
  const B = 'modal-b-confirm'
  daemon.pushFrame(
    modalShownFrame(B, {
      title: 'Permission B',
      prompt: 'Allow running the command?',
      options: OPTIONS,
      defaultOptionId: 'deny'
    })
  )
  await expect(dialog).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(dialog).toContainText('Permission B')
  await optionButton('Allow').click()
  await expect(optionButton('Confirm')).toBeVisible()
  await expect(optionButton('Back')).toBeVisible()
  await expect(optionButton('Allow')).toHaveCount(0) // left list mode — no option buttons in confirm mode
  await optionButton('Back').click()
  await expect(optionButton('Allow')).toBeVisible() // back to the option list
  await expect(optionButton('Confirm')).toHaveCount(0)
  await optionButton('Allow').click()
  await optionButton('Confirm').click()
  await expect.poll(() => answersFor(captured, B, 'allow'), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  await expect(dialog).toHaveCount(0)

  // AC4 — cancel. Push prompt C. Tapping the leading Cancel sends exactly one modal_cancel for C and
  // clears the prompt optimistically. No modal_answer is sent.
  const C = 'modal-c-cancel'
  daemon.pushFrame(
    modalShownFrame(C, {
      title: 'Permission C',
      prompt: 'Trust this workspace?',
      options: OPTIONS,
      defaultOptionId: 'deny'
    })
  )
  await expect(dialog).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(dialog).toContainText('Permission C')
  await optionButton('Cancel').click()
  await expect.poll(() => cancelsFor(captured, C), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  await expect(dialog).toHaveCount(0)

  // AC6 — remote dismiss. Push prompt E, assert it renders, then push a modal_dismissed for E; the
  // outstanding prompt clears with NO local action. E's controls are never clicked, so no
  // modal_answer/modal_cancel is ever sent for it (guaranteed absence).
  const E = 'modal-e-remote-dismiss'
  daemon.pushFrame(
    modalShownFrame(E, {
      title: 'Permission E',
      prompt: 'Allow network access?',
      options: OPTIONS,
      defaultOptionId: 'deny'
    })
  )
  await expect(dialog).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(dialog).toContainText('Permission E')
  daemon.pushFrame(modalDismissedFrame(E))
  await expect(dialog).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  expect(resolutionsFor(captured, E)).toBe(0)
})

test('permission modal: a rejected answer surfaces a dismissible banner', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  // Fresh launch → a fresh dial() → EMPTY outstandingAnswers, so the one answer sent is the sole
  // outstanding entry and the bare error dequeues exactly it (precise reject correlation, no ordering
  // tricks — see the module note).
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: capturingModalFake(captured, { rejectAnswers: true })
  })

  const dialog = page.getByRole('dialog')
  const optionButton = (name: string) => dialog.getByRole('button', { name })
  // The rejection banner renders OUTSIDE the dialog (it shows with no outstanding prompt), so locate it
  // on the page. role="alert" is a live region — the banner announces the failure on arrival.
  const banner = page.getByRole('alert')

  // AC5 — reject. Push prompt D, tap the default 'deny' (one-tap). The answer rides the wire; the fake
  // returns the bare error, which the main side correlates by FIFO to D and emits modalAnswerRejected →
  // the banner renders. The answer path already cleared the prompt optimistically (#237), so the banner
  // is the only surface telling the user the answer did not land.
  const D = 'modal-d-reject'
  daemon.pushFrame(
    modalShownFrame(D, {
      title: 'Permission D',
      prompt: 'Allow deleting the file?',
      options: OPTIONS,
      defaultOptionId: 'deny'
    })
  )
  await expect(dialog).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(dialog).toContainText('Permission D')
  await optionButton('Deny').click()
  await expect.poll(() => answersFor(captured, D, 'deny'), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)

  // The banner is content-free (no modal_id on the DOM), so this is DOM-only: role="alert" present with
  // the client-owned copy. It cannot and must not assert WHICH modal_id it corresponds to.
  await expect(banner).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(banner).toContainText(REJECTION_COPY)

  // Dismiss clears it (the local rejectionDismissed dispatch). The Dismiss button is outside the dialog.
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(banner).toHaveCount(0)
})
