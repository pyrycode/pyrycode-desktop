import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary } from '../src/shared/wire/types'

// The demonstrating spec for the stateful `conversationStateFake` reply factory (#434) — the fake that
// HOLDS a conversation list and mutates it, so the per-flow UI e2e family (#422–#429) seeds a list and
// drives real mutations instead of re-transcribing the wire. It reuses real-daemon-rename.spec.ts's
// proven rename drive (pencil → dialog → fill → Save) against the FAKE via `launchPairedApp`, adding
// one back-nav because `launchPairedApp` lands in the thread. Rename is chosen deliberately: it keeps
// the row in the active list (only the title changes), so "new title present / old title gone" is an
// unambiguous assertion (archive would not leave the list — partitionByPromotion does not filter
// is_archived — the #440 trap).
//
// This single scenario exercises the fixture's core contract: the non-empty-seed launch, the
// `list_conversations`-from-state answer, the `conversation_updated` broadcast reflect path, and the
// re-list-from-updated-state loop. The other six verbs are covered by the uniform mutation-apply plus
// the field-exact frame builders; their end-to-end exercise is the #422–#429 family this fixture unblocks.
//
// It runs under the default `npm run e2e` (its filename does NOT match the config's `real-*` testIgnore).
//
// SECRET HYGIENE: every assertion reads DOM text / visibility / counts only; the seed name and NEW_TITLE
// are non-secret display literals; the pairing plumbing (synthetic token, fake static key) lives in the
// launchPairedApp fixture and is never echoed. No failure diagnostic serialises a token, key, or plaintext.

// A fast in-process round-trip (rename_conversation → conversation_updated → re-list → re-render), so a
// short headroom over Playwright's 5s default suffices for a cold runner.
const RENAME_TIMEOUT_MS = 15_000

// One PROMOTED, NAMED seed row: promoted so partitionByPromotion renders it in the Channels section with
// the `.channel-list__rename` pencil; named so the old-title assertion is crisp. Fixed literals only —
// deterministic, no Date.now()/randomness (the fakeDaemon convention).
const SEED: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Original channel',
  is_promoted: true,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
  workspace_label: null
}

// A fixed literal that DIFFERS from the seed name so both assertions (new present / old gone) are crisp.
const NEW_TITLE = 'Renamed channel'

test('rename reflects through the stateful fake: new title in the list, old gone', async ({
  launchPairedApp
}) => {
  // Seed the fake with one promoted row; its buildReplyFrames answers the connected-edge list_conversations
  // from that seed (→ a clickable, renamable row) and applies every list mutation to the held state.
  const buildReplyFrames = conversationStateFake({ conversations: [SEED] })
  const { page } = await launchPairedApp({ buildReplyFrames })

  // launchPairedApp lands in the thread (it clicked the seeded promoted row to reach it). The
  // app-singleton conversation-list store already holds the seed and, since #670, the sidebar stays
  // mounted beside the thread → the promoted row renders with its rename pencil right there. (#1064
  // deleted the back arrow this used to click first; the round trip reached a list that never left.)

  const renamePencil = page.locator('.channel-list__rename')
  await expect(renamePencil).toBeVisible()

  // Drive the product rename UI: pencil → dialog → fill → Save. `fill` clears the prefilled current title.
  // #1476 — the Channels pen opens the EDIT CHANNEL modal, under its own `.edit-channel*` namespace.
  // The pencil keeps its `.channel-list__rename` token (twelve specs read it as "this row is promoted");
  // what moved is the word and the dialog behind it.
  await renamePencil.click()
  await expect(page.getByRole('dialog', { name: 'Edit channel', exact: true })).toBeVisible()
  await page.locator('.edit-channel__input').fill(NEW_TITLE)
  await page.getByRole('dialog', { name: 'Edit channel', exact: true }).getByRole('button', { name: 'OK', exact: true }).click()

  // The new title renders. Auto-waits the full round-trip: rename_conversation → the fake applies the
  // rename to its held state → conversation_updated broadcast → shouldRefreshList → re-request
  // list_conversations → the fake answers from UPDATED state → re-render.
  await expect(
    page.locator('.channel-list').getByText(NEW_TITLE, { exact: true })
  ).toBeVisible({ timeout: RENAME_TIMEOUT_MS })

  // The old title is gone from the re-listed state.
  await expect(
    page.locator('.channel-list').getByText('Original channel', { exact: true })
  ).toHaveCount(0)
})
