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
// SCOPE: SCRATCH branch only — the dedicated ("Move to dedicated channel folder") branch is dropped. The
// dedicated branch first sends `create_workspace_folder`, already real-wire-proven by sibling #441, and under
// #949's Option B the daemon IGNORES the promote payload `cwd` — so the dedicated leg's "promote with the
// daemon-returned path" contract has NO real-wire DOM surface here (its correctness is a client concern
// covered by the fake twin #423). The dedicated branch would also couple two verbs (a failure could not be
// attributed to the promote handler) and cost a second ~180s claude-less launch for redundant coverage.
// Scratch sends `promote_conversation` ALONE, isolating the #949 gap cleanly.
//
// WHY IT IS PROVABLE ON THIS TIER. The claude-less real-daemon tier has one observable — the DOM. A verb is
// provable here only if its daemon reply gates a VISIBLE DOM transition with NO optimistic pre-render. The
// scratch `onSave` arm (SaveAsChannelDialog.tsx:287-295) dispatches `promote_conversation` and closes the
// dialog — it NEVER touches the list store. The seeded row moves "Recent discussions" → "Channels" ONLY after
// the daemon's reply drives the re-list:
//     promote_conversation → daemon conversation_updated { is_promoted: true }
//       → daemonConnection decodes conversationUpdated → conversationListBridge.shouldRefreshList = true
//       → re-list_conversations → partitionByPromotion re-buckets by is_promoted → it renders under "Channels"
// Nothing moves the row optimistically. On a PRE-#949 binary the daemon answers `unsupported`: no
// `conversation_updated` fires, no re-list happens, the row stays in "Recent discussions", and the assertion
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

// The two mutually-exclusive section-header proxies (cloned from #423). With exactly one seeded row, a
// non-promoted row renders ONLY the "Recent discussions" header and a promoted row renders ONLY the "Channels"
// header (a zero-row section renders no header — ChannelList.tsx). So "Channels appears AND Recent disappears"
// fully captures "the row promoted in place." `hasText` is a substring match, but "Recent discussions" does
// not contain "Channels" (nor vice versa), so each locator resolves only its own header.
const channelsHeader = (page: Page) =>
  page.locator('.channel-list__section-header', { hasText: 'Channels' })
const recentHeader = (page: Page) =>
  page.locator('.channel-list__section-header', { hasText: 'Recent discussions' })

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
  // seeded discussion → it rendered in the "Recent discussions" section. The real-daemon path lands on
  // `route='list'` (no opening thread), and Save-as-channel lives on the list row, so this gate reaches the
  // affordance directly — no thread open needed. ---
  await expect(page.locator('.channel-list__save')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Baseline (mirrors #423): the seed starts under "Recent discussions" with NO "Channels" section, so
  // the post-Save assertion proves a TRANSITION, not a pre-existing state. ---
  await expect(recentHeader(page)).toBeVisible()
  await expect(channelsHeader(page)).toHaveCount(0)

  // --- Open the Save-as-channel dialog from the Recent row's affordance (AC1). Exactly one non-promoted row
  // (one seed) → the locator resolves uniquely. The click mounts SaveAsChannelDialog with the clicked list
  // row (setSaveRow(row)); its Name field auto-seeds to titleFor(null) = "Untitled" (non-blank → Save
  // enabled — the Name wrinkle above). No activeConversation, no thread-open is needed. ---
  await page.locator('.channel-list__save').click()
  await expect(page.locator('.save-as-channel')).toBeVisible()

  // --- Choose scratch + Save (AC2). The default is `dedicated`; the two radios share `.save-as-channel__radio`
  // so target "Keep in scratch" by accessible name. The scratch arm fires promote_conversation
  // { conversation_id, name: "Untitled", cwd: seedCwd } ALONE and synchronously closes the dialog (onPromoted)
  // — NO round-trip store, NO optimistic list mutation. ---
  await page.getByRole('radio', { name: 'Keep in scratch' }).check()
  await page.locator('.save-as-channel__save').click()

  // --- Assert the reply-gated promotion (AC3). The row moves "Recent discussions" → "Channels" ONLY after
  // the daemon's conversation_updated drives the re-list: "Channels" header appears, "Recent discussions"
  // header is gone. A pre-#949 binary answers `unsupported`, no re-list fires, the row stays put, and
  // `channelsHeader` never appears → this TIMES OUT (the intended #949-class regression signal). ---
  await expect(channelsHeader(page)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(recentHeader(page)).toHaveCount(0)
})
