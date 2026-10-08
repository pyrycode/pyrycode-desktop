import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'

type EvidenceWindow = typeof window & {
  deltaFrames: {
    begin: () => void
    read: () => { delivered: number; requests: number; commits: number; pending: number; injected: number }
    release: () => void
    stop: () => void
  }
}

test('the mounted bridge publishes a delta-only burst on its first frame with one React commit', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: bytes => {
      const request = decodeEnvelope(bytes)
      if (request.type === 'list_conversations') return [seedConversationsFrame()]
      if (request.type === 'request_history') return [encodeEnvelope({ id: 1, type: 'history_page',
        ts: '2026-10-08T00:00:00Z', in_reply_to: request.id,
        payload: { entries: [], cursor: '', at_start: true } })]
      return []
    }
  }, {
    onLaunched: async app => {
      const page = await app.firstWindow()
      await page.addInitScript(() => {
        let holding = false
        let delivered = 0
        let requests = 0
        let commits = 0
        let injected = 0
        let ordinal = -1
        const callbacks = new Map<number, FrameRequestCallback>()
        const request = window.requestAnimationFrame.bind(window)
        const cancel = window.cancelAnimationFrame.bind(window)
        window.requestAnimationFrame = callback => {
          if (!holding) return request(callback)
          requests++
          callbacks.set(ordinal--, callback)
          return ordinal + 1
        }
        window.cancelAnimationFrame = handle => {
          if (callbacks.delete(handle)) return
          cancel(handle)
        }
        // React's production hook observes mounted commits without adding app instrumentation.
        Object.assign(window, { __REACT_DEVTOOLS_GLOBAL_HOOK__: {
          supportsFiber: true,
          inject: () => ++injected,
          onCommitFiberRoot: () => { if (holding) commits++ },
          onCommitFiberUnmount: () => {},
          checkDCE: () => {}
        } })
        let off = () => {}
        ;(window as EvidenceWindow).deltaFrames = {
          begin: () => {
            delivered = 0; requests = 0; commits = 0; holding = true
            off = window.pyry.onDaemonEvent(event => { if (event.type === 'assistantDelta') delivered++ })
          },
          read: () => ({ delivered, requests, commits, pending: callbacks.size, injected }),
          release: () => {
            const accepted = [...callbacks.values()]
            callbacks.clear()
            accepted.forEach(callback => callback(performance.now()))
          },
          stop: () => { holding = false; off(); window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel }
        }
      })
      await page.reload()
    }
  })
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 100)))
  await page.evaluate(() => (window as EvidenceWindow).deltaFrames.begin())
  try {
    for (let seq = 0; seq < 12; seq++) daemon.pushFrame(encodeEnvelope({
      id: seq + 10, type: 'assistant_delta', ts: `2026-10-08T00:00:${String(seq).padStart(2, '0')}Z`,
      payload: { conversation_id: SEEDED_ROW.id, turn_id: 'frame-turn', seq, text: `${seq},` }
    }))
    const read = () => page.evaluate(() => (window as EvidenceWindow).deltaFrames.read())
    await expect.poll(async () => (await read()).delivered).toBe(12)
    expect((await read()).injected).toBeGreaterThan(0)
    expect((await read()).requests).toBe(1)
    expect((await read()).pending).toBe(1)
    await expect(page.locator('[data-thread-role="assistant"]')).toHaveCount(0)
    // Earlier non-timeline subscribers may commit activity feedback on receipt. Count the
    // publication commit after all deliveries, before releasing the only scheduled frame.
    const before = (await read()).commits
    await page.evaluate(() => (window as EvidenceWindow).deltaFrames.release())
    await expect(page.locator('[data-thread-role="assistant"] .bubble__markdown')).toHaveText('0,1,2,3,4,5,6,7,8,9,10,11,')
    expect((await read()).commits - before).toBe(1)
    expect((await read()).pending).toBe(0)
  } finally {
    await page.evaluate(() => (window as EvidenceWindow).deltaFrames.stop())
  }
})
