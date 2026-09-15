import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary, RenameWorkspacePayload } from '../src/shared/wire/types'

// Fake-stack UI e2e for the OUTBOUND `rename_workspace` verb (#1289). The mirror image of its sibling
// `workspace-updated-relist.spec.ts` (#1288): that one pushes the frame and watches the sidebar move,
// this one SENDS the command and watches the same thing happen, so the two together close the round trip.
//
// WHY IT EARNS ITS KEEP ON A VERB WITH NO SENDER. The unit tier pins every hop but one — the builder
// (`renameWorkspaceEnvelope.test.ts`), the guard (`commands.test.ts`), the connection method and its
// fresh literal (`daemonConnection.test.ts`), the registry delegate (`connectionRegistry.test.ts`).
// `src/main/index.ts` has no test file at all, so its `case 'renameWorkspace':` arm — and specifically
// its choice to route by SERVER rather than by conversation — is the single line whose absence every
// other gate would miss. That arm is what this spec buys.
//
// It runs under the default `npm run e2e` (the filename does not match the config's `real-*` testIgnore).
// One `test`, one launch, one sequential drive.
//
// NO UI AFFORDANCE EXISTS YET, and that is the point: the pen and the Edit-workspace dialog are #1180,
// which is blocked on this ticket. So the command is dispatched through the preload bridge the window
// itself uses, `window.pyry.sendCommand` — the same IPC hop a real click would take, minus the click.
// `FakeDaemon` has no inbound-capture API and needs none: the rendered label proves the frame arrived AND
// carried both fields, since a wrong `path` selects no row and a wrong `label` renders the wrong text.
//
// SECRET HYGIENE (carried from the siblings): every assertion reads rendered display text. Both labels are
// non-secret display literals that never leave the fake, and no message is sent. The pairing plumbing
// (synthetic token, fake static key) lives in launchPairedApp and is never echoed.

// The workspace this drive renames. A fixed literal — deterministic, no Date.now()/randomness.
const WORKSPACE_CWD = '/fake/workspace'

// The label the daemon holds at launch, and the one it holds after the rename. Chosen to share no
// substring with each other, with any locator this spec uses, or with the cwd's folder segment — so a
// build that never sent the frame, or one that never re-listed, cannot pass either assertion by accident.
const OLD_LABEL = 'Second Brain'
const NEW_LABEL = 'Kitchen Ledger'

// What the row would read if the label were dropped entirely: the last segment of the cwd
// (`workspaceLabelFor`). Never asserted as present — it is here to name what that failure looks like.
const FOLDER_SEGMENT = 'workspace'

// The payload the window sends. Typed against the production wire type so a drift in either field's name
// is a type error here — worth having precisely because e2e/ is in no tsconfig and this file is
// typechecked by hand rather than by a gate.
const PAYLOAD: RenameWorkspacePayload = { path: WORKSPACE_CWD, label: NEW_LABEL }

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

// The round trip (sendCommand → IPC → route → build → wire → fake mutation → correlated workspace_updated
// → decode → refresh trigger → list_conversations → reply → store → render) is a fast in-process hop, but
// the assertion following it auto-waits, so it carries headroom for a cold runner.
const RELIST_TIMEOUT_MS = 15_000

/** The preload bridge as the page sees it. No `e2e/` declaration carries `window.pyry`, so the shape is
 *  named here and narrowed to the one method this drive uses. */
interface PyryWindow {
  pyry: { sendCommand(command: unknown): void }
}

test('a renameWorkspace command leaves as a rename_workspace frame the daemon answers', async ({
  launchPairedApp
}) => {
  const fake = conversationStateFake({ conversations: [SEED] })
  const { page } = await launchPairedApp({ buildReplyFrames: fake })

  const workspaceLabels = page.locator('.channel-list__workspace-label')

  // --- 1. The OLD label at launch, carried through the real decoder, the real IPC arm and the real store
  // by the `list_conversations` reply. Load-bearing: it is what makes step 3 a proof that the label
  // CHANGED rather than that it merely reads as a string. It is also a POSITIVE auto-waiting read rather
  // than an absence, which would settle before the sidebar had rendered anything. The array form pins the
  // count too. ---
  // TWO since #1485: the seed is promoted, so the Chats tree draws the same workspace as an empty
  // mirror. Both must read the label, which is a strictly stronger claim than the single read was.
  await expect(workspaceLabels).toHaveText([OLD_LABEL, OLD_LABEL])

  // --- 2. The window asks for the rename. The payload is passed as the evaluate ARGUMENT rather than
  // closed over (the `composer-file-drop.spec.ts` discipline) — a closed-over const is not in the page's
  // scope and would throw at evaluation time. No `serverId` is named: a fake-tier launch holds exactly one
  // connection, so the router's sole-connection branch resolves it, which is also what #1180's dialog will
  // do until a per-server surface exists. ---
  await page.evaluate((command) => {
    ;(window as unknown as PyryWindow).pyry.sendCommand(command)
  }, { type: 'renameWorkspace', payload: PAYLOAD })

  // --- 3. AC3 + AC4. The row now reads the NEW label. Every hop ran for real: had the guard rejected the
  // command, had `index.ts` routed it by conversation (the payload carries no conversation id, so the
  // route would resolve nothing), or had the fresh literal dropped a field, no frame would have reached
  // the fake and this would still read OLD_LABEL. Nothing relaunched and no row was patched locally — the
  // reply only triggered the re-request whose answer landed this text. ---
  await expect(workspaceLabels).toHaveText([NEW_LABEL, NEW_LABEL], { timeout: RELIST_TIMEOUT_MS })

  // The negative half stated explicitly. Without it, "the row shows a string" would pass against a build
  // that dropped the field, since the folder name is a string too. Scoped to the label TEXT rather than to
  // the markup: `workspace` is a substring of the class name on every one of these elements.
  for (const text of await workspaceLabels.allTextContents()) {
    expect(text).not.toBe(FOLDER_SEGMENT)
  }
})
