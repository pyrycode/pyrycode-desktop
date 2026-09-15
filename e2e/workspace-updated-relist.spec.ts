import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary } from '../src/shared/wire/types'

// Fake-stack UI e2e for AN INBOUND `workspace_updated` RE-LISTING (#1288). The unit tier pins each hop
// on its own — the decode (`inboundMessage.test.ts`), the emit (`daemonConnection.test.ts`) and the
// refresh trigger (`conversationListBridge.test.ts`) — and none of them can reach the thing the ticket is
// actually about: that an unsolicited frame arriving on a live connection changes what the sidebar reads,
// with no reconnect. That whole path is what this spec buys.
//
// It runs under the default `npm run e2e` (the filename does not match the config's `real-*` testIgnore).
// One `test`, one launch, one sequential drive. The sibling `workspace-label.spec.ts` (#1287) proves the
// label reaches the row at all; this one proves it MOVES.
//
// THE OPENING READ IS LOAD-BEARING, and it is the reason this spec is shaped as three steps rather than
// two. Without it the closing assertion passes just as well against a fake seeded with NEW_LABEL all
// along — the drive would prove the sidebar renders a string, not that the frame changed it. It is also a
// POSITIVE auto-waiting read rather than an absence: a `toHaveCount(0)`-style opening would settle before
// the sidebar had rendered anything and prove nothing at all.
//
// NOTHING IS SENT ON THE WIRE BY THE APP for the rename. `renameWorkspace` is the fake's own seam — the
// outbound `rename_workspace` verb is #1289 — so the frame arrives exactly as it does for a client that
// asked for nothing, which is the case this ticket exists to cover.
//
// SECRET HYGIENE (carried from the siblings): every assertion reads rendered display text. Both labels are
// non-secret display literals that never leave the fake, and no message is sent. The pairing plumbing
// (synthetic token, fake static key) lives in launchPairedApp and is never echoed.

// The workspace this drive renames. A fixed literal — deterministic, no Date.now()/randomness.
const WORKSPACE_CWD = '/fake/workspace'

// The label the daemon holds at launch, and the one it holds after the rename. Chosen to share no
// substring with each other, with any locator this spec uses, or with the cwd's folder segment — so a
// build that ignored the frame, or one that never re-listed, cannot pass either assertion by accident.
const OLD_LABEL = 'Second Brain'
const NEW_LABEL = 'Kitchen Ledger'

// What the row would read if the label were dropped entirely: the last segment of the cwd
// (`workspaceLabelFor`). Never asserted as present — it is here to name what that failure looks like.
const FOLDER_SEGMENT = 'workspace'

// EXACTLY ONE clickable seed: launchPairedApp reaches the thread by clicking a single strict
// `.channel-list__row-open`, so a second seed would strict-violate at launch. Promoted and named so it
// lands in the Channels tree with a workspace group above it.
const SEED: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded channel',
  is_promoted: true,
  is_archived: false,
  cwd: WORKSPACE_CWD,
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
  workspace_label: OLD_LABEL
}

// The re-list round trip (pushed frame → decode → IPC → refresh trigger → list_conversations → reply →
// store → render) is a fast in-process hop, but the assertion following it auto-waits, so it carries
// headroom for a cold runner.
const RELIST_TIMEOUT_MS = 15_000

test('an unsolicited workspace_updated re-lists, so a rename from elsewhere lands with no reconnect', async ({
  launchPairedApp
}) => {
  const fake = conversationStateFake({ conversations: [SEED] })
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake })

  const workspaceLabels = page.locator('.channel-list__workspace-label')

  // --- 1. The OLD label at launch, carried through the real decoder, the real IPC arm and the real store
  // by the `list_conversations` reply. Load-bearing: it is what makes step 3 a proof that the label
  // CHANGED rather than that it merely reads as a string. The array form pins the count too — TWO since
  // #1485, off ONE row: the Channels group the promoted seed sits in, and the Chats tree's empty mirror of
  // it. Both resolve their label from the same seed, so the pair moves together and the OLD/NEW
  // discrimination this spec rests on is untouched. ---
  await expect(workspaceLabels).toHaveText([OLD_LABEL, OLD_LABEL])

  // --- 2. The daemon renames the workspace and pushes the frame UNSOLICITED, exactly as it does when the
  // rename came from another client. One call moves the fake's held state and hands back the frame, so
  // the follow-up re-list cannot answer with a label the daemon never held. ---
  daemon.pushFrame(fake.renameWorkspace(WORKSPACE_CWD, NEW_LABEL))

  // --- 3. AC4. The row now reads the NEW label. Nothing relaunched, nothing reconnected, and no row was
  // patched locally — the frame only triggered the re-request whose reply landed this text. Both entries
  // move, which is its own small claim: the mirror resolves its label from the seed's row rather than
  // caching one, so a re-list reaches it exactly as it reaches the group the row lives in. ---
  await expect(workspaceLabels).toHaveText([NEW_LABEL, NEW_LABEL], { timeout: RELIST_TIMEOUT_MS })

  // The negative half stated explicitly. Without it, "the row shows a string" would pass against a build
  // that dropped the field, since the folder name is a string too. Scoped to the label TEXT rather than to
  // the markup: `workspace` is a substring of the class name on every one of these elements.
  for (const text of await workspaceLabels.allTextContents()) {
    expect(text).not.toBe(FOLDER_SEGMENT)
  }
})
