import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, Envelope, RecentWorkspace } from '../src/shared/wire/types'

// Fake-stack UI e2e proving ONE client preference reaches the wire (#457, split from #424): the Settings
// "Default workspace" choice must land in the `create_conversation` payload's `cwd` when the channel-list FAB
// creates the next discussion. The full path is already shipped and unit-covered per hop; no e2e drives it
// end-to-end. It exercises the already-shipped DefaultWorkspaceRow (#404) → WorkspacePickerSheet (#383) →
// defaultWorkspaceStore (#403) → NewConversationFab (#242) chain through renderer → IPC → main → Noise wire →
// decode → the stateful conversationStateFake (#434/#456) on the launchPairedApp fixture (#433). Zero
// production code.
//
// ONE test() block (a correction vs #456's two blocks): the drive is one linear flow — set a default, then
// create once — so one launch, one `captured` array, and (load-bearing) ONE throwaway --user-data-dir keeps
// `localStorage` empty for the "scratch" baseline assertion. #456 needed two blocks only because promotion is
// one-way and its two flows could not share a seed.
//
// SEED PROMOTION IS IRRELEVANT here (a correction vs #456). #456's is_promoted:false seed constraint was
// specific to the thread WorkspaceChip's self-gate. This spec never touches that chip: it drives the SETTINGS
// picker, which gates on nothing beyond a non-empty recents list. The seed only needs >=1 clickable row so
// launchPairedApp lands in a thread; a single is_promoted:false row is used for simplicity.
//
// WHY THE ASSERTION IS THE OUTBOUND WIRE FRAME, not a rendered reflection. The chosen cwd never surfaces as
// thread/list DOM text (the #440/#456 unrealizable-active-list trap for cwd). The load-bearing observable is
// the `create_conversation` frame the fake received — captured spec-locally by capturingDefaultWorkspaceFake.
// Two supporting DOM observables keep the drive honest: the Settings row's value flips from 'scratch' to the
// chosen path (proving the store write landed), and the FAB create navigates into the new thread (proving the
// fake's conversation_created reply drove useConversationCreatedNav).
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM text / visibility / counts and
// captured wire frames only; SEED / RECENTS / CHOSEN are non-secret display literals; the pairing plumbing
// (synthetic token, fake static key) lives in launchPairedApp and is never echoed. No failure diagnostic
// serialises a token, key, or plaintext; remote paths are opaque, never resolved locally (#380/#139).

// The recent_workspaces round-trip and the create_conversation → conversation_created nav are fast in-process
// round-trips, so a short headroom over Playwright's 5s default suffices for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed timestamps only — the fakeDaemon / conversationStateFake convention (no Date.now(), no randomness).
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The Settings row placeholder rendered when the default-workspace store is null (DefaultWorkspaceRow's
// DEFAULT_WORKSPACE_PLACEHOLDER). It renders at start because launchPairedApp's fresh mkdtemp --user-data-dir
// leaves `pyry.defaultWorkspace` unset — the first e2e to lean on a localStorage-backed store's empty start.
const SCRATCH_PLACEHOLDER = 'scratch'

// EXACTLY ONE clickable, is_promoted:false discussion seed — so launchPairedApp's strict `.channel-list__row-open`
// click reaches its thread. Its promotion state is otherwise irrelevant here (the Settings picker has no
// active-conversation gate). Fixed literals only (the fakeDaemon convention).
const SEED: ConversationSummary = {
  id: 'default-workspace-conversation',
  name: 'Default workspace discussion',
  is_promoted: false,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: FIXED_TS,
  last_used_at: FIXED_TS
}

// Two seeded recent workspaces with DISTINCT paths where neither is a substring of the other, so a `hasText`
// row locator resolves each uniquely (the #423 substring caution). CHOSEN is the one the drive picks and the
// value the create_conversation.cwd assertion expects verbatim.
const RECENT_A: RecentWorkspace = { path: '/home/pyry/projects/apollo', last_used_at: FIXED_TS }
const RECENT_B: RecentWorkspace = { path: '/home/pyry/projects/zephyr', last_used_at: FIXED_TS }
const RECENTS: RecentWorkspace[] = [RECENT_A, RECENT_B]
const CHOSEN = RECENT_A.path

/**
 * Compose over the shared conversationStateFake, adding ONE thing — the frame capture — with NO spec-local
 * verb handling (strictly simpler than #456). Every verb the drive sends (list_conversations, recent_workspaces,
 * create_conversation) is already answered by the shared fake: recent_workspaces from the seeded RECENTS, and
 * create_conversation → conversation_created (which carries the chosen cwd verbatim and fires the nav-into-thread).
 * The fake daemon runs in the TEST process (via the loopback forwarder), so the spec-owned `captured` array is
 * directly readable from the test body. The double-decode (capture + delegate) is pure and harmless; decodeEnvelope
 * throwing here would be a genuine app-under-test bug — let it surface, don't swallow (the #423/#456 note).
 */
function capturingDefaultWorkspaceFake(
  seed: ConversationSummary,
  recents: RecentWorkspace[],
  captured: Envelope[]
): (inbound: Uint8Array) => Uint8Array[] {
  const stateFake = conversationStateFake({ conversations: [seed], recentWorkspaces: recents })
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    return stateFake(inbound)
  }
}

test('default-workspace: a Settings choice reaches the FAB create_conversation cwd', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page } = await launchPairedApp({
    buildReplyFrames: capturingDefaultWorkspaceFake(SEED, RECENTS, captured)
  })

  // launchPairedApp lands IN the seeded row's thread (it clicked the row to reach it). The app-singleton
  // conversation-list store already holds SEED (listed on the connected edge) and, since #670, the sidebar
  // carrying the gear stays mounted beside the thread — so Settings opens straight from here. (#1064
  // deleted the back arrow this used to click first; the round trip reached a list that never left.)

  // Open Settings and assert the null-store baseline: the default-workspace value reads the 'scratch'
  // placeholder, proving the localStorage key started empty (the fresh --user-data-dir).
  await page.locator('.channel-list__settings').click()
  const defaultValue = page.locator('.settings__default-workspace-value')
  await expect(defaultValue).toHaveText(SCRATCH_PLACEHOLDER)

  // Open the Settings picker: mounting RecentWorkspacesData fires a fresh recent_workspaces one-shot → the fake
  // answers RECENTS → one .workspace-picker__row per row (the recent_workspaces → recent_workspaces_list
  // round-trip rendered). A zero-row render here would time out the choose below (an end-to-end proof).
  await page.locator('.settings__default-workspace-row').click()
  await expect(page.locator('.workspace-picker__row')).toHaveCount(RECENTS.length, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })

  // Choose CHOSEN by its unique path text (distinct + mutually non-substring, so the locator resolves one row).
  // onChoose writes the client-owned defaultWorkspaceStore and closes the picker — NO wire traffic on the choose.
  await page.locator('.workspace-picker__row', { hasText: CHOSEN }).click()

  // The store write landed AND the picker closed: the Settings value flipped off 'scratch' to CHOSEN and the
  // picker rows are gone.
  await expect(defaultValue).toHaveText(CHOSEN)
  await expect(page.locator('.workspace-picker__row')).toHaveCount(0)

  // Back to the list (one screen is mounted at a time, so the shared "Back" accessible name is unambiguous) and
  // create a discussion via the FAB. Its click reads the default-workspace slice and sends create_conversation.
  await page.locator('.settings__back').click()
  await page.locator('.channel-list__fab').click()

  // PRIMARY assertion (AC3): the chosen default reached the wire. Frames arrive async over loopback, so poll.
  await expect
    .poll(() => captured.find((e) => e.type === 'create_conversation')?.payload, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toEqual({ is_promoted: false, name: null, cwd: CHOSEN })

  // NAV proof (AC3): the fake's conversation_created reply drove useConversationCreatedNav into the new thread.
  await expect(page.locator('.conversation')).toBeVisible()

  // NEGATIVE guard: the Settings choose writes the store with NO wire traffic (unlike #456's thread picker,
  // which dispatches change_workspace). Placed AFTER the primary poll: the single in-order Noise channel means
  // any choose-emitted frame would precede the already-captured create_conversation, so this absence is race-free.
  expect(captured.filter((e) => e.type === 'change_workspace')).toHaveLength(0)
})
