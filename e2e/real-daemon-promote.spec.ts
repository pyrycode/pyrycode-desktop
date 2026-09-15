import type { Page } from '@playwright/test'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// The credential-light real-daemon tier (#439) driving the MARQUEE case — SAVE-AS-CHANNEL promote
// (`promote_conversation`) — against a REAL spawned `pyry` on #251's content-blind routing relay, gating on
// the `pyry` binary ALONE (no `claude`, no Anthropic credential). This is the real-daemon twin of the merged
// fake-stack spec #423 (`save-as-channel-promote.spec.ts`), keeping only its SCRATCH branch and swapping the
// in-process `conversationStateFake` for the #439 realDaemon fixture. It exists to catch the exact contract
// gap this tier was built for — pyrycode/pyrycode#949: the daemon defined the `promote_conversation` type +
// payload + registry op but registered NO handler, so save-as-channel answered `unsupported` on the real wire
// while the whole fake-daemon suite stayed green, because a fake answers anything. #949 shipped the handler
// (Option B: flips `is_promoted` + `name`, ignores the payload `cwd`, replies `conversation_updated
// { is_promoted: true }` correlated). This spec pins that fix so the gap can never regress silently. Zero
// production code, no fixture change.
//
// This spec captures NO outbound wire frame (unlike the fake twin): the daemon is a SEPARATE process behind
// the content-blind relay, so the fake twin's in-process capture (`promoteFake`, the codec import) is
// unavailable here. Every assertion reads DOM text / visibility / counts only.
//
// SCOPE: the single remaining branch. #1436 withdrew the folder choice, so Save as channel has exactly one
// arm: promote the chat in its own workspace. It sends `promote_conversation` ALONE, which is what isolates
// the #949 gap cleanly — one verb, so a failure can only be attributed to the promote handler. (Until #1436
// this spec deliberately picked that arm out of two and explained at length why it skipped the dedicated
// one; there is no longer a choice to make.) `create_workspace_folder` remains real-wire-proven by sibling
// #441, through the workspace picker's own create-folder dialog.
//
// WHY IT IS PROVABLE ON THIS TIER. The claude-less real-daemon tier has one observable — the DOM. A verb is
// provable here only if its daemon reply gates a VISIBLE DOM transition with NO optimistic pre-render. The
// `onSave` arm of `SaveAsChannelDialog` dispatches `promote_conversation` and closes the
// dialog — it NEVER touches the list store. The seeded row moves "Chats" → "Channels" ONLY after
// the daemon's reply drives the re-list:
//     promote_conversation → daemon conversation_updated { is_promoted: true }
//       → daemonConnection decodes conversationUpdated → conversationListBridge.shouldRefreshList = true
//       → re-list_conversations → partitionByPromotion re-buckets by is_promoted → it renders under "Channels"
// Nothing moves the row optimistically. On a PRE-#949 binary the daemon answers `unsupported`: no
// `conversation_updated` fires, no re-list happens, the row stays in "Chats", and the assertion
// TIMES OUT. That timeout IS the intended loud regression signal — never something to paper over with a
// longer timeout or a softened assertion. (This is the same conversation_updated → re-list path #440's
// archive/restore already live-passed against the real daemon.)
//
// REAL-DAEMON DIVERGENCES from the fake twin #423 (the only deltas):
//   - Fixture: `test.use({ spawnClaude:false, seedPromoted:false })` + the explicit pairing drive (from the
//     sibling real-daemon-* specs) instead of `launchPairedApp`; the single seed is a non-promoted "Recent
//     discussion" carrying `.channel-list__save`.
//   - Starting screen: the real-daemon path lands on `route='list'` post-pairing (PairedShell), NOT inside a
//     thread — so a `.channel-list__save` readiness gate under HANDSHAKE_TIMEOUT_MS stands in for the fake
//     twin's land-in-thread + opening back-nav. Save-as-channel lives on the LIST row (not thread-scoped),
//     so it is reached directly — NO `.channel-list__row-open`, no thread open.
//   - Machinery dropped: the `promoteFake` / `decodeEnvelope` / `encodeEnvelope` codec machinery is gone (the
//     real daemon answers `promote_conversation` itself), and so is the fake twin's `getByText('<name>')`
//     title check — the name-less "Untitled" seed is neither unique nor meaningful, and `partitionByPromotion`
//     keys on `is_promoted` (title-independent), so the two mutually-exclusive headers are the sound proxy.
//
// NAME WRINKLE (do not skip). The realDaemon fixture seeds a NAME-LESS conversation (renders "Untitled").
// `SaveAsChannelDialog` seeds its Name field from `titleFor(row.name) = "Untitled"` (non-blank), so Save is
// ENABLED and the scratch promote sends `name: "Untitled"` with NO typing. The #949 handler accepts it
// (non-empty, and it is the sole conversation so the promoted-name-uniqueness check passes). Do NOT assume a
// pre-named seed, and do NOT type into the Name field.
//
// SECRET HYGIENE (AC5): every assertion reads DOM text / visibility / counts only; the promoted `name`
// ("Untitled") is a non-secret display literal; the pairing payload is built the same way as the sibling
// real-daemon-* specs and never echoed into a message. No failure diagnostic serialises the token, keys, or a
// transcript.

test.use({ spawnClaude: false, seedPromoted: false })

// --- Timeouts (mirror real-daemon-conversation-lifecycle.spec.ts) ------------
// Generous to absorb real daemon startup latency (registration on /v1/server is async after spawn) plus a
// handshake re-dial or two — used only on the readiness gate.
const HANDSHAKE_TIMEOUT_MS = 45_000
// The promote real-wire round-trip: promote_conversation → conversation_updated → re-list → re-render,
// traversing renderer → preload → main → Noise → relay → real daemon and back. AC3: at least as generous as
// the sibling real-daemon specs' value, NOT Playwright's 5s default.
const ROUNDTRIP_TIMEOUT_MS = 15_000
// Whole spec: handshake + one round-trip + dialog open + headroom. Well under the config's 300s default.
const SPEC_TIMEOUT_MS = 120_000

// The section proxy, re-based in #1070 and still a clone of the fake twin's (#423). Both specs proved
// "the row moved sections" on two mutually exclusive section headers, which rested on a zero-row section
// rendering no header; #1070 renders both headers whenever any machine is paired, so that proxy would
// have stayed green while detecting nothing. The row's OWN affordance replaces it — the two are disjoint
// by section by construction in `ChannelList`'s `Row` (a Recent row gets Save-as-channel and no Rename
// control; a promoted one gets Rename and no Save) and criterion 2 leaves them untouched. The fake twin's
// header carries the full reasoning.
//
// It is if anything a better fit HERE than the headers were: this tier's single observable is the DOM,
// and the affordance is on the row whose promotion is the claim, rather than on chrome above it.
const renameControl = (page: Page) => page.locator('.channel-list__rename')
const saveControl = (page: Page) => page.locator('.channel-list__save')

test('real daemon promotes a Recent discussion into a Channel over the real wire', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // --- Pair against the real daemon, dial the test relay's /v1/client leg (real-daemon-* siblings). ---
  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    // The app dials this verbatim; NOT pyry's emitted relay (which points at prod). The loopback affordance
    // (#97) accepts the ws://127.0.0.1 relay.
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  await pairFromUnpairedLaunch(page, payload)

  // --- Readiness gate: the non-promoted seed's "save as channel" affordance renders ONLY after the whole
  // chain — handshake complete → session `connected` → the auto-fired `list_conversations` returned the
  // seeded discussion → it rendered in the "Chats" section. The real-daemon path lands on
  // `route='list'` (no opening thread), and Save-as-channel lives on the list row, so this gate reaches the
  // affordance directly — no thread open needed. ---
  await expect(saveControl(page)).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Baseline (mirrors #423): the seed starts as a Recent row, carrying Save-as-channel and NO Rename
  // control, so the post-Save assertion proves a TRANSITION and not a pre-existing state. ---
  await expect(renameControl(page)).toHaveCount(0)

  // --- Open the Save-as-channel dialog from the Recent row's affordance (AC1). Exactly one non-promoted row
  // (one seed) → the locator resolves uniquely. The click mounts SaveAsChannelDialog with the clicked list
  // row (setSaveRow(row)); its Name field auto-seeds to titleFor(null) = "Untitled" (non-blank → Save
  // enabled — the Name wrinkle above). No activeConversation, no thread-open is needed. ---
  await saveControl(page).click()
  await expect(page.getByRole('dialog', { name: 'Save as channel', exact: true })).toBeVisible()

  // --- Save (AC2). Since #1436 the modal is the name field and the actions, with no location choice to
  // make, so OK fires promote_conversation { conversation_id, name: "Untitled", cwd: seedCwd } ALONE and
  // synchronously closes the dialog (onPromoted) — NO round-trip store, NO optimistic list mutation. ---
  await expect(page.getByRole('radio')).toHaveCount(0)
  await page.getByRole('button', { name: 'OK', exact: true }).click()

  // --- Assert the reply-gated promotion (AC3). The row moves Chats → Channels ONLY after the daemon's
  // conversation_updated drives the re-list, and the row's affordance flips with it: the Rename control
  // appears, the Save one goes. The POSITIVE read is ordered first and carries the round-trip headroom —
  // a closing `toHaveCount(0)` alone would pass against the pre-promote render. A pre-#949 binary answers
  // `unsupported`, no re-list fires, the row stays put, and the Rename control never appears → this TIMES
  // OUT (the intended #949-class regression signal). ---
  await expect(renameControl(page)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(saveControl(page)).toHaveCount(0)
})
