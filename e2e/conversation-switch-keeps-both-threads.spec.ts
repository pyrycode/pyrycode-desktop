import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { bubbleTextExactly } from './fixtures/bubbleText'
import type { ConversationSummary } from '../src/shared/wire/types'
import type { Page } from '@playwright/test'

// Fake-stack UI e2e for the READER CUTOVER (#758): the chat pane renders the OPEN conversation's own
// retained timeline (conversationTimelineStore) instead of the flat, single-thread `timelineStore` that
// `activateConversation` resets on every switch. The operator-visible claim is the ticket's user story —
// leave a chat, look at another one, come back to the whole thread.
//
// THIS SPEC EXISTS BECAUSE NO UNIT TEST IN THIS REPO CAN MAKE THAT CLAIM. `vitest.config.ts` is
// `environment: 'node'` and zustand v5's `useStore` reads `getInitialState()` under
// `renderToStaticMarkup`, so a seeded store is invisible to a renderer test: every ConversationScreen
// container test renders the EMPTY stores and therefore cannot distinguish one conversation's rows from
// another's, or the keyed store from the flat one. The selector is unit-tested directly
// (ConversationScreen.test.tsx's `selectOpenTimelineFor` describe); the SCREEN reading it is proven here.
// It fails on the pre-#758 code at step 5 — the flat store's reset left the returned-to thread empty.
//
// The drive is the sibling switch spec's (conversation-switch-remount.spec.ts): one seeded row, a second
// conversation MINTED through the plus (exactly one clickable seed, or launchPairedApp's strict row click
// strict-violates at launch), and both activation paths — the plus's create→nav and a sidebar row click.
// The observable is the composer's OPTIMISTIC ECHO rather than a daemon reply: it is a real production
// timeline row written by the real writer (composerSend → dispatchFor, keyed by the conversation it was
// sent to), it needs no reply frame, and it is AC4 ("the composer's own echo appears in the thread it was
// sent to") observed directly.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM text / counts only. The
// two message literals are non-secret display text; the pairing plumbing (synthetic token, fake static
// key) lives in launchPairedApp and is never echoed.

// The one clickable seed. #1426 — UNPROMOTED so it lands in the Chats tree, whose workspace row carries
// the `Create chat` plus this spec now mints through; the deleted FAB needed no group to exist. Nothing
// here reads the section, so the flip costs the drive nothing. Named so its title is a crisp filter
// target, distinct from the minted row's. Fixed literals only — deterministic, no Date.now()/randomness.
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

// Two distinct messages, one per thread, so a failure diagnostic names WHICH conversation's rows leaked
// rather than just reporting a bubble count.
const SENT_IN_SEED = 'a message typed in the seeded channel'
const SENT_IN_CREATED = 'a message typed in the created discussion'

// The create round trip (create_conversation → correlated conversation_created → activate + nav) is a
// fast in-process hop, but the assertion that follows it is an auto-waiting one, so it carries headroom
// for a cold runner.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// #1098: exactly one sidebar row is marked open, and it is the one showing `title`. Both halves matter
// and they fail in opposite directions — a mark that never moved leaves the count at 1 on the WRONG row,
// and one that was added without clearing leaves the count at 2. `aria-current` rather than a computed
// colour on purpose: which row is marked is this spec's question, and what that mark is painted as is
// the geometry spec's.
const expectOnlyOpenRow = async (page: Page, title: string): Promise<void> => {
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveCount(1)
  await expect(
    page
      .locator('.channel-list__row')
      .filter({ hasText: title })
      .locator('.channel-list__row-open[aria-current="true"]')
  ).toHaveCount(1)
}

test("switching away from a chat and back shows that chat's own thread", async ({
  launchPairedApp
}) => {
  // `conversationStateFake` answers `list_conversations` and the create from held state, and returns no
  // frames for a `send_message` (its default arm) — which is all this drive needs: the user row asserted
  // below is the client's own optimistic echo, not a daemon reply.
  const buildReplyFrames = conversationStateFake({ conversations: [SEED] })
  const { page } = await launchPairedApp({ buildReplyFrames })

  // WHOLE bubbles, so every `toHaveText` below reads the meta row's timestamp too (#1014). The array form
  // takes `Array<string | RegExp>` and compares each element's ENTIRE normalized text, exactly as the
  // string form does — so `bubbleTextExactly` drops in per element and the assertions stay exact: still
  // one row, still that row's own message, with only the stamp admitted as a digit shape. NOTE for whoever
  // adds the next text-bearing child to `.bubble`: this locator is BOUND TO A CONST, so a grep for the
  // assertion and the `.bubble` selector on one line does not find these four sites. It missed them once.
  const userRows = page.locator('.bubble[data-thread-role="user"]')
  const sendButton = page.getByRole('button', { name: 'Send' })
  const composer = page.getByPlaceholder('Message…')

  // --- 1. Send in the SEED thread (launchPairedApp landed here by clicking its row). The echo lands in
  // the seeded conversation's own slice — AC4. ---
  await composer.fill(SENT_IN_SEED)
  await sendButton.click()
  await expect(userRows).toHaveText([bubbleTextExactly(SENT_IN_SEED)])

  // --- 2. The CREATE path: the workspace plus mints a second conversation and the correlated conversation_created
  // drives activate + `open`. It has no retained timeline, so its thread is EMPTY and fills from the next
  // live event — AC3. The seeded thread's row must NOT be borrowed into it; before #758 this step passed
  // for the wrong reason (the flat store had just been reset out from under the screen). The auto-wait
  // covers the whole create round trip. ---
  await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
  await expect(userRows).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.conversation__empty')).toBeVisible()

  // --- 3. Send in the created discussion. Its echo is keyed to ITS conversation, so the thread holds
  // exactly one row and it is this one — the seeded thread's row has not followed the operator over. ---
  await composer.fill(SENT_IN_CREATED)
  await sendButton.click()
  await expect(userRows).toHaveText([bubbleTextExactly(SENT_IN_CREATED)])

  // --- 4. The SIDEBAR path back to the seeded channel, scoped by title so it cannot strict-violate
  // against the minted row's own row-open. THE TICKET'S CENTRAL ASSERTION: the thread the operator
  // stepped away from is still there, and it is the one that was sent to it. `activateConversation` still
  // fires its reset on this switch — into a store nothing reads any more. ---
  await page
    .locator('.channel-list__row')
    .filter({ hasText: 'Seeded channel' })
    .locator('.channel-list__row-open')
    .click()
  await expect(userRows).toHaveText([bubbleTextExactly(SENT_IN_SEED)])
  // #1098 rides this drive because it is the only one that reaches a SECOND conversation and switches
  // by clicking a row — the sibling geometry spec covers the create path, not this one. The sidebar
  // marks the chat the pane is showing, so the fill followed the click: exactly one row is marked, and
  // it is the row that was just clicked. The colour and the weight are the geometry spec's; what is
  // asserted here is WHICH row, which is why this reads the state attribute rather than a computed
  // style. `.channel-list` is rendered on the thread route too, so both rows are on screen.
  await expectOnlyOpenRow(page, 'Seeded channel')

  // --- 5. And back the other way, so the proof is not one-way: the created discussion's own row is still
  // held too. Both threads survived the round trip — "switching costs me nothing". ---
  await page
    .locator('.channel-list__row')
    .filter({ hasText: UNTITLED })
    .locator('.channel-list__row-open')
    .click()
  await expect(userRows).toHaveText([bubbleTextExactly(SENT_IN_CREATED)])
  // And the mark came back the other way too, so it is a follow rather than a one-way latch.
  await expectOnlyOpenRow(page, UNTITLED)
})
