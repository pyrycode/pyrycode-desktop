import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary } from '../src/shared/wire/types'

// Fake-stack UI e2e for COLLAPSING A WORKSPACE GROUP (#704). The unit tier server-renders, so it can pin
// the two rendered shapes but can never click: vitest runs in the `node` environment with no jsdom and no
// Testing Library. Every interaction claim — the fold, the re-open, the per-tree independence, and the
// "nothing else happened" — therefore lives here, which is what both shipped disclosures already do
// (tool-row-toggle.spec.ts, unrecognized-message.spec.ts).
//
// One `test`, one launchPairedApp launch, one sequential drive; it runs under the default `npm run e2e`
// (the filename does not match the config's `real-*` testIgnore). It edits no existing spec and needs no
// fixture change: groups render expanded by default, so launch-time markup is byte-identical.
//
// THE TWO-TREES-ONE-WORKSPACE SETUP comes free from the shared fixture rather than from a new one. The
// seed is promoted (→ the Channels tree) with cwd '/fake/workspace'; the FAB mints an unpromoted row
// (→ the Chats tree) whose cwd is conversationStateFake's DEFAULT_CREATED_CWD, the SAME '/fake/workspace'.
// So both trees show a group labelled "workspace" — which is exactly AC3's scenario, and the reason this
// spec asserts that label on both rows before relying on it.
//
// THE COMPOSER DRAFT is the AC2 observable, borrowed from conversation-switch-remount.spec.ts for the same
// reason it works there: it is plain `useState('')` in Composer with no store behind it and no daemon
// round trip, and PairedShell keys the chat pane on the active conversation id (#670). A draft still
// sitting in the box after a toggle therefore proves three things at once — the pane did not remount, the
// active conversation did not change, and no navigation happened.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM counts, attribute values
// and display literals only. DRAFT is a non-secret display literal typed into a composer that never sends
// it — no Send is clicked, so no message text reaches the wire. The pairing plumbing (synthetic token,
// fake static key) lives in launchPairedApp and is never echoed.

// EXACTLY ONE clickable seed: launchPairedApp reaches the thread by clicking a single strict
// `.channel-list__row-open`, so a second seed would strict-violate at launch (the sibling specs'
// constraint). The second conversation is therefore MINTED by the FAB. Promoted + named so it lands in the
// Channels tree with a crisp filter target. Fixed literals only — deterministic, no Date.now()/randomness.
const SEED: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded channel',
  is_promoted: true,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z'
}

// The FAB-created row is minted unnamed (name: null), so titleFor(null) = 'Untitled'.
const UNTITLED = 'Untitled'

// The workspace label both trees show: the last segment of '/fake/workspace' (workspaceLabelFor).
const WORKSPACE_LABEL = 'workspace'

const DRAFT = 'draft typed before folding a workspace'

// The create round trip (create_conversation → correlated conversation_created → nav) is a fast in-process
// hop, but the assertion following it auto-waits, so it carries headroom for a cold runner.
const ROUNDTRIP_TIMEOUT_MS = 15_000

test('a workspace row folds its own group and does nothing else', async ({ launchPairedApp }) => {
  const buildReplyFrames = conversationStateFake({ conversations: [SEED] })
  const { page } = await launchPairedApp({ buildReplyFrames })

  const thread = page.locator('.conversation')
  const composer = page.getByPlaceholder('Message…')
  const workspaceRows = page.locator('.channel-list__workspace')
  const conversationRows = page.locator('.channel-list__row')
  // DOM order is structural in renderBody — the Channels block, then the divider, then the Chats block —
  // and there is no per-tree wrapper to scope to, by design (the flat sibling sequence is what keeps every
  // existing `.channel-list__row` locator's ancestry unchanged).
  const channelsWorkspace = workspaceRows.nth(0)
  const chatsWorkspace = workspaceRows.nth(1)

  // --- 1. Mint the second conversation. It is unpromoted, so it lands in the OTHER tree, under a group
  // with the SAME workspace label as the seed's — the shape AC3 is about. ---
  await page.locator('.channel-list__fab').click()
  await expect(conversationRows).toHaveCount(2, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 2. Baseline. Two groups, one per tree, both expanded on a fresh start (AC4) — nothing pre-seeds a
  // fold, because there is no store and no persisted value that could. ---
  await expect(workspaceRows).toHaveCount(2)
  await expect(channelsWorkspace).toHaveAttribute('aria-expanded', 'true')
  await expect(chatsWorkspace).toHaveAttribute('aria-expanded', 'true')
  // Both groups really are the same workspace — otherwise step 4's independence claim would be trivially
  // true and this spec would prove nothing about AC3.
  await expect(page.locator('.channel-list__workspace-label').nth(0)).toHaveText(WORKSPACE_LABEL)
  await expect(page.locator('.channel-list__workspace-label').nth(1)).toHaveText(WORKSPACE_LABEL)
  await expect(thread).toHaveCount(1)

  // The AC2 anchor: fill the composer and pin that it really holds the draft, so its survival below is a
  // state this drive established rather than an assertion against a box that was never filled.
  await composer.fill(DRAFT)
  await expect(composer).toHaveValue(DRAFT)

  // --- 3. AC1: clicking the Channels workspace row hides that group's conversation rows. The ROW ITSELF
  // stays — a fold that took the control with it would leave nothing to click back. ---
  await channelsWorkspace.click()
  await expect(channelsWorkspace).toHaveAttribute('aria-expanded', 'false')
  await expect(conversationRows).toHaveCount(1)
  await expect(conversationRows.filter({ hasText: 'Seeded channel' })).toHaveCount(0)
  await expect(workspaceRows).toHaveCount(2)
  await expect(channelsWorkspace).toBeVisible()

  // AC2, at the moment the click's effects have landed: no navigation, no pane change, no change to which
  // conversation is active. A remounted pane or a re-keyed one would have emptied the draft.
  await expect(thread).toHaveCount(1)
  await expect(composer).toHaveValue(DRAFT)

  // --- 4. AC3, first direction: the OTHER tree's group is untouched, though it is the same workspace. ---
  await expect(chatsWorkspace).toHaveAttribute('aria-expanded', 'true')
  await expect(conversationRows.filter({ hasText: UNTITLED })).toHaveCount(1)

  // --- 5. Clicking it again shows the rows (AC1's second half). ---
  await channelsWorkspace.click()
  await expect(channelsWorkspace).toHaveAttribute('aria-expanded', 'true')
  await expect(conversationRows).toHaveCount(2)
  await expect(conversationRows.filter({ hasText: 'Seeded channel' })).toHaveCount(1)

  // --- 6. AC3, the other direction — one-sided independence would pass step 4 and fail here — driven by
  // KEYBOARD rather than mouse. `press` focuses first, so this one call proves both halves of AC5's
  // "focusable and operable by keyboard", and is the assertion a <div onClick> would fail. ---
  await chatsWorkspace.press('Enter')
  await expect(chatsWorkspace).toHaveAttribute('aria-expanded', 'false')
  await expect(conversationRows).toHaveCount(1)
  await expect(conversationRows.filter({ hasText: UNTITLED })).toHaveCount(0)
  await expect(channelsWorkspace).toHaveAttribute('aria-expanded', 'true')
  await expect(conversationRows.filter({ hasText: 'Seeded channel' })).toHaveCount(1)

  // Folding away the ACTIVE conversation's own row changes nothing about the pane either — the sidebar's
  // disclosure reaches no store and no route.
  await expect(thread).toHaveCount(1)
  await expect(composer).toHaveValue(DRAFT)

  // --- 7. Back to the baseline shape. The total row count returning to 2 is the "no conversation was
  // created and none was lost" half of AC2: a toggle that dispatched create, or that dropped rows rather
  // than hiding them, would land somewhere other than exactly 2. ---
  await chatsWorkspace.press('Enter')
  await expect(chatsWorkspace).toHaveAttribute('aria-expanded', 'true')
  await expect(conversationRows).toHaveCount(2)
  await expect(workspaceRows).toHaveCount(2)
  await expect(thread).toHaveCount(1)
  await expect(composer).toHaveValue(DRAFT)
})
