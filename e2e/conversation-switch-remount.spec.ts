import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary } from '../src/shared/wire/types'

// Fake-stack UI e2e for the CONVERSATION-TO-CONVERSATION SWITCH (#670). Before the two-pane shell this
// drive was unreachable: the Channel List was unmounted while a thread was open, so every route into a
// thread came from the list and ConversationScreen was remounted on the way. The shell keeps the sidebar
// mounted beside the thread, so switching conversations now happens WITHOUT leaving `route='thread'` —
// and it is the primary interaction the two-pane layout exists to enable.
//
// What that costs, and what this spec pins: React reconciles two consecutive `thread` renders by
// PRESERVING the pane's subtree, so ConversationScreen's screen-local state (the composer draft, the
// Channel-info sheet's open flag, the run-config snapshot, the scroll pin) would carry from the old
// conversation into the new one. The file states five times that those "reset to closed on remount for
// free" (ConversationScreen.tsx:137,:142,:147,:152,:162) — an assumption the shell falsified. Keying the
// pane on the active conversation id restores it. AC4's own wording is the contract being tested:
// "opening a conversation afterwards shows that conversation's thread, never a stale one from a previous
// selection".
//
// The COMPOSER DRAFT is the observable, chosen because it is the sharpest: it is plain `useState('')` in
// Composer (ConversationScreen.tsx:1787) with no store behind it and no daemon round trip, so a non-empty
// draft after a switch can only mean the subtree survived. The store-backed halves of a switch (timeline
// rows, session id) are already cleared by activateConversation and are covered by its own unit tests —
// they would stay green with the pane unkeyed, which is exactly why they are not the observable here.
//
// BOTH activation paths are driven, because both leave the route on `thread` and both must re-key the
// pane: the plus's create→nav (useConversationCreatedNav) and the sidebar row click (onOpen).
//
// One `test`, one `launchPairedApp` launch, one sequential drive; it runs under the default `npm run e2e`
// (the filename does not match the config's `real-*` testIgnore).
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM values / counts only.
// DRAFT_* are non-secret display literals typed into a composer that never sends them — no Send is
// clicked, so no message text reaches the wire. The pairing plumbing (synthetic token, fake static key)
// lives in launchPairedApp and is never echoed.

// EXACTLY ONE clickable seed: launchPairedApp reaches the thread by clicking a single strict
// `.channel-list__row-open`, so a second seed would strict-violate at launch (the sibling specs' constraint).
// The second conversation this drive needs is therefore MINTED through the plus rather than seeded — which is
// #1426 — UNPROMOTED so the seed lands in the Chats tree, whose workspace row carries the `Create chat`
// plus this spec now mints through (the deleted FAB needed no group). Named so its title is a crisp filter target,
// distinct from the minted row's. Fixed literals only — deterministic, no Date.now()/randomness.
const SEED: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded channel',
  is_promoted: false,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
  workspace_label: null
}

// The plus-created row's displayed title: it is minted unnamed (name: null), so titleFor(null) = 'Untitled'.
const UNTITLED = 'Untitled'

// Two distinct drafts, one per pane occupant, so a failure diagnostic names WHICH conversation's state
// leaked rather than just reporting a non-empty box.
const DRAFT_IN_SEED = 'draft typed in the seeded channel'
const DRAFT_IN_CREATED = 'draft typed in the created discussion'

// The create round trip (create_conversation → correlated conversation_created → nav) is a fast in-process
// hop, but the assertion that follows it is an auto-waiting one, so it carries headroom for a cold runner.
const ROUNDTRIP_TIMEOUT_MS = 15_000

test('switching conversations without leaving the thread remounts the chat pane', async ({
  launchPairedApp
}) => {
  const buildReplyFrames = conversationStateFake({ conversations: [SEED] })
  const { page } = await launchPairedApp({ buildReplyFrames })

  // launchPairedApp lands IN the seeded row's thread (it clicked the seeded row to get here), with
  // activeConversation = SEED and the sidebar mounted beside it (#670).
  const thread = page.locator('.conversation')
  const composer = page.getByPlaceholder('Message…')
  await expect(thread).toHaveCount(1)

  // --- 1. Type a draft into the SEED thread's composer. `toHaveValue` pins that the box really holds it,
  // so the emptiness asserted after each switch below is a transition this drive caused, rather than an
  // assertion against a box that was never filled (the siblings' non-vacuity anchor). ---
  await composer.fill(DRAFT_IN_SEED)
  await expect(composer).toHaveValue(DRAFT_IN_SEED)

  // --- 2. The CREATE path: the workspace plus mints a second conversation and the correlated conversation_created
  // drives useConversationCreatedNav → activate + `open`. The route was ALREADY `thread`, so `open` is a
  // no-op transition and nothing about the route changes — the pane's occupant does. The draft above must
  // not survive that. This assertion auto-waits the whole create round trip: until the nav lands, the box
  // still holds DRAFT_IN_SEED and the poll retries. ---
  await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
  await expect(composer).toHaveValue('', { timeout: ROUNDTRIP_TIMEOUT_MS })
  // The pane never emptied on the way: the switch happened THROUGH the thread route, not via the list.
  await expect(thread).toHaveCount(1)

  // --- 3. Type a second draft, now into the created discussion's composer. ---
  await composer.fill(DRAFT_IN_CREATED)
  await expect(composer).toHaveValue(DRAFT_IN_CREATED)

  // --- 4. The SIDEBAR path: click the seeded row's open control while the created thread is up. Scoped by
  // title so it cannot strict-violate against the minted row's own row-open. onOpen records SEED active and
  // dispatches `open` — again a no-op on the route, again a new pane occupant. ---
  await page
    .locator('.channel-list__row')
    .filter({ hasText: 'Seeded channel' })
    .locator('.channel-list__row-open')
    .click()
  await expect(composer).toHaveValue('')
  await expect(thread).toHaveCount(1)

  // --- 5. The other direction, so the proof is not one-way: back to the minted row, still without leaving
  // the thread. A pane keyed on the conversation id remounts on every id change; a pane that only remounted
  // when the id happened to move in one direction would pass step 4 and fail here. ---
  await composer.fill(DRAFT_IN_SEED)
  await expect(composer).toHaveValue(DRAFT_IN_SEED)
  await page
    .locator('.channel-list__row')
    .filter({ hasText: UNTITLED })
    .locator('.channel-list__row-open')
    .click()
  await expect(composer).toHaveValue('')
  await expect(thread).toHaveCount(1)
})
