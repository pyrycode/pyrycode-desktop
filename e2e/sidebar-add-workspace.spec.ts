import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID, SECOND_SEEDED_ROW, type PairedApp } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import { MAX_PLAINTEXT_BYTES } from '../src/shared/wire/types'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary, RenameWorkspacePayload } from '../src/shared/wire/types'

// Mounted creation lifecycle, using real Noise/IPC and request-driven conversation list replies.

// The folder the operator types. Absolute for the older-host compatibility drive and NOT the fixture's `/fake/workspace`,
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
  const dialog = page.locator('.add-workspace-overlay .modal')
  const pathField = page.locator('.add-workspace__input:not(.add-workspace__name)')
  const start = page.locator('.add-workspace-overlay .modal__action--confirm')
  const cancel = page.locator('.add-workspace-overlay .modal__action--cancel')
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

  // This older host omits workspace_root, so relative input remains refused, proven by typing something
  // rather than by asserting the empty field twice. Nothing is sent here, which the create count in the
  // rejection drive below is what really pins; here it is the button state that matters.
  await pathField.fill(RELATIVE_FOLDER)
  await expect(start).toBeDisabled()
  await expect(page.locator('.add-workspace__error')).toHaveText('Host workspace location is unavailable')
  await expect(page.locator('.add-workspace__preview')).toBeEmpty()

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
  await expect(page.locator('.add-workspace__preview')).toHaveText(NEW_FOLDER)
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
  const dialog = page.locator('.add-workspace-overlay .modal')
  const pathField = page.locator('.add-workspace__input:not(.add-workspace__name)')
  const start = page.locator('.add-workspace-overlay .modal__action--confirm')
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
  await app.page.locator('.add-workspace__input:not(.add-workspace__name)').fill(NEW_FOLDER)
}

async function freezeTime(app: PairedApp): Promise<void> {
  await app.page.clock.install({ time: new Date('2026-09-12T12:00:00Z') })
  await app.page.clock.pauseAt(new Date('2026-09-12T12:00:01Z'))
}

const TIMEOUT_COPY = 'Could not confirm completion within 30 seconds. The chat may still appear.'
const OFFLINE_COPY = 'Connect this host before starting a chat'

function controlledNames(conversations?: ConversationSummary[], confirmed = NEW_FOLDER) {
  const state = conversationStateFake({ conversations })
  const creates: unknown[] = []
  const renames: Uint8Array[] = []
  let holdCreate = false
  let created: Uint8Array[] = []
  return {
    creates, renames,
    holdCreate() { holdCreate = true },
    reply(bytes: Uint8Array): Uint8Array[] {
      const request = decodeEnvelope(bytes)
      if (request.type === 'rename_workspace') { renames.push(bytes); return [] }
      if (request.type !== 'create_conversation') return state(bytes)
      creates.push(request.payload)
      // Model the daemon resolving a different actual folder, including in its stored list.
      const payload = request.payload as { cwd: string; name: null; is_promoted: boolean }
      created = state(encodeEnvelope({ ...request, payload: { ...payload, cwd: confirmed } }))
      return holdCreate ? [] : created
    },
    releaseCreate(app: PairedApp) { created.forEach(frame => app.daemon.pushFrame(frame)) },
    confirm(app: PairedApp, index = renames.length - 1) {
      state(renames[index]).forEach(frame => app.daemon.pushFrame(frame))
    },
    reject(app: PairedApp) {
      app.daemon.pushFrame(encodeEnvelope({ id: 90, type: 'error', ts: '2026-09-13T00:00:00Z',
        in_reply_to: decodeEnvelope(renames[renames.length - 1]).id,
        payload: { code: 'server.rejected', message: 'private daemon detail', retryable: false } }))
    }
  }
}

const nameField = '.add-workspace__name'
const folderField = '.add-workspace__input:not(.add-workspace__name)'
const confirmButton = '.add-workspace-overlay .modal__action--confirm'
const namingFailure = 'The chat was created. Could not save the workspace name. Edit it and retry, or leave it blank to finish.'

test('optional name uses the confirmed folder and refreshes only its host, even for an explicit fallback', async ({ launchPairedApp }) => {
  const confirmed = '/remote/actual/ledger-service'
  const first = controlledNames(undefined, confirmed)
  const second = conversationStateFake({ conversations: [{ ...SECOND_SEEDED_ROW, cwd: confirmed, workspace_label: 'Other host' }] })
  const app = await launchPairedApp({ buildReplyFrames: first.reply }, { secondServer: { buildReplyFrames: second } })
  await openWorkspace(app)
  const { page } = app
  await page.locator(nameField).fill('  ' + NEW_FOLDER_LABEL + '  ')
  await page.locator(confirmButton).click()
  await expect.poll(() => first.renames.length).toBe(1)
  expect(first.creates).toEqual([{ cwd: NEW_FOLDER, name: null, is_promoted: false }])
  expect(decodeEnvelope(first.renames[0]).payload).toEqual({ path: confirmed, label: NEW_FOLDER_LABEL })
  await expect(page.locator(nameField)).toBeDisabled()
  await expect(page.locator(folderField)).toBeDisabled()
  await expect(page.locator('output')).toHaveText(confirmed)
  await page.locator(confirmButton).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  first.releaseCreate(app)
  await expect(page.locator(OPEN_ROW)).toHaveText(UNTITLED)
  expect(first.creates).toHaveLength(1)
  expect(first.renames).toHaveLength(1)
  first.confirm(app)
  await expect(page.locator('.add-workspace-overlay')).toHaveCount(0)
  await expect(page.locator('.channel-list__workspace-label').filter({ hasText: NEW_FOLDER_LABEL })).toHaveCount(1)
  await expect(page.locator('.channel-list__workspace-label').filter({ hasText: 'Other host' })).toHaveCount(1)
})

test('blank names preserve existing shared labels and the UTF-16 boundary gates submission', async ({ launchPairedApp }) => {
  const fake = controlledNames([{ ...SECOND_SEEDED_ROW, id: 'only-seed', cwd: NEW_FOLDER, workspace_label: 'Existing shared name' }])
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  const { page } = app
  for (const blank of ['', '   ']) {
    await openWorkspace(app)
    await expect(page.locator(nameField)).toHaveValue('')
    await page.locator(nameField).fill('😀'.repeat(64) + 'x')
    await expect(page.locator(confirmButton)).toBeDisabled()
    await page.locator(nameField).fill('  ' + '😀'.repeat(64) + '  ')
    await expect(page.locator(confirmButton)).toBeEnabled()
    await page.locator(nameField).fill(blank)
    await page.locator(confirmButton).click()
    await expect(page.locator('.add-workspace-overlay')).toHaveCount(0)
    await expect(page.locator('.channel-list__workspace-label').filter({ hasText: 'Existing shared name' })).toHaveCount(1)
  }
  expect(fake.creates).toHaveLength(2)
  expect(fake.renames).toHaveLength(0)
})

test('rejection and deadline allow naming-only retry and isolate foreign, unsolicited and stale results', async ({ launchPairedApp }) => {
  const fake = controlledNames()
  const app = await launchPairedApp({ buildReplyFrames: fake.reply }, { secondServer: {} })
  await app.app.evaluate(({ ipcMain }) => {
    const attempts: string[] = []
    ;(globalThis as typeof globalThis & { workspaceAttempts: string[] }).workspaceAttempts = attempts
    ipcMain.on('pyry:command', (_event, command) => {
      if (command.type === 'renameWorkspace') attempts.push(command.attemptId)
    })
  })
  await freezeTime(app)
  await openWorkspace(app)
  const { page } = app
  await page.locator(nameField).fill('First name')
  await page.locator(confirmButton).click()
  await expect.poll(() => fake.renames.length).toBe(1)
  fake.reject(app)
  await expect(page.locator('.add-workspace__error')).toHaveText(namingFailure)
  await expect(page.locator(folderField)).toBeDisabled()
  await page.locator(nameField).fill('Corrected name')
  await page.locator(confirmButton).click()
  await expect.poll(() => fake.renames.length).toBe(2)
  // An unsolicited update still refreshes rows but cannot finish the form.
  const payload = decodeEnvelope(fake.renames[1]).payload as RenameWorkspacePayload
  app.daemon.pushFrame(encodeEnvelope({ id: 91, type: 'workspace_updated', ts: '2026-09-13T00:00:00Z', payload }))
  const attemptId = await app.app.evaluate(() =>
    (globalThis as typeof globalThis & { workspaceAttempts: string[] }).workspaceAttempts[1])
  expect(attemptId).toBeTruthy()
  for (const serverId of [SECOND_SERVER_ID, undefined, null, '', 42]) {
    await mainEvent(app, { type: 'workspaceRenameResult', serverId, attemptId, outcome: 'confirmed' })
  }
  await mainEvent(app, { type: 'workspaceRenameResult', serverId: FIRST_SERVER_ID, attemptId: 'unrelated', outcome: 'rejected' })
  fake.confirm(app, 0)
  fake.releaseCreate(app)
  await page.clock.runFor(29_999)
  await expect(page.locator(nameField)).toBeDisabled()
  await page.clock.runFor(1)
  await expect(page.locator('.add-workspace__error')).toContainText('Could not confirm the workspace name within 30 seconds')
  await page.locator(confirmButton).click()
  await expect.poll(() => fake.renames.length).toBe(3)
  fake.confirm(app, 1)
  await expect(page.locator('.channel-list__workspace-label').filter({ hasText: 'Corrected name' })).toHaveCount(1)
  await expect(page.locator(nameField)).toBeDisabled()
  fake.confirm(app, 2)
  await expect(page.locator('.add-workspace-overlay')).toHaveCount(0)
  expect(fake.creates).toHaveLength(1)
  expect(fake.renames).toHaveLength(3)
})

test('naming connection loss retains the chat and blank finishes without another rename', async ({ launchPairedApp }) => {
  const fake = controlledNames()
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  await openWorkspace(app)
  const { page } = app
  await page.locator(nameField).fill('Name')
  await page.locator(confirmButton).click()
  await expect.poll(() => fake.renames.length).toBe(1)
  await mainEvent(app, { type: 'disconnected', serverId: FIRST_SERVER_ID })
  await expect(page.locator('.add-workspace__error')).toContainText('Connect this host to retry')
  await expect(page.locator(confirmButton)).toBeDisabled()
  await expect(page.locator(folderField)).toBeDisabled()
  await expect(page.locator(nameField)).toBeEnabled()
  await page.locator(nameField).fill('  ')
  await page.locator(confirmButton).click()
  await expect(page.locator('.add-workspace-overlay')).toHaveCount(0)
  await expect(page.locator(OPEN_ROW)).toHaveText(UNTITLED)
  expect(fake.creates).toHaveLength(1)
  expect(fake.renames).toHaveLength(1)
})

for (const phase of ['creating', 'naming'] as const) {
  for (const exit of ['Cancel', 'Close dialog']) {
    test(`${exit} during ${phase} removes the naming transition and late waits`, async ({ launchPairedApp }) => {
      const fake = controlledNames()
      if (phase === 'creating') fake.holdCreate()
      const app = await launchPairedApp({ buildReplyFrames: fake.reply })
      await freezeTime(app)
      await openWorkspace(app)
      const { page } = app
      await page.locator(nameField).fill('Dismissed name')
      await page.locator(confirmButton).click()
      await expect.poll(() => fake.creates.length).toBe(1)
      if (phase === 'naming') await expect.poll(() => fake.renames.length).toBe(1)
      await page.getByRole('button', { name: exit, exact: true }).click()
      fake.releaseCreate(app)
      if (phase === 'naming') fake.confirm(app)
      await expect(page.locator(OPEN_ROW)).toHaveText(UNTITLED)
      await page.clock.runFor(30_000)
      await expect(page.locator('.add-workspace-overlay')).toHaveCount(0)
      await openWorkspace(app)
      await expect(page.locator(nameField)).toHaveValue('')
      await expect(page.locator('.add-workspace__error')).toHaveCount(0)
      expect(fake.renames).toHaveLength(phase === 'creating' ? 0 : 1)
      expect(fake.creates).toHaveLength(1)
    })
  }
}

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
  const start = page.locator('.add-workspace-overlay .modal__action--confirm')
  for (const type of ['connecting', 'disconnected', 'failed']) {
    await mainEvent(app, { type, serverId: FIRST_SERVER_ID,
      error: { code: 'transport', message: 'Connection unavailable', retryable: true } })
    await expect(start).toBeDisabled()
    await expect(page.locator('.channel-list__host').first().locator('.channel-list__host-add')).toHaveCount(0)
    await expect(page.locator('.add-workspace__input:not(.add-workspace__name)')).toHaveValue(NEW_FOLDER)
    await expect(page.locator('.add-workspace__error')).toHaveText(OFFLINE_COPY)
    await start.evaluate((button: HTMLButtonElement) => button.click())
    expect(fake.count()).toBe(0)
  }
  // A real redial earns a new authenticated acknowledgement, restoring submission eligibility.
  app.forwarder.dropClientLeg()
  await expect(start).toBeEnabled()
  await start.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); button.click() })
  await expect.poll(fake.count).toBe(1)
  await expect(page.locator('.add-workspace__input:not(.add-workspace__name)')).toBeDisabled()
  await start.evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  app.forwarder.dropClientLeg()
  await expect(page.locator('.add-workspace__error')).toHaveText(OFFLINE_COPY)
  await expect(page.locator('.add-workspace__input:not(.add-workspace__name)')).toBeEnabled()
  await page.screenshot({ path: '/tmp/builder-1372-disconnected.png' })
  await expect(start).toBeEnabled({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await page.clock.runFor(30_000)
  expect(fake.count()).toBe(1)
  fake.outcome('success')
  await start.click()
  await expect.poll(fake.count).toBe(2)
  await expect(page.locator('.add-workspace-overlay .modal')).toHaveCount(0)
})

test('host-isolated results, uncertain deadline and late success keep the existing navigation', async ({ launchPairedApp }) => {
  const fake = controlledCreates()
  const other = controlledCreates([SECOND_SEEDED_ROW])
  other.outcome('reject')
  const app = await launchPairedApp({ buildReplyFrames: fake.reply }, { secondServer: { buildReplyFrames: other.reply } })
  await freezeTime(app)
  await app.page.setViewportSize({ width: 800, height: 600 })
  await openWorkspace(app)
  await app.page.screenshot({ path: '/tmp/builder-1372-ready-800.png' })
  const { page } = app
  await page.locator('.add-workspace-overlay .modal__action--confirm').click()
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
  await expect(page.locator('.add-workspace__input:not(.add-workspace__name)')).toBeDisabled()
  await expect(page.locator('.add-workspace__error')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/builder-1372-pending-800.png' })
  await page.clock.runFor(29_999)
  await expect(page.locator('.add-workspace__input:not(.add-workspace__name)')).toBeDisabled()
  await page.clock.runFor(1)
  await expect(page.locator('.add-workspace__error')).toHaveText(TIMEOUT_COPY)
  await expect(page.locator('.add-workspace__input:not(.add-workspace__name)')).toHaveValue(NEW_FOLDER)
  await expect(page.locator('.add-workspace-overlay .modal__action--confirm')).toBeEnabled()
  await expect(page.locator('.add-workspace-overlay .modal__action--cancel')).toBeEnabled()
  expect(fake.count()).toBe(1)
  await page.screenshot({ path: '/tmp/builder-1372-timeout-800.png' })
  fake.release(app)
  await expect(page.locator('.add-workspace-overlay .modal')).toHaveCount(0)
  await expect(page.locator(OPEN_ROW)).toHaveText(UNTITLED)
  await expect(page.locator('.channel-list__workspace-label').filter({ hasText: NEW_FOLDER_LABEL })).toHaveCount(1)
  fake.reject(app)
  await page.clock.runFor(30_000)
  await expect(page.locator('.add-workspace-overlay .modal')).toHaveCount(0)
  expect(fake.count()).toBe(1)
})

test('server rejection permits an explicit retry whose wait survives the old deadline', async ({ launchPairedApp }) => {
  const fake = controlledCreates()
  const app = await launchPairedApp({ buildReplyFrames: fake.reply }, { secondServer: {} })
  await freezeTime(app)
  await openWorkspace(app)
  const { page } = app
  await page.locator('.add-workspace-overlay .modal__action--confirm').click()
  await expect.poll(fake.count).toBe(1)
  await page.clock.runFor(20_000)
  fake.reject(app)
  await expect(page.locator('.add-workspace__error')).toHaveText(ERROR_COPY)
  await expect(page.locator('.add-workspace__input:not(.add-workspace__name)')).toHaveValue(NEW_FOLDER)
  await page.screenshot({ path: '/tmp/builder-1372-rejection.png' })
  await page.locator('.add-workspace-overlay .modal__action--confirm').click()
  await expect.poll(fake.count).toBe(2)
  await page.clock.runFor(10_000)
  await expect(page.locator('.add-workspace__input:not(.add-workspace__name)')).toBeDisabled()
  await expect(page.locator('.add-workspace__error')).toHaveCount(0)
  fake.release(app)
  await expect(page.locator('.add-workspace-overlay .modal')).toHaveCount(0)
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
  await page.locator('.add-workspace__input:not(.add-workspace__name)').fill(oversized)
  await page.locator('.add-workspace-overlay .modal__action--confirm').click()
  await expect(page.locator('.add-workspace__error')).toHaveText(ERROR_COPY)
  await expect(page.locator('.add-workspace__input:not(.add-workspace__name)')).toHaveValue(oversized)
  expect(fake.count()).toBe(0)
  await page.locator('.add-workspace__input:not(.add-workspace__name)').fill(NEW_FOLDER)
  await page.locator('.add-workspace-overlay .modal__action--confirm').click()
  await expect.poll(fake.count).toBe(1)
  await expect(page.locator('.add-workspace-overlay .modal__action--cancel')).toBeEnabled()
  await page.locator('.add-workspace-overlay .modal__action--cancel').click()
  await expect(page.locator('.add-workspace-overlay .modal')).toHaveCount(0)
  fake.reject(app)
  fake.release(app)
  await page.clock.runFor(30_000)
  await expect(page.locator('.add-workspace-overlay .modal')).toHaveCount(0)
  await openWorkspace(app)
  await expect(page.locator('.add-workspace__error')).toHaveCount(0)
  expect(fake.count()).toBe(1)
  // Window reload unmounts a pending attempt; its old timer/results cannot affect a fresh dialog.
  await page.locator('.add-workspace-overlay .modal__action--confirm').click()
  await expect.poll(fake.count).toBe(2)
  await page.reload()
  await expect(page.locator('.add-workspace-overlay .modal')).toHaveCount(0)
  fake.release(app)
  await openWorkspace(app)
  await expect(page.locator('.add-workspace__error')).toHaveCount(0)
  expect(fake.count()).toBe(2)
})


test('each host resolves its own greeting base and sends exactly the previewed destination', async ({ launchPairedApp }) => {
  const sent: { host: string; payload: unknown }[] = []
  const first = conversationStateFake()
  const second = conversationStateFake({ conversations: [SECOND_SEEDED_ROW] })
  const capture = (host: string, reply: typeof first) => (bytes: Uint8Array) => {
    const request = decodeEnvelope(bytes)
    if (request.type === 'create_conversation') sent.push({ host, payload: request.payload })
    return reply(bytes)
  }
  const app = await launchPairedApp({
    helloAck: { workspace_root: '/home/pyry/pyry-workspace/' },
    buildReplyFrames: capture('first', first)
  }, { secondServer: {
    helloAck: { workspace_root: '/other/base' },
    buildReplyFrames: capture('second', second)
  } })
  const { page } = app
  for (const [index, base, host] of [[0, '/home/pyry/pyry-workspace', 'first'], [1, '/other/base', 'second']] as const) {
    const row = page.locator('.channel-list__host').nth(index)
    await row.hover()
    const label = await row.locator('.channel-list__host-label').textContent()
    await row.locator('.channel-list__host-add').click()
    const dialog = page.getByRole('dialog', { name: 'Add workspace' })
    await expect(dialog.locator('.add-workspace__detail').first()).toHaveText('Host:' + label)
    await expect(dialog.locator('.add-workspace__input:not(.add-workspace__name)')).toBeFocused()
    await expect(dialog.locator('.add-workspace__preview')).toBeEmpty()
    await dialog.getByRole('textbox', { name: 'Workspace folder on the host (relative or absolute path):' }).fill('  my-project  ')
    const destination = base + '/my-project'
    await expect(dialog.locator('output')).toHaveText(destination)
    await dialog.getByRole('button', { name: 'OK', exact: true }).click()
    await expect.poll(() => sent.length).toBe(index + 1)
    expect(sent[index]).toEqual({ host, payload: { cwd: destination, name: null, is_promoted: false } })
    await expect(dialog).toHaveCount(0)
  }
})

test('shared modal keeps keyboard exits and scrolling reachable at normal and short sizes', async ({ launchPairedApp }) => {
  const fake = controlledCreates()
  const app = await launchPairedApp({ helloAck: { workspace_root: '/home/pyry/pyry-workspace' }, buildReplyFrames: fake.reply })
  const { page } = app
  await page.setViewportSize({ width: 1280, height: 800 })
  const plus = page.locator('.channel-list__host-add').first()
  await plus.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Add workspace' })
  await expect(dialog.getByRole('textbox', { name: 'Workspace folder on the host (relative or absolute path):' })).toBeFocused()
  await dialog.getByRole('textbox', { name: 'Workspace folder on the host (relative or absolute path):' }).fill('my-project')
  await expect(dialog.locator('output')).toHaveText('/home/pyry/pyry-workspace/my-project')
  await expect(dialog.locator('.modal__close img')).toHaveJSProperty('naturalWidth', 28)
  await page.screenshot({ path: '/tmp/builder-1372-normal-1280x800.png' })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page.locator('.add-workspace-overlay__scrim').click({ position: { x: 5, y: 5 } })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  expect(fake.count()).toBe(0)

  await plus.focus()
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('textbox', { name: 'Workspace folder on the host (relative or absolute path):' })).toHaveValue('')
  await dialog.getByRole('textbox', { name: 'Workspace folder on the host (relative or absolute path):' }).fill('parent/' + 'nested-project-'.repeat(12))
  await page.setViewportSize({ width: 800, height: 240 })
  await expect(dialog.locator('output')).toContainText('/home/pyry/pyry-workspace/parent/')
  await page.screenshot({ path: '/tmp/builder-1372-short-800x240.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })
  await ok.focus()
  await page.keyboard.press('Enter')
  await expect.poll(fake.count).toBe(1)
  await expect(dialog.getByRole('textbox', { name: 'Workspace folder on the host (relative or absolute path):' })).toBeDisabled()
  const close = dialog.getByRole('button', { name: 'Close dialog' })
  await close.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  fake.reject(app)
  fake.release(app)
  await plus.focus()
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('textbox', { name: 'Workspace folder on the host (relative or absolute path):' })).toHaveValue('')
  await expect(dialog.locator('.add-workspace__error')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(fake.count()).toBe(1)
})

test('a local rename build failure leaves the created chat usable and retries naming only', async ({ launchPairedApp }) => {
  const confirmed = '/' + 'p'.repeat(MAX_PLAINTEXT_BYTES - 800)
  const fake = controlledNames(undefined, confirmed)
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  await openWorkspace(app)
  const { page } = app
  // JSON escaping makes this valid 128-code-unit name exceed the wire cap beside the long cwd.
  await page.locator(nameField).fill('\u0001'.repeat(128))
  await page.locator(confirmButton).click()
  await expect(page.locator('.add-workspace__error')).toHaveText(namingFailure)
  await expect(page.locator(OPEN_ROW)).toHaveText(UNTITLED)
  await expect(page.locator(folderField)).toBeDisabled()
  expect(fake.creates).toHaveLength(1)
  expect(fake.renames).toHaveLength(0)
  await page.locator(nameField).fill('Short name')
  await page.locator(confirmButton).click()
  await expect.poll(() => fake.renames.length).toBe(1)
  expect(decodeEnvelope(fake.renames[0]).payload).toEqual({ path: confirmed, label: 'Short name' })
  fake.confirm(app)
  await expect(page.locator('.add-workspace-overlay')).toHaveCount(0)
  expect(fake.creates).toHaveLength(1)
})

test('an unavailable rename route rejects the identified attempt with its selected-host stamp', async ({ launchPairedApp }) => {
  const { page } = await launchPairedApp({ buildReplyFrames: conversationStateFake() })
  const result = await page.evaluate(() => new Promise(resolve => {
    const off = window.pyry.onDaemonEvent(event => {
      if (event.type === 'workspaceRenameResult') { off(); resolve(event) }
    })
    window.pyry.sendCommand({ type: 'renameWorkspace', serverId: 'missing-host', attemptId: 'missing-route',
      payload: { path: '/remote', label: 'Name' } })
  }))
  expect(result).toEqual({ type: 'workspaceRenameResult', serverId: 'missing-host',
    attemptId: 'missing-route', outcome: 'rejected' })
})
