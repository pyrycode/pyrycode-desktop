import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { mintChatInWorkspace } from './fixtures/mintChatRow'
import type { ConversationSummary } from '../src/shared/wire/types'

// Fake-stack UI e2e for FOLDING A HOST'S WHOLE SUBTREE (#1507). The unit tier server-renders, so it can
// pin the two rendered shapes but can never click: vitest runs in the `node` environment with no jsdom and
// no Testing Library. Every interaction claim — the fold, the re-open, the per-tree independence, the
// chevron's DIRECTION and the "nothing else happened" — therefore lives here, which is what the shipped
// disclosure one level down already does (workspace-collapse.spec.ts, the direct model for this file).
//
// One `test`, one launchPairedApp launch, one sequential drive; it runs under the default `npm run e2e`
// (the filename does not match the config's `real-*` testIgnore). It edits no existing spec and needs no
// fixture change: hosts render expanded by default, so launch-time markup is unchanged.
//
// THE TWO-COPIES-OF-ONE-MACHINE SETUP comes free from the shared fixture. One host is paired, and
// `renderBody` draws its row in BOTH trees, so the sidebar holds two host disclosures for one machine —
// which is exactly AC1's "both trees' other copies of it" scenario, and the reason this spec asserts the
// count of two before relying on it. AC1's "every other host" half needs a second paired machine and is
// left to the same keyed-sibling property `CollapsibleHostGroup` documents; see the spec's own note below.
//
// THE CHEVRON'S DIRECTION IS READ AS A COMPUTED `transform`, which is the one thing neither the unit tier
// nor source review can establish: `channels.css` turns ONE art a quarter off `[aria-expanded='false']`, so
// the rotation is a stylesheet fact with no markup difference to assert. #1487 accepted "proved by review
// of one declaration" at the level below; this spec closes that gap for the host row.
//
// THE COMPOSER DRAFT is the "nothing else happened" observable, borrowed from workspace-collapse.spec.ts
// for the reason it works there: it is plain `useState('')` in Composer with no store behind it and no
// daemon round trip, and PairedShell keys the chat pane on the active conversation id (#670). A draft still
// sitting in the box after a toggle therefore proves three things at once — the pane did not remount, the
// active conversation did not change, and no navigation happened.
//
// SECRET HYGIENE (carried verbatim from the sibling): every assertion reads DOM counts, attribute values,
// computed style strings and client-owned accessible names. DRAFT is a non-secret display literal typed
// into a composer that never sends it — no Send is clicked, so no message text reaches the wire. The
// pairing plumbing (synthetic token, fake static key) lives in launchPairedApp and is never echoed.

// EXACTLY ONE clickable seed: launchPairedApp reaches the thread by clicking a single strict
// `.channel-list__row-open`, so a second seed would strict-violate at launch (the sibling specs'
// constraint). The second conversation is therefore MINTED through the UI. Promoted + named so it lands in
// the Channels tree with a crisp filter target. Fixed literals only — deterministic, no randomness.
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

// The created row is minted unnamed (name: null), so titleFor(null) = 'Untitled'.
const UNTITLED = 'Untitled'

const DRAFT = 'draft typed before folding a host'

// The create round trip (create_conversation → correlated conversation_created → nav) is a fast in-process
// hop, but the assertion following it auto-waits, so it carries headroom for a cold runner.
const ROUNDTRIP_TIMEOUT_MS = 15_000

test('a host row folds its own subtree and does nothing else', async ({ launchPairedApp }) => {
  const buildReplyFrames = conversationStateFake({ conversations: [SEED] })
  const { page } = await launchPairedApp({ buildReplyFrames })

  const thread = page.locator('.conversation')
  const composer = page.getByPlaceholder('Message…')
  const hostDisclosures = page.locator('.channel-list__host-disclosure')
  const workspaceRows = page.locator('.channel-list__workspace')
  const conversationRows = page.locator('.channel-list__row')
  const chevrons = page.locator('.channel-list__host-chevron')
  // DOM order is structural in renderBody — the Channels block, then the divider, then the Chats block —
  // and there is no per-tree wrapper to scope to, by design (the flat sibling sequence is what keeps every
  // existing `.channel-list__row` locator's ancestry unchanged).
  const channelsHost = hostDisclosures.nth(0)
  const chatsHost = hostDisclosures.nth(1)

  // --- 1. Mint the second conversation. It is unpromoted, so it lands in the OTHER tree — giving both
  // trees a populated workspace group under their copy of the one paired machine. ---
  await mintChatInWorkspace(page, SEED.cwd)
  await expect(conversationRows).toHaveCount(2, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 2. Baseline (AC1). One machine, two host rows, both expanded on a fresh start — nothing pre-seeds
  // a fold, because there is no store and no persisted value that could. ---
  await expect(hostDisclosures).toHaveCount(2)
  await expect(channelsHost).toHaveAttribute('aria-expanded', 'true')
  await expect(chatsHost).toHaveAttribute('aria-expanded', 'true')
  await expect(workspaceRows).toHaveCount(2)

  // AC2, the drawn half: each expanded host draws a chevron, and it points DOWN — the art as exported,
  // untransformed. `none` is what an unrotated element computes to, so this is the assertion that would
  // redden if the rotation rule were keyed on the wrong state.
  await expect(chevrons).toHaveCount(2)
  await expect(chevrons.nth(0)).toHaveCSS('transform', 'none')

  // The AC1 anchor: fill the composer and pin that it really holds the draft, so its survival below is a
  // state this drive established rather than an assertion against a box that was never filled.
  await composer.fill(DRAFT)
  await expect(composer).toHaveValue(DRAFT)

  // --- 3. AC1: clicking the Channels host row hides that host's workspace GROUPS and their conversation
  // rows. The host row itself stays — a fold that took the control with it would leave nothing to click
  // back. ---
  await channelsHost.click()
  await expect(channelsHost).toHaveAttribute('aria-expanded', 'false')
  await expect(workspaceRows).toHaveCount(1)
  await expect(conversationRows).toHaveCount(1)
  await expect(conversationRows.filter({ hasText: 'Seeded channel' })).toHaveCount(0)
  await expect(hostDisclosures).toHaveCount(2)
  await expect(channelsHost).toBeVisible()

  // AC2, the collapsed half: the SAME chevron turned a quarter, not a second art appearing. A rotation
  // matrix rather than `none` is the whole claim; the exact matrix is CSS's own serialisation of
  // rotate(-90deg).
  await expect(chevrons).toHaveCount(2)
  await expect(chevrons.nth(0)).toHaveCSS('transform', 'matrix(0, -1, 1, 0, 0, 0)')

  // AC1, at the moment the click's effects have landed: no navigation, no pane change, no change to which
  // conversation is active. A remounted pane or a re-keyed one would have emptied the draft.
  await expect(thread).toHaveCount(1)
  await expect(composer).toHaveValue(DRAFT)

  // --- 4. AC1, the independence half: the OTHER tree's copy of the SAME machine is untouched, and still
  // draws its own chevron pointing down. ---
  await expect(chatsHost).toHaveAttribute('aria-expanded', 'true')
  await expect(chevrons.nth(1)).toHaveCSS('transform', 'none')
  await expect(conversationRows.filter({ hasText: UNTITLED })).toHaveCount(1)

  // --- 5. AC3: the row's own trailing controls are untouched by the fold and do not drive it. The pen is
  // drawn on both host rows and named; activating it opens the Edit host dialog and leaves the fold state
  // exactly where it was. That is the "none of them toggles the fold" half, asserted on the control most
  // likely to swallow the row's click. ---
  const pen = page.getByRole('button', { name: 'Edit host', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Edit host' })
  await expect(pen).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Add workspace', exact: true })).toHaveCount(2)
  await pen.nth(0).click()
  await expect(dialog).toBeVisible()
  await expect(channelsHost).toHaveAttribute('aria-expanded', 'false')
  await expect(chatsHost).toHaveAttribute('aria-expanded', 'true')
  // Cancel and not Escape: this dialog deliberately does NOT dismiss on Escape (sidebar-host-edit.spec.ts
  // pins that), so the exit is the footer's own control.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(channelsHost).toHaveAttribute('aria-expanded', 'false')

  // AC3's tab order: from the host button, Tab reaches the pen and then the plus, the shipped DOM order.
  // The two dots are not focusable and are correctly skipped.
  await channelsHost.focus()
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveClass(/channel-list__host-edit/)
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveClass(/channel-list__host-add/)

  // --- 6. Clicking it again shows the subtree (AC1's second half). ---
  await channelsHost.click()
  await expect(channelsHost).toHaveAttribute('aria-expanded', 'true')
  await expect(workspaceRows).toHaveCount(2)
  await expect(conversationRows).toHaveCount(2)
  await expect(conversationRows.filter({ hasText: 'Seeded channel' })).toHaveCount(1)
  await expect(chevrons.nth(0)).toHaveCSS('transform', 'none')

  // --- 7. AC1's other direction — one-sided independence would pass step 4 and fail here — driven by
  // KEYBOARD rather than mouse. `press` focuses first, so this one call proves both halves of "clicking or
  // pressing Enter", and is the assertion a <div onClick> would fail. ---
  await chatsHost.press('Enter')
  await expect(chatsHost).toHaveAttribute('aria-expanded', 'false')
  await expect(workspaceRows).toHaveCount(1)
  await expect(conversationRows).toHaveCount(1)
  await expect(conversationRows.filter({ hasText: UNTITLED })).toHaveCount(0)
  await expect(channelsHost).toHaveAttribute('aria-expanded', 'true')
  await expect(conversationRows.filter({ hasText: 'Seeded channel' })).toHaveCount(1)

  // Space is the button's other activation key, and it is the one a <div role="button"> silently drops.
  await chatsHost.press(' ')
  await expect(chatsHost).toHaveAttribute('aria-expanded', 'true')
  await expect(workspaceRows).toHaveCount(2)

  // Folding away the ACTIVE conversation's own host changes nothing about the pane either — the sidebar's
  // disclosure reaches no store and no route.
  await expect(thread).toHaveCount(1)
  await expect(composer).toHaveValue(DRAFT)

  // --- 8. Back to the baseline shape. The total row count returning to 2 is the "no conversation was
  // created and none was lost" half: a toggle that dispatched create, or that dropped rows rather than
  // hiding them, would land somewhere other than exactly 2. ---
  await expect(conversationRows).toHaveCount(2)
  await expect(hostDisclosures).toHaveCount(2)
  await expect(chevrons).toHaveCount(2)
})
