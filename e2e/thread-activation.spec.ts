import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope } from '../src/shared/wire/types'
import type { ThreadItem } from '../src/shared/wire/thread'
import { capturePairedApp } from './fixtures/capturePairedApp'
import { mintChatInWorkspace } from './fixtures/mintChatRow'
import { pairAnotherServerFromSettings } from './fixtures/pairingArrival'

const stamp = '2026-10-15T00:00:00Z'
const item = (id: number, text: string): ThreadItem => ({ id, rev: 1, order: id, kind: 'assistant_message',
  status: 'finished', active: false, shown: true, summary: text, content: { text }, session: 'session' })
const frame = (type: string, payload: unknown, reply?: number, session_id?: string) =>
  encodeEnvelope({ id: 100, type, ts: stamp, payload, ...(reply === undefined ? {} : { in_reply_to: reply }),
    ...(session_id === undefined ? {} : { session_id }) })

const windowFrames = (request: Envelope, chat: string, text: string, epoch = 'epoch', version = 20) => [
  frame('thread_items', { conversation_id: chat, epoch, version, items: [item(10, text)], final: false }, request.id),
  frame('thread_items', { conversation_id: chat, epoch, version, items: [], final: true,
    ...(Number(request.payload.version) > 0 && request.payload.epoch === epoch ? { from_version: request.payload.version }
      : { lower_order: 0, upper_order: 30, continuation: 0, older_exists: false }) }, request.id)
]

test('creating a fresh thread opens catch-up and sends without a sidebar reopen', async ({ launchPairedApp }) => {
  const requests: Envelope[] = []
  const created = { ...SEEDED_ROW, id: 'new-thread', name: null, current_session_id: 'session' }
  let made = false
  const { page, daemon } = await launchPairedApp({ helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes); requests.push(request)
    if (request.type === 'list_conversations') return [seedConversationsFrame(made ? created : SEEDED_ROW)]
    if (request.type === 'create_conversation') { made = true; return [frame('conversation_created', created, request.id)] }
    if (request.type === 'thread_catch_up') return windowFrames(request, String(request.payload.conversation_id), made ? 'Created scope ready' : 'Original scope ready')
    return []
  } })
  await expect(page.getByText('Original scope ready', { exact: true })).toBeVisible()
  await mintChatInWorkspace(page, SEEDED_ROW.cwd)
  await expect(page.getByText('Created scope ready', { exact: true })).toBeVisible()
  await page.locator('textarea').fill('First message in fresh chat')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.conversation__thread')).toContainText('First message in fresh chat')
  await expect.poll(() => requests.filter(r => r.type === 'send_message').length).toBe(1)
  expect(requests.find(r => r.type === 'send_message')?.payload.conversation_id).toBe(created.id)
  daemon.pushFrame(frame('modal_shown', { conversation_id: created.id, modal_id: 'fresh', class: 'permission',
    title: 'Fresh chat permission', prompt: 'Continue?', options: [{ id: 'deny', label: 'Deny' }], default_option_id: 'deny' }, undefined, 'session'))
  await expect(page.getByText('Fresh chat permission', { exact: true })).toBeVisible()
  expect(requests.some(r => r.type === 'request_history')).toBe(false)
})

test('identity failure, rejection and connection replacement preserve subsequent edits and an unchanged retry draft', async ({ launchPairedApp }) => {
  const requests: Envelope[] = []
  const { page, app, forwarder } = await launchPairedApp({ helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes); requests.push(request)
    if (request.type === 'list_conversations') return [seedConversationsFrame(SEEDED_ROW)]
    return request.type === 'thread_catch_up' ? windowFrames(request, SEEDED_ROW.id, 'Identity test ready') : []
  } })
  await expect(page.getByText('Identity test ready', { exact: true })).toBeVisible()
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('pyry:device-identity')
    Object.assign(globalThis, { originalIdentity: original, identityCalls: 0, identityFailures: 0 })
    ipcMain.on('pyry:diagnostic', (_event, record) => {
      if (record.event === 'thread-send' && record.code === 'identity-or-connection-unavailable') (globalThis as any).identityFailures++
    })
    ipcMain.removeHandler('pyry:device-identity')
    ipcMain.handle('pyry:device-identity', async () => {
      const index = ++(globalThis as any).identityCalls
      await new Promise<void>(resolve => ipcMain.once('test:identity-release', () => resolve()))
      if (index === 2) throw new Error('synthetic unavailable identity')
      if (index === 3) return original()
      return { ok: false, error: 'identity-unavailable' }
    })
  })
  for (const [index, later] of ['Newer operator draft', 'Edited during rejected invoke', 'Edited across reconnect', null].entries()) {
    await page.locator('textarea').fill('Retained retry draft')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as any).identityCalls)).toBe(index + 1)
    if (later) await page.locator('textarea').fill(later)
    if (index === 2) {
      await page.evaluate(() => { (globalThis as any).identityReconnect = false; window.pyry.onDaemonEvent(event => {
        if (event.type === 'connected') (globalThis as any).identityReconnect = true
      }) })
      forwarder.dropClientLeg()
      await expect.poll(() => page.evaluate(() => (globalThis as any).identityReconnect)).toBe(true)
    }
    await app.evaluate(({ ipcMain }) => ipcMain.emit('test:identity-release'))
    // Main receives the continuation's diagnostic before the absence assertion.
    await expect.poll(() => app.evaluate(() => (globalThis as any).identityFailures)).toBe(index + 1)
    await expect(page.locator('textarea')).toHaveValue(later ?? 'Retained retry draft')
    expect(requests.filter(r => r.type === 'send_message')).toHaveLength(0)
  }
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('pyry:device-identity'); ipcMain.handle('pyry:device-identity', (globalThis as any).originalIdentity)
  })
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => requests.filter(r => r.type === 'send_message').length).toBe(1)
  await expect(page.locator('textarea')).toHaveValue('')
})

test('a synchronous bridge failure keeps the draft recoverable and rolls back its attachment claim once', async ({ launchPairedApp }) => {
  const requests: Envelope[] = []
  const { page } = await launchPairedApp({ helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes); requests.push(request)
    if (request.type === 'list_conversations') return [seedConversationsFrame(SEEDED_ROW)]
    return request.type === 'thread_catch_up' ? windowFrames(request, SEEDED_ROW.id, 'Bridge failure ready') : []
  } })
  await expect(page.getByText('Bridge failure ready', { exact: true })).toBeVisible()
  const cdp = await page.context().newCDPSession(page)
  const scripts: { scriptId: string; url: string }[] = []
  cdp.on('Debugger.scriptParsed', script => scripts.push(script))
  await cdp.send('Debugger.enable')
  const script = scripts.find(script => /assets\/index-.*\.js$/.test(script.url))
  if (!script) throw new Error('Built renderer script missing')
  const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId })
  const offset = scriptSource.indexOf('function submitMessage(')
  expect(offset).toBeGreaterThan(0)
  let injected = 0
  cdp.on('Debugger.paused', async event => {
    await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: event.callFrames[0].callFrameId, expression: `
      globalThis.__attachmentRollbacks = 0;
      const originalTake = deps.takeAttachments;
      deps.takeAttachments = () => {
        const take = originalTake();
        return { attachments: take.attachments, rollback: () => { globalThis.__attachmentRollbacks++; take.rollback(); } };
      };
      deps.sendCommand = () => { throw new Error('synthetic bridge failure'); };
    ` })
    injected++
    await cdp.send('Debugger.resume')
  })
  const breakpoint = await cdp.send('Debugger.setBreakpoint', { location: {
    scriptId: script.scriptId, lineNumber: scriptSource.slice(0, offset).split('\n').length
  } })
  await page.locator('textarea').fill('Recoverable bridge draft')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('Not sent', { exact: true })).toBeVisible()
  expect(injected).toBe(1)
  await expect(page.locator('textarea')).toHaveValue('Recoverable bridge draft')
  expect(await page.evaluate(() => (globalThis as any).__attachmentRollbacks)).toBe(1)
  expect(requests.filter(r => r.type === 'send_message')).toHaveLength(0)
  await cdp.send('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId })
  await cdp.send('Debugger.disable')
  await page.locator('textarea').fill('Newer retry after bridge failure')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => requests.filter(r => r.type === 'send_message').length).toBe(1)
  expect(requests.find(r => r.type === 'send_message')?.payload.text).toBe('Newer retry after bridge failure')
  await expect(page.locator('textarea')).toHaveValue('')
})

test('the overlay follows current thread errors, session replacement and capability changes', async ({ launchPairedApp }) => {
  const capabilities = ['interactive']
  let session = 'A'
  const { page, daemon, forwarder } = await launchPairedApp({ helloAck: { capabilities }, buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes)
    if (request.type === 'list_conversations') return [seedConversationsFrame({ ...SEEDED_ROW, current_session_id: session })]
    return request.type === 'thread_catch_up' ? windowFrames(request, SEEDED_ROW.id, 'Error route ready') : []
  } })
  const error = (code: string, owner = session) => frame('session_error', { conversation_id: SEEDED_ROW.id,
    code, message: 'Private synthetic detail' }, undefined, owner)
  const notice = page.locator('.top-overlay-pill--error').filter({ hasText: 'Claude' })
  daemon.pushFrame(error('session.child_crashing'))
  await expect(notice).toHaveText('Claude keeps failing to start. Your message is waiting.')
  capabilities.push('thread'); forwarder.dropClientLeg()
  await expect(page.getByText('Error route ready', { exact: true })).toBeVisible()
  await expect(notice).toHaveCount(0)
  daemon.pushFrame(error('session.blocked'))
  await expect(notice).toHaveText('Claude did not pick up your last message. It was not delivered.')
  session = 'B'
  daemon.pushFrame(seedConversationsFrame({ ...SEEDED_ROW, current_session_id: session }))
  daemon.pushFrame(error('session.child_crashing', 'A'))
  daemon.pushFrame(frame('thread_item_added', { conversation_id: SEEDED_ROW.id, epoch: 'epoch', version: 21,
    item: item(11, 'Error replacement committed') }))
  await expect(page.getByText('Error replacement committed', { exact: true })).toBeVisible()
  await expect(notice).toHaveCount(0)
  daemon.pushFrame(error('session.child_crashing'))
  await expect(notice).toHaveText('Claude keeps failing to start. Your message is waiting.')
})

test('reused conversation IDs keep selected metadata, content and commands on their owning host', async ({ launchPairedApp }) => {
  const requests: Envelope[][] = [[], []]
  const rowB = { ...SECOND_SEEDED_ROW, id: SEEDED_ROW.id, current_session_id: 'session' }
  const replies = (host: number) => (bytes: Uint8Array) => {
    const request = decodeEnvelope(bytes); requests[host].push(request)
    if (request.type === 'list_conversations') return [seedConversationsFrame(host === 0 ? { ...SEEDED_ROW, current_session_id: 'session' } : rowB)]
    return request.type === 'thread_catch_up' ? windowFrames(request, SEEDED_ROW.id, host === 0 ? 'Host A content' : 'Host B content') : []
  }
  const { page, servers } = await launchPairedApp({ helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: replies(0) },
    { secondServer: { helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: replies(1) } })
  await page.getByText(SECOND_SEEDED_ROW.name!, { exact: true }).first().click()
  await expect(page.getByText('Host B content', { exact: true })).toBeVisible()
  const models = (value: string) => frame('model_list', { conversation_id: SEEDED_ROW.id, dropped_models: 0,
    models: [{ value, display_name: value, resolved_model: `claude-${value}-5`, effort_levels: [], supports_auto_mode: false, truncated_fields: null }] }, undefined, 'session')
  servers[1].daemon.pushFrame(models('haiku'))
  servers[1].daemon.pushFrame(frame('model_announced', { conversation_id: SEEDED_ROW.id, model: 'claude-haiku-5', truncated: false }, undefined, 'session'))
  await page.locator('.composer__model-label').click()
  const menu = page.getByRole('menu', { name: 'Model', exact: true })
  await expect(menu.getByText('Haiku', { exact: true })).toBeVisible()
  await page.evaluate(() => { (globalThis as any).receivedOffscreenModel = false; window.pyry.onDaemonEvent(event => {
    if (event.type === 'modelList' && event.serverId === 'fake-daemon') (globalThis as any).receivedOffscreenModel = true
  }) })
  servers[0].daemon.pushFrame(models('opus'))
  servers[0].daemon.pushFrame(frame('model_announced', { conversation_id: SEEDED_ROW.id, model: 'claude-opus-5', truncated: false }, undefined, 'session'))
  // This later B row is committed after A's metadata was positively processed on its transport.
  await expect.poll(() => page.evaluate(() => (globalThis as any).receivedOffscreenModel)).toBe(true)
  servers[1].daemon.pushFrame(frame('thread_item_added', { conversation_id: SEEDED_ROW.id, epoch: 'epoch', version: 21,
    item: item(11, 'Host B commit barrier') }))
  await expect(page.getByText('Host B commit barrier', { exact: true })).toBeVisible()
  await expect(menu.getByText('Haiku', { exact: true })).toBeVisible()
  await expect(menu.getByText('Opus', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.locator('textarea').fill('B owns this send')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => requests[1].filter(r => r.type === 'send_message').length).toBe(1)
  expect(requests[0].filter(r => r.type === 'send_message')).toHaveLength(0)
  expect(requests.flat().filter(r => r.type === 'request_history')).toHaveLength(0)
  await page.getByText(SEEDED_ROW.name!, { exact: true }).first().click()
  await expect(page.getByText('Host A content', { exact: true })).toBeVisible()
  await page.locator('.composer__model-label').click()
  await expect(menu.getByText('Opus', { exact: true })).toBeVisible()
  await expect(menu.getByText('Haiku', { exact: true })).toHaveCount(0)
})

test('restore overlapping live content retains complete progress across an interrupted catch-up and epoch replacement', async ({ launchPairedApp }) => {
  const requests: Envelope[] = []
  let interrupt = false, reset = false, overlapped = false
  let { page, app, daemon, forwarder, userDataDir } = await launchPairedApp({ helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes); requests.push(request)
    if (request.type === 'list_conversations') return [seedConversationsFrame({ ...SEEDED_ROW, current_session_id: 'session' })]
    if (request.type !== 'thread_catch_up') return []
    if (reset && request.payload.epoch !== 'replacement') return [frame('thread_reset', { conversation_id: SEEDED_ROW.id,
      epoch: 'replacement', version: 2 }, request.id)]
    if (reset) return windowFrames(request, SEEDED_ROW.id, 'Replacement epoch committed', 'replacement', 2)
    if (interrupt) return [frame('thread_items', { conversation_id: SEEDED_ROW.id, epoch: 'epoch', version: 30,
      items: [item(12, 'Unfinished catch-up content')], final: false }, request.id)]
    const frames = windowFrames(request, SEEDED_ROW.id, 'Complete saved baseline', 'epoch', overlapped ? 21 : 20)
    if (overlapped) frames[0] = frame('thread_items', { conversation_id: SEEDED_ROW.id, epoch: 'epoch', version: 21,
      items: [item(10, 'Complete saved baseline'), item(11, 'Live content during protected restore')], final: false }, request.id)
    return frames
  } })
  await expect(page.getByText('Complete saved baseline', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(async id => {
    const result = await window.pyry.chatHistory({ operation: 'readThread', serverId: 'fake-daemon', conversationId: id })
    return result.status === 'stored' && result.snapshot.kind === 'daemon-items' ? result.snapshot.thread.checkpoint : null
  }, SEEDED_ROW.id)).toBe(20)
  await app.close()
  const resumed = await launchPairedApp({}, { reuseUserDataDir: userDataDir, onLaunched: async app => { await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('pyry:chat-history')
    Object.assign(globalThis, { heldThreadReads: 0 })
    ipcMain.removeHandler('pyry:chat-history')
    ipcMain.handle('pyry:chat-history', async (event, request) => {
      const result = await original(event, request)
      if (request.operation === 'readThread') {
        (globalThis as any).heldThreadReads++
        await new Promise<void>(resolve => ipcMain.once('test:release-thread-read', () => resolve()))
        ipcMain.removeHandler('pyry:chat-history'); ipcMain.handle('pyry:chat-history', original)
      }
      return result
    })
  }) } })
  page = resumed.page; app = resumed.app
  await page.getByText(SEEDED_ROW.name!, { exact: true }).first().click()
  await expect.poll(() => app.evaluate(() => (globalThis as any).heldThreadReads)).toBe(1)
  await page.evaluate(() => { (globalThis as any).overlapReceived = false; (globalThis as any).unfinishedReceipts = 0; window.pyry.onDaemonEvent(event => {
    if (event.type === 'threadUpdate') (globalThis as any).overlapReceived = true
    if (event.type === 'threadReply' && event.reply.type === 'thread_items' && !event.reply.payload.final && event.reply.payload.version === 30)
      (globalThis as any).unfinishedReceipts++
  }) })
  overlapped = true
  daemon.pushFrame(frame('thread_item_added', { conversation_id: SEEDED_ROW.id, epoch: 'epoch', version: 21,
    item: item(11, 'Live content during protected restore') }))
  await expect.poll(() => page.evaluate(() => (globalThis as any).overlapReceived)).toBe(true)
  await app.evaluate(({ ipcMain }) => ipcMain.emit('test:release-thread-read'))
  await expect(page.getByText('Live content during protected restore', { exact: true })).toBeVisible()
  expect(requests.filter(r => r.type === 'thread_catch_up').at(-1)?.payload).toMatchObject({ epoch: 'epoch', version: 20 })
  interrupt = true; forwarder.dropClientLeg()
  await expect(page.getByText('Unfinished catch-up content', { exact: true })).toBeVisible()
  const unfinished = requests.filter(r => r.type === 'thread_catch_up').at(-1)!
  expect(unfinished.payload).toMatchObject({ epoch: 'epoch', version: 21 })
  await expect(page.getByText('Live content during protected restore', { exact: true })).toHaveCount(1)
  const count = requests.filter(r => r.type === 'thread_catch_up').length
  forwarder.dropClientLeg()
  await expect.poll(() => requests.filter(r => r.type === 'thread_catch_up').length).toBeGreaterThan(count)
  await expect.poll(() => page.evaluate(() => (globalThis as any).unfinishedReceipts)).toBe(2)
  expect(requests.filter(r => r.type === 'thread_catch_up').at(-1)?.payload).toMatchObject({ epoch: 'epoch', version: 21 })
  reset = true
  forwarder.dropClientLeg()
  await expect(page.getByText('Replacement epoch committed', { exact: true })).toBeVisible({ timeout: 15_000 })
  // A late terminal reply and old-epoch text cannot restore retired content.
  daemon.pushFrame(frame('thread_items', { conversation_id: SEEDED_ROW.id, epoch: 'epoch', version: 30,
    items: [], final: true, from_version: 21 }, unfinished.id))
  daemon.pushFrame(frame('assistant_delta', { conversation_id: SEEDED_ROW.id, turn_id: 'old', seq: 0, text: 'Legacy recovery duplicate' }))
  daemon.pushFrame(frame('thread_item_added', { conversation_id: SEEDED_ROW.id, epoch: 'replacement', version: 3,
    item: item(13, 'Replacement receipt barrier') }))
  await expect(page.getByText('Replacement receipt barrier', { exact: true })).toBeVisible()
  await expect(page.getByText('Unfinished catch-up content', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Legacy recovery duplicate', { exact: true })).toHaveCount(0)
  expect(requests.some(r => r.type === 'request_history' || r.type === 'replay_events')).toBe(false)
})

test('queued acknowledgement recovery, successful unpair and deletion retire the owning pairing scopes', async ({ launchPairedApp }) => {
  const requests: Envelope[] = [], otherRequests: Envelope[] = []
  let accepted: ThreadItem | undefined, fresh = false, deleted = false, holdDeletion = false
  const { page, daemon, forwarder, servers } = await launchPairedApp({ helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes); requests.push(request)
    if (request.type === 'list_conversations') return deleted ? [frame('conversations', { conversations: [] })]
      : [seedConversationsFrame({ ...SEEDED_ROW, current_session_id: fresh ? 'new-session' : 'session' })]
    if (request.type === 'delete_conversation') { deleted = true; return [frame('conversation_deleted', { id: SEEDED_ROW.id }, request.id)] }
    if (request.type === 'thread_catch_up') {
      if (holdDeletion) return []
      const frames = windowFrames(request, SEEDED_ROW.id, fresh ? 'Repaired pairing content' : 'Queue recovery baseline', fresh ? 'fresh' : 'epoch')
      if (accepted && !fresh) frames[0] = frame('thread_items', { conversation_id: SEEDED_ROW.id, epoch: 'epoch', version: 20,
        items: [item(10, 'Queue recovery baseline'), accepted], final: false }, request.id)
      return frames
    }
    if (request.type === 'send_message') accepted = { ...item(15, String(request.payload.text)), kind: 'user_message',
      active: true, status: 'queued', content: { text: request.payload.text, message_id: request.payload.message_id,
        device_id: deviceId, queued_msg_id: 77 } }
    return []
  } }, { secondServer: { buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes); otherRequests.push(request)
    return request.type === 'list_conversations' ? [seedConversationsFrame(SECOND_SEEDED_ROW)] : []
  } } })
  let deviceId = ''
  const identity = await page.evaluate(() => window.pyry.deviceIdentity())
  if (!identity.ok) throw new Error('identity unavailable')
  deviceId = identity.deviceId
  await page.getByText(SEEDED_ROW.name!, { exact: true }).first().click()
  await expect(page.getByText('Queue recovery baseline', { exact: true })).toBeVisible()
  await page.locator('textarea').fill('Recovered queued acceptance')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => requests.filter(r => r.type === 'send_message').length).toBe(1)
  await expect(page.locator('.composer-status__label').last()).toHaveText('Sending…')
  forwarder.dropClientLeg()
  await expect(page.getByRole('button', { name: 'Drop queued message' })).toBeVisible()
  await expect(page.locator('[data-thread-role="queued"]')).toHaveCount(1)
  await expect(page.locator('.composer-status__label').last()).toHaveText('Waiting for Claude')
  expect(requests.filter(r => r.type === 'thread_catch_up').at(-1)?.payload).toMatchObject({ epoch: 'epoch', version: 20 })
  daemon.pushFrame(frame('thread_item_changed', { conversation_id: SEEDED_ROW.id, epoch: 'epoch', version: 21,
    item_id: 15, base_rev: 1, rev: 2, changes: { active: false, status: 'finished' } }))
  daemon.pushFrame(frame('thread_item_added', { conversation_id: SEEDED_ROW.id, epoch: 'epoch', version: 22,
    item: item(16, 'Queued delivery committed') }))
  await expect(page.getByText('Queued delivery committed', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Drop queued message' })).toHaveCount(0)
  await expect(page.locator('[data-thread-role="user"]')).toContainText('Recovered queued acceptance')
  // Leave both pending sends and an answerable prompt behind before successful removal.
  await page.locator('textarea').fill('Departed pairing pending')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => requests.filter(r => r.type === 'send_message').length).toBe(2)
  daemon.pushFrame(frame('modal_shown', { conversation_id: SEEDED_ROW.id, modal_id: 'departed', class: 'permission', title: 'Departed prompt',
    prompt: 'Continue?', options: [{ id: 'deny', label: 'Deny' }], default_option_id: 'deny' }, undefined, 'session'))
  await expect(page.getByText('Departed prompt', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  const hostRow = page.locator('.settings__server-row').filter({ has: page.locator('.settings__server-row-id', { hasText: /^fake-daemon$/ }) })
  await hostRow.getByRole('button', { name: 'Unpair', exact: true }).click()
  await hostRow.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.locator('.settings__server-row-id')).toHaveText([servers[1].serverId])
  fresh = true
  const code = Buffer.from(JSON.stringify({ server: servers[0].serverId, relay: `${forwarder.url}/v1/client`,
    token: 'synthetic-new-pairing', server_static_pubkey: Buffer.from(daemon.staticPublicKey).toString('base64') })).toString('base64url')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await pairAnotherServerFromSettings(page, code)
  await page.getByText(SEEDED_ROW.name!, { exact: true }).first().click()
  await expect(page.getByText('Repaired pairing content', { exact: true })).toBeVisible()
  expect(requests.filter(r => r.type === 'thread_catch_up').at(-1)?.payload.version).toBe(0)
  await expect(page.locator('.conversation__thread')).not.toContainText('Departed pairing pending')
  await expect(page.getByText('Departed prompt', { exact: true })).toHaveCount(0)
  // Deletion retires an outstanding request and the same conversation ID can then be recreated.
  holdDeletion = true
  const beforeDelete = requests.filter(r => r.type === 'thread_catch_up').length
  forwarder.dropClientLeg()
  await expect.poll(() => requests.filter(r => r.type === 'thread_catch_up').length).toBeGreaterThan(beforeDelete)
  const old = requests.filter(r => r.type === 'thread_catch_up').at(-1)!
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Channel info', exact: true }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Delete this conversation permanently? This cannot be undone.')).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText(SEEDED_ROW.name!, { exact: true })).toHaveCount(0)
  deleted = false; holdDeletion = false
  daemon.pushFrame(seedConversationsFrame({ ...SEEDED_ROW, current_session_id: 'new-session' }))
  await page.getByText(SEEDED_ROW.name!, { exact: true }).first().click()
  await expect(page.getByText('Repaired pairing content', { exact: true })).toBeVisible()
  daemon.pushFrame(frame('thread_items', { conversation_id: SEEDED_ROW.id, epoch: 'old', version: 100,
    items: [item(99, 'Stale deleted callback')], final: false }, old.id))
  daemon.pushFrame(frame('thread_item_added', { conversation_id: SEEDED_ROW.id, epoch: 'fresh', version: 21,
    item: item(17, 'Recreated scope barrier') }))
  await expect(page.getByText('Recreated scope barrier', { exact: true })).toBeVisible()
  await expect(page.getByText('Stale deleted callback', { exact: true })).toHaveCount(0)
  expect(requests.filter(r => r.type === 'request_history' || r.type === 'replay_events')).toHaveLength(0)
  expect(otherRequests.filter(r => r.type === 'thread_catch_up' || r.type === 'send_message' || r.type === 'modal_answer')).toHaveLength(0)
})

test('ordinary app selects a thread host beside a complete legacy host and resumes its saved checkpoint', async ({ launchPairedApp }) => {
  const requests: Envelope[] = [], legacyRequests: Envelope[] = []
  const row = { ...SEEDED_ROW, current_session_id: 'session', last_shown_version: 20, read_up_to: 0 }
  const replies = (bytes: Uint8Array): Uint8Array[] => {
    const request = decodeEnvelope(bytes); requests.push(request)
    if (request.type === 'list_conversations') return [seedConversationsFrame(row)]
    if (request.type === 'mark_conversation_read' && typeof request.payload.up_to === 'number') {
      row.read_up_to = request.payload.up_to
      return [frame('conversation_updated', row, request.id)]
    }
    if (request.type === 'thread_catch_up' || request.type === 'thread_page') {
      const base = { conversation_id: row.id, epoch: 'epoch', version: 20 }
      const incremental = request.type === 'thread_catch_up' && typeof request.payload.version === 'number' && request.payload.version > 0
      return [frame('thread_items', { ...base, items: [item(10, 'Authoritative saved answer')], final: false }, request.id),
        frame('thread_items', { ...base, items: [], final: true, ...(incremental ? { from_version: request.payload.version }
          : { lower_order: request.type === 'thread_page' ? 0 : 10, upper_order: request.type === 'thread_page' ? request.payload.before_order : 21,
            continuation: request.type === 'thread_page' ? 0 : 10, older_exists: request.type !== 'thread_page' }) }, request.id)]
    }
    return []
  }
  const { page, app, daemon, forwarder } = await launchPairedApp({ helloAck: { capabilities: ['interactive', 'thread'] },
    buildReplyFrames: replies }, { secondServer: { buildReplyFrames: bytes => {
      const request = decodeEnvelope(bytes); legacyRequests.push(request)
      return request.type === 'list_conversations' ? [seedConversationsFrame(SECOND_SEEDED_ROW)] : []
    } } })
  await page.getByText(SEEDED_ROW.name!, { exact: true }).first().click()
  await expect(page.getByText('Authoritative saved answer', { exact: true })).toBeVisible()
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 800 })
    await capturePairedApp(app, page, `/tmp/builder-1908/thread-${width}.png`)
  }
  expect(requests.some(r => r.type === 'thread_catch_up')).toBe(true)
  // Commit a later authoritative row after deliberately supplied legacy traffic, then check exclusions.
  daemon.pushFrame(frame('assistant_delta', { conversation_id: row.id, turn_id: 'raw', seq: 1, text: 'Legacy duplicate' }))
  row.last_shown_version = 21
  daemon.pushFrame(seedConversationsFrame(row))
  daemon.pushFrame(frame('thread_item_added', { conversation_id: row.id, epoch: 'epoch', version: 21, item: item(11, 'Thread processing barrier') }))
  await expect(page.getByText('Thread processing barrier', { exact: true })).toBeVisible()
  await expect(page.getByText('Legacy duplicate', { exact: true })).toHaveCount(0)
  await expect.poll(() => requests.some(request => request.type === 'mark_conversation_read' && request.payload.up_to === 21)).toBe(true)
  // The protected list writer captures received list replies, independently of publishing the command.
  await expect.poll(() => page.evaluate(async id => {
    const result = await window.pyry.chatHistory({ operation: 'readList', serverId: 'fake-daemon' })
    return result.status === 'stored' && result.snapshot.kind === 'list'
      ? result.snapshot.conversations.find(row => row.id === id)?.read_up_to : undefined
  }, row.id)).toBe(21)
  await page.locator('.conversation__thread').press('Home')
  await expect.poll(() => requests.filter(r => r.type === 'thread_page').length).toBeGreaterThan(0)
  expect(requests.filter(r => r.type === 'request_history')).toHaveLength(0)
  await page.getByText(SECOND_SEEDED_ROW.name!, { exact: true }).first().click()
  await expect.poll(() => legacyRequests.filter(r => r.type === 'request_history').length).toBeGreaterThan(0)
  expect(legacyRequests.some(r => r.type === 'thread_catch_up')).toBe(false)
  await page.getByText(SEEDED_ROW.name!, { exact: true }).first().click()
  await expect(page.getByText('Authoritative saved answer', { exact: true })).toBeVisible()
  const before = requests.filter(r => r.type === 'thread_catch_up').length
  forwarder.dropClientLeg()
  await expect.poll(() => requests.filter(r => r.type === 'thread_catch_up').length).toBeGreaterThan(before)
  expect(requests.filter(r => r.type === 'thread_catch_up').at(-1)?.payload).toMatchObject({ epoch: 'epoch', version: 21 })
  await expect(page.getByText('Authoritative saved answer', { exact: true })).toHaveCount(1)
})

test('ordinary thread submission settles authenticated identity, routes queue actions and invalidates session prompts', async ({ launchPairedApp }) => {
  let deviceId = '', version = 20, session = 'A'
  const requests: Envelope[] = []
  const route = { conversation_id: SEEDED_ROW.id, epoch: 'epoch' }
  const queued: ThreadItem = { id: 50, rev: 1, kind: 'user_message', shown: true, active: true, status: 'queued',
    summary: 'Queued integration message', content: {} }
  const { page, daemon } = await launchPairedApp({ helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes); requests.push(request)
    if (request.type === 'list_conversations') return [seedConversationsFrame({ ...SEEDED_ROW, current_session_id: session })]
    if (request.type === 'thread_catch_up') return [frame('thread_items', { ...route, version,
      items: [item(10, 'Initial authoritative content')], final: false }, request.id),
      frame('thread_items', { ...route, version, items: [], final: true,
        ...(Number(request.payload.version) > 0 ? { from_version: request.payload.version }
          : { lower_order: 0, upper_order: 21, continuation: 0, older_exists: false }) }, request.id)]
    if (request.type === 'send_message') {
      queued.content = { text: request.payload.text, device_id: deviceId, message_id: request.payload.message_id, queued_msg_id: 7 }
      return [frame('thread_item_added', { ...route, version: ++version, item: queued })]
    }
    if (request.type === 'dequeue_message') return [frame('thread_item_changed', { ...route, version: ++version,
      item_id: 50, base_rev: 1, rev: 2, changes: { shown: false, active: false, status: 'dropped' } })]
    return []
  } })
  const identity = await page.evaluate(() => window.pyry.deviceIdentity())
  expect(identity.ok).toBe(true)
  if (!identity.ok) throw new Error('identity unavailable')
  deviceId = identity.deviceId
  await expect(page.getByText('Initial authoritative content', { exact: true })).toBeVisible()
  await page.locator('textarea').fill('Queued integration message')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('Queued integration message', { exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Drop queued message' })).toBeVisible()
  await page.getByRole('button', { name: 'Drop queued message' }).click()
  await expect.poll(() => requests.filter(r => r.type === 'dequeue_message').length).toBe(1)
  expect(requests.find(r => r.type === 'dequeue_message')?.payload.queued_msg_id).toBe(7)
  await expect(page.getByText('Queued integration message', { exact: true })).toHaveCount(0)
  const permission = (title: string) => frame('modal_shown', { conversation_id: SEEDED_ROW.id,
    modal_id: 'permission', class: 'permission', title, prompt: 'Run the integration tool?',
    options: [{ id: 'deny', label: 'Deny' }, { id: 'allow_once', label: 'Allow once' }], default_option_id: 'deny' }, undefined, session)
  daemon.pushFrame(permission('Session A permission'))
  await expect(page.getByText('Session A permission', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Allow once', exact: true }).click()
  await expect(page.getByText('Activate this choice again to confirm.')).toBeVisible()
  session = 'B'
  daemon.pushFrame(seedConversationsFrame({ ...SEEDED_ROW, current_session_id: session }))
  daemon.pushFrame(frame('thread_item_added', { ...route, version: ++version, item: item(11, 'Session replacement barrier') }))
  await expect(page.getByText('Session replacement barrier', { exact: true })).toBeVisible()
  await expect(page.getByText('Session A permission', { exact: true })).toHaveCount(0)
  daemon.pushFrame(permission('Session B permission'))
  await expect(page.getByText('Session B permission', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Allow once', exact: true }).click()
  await expect(page.getByText('Activate this choice again to confirm.')).toBeVisible()
  expect(requests.filter(r => r.type === 'modal_answer')).toHaveLength(0)
  await page.getByRole('button', { name: 'Allow once', exact: true }).click()
  await expect.poll(() => requests.filter(r => r.type === 'modal_answer').length).toBe(1)
  await expect(page.getByText('Session B permission', { exact: true })).toHaveCount(0)
})

test('a fresh offline app draws its protected authoritative saved history', async ({ launchPairedApp }) => {
  const route = { conversation_id: SEEDED_ROW.id, epoch: 'saved-epoch', version: 20 }
  const first = await launchPairedApp({ helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes)
    if (request.type === 'list_conversations') return [seedConversationsFrame(SEEDED_ROW)]
    if (request.type !== 'thread_catch_up') return []
    return [frame('thread_items', { ...route, items: [item(10, 'Protected offline authoritative answer')], final: false }, request.id),
      frame('thread_items', { ...route, items: [], final: true, lower_order: 0, upper_order: 21, continuation: 0, older_exists: false }, request.id)]
  } })
  await expect(first.page.getByText('Protected offline authoritative answer', { exact: true })).toBeVisible()
  await expect.poll(async () => first.page.evaluate(async id => {
    const result = await window.pyry.chatHistory({ operation: 'readThread', serverId: 'fake-daemon', conversationId: id })
    return result.status === 'stored' && result.snapshot.kind === 'daemon-items' ? result.snapshot.thread.checkpoint : null
  }, SEEDED_ROW.id)).toBe(20)
  await first.app.close()
  await first.forwarder.close()
  const second = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir })
  await second.page.getByText(SEEDED_ROW.name!, { exact: true }).first().click()
  await expect(second.page.getByText('Protected offline authoritative answer', { exact: true })).toBeVisible()
  await expect(second.page.getByText('Offline. Showing saved messages.', { exact: true })).toBeVisible()
})

test('reconnect upgrades and downgrades the same host without mixing content writers', async ({ launchPairedApp }) => {
  const capabilities = ['interactive'], requests: Envelope[] = []
  const { page, daemon, forwarder } = await launchPairedApp({ helloAck: { capabilities }, buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes); requests.push(request)
    if (request.type === 'list_conversations') return [seedConversationsFrame(SEEDED_ROW)]
    if (request.type !== 'thread_catch_up') return []
    const route = { conversation_id: SEEDED_ROW.id, epoch: 'upgraded', version: 10 }
    return [frame('thread_items', { ...route, items: [item(1, 'Upgraded thread content')], final: false }, request.id),
      frame('thread_items', { ...route, items: [], final: true, lower_order: 0, upper_order: 11, continuation: 0, older_exists: false }, request.id)]
  } })
  daemon.pushFrame(frame('assistant_delta', { conversation_id: SEEDED_ROW.id, turn_id: 'legacy', seq: 1, text: 'Original legacy content' }))
  await expect(page.getByText('Original legacy content', { exact: true })).toBeVisible()
  capabilities.push('thread'); forwarder.dropClientLeg()
  await expect(page.getByText('Upgraded thread content', { exact: true })).toBeVisible()
  await expect(page.getByText('Original legacy content', { exact: true })).toHaveCount(0)
  capabilities.splice(capabilities.indexOf('thread'), 1)
  forwarder.dropClientLeg()
  await expect.poll(() => requests.filter(r => r.type === 'request_history').length).toBeGreaterThan(1)
  daemon.pushFrame(frame('assistant_delta', { conversation_id: SEEDED_ROW.id, turn_id: 'fallback', seq: 1, text: 'Downgraded legacy barrier' }))
  await expect(page.getByText('Downgraded legacy barrier', { exact: true })).toBeVisible()
  await expect(page.getByText('Upgraded thread content', { exact: true })).toHaveCount(0)
})
