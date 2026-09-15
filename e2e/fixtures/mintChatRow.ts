import type { Page } from '@playwright/test'

/**
 * Mint an unpromoted conversation in a named workspace, through the host row's `Add workspace` dialog
 * (#1426). The replacement for the eight FAB presses that the workspace row's `Create chat` plus could
 * not take over.
 *
 * WHY THIS CONTROL AND NOT THE PLUS. The original reason was that a tree drew a group — and therefore a
 * plus — only for a workspace that already had a row in THAT tree, so the eight specs seeding a single
 * PROMOTED row had an empty Chats tree with no `Create chat` plus to press. #1485 closed that gap: each
 * host's workspace set is now the union of both trees' rows, so those specs DO have a Chats-tree plus.
 * The helper stands for a different reason, and this paragraph now states that one. A workspace with no
 * row in either tree still has no group anywhere, and a folder gets a group for the first time only when
 * its first conversation is created — so the host row's plus remains the only shipped control that mints
 * into a workspace that does not exist yet, which is what `mintChatInWorkspace(page, cwd)` is for when
 * its `cwd` names a new folder. The Channels tree's plus is not a substitute either way
 * (`CREATE_CHANNEL_CONTROL_LABEL` opens a naming dialog and mints a PROMOTED row). Every caller keeps
 * working unchanged: the host plus mints the same row it always did.
 *
 * WHY THE MINTED ROW IS THE FAB'S ROW, FIELD FOR FIELD. `requestNewWorkspaceChat` sends
 * `{ is_promoted: false, name: null, cwd }` — the same three fields the FAB's `requestNewConversation`
 * sent, with the cwd stated rather than defaulted. Passing the seed's own `cwd` is what reproduces the
 * FAB's effect exactly: the FAB sent a null cwd, which the daemon (and `conversationStateFake`, via
 * `DEFAULT_CREATED_CWD`) resolved to that same directory. So the row still lands unnamed, unpromoted,
 * in the Chats tree, under a group sharing the seed's workspace label — and it still arrives through
 * `conversationCreated`, so `useConversationCreatedNav` still makes it active and routes `thread`.
 * Every assertion that followed a FAB press reads the same way after this call.
 *
 * WHY THE WORKSPACE NAME IS LEFT BLANK. `beginNaming` dismisses on an empty name instead of entering
 * its naming stage, so the dialog closes on the create alone and no `rename_workspace` is sent. A
 * non-blank name would add a second round trip and a label these specs do not want.
 *
 * `cwd` is passed ABSOLUTE by every caller, which `resolveWorkspacePath` returns unchanged — so the
 * drive does not depend on the host's advertised `workspace_root` and the real tier can hand in the
 * daemon's own workdir.
 */
export async function mintChatInWorkspace(page: Page, cwd: string): Promise<void> {
  // The host row's plus is drawn once per tree; either opens the same per-machine dialog, so the first
  // is taken rather than scoped to a tree. Clicked without a hover, the shape `host-conversation-list`
  // already uses: the reveal is an opacity swap, and Playwright counts an opacity-0 box as visible.
  await page.locator('.channel-list__host-add').first().click()
  const dialog = page.locator('.add-workspace-overlay .modal')
  await dialog
    .getByRole('textbox', { name: 'Workspace folder on the host', exact: false })
    .fill(cwd)
  await dialog.locator('.modal__action--confirm').click()
}
