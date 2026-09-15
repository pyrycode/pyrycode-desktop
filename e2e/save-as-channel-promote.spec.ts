import type { Locator } from '@playwright/test'
import { test, expect, FIRST_SERVER_ID, type PairedApp } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope } from '../src/main/transport/codec'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import { MAX_SYSTEM_PROMPT_BYTES } from '../src/shared/wire/types'
import type { ConversationSummary, SetSystemPromptPayload } from '../src/shared/wire/types'

const CWD = '/home/alex/projects/demo'
const CANONICAL = '/home/alex/resolved/channels/release-planning/'
const TS = '2026-09-13T00:00:00Z'
const row = (id: string, name: string | null): ConversationSummary => ({ id, name, cwd: CWD,
  is_promoted: false, is_archived: false, workspace_label: null, last_message_ts: TS, last_used_at: TS })
const dialogOf = (app: PairedApp) => app.page.getByRole('dialog', { name: 'Save as channel', exact: true })
// The form carries two text boxes since #1429, so every reach for one names its field; an unscoped
// `getByRole('textbox')` is a strict-mode violation once the prompt box exists.
const nameField = (dialog: Locator) => dialog.getByRole('textbox', { name: 'Channel name:' })
const promptField = (dialog: Locator) => dialog.getByRole('textbox', { name: 'Channel system prompt:' })

// Seeds are `[id, name]` pairs in sidebar order — row order within a group is the daemon array's,
// nothing sorts — so a promoted row simply leaves Chats and the next seed takes index 0.
function controlled(...seeds: Array<[string, string | null]>) {
  const accepted = conversationStateFake({ conversations: seeds.map(([id, name]) => row(id, name)) })
  const requests: ReturnType<typeof decodeEnvelope>[] = []
  return {
    requests,
    // Every `set_system_prompt` payload this host received, in wire order.
    writes(): SetSystemPromptPayload[] {
      return requests.filter(request => request.type === 'set_system_prompt')
        .map(request => request.payload as SetSystemPromptPayload)
    },
    // `create_workspace_folder` is still captured though nothing should send it: a stray one would
    // trip the exact request-count assertions rather than passing unseen.
    reply(bytes: Uint8Array): Uint8Array[] {
      const request = decodeEnvelope(bytes)
      if (['create_workspace_folder', 'promote_conversation', 'create_conversation',
           'set_system_prompt'].includes(request.type)) requests.push(request)
      // A write is captured and left UNANSWERED: this dialog closes on dispatch and never waits for
      // the acknowledgement, so an unsettled marker in the app-level write store renders nowhere here.
      if (request.type === 'create_workspace_folder' || request.type === 'set_system_prompt') return []
      return accepted(bytes)
    }
  }
}

async function event(app: PairedApp, value: object): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, { channel, value }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, value)
  }, { channel: DAEMON_EVENT_CHANNEL, value })
  await app.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
}

async function open(app: PairedApp, index = 0, title = 'Existing chat') {
  await app.page.locator('.channel-list__save').nth(index).click({ force: true })
  const dialog = dialogOf(app)
  await expect(nameField(dialog)).toBeFocused()
  await expect(nameField(dialog)).toHaveValue(title)
  // #1436 withdrew the folder choice; #1429 added the prompt. The box opens EMPTY on every opening —
  // never seeded from the chat's stored prompt, and never carrying a discarded draft back (AC4).
  await expect(dialog.getByRole('radio')).toHaveCount(0)
  await expect(promptField(dialog)).toHaveValue('')
  return dialog
}

test('promotion keeps the original chat in its exact workspace and refreshes without duplication', async ({ launchPairedApp }) => {
  const first = controlled(['first-chat', 'Existing chat'])
  const second = controlled(['second-chat', 'Other chat'])
  const app = await launchPairedApp({ buildReplyFrames: first.reply },
    { secondServer: { buildReplyFrames: second.reply } })
  const dialog = await open(app)
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })
  await nameField(dialog).fill('   ')
  await expect(ok).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await open(app)
  await app.page.setViewportSize({ width: 1280, height: 800 })
  await app.page.screenshot({ path: '/tmp/builder-1436-save-modal-1280.png' })
  await app.page.setViewportSize({ width: 800, height: 600 })
  await expect(dialog).toHaveCSS('width', '640px')
  await app.page.screenshot({ path: '/tmp/builder-1436-save-modal-800.png' })
  await app.page.setViewportSize({ width: 800, height: 260 })
  expect(await dialog.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded()
  await app.page.screenshot({ path: '/tmp/builder-1436-save-modal-short.png' })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await app.page.setViewportSize({ width: 800, height: 600 })
  await open(app)
  await nameField(dialog).fill(' Release planning ')
  await ok.press('Enter')
  await expect.poll(() => first.requests.length).toBe(1)
  expect(first.requests[0]).toMatchObject({ type: 'promote_conversation',
    payload: { conversation_id: 'first-chat', cwd: CWD, name: 'Release planning' } })
  await expect(app.page.locator('.channel-list__rename')).toHaveCount(1)
  await expect(app.page.locator('.channel-list__row-open')).toHaveCount(2)
  await expect(app.page.locator('.channel-list__row-open').filter({ hasText: 'Release planning' })).toHaveCount(1)
  await expect(dialog).toHaveCount(0)
  expect(second.requests).toHaveLength(0)
  // Cross-host routing, inherited from the deleted dedicated test: promotion is addressed by
  // conversation id through the main process, so the second host's chat reaches the second daemon
  // and the first sees nothing further. The first row is promoted by now, so its save affordance is
  // gone and the remaining one is the second host's.
  const other = await open(app, 0, 'Other chat')
  await nameField(other).fill('Second host channel')
  await other.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => second.requests.length).toBe(1)
  expect(second.requests[0]).toMatchObject({ type: 'promote_conversation',
    payload: { conversation_id: 'second-chat', cwd: CWD, name: 'Second host channel' } })
  expect(first.requests).toHaveLength(1)
})

test('dismissal abandons the draft; reopening restores the Untitled default', async ({ launchPairedApp }) => {
  const fake = controlled(['untitled-chat', null])
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  for (const closeName of ['Cancel', 'Close dialog']) {
    const dialog = await open(app, 0, 'Untitled')
    await nameField(dialog).fill('Discarded idle')
    await dialog.getByRole('button', { name: closeName, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    // Dismissal sends nothing, and a stray folder reply is inert: since #1436 this dialog neither
    // requests a folder nor waits on one, so no reply can promote behind the operator's back.
    await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: CANONICAL })
    expect(fake.requests).toHaveLength(0)
  }
  // Each opening mounts fresh, so the discarded edits above leave no residue.
  const dialog = await open(app, 0, 'Untitled')
  await expect(dialog.getByRole('button', { name: 'OK', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => fake.requests.length).toBe(1)
  expect(fake.requests[0]).toMatchObject({ type: 'promote_conversation',
    payload: { conversation_id: 'untitled-chat', cwd: CWD, name: 'Untitled' } })
  await expect(app.page.locator('.channel-list__rename')).toHaveCount(1)
})

// #1429: the prompt is a SECOND command, but unlike its Create-channel sibling it needs no
// confirmation to hang on — the chat already exists and its id is the row's. So both commands leave
// one synchronous `onSave`, and what these drives pin is their ORDER and the empty-box branch.
//
// ONE PROMOTABLE ROW PER HOST, which is why this is two tests and not one. `launchPairedApp` bootstraps
// through an UNFILTERED `.channel-list__row-open` click in Playwright strict mode, so more than one row
// at launch breaks the fixture outright, and a promoted row loses its save affordance. Splitting rather
// than teaching the shared fixture (29 specs pass through it) to seed more also makes each ordered
// request assertion TIGHTER: a two-element array is a stronger proof of "the write goes out immediately
// after its own promote, and nothing else goes out" than the same claim buried in a longer one.
const OVER_LIMIT_NOTICE = `Over the ${MAX_SYSTEM_PROMPT_BYTES}-byte limit. Shorten it before saving.`
// Leading and trailing whitespace on purpose: the write carries the draft VERBATIM AND UNTRIMMED,
// unlike the name, which `requestPromoteConversation` trims. The U+2693 is 3 bytes over 1 code unit.
const PROMPT = '  Answer only in haiku. Keep every reply to three lines, and prefer a plain word ' +
  'over jargon wherever a plain word will do. ⚓  '

test('a typed prompt rides the promotion, addressed to the promoted row', async ({ launchPairedApp }) => {
  const fake = controlled(['haiku-chat', 'Haiku chat'])
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  const ok = () => dialogOf(app).getByRole('button', { name: 'OK', exact: true })
  const notice = () => dialogOf(app).getByText(OVER_LIMIT_NOTICE)
  const dialog = await open(app, 0, 'Haiku chat')

  // --- AC3, the byte gate. 8192 ASCII bytes sits ON the inclusive bound; swapping two of them for
  // one 3-byte anchor takes it over at FEWER code units, which is what separates a UTF-8 count from
  // a `.length` one — a `.length` gate would let this value through to a main process that refuses it.
  await expect(ok()).toBeEnabled()
  await promptField(dialog).fill('a'.repeat(MAX_SYSTEM_PROMPT_BYTES))
  await expect(notice()).toHaveCount(0)
  await expect(ok()).toBeEnabled()
  await promptField(dialog).fill('a'.repeat(MAX_SYSTEM_PROMPT_BYTES - 2) + '⚓')
  await expect(notice()).toBeVisible()
  await expect(ok()).toBeDisabled()
  await app.page.screenshot({ path: '/tmp/builder-1429-save-over-limit.png', animations: 'disabled' })

  // --- The write itself, against the row's OWN id: there is no confirmation in this flow, so nothing
  // a reply supplies can redirect it. ---
  await promptField(dialog).fill(PROMPT)
  await expect(notice()).toHaveCount(0)
  // The drawn state, at the design width and at the window minimum (AC1's Figma comparison).
  await app.page.setViewportSize({ width: 1280, height: 800 })
  await app.page.screenshot({ path: '/tmp/builder-1429-save-prompt-1280.png', animations: 'disabled' })
  await app.page.setViewportSize({ width: 800, height: 600 })
  await expect(dialog).toHaveCSS('width', '640px')
  await app.page.screenshot({ path: '/tmp/builder-1429-save-prompt-800.png', animations: 'disabled' })
  await ok().click()
  // Closes on dispatch, as it did before the write existed — nothing waits on the acknowledgement.
  await expect(dialogOf(app)).toHaveCount(0)
  await expect.poll(() => fake.requests.length).toBe(2)
  expect(fake.requests[0]).toMatchObject({ type: 'promote_conversation',
    payload: { conversation_id: 'haiku-chat', cwd: CWD, name: 'Haiku chat' } })
  expect(fake.writes()).toEqual([{ conversation_id: 'haiku-chat', system_prompt: PROMPT }])
  await expect(app.page.locator('.channel-list__rename')).toHaveCount(1)
  // Exactly two commands, in this order, and no second write behind the closed dialog.
  expect(fake.requests.map(request => request.type))
    .toEqual(['promote_conversation', 'set_system_prompt'])
})

test('an empty or whitespace-only box promotes exactly as before and sends no write', async ({ launchPairedApp }) => {
  const first = controlled(['blank-chat', 'Existing chat'])
  const second = controlled(['empty-chat', 'Other chat'])
  const app = await launchPairedApp({ buildReplyFrames: first.reply },
    { secondServer: { buildReplyFrames: second.reply } })

  // --- AC4's discard: a typed draft dies with the dismissal, and `open()` asserts the reopened box
  // is empty — so the whitespace fill below is the only thing in it. ---
  let dialog = await open(app, 0, 'Existing chat')
  await promptField(dialog).fill(PROMPT)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialogOf(app)).toHaveCount(0)
  dialog = await open(app, 0, 'Existing chat')
  await promptField(dialog).fill('   \n  ')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => first.requests.length).toBe(1)
  expect(first.requests[0]).toMatchObject({ type: 'promote_conversation',
    payload: { conversation_id: 'blank-chat', cwd: CWD, name: 'Existing chat' } })

  // --- And an untouched box on the second host's row. The first row is promoted by now, so its save
  // affordance is gone and the remaining one is the second host's. ---
  const other = await open(app, 0, 'Other chat')
  await other.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => second.requests.length).toBe(1)
  expect(second.requests[0]).toMatchObject({ type: 'promote_conversation',
    payload: { conversation_id: 'empty-chat', cwd: CWD, name: 'Other chat' } })

  // A blank box is not a clear: nothing is sent, so a prompt the chat already holds is kept.
  expect(first.requests.map(request => request.type)).toEqual(['promote_conversation'])
  expect(second.requests.map(request => request.type)).toEqual(['promote_conversation'])
  expect(first.writes()).toHaveLength(0)
  expect(second.writes()).toHaveLength(0)
})
