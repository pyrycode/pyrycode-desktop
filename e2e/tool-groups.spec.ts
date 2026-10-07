import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { EnvelopeType, SendMessagePayload } from '../src/shared/wire/types'

const ts = '2026-09-11T12:00:00Z'
const payload = (id: string, parent?: string, name = 'Agent') => ({
  conversation_id: SEEDED_ROW.id, turn_id: 'groups-turn', tool_use_id: id,
  parent_tool_use_id: parent, name, input_summary: id
})
const frame = (type: EnvelopeType, value: unknown) => encodeEnvelope({ id: 1, type, ts, payload: value })

test('interleaved subagents group, update while collapsed, and retain expansion through history', async ({ launchPairedApp }) => {
  let historyRequest: number | undefined
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: (bytes) => {
    const envelope = decodeEnvelope(bytes)
    if (envelope.type === 'request_history') {
      historyRequest = envelope.id
      return []
    }
    return [seedConversationsFrame()]
  } })
  await page.locator('.conversation__thread').focus()
  await page.keyboard.press('Home')
  const use = (id: string, parent?: string, name = 'Agent') => daemon.pushFrame(frame('tool_use', payload(id, parent, name)))
  const resolve = (id: string) => daemon.pushFrame(frame('tool_result', {
    ...payload(id), is_error: false, result_summary: `result of ${id}`
  }))
  const row = (id: string) => page.locator('.tool-row:not(.tool-run__row)').filter({
    has: page.locator('.tool-row__summary', { hasText: new RegExp(`^${id}$`) })
  })
  use('agent-a')
  use('agent-b')
  use('child-a', 'agent-a', 'Read')
  use('child-b', 'agent-b', 'Read')
  await page.locator('.tool-run button').click()
  const a = row('agent-a')
  const b = row('agent-b')
  await expect(a.locator('.tool-row__count')).toHaveText('1 tool · running')
  await expect(row('child-a')).toBeHidden()
  await a.locator('.tool-row__chip').click()
  await expect(row('child-a')).toBeVisible()
  await expect(row('child-a').locator('..')).toHaveCSS('margin-inline-start', '16px')
  use('inner', 'agent-a', 'Task')
  use('deep', 'inner', 'Bash')
  await expect(a.locator('.tool-row__count')).toHaveText('3 tools · running')
  await expect(row('inner')).toBeVisible()
  await expect(row('deep')).toBeHidden()
  await row('inner').locator('.tool-row__chip').click()
  await expect(row('deep')).toBeVisible()
  await expect(row('deep').locator('..')).toHaveCSS('margin-inline-start', '32px')
  await expect(page.locator('.tool-row:not(.tool-run__row) .tool-row__summary:visible')).toHaveText(['agent-a', 'child-a', 'inner', 'deep', 'agent-b'])
  resolve('child-a')
  await row('child-a').locator('.tool-row__chip').click()
  await expect(row('child-a').locator('.tool-row__result')).toHaveText('result of child-a')
  await a.locator('.tool-row__chip').click()
  await expect(row('deep')).toBeHidden()
  for (const id of ['agent-a', 'inner', 'deep', 'agent-b', 'child-b']) resolve(id)
  await expect(a.locator('.tool-row__count')).toHaveText('3 tools')
  await expect(b.locator('.tool-row__count')).toHaveText('1 tool')
  await a.locator('.tool-row__chip').click()
  await expect(row('deep')).toBeVisible()
  await expect(row('child-a').locator('.tool-row__result')).toBeVisible()

  use('former-leaf')
  resolve('former-leaf')
  await row('former-leaf').locator('.tool-row__chip').click()
  await expect(row('former-leaf').locator('.tool-row__result')).toBeVisible()
  use('orphan', 'historical-agent', 'Read')
  resolve('orphan')
  await row('orphan').locator('.tool-row__chip').click()
  await expect(row('orphan').locator('.tool-row__result')).toBeVisible()
  await expect.poll(() => historyRequest).toBeDefined()
  daemon.pushFrame(encodeEnvelope({ id: 2, type: 'history_page', ts, in_reply_to: historyRequest,
    payload: { cursor: '', at_start: true, entries: [
      { id: 13, type: 'tool_use', ts: '2026-09-10T12:00:13Z', payload: payload('new-descendant', 'former-leaf', 'Read') },
      { id: 12, type: 'tool_result', ts: '2026-09-10T12:00:12Z', payload: { ...payload('history-child', 'historical-agent', 'Read'), is_error: false, result_summary: 'replayed result' } },
      { id: 11, type: 'tool_use', ts: '2026-09-10T12:00:11Z', payload: payload('history-child', 'historical-agent', 'Read') },
      { id: 10, type: 'tool_use', ts: '2026-09-10T12:00:10Z', payload: payload('historical-agent') }
    ] }
  }))
  await expect(row('historical-agent').locator('.tool-row__count')).toHaveText('2 tools · running')
  await expect(row('orphan')).toBeHidden()
  await row('historical-agent').locator('.tool-row__chip').click()
  await expect(row('orphan').locator('.tool-row__result')).toBeVisible()
  await row('history-child').locator('.tool-row__chip').click()
  await expect(row('history-child').locator('.tool-row__result')).toHaveText('replayed result')
  await expect(row('deep')).toBeVisible()
  await expect(row('child-a').locator('.tool-row__result')).toBeVisible()
  await expect(row('former-leaf').locator('.tool-row__result')).toBeVisible()
  await expect(row('new-descendant')).toBeVisible()
  await page.screenshot({ path: '/tmp/1239-tool-groups.png' })
})

test('visible tool rows keep joined borders across collapsed descendants', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp()
  for (const [id, parent, name] of [
    ['a', undefined, 'Agent'], ['a1', 'a', 'Read'], ['a2', 'a', 'Read'],
    ['b', undefined, 'Task'], ['b1', 'b', 'Read'], ['c', undefined, 'Read']
  ] as const) {
    daemon.pushFrame(frame('tool_use', payload(id, parent, name)))
    if (id === 'b1') daemon.pushFrame(frame('turn_end', {
      conversation_id: SEEDED_ROW.id, turn_id: 'groups-turn', stop_reason: 'end_turn'
    }))
  }
  for (const id of ['a1', 'a2', 'b', 'c']) daemon.pushFrame(frame('tool_result', {
    ...payload(id), is_error: id === 'a2' || id === 'b', result_summary: `result of ${id}`
  }))
  const row = (id: string) => page.locator('.tool-row:not(.tool-run__row)').filter({
    has: page.locator('.tool-row__summary', { hasText: new RegExp(`^${id}$`) })
  })
  await expect(row('c')).toHaveClass(/tool-row--resolved/)
  await page.locator('.tool-run button').click()

  const expectStacks = async (stacks: string[][]) => {
    await expect(page.locator('.tool-row:not(.tool-run__row) .tool-row__summary:visible')).toHaveText(stacks.flat())
    stacks = [['header', ...stacks[0]], ...stacks.slice(1)]
    const readings = await page.locator('.tool-row:visible').evaluateAll((elements) => elements.map((element) => {
      const css = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      const theme = getComputedStyle(document.documentElement)
      return {
        top: box.top, bottom: box.bottom, margin: parseFloat(css.marginTop),
        corners: [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomLeftRadius, css.borderBottomRightRadius],
        shadow: css.boxShadow, topColor: css.borderTopColor, bottomColor: css.borderBottomColor,
        sideColor: css.borderLeftColor,
        radius: theme.getPropertyValue('--radius-xs').trim()
      }
    }))
    let offset = 0
    for (const stack of stacks) {
      const members = readings.slice(offset, offset + stack.length)
      for (const [index, current] of members.entries()) {
        const previous = members[index - 1]
        const next = members[index + 1]
        expect(current.corners).toEqual([
          previous ? '0px' : current.radius, previous ? '0px' : current.radius,
          next ? '0px' : current.radius, next ? '0px' : current.radius
        ])
        expect(current.sideColor).toBe(readings[0].sideColor)
        expect(current.topColor).toBe(readings[0].sideColor)
        expect(current.bottomColor).toBe(readings[0].sideColor)
        if (next) expect(current.shadow).toBe('none')
        else expect(current.shadow).not.toBe('none')
        if (previous) {
          expect(Math.abs(current.top - previous.bottom + 1), `${stack[index]} join`).toBeLessThanOrEqual(0.5)
          expect(current.margin).toBeLessThan(0)
        } else {
          expect(current.margin).toBe(0)
          const priorStack = readings[offset - 1]
          if (priorStack) expect(current.top - priorStack.bottom).toBeGreaterThan(0)
        }
      }
      offset += stack.length
    }
  }

  await expectStacks([['a', 'b', 'c']])
  await row('a').locator('.tool-row__chip').click()
  await expectStacks([['a'], ['a1', 'a2'], ['b', 'c']])
  await row('a1').locator('.tool-row__chip').click()
  await expect(row('a1').locator('.tool-row__result')).toBeVisible()
  await expectStacks([['a'], ['a1', 'a2'], ['b', 'c']])
  await row('a').locator('.tool-row__chip').click()
  await expectStacks([['a', 'b', 'c']])
  await row('b').locator('.tool-row__chip').click()
  await expectStacks([['a', 'b'], ['b1'], ['c']])
  await row('b').locator('.tool-row__chip').click()
  await expectStacks([['a', 'b', 'c']])
})

// Synthetic lifecycle inputs; no daemon ids are exposed in DOM attributes.
test('started background agents follow the tail, navigate markers, and settle on inactive delivery', async ({ launchPairedApp }) => {
  const quiet = { ...SEEDED_ROW, id: 'quiet-agent-chat', name: 'Quiet agent room' }
  let sentMessageId: string | undefined
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const envelope = decodeEnvelope(bytes)
    if (envelope.type === 'send_message') {
      sentMessageId = (envelope.payload as SendMessagePayload).message_id
      return []
    }
    if (envelope.type === 'request_history') return []
    return [seedConversationsFrame()]
  } })
  await page.setViewportSize({ width: 1280, height: 800 })
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, quiet] }))
  const thread = page.locator('.conversation__thread')
  const row = (id: string) => page.locator('.tool-row:not(.tool-run__row)').filter({
    has: page.locator('.tool-row__summary', { hasText: new RegExp(`^${id}$`) })
  })
  const marker = (id: string) => page.locator('.agent-start-marker').filter({ hasText: id })
  const use = (id: string, parent?: string, name = 'Agent') => daemon.pushFrame(frame('tool_use', payload(id, parent, name)))
  const resolve = (id: string) => daemon.pushFrame(frame('tool_result', {
    ...payload(id), is_error: false, result_summary: 'Async agent launched'
  }))
  const start = (id: string) => daemon.pushFrame(frame('background_task_started', {
    conversation_id: SEEDED_ROW.id, task_id: `task-${id}`, tool_call_id: id,
    task_type: 'local_agent', description: id, truncated_fields: null
  }))
  const roster = (ids: string[]) => daemon.pushFrame(frame('background_task_roster', {
    conversation_id: SEEDED_ROW.id, dropped_tasks: 0,
    tasks: ids.map(id => ({ task_id: `task-${id}`, task_type: 'local_agent', description: id, truncated_fields: null }))
  }))
  const user = (text: string) => daemon.pushFrame(frame('message', {
    message_id: text, conversation_id: SEEDED_ROW.id, role: 'user', text
  }))
  const terminal = (id: string) => daemon.pushFrame(frame('background_task_updated', {
    conversation_id: SEEDED_ROW.id, task_id: `task-${id}`, status: 'completed', patch: '', summary: '', truncated_fields: null
  }))
  const isBefore = async (earlier: ReturnType<typeof row>, later: ReturnType<typeof row>) => {
    const first = await earlier.elementHandle()
    const second = await later.elementHandle()
    return first && second ? first.evaluate((a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING), second) : false
  }
  use('agent-live-a')
  use('agent-live-b')
  use('child-live-a', 'agent-live-a', 'Read')
  await page.locator('.tool-run button').click()
  await row('agent-live-a').locator('.tool-row__chip').click()
  resolve('child-live-a')
  await row('child-live-a').locator('.tool-row__chip').click()
  resolve('agent-live-a')
  resolve('agent-live-b')
  await page.locator('.tool-run button').click()
  start('agent-live-a')
  start('agent-live-b')
  roster(['agent-live-b'])
  roster(['agent-live-b', 'agent-live-a'])
  await expect(marker('agent-live-a')).toContainText('Agent started, still working')
  await expect(row('child-live-a').locator('.tool-row__result')).toBeVisible()
  user('ordinary after launches')
  await expect(thread).toContainText('ordinary after launches')
  daemon.pushFrame(frame('queue_state', { conversation_id: SEEDED_ROW.id, queued: [
    { queued_msg_id: 87, text: 'queued after launches', message_id: 'queued-agent', ts }
  ] }))
  await expect(thread).toContainText('queued after launches')
  await expect(row('agent-live-a').locator('.tool-row__count')).toHaveText('1 tool · running')
  await expect(row('agent-live-b').locator('.tool-row__count')).toHaveText('0 tools · running')
  expect(await isBefore(row('agent-live-a'), row('agent-live-b'))).toBeTruthy()
  await row('agent-live-a').locator('.tool-row__chip').click()
  await page.screenshot({ path: '/tmp/builder-1839/two-running.png' })
  await row('agent-live-a').locator('.tool-row__chip').click()
  await row('agent-live-a').locator('.tool-row__chip').click()
  await marker('agent-live-a').click()
  await expect(row('child-live-a')).toBeVisible()
  for (const key of ['Enter', 'Space']) {
    await row('agent-live-a').locator('.tool-row__chip').click()
    await marker('agent-live-a').focus()
    await page.keyboard.press(key)
    await expect(row('child-live-a').locator('.tool-row__result')).toBeVisible()
  }
  // Growth follows only while pinned, and preserves the reader's held offset.
  await thread.focus()
  await page.keyboard.press('End')
  for (let i = 0; i < 20; i++) user(`scroll filler ${i}`)
  await expect.poll(() => thread.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(4)
  use('pinned-child', 'agent-live-a', 'Read')
  await expect(row('pinned-child')).toBeVisible()
  await expect.poll(() => thread.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(4)
  await thread.focus()
  await page.keyboard.press('Home')
  await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBe(0)
  use('late-child', 'agent-live-a', 'Read')
  await expect(row('late-child')).toBeVisible()
  expect(await thread.evaluate(el => el.scrollTop)).toBe(0)
  await marker('agent-live-a').click()
  await expect(row('agent-live-a')).toBeInViewport()
  await page.screenshot({ path: '/tmp/builder-1839/running.png' })
  roster([])
  await page.locator('.channel-list__row').filter({ hasText: 'Quiet agent room' }).locator('.channel-list__row-open').click()
  terminal('agent-live-a')
  user('ordinary after finish')
  await page.locator('.channel-list__row').filter({ hasText: SEEDED_ROW.name ?? '' }).locator('.channel-list__row-open').click()
  await expect(marker('agent-live-a')).toContainText('Agent finished')
  await expect(row('agent-live-a').locator('.tool-row__count')).toHaveText('3 tools')
  await marker('agent-live-a').click()
  await expect(row('child-live-a')).toBeVisible()
  const after = thread.locator('.message-row--user').filter({ hasText: 'ordinary after finish' })
  expect(await isBefore(row('agent-live-a'), after)).toBeTruthy()
  expect(await isBefore(after, row('agent-live-b'))).toBeTruthy()
  terminal('agent-live-a')
  start('agent-live-a')
  await expect(marker('agent-live-a')).toContainText('Agent finished')
  await page.screenshot({ path: '/tmp/builder-1839/finished.png' })
  await thread.focus()
  await page.keyboard.press('Home')
  await expect(marker('agent-live-a')).toBeInViewport()
  await expect(marker('agent-live-a').locator('.conversation-status-dot')).toHaveCSS('background-color', 'rgb(47, 192, 56)')
  await page.screenshot({ path: '/tmp/builder-1839/finished-marker.png' })

  use('agent-live-c')
  resolve('agent-live-c')
  start('agent-live-c')
  user('ordinary after late launch')
  await expect(thread).toContainText('ordinary after late launch')
  expect(await isBefore(row('agent-live-a'), row('agent-live-c'))).toBeTruthy()
  roster(['agent-live-c'])
  await expect(marker('agent-live-c')).toBeVisible()
  expect(await isBefore(row('agent-live-a'), marker('agent-live-c'))).toBeTruthy()
  // B started earlier; C finishes first with no ordinary arrival between terminal frames.
  terminal('agent-live-c')
  terminal('agent-live-b')
  user('ordinary after both finishes')
  await expect(marker('agent-live-b')).toContainText('Agent finished')
  await expect(marker('agent-live-c')).toContainText('Agent finished')
  const afterBoth = thread.locator('.message-row--user').filter({ hasText: 'ordinary after both finishes' })
  await expect(afterBoth).toBeVisible()
  expect(await isBefore(row('agent-live-c'), row('agent-live-b'))).toBeTruthy()
  expect(await isBefore(row('agent-live-b'), afterBoth)).toBeTruthy()
  terminal('agent-live-c')
  start('agent-live-b')
  roster(['agent-live-b', 'agent-live-c'])
  await expect(marker('agent-live-b')).toContainText('Agent finished')
  expect(await isBefore(row('agent-live-c'), row('agent-live-b'))).toBeTruthy()

  // A queued echo keeps its identity when delivered after the Agent's finish.
  use('agent-live-d')
  resolve('agent-live-d')
  start('agent-live-d')
  roster(['agent-live-d'])
  const composer = page.getByPlaceholder('Message…')
  await composer.fill('Own queued message after finish')
  await composer.press('Enter')
  await expect.poll(() => sentMessageId).toBeDefined()
  daemon.pushFrame(frame('queue_state', { conversation_id: SEEDED_ROW.id, queued: [
    { queued_msg_id: 88, text: 'Own queued message after finish', message_id: sentMessageId, ts }
  ] }))
  const own = thread.locator('.message-row', { hasText: 'Own queued message after finish' })
  await expect(own).toHaveClass(/message-row--queued/)
  const ownNode = await own.elementHandle()
  terminal('agent-live-d')
  await expect(marker('agent-live-d')).toContainText('Agent finished')
  const delivery = { conversation_id: SEEDED_ROW.id, message_id: sentMessageId, queued_msg_id: 88,
    role: 'user', text: 'Receipt preserves own copy', sent_now: true }
  daemon.pushFrame(frame('message', delivery))
  daemon.pushFrame(frame('queue_state', { conversation_id: SEEDED_ROW.id, queued: [] }))
  await expect(own).not.toHaveClass(/message-row--queued/)
  expect(await ownNode?.evaluate(node => node.isConnected)).toBe(true)
  expect(await isBefore(row('agent-live-d'), own)).toBeTruthy()
  daemon.pushFrame(frame('message', delivery))
  user('ordinary after queued delivery')
  await expect(thread).toContainText('ordinary after queued delivery')
  await expect(own).toHaveCount(1)
  expect(await isBefore(row('agent-live-d'), own)).toBeTruthy()
  await page.screenshot({ path: '/tmp/builder-1839/queued-after-finish.png' })
})
