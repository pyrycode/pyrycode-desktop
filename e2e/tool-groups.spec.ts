import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { EnvelopeType } from '../src/shared/wire/types'

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
  const row = (id: string) => page.locator('.tool-row').filter({
    has: page.locator('.tool-row__summary', { hasText: new RegExp(`^${id}$`) })
  })
  use('agent-a')
  use('agent-b')
  use('child-a', 'agent-a', 'Read')
  use('child-b', 'agent-b', 'Read')
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
  await expect(page.locator('.tool-row__summary:visible')).toHaveText(['agent-a', 'child-a', 'inner', 'deep', 'agent-b'])
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
  const row = (id: string) => page.locator('.tool-row').filter({
    has: page.locator('.tool-row__summary', { hasText: new RegExp(`^${id}$`) })
  })
  await expect(row('c')).toHaveClass(/tool-row--resolved/)

  const expectStacks = async (stacks: string[][]) => {
    await expect(page.locator('.tool-row__summary:visible')).toHaveText(stacks.flat())
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
