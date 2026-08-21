import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  ConversationSummary,
  Envelope,
  RecentWorkspace,
  WorkspaceFolderCreatedPayload
} from '../src/shared/wire/types'

// Fake-stack UI e2e for the WORKSPACE PICKER's two wire round-trips (#456, split from #424), neither covered
// today. It drives the already-shipped WorkspacePickerSheet (#383) + CreateFolderDialog (#398) end-to-end
// through renderer → IPC → main → Noise wire → decode → the stateful conversationStateFake (#434, now
// answering `recent_workspaces`) on the launchPairedApp fixture (#433). Zero production code.
//
// TWO test() blocks (the #423 shape), each its own launchPairedApp launch + its own single is_promoted:false
// seed + its own capture array. Two isolated blocks keep each flow's assertion crisp with no cross-flow array
// bookkeeping; the extra launch (~pairing cost) is the accepted price, matching the sibling suite.
//
// REALIZABILITY (load-bearing, #448). The WorkspaceChip that opens the picker self-gates to null unless
// `isEmpty && conversation !== null && !conversation.is_promoted`. Post-#448 a launchPairedApp row-open records
// the clicked row as the active conversation, so the landed thread HAS a non-null active conversation and the
// picker's row/create actions (gated on it) are enabled — PROVIDED the seeded row is a discussion
// (is_promoted:false) and no message is sent (keeps the thread empty). The seed here is therefore NOT
// conversationStateFake's default (promoted → chip renders null → undrivable).
//
// WHY THE ASSERTION IS THE OUTBOUND WIRE FRAME, not a rendered reflection. The changed cwd has no DOM surface:
// change_workspace's reply is conversation_updated, a no-op for activeConversationStore, so the chip's cwd
// (snapshotted at open) never updates; the channel-list row renders name + time only, never cwd. "The list
// reflects the new workspace" is the same unrealizable-active-list trap that routed #440 back. The load-bearing
// observable is instead the inbound frame the fake received — captured spec-locally by capturingWorkspaceFake.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM text / visibility / counts and
// captured wire frames only; SEED / RECENTS / CREATED_PATH / FOLDER_NAME are non-secret display literals; the
// pairing plumbing (synthetic token, fake static key) lives in launchPairedApp and is never echoed. No failure
// diagnostic serialises a token, key, or plaintext; remote paths are opaque, never resolved locally (#380/#139).

// The picker's recent_workspaces round-trip and the create-folder → workspace_folder_created → chained
// change_workspace chain are fast in-process round-trips, so a short headroom over Playwright's 5s default
// suffices for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing for the spec-local create-folder reply — the fakeDaemon / conversationStateFake
// convention (no Date.now(), no randomness). The app inspects neither the reply envelope `id` nor `ts`.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// EXACTLY ONE clickable, is_promoted:false discussion seed — so launchPairedApp's strict `.channel-list__row-open`
// click reaches its thread AND the WorkspaceChip gate is satisfied on landing. Its `cwd` is the `parent` the
// create-folder request must carry. Fixed literals only (the fakeDaemon convention).
const SEED: ConversationSummary = {
  id: 'picker-conversation',
  name: 'Picker discussion',
  is_promoted: false,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: FIXED_TS,
  last_used_at: FIXED_TS
}

// Two seeded recent workspaces with DISTINCT paths where neither is a substring of the other, so a `hasText`
// row locator resolves each uniquely (the #423 substring caution).
const RECENT_A: RecentWorkspace = { path: '/home/pyry/projects/apollo', last_used_at: FIXED_TS }
const RECENT_B: RecentWorkspace = { path: '/home/pyry/projects/zephyr', last_used_at: FIXED_TS }
const RECENTS: RecentWorkspace[] = [RECENT_A, RECENT_B]

// A whitespace-free folder name (so the trimmed request name equals it; trimming itself is unit-covered).
const FOLDER_NAME = 'experiments'

// The daemon-RETURNED created path — a fixed literal DELIBERATELY distinct from the client-reconstructable
// preview (`SEED.cwd + '/' + FOLDER_NAME` = /fake/workspace/experiments). The divergence proves the chained
// change_workspace carries the daemon-returned path VERBATIM, never a client-reconstructed preview (#288).
const CREATED_PATH = '/srv/pyry/workspaces/chan-9de'

/**
 * Compose over the shared conversationStateFake so this spec both (a) captures every decoded inbound frame in
 * wire order into a spec-owned array — the fake daemon runs in the TEST process (via the loopback forwarder),
 * so the array is directly readable from the test body — and (b) answers the DEDICATED create_workspace_folder
 * verb with a canonical workspace_folder_created { path } reply (in_reply_to: env.id, the #423 correlation
 * shape). Every other verb (recent_workspaces, change_workspace, list_conversations, …) delegates to the shared
 * fake untouched — recent_workspaces is answered from the seeded RECENTS. Without the create-folder reply the
 * newFolderStore would hang in-flight forever and the chained change_workspace would never fire (the #423
 * realizability gap). Only this spec sends create_workspace_folder, so its reply stays spec-local (single
 * consumer). The double-decode (capture + delegate) is pure and harmless (the #423 note).
 */
function capturingWorkspaceFake(
  seed: ConversationSummary,
  recents: RecentWorkspace[],
  captured: Envelope[]
): (inbound: Uint8Array) => Uint8Array[] {
  const stateFake = conversationStateFake({ conversations: [seed], recentWorkspaces: recents })
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    if (env.type === 'create_workspace_folder') {
      return [
        encodeEnvelope({
          id: REPLY_ENVELOPE_ID,
          type: 'workspace_folder_created',
          ts: FIXED_TS,
          in_reply_to: env.id,
          payload: { path: CREATED_PATH } satisfies WorkspaceFolderCreatedPayload
        })
      ]
    }
    return stateFake(inbound)
  }
}

/**
 * #653 AC4's pin: changing the open discussion's workspace must leave the operator IN its thread. Both
 * blocks below already close on `.workspace-picker__row` → count 0, which passes just as well if the app
 * wrongly navigated to the Channel List — a vacuous pass. This makes it non-vacuous in two steps.
 *
 * Step 1 is the SYNC POINT, and it is what does the real work. A `change_workspace` is answered with a
 * `conversation_updated`, on which `shouldRefreshList` fires a fresh `list_conversations` from the very
 * same listener that would have to have processed the event. So a `list_conversations` appearing AFTER the
 * `change_workspace` proves the renderer has handled the update a wrongly-gated implementation would
 * navigate on — without it, step 2 could assert "still in the thread" before the event even arrived. The
 * index comparison (not mere existence) matters: the connect-time re-list is already in `captured`.
 *
 * Step 2 is the positive "still here" the count-0 assertions cannot give. The re-list is answered from the
 * fake's state where the seed is `is_archived: false`, so the correct implementation's predicate returns
 * null and nothing moves.
 */
async function expectStillInThreadAfterUpdate(page: Page, captured: Envelope[]): Promise<void> {
  await expect
    .poll(
      () => {
        const changeIndex = captured.findIndex((e) => e.type === 'change_workspace')
        if (changeIndex === -1) return false
        return captured.slice(changeIndex + 1).some((e) => e.type === 'list_conversations')
      },
      { timeout: ROUNDTRIP_TIMEOUT_MS }
    )
    .toBe(true)
  await expect(page.locator('.conversation')).toHaveCount(1)
}

test('recent-pick: choosing a recent workspace emits change_workspace and closes the picker', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page } = await launchPairedApp({
    buildReplyFrames: capturingWorkspaceFake(SEED, RECENTS, captured)
  })

  // Realizability gate (#448): the seeded row-open landed a non-null unpromoted active conversation on an empty
  // thread, so the WorkspaceChip rendered with an enabled "Change workspace" button. Asserting it pins the
  // precondition — a regression that stops row-open from setting the active conversation fails HERE, clearly.
  const changeButton = page.getByRole('button', { name: 'Change workspace' })
  await expect(changeButton).toBeEnabled()
  await changeButton.click()

  // The picker mounts RecentWorkspacesData → a fresh recent_workspaces one-shot → the fake answers RECENTS →
  // one .workspace-picker__row per row (the recent_workspaces → recent_workspaces_list round-trip rendered).
  await expect(page.locator('.workspace-picker__row')).toHaveCount(RECENTS.length, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })

  // Choose RECENT_A by its unique path text (distinct + mutually non-substring, so the locator resolves one row).
  await page.locator('.workspace-picker__row', { hasText: RECENT_A.path }).click()

  // The load-bearing assertion: the fake received a change_workspace carrying the chosen path (frames arrive
  // async over loopback, so poll). change_workspace's reply is a no-op for the chip, so this is the ONLY observable.
  await expect
    .poll(() => captured.find((e) => e.type === 'change_workspace')?.payload, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toEqual({ conversation_id: SEED.id, cwd: RECENT_A.path })

  // onChoose closed the picker (its onClose unmounts the sheet tree).
  await expect(page.locator('.workspace-picker__row')).toHaveCount(0)

  // #653 AC4 — changing the open discussion's workspace must NOT navigate. The count-0 assertion above
  // passes just as well if the app wrongly bounced to the Channel List, so it proves nothing on its own;
  // these two lines make the pin real.
  await expectStillInThreadAfterUpdate(page, captured)
})

test('create-folder: create → workspace_folder_created chains change_workspace with the returned path', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page } = await launchPairedApp({
    buildReplyFrames: capturingWorkspaceFake(SEED, RECENTS, captured)
  })

  // Same realizability gate + picker open as the recent-pick block.
  const changeButton = page.getByRole('button', { name: 'Change workspace' })
  await expect(changeButton).toBeEnabled()
  await changeButton.click()

  // Open the Create-folder dialog from the picker's "Other" entry, fill a name, and confirm. onCreate dispatches
  // createRequested (dialog in-flight) and sends create_workspace_folder { parent: SEED.cwd, name } →
  // capturingWorkspaceFake answers workspace_folder_created { path: CREATED_PATH } → NewFolderData folds it
  // (in-flight → created) → the created-effect fires change_workspace with CREATED_PATH verbatim → onCreated
  // unmounts the whole picker tree.
  await page.locator('.workspace-picker__other').click()
  await expect(page.locator('.create-folder')).toBeVisible()
  await page.locator('.create-folder__input').fill(FOLDER_NAME)
  await page.locator('.create-folder__create').click()

  // The two captured verbs, in order — proving the reply-driven chain fired end-to-end. Had the fake not
  // answered create_workspace_folder, the store would hang in-flight, change_workspace would never fire, and
  // this poll would time out.
  await expect
    .poll(
      () =>
        captured
          .map((e) => e.type)
          .filter((t) => t === 'create_workspace_folder' || t === 'change_workspace'),
      { timeout: ROUNDTRIP_TIMEOUT_MS }
    )
    .toEqual(['create_workspace_folder', 'change_workspace'])

  // The create request carried the active conversation's cwd as `parent` and the trimmed name.
  expect(captured.find((e) => e.type === 'create_workspace_folder')?.payload).toEqual({
    parent: SEED.cwd,
    name: FOLDER_NAME
  })
  // The chained change_workspace carried the daemon-RETURNED path verbatim — distinct from
  // SEED.cwd/FOLDER_NAME, so a match proves the returned path drove it, never a client preview (#288).
  expect(captured.find((e) => e.type === 'change_workspace')?.payload).toEqual({
    conversation_id: SEED.id,
    cwd: CREATED_PATH
  })

  // The whole picker tree unmounted (AC's "picker/dialog closes"): both the dialog and the recent rows are gone.
  await expect(page.locator('.create-folder')).toHaveCount(0)
  await expect(page.locator('.workspace-picker__row')).toHaveCount(0)

  // #653 AC4 — the create-folder chain ends in the same change_workspace, so it drives the same
  // conversation_updated → re-list cycle and needs the same non-vacuous pin as the recent-pick block.
  await expectStillInThreadAfterUpdate(page, captured)
})
