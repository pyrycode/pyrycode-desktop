import type { Locator } from '@playwright/test'
import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID, type PairedApp } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import { MAX_SYSTEM_PROMPT_BYTES } from '../src/shared/wire/types'
import type {
  ConversationCreatedPayload,
  ConversationSummary,
  SetSystemPromptPayload,
  SetSessionSettingsPayload,
  WireModelOption,
  CreateConversationPayload
} from '../src/shared/wire/types'

const CWD = '/home/alex/projects/demo'
const CANONICAL = '/home/alex/resolved/channels/release-planning/'
const row = (id: string): ConversationSummary => ({ id, name: 'Seeded channel', cwd: CWD,
  is_promoted: true, is_archived: false, workspace_label: null,
  last_message_ts: '2026-09-13T00:00:00Z', last_used_at: '2026-09-13T00:00:00Z' })
const dialogOf = (app: PairedApp) => app.page.getByRole('dialog', { name: 'Create channel', exact: true })
// The form carries two text boxes since #1428, so every reach for one names its field.
const nameField = (dialog: Locator) => dialog.getByRole('textbox', { name: 'Channel name:' })
const promptField = (dialog: Locator) => dialog.getByRole('textbox', { name: 'Channel system prompt:' })

function controlled(id: string) {
  const accepted = conversationStateFake({ conversations: [row(id)] })
  const requests: ReturnType<typeof decodeEnvelope>[] = []
  // The ids the fake minted, in create order — read at capture time, since `release` clears the held
  // frames. A prompt write must address the id of the create this dialog asked for.
  const created: string[] = []
  let frames: Uint8Array[] = []
  return {
    requests,
    created,
    // Every `set_system_prompt` payload this host received, in wire order.
    writes(): SetSystemPromptPayload[] {
      return requests.filter(r => r.type === 'set_system_prompt')
        .map(r => r.payload as SetSystemPromptPayload)
    },
    reply(bytes: Uint8Array): Uint8Array[] {
      const request = decodeEnvelope(bytes)
      if (request.type === 'create_workspace_folder' || request.type === 'create_conversation' ||
          request.type === 'set_system_prompt') {
        requests.push(request)
        if (request.type === 'create_conversation') {
          frames = accepted(bytes)
          const reply = frames.map(decodeEnvelope).find(e => e.type === 'conversation_created')
          if (reply !== undefined) created.push((reply.payload as ConversationCreatedPayload).id)
        }
        // A write is captured and left unanswered: the dialog never waits for its acknowledgement,
        // and an unsettled marker in the app-level write store renders nowhere in this drive.
        return []
      }
      return accepted(bytes)
    },
    release(app: PairedApp, host = 0) {
      frames.forEach(frame => app.servers[host].daemon.pushFrame(frame))
      frames = []
    },
    reject(app: PairedApp, host = 0) {
      app.servers[host].daemon.pushFrame(encodeEnvelope({ id: 901, type: 'error',
        ts: '2026-09-13T00:00:00Z', in_reply_to: requests.at(-1)!.id,
        payload: { code: 'server.rejected', message: 'private daemon detail', retryable: false } }))
    }
  }
}

async function event(app: PairedApp, value: object): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, { channel, value }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, value)
  }, { channel: DAEMON_EVENT_CHANNEL, value })
  // IPC delivery and the following renderer barrier establish a completed observation turn.
  await app.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
}

async function open(app: PairedApp, index = 0) {
  await app.page.getByRole('button', { name: 'Create channel', exact: true }).nth(index).click()
  const dialog = dialogOf(app)
  await expect(nameField(dialog)).toBeFocused()
  await expect(nameField(dialog)).toHaveValue('')
  // #1436 withdrew the folder choice; #1428 added the prompt. Both drafts start empty on every
  // opening — a reopen never carries a discarded prompt back (AC4).
  await expect(dialog.getByRole('radio')).toHaveCount(0)
  await expect(promptField(dialog)).toHaveValue('')
  return dialog
}

const modelRow = (value: string, display_name: string, agent?: 'claude' | 'codex'): WireModelOption => ({
  value, display_name, agent, resolved_model: value, effort_levels: ['low', 'high'],
  supports_auto_mode: false, truncated_fields: null
})
const mergedModels = [modelRow('default', 'Inherited'), modelRow('fable', 'Fable'),
  modelRow('opus', 'Opus'), modelRow('sonnet', 'Sonnet'), modelRow('haiku', 'Haiku'),
  modelRow('gpt-6-sol', 'GPT-6 Sol', 'codex'), modelRow('gpt-6-luna', 'GPT-6 Luna', 'codex'),
  modelRow('gpt-5.6-terra', 'GPT-5.6 Terra', 'codex'), modelRow('gpt-6-astra', 'GPT-6 Astra', 'codex')]
const modelFrame = (type: string, payload: unknown, in_reply_to?: number) => encodeEnvelope({
  id: 902, ts: '2026-10-01T00:00:00Z', type, payload, in_reply_to
})

// Local scenario fake: a refused create never reaches the stateful fake's minting arm.
function modelControlled(id: string, models: WireModelOption[] | null) {
  const accepted = conversationStateFake({ conversations: [row(id)] })
  const requests: ReturnType<typeof decodeEnvelope>[] = []
  const choices = new Map<string, CreateConversationPayload>()
  let held: Uint8Array | null = null
  let effort = 'high'
  let effortWrite: ReturnType<typeof decodeEnvelope> | undefined
  const withAgent = (record: ConversationSummary | ConversationCreatedPayload) => ({
    ...record, agent: choices.get(record.id)?.agent ?? 'claude'
  })
  const reflectChoices = (frames: Uint8Array[]) => frames.map(bytes => {
    const frame = decodeEnvelope(bytes)
    if (frame.type === 'conversation_created') frame.payload = withAgent(frame.payload as ConversationCreatedPayload)
    if (frame.type === 'conversations') {
      const p = frame.payload as { conversations: ConversationSummary[] }
      frame.payload = { ...p, conversations: p.conversations.map(withAgent) }
    }
    return encodeEnvelope(frame)
  })
  return {
    requests,
    reply(bytes: Uint8Array): Uint8Array[] {
      const request = decodeEnvelope(bytes)
      requests.push(request)
      if (request.type === 'request_model_list') {
        const p = request.payload as { conversation_id: string }
        return models === null ? [] : [modelFrame('model_list', {
          conversation_id: p.conversation_id, models, dropped_models: 0
        })]
      }
      if (request.type === 'request_session_settings') {
        const p = request.payload as { conversation_id: string }
        const choice = choices.get(p.conversation_id)
        return [modelFrame('session_settings', { session_id: 'session-' + p.conversation_id,
          model: choice?.model ?? '', effort: choice?.effort ?? (p.conversation_id === id ? effort : ''),
          permission_mode: 'default', yolo: false, used_tokens: 0, window_tokens: 200000 }, request.id)]
      }
      if (request.type === 'set_session_settings') { effortWrite = request; return [] }
      if (request.type === 'create_conversation') { held = bytes; return [] }
      return reflectChoices(accepted(bytes))
    },
    remember(app: PairedApp) {
      expect(effortWrite).toBeDefined()
      effort = (effortWrite!.payload as SetSessionSettingsPayload).effort!
      app.daemon.pushFrame(modelFrame('session_settings_updated', {
        session_id: 'session-' + id
      }, effortWrite!.id))
    },
    settle(app: PairedApp, reject: boolean, host = 0) {
      expect(held).not.toBeNull()
      const request = decodeEnvelope(held!)
      if (reject) {
        app.servers[host].daemon.pushFrame(modelFrame('error', {
          code: 'settings.invalid_model', message: 'private model refusal', retryable: false
        }, request.id))
      } else {
        const frames = accepted(held!)
        const created = frames.map(decodeEnvelope).find(frame => frame.type === 'conversation_created')!
        choices.set((created.payload as ConversationCreatedPayload).id, request.payload as CreateConversationPayload)
        reflectChoices(frames).forEach(frame => app.servers[host].daemon.pushFrame(frame))
      }
      held = null
    }
  }
}

test('a resized prompt stays scrollable with Model open and footer controls remain reachable', async ({ launchPairedApp }) => {
  const fake = modelControlled('first-seed', mergedModels)
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  await app.page.setViewportSize({ width: 1280, height: 800 })
  const dialog = await open(app)
  const model = dialog.locator('.create-channel__model')
  const prompt = promptField(dialog)
  const box = await prompt.boundingBox()
  if (box === null) throw new Error('Missing prompt resize handle')
  await app.page.mouse.move(box.x + box.width - 3, box.y + box.height - 3)
  await app.page.mouse.down()
  await app.page.mouse.move(box.x + box.width - 3, box.y + box.height + 250, { steps: 20 })
  await app.page.mouse.up()
  await expect.poll(async () => (await prompt.boundingBox())?.height ?? 0).toBeGreaterThan(300)
  await model.click()
  await expect(dialog.getByRole('menu', { name: 'Model', exact: true })).toBeVisible()
  await expect(dialog).toHaveCSS('overflow-y', 'auto')
  expect(await dialog.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
  await app.page.screenshot({ path: '/tmp/builder-1658/resized-model-open.png' })
  const panel = await dialog.boundingBox()
  if (panel === null) throw new Error('Missing scrollable modal')
  await app.page.mouse.move(panel.x + panel.width - 10, panel.y + panel.height - 40)
  await app.page.mouse.wheel(0, 600)
  await expect.poll(() => dialog.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })
  await expect(cancel).toBeInViewport()
  await expect(ok).toBeInViewport()
  await app.page.screenshot({ path: '/tmp/builder-1658/resized-model-footer.png' })
  await cancel.click()
  await expect(dialog).toHaveCount(0)
  expect(fake.requests.filter(request => request.type === 'create_conversation')).toHaveLength(0)
})

test('Codex model is keyboard selectable, uses submission-time effort and survives correlated settings refusal', async ({ launchPairedApp }) => {
  const fake = modelControlled('first-seed', mergedModels)
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  await app.page.locator('.composer__effort').click()
  await app.page.getByRole('menu', { name: 'Effort', exact: true }).getByRole('menuitem', { name: 'low', exact: true }).click()
  await expect.poll(() => fake.requests.filter(r => r.type === 'set_session_settings').length).toBe(1)
  const dialog = await open(app)
  const model = dialog.locator('.create-channel__model')
  await expect(model).toHaveText('Default')
  const chevron = model.locator('.create-channel__model-chevron')
  await expect(chevron).toHaveCSS('width', '20px')
  await expect(chevron).toHaveCSS('height', '12px')
  await expect.poll(() => chevron.evaluate(async node => {
    const mask = getComputedStyle(node).maskImage.match(/^url\("?(blob:[^"\)]+)"?\)$/)
    if (mask === null) return 0
    return await new Promise<number>(resolve => {
      const image = new Image()
      image.onload = () => resolve(image.naturalWidth)
      image.onerror = () => resolve(0)
      image.src = mask[1]
    })
  })).toBe(20)
  await dialog.evaluate(node => node.style.setProperty('--color-primary', 'rgb(1, 2, 3)'))
  await expect(chevron).toHaveCSS('background-color', 'rgb(1, 2, 3)')
  await dialog.evaluate(node => node.style.removeProperty('--color-primary'))
  await app.page.setViewportSize({ width: 1280, height: 800 })
  await app.page.screenshot({ path: '/tmp/builder-1658/model-closed-1280.png' })
  await model.press('Enter')
  const menu = dialog.getByRole('menu', { name: 'Model', exact: true })
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Default', 'Fable', 'Opus', 'Sonnet', 'Haiku', 'GPT-6 Sol', 'GPT-6 Luna', 'GPT-5.6 Terra', 'GPT-6 Astra'
  ])
  await expect(menu.getByRole('menuitem', { name: 'Default', exact: true })).toBeFocused()
  await app.page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'GPT-6 Astra', exact: true })).toBeFocused()
  await app.page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'GPT-5.6 Terra', exact: true })).toBeFocused()
  await app.page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'GPT-6 Luna', exact: true })).toBeFocused()
  await app.page.keyboard.press('Enter')
  await expect(model).toHaveText('GPT-6 Luna')
  await expect(model).toBeFocused()
  await model.click()
  await app.page.screenshot({ path: '/tmp/builder-1658/model-open-1280.png' })
  await app.page.keyboard.press('Escape')
  await app.page.setViewportSize({ width: 800, height: 600 })
  await app.page.screenshot({ path: '/tmp/builder-1658/model-closed-800.png' })
  await model.click()
  await app.page.screenshot({ path: '/tmp/builder-1658/model-open-800.png' })
  await app.page.keyboard.press('Escape')
  fake.remember(app)
  await expect.poll(() => app.page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBe('low')
  await nameField(dialog).fill(' Luna channel ')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  const creates = () => fake.requests.filter(r => r.type === 'create_conversation')
  await expect.poll(() => creates().length).toBe(1)
  expect(creates()[0].payload).toEqual({ cwd: null, is_promoted: true, name: 'Luna channel',
    agent: 'codex', model: 'gpt-6-luna', effort: 'low' })
  await expect(model).toBeDisabled()
  await expect(menu).toHaveCount(0)
  fake.settle(app, true)
  await expect(dialog.getByRole('alert')).toHaveText('Could not create that channel')
  await expect(model).toBeEnabled()
  await expect(model).toHaveText('GPT-6 Luna')
  await expect(app.page.locator('.channel-list__row-open')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => creates().length).toBe(2)
  expect(creates()[1].payload).toEqual(creates()[0].payload)
  fake.settle(app, false)
  await expect(dialog).toHaveCount(0)
  await expect(app.page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('Luna channel')
  // Fresh settings confirm the create choices, so no follow-up model/effort write is needed.
  await expect(app.page.locator('.composer__effort-label')).toHaveText('low')
  await expect(app.page.locator('.composer__model-label')).toHaveText('GPT-6 Luna')
  expect(fake.requests.filter(r => r.type === 'set_session_settings')).toHaveLength(1)
  const reopened = await open(app)
  const freshModel = reopened.locator('.create-channel__model')
  await expect(freshModel).toHaveText('Default')
  await app.page.setViewportSize({ width: 800, height: 260 })
  await freshModel.click()
  await expect(menu.getByRole('menuitem', { name: 'Default', exact: true })).toBeFocused()
  await app.page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'GPT-6 Astra', exact: true })).toBeFocused()
  await app.page.keyboard.press('Escape')
  await expect(freshModel).toHaveText('Default')
  await expect(freshModel).toBeFocused()
  await reopened.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded()
  await reopened.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(reopened).toHaveCount(0)
})

test('Default channel starts with remembered effort and needs no follow-up settings write', async ({ launchPairedApp }) => {
  const fake = modelControlled('first-seed', mergedModels)
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  await app.page.locator('.composer__effort').click()
  await app.page.getByRole('menu', { name: 'Effort', exact: true })
    .getByRole('menuitem', { name: 'low', exact: true }).click()
  const writes = () => fake.requests.filter(request => request.type === 'set_session_settings')
  await expect.poll(() => writes().length).toBe(1)
  fake.remember(app)
  await expect.poll(() => app.page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBe('low')
  const dialog = await open(app)
  await expect(dialog.locator('.create-channel__model')).toHaveText('Default')
  await nameField(dialog).fill('Default effort channel')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  const creates = () => fake.requests.filter(request => request.type === 'create_conversation')
  await expect.poll(() => creates().length).toBe(1)
  expect(creates()[0].payload).toEqual({ cwd: null, is_promoted: true,
    name: 'Default effort channel', effort: 'low' })
  fake.settle(app, false)
  await expect(dialog).toHaveCount(0)
  await expect(app.page.locator('.channel-list__row-open[aria-current="true"]'))
    .toHaveText('Default effort channel')
  await expect(app.page.locator('.composer__effort-label')).toHaveText('low')
  await app.page.locator('.channel-list__row-open[aria-current="true"]').click()
  await expect(app.page.locator('.composer__effort-label')).toHaveText('low')
  expect(writes()).toHaveLength(1)
})

test('model choices stay on the clicked host and equal values from different agents remain distinct', async ({ launchPairedApp }) => {
  const first = modelControlled('first-seed', [modelRow('default', 'Inherited'), modelRow('sonnet', 'Sonnet')])
  const second = modelControlled('second-seed', [modelRow('default', 'Inherited'),
    modelRow('shared', 'Claude shared'), modelRow('shared', 'Codex shared', 'codex')])
  const app = await launchPairedApp({ buildReplyFrames: first.reply },
    { secondServer: { buildReplyFrames: second.reply } })
  // Cache the second host's published list through transport while the first host stays open.
  app.servers[1].daemon.pushFrame(modelFrame('model_list', { conversation_id: 'second-seed',
    models: [modelRow('default', 'Inherited'), modelRow('shared', 'Claude shared'),
      modelRow('shared', 'Codex shared', 'codex')], dropped_models: 0 }))
  const dialog = await open(app, 1)
  const model = dialog.locator('.create-channel__model')
  await model.click()
  const menu = dialog.getByRole('menu', { name: 'Model', exact: true })
  await expect(menu.getByRole('menuitem')).toHaveText(['Default', 'Shared', 'Codex shared'])
  await menu.getByRole('menuitem', { name: 'Shared', exact: true }).click()
  await nameField(dialog).fill('Claude pick')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  const creates = () => second.requests.filter(r => r.type === 'create_conversation')
  await expect.poll(() => creates().length).toBe(1)
  expect(creates()[0].payload).toEqual({ cwd: null, is_promoted: true, name: 'Claude pick', model: 'shared' })
  second.settle(app, true, 1)
  await expect(model).toBeEnabled()
  await model.click()
  await menu.getByRole('menuitem', { name: 'Codex shared', exact: true }).click()
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => creates().length).toBe(2)
  expect(creates()[1].payload).toEqual({ cwd: null, is_promoted: true, name: 'Claude pick', agent: 'codex', model: 'shared' })
  expect(first.requests.filter(r => r.type === 'create_conversation')).toHaveLength(0)
})

for (const cache of [null, [] as WireModelOption[]]) {
  test(`target-host ${cache === null ? 'missing' : 'empty'} model cache omits choice and every optional field`, async ({ launchPairedApp }) => {
    const first = modelControlled('first-seed', mergedModels)
    const second = modelControlled('second-seed', cache)
    const app = await launchPairedApp({ buildReplyFrames: first.reply },
      { secondServer: { buildReplyFrames: second.reply } })
    // Positive cache evidence before checking that another host's empty/absent cache omits the field.
    const cached = await open(app)
    await expect(cached.locator('.create-channel__model')).toHaveText('Default')
    await cached.getByRole('button', { name: 'Cancel', exact: true }).click()
    if (cache !== null) app.servers[1].daemon.pushFrame(modelFrame('model_list', {
      conversation_id: 'second-seed', models: cache, dropped_models: 0
    }))
    const dialog = await open(app, 1)
    await expect(dialog.locator('.create-channel__model')).toHaveCount(0)
    await nameField(dialog).fill('Inherited channel')
    await dialog.getByRole('button', { name: 'OK', exact: true }).click()
    const creates = () => second.requests.filter(r => r.type === 'create_conversation')
    await expect.poll(() => creates().length).toBe(1)
    expect(creates()[0].payload).toEqual({ cwd: null, name: 'Inherited channel', is_promoted: true })
    expect(first.requests.filter(r => r.type === 'create_conversation')).toHaveLength(0)
  })
}

// Real fake-transport round trips prove the outgoing host and payload; injected main events probe
// renderer-only origin/stage guards that the transport would normally filter before delivery.
test('creation uses the daemon default, keeps the name, retries rejection and opens confirmation', async ({ launchPairedApp }) => {
  const fake = controlled('first-seed')
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  const dialog = await open(app)
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })
  await expect(ok).toBeDisabled()
  await nameField(dialog).fill('   ')
  await expect(ok).toBeDisabled()
  await nameField(dialog).fill('Discarded')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await open(app)
  await app.page.setViewportSize({ width: 1280, height: 800 })
  await app.page.screenshot({ path: '/tmp/builder-1436-create-modal-1280.png' })
  await app.page.setViewportSize({ width: 800, height: 600 })
  await expect(dialog).toHaveCSS('width', '640px')
  await app.page.screenshot({ path: '/tmp/builder-1436-create-modal-800.png' })
  await app.page.setViewportSize({ width: 800, height: 260 })
  expect(await dialog.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded()
  await app.page.screenshot({ path: '/tmp/builder-1436-create-modal-short.png' })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await app.page.setViewportSize({ width: 800, height: 600 })
  await open(app)
  await nameField(dialog).fill(' Release planning ')
  await ok.press('Enter')
  await expect.poll(() => fake.requests.length).toBe(1)
  expect(fake.requests[0]).toMatchObject({ type: 'create_conversation',
    payload: { cwd: null, name: 'Release planning', is_promoted: true } })
  await expect(nameField(dialog)).toBeDisabled()
  await expect(ok).toBeDisabled()
  await ok.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
  // A folder reply is inert for this draft now that the folder stage is gone, and a reply carrying
  // a foreign, absent or malformed host stamp cannot advance or dismiss it (the guards inherited
  // from the deleted dedicated test).
  await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: '/ignored' })
  await event(app, { type: 'workspaceFolderRejected', serverId: FIRST_SERVER_ID })
  for (const serverId of [SECOND_SERVER_ID, undefined, null, '', 42]) {
    await event(app, { type: 'conversationCreateRejected', serverId })
    await event(app, { type: 'conversationCreated', serverId, conversation: {
      id: 'foreign', name: null, is_promoted: false, cwd: CWD,
      workspace_label: null, last_used_at: '2026-09-13T00:00:00Z' } })
  }
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(fake.requests).toHaveLength(1)
  fake.reject(app)
  await expect(dialog.getByRole('alert')).toHaveText('Could not create that channel')
  await app.page.screenshot({ path: '/tmp/builder-1436-create-rejected.png' })
  await expect(ok).toBeEnabled()
  await ok.click()
  await expect.poll(() => fake.requests.length).toBe(2)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  fake.release(app)
  await expect(dialog).toHaveCount(0)
  await expect(app.page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('Release planning')
})

test('creation addresses the clicked host in both directions', async ({ launchPairedApp }) => {
  const first = controlled('first-seed')
  const second = controlled('second-seed')
  const app = await launchPairedApp({ buildReplyFrames: first.reply },
    { secondServer: { buildReplyFrames: second.reply } })
  // Both hosts seed the same path. Keep the first reply held so its daemon-default workspace cannot
  // insert another plus ahead of the second host's original plus while this routing test is running.
  const dialog = await open(app, 0)
  await nameField(dialog).fill('First host channel')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => first.requests.length).toBe(1)
  expect(first.requests[0]).toMatchObject({ type: 'create_conversation',
    payload: { cwd: null, name: 'First host channel', is_promoted: true } })
  expect(second.requests).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  // The second host's workspace row still occupies the next plus, despite sharing the same path.
  const other = await open(app, 1)
  await nameField(other).fill('Second host channel')
  await other.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => second.requests.length).toBe(1)
  expect(second.requests[0]).toMatchObject({ type: 'create_conversation',
    payload: { cwd: null, name: 'Second host channel', is_promoted: true } })
  expect(first.requests).toHaveLength(1)
})


test('dismissal and disconnect abandon pending continuations, and a fresh opening resets the draft', async ({ launchPairedApp }) => {
  const fake = controlled('first-seed')
  const app = await launchPairedApp({ buildReplyFrames: fake.reply }, { secondServer: {} })
  for (const closeName of ['Cancel', 'Close dialog']) {
    const dialog = await open(app)
    await nameField(dialog).fill('Release planning')
    await dialog.getByRole('button', { name: 'OK', exact: true }).click()
    await expect.poll(() => fake.requests.length).toBe(closeName === 'Cancel' ? 1 : 2)
    await dialog.getByRole('button', { name: closeName, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    // Neither a late rejection nor an inert folder reply can resurrect the dismissed draft.
    await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: CANONICAL })
    await event(app, { type: 'conversationCreateRejected', serverId: FIRST_SERVER_ID })
    await expect(dialog).toHaveCount(0)
    expect(fake.requests).toHaveLength(closeName === 'Cancel' ? 1 : 2)
  }
  // Dismissal abandons the local continuation only; the globally mounted navigation bridge still
  // opens the channel the daemon confirms for an already-sent request.
  let dialog = await open(app)
  await nameField(dialog).fill('Release planning')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => fake.requests.length).toBe(3)
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  fake.release(app)
  await expect(app.page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('Release planning')
  await expect(dialog).toHaveCount(0)
  dialog = await open(app)
  await nameField(dialog).fill('Release planning')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => fake.requests.length).toBe(4)
  await event(app, { type: 'disconnected', serverId: FIRST_SERVER_ID })
  await expect(dialog).toHaveCount(0)
  await event(app, { type: 'conversationCreateRejected', serverId: FIRST_SERVER_ID })
  await event(app, { type: 'connected', serverId: FIRST_SERVER_ID, ack: { protocol_version: 1 } })
  await event(app, { type: 'conversationCreateRejected', serverId: FIRST_SERVER_ID })
  expect(fake.requests).toHaveLength(4)
  await expect(dialog).toHaveCount(0)
  const reopened = await open(app)
  await reopened.getByRole('button', { name: 'Cancel', exact: true }).click()
})

// #1428: the prompt is a SECOND step. `set_system_prompt` takes an EXISTING conversation id, so the
// write can only go out on the create's confirmation — and `conversationCreated` is uncorrelated, so
// this drive is where the write's attribution is proved. Four creates in one launch, each with a
// distinct name so the matching predicate has something to discriminate on; the single ordered
// request-type assertion at the end is what pins "exactly one write, immediately after its own
// create, and nowhere else".
const OVER_LIMIT_NOTICE = `Over the ${MAX_SYSTEM_PROMPT_BYTES}-byte limit. Shorten it before saving.`
// Leading and trailing whitespace on purpose: the write carries the draft VERBATIM AND UNTRIMMED,
// unlike the name, which `requestNewChannel` trims. The U+2693 is 3 bytes over 1 code unit.
const PROMPT = '  Answer only in haiku. Keep every reply to three lines, and prefer a plain word ' +
  'over jargon wherever a plain word will do. ⚓  '

test('a typed prompt is written to the confirmed channel, and to no other', async ({ launchPairedApp }) => {
  const fake = controlled('first-seed')
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  const ok = () => dialogOf(app).getByRole('button', { name: 'OK', exact: true })
  const notice = () => dialogOf(app).getByText(OVER_LIMIT_NOTICE)

  // --- AC3, the byte gate. 8192 ASCII bytes sits ON the inclusive bound; swapping two of them for
  // one 3-byte anchor takes it over at FEWER code units, which is what separates a UTF-8 count from
  // a `.length` one. --- AC2's empty-box arm then creates with nothing typed. ---
  let dialog = await open(app)
  await nameField(dialog).fill('Empty prompt')
  await expect(ok()).toBeEnabled()
  await promptField(dialog).fill('a'.repeat(MAX_SYSTEM_PROMPT_BYTES))
  await expect(notice()).toHaveCount(0)
  await expect(ok()).toBeEnabled()
  await promptField(dialog).fill('a'.repeat(MAX_SYSTEM_PROMPT_BYTES - 2) + '⚓')
  await expect(notice()).toBeVisible()
  await expect(ok()).toBeDisabled()
  await app.page.screenshot({ path: '/tmp/builder-1428-create-over-limit.png', animations: 'disabled' })
  await promptField(dialog).fill('')
  await expect(notice()).toHaveCount(0)
  await ok().click()
  await expect.poll(() => fake.requests.length).toBe(1)
  fake.release(app)
  await expect(dialogOf(app)).toHaveCount(0)
  await expect(app.page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('Empty prompt')
  expect(fake.writes()).toHaveLength(0)

  // --- A box holding only whitespace is an empty box: no write either. ---
  dialog = await open(app)
  await nameField(dialog).fill('Blank prompt')
  await promptField(dialog).fill('   \n  ')
  await ok().click()
  await expect.poll(() => fake.requests.length).toBe(2)
  fake.release(app)
  await expect(dialogOf(app)).toHaveCount(0)
  expect(fake.writes()).toHaveLength(0)

  // --- The write itself. A confirmation from ANOTHER host cannot carry it even when the payload
  // would otherwise match this dialog's create exactly — the host stamp is checked first. ---
  dialog = await open(app)
  await nameField(dialog).fill('Haiku channel')
  await promptField(dialog).fill(PROMPT)
  // The drawn state, at the design width and at the window minimum (AC1's Figma comparison).
  await app.page.setViewportSize({ width: 1280, height: 800 })
  await app.page.screenshot({ path: '/tmp/builder-1428-create-prompt-1280.png', animations: 'disabled' })
  await app.page.setViewportSize({ width: 800, height: 600 })
  await expect(dialog).toHaveCSS('width', '640px')
  await app.page.screenshot({ path: '/tmp/builder-1428-create-prompt-800.png', animations: 'disabled' })
  await ok().click()
  await expect.poll(() => fake.requests.length).toBe(3)
  const channelId = fake.created.at(-1)
  await expect(nameField(dialog)).toBeDisabled()
  await expect(promptField(dialog)).toBeDisabled()
  for (const serverId of [SECOND_SERVER_ID, undefined, null, '', 42]) {
    await event(app, { type: 'conversationCreated', serverId, conversation: {
      id: 'foreign', name: 'Haiku channel', is_promoted: true, cwd: CWD,
      workspace_label: null, last_used_at: '2026-09-13T00:00:00Z' } })
  }
  await expect(dialog).toBeVisible()
  expect(fake.writes()).toHaveLength(0)
  fake.release(app)
  await expect(dialogOf(app)).toHaveCount(0)
  await expect(app.page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('Haiku channel')
  await expect.poll(() => fake.writes().length).toBe(1)
  expect(fake.writes()[0]).toEqual({ conversation_id: channelId, system_prompt: PROMPT })

  // --- AC2's misattribution arm: a SAME-HOST confirmation for a channel this dialog did not ask for
  // writes nothing, and dismisses exactly as it did before the write existed. ---
  dialog = await open(app)
  await nameField(dialog).fill('Not mine')
  await promptField(dialog).fill(PROMPT)
  await ok().click()
  await expect.poll(() => fake.requests.length).toBe(5)
  await event(app, { type: 'conversationCreated', serverId: FIRST_SERVER_ID, conversation: {
    id: 'someone-elses', name: 'Another operators channel', is_promoted: true, cwd: CWD,
    workspace_label: null, last_used_at: '2026-09-13T00:00:00Z' } })
  await expect(dialogOf(app)).toHaveCount(0)

  expect(fake.requests.map(request => request.type)).toEqual([
    'create_conversation', 'create_conversation', 'create_conversation',
    'set_system_prompt', 'create_conversation'
  ])

  // A same-host unpromoted reply also dismisses the wait, but cannot receive the prompt.
  dialog = await open(app)
  await nameField(dialog).fill('Not a promoted channel')
  await promptField(dialog).fill(PROMPT)
  await ok().click()
  await expect.poll(() => fake.requests.length).toBe(6)
  await event(app, { type: 'conversationCreated', serverId: FIRST_SERVER_ID, conversation: {
    id: 'unpromoted', name: 'Not a promoted channel', is_promoted: false, cwd: '/fake/workspace',
    workspace_label: null, last_used_at: '2026-09-13T00:00:00Z' } })
  await expect(dialogOf(app)).toHaveCount(0)
  expect(fake.writes()).toHaveLength(1)
})
