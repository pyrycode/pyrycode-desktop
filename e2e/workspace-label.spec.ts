import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { mintChatInWorkspace } from './fixtures/mintChatRow'
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
// than incidental. The seed is promoted, so it lands in the Channels tree; the drive mints an unpromoted
// row into the Chats tree at the SAME '/fake/workspace', also `conversationStateFake`'s
// DEFAULT_CREATED_CWD. Once the Chats tree holds a row of its own at that key, the Chats group's label
// comes from the MINTED row, not from the seed: #1485 made the group SET a union across both trees, but it
// left the label owned by the tree whose own rows put the key there. That is the trap this spec exists to
// catch: a client that read the label correctly but a fake that minted `null` would show the daemon name
// in one tree and the folder name in the other. The fake holds one label per `cwd` exactly as the daemon
// does, so the minted row inherits it.
//
// WHAT #1485 CHANGED HERE is the launch state, not the trap. Before the mint the Chats tree already draws
// a MIRROR of the seed's group — the seed's key, the seed's label, no row beneath it — so the label text
// alone can no longer tell "the mirror was always there" from "the minted row's group arrived". Step 1 is
// scoped per tree for that reason, and step 2's row count is what carries the discriminating claim.
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
  // POSITIONAL, and only because nothing better exists: the two trees are sibling runs inside one
  // `.channel-list__tree` with a `.channel-list__divider` between them, so no ancestor element tells them
  // apart. `renderBody` draws the Channels tree first, so index 0 is its group and index 1 the Chats one.
  const channelsWorkspaceLabel = workspaceLabels.nth(0)
  const chatsWorkspaceLabel = workspaceLabels.nth(1)

  // --- 1. The Channels tree at launch. The list reply carried the label through the real decoder, the
  // real IPC arm and the real store to get here. SCOPED TO ONE TREE since #1485: the union draws a group
  // in both trees for every workspace on the host, so an exhaustive read here would be character-identical
  // to step 3's and the two steps would stop being different assertions. The count is still pinned
  // separately, which is what the array form used to buy — a THIRD group appearing fails here. ---
  await expect(workspaceLabels).toHaveCount(2)
  await expect(channelsWorkspaceLabel).toHaveText(WORKSPACE_LABEL)

  // #1485's MIRROR, named rather than merely counted: the SEED's key and the SEED's label drawn under the
  // other tree with no row beneath it. Step 3 reads the same text off a group that by then has a row of
  // its own, so the text cannot tell the two states apart and the row count below is what does.
  await expect(chatsWorkspaceLabel).toHaveText(WORKSPACE_LABEL)

  // --- 2. Mint the second conversation through Add workspace. It is unpromoted, so it lands in the OTHER
  // tree, at the key the mirror above already holds — and once that tree owns a row there, the group's
  // label comes from the MINTED row rather than from the seed. The POSITIVE row count is ordered first and
  // it auto-waits; since #1485 it is also the ONLY read that separates the mirror from a real group, both
  // of them rendering the same text. ---
  await mintChatInWorkspace(page, SEED.cwd)
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
