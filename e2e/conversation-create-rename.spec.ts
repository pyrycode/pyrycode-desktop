import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary } from '../src/shared/wire/types'

// Fake-stack UI e2e for the CREATION and NAMING flows (#451, split from #422): the create-and-navigate
// round-trip, the Channel-info SHEET rename entry point, and a grown two-row Channel List — none of which
// had e2e coverage. It rides the merged fixtures (launchPairedApp #433 / conversationStateFake #434) and
// asserts existing UI only; zero production code.
//
// It is deliberately NOT a re-prove of the LIST-ROW rename (the `.channel-list__rename` pencil): that
// entry point is owned by conversation-state-fake.spec.ts (#434's demonstrator). This spec clones that
// demonstrator's shape (seed → launchPairedApp passthrough → one back-nav → the shared rename dialog
// drive) and adds the three uncovered steps: FAB create-nav, the sheet rename, and the two-row re-list.
//
// One `test`, one `launchPairedApp` launch (a fresh launch + pairing costs ~15–60s), one sequential
// drive. It runs under the default `npm run e2e` (its filename does NOT match the config's `real-*`
// testIgnore).
//
// SECRET HYGIENE (carried verbatim from the demonstrator): every assertion reads DOM text / visibility /
// counts only; SEED.name and NEW_TITLE are non-secret display literals; the pairing plumbing (synthetic
// token, fake static key) lives in launchPairedApp and is never echoed. No failure diagnostic serialises
// a token, key, or plaintext.

// The full create→nav / rename→broadcast→re-list→re-render loop is a fast in-process round-trip, so a
// short headroom over Playwright's 5s default suffices for a cold runner (the demonstrator's value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// EXACTLY ONE clickable seed: launchPairedApp reaches the thread by clicking a single strict
// `.channel-list__row-open`, so a second seed would strict-violate at launch. Promoted + named so it
// renders in the "Channels" section (mirroring the demonstrator) and its baseline assertion is crisp.
// The FAB-created row is non-promoted → it lands in "Chats", so the grown list exercises
// both sections. Fixed literals only — deterministic, no Date.now()/randomness (the fakeDaemon convention).
const SEED: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded channel',
  is_promoted: true,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z'
}

// The name the sheet rename gives the created (initially unnamed) row. A fixed literal DISTINCT from
// SEED.name so both final assertions (SEED still present / created-under-NEW_TITLE present) stay crisp.
const NEW_TITLE = 'Created then renamed'

test('create → nav into thread, rename via the Channel-info sheet, both rows re-list', async ({
  launchPairedApp
}) => {
  // Seed the stateful fake with one promoted row; its buildReplyFrames answers the connected-edge
  // list_conversations from that seed and applies every list mutation (create/rename) to the held state.
  const buildReplyFrames = conversationStateFake({ conversations: [SEED] })
  const { page } = await launchPairedApp({ buildReplyFrames })

  // launchPairedApp lands IN the seeded row's thread (it clicked the seeded promoted row to reach it),
  // with activeConversation = SEED. Back to the list, where the app-singleton conversation-list store
  // already holds SEED (listed on the connected edge).
  await page.locator('.conversation__back').click()

  // AC2 — baseline list render: the seeded row renders. Scope to `.channel-list` to keep the assertion
  // off any incidental match elsewhere.
  await expect(
    page.locator('.channel-list').getByText('Seeded channel', { exact: true })
  ).toBeVisible()

  // AC3 — FAB create-nav. The FAB dispatches requestNewConversation (name: null) → create_conversation →
  // the fake mints `created-1` (unnamed, non-promoted) and replies conversation_created →
  // useConversationCreatedNav sets it active and dispatches `open` → route `thread` (and, independently,
  // #515's re-list lands the row in the store, still unnamed). Assert NAVIGATION into a thread, NOT list
  // membership: the list re-renders on the re-list whether or not the app navigated, so a row assertion
  // here would not separate the two. (Since #670 the list stays MOUNTED beside the thread, which only
  // sharpens the point.) The overflow trigger is absent on the list and present on a thread, so its
  // auto-wait IS the create-nav gate.
  await page.locator('.channel-list__fab').click()
  const overflowTrigger = page.locator('.conversation__overflow-trigger')
  await expect(overflowTrigger).toBeVisible()

  // Open the Channel-info sheet from the thread overflow menu. The sheet mounts reading the
  // activeConversation slice = the created payload (non-null → the Rename pill renders).
  await overflowTrigger.click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()

  // AC4 — sheet Rename round-trip. The Rename pill is one of three `.channel-info__action` buttons
  // (Rename / Archive / Delete), so `.channel-info__action` is NOT unique — target Rename by its
  // accessible name, SCOPED to the chat pane. #670 destroyed the invariant that used to stand here
  // ("the list is unmounted while the thread + sheet are up, so no `.channel-list__rename` competes"):
  // the two-pane shell keeps the list mounted beside the thread, and every list row carries an
  // `aria-label="Rename"` pencil, so an unscoped query matches 1 + N buttons and strict mode fails. The
  // Channel-info sheet renders INSIDE ConversationScreen, so `.conversation` is a valid scoping root.
  // The pill opens the same RenameConversationDialogView the list-row rename uses, prefilled "Untitled"
  // (the created row is unnamed); `.fill` replaces the prefill.
  await page.locator('.conversation').getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(page.locator('.rename-conversation')).toBeVisible()
  await page.locator('.rename-conversation__input').fill(NEW_TITLE)
  await page.locator('.rename-conversation__save').click()
  // Save fires rename_conversation → the fake mutates its held `created-1` row → conversation_updated
  // broadcast → shouldRefreshList true → re-request list_conversations → the fake answers from UPDATED
  // state (now two rows: SEED + the renamed created row).

  // Reflect on the RE-LISTED Channel List, not the thread: activeConversationStore is not rewritten by
  // conversation_updated, so the open thread's / sheet's own title may not update; the observable
  // reflection is the re-list. The sheet is a full-surface overlay whose scrim intercepts pointer events,
  // so close it (its Close button) before the back button is clickable, then navigate back to the list.
  await page.locator('.status-sheet__close').click()
  await page.locator('.conversation__back').click()

  // AC4 — multi-row render + rename reflection: BOTH rows render, scoped to `.channel-list`, exact text —
  // SEED ("Channels" section) AND the created row under NEW_TITLE ("Chats" section). The
  // created-row assertion carries the round-trip headroom (it auto-waits the full rename → broadcast →
  // re-list → re-render loop).
  await expect(
    page.locator('.channel-list').getByText(NEW_TITLE, { exact: true })
  ).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(
    page.locator('.channel-list').getByText('Seeded channel', { exact: true })
  ).toBeVisible()
})
