import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { EnvelopeType } from '../src/shared/wire/types'

const frame = (type: EnvelopeType, payload: unknown) => encodeEnvelope({
  id: 1, type, ts: '2026-10-08T00:00:00Z', payload
})
const owner = { conversation_id: SEEDED_ROW.id, turn_id: 'reuse' }
const delta = (text: string, turn = 'reuse') => frame('assistant_delta', {
  ...owner, turn_id: turn, seq: 0, text
})
const end = (turn = 'reuse') => frame('turn_end', {
  ...owner, turn_id: turn, stop_reason: 'end_turn'
})

// Mounted V8 counters, rather than DOM equality, prove skipped execution. Each delivered
// chunk has its own display barrier so transport/React batching cannot manufacture a skip.
test('settled rows skip deltas and unrelated group toggles while the active reply renders', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp({})
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
  const counts = async () => {
    const coverage = await cdp.send('Profiler.takePreciseCoverage')
    const functions = coverage.result.flatMap(script => script.functions)
    return (name: string) => functions.filter(fn => new RegExp(`^${name}\\d*$`).test(fn.functionName))
      .reduce((sum, fn) => sum + (fn.ranges[0]?.count ?? 0), 0)
  }
  const row = (id: string) => page.locator('.tool-row:not(.tool-run__row)').filter({
    has: page.locator('.tool-row__summary', { hasText: new RegExp(`^${id}$`) })
  })
  const tool = (id: string, parent?: string, name = 'Read') => {
    daemon.pushFrame(frame('tool_use', { ...owner, tool_use_id: id,
      parent_tool_use_id: parent, name, input_summary: id }))
    daemon.pushFrame(frame('tool_result', { ...owner, tool_use_id: id,
      is_error: false, result_summary: `result of ${id}` }))
  }
  const assistants = page.locator('[data-thread-role="assistant"]')
  for (let i = 0; i < 3; i++) {
    daemon.pushFrame(frame('message', { ...owner, message_id: `settled-user-${i}`,
      role: 'user', text: `settled user ${i}` }))
    await expect(page.locator('[data-thread-role="user"]')).toHaveCount(i + 1)
    daemon.pushFrame(delta(`**settled reply ${i}**`, `settled-${i}`))
    await expect(assistants.last().locator('strong')).toHaveText(`settled reply ${i}`)
    daemon.pushFrame(end(`settled-${i}`))
    await expect(assistants.last().locator('.bubble__cursor')).toHaveCount(0)
  }
  tool('parent', undefined, 'Agent')
  tool('child', 'parent')
  await expect(row('parent').locator('.tool-row__count')).toHaveText('1 tool')
  await expect(row('child')).toBeHidden()
  // A message separates the unrelated tool from the grouped block, avoiding run folding.
  daemon.pushFrame(delta('another settled reply', 'separator'))
  await expect(assistants.last()).toContainText('another settled reply')
  daemon.pushFrame(end('separator'))
  await expect(assistants.last().locator('.bubble__cursor')).toHaveCount(0)
  tool('unrelated')
  await expect(row('unrelated')).toHaveClass(/tool-row--resolved/)
  daemon.pushFrame(end())
  daemon.pushFrame(delta('active'))
  const active = assistants.last().locator('.bubble__markdown')
  await expect(active).toHaveText('active')
  const initial = await counts()
  expect(initial('TimelineRow')).toBeGreaterThanOrEqual(8)
  expect(initial('ToolRow')).toBeGreaterThanOrEqual(3)
  expect(initial('AssistantMarkdown')).toBeGreaterThanOrEqual(5)
  expect(initial('StreamingAssistantMarkdown')).toBeGreaterThan(0)
  expect(initial('parseMarkdown')).toBeGreaterThan(0)

  const settledNodes = await page.locator('.message-row--text').evaluateAll(elements => {
    // References are local to the browser, never application instrumentation.
    Object.assign(window, { reuseNodes: elements.slice(0, -1) })
    return elements.length - 1
  })
  expect(settledNodes).toBeGreaterThanOrEqual(7)
  for (const text of [' one', ' two', ' three']) {
    const before = await active.innerText()
    daemon.pushFrame(delta(text))
    await expect(active).toHaveText(before + text)
    const calls = await counts()
    // Exactly one active row and markdown render, with real streaming parser work.
    expect(calls('StreamingAssistantMarkdown')).toBeGreaterThan(0)
    expect(calls('parseMarkdown')).toBeGreaterThan(0)
    expect(calls('TimelineRow')).toBe(1)
    expect(calls('AssistantMarkdown')).toBe(1)
    expect(calls('ToolRow')).toBe(0)
    expect(calls('MessageActions')).toBe(1)
  }

  const toggle = async (id: string, expanded: boolean) => {
    await row(id).locator('.tool-row__chip').click()
    await expect(row(id).locator('.tool-row__chip')).toHaveAttribute('aria-expanded', String(expanded))
    const calls = await counts()
    expect(calls('ToolRow')).toBe(1)
    expect(calls('TimelineRow')).toBe(0)
    expect(calls('AssistantMarkdown')).toBe(0)
    expect(calls('StreamingAssistantMarkdown')).toBe(0)
    expect(calls('parseMarkdown')).toBe(0)
    expect(calls('MessageActions')).toBe(0)
  }
  await toggle('parent', true)
  await expect(row('child')).toBeVisible()
  await toggle('child', true)
  await expect(row('child').locator('.tool-row__result')).toHaveText('result of child')
  await toggle('parent', false)
  await expect(row('child')).toBeHidden()
  await toggle('parent', true)
  await expect(row('child').locator('.tool-row__result')).toBeVisible()
  expect(await page.evaluate(() => {
    const nodes = Reflect.get(window, 'reuseNodes') as Element[]
    return nodes.every(node => node.isConnected)
  })).toBe(true)
  await cdp.send('Profiler.stopPreciseCoverage')
  await cdp.detach()
})
