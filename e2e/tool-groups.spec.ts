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
