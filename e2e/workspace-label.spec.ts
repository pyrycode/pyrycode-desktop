import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary } from '../src/shared/wire/types'

// Fake-stack UI e2e for THE DAEMON-HELD WORKSPACE LABEL reaching the sidebar (#1287). The unit tier
// already pins the derivation (`channelListViewModel.test.ts`) and the render (`ChannelList.test.tsx`);
// what neither can reach is the whole path — a `list_conversations` reply carrying the field, through the
// production decoder, the IPC arm and the store, into the rendered row. That path is what this spec buys,
// and it is why the seed goes through `conversationStateFake` rather than through a rendered prop.
//
// It runs under the default `npm run e2e` (the filename does not match the config's `real-*` testIgnore).
// One `test`, one launch, one sequential drive.
//
// THE TWO-TREES SETUP is `workspace-collapse.spec.ts`'s idiom verbatim, and it is load-bearing here rather
// than incidental. The seed is promoted, so it lands in the Channels tree; the FAB mints an unpromoted row
// into the Chats tree, whose cwd is `conversationStateFake`'s DEFAULT_CREATED_CWD — the SAME
// '/fake/workspace'. The two trees are grouped SEPARATELY, so the Chats group's label comes from the
// MINTED row, not from the seed. That is the trap this spec exists to catch: a client that read the label
// correctly but a fake that minted `null` would show the daemon name in one tree and the folder name in
// the other. The fake holds one label per `cwd` exactly as the daemon does, so the minted row inherits it.
//
// SECRET HYGIENE (carried from the siblings): every assertion reads rendered display text and DOM counts.
// The label is a non-secret display literal that never leaves the fake; no message is sent, so nothing
// reaches the wire. The pairing plumbing (synthetic token, fake static key) lives in launchPairedApp and
// is never echoed.

// The label the daemon holds for '/fake/workspace'. Chosen to differ from the folder segment 'workspace'
// so the exhaustive text assertion below cannot pass against a build that ignored the field — and to
// carry no substring of any locator this spec uses.
const WORKSPACE_LABEL = 'Second Brain'

// What the row would read if the label were dropped: the last segment of the seed's cwd
// (`workspaceLabelFor`). Never asserted as present — it is here to name what the failure looks like.
const FOLDER_SEGMENT = 'workspace'

// EXACTLY ONE clickable seed: launchPairedApp reaches the thread by clicking a single strict
// `.channel-list__row-open`, so a second seed would strict-violate at launch. Promoted and named so it
// lands in the Channels tree. Fixed literals only — deterministic, no Date.now()/randomness.
const SEED: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded channel',
  is_promoted: true,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
  workspace_label: WORKSPACE_LABEL
}

// The create round trip (create_conversation → correlated conversation_created → nav) is a fast
// in-process hop, but the assertion following it auto-waits, so it carries headroom for a cold runner.
const ROUNDTRIP_TIMEOUT_MS = 15_000

test('the workspace row shows the daemon label, not the folder name, in both trees', async ({
  launchPairedApp
}) => {
  const buildReplyFrames = conversationStateFake({ conversations: [SEED] })
  const { page } = await launchPairedApp({ buildReplyFrames })

  const workspaceLabels = page.locator('.channel-list__workspace-label')
  const conversationRows = page.locator('.channel-list__row')

  // --- 1. The Channels tree at launch. The list reply carried the label through the real decoder, the
  // real IPC arm and the real store to get here. ---
  await expect(workspaceLabels).toHaveText([WORKSPACE_LABEL])

  // --- 2. Mint the second conversation with the FAB. It is unpromoted, so it lands in the OTHER tree,
  // under a group grouped independently of the first. The POSITIVE row count is ordered first, and it
  // auto-waits: the label assertion after it would otherwise read a one-tree sidebar and pass without
  // ever seeing the second group. ---
  await page.locator('.channel-list__fab').click()
  await expect(conversationRows).toHaveCount(2, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 3. AC4. Both trees, asserted EXHAUSTIVELY rather than one at a time: the array form pins the
  // count and every text at once, so a third group appearing, a group vanishing, or either row falling
  // back to `FOLDER_SEGMENT` all fail here. The Chats group's value is the MINTED row's — the trap the
  // header describes — so this is the assertion that would redden if the fake minted a null label. ---
  await expect(workspaceLabels).toHaveText([WORKSPACE_LABEL, WORKSPACE_LABEL])

  // The negative half stated explicitly. Without it, "the row shows a string" would pass against a build
  // that never read the field, since the folder name is a string too. Scoped to the label TEXT rather
  // than to the markup: `workspace` is a substring of the class name on every one of these elements.
  for (const text of await workspaceLabels.allTextContents()) {
    expect(text).not.toBe(FOLDER_SEGMENT)
  }
})
