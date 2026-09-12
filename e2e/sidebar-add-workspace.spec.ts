import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID, SECOND_SEEDED_ROW, type PairedApp } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import { MAX_PLAINTEXT_BYTES } from '../src/shared/wire/types'
import { conversationStateFake } from './fixtures/conversationStateFake'

// Mounted creation lifecycle, using real Noise/IPC and request-driven conversation list replies.

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

// The wrapper controls only delivery/outcome; the existing fake owns daemon state and list replies.
function controlledCreates(conversations?: typeof SECOND_SEEDED_ROW[]) {
  const accepted = conversationStateFake({ conversations })
  const rejected = conversationStateFake({ conversations, createOutcome: 'rejected' })
  let outcome: 'hold' | 'success' | 'reject' = 'hold'
  let count = 0
  let requestId = 0
  let held: Uint8Array[] = []
  return {
    reply(bytes: Uint8Array): Uint8Array[] {
      const request = decodeEnvelope(bytes)
      if (request.type !== 'create_conversation') return accepted(bytes)
      count++
      requestId = request.id
      if (outcome === 'reject') return rejected(bytes)
      const frames = accepted(bytes)
      if (outcome === 'success') return frames
      held = frames
      return []
    },
    count: () => count,
    outcome(next: typeof outcome) { outcome = next },
    release(app: PairedApp) { held.forEach((frame) => app.daemon.pushFrame(frame)); held = [] },
    reject(app: PairedApp) {
      app.daemon.pushFrame(encodeEnvelope({ id: 90, type: 'error', ts: '2026-09-12T00:00:00Z',
        in_reply_to: requestId, payload: { code: 'server.rejected', message: 'private rejection detail', retryable: false } }))
    }
  }
}

async function mainEvent(app: PairedApp, event: object): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, { channel, event }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, event)
  }, { channel: DAEMON_EVENT_CHANNEL, event })
}

async function openWorkspace(app: PairedApp): Promise<void> {
  const host = app.page.locator('.channel-list__host').first()
  await host.hover()
  await host.locator('.channel-list__host-add').click()
  await app.page.locator('.add-workspace__input').fill(NEW_FOLDER)
}

async function freezeTime(app: PairedApp): Promise<void> {
  await app.page.clock.install({ time: new Date('2026-09-12T12:00:00Z') })
  await app.page.clock.pauseAt(new Date('2026-09-12T12:00:01Z'))
}

const TIMEOUT_COPY = 'Could not confirm completion within 30 seconds. The chat may still appear.'
const OFFLINE_COPY = 'Connect this host before starting a chat'

test('a missing selected-host status withholds entry while another host stays connected', async ({ launchPairedApp }) => {
  const fake = controlledCreates()
  const app = await launchPairedApp({ buildReplyFrames: fake.reply }, { secondServer: {} })
  // Reload while withholding A's status snapshot to exercise a truly missing per-host slot.
  await app.app.evaluate(({ BrowserWindow }, { channel, serverId }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const send = contents.send.bind(contents)
    contents.send = (name, ...args) => {
      if (name === channel && args[0]?.serverId === serverId &&
        ['connecting', 'connected', 'disconnected', 'failed'].includes(args[0]?.type)) return
      send(name, ...args)
    }
  }, { channel: DAEMON_EVENT_CHANNEL, serverId: FIRST_SERVER_ID })
  await app.page.reload()
  await expect(app.page.locator('.channel-list__host')).toHaveCount(4)
  const selected = app.page.locator('.channel-list__host').first()
  await expect(selected.locator('.channel-list__host-add')).toHaveCount(0)
  await expect(app.page.getByRole('img', { name: 'Pyrycode Connected', exact: true })).toHaveCount(2)
  expect(fake.count()).toBe(0)
})

test('connection state gates an open form and loss during submission ends waiting without resending', async ({ launchPairedApp }) => {
  const fake = controlledCreates()
  const app = await launchPairedApp({ buildReplyFrames: fake.reply }, { secondServer: {} })
  await freezeTime(app)
  await openWorkspace(app)
  const { page } = app
  const start = page.locator('.add-workspace__start')
  for (const type of ['connecting', 'disconnected', 'failed']) {
    await mainEvent(app, { type, serverId: FIRST_SERVER_ID,
      error: { code: 'transport', message: 'Connection unavailable', retryable: true } })
    await expect(start).toBeDisabled()
    await expect(page.locator('.channel-list__host').first().locator('.channel-list__host-add')).toHaveCount(0)
    await expect(page.locator('.add-workspace__input')).toHaveValue(NEW_FOLDER)
    await expect(page.locator('.add-workspace__error')).toHaveText(OFFLINE_COPY)
    await start.evaluate((button: HTMLButtonElement) => button.click())
    expect(fake.count()).toBe(0)
  }
  // A real redial earns a new authenticated acknowledgement, restoring submission eligibility.
  app.forwarder.dropClientLeg()
  await expect(start).toBeEnabled()
  await start.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); button.click() })
  await expect.poll(fake.count).toBe(1)
  await expect(page.locator('.add-workspace__input')).toBeDisabled()
  await start.evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  app.forwarder.dropClientLeg()
  await expect(page.locator('.add-workspace__error')).toHaveText(OFFLINE_COPY)
  await expect(page.locator('.add-workspace__input')).toBeEnabled()
  await page.screenshot({ path: '/tmp/builder-1367-disconnected.png' })
  await expect(start).toBeEnabled({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await page.clock.runFor(30_000)
  expect(fake.count()).toBe(1)
  fake.outcome('success')
  await start.click()
  await expect.poll(fake.count).toBe(2)
  await expect(page.locator('.add-workspace')).toHaveCount(0)
})

test('host-isolated results, uncertain deadline and late success keep the existing navigation', async ({ launchPairedApp }) => {
  const fake = controlledCreates()
  const other = controlledCreates([SECOND_SEEDED_ROW])
  other.outcome('reject')
  const app = await launchPairedApp({ buildReplyFrames: fake.reply }, { secondServer: { buildReplyFrames: other.reply } })
  await freezeTime(app)
  await app.page.setViewportSize({ width: 800, height: 600 })
  await openWorkspace(app)
  await app.page.screenshot({ path: '/tmp/builder-1367-ready-800.png' })
  const { page } = app
  await page.locator('.add-workspace__start').click()
  await expect.poll(fake.count).toBe(1)
  const foreignCreate = () => page.evaluate((serverId) => window.pyry.sendCommand({
    type: 'createConversation', serverId, payload: { cwd: '/other-host', name: null, is_promoted: false }
  }), SECOND_SERVER_ID)
  app.servers[1].daemon.pushFrame(encodeEnvelope({ id: 80, type: 'conversation_created',
    ts: '2026-09-12T00:00:00Z', payload: { id: 'other-created', is_promoted: false,
      cwd: '/other-host', name: null, last_used_at: '2026-09-12T00:00:00Z', workspace_label: null } }))
  await foreignCreate()
  await expect.poll(other.count).toBe(1)
  for (const serverId of [undefined, null, '', 42, {}]) {
    await mainEvent(app, { type: 'conversationCreateRejected', serverId })
    await mainEvent(app, { type: 'conversationCreated', serverId, conversation: {
      id: 'invalid-origin', is_promoted: false, cwd: '/invalid-origin', name: null,
      last_used_at: '2026-09-12T00:00:00Z', workspace_label: null
    } })
  }
  await expect(page.locator('.add-workspace__input')).toBeDisabled()
  await expect(page.locator('.add-workspace__error')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/builder-1367-pending-800.png' })
  await page.clock.runFor(29_999)
  await expect(page.locator('.add-workspace__input')).toBeDisabled()
  await page.clock.runFor(1)
  await expect(page.locator('.add-workspace__error')).toHaveText(TIMEOUT_COPY)
  await expect(page.locator('.add-workspace__input')).toHaveValue(NEW_FOLDER)
  await expect(page.locator('.add-workspace__start')).toBeEnabled()
  await expect(page.locator('.add-workspace__cancel')).toBeEnabled()
  expect(fake.count()).toBe(1)
  await page.screenshot({ path: '/tmp/builder-1367-timeout-800.png' })
  fake.release(app)
  await expect(page.locator('.add-workspace')).toHaveCount(0)
  await expect(page.locator(OPEN_ROW)).toHaveText(UNTITLED)
  await expect(page.locator('.channel-list__workspace-label').filter({ hasText: NEW_FOLDER_LABEL })).toHaveCount(1)
  fake.reject(app)
  await page.clock.runFor(30_000)
  await expect(page.locator('.add-workspace')).toHaveCount(0)
  expect(fake.count()).toBe(1)
})

test('server rejection permits an explicit retry whose wait survives the old deadline', async ({ launchPairedApp }) => {
  const fake = controlledCreates()
  const app = await launchPairedApp({ buildReplyFrames: fake.reply }, { secondServer: {} })
  await freezeTime(app)
  await openWorkspace(app)
  const { page } = app
  await page.locator('.add-workspace__start').click()
  await expect.poll(fake.count).toBe(1)
  await page.clock.runFor(20_000)
  fake.reject(app)
  await expect(page.locator('.add-workspace__error')).toHaveText(ERROR_COPY)
  await expect(page.locator('.add-workspace__input')).toHaveValue(NEW_FOLDER)
  await page.screenshot({ path: '/tmp/builder-1367-rejection.png' })
  await page.locator('.add-workspace__start').click()
  await expect.poll(fake.count).toBe(2)
  await page.clock.runFor(10_000)
  await expect(page.locator('.add-workspace__input')).toBeDisabled()
  await expect(page.locator('.add-workspace__error')).toHaveCount(0)
  fake.release(app)
  await expect(page.locator('.add-workspace')).toHaveCount(0)
  await page.clock.runFor(30_000)
  expect(fake.count()).toBe(2)
})

test('local build failure ends busy immediately and pending cancellation removes the local wait', async ({ launchPairedApp }) => {
  const fake = controlledCreates()
  const app = await launchPairedApp({ buildReplyFrames: fake.reply }, { secondServer: {} })
  await freezeTime(app)
  await openWorkspace(app)
  const { page } = app
  const oversized = '/' + 'p'.repeat(MAX_PLAINTEXT_BYTES)
  await page.locator('.add-workspace__input').fill(oversized)
  await page.locator('.add-workspace__start').click()
  await expect(page.locator('.add-workspace__error')).toHaveText(ERROR_COPY)
  await expect(page.locator('.add-workspace__input')).toHaveValue(oversized)
  expect(fake.count()).toBe(0)
  await page.locator('.add-workspace__input').fill(NEW_FOLDER)
  await page.locator('.add-workspace__start').click()
  await expect.poll(fake.count).toBe(1)
  await expect(page.locator('.add-workspace__cancel')).toBeEnabled()
  await page.locator('.add-workspace__cancel').click()
  await expect(page.locator('.add-workspace')).toHaveCount(0)
  fake.reject(app)
  fake.release(app)
  await page.clock.runFor(30_000)
  await expect(page.locator('.add-workspace')).toHaveCount(0)
  await openWorkspace(app)
  await expect(page.locator('.add-workspace__error')).toHaveCount(0)
  expect(fake.count()).toBe(1)
  // Window reload unmounts a pending attempt; its old timer/results cannot affect a fresh dialog.
  await page.locator('.add-workspace__start').click()
  await expect.poll(fake.count).toBe(2)
  await page.reload()
  await expect(page.locator('.add-workspace')).toHaveCount(0)
  fake.release(app)
  await openWorkspace(app)
  await expect(page.locator('.add-workspace__error')).toHaveCount(0)
  expect(fake.count()).toBe(2)
})
