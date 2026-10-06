import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { mintChatInWorkspace } from './fixtures/mintChatRow'
import type { ConversationSummary } from '../src/shared/wire/types'

// Fake-stack UI e2e for the DESTRUCTIVE lifecycle (#452, split from #422): archive → restore → delete of a
// single UI-created conversation, driven end-to-end through renderer → IPC → main → Noise wire → decode →
// render against the stateful conversationStateFake (#434) on the launchPairedApp fixture (#433). Today only
// pair-and-send and (via the sibling #451) create/rename have e2e coverage; archive, restore and delete are
// unguarded. This is the fake-stack twin of the real-daemon lifecycle spec #440; both hit the same structural
// constraints (the create-step routing constraint + Gap B below), so the assertions target the ARCHIVE VIEW
// and GONE-FROM-STORE, never active-Channel-List departure/return. It is INDEPENDENT of #451 — both ride the
// same merged fixtures and add disjoint, brand-new spec files. Zero production code.
//
// The two code-confirmed constraints that dictate the assertion surface:
//   - The create step asserts THREAD NAV, not list membership — because the route flips to `thread` on the
//     created reply, so the Channel List is UNMOUNTED and there is nothing to assert membership against
//     there. (Since #515 the created row does land in the renderer store at create time —
//     conversationListBridge.shouldRefreshList is now true for conversationCreated, so the correlated
//     conversation_created triggers a re-list — but it lands is_archived:false, invisible to the Archive
//     view. Archiving is what flips it to is_archived:true and surfaces it in the Archive view's
//     Discussions tab, so the Archive-view Discussions 0→1 delta still measures the ARCHIVE, not the
//     create, and remains the sound first assertion.)
//   - Gap B — the active Channel List never filters archived rows (partitionByPromotion splits by is_promoted
//     only), so an archived conversation keeps rendering in the active list. Active-list departure/return is
//     unrealizable (the #440 contradiction); latent product bug, out of scope. DELETE is the one step where
//     "gone" holds everywhere — it SPLICES the row from the fake's list, so a re-list returns a list without
//     it: gone from both the Channel List AND the Archive view.
//
// One `test`, one `launchPairedApp` launch (a fresh launch + pairing costs ~15–60s), one sequential drive. It
// runs under the default `npm run e2e` (its filename does NOT match the config's `real-*` testIgnore).
//
// SECRET HYGIENE (carried verbatim from the sibling): every assertion reads DOM text / visibility / counts
// only; SEED.name and UNTITLED are non-secret display literals; the pairing plumbing (synthetic token, fake
// static key) lives in launchPairedApp and is never echoed. No failure diagnostic serialises a token, key, or
// plaintext.

// Each mutate → broadcast/correlated-reply → re-list → re-render loop is a fast in-process round-trip, so a
// short headroom over Playwright's 5s default suffices for a cold runner (the sibling's value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// EXACTLY ONE clickable seed: launchPairedApp reaches the thread by clicking a single strict
// `.channel-list__row-open`, so a second seed would strict-violate at launch. Promoted + named so it renders
// in the "Channels" section, and NEVER archived, so it stays out of the Archive view's Discussions tab
// throughout — the crisp control proving the destructive verbs targeted only the created row, not a wipe.
// Fixed literals only — deterministic, no Date.now()/randomness (the fakeDaemon convention).
const SEED: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded channel',
  is_promoted: true,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
  workspace_label: null
}

// The created row's displayed title: it is minted unnamed (name: null) and #452 never renames it, so
// titleFor(null) = 'Untitled'. Used to scope the created row's row-open (distinct from SEED's title) and to
// assert its absence after delete.
const UNTITLED = 'Untitled'

test('archive → restore → delete lifecycle reflects through the stateful fake', async ({
  launchPairedApp
}) => {
  // Seed the fake with one promoted, never-archived row; its buildReplyFrames answers the connected-edge
  // list_conversations from that seed and applies every list mutation (create/archive/unarchive/delete) to
  // the held state, replying with the correct broadcast-then-relist / correlated-delete semantics.
  const buildReplyFrames = conversationStateFake({ conversations: [SEED] })
  const { page } = await launchPairedApp({ buildReplyFrames })

  // launchPairedApp lands IN the seeded row's thread (it clicked the seeded promoted row to reach it), with
  // activeConversation = SEED. The app-singleton conversation-list store already holds SEED (listed on the
  // connected edge), and since #670 the sidebar is mounted BESIDE the thread — so the Archive entry below is
  // already on screen and the drive acts on it directly. (#1064 deleted the back arrow this used to click
  // first; the round trip only ever existed to reach a sidebar that had not been going anywhere since #670.)

  // --- Baseline: the Archive view starts empty (the observed 0 of the 0→1). The seed is never archived, so
  // both tabs read (0). This also proves the archive-view entry and the seed-exclusion up front. ---
  await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Channels (0)', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Discussions (0)', exact: true })).toBeVisible()
  await page.locator('.archive__back').click()

  // --- Create-nav. The Add workspace dialog dispatches requestNewWorkspaceChat (name: null) →
  // create_conversation → the fake mints `created-1` (unnamed, non-promoted) and replies conversation_created →
  // useConversationCreatedNav sets it active and dispatches `open` → route `thread` (and, independently,
  // #515's re-list lands the row in the store). Assert NAVIGATION into a thread, NOT list membership: the
  // list re-renders on the re-list whether or not the app navigated, so a row assertion here would not
  // separate the two. (Since #670 the list stays MOUNTED beside the thread, which only sharpens the
  // point.) The overflow trigger is absent on the list and present on a thread, so its auto-wait IS the
  // create-nav gate. ---
  await mintChatInWorkspace(page, SEED.cwd)
  const overflowTrigger = page.locator('.conversation__overflow-trigger')
  await expect(overflowTrigger).toBeVisible()

  // --- Archive (AC2). Open the Channel-info sheet, then the Archive pill. `.channel-info__action` is NOT
  // unique (three pills: Rename / Archive / Delete), so target Archive by its accessible name. This fires
  // archive_conversation → the fake sets is_archived:true → conversation_updated → re-list → the created row
  // the store already holds (landed at create, #515) FLIPS to archived, so it enters the Archive view's
  // Discussions tab. onArchive also calls onClose(), so the full-surface sheet overlay unmounts
  // and we are back on the bare thread — no `.status-sheet__close` needed (unlike the sibling's rename path,
  // which leaves the sheet open). ---
  await overflowTrigger.click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()
  // #653's non-vacuity anchor (the #652 idiom at :157): the thread surface is HERE before the confirming
  // click — the Channel Info sheet renders INSIDE ConversationScreen — so the 1→0 delta below is a
  // transition this click caused, not an assertion against a surface that was never mounted.
  await expect(page.locator('.conversation')).toHaveCount(1)
  // #670: SCOPED to the chat pane. The two-pane shell keeps the Channel List mounted while a thread is
  // open, and the list's own top-right entry is `aria-label="Archive"` too — so an unscoped name-exact
  // query now matches TWO buttons and strict mode fails. The Channel-info sheet renders INSIDE
  // ConversationScreen (see the sheet open above), so `.conversation` is a valid scoping root.
  await page.locator('.conversation').getByRole('button', { name: 'Archive', exact: true }).click()

  // #653 AC1 — the app returns to the Channel List on the daemon's confirmation, with no manual Back click
  // (the manual Back click that used to stand here went in #653: the control was unmounted by the time it
  // would have run, and #1064 has since deleted it outright). This 1→0 delta is the load-bearing
  // navigation proof, and it auto-waits TWO round trips, not one: archive → conversation_updated →
  // re-list request → conversations → exit.
  await expect(page.locator('.conversation')).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // Nav to the Archive view. With the manual Back gone, this click can only resolve because the app
  // navigated by itself — but it is corroboration, not the proof; the delta above is.
  await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()

  // AC2 — Discussions 0→1: the archived non-promoted row lands in Discussions (partitionArchived filters
  // is_archived then splits promoted→channels / non-promoted→discussions). Auto-waits the archive → broadcast
  // → re-list loop. Channels stays (0): the promoted seed is never archived and does not leak into either the
  // archive view or the Discussions count.
  await expect(page.getByRole('tab', { name: 'Discussions (1)', exact: true })).toBeVisible({
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(page.getByRole('tab', { name: 'Channels (0)', exact: true })).toBeVisible()

  // --- Restore (AC3). The restore rows render only for the SELECTED tab, so switch to Discussions first,
  // then click the single `.archive__restore`. This fires unarchive_conversation → is_archived:false →
  // conversation_updated → re-list. ---
  await page.getByRole('tab', { name: 'Discussions (1)', exact: true }).click()
  await expect(page.locator('.archive__restore')).toBeVisible()
  await page.locator('.archive__restore').click()

  // AC3 — Discussions 1→0: the same Archive screen re-renders in place (restore does not navigate). The
  // Discussions tab drops to (0), its panel shows the loaded-empty state, and the restore control is gone.
  await expect(page.getByRole('tab', { name: 'Discussions (0)', exact: true })).toBeVisible({
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(page.getByText('No archived discussions')).toBeVisible()

  // --- Re-enter the created thread for delete. Back to the list, which now shows TWO rows: SEED
  // ("Channels") and the restored created row ("Untitled", "Chats"). Click the created row's
  // open control, scoped by its title so it does not strict-violate against SEED's row-open. onOpen sets
  // activeConversation = the created row and routes `thread`. ---
  await page.locator('.archive__back').click()
  await page
    .locator('.channel-list__row')
    .filter({ hasText: UNTITLED })
    .locator('.channel-list__row-open')
    .click()

  // --- Delete via the two-step destructive confirm (AC4). Open the sheet; ARM by clicking the initial
  // `--danger` "Delete" pill (onDelete opens the confirm, no wire traffic). Exactly one button named "Delete"
  // renders per state (arm: the pill; confirm: the confirm button), so name-exact resolves unambiguously in
  // both. The interposed confirm-prompt assertion pins the arm→confirm transition so the second click cannot
  // race the arm. CONFIRM by clicking "Delete" again → onDeleteConfirm fires delete_conversation and closes
  // the sheet; the fake splices the row and replies conversation_deleted { id } correlated by in_reply_to →
  // the app re-lists → the list returns only SEED, AND (#652) the app leaves the thread by itself. ---
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
  // click (the manual Back click that used to stand here went in #652: the control was unmounted by the
  // time it would have run, and #1064 has since deleted it outright). This 1→0 delta is the navigation
  // proof; it auto-waits the whole delete → conversation_deleted → exit round trip.
  await expect(page.locator('.conversation')).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // AC4 — gone from the Channel List (the load-bearing "deleted from store" proof: this is the one surface
  // where the created row WAS visible pre-delete — Gap B kept it in the list even while archived — so its
  // removal here is sound). The 2→1 row drop auto-waits the delete re-list, then only the seed remains.
  // Note this row count does NOT prove the navigation above — it is driven by the re-list, which worked
  // before #652; the `.conversation` delta is what pins the return.
  await expect(page.locator('.channel-list__row-open')).toHaveCount(1, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(
    page.locator('.channel-list').getByText('Seeded channel', { exact: true })
  ).toBeVisible()
  await expect(page.locator('.channel-list').getByText(UNTITLED, { exact: true })).toHaveCount(0)

  // AC4 — gone from the Archive view: the spliced row is in neither tab.
  await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Discussions (0)', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Channels (0)', exact: true })).toBeVisible()
})
