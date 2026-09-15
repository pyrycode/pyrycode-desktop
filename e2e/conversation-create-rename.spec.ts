import { mkdir } from 'node:fs/promises'
import { decodeEnvelope } from '../src/main/transport/codec'
import { test, expect } from './fixtures/launchPairedApp'
import { bubbleTextExactly } from './fixtures/bubbleText'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { mintChatInWorkspace } from './fixtures/mintChatRow'
import type { ConversationSummary } from '../src/shared/wire/types'

// Creation and both rename entry points through the real UI and fake transport.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// EXACTLY ONE clickable seed: launchPairedApp reaches the thread by clicking a single strict
// `.channel-list__row-open`, so a second seed would strict-violate at launch. Promoted + named so it
// renders in the "Channels" section (mirroring the demonstrator) and its baseline assertion is crisp.
// The created row is non-promoted → it lands in "Chats", so the grown list exercises
// both sections. Fixed literals only — deterministic, no Date.now()/randomness (the fakeDaemon convention).
const SEED: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded channel',
  is_promoted: true,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
  workspace_label: null
}

// The name the sheet rename gives the created (initially unnamed) row. A fixed literal DISTINCT from
// SEED.name so both final assertions (SEED still present / created-under-NEW_TITLE present) stay crisp.
const NEW_TITLE = 'Created then renamed'

// The created row's displayed title before the rename: it is minted unnamed (name: null), so
// titleFor(null) = 'Untitled' — the sibling specs' convention. Used below to tell the created row apart
// from SEED, which is named, when reading which row the sidebar marks as open.
const UNTITLED = 'Untitled'

test('create → nav into thread, rename via the Channel-info sheet, both rows re-list, archive from the Channel-info sheet', async ({
  launchPairedApp
}) => {
  // Seed the stateful fake with one promoted row; its buildReplyFrames answers the connected-edge
  // list_conversations from that seed and applies every list mutation (create/rename) to the held state.
  const fake = conversationStateFake({ conversations: [SEED] })
  const renames: unknown[] = []
  // #1440 — the Edit chat dialog's Archive chat button, captured the way `renames` captures the rename
  // it sits beside, so the "exactly one command, carrying exactly this conversation" assertion is a
  // payload comparison rather than a count. `mutations` already listed `archive_conversation`.
  const archives: unknown[] = []
  const mutations: string[] = []
  let listed: ConversationSummary[] = []
  const { page, app } = await launchPairedApp({
    buildReplyFrames: (inbound) => {
      const envelope = decodeEnvelope(inbound)
      if (envelope.type === 'rename_conversation') renames.push(envelope.payload)
      if (envelope.type === 'archive_conversation') archives.push(envelope.payload)
      if (['rename_conversation', 'change_workspace', 'promote_conversation',
        'archive_conversation', 'delete_conversation'].includes(envelope.type)) {
        mutations.push(envelope.type)
      }
      const replies = fake(inbound)
      for (const reply of replies) {
        const response = decodeEnvelope(reply)
        if (response.type === 'conversations') {
          listed = (response.payload as { conversations: ConversationSummary[] }).conversations
        }
      }
      return replies
    }
  })
  const userRows = page.locator('.bubble[data-thread-role="user"]')
  await page.getByPlaceholder('Message…').fill('Saved channel history')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(userRows).toHaveText([bubbleTextExactly('Saved channel history')])
  // #1440 retitled the dialog and the sheet's pill to Edit chat. The sidebar pen below keeps its own
  // `Rename` accessible name and its `.channel-list__rename` token — #1441 owns those, not this ticket.
  const dialog = page.getByRole('dialog', { name: 'Edit chat', exact: true })
  const input = dialog.getByRole('textbox', { name: 'Channel name:', exact: true })
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  const archiveChat = dialog.getByRole('button', { name: 'Archive chat', exact: true })
  const openChatEditDialog = async (): Promise<void> => {
    await page.locator('.conversation').getByRole('button', { name: 'Edit chat', exact: true }).click()
    await expect(dialog).toBeVisible()
  }
  // #1476 — the SIDEBAR pen's modal is a different dialog from the sheet's, with its own title and its
  // own `.edit-channel*` namespace, so it needs its own locator set rather than a retitle of the one
  // above. Keeping both in one drive is the point: this spec has the chat dialog and the channel dialog
  // on screen in turn, and a handler that opened the wrong one from either entry point reddens here.
  const channelDialog = page.getByRole('dialog', { name: 'Edit channel', exact: true })
  const channelInput = channelDialog.getByRole('textbox', { name: 'Channel name:', exact: true })
  const channelOk = channelDialog.getByRole('button', { name: 'OK', exact: true })
  const channelCancel = channelDialog.getByRole('button', { name: 'Cancel', exact: true })

  // launchPairedApp lands IN the seeded row's thread (it clicked the seeded promoted row to reach it),
  // with activeConversation = SEED. The app-singleton conversation-list store already holds SEED (listed
  // on the connected edge), and since #670 the sidebar is mounted BESIDE the thread — so the list is
  // already on screen and the baseline below reads it where it stands. (#1064 deleted the back arrow this
  // used to click first; that round trip only ever existed to reach a list that never left.)

  // AC2 — baseline list render: the seeded row renders. Scope to `.channel-list` to keep the assertion
  // off any incidental match elsewhere.
  await expect(
    page.locator('.channel-list').getByText('Seeded channel', { exact: true })
  ).toBeVisible()

  // AC3 — create-nav. Add workspace dispatches requestNewWorkspaceChat (name: null, cwd stated) →
  // create_conversation → the fake mints `created-1` (unnamed, non-promoted) and replies
  // conversation_created →
  // useConversationCreatedNav sets it active and dispatches `open` → route `thread` (and, independently,
  // #515's re-list lands the row in the store, still unnamed). Assert NAVIGATION into a thread, NOT list
  // membership: the list re-renders on the re-list whether or not the app navigated, so a row assertion
  // here would not separate the two. (Since #670 the list stays MOUNTED beside the thread, which only
  // sharpens the point.)
  //
  // #1064 REPLACED THIS GATE, because deleting the back arrow took its detector away. It used to read
  // `expect('.conversation__overflow-trigger').toBeVisible()`, which gated only because the deleted round
  // trip had parked the drive on route `list`, where that trigger is absent. With the round trip gone the
  // drive never leaves the thread: `launchPairedApp` ends inside SEED's, `PairedShellView` passes `onBack`,
  // so the trigger is mounted from launch onward and that assertion would resolve whether or not create-nav
  // happened. What still separates the two is WHICH conversation is open. `aria-current="true"` marks the
  // open row (#1098) and follows `activeConversation`, which `useConversationCreatedNav` moves onto the
  // minted row — so the mark sits on SEED until create-nav lands and on the created row after. Reading the
  // marked row's title tells them apart, since the created row is unnamed (UNTITLED) where SEED is named:
  // a create-nav regression leaves the mark on SEED reading 'Seeded channel' and reddens here. The
  // open-row read mirrors `conversation-switch-keeps-both-threads`'s `expectOnlyOpenRow`.
  await mintChatInWorkspace(page, SEED.cwd)
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText(UNTITLED)
  await page.getByPlaceholder('Message…').fill('Chat history')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(userRows).toHaveText([bubbleTextExactly('Chat history')])
  const originalRows = structuredClone(listed)
  const overflowTrigger = page.locator('.conversation__overflow-trigger')

  // Open the Channel-info sheet from the thread overflow menu. The sheet mounts reading the
  // activeConversation slice = the created payload (non-null → the Edit chat pill renders).
  await overflowTrigger.click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()

  // AC4 — sheet rename round-trip. The Edit chat pill is one of three `.channel-info__action` buttons
  // (Edit chat / Archive / Delete), so `.channel-info__action` is NOT unique — target it by its
  // accessible name, SCOPED to the chat pane. #670 destroyed the invariant that used to stand here
  // ("the list is unmounted while the thread + sheet are up, so no list pen competes"): the two-pane
  // shell keeps the list mounted beside the thread, so an unscoped query matches 1 + N buttons and strict
  // mode fails. Since #1441 the competing pens are the CHATS tree's, which is named `Edit chat` verbatim;
  // since #1476 the Channels tree's read `Edit channel` and no longer collide at all. The scope is kept
  // for the Chats pens, which still do. The Channel-info sheet renders INSIDE ConversationScreen, so
  // `.conversation` is a valid scoping root. The pill opens the same `EditChatDialogView` the CHATS pen
  // uses — the Channels pen left for its own modal at #1476 — prefilled "Untitled" (the created row is
  // unnamed); `.fill` replaces the prefill.
  await openChatEditDialog()
  await expect(input).toHaveValue(UNTITLED)
  await expect(input).not.toBeFocused()
  await input.fill('Cancelled draft')
  await cancel.click()
  await expect(dialog).toHaveCount(0)
  await openChatEditDialog()
  await expect(input).toHaveValue(UNTITLED)
  await input.fill('Closed draft')
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(dialog).toHaveCount(0)
  await openChatEditDialog()
  await expect(input).toHaveValue(UNTITLED)
  expect(renames).toEqual([])
  await input.fill('')
  await expect(ok).toBeDisabled()
  await input.fill('   ')
  await expect(ok).toBeDisabled()
  await input.fill('  ' + NEW_TITLE + '  ')
  // #1440 INSERTED A TAB STOP, and this chain is what proved it. Archive chat sits in the Modal's
  // CONTENT slot, between the field and the footer, so the document order that keyboard focus follows
  // is input → Archive chat → Cancel → OK. It is not a footer button and must not be reachable as one:
  // an Archive that landed after Cancel would put a chat's put-away inside the dialog's answer row.
  await input.press('Tab')
  await expect(archiveChat).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(ok).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => renames).toEqual([
    { conversation_id: 'created-1', name: NEW_TITLE }
  ])
  // Save fires rename_conversation → the fake mutates its held `created-1` row → conversation_updated
  // broadcast → shouldRefreshList true → re-request list_conversations → the fake answers from UPDATED
  // state (now two rows: SEED + the renamed created row).

  // Reflect on the RE-LISTED Channel List, not the thread: activeConversationStore is not rewritten by
  // conversation_updated, so the open thread's / sheet's own title may not update; the observable
  // reflection is the re-list — which #670's always-mounted sidebar puts on screen already, so there is
  // no navigation step here at all.
  //
  // THE CLOSE CLICK STAYS, WITH A DIFFERENT REASON. It was justified by the sheet's full-surface scrim
  // intercepting pointer events "before the back button is clickable"; #1064 deleted that button, and the
  // scrim never covered the sidebar anyway (`.status-sheet-overlay` is absolute INSIDE `.conversation`),
  // nor would it block the visibility assertions below, which do not hit-test. What earns the click its
  // place now is that it completes the sheet's own flow: the Channel-info RENAME path does not self-close
  // (unlike onArchive / onDeleteConfirm in the sibling spec), so without it the spec would make its
  // closing assertions from behind a modal left open over the pane — a state no operator reaches, and a
  // landmine for any later assertion here that does hit-test.
  await page.locator('.status-sheet__close').click()

  // AC4 — multi-row render + rename reflection: BOTH rows render, scoped to `.channel-list`, exact text —
  // SEED ("Channels" section) AND the created row under NEW_TITLE ("Chats" section). The
  // created-row assertion carries the round-trip headroom (it auto-waits the full rename → broadcast →
  // re-list → re-render loop).
  await expect(
    page.locator('.channel-list').getByText(NEW_TITLE, { exact: true })
  ).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(
    page.locator('.channel-list').getByText('Seeded channel', { exact: true })
  ).toBeVisible()
  await expect(userRows).toHaveText([bubbleTextExactly('Chat history')])

  // Rename the other identity from the saved-channel sidebar while the chat stays open.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setSize(800, 600)
  })
  // The pen keeps its `.channel-list__rename` token (twelve specs read it as "this row is promoted");
  // since #1476 it opens Edit channel rather than Edit chat.
  const pencil = page.locator('.channel-list__rename')
  await pencil.click()
  await expect(channelInput).toHaveValue(SEED.name)
  await channelInput.press('Escape')
  await expect(channelDialog).toBeVisible()
  await page.locator('.edit-channel-overlay__scrim').click({ position: { x: 2, y: 2 } })
  await expect(channelDialog).toBeVisible()
  const box = await channelDialog.boundingBox()
  expect(box?.width).toBe(640)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await mkdir('/tmp/builder-1352-visual', { recursive: true })
  await page.screenshot({ path: '/tmp/builder-1352-visual/rename-800x600.png' })
  // AC2's reopen clause: a Cancel sends nothing and the next open starts from the row's STORED title,
  // not from the abandoned draft.
  await channelInput.fill('Discard sidebar draft')
  await channelCancel.click()
  await pencil.click()
  await expect(channelInput).toHaveValue(SEED.name)
  expect(renames).toHaveLength(1)
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setMinimumSize(800, 180)
    window.setSize(800, 180)
  })
  expect(await channelDialog.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await channelInput.fill('  Renamed saved channel  ')
  // TWO Tabs to OK, not the three the chat dialog needs: #1476's modal has nothing in the Modal's
  // content slot but the field, so the document order is input → Cancel → OK. #1438 adds this dialog's
  // own content-slot button and puts the third stop back. The scroll-into-view assertion below is what
  // this walk is really for: in a 180px-tall window the focused footer button must still be reachable.
  await channelInput.press('Tab')
  await expect(channelCancel).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(channelOk).toBeFocused()
  await expect(channelOk).toBeInViewport()
  await page.screenshot({ path: '/tmp/builder-1352-visual/rename-800x180-scrolled.png' })
  await page.keyboard.press('Enter')
  await expect(channelDialog).toHaveCount(0)
  await expect.poll(() => renames).toEqual([
    { conversation_id: 'created-1', name: NEW_TITLE },
    { conversation_id: SEED.id, name: 'Renamed saved channel' }
  ])
  expect(mutations).toEqual(['rename_conversation', 'rename_conversation'])
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600))
  await expect(page.locator('.channel-list').getByText('Renamed saved channel', { exact: true })).toBeVisible()
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText(NEW_TITLE)
  await pencil.click()
  await expect(channelInput).toHaveValue('Renamed saved channel')
  // #1476's other no-send path, on the way past: the header close sends nothing whatever the field
  // holds — here it holds the seeded title untouched, which is ALSO the "unchanged name" case.
  await channelDialog.getByRole('button', { name: 'Close dialog' }).focus()
  await page.keyboard.press('Enter')
  await expect(channelDialog).toHaveCount(0)
  expect(renames).toHaveLength(2)
  expect(listed).toEqual(originalRows.map((row) => ({
    ...row, name: row.id === SEED.id ? 'Renamed saved channel' : NEW_TITLE
  })))
  await page.locator('.channel-list__row-open').filter({ hasText: 'Renamed saved channel' }).click()
  await expect(userRows).toHaveText([bubbleTextExactly('Saved channel history')])
  await page.locator('.channel-list__row-open').filter({ hasText: NEW_TITLE }).click()
  await expect(userRows).toHaveText([bubbleTextExactly('Chat history')])

  // --- #1440's Archive chat button. It had TWO entry points until #1476 took one away: the sidebar pen
  // now opens Edit channel, which carries no Archive chat button at all (that ticket's AC2, pinned in
  // `EditChannelDialog.test.tsx`), so the Channel info sheet is this button's only route from here. The
  // sidebar arm is DELETED rather than retitled — there is nothing on the new dialog for it to drive.
  // #1438 draws this modal's own put-away button under `.edit-channel*`, and owns re-proving it.
  //
  // Both halves of #1440's AC2 survive on the sheet's arm, in the same order: the Cancel that sends
  // nothing, then the click that sends exactly one.
  //
  // `mutations` is the non-vacuity net around both steps. It has held exactly two renames since the
  // rename assertions above; anything this section sends beyond the one archive lands in it. ---
  expect(mutations).toEqual(['rename_conversation', 'rename_conversation'])

  // The sheet is this button's entry point, so it is opened ONCE here and both halves below run from
  // it: cancelling the dialog closes the dialog alone and leaves the sheet standing.
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()
  await expect(page.locator('.conversation')).toHaveCount(1)

  // AC2, the negative half: Cancel closes and sends NOTHING. Asserted BEFORE the send below, so the
  // empty `archives` here is a state the drive reached with the button already on screen and clickable
  // — not the emptiness of a spec that never opened the dialog.
  await openChatEditDialog()
  await expect(archiveChat).toBeEnabled()
  await cancel.click()
  await expect(dialog).toHaveCount(0)
  expect(archives).toEqual([])

  // AC2 from the CHANNEL INFO SHEET: the pill reads Edit chat, the dialog it opens carries the button,
  // and this one closes the SHEET as well. The sheet renders inside ConversationScreen, so the
  // `.conversation` 1→0 delta below proves both the sheet's dismissal and the open thread's exit — the
  // latter driven by the existing archived-active bridge on the daemon's re-list, not by this handler.
  await openChatEditDialog()
  await archiveChat.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.conversation')).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect.poll(() => archives).toEqual([{ conversation_id: 'created-1' }])
  expect(mutations).toEqual([
    'rename_conversation', 'rename_conversation', 'archive_conversation'
  ])
})
