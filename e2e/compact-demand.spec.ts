import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope } from '../src/shared/wire/types'
import type { ThreadItem, ThreadSummary } from '../src/shared/wire/thread'
import { mintChatInWorkspace } from './fixtures/mintChatRow'
import { capturePairedApp } from './fixtures/capturePairedApp'

const capabilities = ['interactive', 'thread', 'thread_expansion', 'thread_compact']
const frame = (type: string, payload: unknown, reply?: number) => encodeEnvelope({ id: 90, type,
  ts: '2026-10-19T00:00:00Z', payload, ...(reply === undefined ? {} : { in_reply_to: reply }) })
const full = (id: number, text: string): ThreadItem => ({ id, rev: 1, order: id, kind: 'assistant_message',
  active: false, shown: true, status: 'done', summary: '', content: { text }, session: 'session' })
const header = (id: number, parent = 0, kind = 'tool_call'): ThreadSummary => ({ id, order: id, parent, kind,
  rev: 1, status: 'done', active: false, shown: true, headline: `Inspect ${id}`, detail_omitted: true,
  subtree_version: 10000, session: 'session' })

test('production compact demand keeps 8333 source items off the wire until visible expansion', async ({ launchPairedApp }, info) => {
  test.setTimeout(120000)
  const requests: Envelope[] = [], details = () => requests.filter(r => r.type === 'thread_read_children' || r.type === 'thread_read_tool_body')
  let version = 10000, parentRev = 1, holdBody = false, held: Envelope | undefined, deviceId = ''
  const roots = [full(1, '**Compact ready**'), full(4, 'Agent boundary')]
  const parent = () => ({ ...header(5, 0, 'agent'), rev: parentRev, public_child_count: 8326, has_public_children: true, subtree_version: version })
  const children = Array.from({ length: 8326 }, (_, n) => header(100 + n, 5, n === 0 ? 'agent' : n === 1 ? 'assistant_message' : 'tool_call'))
  const grandchildren = [header(9000, 100), header(9001, 100)]
  expect(roots.length + 3 + children.length + grandchildren.length).toBe(8333)
  const route = { conversation_id: SEEDED_ROW.id, epoch: 'compact' }
  const bodyFrames = (request: Envelope) => [frame('thread_tool_body', { ...route, version,
    item_id: request.payload.item_id, rev: request.payload.expected_rev, kind: request.payload.item_id === 5 ? 'agent' : 'tool_call',
    content: { input: 'supplied input', output: `Body ${request.payload.item_id}` }, final: false }, request.id),
  frame('thread_tool_body', { ...route, version, item_id: request.payload.item_id,
    rev: request.payload.expected_rev, kind: request.payload.item_id === 5 ? 'agent' : 'tool_call', final: true }, request.id)]
  const { page, app, daemon, forwarder } = await launchPairedApp({ threadMode: 'native', helloAck: { capabilities }, buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes); requests.push(request)
    if (request.type === 'list_conversations') return [seedConversationsFrame({ ...SEEDED_ROW, current_session_id: 'session', last_shown_version: version, read_up_to: 0 })]
    if (request.type === 'thread_catch_up' || request.type === 'thread_page') return [
      frame('thread_items', { ...route, conversation_id: request.payload.conversation_id, projection: 'compact-v1', version,
        items: request.type === 'thread_page' ? [full(0, 'Older root')] : roots,
        headers: request.type === 'thread_page' ? [] : [header(2), header(3), parent()], final: false }, request.id),
      frame('thread_items', { ...route, conversation_id: request.payload.conversation_id, projection: 'compact-v1', version, items: [], final: true,
        ...(request.type === 'thread_page' ? { lower_order: 0, upper_order: request.payload.before_order, continuation: 0, older_exists: false }
          : Number(request.payload.version) > 0 ? { from_version: request.payload.version }
            : { lower_order: 1, upper_order: 6, continuation: 1, older_exists: true }) }, request.id)]
    if (request.type === 'thread_read_tool_body') {
      if (holdBody) { held = request; return [] }
      return bodyFrames(request)
    }
    if (request.type === 'thread_read_children') {
      const source = request.payload.item_id === 5 ? children : grandchildren
      const cursor = request.payload.cursor as { id: number } | undefined
      const at = cursor ? source.findIndex(child => child.id === cursor.id) + 1 : 0
      const selected = source.slice(at, at + Number(request.payload.limit))
      const more = at + selected.length < source.length, last = selected.at(-1)
      return [frame('thread_children', { ...route, version, item_id: request.payload.item_id,
        rev: request.payload.expected_rev, children: selected, final: false }, request.id),
      frame('thread_children', { ...route, version, item_id: request.payload.item_id, rev: request.payload.expected_rev,
        children: [], final: true, more, ...(more && last ? { cursor: { ...route, version, item_id: request.payload.item_id,
          rev: request.payload.expected_rev, order: last.order, id: last.id } } : {}) }, request.id)]
    }
    if (request.type === 'create_conversation') return [frame('conversation_created', { ...SEEDED_ROW, id: 'created', name: 'Created compact', current_session_id: 'session' }, request.id)]
    if (request.type === 'send_message') return [frame('thread_compact_update', { ...route, projection: 'compact-v1',
      from_version: version, version: ++version, progress: false, item: { ...full(7, ''), kind: 'user_message', status: 'delivered',
        content: { text: request.payload.text, message_id: request.payload.message_id, device_id: deviceId } } })]
    return []
  } }, { onLaunched: async app => { await app.evaluate(({ ipcMain }) => {
    ;(globalThis as any).compactDiagnostics = []
    ipcMain.on('pyry:diagnostic', (_event, record) => {
      if (record.event === 'thread-compact') (globalThis as any).compactDiagnostics.push(record)
    })
  }) } })
  const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const row = (id: number) => page.locator(`[data-read-row="${id}"]`)
  const chip = (id: number) => row(id).getByRole('button', { name: `Inspect ${id}`, exact: false }).first()
  await expect(page.getByText('Compact ready', { exact: true })).toBeVisible()
  await expect(page.getByText('Loading messages…', { exact: true })).toHaveCount(0)
  await settle()
  expect(details()).toHaveLength(0)
  expect(requests.find(r => r.type === 'thread_catch_up')?.payload).toMatchObject({ projection: 'compact-v1', version: 0 })
  await expect(page.locator('.tool-row__body')).toHaveCount(0)
  await expect(row(100)).toHaveCount(0)
  await expect(row(1).locator('strong')).toHaveText('Compact ready')

  // A run reveals only headers, including after one of its former members had a body open.
  const run = page.locator('.tool-run button')
  await run.click(); await expect(chip(2)).toHaveAttribute('aria-expanded', 'false')
  expect(details()).toHaveLength(0)
  await chip(2).click(); await expect(row(2)).toContainText('Body 2')
  expect(details()).toHaveLength(1)
  await chip(2).click(); await chip(2).click(); await expect(row(2)).toContainText('Body 2')
  expect(details()).toHaveLength(1)
  await run.click(); await expect(row(2)).toHaveCount(0)
  await run.click(); await expect(chip(2)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.tool-row__body')).toHaveCount(0)

  // One direct page, then a separate nested page, never an agent body or descendant inventory.
  await chip(5).click(); await expect(page.getByText('Summary: Inspect 101', { exact: true })).toBeVisible()
  expect(details()).toHaveLength(2)
  expect(details()[1].payload).toMatchObject({ item_id: 5, expected_rev: 1, limit: 50 })
  expect(details()[1].payload.cursor).toBeUndefined()
  const nested = page.getByRole('button', { name: 'Inspect 100', exact: false }).first()
  await nested.scrollIntoViewIfNeeded()
  const anchor = await nested.evaluate(el => el.getBoundingClientRect().top)
  await nested.click(); await expect(page.getByRole('button', { name: 'Inspect 9000', exact: false })).toBeVisible()
  expect(await nested.evaluate(el => el.getBoundingClientRect().top)).toBeCloseTo(anchor, 0)
  expect(details()).toHaveLength(3)
  expect(details().at(-1)?.payload.item_id).toBe(100)
  await page.getByRole('button', { name: 'More children', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Inspect 199', exact: false })).toBeVisible()
  expect(details()).toHaveLength(4)
  expect(details().at(-1)?.payload.cursor).toMatchObject({ item_id: 5, id: 149, rev: 1, version: 10000 })
  expect(details().filter(r => r.type === 'thread_read_tool_body')).toHaveLength(1)
  await chip(5).click(); await expect(page.getByText('Summary: Inspect 101', { exact: true })).toHaveCount(0)
  await chip(5).click(); await expect(nested).toHaveAttribute('aria-expanded', 'false')
  expect(details()).toHaveLength(4)
  await row(5).getByRole('button', { name: 'Launch body', exact: true }).click()
  await expect(row(5)).toContainText('Body 5')
  expect(details().at(-1)?.payload.item_id).toBe(5)

  // Invalidation refreshes just the visible parent demand at page one, with explicit continuation.
  await row(5).getByRole('button', { name: 'Launch body', exact: true }).click()
  const beforeRefresh = details().length
  version++; parentRev++
  daemon.pushFrame(frame('thread_compact_update', { ...route, projection: 'compact-v1', from_version: version - 1, version,
    progress: false, header: parent() }))
  await expect.poll(() => details().length).toBe(beforeRefresh + 1)
  await expect(page.getByRole('button', { name: 'Inspect 199', exact: false })).toHaveCount(0)
  expect(details().at(-1)?.payload).toMatchObject({ item_id: 5, expected_rev: 2, limit: 50 })
  expect(details().at(-1)?.payload.cursor).toBeUndefined()
  await chip(5).click()

  // A held body leaves native input and React's controlled value free to commit.
  holdBody = true
  await chip(3).click(); await expect.poll(() => held?.payload.item_id).toBe(3)
  await expect(row(3)).toContainText('Loading…')
  const composer = page.locator('.composer__input'); await composer.focus()
  const start = Date.now()
  await page.keyboard.type('x')
  await expect.poll(() => composer.evaluate(el => {
    const key = Object.keys(el).find(key => key.startsWith('__reactProps$'))
    return key ? (el as any)[key].value : undefined
  })).toBe('x')
  expect(Date.now() - start).toBeLessThanOrEqual(1000)
  await chip(3).click(); await expect(row(3).locator('.tool-row__body')).toHaveCount(0)
  for (const result of bodyFrames(held!)) daemon.pushFrame(result)
  daemon.pushFrame(frame('thread_compact_update', { ...route, projection: 'compact-v1', from_version: version, version: ++version,
    progress: false, item: full(6, 'Late reply processing barrier') }))
  await expect(page.getByText('Late reply processing barrier', { exact: true })).toBeVisible()
  await expect(row(3)).not.toContainText('Body 3')

  // Current-session prompts are independent of the closed agent.
  daemon.pushFrame(encodeEnvelope({ id: 91, type: 'modal_shown', ts: '2026-10-19T00:00:00Z', session_id: 'session',
    payload: { conversation_id: SEEDED_ROW.id, modal_id: 'permission', class: 'permission', title: 'Closed agent permission',
      prompt: 'Continue?', options: [{ id: 'deny', label: 'Deny' }], default_option_id: 'deny' } }))
  await expect(page.getByText('Closed agent permission', { exact: true })).toBeVisible()
  await expect(chip(5)).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect.poll(() => requests.filter(r => r.type === 'modal_answer').length).toBe(1)
  const identity = await page.evaluate(() => window.pyry.deviceIdentity())
  expect(identity.ok).toBe(true)
  if (!identity.ok) throw Error('identity unavailable')
  deviceId = identity.deviceId
  await page.locator('.composer__input').fill('Compact submitted')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(row(7)).toContainText('Compact submitted')
  await expect(page.getByText('Compact submitted', { exact: true })).toHaveCount(1)
  daemon.pushFrame(encodeEnvelope({ id: 93, type: 'question_shown', ts: '2026-10-19T00:00:00Z', session_id: 'session',
    payload: { conversation_id: SEEDED_ROW.id, question_batch_id: 'batch', questions: [{ header: 'Choice',
      question: 'Closed agent question', options: [{ label: 'Yes', description: '' }], multi_select: false }] } }))
  await expect(page.getByText('Closed agent question', { exact: true })).toBeVisible()
  daemon.pushFrame(encodeEnvelope({ id: 94, type: 'question_dismissed', ts: '2026-10-19T00:00:00Z', session_id: 'session',
    payload: { conversation_id: SEEDED_ROW.id, question_batch_id: 'batch', outcome: 'unanswered', source: 'no_answer' } }))
  await expect(page.getByText('Closed agent question', { exact: true })).toHaveCount(0)
  expect(requests.filter(r => r.type === 'mark_conversation_read')).toHaveLength(0)
  const saved = await page.evaluate(id => window.pyry.chatHistory({ operation: 'readThread', serverId: 'fake-daemon', conversationId: id }), SEEDED_ROW.id)
  expect(saved.status).toBe('missing')

  // Reconnect rebinds active leases; no hidden body is reacquired.
  holdBody = false
  await chip(5).click(); const beforeDisconnect = details().length
  await info.attach('before-recovery', { body: JSON.stringify({ requests: requests.filter(r => r.type.startsWith('thread_')),
    diagnostics: await app.evaluate(() => (globalThis as any).compactDiagnostics) }), contentType: 'application/json' })
  forwarder.dropClientLeg()
  await expect.poll(() => requests.filter(r => r.type === 'thread_catch_up').map(r => r.payload), { timeout: 15000 }).toContainEqual(expect.objectContaining({ version: 10000, epoch: 'compact' }))
  await expect.poll(() => details().length).toBe(beforeDisconnect + 1)
  await expect(page.getByText('Summary: Inspect 101', { exact: true })).toBeVisible()
  expect(details().at(-1)?.type).toBe('thread_read_children')
  await chip(5).click()
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
    await capturePairedApp(app, page, `/tmp/builder-2128/compact-${width}.png`)
  }
  await page.locator('.conversation__thread').press('Home')
  await expect.poll(() => requests.filter(r => r.type === 'thread_page').length).toBeGreaterThan(0)
  expect(requests.find(r => r.type === 'thread_page')?.payload).toMatchObject({ projection: 'compact-v1', epoch: 'compact', before_order: 1 })
  await mintChatInWorkspace(page, SEEDED_ROW.cwd)
  await expect.poll(() => requests.some(r => r.type === 'thread_catch_up' && r.payload.conversation_id === 'created')).toBe(true)
  expect(requests.filter(r => r.type === 'thread_catch_up').at(-1)?.payload.projection).toBe('compact-v1')
  expect(requests.filter(r => r.type === 'request_history')).toHaveLength(0)
  await info.attach('request-counts', { body: JSON.stringify({ sourceItems: 8333, details: details().map(r => ({ type: r.type, payload: r.payload })),
    reads: requests.filter(r => r.type === 'mark_conversation_read').length }), contentType: 'application/json' })
})

test('compact Retry, retained complete evidence and late navigation replies remain independent', async ({ launchPairedApp }) => {
  test.setTimeout(90000)
  const grants = ['interactive', 'thread'], requests: Envelope[] = []
  const route = { conversation_id: SEEDED_ROW.id, epoch: 'same' }
  let failed = false, hold = false, held: Envelope | undefined
  const { page, daemon, forwarder } = await launchPairedApp({ threadMode: 'native', helloAck: { capabilities: grants }, buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes); requests.push(request)
    if (request.type === 'list_conversations') return [seedConversationsFrame({ ...SEEDED_ROW, current_session_id: 'session', last_shown_version: 10, read_up_to: 0 })]
    if (request.type === 'thread_catch_up') {
      const compact = request.payload.projection === 'compact-v1'
      if (compact && !failed) { failed = true; return [frame('error', { code: 'thread.query_failed', message: 'Unavailable' }, request.id)] }
      return [frame('thread_items', { ...route, conversation_id: request.payload.conversation_id, version: compact ? 20 : 10,
        ...(compact ? { projection: 'compact-v1', headers: [{ ...header(5, 0, 'agent'), subtree_version: 20 }] } : {}),
        items: [full(1, request.payload.conversation_id !== SEEDED_ROW.id ? 'Other compact' : compact ? 'Compact replacement' : 'Complete retained')], final: false }, request.id),
      frame('thread_items', { ...route, conversation_id: request.payload.conversation_id, version: compact ? 20 : 10, ...(compact ? { projection: 'compact-v1' } : {}), items: [], final: true,
        ...(Number(request.payload.version) > 0 ? { from_version: request.payload.version }
          : { lower_order: 0, upper_order: 6, continuation: 0, older_exists: false }) }, request.id)]
    }
    if (request.type === 'thread_read_children') {
      if (hold) { held = request; return [] }
      return [frame('error', { code: 'thread.query_failed', message: 'Unavailable detail' }, request.id)]
    }
    return []
  } })
  const saved = () => page.evaluate(async id => {
    const result = await window.pyry.chatHistory({ operation: 'readThread', serverId: 'fake-daemon', conversationId: id })
    return result.status === 'stored' && result.snapshot.kind === 'daemon-items' ? result.snapshot.thread.checkpoint : null
  }, SEEDED_ROW.id)
  await expect(page.getByText('Complete retained', { exact: true })).toBeVisible()
  await expect.poll(saved).toBe(10)
  grants.push('thread_expansion', 'thread_compact')
  forwarder.dropClientLeg()
  const retry = page.getByRole('button', { name: 'Retry', exact: true })
  await expect(retry).toBeVisible()
  const afterFailure = requests.filter(r => r.type === 'thread_catch_up').length
  await page.locator('.composer__input').fill('Processing barrier')
  expect(requests.filter(r => r.type === 'thread_catch_up')).toHaveLength(afterFailure)
  expect(requests.filter(r => r.type === 'thread_catch_up').map(r => r.payload)).toEqual([
    expect.objectContaining({ version: 0 }), ...requests.filter(r => r.type === 'thread_catch_up').slice(1).map(() => expect.objectContaining({ projection: 'compact-v1' }))])
  await retry.click()
  await expect(page.getByText('Compact replacement', { exact: true })).toBeVisible()
  await expect(page.getByText('Complete retained', { exact: true })).toHaveCount(0)
  const receipts = requests.filter(r => r.type === 'mark_conversation_read').length
  const chip = page.locator('[data-read-row="5"] .tool-row__chip--toggle').first()
  await chip.click(); await expect(retry).toBeVisible()
  const details = () => requests.filter(r => r.type === 'thread_read_children')
  expect(details()).toHaveLength(1)
  await chip.click(); await chip.click(); await expect(retry).toBeVisible()
  expect(details()).toHaveLength(1)
  hold = true
  await retry.click(); await expect.poll(() => held?.type).toBe('thread_read_children')
  await expect(page.getByText('Loading…', { exact: true })).toBeVisible()
  daemon.pushFrame(frame('conversations', { conversations: [{ ...SEEDED_ROW, current_session_id: 'session' },
    { ...SEEDED_ROW, id: 'other', name: 'Other discussion', current_session_id: 'session' }] }))
  await page.getByText('Other discussion', { exact: true }).click()
  await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0)
  daemon.pushFrame(frame('thread_children', { ...route, version: 20, item_id: 5, rev: 1,
    children: [{ ...header(100, 5), subtree_version: 20 }], final: false }, held!.id))
  daemon.pushFrame(frame('thread_children', { ...route, version: 20, item_id: 5, rev: 1, children: [], final: true, more: false }, held!.id))
  await expect(page.getByText('Other compact', { exact: true })).toBeVisible()
  await page.getByText(SEEDED_ROW.name!, { exact: true }).first().click()
  await expect(page.getByText('Loading messages…', { exact: true })).toHaveCount(0)
  await expect(chip).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Inspect 100', exact: false })).toHaveCount(0)
  daemon.pushFrame(frame('thread_compact_update', { ...route, projection: 'compact-v1', version: 21, from_version: 20,
    progress: false, item: full(2, 'Compact committed barrier') }))
  await expect(page.getByText('Compact committed barrier', { exact: true })).toBeVisible()
  await page.locator('.conversation__thread').press('End')
  expect(requests.filter(r => r.type === 'mark_conversation_read')).toHaveLength(receipts)
  expect(await saved()).toBe(10)
  await chip.click()
  await forwarder.close()
  await expect(page.getByText('Unavailable offline', { exact: false })).toBeVisible()
  const quiet = requests.length
  await page.getByText(SEEDED_ROW.name!, { exact: true }).first().click()
  await expect(page.getByText('Compact replacement', { exact: true })).toBeVisible()
  await expect(chip).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('Unavailable offline', { exact: false })).toBeVisible()
  await chip.click(); await chip.click()
  await expect(page.getByText('Unavailable offline', { exact: false })).toBeVisible()
  expect(requests).toHaveLength(quiet)
  expect(await saved()).toBe(10)
})
