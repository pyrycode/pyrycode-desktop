import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// The credential-light real-daemon tier (#439) driving the WORKSPACE PICKER's two wire round-trips —
// recent-workspaces + create-folder — against a REAL spawned `pyry` on #251's content-blind routing relay,
// gating on the `pyry` binary ALONE (no `claude`, no Anthropic credential). This is the real-daemon twin of
// the merged fake-stack spec #456 (`workspace-picker.spec.ts`): the SAME two flows, driven through the same
// already-shipped UI (WorkspacePickerSheet #383 + CreateFolderDialog #398), but the in-process
// `conversationStateFake` is swapped for the #439 realDaemon fixture. It exists to catch the
// `promote_conversation` class of gap (pyrycode/pyrycode#949): the daemon defined the type + payload +
// registry op but registered NO handler, so the real wire answered `unsupported` — while the whole
// fake-daemon suite stayed green, because a fake answers anything. The workspace verbs are pure registry ops
// daemon-side (they never touch claude), so they prove against a real daemon deterministically and cheaply.
// Zero production code, no fixture change.
//
// This spec captures NO outbound wire frame (unlike the fake twin): the daemon is a SEPARATE process behind
// the content-blind relay, so the fake twin's in-process capture (`capturingWorkspaceFake`, the `Envelope[]`
// poll) is unavailable here. Every assertion reads DOM text / visibility / counts only — the two provable
// DOM-facing halves of #456.
//
// REAL-DAEMON DIVERGENCES from the fake twin #456 (the only deltas):
//   - Fixture: `test.use({ spawnClaude:false, seedPromoted:false })` + the explicit pairing drive (from
//     real-daemon-rename.spec.ts) instead of `launchPairedApp`; `seedPromoted:false` makes the single seed a
//     Recent DISCUSSION whose empty thread renders the WorkspaceChip.
//   - Starting screen: the real-daemon path lands on `route='list'` post-pairing (PairedShell), NOT inside a
//     thread — so a `.channel-list__save` readiness gate (the non-promoted seed's "save as channel"
//     affordance) under HANDSHAKE_TIMEOUT_MS stands in, and the seeded row is OPENED to reach its thread.
//   - "Picker gone" is asserted on `.workspace-picker__other`, NOT `.workspace-picker__row`. The fake twin
//     could use a row-count-0 close check because its seeded recents were always non-empty; on the real tier
//     the recent list is daemon-derived, so a future daemon that excluded the current cwd would render zero
//     rows even while the picker is open — a row-count check would pass vacuously. `.workspace-picker__other`
//     renders unconditionally whenever the picker is open, so its disappearance is the sound "picker
//     unmounted" proof regardless of the recents outcome.
//
// WHY change-workspace is not asserted (rescope from the parent's three-verb framing): the create-folder
// flow still SENDS `change_workspace` over the real wire (the auto-chain after `workspace_folder_created`),
// so the client→wire path is exercised — but the picker close fires on `workspace_folder_created`, not on
// `change_workspace`'s reply, and that reply (`conversation_updated`) is a no-op for activeConversationStore,
// so the chip's snapshotted cwd never updates and the channel-list row renders name + time only. The
// daemon's HANDLING of `change_workspace` has no DOM surface here; its client→wire contract is covered by
// #456 and its daemon-side handling by pyrycode/pyrycode#980.
//
// A timeout on either round-trip is a GENUINE #949-class daemon gap (a missing `recent_workspaces` handler
// leaves the picker not-loaded; a missing `create_workspace_folder` handler hangs the dialog in-flight, both
// answering `unsupported` on the real wire) — file it separately, do NOT paper over it with a longer timeout
// or a softened assertion.
//
// SECRET HYGIENE (AC5): every assertion reads DOM text / visibility / counts only; FOLDER_NAME is a
// non-secret nonce literal; the pairing payload is built the same way as real-daemon-rename.spec.ts and
// never echoed into a message. No failure diagnostic serialises the token, keys, or a transcript; remote
// paths (the recent-workspace rows) are opaque display text, never resolved locally.

test.use({ spawnClaude: false, seedPromoted: false })

// --- Timeouts (mirror real-daemon-conversation-lifecycle.spec.ts) ------------
// Generous to absorb real daemon startup latency (registration on /v1/server is async after spawn) plus a
// handshake re-dial or two — used only on the readiness gate.
const HANDSHAKE_TIMEOUT_MS = 45_000
// Each real-wire round-trip (recent_workspaces → recent_workspaces_list; create_workspace_folder →
// workspace_folder_created) traverses renderer → preload → main → Noise → relay → real daemon and back.
// AC3: at least as generous as the sibling real-daemon specs' value, NOT Playwright's 5s default.
const ROUNDTRIP_TIMEOUT_MS = 15_000
// Whole spec: handshake + two round-trips + picker opens + headroom. Well under the config's 300s default.
const SPEC_TIMEOUT_MS = 120_000

// A single path element (no '/', no '..'), whitespace-free, per-run nonce (the rename spec's idiom). The
// daemon `mkdir`s it under the seed's $HOME/work cwd (writable, $HOME-confined) and replies
// workspace_folder_created; the nonce defeats any collision with a pre-existing folder.
const FOLDER_NAME = `folder-${Date.now()}`

test('real daemon workspace picker resolves recent-workspaces and completes create-folder', async ({
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

  await pairFromUnpairedLaunch(page, payload)

  // --- Readiness gate: the non-promoted seed's "save as channel" affordance renders ONLY after the whole
  // chain — handshake complete → session `connected` → the auto-fired `list_conversations` returned the
  // seeded discussion row → it rendered in the "Chats" section. The real-daemon path lands on
  // `route='list'` (no opening thread), so this gate stands in for the fake twin's land-in-thread.
  await expect(page.locator('.channel-list__save')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Open the seeded discussion thread. Exactly one row (one seed), so the locator resolves uniquely.
  // onOpen sets activeConversation = the seed and routes `thread`; the never-messaged, claude-less thread
  // renders empty (no timeline items, no message-history request), so the WorkspaceChip gate holds. ---
  await page.locator('.channel-list__row-open').click()

  // --- Realizability gate + open the picker (AC1). The chip self-gates to null unless
  // `isEmpty && conversation !== null && !conversation.is_promoted`; post-#448 the row-open landed a
  // non-null, unpromoted active conversation on an empty thread, so the "Change workspace" button renders
  // enabled. Asserting enabled PINS that precondition — a regression that breaks any leg of the gate fails
  // HERE, clearly, before the picker drive. The click mounts the sheet + RecentWorkspacesData (fires
  // recent_workspaces). ---
  const change = page.getByRole('button', { name: 'Change workspace' })
  await expect(change).toBeEnabled()
  await change.click()

  // --- Recent-workspaces round-trip (AC2). The daemon's recent_workspaces_list reply resolves the picker
  // out of its not-loaded state into EITHER workspace rows OR the loaded-empty "No recent workspaces" copy.
  // Assert the loaded-vs-not-loaded distinction (tolerant of rows OR empty per AC2 / OQ-a) — either outcome
  // proves the handler responded. Not-loaded renders NEITHER element, so a missing/broken recent_workspaces
  // handler leaves the picker not-loaded and this times out (the #949-class catch). ---
  await expect(
    page.locator('.workspace-picker__row, .workspace-picker__empty').first()
  ).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- Open the create-folder dialog from the picker's always-present "Other" entry. ---
  await page.locator('.workspace-picker__other').click()
  await expect(page.locator('.create-folder')).toBeVisible()

  // --- Create a folder (AC3). Filling a non-blank name enables Create; the click dispatches createRequested
  // (dialog in-flight) and sends create_workspace_folder { parent: seedCwd, name: FOLDER_NAME }. The daemon
  // `mkdir`s under the seed's $HOME/work cwd (writable, $HOME-confined — OQ-b) and replies
  // workspace_folder_created { path }. ---
  await page.locator('.create-folder__input').fill(FOLDER_NAME)
  await page.locator('.create-folder__create').click()

  // --- Assert the picker + dialog close (AC3, reply-gated). The created-effect fires ONLY on
  // roundTrip.status === 'created' — i.e. on the daemon's workspace_folder_created — and its onCreated is the
  // picker's own onClose, which unmounts the whole sheet tree. A missing/broken create_workspace_folder
  // handler (or a workspace_folder_rejected) leaves the store in-flight, the dialog open, and both counts
  // non-zero → times out (the #949-class catch). `.workspace-picker__other` (rendered unconditionally while
  // the picker is open) is the sound "picker unmounted" proof — see the header note on why not __row. ---
  await expect(page.locator('.create-folder')).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.workspace-picker__other')).toHaveCount(0)
})
