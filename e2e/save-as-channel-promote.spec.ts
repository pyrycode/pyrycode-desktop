import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, WorkspaceFolderCreatedPayload } from '../src/shared/wire/types'

// Fake-stack UI e2e for the SAVE-AS-CHANNEL promote flow (#423, split from #422): the only client flow with
// two location branches, neither covered today. It drives the already-shipped SaveAsChannelDialog (#274/#288)
// end-to-end through renderer → IPC → main → Noise wire → decode → render against the stateful
// conversationStateFake (#434) on the launchPairedApp fixture (#433). Zero production code.
//
// TWO test() blocks, each its own launchPairedApp launch and its own single non-promoted seed — NOT one
// sequential drive. Both branches PROMOTE the seeded row, and promotion is one-way: once promoted the row moves
// to "Channels" and LOSES the `.channel-list__save` affordance (Recent-discussions-only). So one seeded row
// cannot drive both branches. And launchPairedApp reaches the thread by clicking a STRICT single
// `.channel-list__row-open`, so a two-seed single launch strict-violates at launch. Two isolated launches (a
// fresh launch + pairing costs ~15–60s each) is the only realizable shape.
//
// The seeds are NON-promoted so each (a) launches — `.channel-list__row-open` renders on every row, so the
// strict click reaches the thread — and (b) after one back-nav renders the `.channel-list__save` affordance
// under "Recent discussions".
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM text / visibility / counts
// only; the seed names and DEDICATED_PATH are non-secret display literals; the pairing plumbing (synthetic
// token, fake static key) lives in launchPairedApp and is never echoed. No failure diagnostic serialises a
// token, key, or plaintext. DEDICATED_PATH is a fixed fake remote path, never resolved locally (the #380/#139
// opaque-remote-path posture).

// The promote → conversation_updated broadcast → re-list → re-render loop (and, for the dedicated branch, the
// preceding create → workspace_folder_created → created-effect promote) is a fast in-process round-trip, so a
// short headroom over Playwright's 5s default suffices for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing for the spec-local create-folder reply — the fakeDaemon / conversationStateFake
// convention (no Date.now(), no randomness). The app inspects neither the reply envelope `id` nor `ts`.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The daemon-RETURNED path the dedicated branch promotes with — a fixed literal DELIBERATELY distinct from the
// dialog's previewed slug (`~/pyry-workspace/channels/<slug>/`). The divergence is documentary: it proves the
// client promotes with the daemon-returned path, never the client-templated preview (#288). It is not
// DOM-asserted (cwd is not surfaced in the Channel List) — its correctness is proven structurally: only the
// created-effect, reading roundTrip.path, fires the dedicated promote, so a promoted row at all means the
// returned path drove it.
const DEDICATED_PATH = '/srv/pyry/workspaces/chan-7fa'

// EXACTLY ONE clickable, NON-promoted seed per test. Non-promoted → renders under "Recent discussions" with the
// `.channel-list__save` affordance, and is the only clickable row so launchPairedApp's strict row-open click
// reaches its thread. Per-test names aid diagnostics; the tests are isolated (separate launch, separate fake
// state) so no id/name collision matters. Fixed literals only (the fakeDaemon convention).
const SCRATCH_SEED: ConversationSummary = {
  id: 'scratch-conversation',
  name: 'Scratch discussion',
  is_promoted: false,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: FIXED_TS,
  last_used_at: FIXED_TS
}

const DEDICATED_SEED: ConversationSummary = {
  id: 'dedicated-conversation',
  name: 'Dedicated discussion',
  is_promoted: false,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: FIXED_TS,
  last_used_at: FIXED_TS
}

/**
 * Compose over the shared conversationStateFake so the DEDICATED branch's `create_workspace_folder` gets a
 * canonical `workspace_folder_created { path }` reply, delegating every other verb (list_conversations,
 * promote_conversation, …) to the shared fake untouched. Without this, conversationStateFake's default arm
 * returns [] for create_workspace_folder, so the dedicated round-trip would hang in-flight forever (Save stays
 * disabled, the promote never fires) — the realizability gap (#423). Only this spec needs the verb answered, so
 * the reply is spec-local test infra, NOT a fixture change (single-consumer rule). The double-decode is pure
 * and harmless. `in_reply_to: env.id` mirrors the daemon's correlation contract and the conversationDeletedFrame
 * precedent; the client's success path emits unconditionally on decode (daemonConnection.ts:718-731), so it is
 * contract-fidelity, not a functional gate. The SCRATCH branch never sends create_workspace_folder, so its arm
 * is simply never hit.
 */
function promoteFake(seed: ConversationSummary): (inbound: Uint8Array) => Uint8Array[] {
  const stateFake = conversationStateFake({ conversations: [seed] })
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    if (env.type === 'create_workspace_folder') {
      return [
        encodeEnvelope({
          id: REPLY_ENVELOPE_ID,
          type: 'workspace_folder_created',
          ts: FIXED_TS,
          in_reply_to: env.id,
          payload: { path: DEDICATED_PATH } satisfies WorkspaceFolderCreatedPayload
        })
      ]
    }
    return stateFake(inbound)
  }
}

// The two mutually-exclusive section-header proxies. With exactly one seeded row, a non-promoted row renders
// ONLY the "Recent discussions" header and a promoted row renders ONLY the "Channels" header (a zero-row section
// renders no header — ChannelList.tsx). So "Channels appears AND Recent disappears AND the row title stays
// visible" fully captures "the row promoted in place" — the crispest available section-membership assertion, as
// there is no per-section DOM wrapper to scope a row under a header. `hasText` is a substring match, but
// "Recent discussions" does not contain "Channels" (nor vice versa), so each locator resolves only its header.
const channelsHeader = (page: Page) =>
  page.locator('.channel-list__section-header', { hasText: 'Channels' })
const recentHeader = (page: Page) =>
  page.locator('.channel-list__section-header', { hasText: 'Recent discussions' })

test('scratch branch: Keep in scratch promotes the row in place', async ({ launchPairedApp }) => {
  const { page } = await launchPairedApp({ buildReplyFrames: promoteFake(SCRATCH_SEED) })

  // launchPairedApp lands IN the seeded row's thread (it clicked the non-promoted seed to reach it). Back to the
  // list, where the app-singleton conversation-list store already holds SCRATCH_SEED (listed on the connected edge).
  await page.locator('.conversation__back').click()

  // AC1 — baseline: the seed renders under "Recent discussions"; no "Channels" header exists yet.
  await expect(recentHeader(page)).toBeVisible()
  await expect(channelsHeader(page)).toHaveCount(0)
  await expect(
    page.locator('.channel-list').getByText('Scratch discussion', { exact: true })
  ).toBeVisible()

  // AC1 — open the Save-as-channel dialog from the Recent row's affordance.
  await page.locator('.channel-list__save').click()
  await expect(page.locator('.save-as-channel')).toBeVisible()

  // AC2 — choose "Keep in scratch" + Save. The two radios share `.save-as-channel__radio`, so target by
  // accessible name (the wrapping <label> text). Save fires promote_conversation with cwd = SCRATCH_SEED.cwd,
  // synchronously closes the dialog (onPromoted), and the fake broadcasts conversation_updated → the app re-lists.
  await page.getByRole('radio', { name: 'Keep in scratch' }).check()
  await page.locator('.save-as-channel__save').click()

  // AC2 — assert the promotion: the row MOVED to "Channels" (header appears, with round-trip headroom), the
  // "Recent discussions" header is gone, and the row title is still visible.
  await expect(channelsHeader(page)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(recentHeader(page)).toHaveCount(0)
  await expect(
    page.locator('.channel-list').getByText('Scratch discussion', { exact: true })
  ).toBeVisible()
})

test('dedicated branch: create-folder → returned path promotes the row', async ({ launchPairedApp }) => {
  const { page } = await launchPairedApp({ buildReplyFrames: promoteFake(DEDICATED_SEED) })

  // Same launch + back-nav + baseline as the scratch test, with a fresh launch and single non-promoted seed.
  await page.locator('.conversation__back').click()

  // AC1 — baseline: the seed renders under "Recent discussions"; no "Channels" header exists yet.
  await expect(recentHeader(page)).toBeVisible()
  await expect(channelsHeader(page)).toHaveCount(0)
  await expect(
    page.locator('.channel-list').getByText('Dedicated discussion', { exact: true })
  ).toBeVisible()

  // AC1 — open the dialog.
  await page.locator('.channel-list__save').click()
  await expect(page.locator('.save-as-channel')).toBeVisible()

  // AC3 — leave the default ("Move to dedicated channel folder" is pre-checked, AC1) and Save. The radio's
  // accessible name is a substring of the label (which also carries the live slug preview), so the substring
  // match still resolves it. Save dispatches createRequested (dialog goes in-flight) and sends
  // create_workspace_folder → promoteFake answers workspace_folder_created { path: DEDICATED_PATH } → the mounted
  // <NewFolderData /> folds it into the store (in-flight → created) → the created-effect fires
  // promote_conversation with DEDICATED_PATH verbatim → onPromoted() unmounts the dialog → the fake broadcasts
  // conversation_updated → the app re-lists.
  await expect(page.getByRole('radio', { name: 'Move to dedicated channel folder' })).toBeChecked()
  await page.locator('.save-as-channel__save').click()

  // AC3 — identical section-move proof. This trio is also the end-to-end proof the create-folder leg was
  // answered: had promoteFake not replied to create_workspace_folder, the store would hang in-flight, the
  // promote would never fire, and the "Channels" header would time out.
  await expect(channelsHeader(page)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(recentHeader(page)).toHaveCount(0)
  await expect(
    page.locator('.channel-list').getByText('Dedicated discussion', { exact: true })
  ).toBeVisible()
})
