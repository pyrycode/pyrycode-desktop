import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'

// #1308 — the dialog the HOST row's plus opens, and the chat it starts in a folder no conversation has
// used yet. Only this tier can answer any of it: `vitest.config.ts` sets `environment: 'node'` and every
// renderer spec is a `renderToStaticMarkup` string assertion, so `ChannelList.test.tsx` owns the markup
// (which rows draw the plus) and `AddWorkspaceDialog.test.tsx` owns the dialog's own three-arm status
// matrix. Everything below is what needs a running window — a hover, a click, a typed field, a real
// command on the wire and a daemon answer coming back.
//
// A DEDICATED FILE, `sidebar-host-edit.spec.ts`'s stated reason: `host-row-hover-controls.spec.ts` owns
// the plus's reveal and drawn box, so the dialog gets its own launches exactly as the pen's did.
//
// ⭐ THE TWO DRIVES CALIBRATE EACH OTHER, and neither is sound alone. "The dialog closed" would pass just
// as happily against a Start chat that closed on its own click and never waited for anything — which is
// exactly the design this ticket rejects. The refusal drive runs the SAME click and reads the dialog still
// open afterwards, so the only thing that differs between the two outcomes is the daemon's answer. Read
// together they say the round trip is real; read apart, the first says only that a button worked.
//
// WHAT THIS TIER DOES NOT COVER, stated so a reader does not mistake the gap for coverage: the in-flight
// frame itself (a disabled field and action while the answer is outstanding) is not observable here,
// because the fake answers a create in the click's own frame. It is a pure function of the view's `status`
// prop and `AddWorkspaceDialog.test.tsx` server-renders all three arms of it directly. Withholding the
// reply to expose the frame would need a fixture seam this ticket deliberately did not build.
//
// SECRET HYGIENE: the only free text this drive types is a path IT authored, and every assertion reads a
// count, a class or that same harness-owned string. No daemon text is asserted on — nor could be: the
// refusal arm is nullary, so the window never receives one.

// The folder the operator types. Absolute (the client's one rule) and NOT the fixture's `/fake/workspace`,
// so the workspace row it produces is a NEW group and cannot be confused with the seeded one. Its last
// segment is what the sidebar labels the group with, and it is distinct from every other word this drive
// asserts on.
const NEW_FOLDER = '/srv/pyry/ledger-service'
const NEW_FOLDER_LABEL = 'ledger-service'

// A relative path, refused by the client before anything is sent (AC2). Deliberately NOT absolute-looking:
// the point is that the action never enables, so the daemon is never asked.
const RELATIVE_FOLDER = 'ledger-service'

// The client-owned failure copy (AC3), restated here rather than imported for the sibling specs' reason:
// it is what the user reads, so a copy change must redden this file loudly.
const ERROR_COPY = 'Could not start a chat in that folder'

// A create round trip crosses the relay forwarder and back, so the assertions after it carry headroom for
// a cold runner.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// ⭐ WHICH CHAT IS OPEN IS THE ONLY HONEST "IT NAVIGATED" DETECTOR HERE, and the trap it avoids is
// measured rather than theoretical: `launchPairedApp` CLICKS the single seeded row at launch, so this app
// is already on a thread — composer and all — before either drive starts. A `.composer` read would have
// been 1 all launch and would have passed with the navigation deleted. The marked row's TITLE moves,
// though: from the fixture's seeded name to the new chat's `name: null` placeholder, and back to nothing
// at all in the refusal drive. `sidebar-workspace-create.spec.ts`'s idiom, for the same reason.
const OPEN_ROW = '.channel-list__row-open[aria-current="true"]'
const UNTITLED = 'Untitled'
const SEEDED_TITLE = 'Seeded channel'

test('the host row’s plus starts a chat in a typed folder, and the workspace appears with it', async ({
  launchPairedApp
}) => {
  // ONE launch, ONE continuous drive. The stateful fake is what makes the follow-up `list_conversations`
  // answer with the minted row, which is what the sidebar actually renders.
  const { page } = await launchPairedApp({ buildReplyFrames: conversationStateFake() })

  const hostRows = page.locator('.channel-list__host')
  const hostLabel = hostRows.first().locator('.channel-list__host-label')
  const plus = page.locator('.channel-list__host-add')
  const dialog = page.locator('.add-workspace')
  const pathField = page.locator('.add-workspace__input')
  const start = page.locator('.add-workspace__start')
  const cancel = page.locator('.add-workspace__cancel')
  const workspaceLabels = page.locator('.channel-list__workspace-label')
  const openRow = page.locator(OPEN_ROW)

  // --- 1. THE PLUS IS DRAWN, on both of the machine's rows, which is the precondition the rest is about
  // and the exact claim `host-row-hover-controls.spec.ts` used to make in reverse. Read by accessible name
  // as well as by class: a control present in the DOM but missing from the accessibility tree passes the
  // class count and fails this. ---
  await expect(hostRows).toHaveCount(2)
  await expect(plus).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Add workspace' })).toHaveCount(2)

  // --- 2. Hover the row and click its plus. The hover is what reveals the control at all (`channels.css`
  // keys the swap on the row, not on the button), so clicking without it would be clicking a box at
  // opacity 0. The LABEL is hovered, not the plus: the reveal has to reach the row. ---
  await expect(dialog).toHaveCount(0)
  await hostLabel.hover()
  await plus.first().click()

  // --- 3. THE DIALOG OPENS EMPTY AND FOCUSED, and its action is refused until an absolute path is typed
  // (AC1, AC2). The focus read is `:focus` in a running window, which is the half the static tier can only
  // assert as an attribute. ---
  await expect(dialog).toHaveCount(1)
  await expect(pathField).toHaveValue('')
  await expect(pathField).toBeFocused()
  await expect(start).toBeDisabled()
  await expect(cancel).toBeEnabled()

  // A relative path leaves the action refused — the client rule, proven POSITIVELY by typing something
  // rather than by asserting the empty field twice. Nothing is sent here, which the create count in the
  // rejection drive below is what really pins; here it is the button state that matters.
  await pathField.fill(RELATIVE_FOLDER)
  await expect(start).toBeDisabled()

  // --- 4. Cancel closes and sends nothing (AC1), and the reopen starts CLEAN — the container is remounted
  // per open, so the abandoned draft above must not survive it. This is ordered before the real create so
  // the create runs from a field this drive has just watched reset. ---
  await cancel.click()
  await expect(dialog).toHaveCount(0)
  await hostLabel.hover()
  await plus.first().click()
  await expect(pathField).toHaveValue('')
  // The launch state of the navigation detector, established BEFORE the create so the read after it is a
  // mutation check: the fixture's own row click left the seeded chat open.
  await expect(openRow).toHaveText(SEEDED_TITLE)

  // --- 5. THE CRITERION. Type the absolute path and submit; the dialog closes on the daemon's
  // confirmation, the new chat's thread opens, and the folder appears as a workspace group in the Chats
  // tree labelled with its last segment (AC2).
  //
  // The dialog closing is read FIRST and it is the positive half: it can only happen on a confirmation
  // this run's own create earned, so the row assertions after it are statements about a workspace the
  // daemon minted rather than about a locator that was empty all launch. ---
  await pathField.fill(NEW_FOLDER)
  await expect(start).toBeEnabled()
  await start.click()
  await expect(dialog).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // The NEW chat's thread opened. The marked row moved off the seeded chat and onto the minted one, whose
  // `name: null` renders the client's placeholder — a mutation check against the value read above, not a
  // count that was already true at launch.
  await expect(openRow).toHaveText(UNTITLED, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // The workspace row. `allTextContents` over every group label is the arithmetic-safe read
  // (`sidebar-workspace-edit.spec.ts`'s idiom): the seeded group is still there, and the new one has
  // joined it — the last segment of the typed path, never the whole path.
  await expect(workspaceLabels.filter({ hasText: NEW_FOLDER_LABEL })).toHaveCount(1, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  // The typed path itself reaches NO attribute anywhere in the sidebar (AC3's sink rule, read back in a
  // running window rather than in a markup string). The label is the segment; the full path is not drawn.
  await expect(page.locator(`[title="${NEW_FOLDER}"]`)).toHaveCount(0)
})

test('a refused create leaves the dialog open with the failure line and draws no workspace', async ({
  launchPairedApp
}) => {
  // A SECOND launch against a fake that refuses every create with a correlated daemon `error` — the frame
  // main's `pendingCreateConversations` matches on to emit the bare `conversationCreateRejected` this
  // dialog is the first consumer of.
  const { page } = await launchPairedApp({
    buildReplyFrames: conversationStateFake({ createOutcome: 'rejected' })
  })

  const hostLabel = page.locator('.channel-list__host').first().locator('.channel-list__host-label')
  const plus = page.locator('.channel-list__host-add')
  const dialog = page.locator('.add-workspace')
  const pathField = page.locator('.add-workspace__input')
  const start = page.locator('.add-workspace__start')
  const error = page.locator('.add-workspace__error')
  const workspaceLabels = page.locator('.channel-list__workspace-label')
  const openRow = page.locator(OPEN_ROW)

  await hostLabel.hover()
  await plus.first().click()
  await expect(dialog).toHaveCount(1)
  // No error line before the refusal — the state the assertion below has to move away from, established
  // while the dialog is provably open rather than assumed.
  await expect(error).toHaveCount(0)

  await pathField.fill(NEW_FOLDER)
  await start.click()

  // --- THE CRITERION (AC3). The line appearing is the positive read and it comes FIRST: it can only
  // happen on a rejection this run's own create earned, so the two "nothing else happened" reads after it
  // are mutation checks rather than locators that were empty all launch. ---
  await expect(error).toHaveText(ERROR_COPY, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(dialog).toHaveCount(1)
  await expect(start).toBeEnabled()
  await expect(pathField).toBeEnabled()
  await expect(pathField).toHaveValue(NEW_FOLDER)
  // No row and no group: the fake minted nothing, so the sidebar has nothing new to draw and the chat the
  // launch opened is still the open one — the same detector the happy path watched MOVE, read here for
  // the value it must not have moved to.
  await expect(workspaceLabels.filter({ hasText: NEW_FOLDER_LABEL })).toHaveCount(0)
  await expect(openRow).toHaveText(SEEDED_TITLE)

  // Retrying is possible — the whole point of re-enabling the action. The line is still the only thing the
  // user is told, and a second refusal does not stack a second line.
  await start.click()
  await expect(error).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
})
