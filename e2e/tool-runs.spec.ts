import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { EnvelopeType } from '../src/shared/wire/types'

const ts = '2026-10-05T12:00:00Z'
const payload = (id: string) => ({ conversation_id: SEEDED_ROW.id, turn_id: 'run-turn', tool_use_id: id })
const frame = (type: EnvelopeType, value: unknown) => encodeEnvelope({ id: 1, type, ts, payload: value })

for (const width of [800, 1280]) test(`tool runs retain expansion and update collapsed status at ${width}px`, async ({ launchPairedApp }) => {
  let historyRequest: number | undefined
  const { page, daemon, app } = await launchPairedApp({ buildReplyFrames: (bytes) => {
    const request = decodeEnvelope(bytes)
    if (request.type === 'request_history') { historyRequest = request.id; return [] }
    return [seedConversationsFrame()]
  } })
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 800), width)
  const use = (id: string, parent?: string, name = 'Read') => daemon.pushFrame(frame('tool_use', {
    ...payload(id), name, input_summary: id, parent_tool_use_id: parent
  }))
  const result = (id: string, isError = false) => daemon.pushFrame(frame('tool_result', {
    ...payload(id), is_error: isError, result_summary: `result of ${id}`, result_detail: 'recorded'
  }))
  const row = (id: string) => page.locator('.tool-row:not(.tool-run__row)').filter({
    has: page.locator('.tool-row__summary', { hasText: new RegExp(`^${id}$`) })
  })
  const header = page.locator('.tool-run button')
  const capture = async (state: string) => {
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `/tmp/builder-1764/${width}-${state}.png`, animations: 'disabled' })
  }
  use('agent', undefined, 'Agent')
  use('read')
  use('child', 'agent')
  await expect(header).toHaveText('Using tools: 2')
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect(row('agent')).toBeHidden()
  await expect(header.getByRole('img', { name: 'Running', exact: true })).toBeVisible()
  await capture('running')
  use('third')
  await expect(header).toHaveText('Using tools: 3')
  for (const id of ['agent', 'child', 'read', 'third']) result(id)
  await expect(header.getByRole('img', { name: 'Done', exact: true })).toBeVisible()
  await expect(header.getByRole('img', { name: 'Running', exact: true })).toHaveCount(0)
  await capture('collapsed')
  await header.focus()
  await page.keyboard.press('Enter')
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await expect(row('agent')).toBeVisible()
  await expect(row('child')).toBeHidden()
  await row('agent').locator('button').click()
  await row('child').locator('button').click()
  await expect(row('child').locator('.tool-row__result')).toBeVisible()
  await expect(row('child').locator('..')).toHaveCSS('margin-inline-start', '16px')
  const geometry = await page.locator('.tool-run__row, .tool-group-row--depth-0:not([hidden]) > .tool-row').evaluateAll((elements) =>
    elements.slice(0, 2).map((element) => {
      const css = getComputedStyle(element), box = element.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, left: box.left, width: box.width,
        corners: [css.borderTopLeftRadius, css.borderBottomLeftRadius], shadow: css.boxShadow, height: box.height }
    }))
  expect(geometry[0].height).toBe(38)
  expect(geometry[0].corners).toEqual(['6px', '0px'])
  expect(geometry[1].corners[0]).toBe('0px')
  expect(geometry[0].shadow).toBe('none')
  expect(Math.abs(geometry[1].top - geometry[0].bottom + 1)).toBeLessThanOrEqual(0.5)
  expect(geometry[0].left).toBe(geometry[1].left)
  expect(geometry[0].width).toBe(geometry[1].width)
  await capture('expanded')
  await header.click()
  await expect(row('child')).toBeHidden()
  await header.focus()
  await page.keyboard.press('Space')
  await expect(row('child').locator('.tool-row__result')).toBeVisible()
  use('fourth')
  await expect(header).toContainText('Using tools: 4')
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await expect(row('fourth')).toBeVisible()

  // Prepending an earlier root joins the same run, preserving run and member origins.
  await page.locator('.conversation__thread').focus()
  await page.keyboard.press('Home')
  await expect.poll(() => historyRequest).toBeDefined()
  daemon.pushFrame(encodeEnvelope({ id: 2, type: 'history_page', ts, in_reply_to: historyRequest,
    payload: { cursor: '', at_start: true, entries: [
      { id: 1, type: 'tool_use', ts: '2026-10-04T12:00:00Z', payload: { ...payload('older'), name: 'Read', input_summary: 'older' } }
    ] }
  }))
  await expect(header).toContainText('Using tools: 5')
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await expect(row('child').locator('.tool-row__result')).toBeVisible()
  await header.click()
  daemon.pushFrame(frame('tool_denied', { ...payload('fourth'), tool_name: 'Read', decision_reason_type: 'rule',
    decision_reason: '', message: 'Denied', truncated_fields: null, dropped_fields: null }))
  await expect(header).toContainText('1 failed')
  await expect(header.getByRole('img', { name: 'Running', exact: true })).toBeVisible()
  result('fourth', true)
  await expect(row('fourth').locator('.tool-row__count')).toHaveText('recorded')
  await expect(header).toContainText('1 failed')
  use('fifth')
  await expect(header).toContainText('Using tools: 6')
  result('older', true)
  await expect(header).toContainText('2 failed')
  await expect(header.getByRole('img', { name: 'Failed', exact: true })).toBeVisible()
  await capture('failure-running')
  result('fifth')
  await expect(header.getByRole('img', { name: 'Running', exact: true })).toHaveCount(0)
  await expect(header.getByRole('img', { name: 'Done', exact: true })).toHaveCount(0)
  await expect(header).toContainText('2 failed')
  await capture('failure')
})
