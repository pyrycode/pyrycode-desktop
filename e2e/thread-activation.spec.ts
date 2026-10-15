import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope } from '../src/shared/wire/types'
import type { ThreadItem } from '../src/shared/wire/thread'
import { capturePairedApp } from './fixtures/capturePairedApp'

const stamp = '2026-10-15T00:00:00Z'
const item = (id: number, text: string): ThreadItem => ({ id, rev: 1, order: id, kind: 'assistant_message',
  status: 'finished', active: false, shown: true, summary: text, content: { text }, session: 'session' })
const frame = (type: string, payload: unknown, reply?: number, session_id?: string) =>
  encodeEnvelope({ id: 100, type, ts: stamp, payload, ...(reply === undefined ? {} : { in_reply_to: reply }),
    ...(session_id === undefined ? {} : { session_id }) })

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
