import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ThreadItem } from '../src/shared/wire/thread'

const route = { conversation_id: SEEDED_ROW.id, epoch: 'burst-epoch' }
const stamp = '2026-10-17T00:00:00Z'
const frame = (type: string, payload: unknown, reply?: number) => encodeEnvelope({ id: 1, type, ts: stamp,
  payload, ...(reply === undefined ? {} : { in_reply_to: reply }) })
const workload: ThreadItem[] = []
for (const [kind, count] of [['agent', 135], ['tool_call', 6396], ['assistant_message', 889], ['turn_end', 556],
  ['user_message', 345], ['session_divider', 12]] as const) {
  for (let n = 0; n < count; n++) {
    const id = workload.length + 1
    const content = kind === 'tool_call' || kind === 'agent'
      ? { name: kind === 'agent' ? 'Agent' : 'Read', tool_use_id: `tool-${id}`, input_summary: `fixture ${id}`,
        input: { file_path: 'fixture.txt' }, result: { result_summary: 'Complete', is_error: false },
        ...(kind === 'agent' ? { task_id: `task-${id}`, task_link: { task_id: `task-${id}`, tool_call_id: `tool-${id}` } } : {}) }
      : kind === 'session_divider' ? { reason: 'clear', occurred_at: stamp, workspace_cwd: '/fixture' }
        : kind === 'turn_end' ? { stop_reason: 'end_turn', outcome: 'completed' } : { text: `Synthetic ${kind} ${id}` }
    workload.push({ id, rev: 1, order: id, kind, status: kind === 'user_message' ? 'delivered' : 'finished',
      active: false, shown: kind !== 'turn_end', summary: `Fixture ${id}`, content,
      session: id === 1 || kind === 'tool_call' && n < 281 ? 'session' : 'older-session', agent: 'claude', turn: `turn-${Math.floor(id / 15)}`,
      ...(kind === 'tool_call' && n < 5599 ? { parent: n < 281 ? 1 : 2 + n % 134 } : {}) })
  }
}
type Fiber = { tag: number; type: unknown; memoizedProps: any; flags: number; child: Fiber | null; sibling: Fiber | null }

test('8333 finite updates keep mounted keyboard, heartbeat, delivery and teardown responsive', async ({ launchPairedApp }, testInfo) => {
  let submitted = false, deviceId = ''
  const counts = { delivered: 0, applied: 0, first: 0, last: 0 }
  const { page, daemon } = await launchPairedApp({ threadMode: 'native', buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes)
    if (request.type === 'list_conversations') return [seedConversationsFrame({ ...SEEDED_ROW, current_session_id: 'session' })]
    if (request.type === 'thread_catch_up') return [frame('thread_items', { ...route, version: 1, items: [],
      final: true, lower_order: 0, upper_order: 1, continuation: 0, older_exists: false }, request.id)]
    if (request.type === 'send_message') {
      submitted = true
      return [frame('thread_item_added', { ...route, version: 9000, item: { id: 9000, rev: 1, order: 9000,
        kind: 'user_message', status: 'delivered', shown: true, active: false, session: 'session', summary: '',
        content: { text: request.payload.text, message_id: request.payload.message_id, device_id: deviceId } } }),
      frame('thread_item_added', { ...route, version: 9001, item: { id: 9001, rev: 1, order: 9001,
        kind: 'assistant_message', status: 'finished', shown: true, active: false, session: 'session', summary: '',
        content: { text: 'Backlog reply once' } } }),
      frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'idle' })]
    }
    return []
  } }, { onLaunched: async app => {
    let buffered = ''
    app.process().stdout?.on('data', chunk => {
      buffered += String(chunk)
      let newline: number
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1)
        let record: any
        try { record = JSON.parse(line) } catch { continue }
        if (record.event === 'thread-update-delivered' && record.code === 'thread_item_added') {
          counts.delivered++; counts.first ||= Date.parse(record.ts)
        }
        if (record.event === 'thread-items-applied' && record.code === 'live') {
          counts.applied++; counts.last = Date.parse(record.ts)
        }
      }
    })
    const page = await app.firstWindow()
    await page.addInitScript(() => {
      const evidence = { commits: 0, count: 0, maxGap: 0, beats: 0, probeAt: 0, inputAt: 0, commitAt: 0,
        echoSettled: null as boolean | null, sentAtCount: 0, turnRunning: false, snapshot: null as any, observing: false }
      ;(window as any).burstRenderer = evidence
      let last = performance.now()
      setInterval(() => {
        const now = performance.now()
        if (evidence.observing) { evidence.maxGap = Math.max(evidence.maxGap, now - last); evidence.beats++ }
        last = now
      }, 20)
      document.addEventListener('keydown', event => {
        if (event.key === 'z' && evidence.observing && !evidence.inputAt) evidence.inputAt = performance.now()
        if (event.key === 'Enter' && evidence.observing) evidence.sentAtCount = evidence.count
      }, true)
      Object.assign(window, { __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true, inject: () => 1, checkDCE: () => {}, onCommitFiberUnmount: () => {},
        onCommitFiberRoot: (_renderer: number, root: { current: Fiber }) => {
          let worked = false
          const pending = [root.current]
          while (pending.length) {
            const fiber = pending.pop()!
            const props = fiber.memoizedProps
            if (fiber.type === 'textarea' && props?.value === 'z' && evidence.inputAt && !evidence.commitAt)
              evidence.commitAt = performance.now()
            if (fiber.tag === 0 && props && 'snapshot' in props && 'sendInputs' in props && 'taskInputs' in props &&
                (fiber.flags & 1) !== 0) {
              worked = true; evidence.snapshot = props.snapshot; evidence.count = props.snapshot.items.length
              evidence.turnRunning = props.turnRunning === true
              if (evidence.echoSettled === null && props.snapshot.items.some((item: ThreadItem) => item.id === 9000))
                evidence.echoSettled = props.sendInputs?.local?.localSendPending == null
            }
            if (fiber.sibling) pending.push(fiber.sibling)
            if (fiber.child) pending.push(fiber.child)
          }
          if (worked && evidence.observing) evidence.commits++
        }
      } })
    })
    await page.reload()
  } })
  await expect(page.getByText('Loading messages…', { exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).burstRenderer.snapshot?.checkpoint)).toBe(1)
  const identity = await page.evaluate(() => window.pyry.deviceIdentity())
  if (!identity.ok) throw Error('fixture identity unavailable')
  deviceId = identity.deviceId
  await page.locator('textarea').focus()
  await page.evaluate(() => { (window as any).burstRenderer.observing = true })
  for (const item of workload) daemon.pushFrame(frame('thread_item_added', { ...route, version: item.id + 1, item }))
  const main = async () => ({ ...counts })
  const renderer = () => page.evaluate(() => {
    const { snapshot, ...counts } = (window as any).burstRenderer
    return counts
  })
  await expect.poll(async () => (await main()).applied).toBeGreaterThan(128)
  const before = await main()
  expect(before.applied).toBeGreaterThan(0); expect(before.applied).toBeLessThan(8333)
  await page.evaluate(() => { (window as any).burstRenderer.probeAt = performance.now() })
  await page.keyboard.type('z')
  await expect(page.locator('textarea')).toHaveValue('z')
  await expect.poll(async () => (await renderer()).commitAt).toBeGreaterThan(0)
  const input = await renderer()
  expect(input.inputAt).toBeGreaterThan(0)
  expect(input.commitAt - input.probeAt).toBeLessThanOrEqual(1000)
  // Positive processing barriers enclose the input and heartbeat observations without pausing work.
  await expect.poll(async () => (await main()).applied).toBeGreaterThan(before.applied + 128)
  const during = await main()
  expect(during.applied).toBeLessThan(8333)
  expect((await renderer()).beats).toBeGreaterThan(0)
  await page.keyboard.press('Enter')
  await expect.poll(() => submitted).toBe(true)
  expect((await renderer()).sentAtCount).toBeLessThan(8333)
  await expect.poll(async () => (await main()).applied, { timeout: 60000 }).toBe(8335)
  await expect.poll(async () => (await renderer()).count).toBe(8335)
  await expect(page.getByText('Backlog reply once', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Sending…', { exact: true })).toHaveCount(0)
  expect((await renderer()).echoSettled).toBe(true)
  expect((await renderer()).turnRunning).toBe(false)
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
  const finished = await main()
  expect(finished.delivered).toBe(8335)
  expect(finished.last - finished.first).toBeLessThanOrEqual(60000)
  const final = await page.evaluate(() => {
    const s = (window as any).burstRenderer.snapshot
    return { ids: s.items.map((item: ThreadItem) => item.id), checkpoint: s.checkpoint, repair: s.repair,
      parents: s.items.filter((item: ThreadItem) => item.parent !== undefined).length,
      selected: s.items.filter((item: ThreadItem) => item.session === 'session').length }
  })
  expect(final).toEqual({ ids: [...workload.map(item => item.id), 9000, 9001], checkpoint: 9001,
    repair: null, parents: 5599, selected: 284 })
  await page.waitForTimeout(1000)
  expect((await main()).applied).toBe(finished.applied)
  const observed = await renderer()
  await testInfo.attach('burst-evidence', { body: JSON.stringify({ before, during, finished, renderer: observed }), contentType: 'application/json' })
  expect(observed.maxGap).toBeLessThanOrEqual(1000)
  expect(observed.commits).toBeGreaterThan(1)
})
