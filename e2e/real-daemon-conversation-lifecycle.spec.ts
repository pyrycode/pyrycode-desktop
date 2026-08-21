import { test, expect, encodePairingPayload } from './fixtures/realDaemon'

// The credential-light real-daemon tier (#439) driving the DESTRUCTIVE conversation lifecycle — archive →
// restore → delete of a single FAB-created conversation — against a REAL spawned `pyry` on #251's
// content-blind routing relay, gating on the `pyry` binary ALONE (no `claude`, no Anthropic credential).
// This is the real-daemon twin of the merged fake-stack spec #452 (`conversation-archive-lifecycle.spec.ts`,
// PR#454): the SAME chain, the SAME assertion surface, but the `conversationStateFake` is swapped for the
// #439 realDaemon fixture. It exists to catch the `promote_conversation` class of gap (pyrycode/pyrycode
// #949): the daemon defined the type + payload + registry op but registered NO handler, so the real wire
// answered `unsupported` — while the whole fake-daemon suite stayed green, because a fake answers anything.
// Archive / unarchive / delete are pure registry ops daemon-side (they never touch claude), so they prove
// against a real daemon deterministically and cheaply. Zero production code.
//
// The two code-confirmed constraints that dictate the assertion surface (identical to what #452 documents):
//   - The create step asserts THREAD NAV, never active-list membership — because the route flips to
//     `thread` on the created reply, so the Channel List is UNMOUNTED and there is nothing to assert
//     membership against there. (Since #515 the created row does land in the renderer store at create time —
//     conversationListBridge.shouldRefreshList is now true for conversationCreated, so the correlated
//     conversation_created triggers a re-list — but it lands is_archived:false, invisible to the Archive
//     view. Archiving is what flips it to is_archived:true and surfaces it in the Archive view's Discussions
//     tab, so the Archive-view Discussions 0→1 delta still measures the ARCHIVE, not the create, and remains
//     the sound first assertion.)
//   - Gap B — the active Channel List never filters archived rows (partitionByPromotion splits by
//     is_promoted only), so an archived conversation keeps rendering in the active list. Active-list
//     departure/return on archive is unrealizable (a latent product bug, filed as #469, out of scope here).
//     DELETE is the one step where "gone" holds everywhere — the daemon removes the registry row, so the
//     correlated re-list returns a list without it: gone from both the active Channel List AND the Archive
//     view.
//
// REAL-DAEMON DIVERGENCES from the fake twin #452 (the only deltas; everything else mirrors it):
//   - Fixture: `test.use({ spawnClaude:false, seedPromoted:true })` + the explicit pairing drive (from
//     real-daemon-rename.spec.ts) instead of `launchPairedApp`.
//   - Starting screen: the real-daemon path lands on `route='list'` post-pairing (PairedShell), NOT inside
//     the seed thread — so there is NO opening `.conversation__back`; a `.channel-list__rename` readiness
//     gate under HANDSHAKE_TIMEOUT_MS stands in.
//   - Seed title: the fixture's seedRegistry writes NO `name` (realDaemon.ts:444-448), so the seed renders
//     titleFor(null) = "Untitled" too. The fake twin's SEED was named ("Seeded channel"), title-unique; here
//     the title COLLIDES, so the re-entry click and the post-delete survivor assertion are scoped by SECTION
//     AFFORDANCE, not title: the promoted seed carries `.channel-list__rename` (Channels section); the
//     non-promoted created row carries `.channel-list__save` (Recent discussions). Count-delta / affordance
//     assertions throughout — never title text (both rows can read "Untitled").
//
// A timeout on any mutation assertion is a GENUINE #949-class daemon gap (a missing create_conversation /
// archive_conversation / unarchive_conversation / delete_conversation handler answers `unsupported` on the
// real wire) — file it separately, do NOT paper over it with a longer timeout or a softened assertion.
//
// SECRET HYGIENE (AC5): every assertion reads DOM text / visibility / counts only; UNTITLED is a non-secret
// display literal; the pairing payload is built the same way as real-daemon-rename.spec.ts and never echoed
// into a message. No failure diagnostic serialises the token, keys, or a transcript.

test.use({ spawnClaude: false, seedPromoted: true })

// --- Timeouts (mirror real-daemon-rename.spec.ts) ----------------------------
// Generous to absorb real daemon startup latency (registration on /v1/server is async after spawn) plus a
// handshake re-dial or two — used only on the readiness gate.
const HANDSHAKE_TIMEOUT_MS = 45_000
// A fast registry op + its conversation_updated / conversation_deleted → re-list → re-render round-trip.
const ROUNDTRIP_TIMEOUT_MS = 15_000
// Whole spec: handshake + four fast registry round-trips + headroom. Well under the config's 300s default.
const SPEC_TIMEOUT_MS = 120_000

test('real daemon archive → restore → delete lifecycle reflects through the client', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // --- Pair against the real daemon, dial the test relay's /v1/client leg (real-daemon-rename.spec.ts). ---
  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    // The app dials this verbatim; NOT pyry's emitted relay (which points at prod). The loopback affordance
    // (#97) accepts the ws://127.0.0.1 relay.
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  const pasteBox = page.locator('textarea[aria-label="Pairing code"]')
  const fingerprint = page.locator('[aria-label="Server key fingerprint"]')

  await expect(pasteBox).toBeVisible()
  await pasteBox.fill(payload)
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(fingerprint).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()

  // --- Readiness gate: the promoted seed's Rename pencil renders ONLY after the whole chain — handshake
  // complete → session `connected` → the auto-fired `list_conversations` returned the seeded promoted row →
  // it rendered in the Channels section. The real-daemon path lands on `route='list'` (no opening thread),
  // so this gate replaces the fake twin's opening `.conversation__back`.
  await expect(page.locator('.channel-list__rename')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Baseline: the Archive view starts empty (the observed 0 of the 0→1). The promoted seed is never
  // archived, so both tabs read (0). Proves the archive-view entry and the seed-exclusion up front. ---
  await page.locator('.channel-list__archive').click()
  await expect(page.getByRole('tab', { name: 'Channels (0)', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Discussions (0)', exact: true })).toBeVisible()
  await page.locator('.archive__back').click()

  // --- FAB create-nav (AC2). The FAB dispatches requestNewConversation (name: null, cwd: null →
  // daemon default = the harness -pyry-workdir) → create_conversation → the daemon mints a session RECORD
  // (#677, no claude process; it spawns lazily on the first send_message, #439) and replies
  // conversation_created → useConversationCreatedNav sets it active and routes `thread` (and, independently,
  // #515's re-list lands the row in the store). Assert NAVIGATION into a thread, NOT list membership — the
  // route is `thread`, so the Channel List is unmounted and there is nothing to assert against there. The
  // overflow trigger is absent on the list and present on a thread, so its auto-wait IS the create-nav gate.
  // A timeout here = a missing create_conversation handler (#949-class), not a flake. ---
  await page.locator('.channel-list__fab').click()
  const overflowTrigger = page.locator('.conversation__overflow-trigger')
  await expect(overflowTrigger).toBeVisible()

  // --- Archive (AC3). Open the Channel-info sheet, then the Archive pill. `.channel-info__action` is NOT
  // class-unique (three pills: Rename / Archive / Delete), so target Archive by its accessible name. This
  // fires archive_conversation → the daemon sets is_archived:true and replies conversation_updated (to the
  // requester, NOT a broadcast — pyrycode#881) → shouldRefreshList re-lists → the created row the store
  // already holds (landed at create, #515) FLIPS to archived, so it enters the Archive view's Discussions
  // tab. onArchive also calls onClose(), so the sheet overlay unmounts and we are back on the
  // bare thread — no `.status-sheet__close` needed. ---
  await overflowTrigger.click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()
  // #653's non-vacuity anchor (the #652 idiom): the thread surface is HERE before the confirming click —
  // the Channel Info sheet renders INSIDE ConversationScreen — so the 1→0 delta below is a transition this
  // click caused, not an assertion against a surface that was never mounted.
  await expect(page.locator('.conversation')).toHaveCount(1)
  await page.getByRole('button', { name: 'Archive', exact: true }).click()

  // #653 AC1 — the app returns to the Channel List on the daemon's confirmation, with no manual Back click
  // (the `.conversation__back` click that used to stand here is gone: the control is unmounted by the time
  // it would run). This 1→0 delta is the load-bearing navigation proof, and it auto-waits TWO round trips
  // against the real daemon, not one: archive → conversation_updated → re-list request → conversations →
  // exit.
  await expect(page.locator('.conversation')).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // Nav to the Archive view. With the manual Back gone, this click can only resolve because the app
  // navigated by itself — but it is corroboration, not the proof; the delta above is.
  await page.locator('.channel-list__archive').click()

  // AC3 — Discussions 0→1: the archived non-promoted row lands in Discussions (partitionArchived filters
  // is_archived then splits promoted→channels / non-promoted→discussions). Auto-waits the archive →
  // conversation_updated → re-list → re-render loop. Channels stays (0): the promoted seed is never archived
  // and never leaks into the Discussions count.
  await expect(page.getByRole('tab', { name: 'Discussions (1)', exact: true })).toBeVisible({
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(page.getByRole('tab', { name: 'Channels (0)', exact: true })).toBeVisible()

  // --- Restore (AC4). The restore rows render only for the SELECTED tab, so switch to Discussions first,
  // then click the single `.archive__restore`. This fires unarchive_conversation → is_archived:false →
  // conversation_updated → re-list. ---
  await page.getByRole('tab', { name: 'Discussions (1)', exact: true }).click()
  await expect(page.locator('.archive__restore')).toBeVisible()
  await page.locator('.archive__restore').click()

  // AC4 — Discussions 1→0: the same Archive screen re-renders in place (restore does not navigate). The
  // Discussions tab drops to (0), its panel shows the loaded-empty state, and the restore control is gone.
  await expect(page.getByRole('tab', { name: 'Discussions (0)', exact: true })).toBeVisible({
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(page.getByText('No archived discussions')).toBeVisible()

  // --- Re-enter the created thread for delete. Back to the list, which now holds TWO rows: the promoted
  // seed (Channels) and the restored non-promoted created row (Recent discussions), BOTH titled "Untitled"
  // (the seed is name-less on the real daemon). Scope the created row by its section affordance, not its
  // title: `.channel-list__save` is present only on the non-promoted row; the promoted seed carries
  // `.channel-list__rename` instead. onOpen re-records activeConversation = the created row (already so;
  // harmless re-set) and routes `thread`, so delete targets the created row's real id. ---
  await page.locator('.archive__back').click()
  await page
    .locator('.channel-list__row')
    .filter({ has: page.locator('.channel-list__save') })
    .locator('.channel-list__row-open')
    .click()

  // --- Delete via the two-step destructive confirm (AC5). Open the sheet; ARM by clicking the initial
  // `--danger` "Delete" pill (onDelete opens the confirm, no wire traffic). Exactly one button named
  // "Delete" renders per state (arm: the pill; confirm: the confirm button), so name-exact resolves
  // unambiguously in both. The interposed confirm-prompt assertion pins the arm→confirm transition so the
  // second click cannot race the arm. CONFIRM by clicking "Delete" again → onDeleteConfirm fires
  // delete_conversation and closes the sheet; the daemon removes the registry row and replies
  // conversation_deleted { id } correlated by in_reply_to → the app re-lists → the list returns only the
  // seed, AND (#652) the app leaves the thread by itself. ---
  await overflowTrigger.click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(
    page.getByText('Delete this conversation permanently? This cannot be undone.')
  ).toBeVisible()
  // #652's non-vacuity anchor: the thread surface is HERE before the confirming click, so the 1→0 delta
  // below is a transition this click caused, not an assertion against a surface that was never mounted.
  await expect(page.locator('.conversation')).toHaveCount(1)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()

  // #652 AC1 — the app returns to the Channel List on the daemon's confirmation, with no manual Back
  // click (the `.conversation__back` click that used to stand here is gone: the control is unmounted by
  // the time it would run). This 1→0 delta is the navigation proof; it auto-waits the whole
  // delete → conversation_deleted → exit round trip against the real daemon.
  await expect(page.locator('.conversation')).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // AC5 — gone from the active Channel List (the load-bearing "deleted from store" proof: this is the one
  // surface where the created row WAS visible pre-delete — Gap B kept it in the list even while archived —
  // so its removal here is sound). The 2→1 row drop auto-waits the delete re-list, then the survivor is
  // the promoted seed and the non-promoted created row is gone — affordance counts, NOT title (both rows
  // render "Untitled"). Note this row count does NOT prove the navigation above — it is driven by the
  // re-list, which worked before #652; the `.conversation` delta is what pins the return.
  await expect(page.locator('.channel-list__row-open')).toHaveCount(1, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(page.locator('.channel-list__rename')).toHaveCount(1)
  await expect(page.locator('.channel-list__save')).toHaveCount(0)

  // AC5 — gone from the Archive view: the removed row is in neither tab.
  await page.locator('.channel-list__archive').click()
  await expect(page.getByRole('tab', { name: 'Discussions (0)', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Channels (0)', exact: true })).toBeVisible()
})
