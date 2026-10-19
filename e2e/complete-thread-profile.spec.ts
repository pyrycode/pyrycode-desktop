import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { RecordedExchange, type Recording } from './fixtures/recordedExchange'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope } from '../src/shared/wire/types'
import { mintChatInWorkspace } from './fixtures/mintChatRow'

// Synthetic strict contract, independent of retained captures and close scheduling.
function contract(): Recording {
  let id = 0
  const message = (type: string, payload: object): Envelope => ({ id: ++id, type, ts: '2026-10-19T00:00:00Z', payload })
  const query = (chat: string, resume = false) => ({ direction: 'client' as const,
    message: message('thread_catch_up', { conversation_id: chat, epoch: resume ? 'profile-epoch' : '', version: resume ? 1 : 0 }) })
  const answer = (chat: string, text: string, reply: number, resume = false) => {
    const route = { conversation_id: chat, epoch: 'profile-epoch', version: resume ? 2 : 1 }
    return [
      message('thread_items', { ...route,
        items: [{ id: 1, rev: resume ? 2 : 1, order: 1, kind: 'assistant_message', active: false, shown: true, status: 'done',
          summary: '', session: 'session', content: { text } }], final: false }),
      message('thread_items', { ...route, items: [], final: true, ...(resume ? { from_version: 1 }
        : { lower_order: 0, upper_order: 2, continuation: 0, older_exists: false }) })
    ].map(message => ({ direction: 'daemon' as const, message: { ...message, in_reply_to: reply } }))
  }
  const initial = query(SEEDED_ROW.id), created = query('created'), resumed = query('created', true)
  const first = answer(SEEDED_ROW.id, 'Complete initial', initial.message.id), second = answer('created', 'Complete created', created.message.id)
  const third = answer('created', 'Complete reconnect', resumed.message.id, true)
  return { format: 'pyrycode.daemon-exchange', version: 2,
    source: { capturedAt: '2026-10-19T00:00:00Z', desktopRevision: 'a'.repeat(40), daemonRevision: 'b'.repeat(40),
      daemonBinarySha256: 'c'.repeat(64), claudeVersion: 'synthetic-control' },
    scenario: { id: 'complete-profile-control', inputs: { nonce: 1 } },
    capabilities: ['interactive', 'thread', 'thread_expansion', 'thread_compact'], deviceId: 'device', devices: ['device', 'device'],
    barriers: [{ before: 4, name: 'creation' }],
    wire: [
      { direction: 'daemon', message: message('conversations', { conversations: [SEEDED_ROW] }) }, initial, ...first,
      { direction: 'daemon', message: message('conversation_created', { ...SEEDED_ROW, id: 'created', name: 'Created complete' }) }, created, ...second
    ].map(entry => ({ ...entry, connection: 1 })).concat([
      { ...resumed, connection: 2 }, ...third.map(entry => ({ ...entry, connection: 2 }))
    ]) }
}

test('complete-thread profile selects complete on opening, creation and reconnect; normal rejects strictly', async ({ launchPairedApp }, info) => {
  const recording = contract(), exchange = new RecordedExchange(recording)
  let mismatch: Error | undefined
  let firstQuery: Envelope | undefined
  const { page, forwarder } = await launchPairedApp({ threadMode: 'native', helloAck: { capabilities: recording.capabilities },
    buildInitialFrames: () => exchange.start(), buildReconnectFrames: () => exchange.reconnect(),
    buildReplyFrames: bytes => {
      const request = decodeEnvelope(bytes)
      if (request.type === 'create_conversation') return exchange.checkpoint('creation')
      if (request.type !== 'thread_catch_up') return []
      firstQuery ??= request
      try { return exchange.reply(bytes) }
      catch (error) { mismatch = error as Error; return [] }
    }
  })
  if (process.env.PYRY_REPLAY_BUILD_PROFILE !== 'complete-thread') {
    await expect.poll(() => mismatch?.message).toBe('Recorded exchange request mismatch at step 1')
    expect(firstQuery?.payload).toEqual({ conversation_id: expect.any(String), epoch: '', version: 0, projection: 'compact-v1' })
    expect(() => exchange.assertComplete()).toThrow('Recorded exchange request mismatch at step 1')
    expect(exchange.stats()).toEqual({ matchedRequests: 0, emittedFrames: 1, remainingRequests: 3 })
  } else {
    expect(mismatch?.message).toBeUndefined()
    expect(exchange.stats().matchedRequests).toBe(1)
    await expect(page.getByText('Complete initial', { exact: true })).toBeVisible()
    await mintChatInWorkspace(page, '/fake/workspace')
    await expect(page.getByText('Complete created', { exact: true })).toBeVisible()
    forwarder.dropClientLeg()
    await expect(page.getByText('Complete reconnect', { exact: true })).toBeVisible()
    expect(mismatch).toBeUndefined()
    exchange.assertComplete()
    expect(exchange.stats()).toEqual({ matchedRequests: 3, emittedFrames: 8, remainingRequests: 0 })
  }
  await info.attach('profile-query-contract', { contentType: 'application/json', body: Buffer.from(JSON.stringify(exchange.stats())) })
})

test('changed complete payload and envelope fields remain strict', () => {
  for (const change of ['projection', 'version', 'extra-envelope']) {
    const exchange = new RecordedExchange(contract())
    const seed = decodeEnvelope(exchange.start()[0])
    const chat = (seed.payload.conversations as { id: string }[])[0].id
    const request: Envelope = { id: 100, type: 'thread_catch_up', ts: '2026-10-19T00:00:00Z',
      payload: { conversation_id: chat, epoch: '', version: 0 } }
    if (change === 'projection') request.payload.projection = 'compact-v1'
    if (change === 'version') request.payload.version = 1
    if (change === 'extra-envelope') request.conversation_id = chat
    expect(() => exchange.reply(encodeEnvelope(request))).toThrow('Recorded exchange request mismatch at step 1')
    expect(() => exchange.assertComplete()).toThrow('Recorded exchange request mismatch at step 1')
  }
})
