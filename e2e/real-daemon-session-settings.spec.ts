import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// #481 — the missing half of #442. `set_session_settings` (model / effort / YOLO from the run-config
// sheet) shipped with no real-wire test: #442 scoped "run-controls over the real wire" but closed with
// only the dequeue half landed. Every existing spec covering this sheet talks to a fake daemon, which
// answers anything — the exact #949 shape, where the daemon defined a type and payload but registered
// NO handler, the real wire answered `unsupported`, and the whole client suite stayed green.
//
// This is the claude-less tier (`spawnClaude: false`) that #481 asked for, and it can be: the write is
// a pure session-pool mutation and the read is three primitive seam reads, so neither half needs a
// claude child. That makes this cheap enough to sit in the everyday gate rather than the credentialed
// one.
//
// #987 — WHAT THIS SPEC MAY EXERCISE SHRANK, AND ONLY YOLO IS LEFT. It used to drive the Model rows,
// which rendered from a client-side catalog and so needed no daemon frame at all. #975 deleted that
// catalog: the rows are now exactly the entries of the daemon's published `model_list` frame, which
// the daemon emits from claude's OWN announcement. #976 then made the Effort segments read the same
// published rows, so with NO FRAME AT ALL the section renders an inert current-effort line and offers no
// segment (the state `e2e/run-config-settings.spec.ts` pins at the fake tier). Claude-less there is no
// announcement, so no `model_list` frame, so neither control can ever appear here — this spec was red on
// main from PR #982 until this rewrite, failing at the first sheet read while parking every other spec
// in the all-or-nothing gate.
//
// #1168 NARROWED THAT REASON WITHOUT CHANGING THIS SPEC'S PREMISE. An empty session model now resolves
// the row the daemon publishes for its inherited default (`effortRowFor`), so *no row matched* is no
// longer the reason this section stays inert here — *no frame received* is, and that is the state this
// claude-less tier is permanently in. Nothing to add: this spec receives no `model_list` frame, so it
// cannot reach the new branch's populated arm at all.
//
// `YoloSection` is the one control that takes no published rows: a role="switch" whose write path
// (`UpdateSettings`, a persisted session-pool mutation) and read path (`cfg.YOLO`) both answer with no
// claude child. Re-keying onto it keeps `set_session_settings` covered against the real wire — same
// handler, same reply correlation — and DROPS real-wire coverage of the model-specific `validModel`
// leg. That loss is accepted and deliberate: restoring it needs a claude-spawning spec, which is a
// different tier and a different ticket. Do not add one here.
//
// WHAT MAKES IT A LIVENESS TEST rather than a render test, and this is the objection the tier's own
// overview raises against this very spec. #442 was demoted without shipping because
// set-session-settings "never touches the DOM, optimistic-first" — and half of that is still true:
// `runSettingsWriteStore` composes pending overlay > client-confirmed override > snapshot base, so
// `aria-checked` flips the instant the switch is clicked, before any daemon byte. What answers the
// objection is #558, which put `aria-busy` on the switch ELEMENT: the pending marker that raises it is
// deleted only by a correlated reply. So the reply does gate a DOM transition — it just gates the
// SETTLING, never the value. Neither attribute alone is a liveness assertion, and the write below is
// therefore asserted as a three-step sequence: the value flips, then the busy flag clears, then the
// value is RE-READ still holding. A reject clears busy and rolls the value back; a reconnect
// (`reconnected` drops pending markers without committing) does the same; a daemon that answers
// nothing never clears busy at all. Only a confirm survives all three steps.
//
// SECRET HYGIENE: every assertion reads DOM attributes, visibility, or counts. The pairing payload is
// built the same way as the sibling specs and is never echoed into a message or a failure diagnostic.

test.use({ spawnClaude: false, seedPromoted: true })

const HANDSHAKE_TIMEOUT_MS = 45_000
// A session-settings write plus its reply-gated re-render. No claude turn to absorb, so this is tight
// on purpose — a timeout here means the daemon did not answer, which is the signal.
const ROUNDTRIP_TIMEOUT_MS = 15_000
const SPEC_TIMEOUT_MS = 120_000

test('real daemon persists a session-settings write and returns it on a fresh read', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  await pairFromUnpairedLaunch(page, payload)

  // The seeded promoted row rendering IS the connected gate (the launchPairedApp idiom): it appears
  // only once the handshake completed and the auto-fired list_conversations reply came back.
  const seededRow = page.locator('.channel-list__row-open')
  await expect(seededRow).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await seededRow.click()

  const conversation = page.locator('.conversation')
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Open the sheet. The switch locator mirrors run-config-settings.spec.ts so the two specs stay
  // readable side by side; unlike the retired model rows it is unique, so it needs no narrowing.
  //
  // Opening is a HELPER rather than an inlined click because this spec opens the sheet TWICE and the
  // second open is load-bearing (see the read below), so both must go through one definition. #962
  // retired the collapsed status row this used to click, so opening is now the two-step overflow path
  // (the conversation-create-rename.spec.ts idiom); routing both opens through one body is what made
  // that a two-line swap here rather than a conflict at each call site.
  const openRunConfiguration = async (): Promise<void> => {
    await page.locator('.conversation__overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Run configuration' }).click()
  }
  const yoloSwitch = page.getByRole('switch', { name: 'Auto-accept tool calls' })

  await openRunConfiguration()

  // OPERABILITY IS ALSO THE READ-ARRIVAL PROOF, and it is why the initial value is read after it
  // rather than before. `RunConfigSections` withholds `onChange` — and so `YoloSection`'s onToggle —
  // until `isAddressableSessionId`, rendering aria-readonly until then. Claude-less, the session id
  // has exactly ONE ingress: the `session_settings` reply itself, through runConfigSnapshot. So this
  // clearing is proof the daemon answered the read, and every click below lands on a live handler.
  await expect(yoloSwitch).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(yoloSwitch).not.toHaveAttribute('aria-readonly', 'true', {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })

  // Read the observed baseline rather than assuming one. `seedRegistry` writes a session with no
  // settings object, so the initial posture is the daemon's own default, not the harness's choice —
  // and `YoloSection` submits `!yolo`, so the value to expect is the negation of whatever is rendered.
  const initialYolo = await yoloSwitch.getAttribute('aria-checked')
  expect(initialYolo).toMatch(/^(true|false)$/)
  const writtenYolo = initialYolo === 'true' ? 'false' : 'true'

  // --- The write, in the three steps the header argues for. Step 1 is the optimistic overlay, which
  // the store raises in the SAME dispatch as the pending marker, so reaching it also establishes the
  // busy flag unless the reply has already landed.
  await yoloSwitch.click()
  await expect(yoloSwitch).toHaveAttribute('aria-checked', writtenYolo, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })

  // Step 2 — the change SETTLES. Only a correlated reply (or a reconnect) deletes the pending marker,
  // so a daemon that loses the write, or has no handler for it, times out right here rather than
  // passing on the overlay.
  await expect(yoloSwitch).not.toHaveAttribute('aria-busy', 'true', {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })

  // Step 3 — and it is STILL HOLDING the written value. A rejection also clears the busy flag, but
  // rolls the overlay back to the prior value and raises the sheet's role="alert" line; so does a
  // reconnect, silently. Settled AND unchanged is what distinguishes a confirm from both.
  //
  // These two assertions are deliberately a SEQUENCE and not one composed poll: two getAttribute
  // reads inside a single poll are not atomic, and a rejection interleaving between them would pair a
  // stale flipped value with an already-cleared busy flag and pass the spec this exists to fail.
  await expect(yoloSwitch).toHaveAttribute('aria-checked', writtenYolo)
  await expect(page.locator('.run-config__error')).toHaveCount(0)

  // --- The read, on a fresh sheet. Closing unmounts the run-config container, so reopening fires a
  // new `request_session_settings` from RunConfigData's per-instance one-shot ref.
  //
  // The unmount witness is the YOLO row, which renders unconditionally inside the sheet — #441's
  // lesson that a real-daemon "closed" assertion must target an element whose presence does not
  // depend on the round-trip under test. (The retired model-row count this replaces would now pass
  // vacuously either way, since with no published list that count is 0 whether the sheet is open or
  // shut. The class literal itself is deliberately absent from this file — AC4 is grep-checkable.)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.run-config__yolo')).toHaveCount(0)

  await openRunConfiguration()
  await expect(yoloSwitch).toHaveAttribute('aria-checked', writtenYolo, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })

  // WHAT THE REOPEN PROVES, stated deliberately weaker than the sentence it replaces. `confirmed` is
  // an app-level per-field override that OUTLIVES the sheet unmount, so the reopened switch reads
  // `confirmed.yolo ?? snapshot.yolo` and the two agree whenever the daemon really persisted — the
  // reopened value is therefore not provably snapshot-sourced. This spec used to claim the reopened
  // mark "can only come from the daemon's reply, not from state the previous open left behind"; that
  // was already untrue of `confirmed` before #987 and is not carried forward. The remount and the
  // fresh request are what this half proves; the daemon-required half of the proof is the write
  // sequence above, where the settle cannot happen without a reply.
})
