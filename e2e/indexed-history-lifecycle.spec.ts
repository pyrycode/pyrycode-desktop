import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { readMainProcess } from './fixtures/mainProcessRead'

for (const closing of ['quit', 'window'] as const) {
  test(`indexed history drains a buffered thread replacement on ${closing} and restores it offline`, async ({ launchPairedApp }) => {
    const frame = (type: string, payload: unknown, reply?: number) => encodeEnvelope({
      id: 100, type, ts: '2026-10-15T00:00:00Z', payload, in_reply_to: reply })
    const item = { id: 10, rev: 1, order: 10, kind: 'assistant_message', status: 'finished', active: false,
      shown: true, summary: 'Indexed shutdown baseline', content: { text: 'Indexed shutdown baseline' } }
    const route = { conversation_id: SEEDED_ROW.id, epoch: 'shutdown', version: 20 }
    const first = await launchPairedApp({ threadMode: 'native', helloAck: { capabilities: ['interactive', 'thread'] },
      buildReplyFrames: bytes => {
        const request = decodeEnvelope(bytes)
        if (request.type === 'list_conversations') return [seedConversationsFrame(SEEDED_ROW)]
        return request.type === 'thread_catch_up' ? [
          frame('thread_items', { ...route, items: [item], final: false }, request.id),
          frame('thread_items', { ...route, items: [], final: true, lower_order: 0, upper_order: 21,
            continuation: 0, older_exists: false }, request.id)
        ] : []
      } })
    const read = (page: typeof first.page) => page.evaluate(id => window.pyry.chatHistory({
      operation: 'readThread', serverId: 'fake-daemon', conversationId: id }), SEEDED_ROW.id)
    await expect.poll(async () => {
      const result = await read(first.page)
      return result.status === 'stored' && result.snapshot.kind === 'daemon-items' ? result.snapshot.thread.checkpoint : null
    }).toBe(20)
    // Pause the writer's timer, then establish actual receipt/rendering before closing.
    await first.page.clock.install()
    await first.page.clock.pauseAt(new Date())
    await first.page.evaluate(() => {
      Object.assign(window, { shutdownTailReceived: new Promise<void>(resolve => {
        const off = window.pyry.onDaemonEvent(event => { if (event.type === 'threadUpdate') { off(); resolve() } }, true)
      }) })
    })
    const tail = { ...item, id: 11, order: 11, summary: 'Buffered indexed shutdown tail',
      content: { text: 'Buffered indexed shutdown tail' } }
    await first.daemon.pushFrame(frame('thread_item_added', { ...route, version: 21, item: tail }))
    await first.page.evaluate(() => (window as typeof window & { shutdownTailReceived: Promise<void> }).shutdownTailReceived)
    await first.page.clock.runFor(50) // Apply the tail; the writer's 200 ms delay remains buffered.
    await expect(first.page.getByText(tail.summary, { exact: true })).toBeVisible()
    const before = await read(first.page)
    expect(before).toMatchObject({ status: 'stored', snapshot: { thread: { checkpoint: 20, items: [item] } } })

    let reopened: typeof first.page
    if (closing === 'window' && process.platform === 'darwin') {
      await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      await expect.poll(() => readMainProcess(first.app, ({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
      await first.forwarder.close()
      ;[reopened] = await Promise.all([first.app.waitForEvent('window'), first.app.evaluate(({ app }) => app.emit('activate'))])
    } else {
      if (closing === 'quit') await first.app.close()
      else await Promise.all([first.app.waitForEvent('close'),
        first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())])
      await first.forwarder.close()
      reopened = (await launchPairedApp({ threadMode: 'native' }, { reuseUserDataDir: first.userDataDir })).page
    }
    const saved = await read(reopened)
    expect(saved).toMatchObject({ status: 'stored', snapshot: { thread: { epoch: 'shutdown', checkpoint: 21, items: [item, tail] } } })
    await reopened.getByText(SEEDED_ROW.name!, { exact: true }).first().click()
    await expect(reopened.getByText(tail.summary, { exact: true })).toBeVisible()
    await expect(reopened.getByText('Offline. Showing saved messages.', { exact: true })).toBeVisible()
    expect(await read(reopened)).toEqual(saved)
  })
}
