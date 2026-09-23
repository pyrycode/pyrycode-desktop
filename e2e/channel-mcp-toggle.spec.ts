import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { MCPServerStatus, MCPStatusPayload } from '../src/shared/wire/types'

// #1587: every server row carries an on/off switch that shows what the last report said. A flip sends one
// `mcp_toggle` to the opposite state, and every switch and Reconnect stays disabled until the next report,
// a refusal, or the sheet closing. The switch re-renders from the answer, never from the request. A refusal
// keeps the rows and switches as reported and shows a client-owned notice until the next report.

const REFUSED = 'The daemon refused to change the MCP server.'
const server = (name: string, status: string): MCPServerStatus => ({ name, status, error: '', scope: 'user', version: '1' })
const report = (...servers: MCPServerStatus[]): MCPStatusPayload =>
  ({ conversation_id: SEEDED_ROW.id, servers, dropped_servers: 0 })
const frame = (payload: MCPStatusPayload) =>
  encodeEnvelope({ id: 1, type: 'mcp_status', ts: '2026-09-23T12:00:00Z', payload })

test('a switch flip sends once, waits, re-renders from the answer and shows a refusal as a notice', async ({ launchPairedApp }) => {
  const fake = conversationStateFake({
    conversations: [SEEDED_ROW],
    mcpStatusAnswers: { [SEEDED_ROW.id]: report(server('docs', 'connected'), server('quiet', 'disabled'), server('broken', 'failed')) }
  })
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake })
  const sheet = page.getByRole('dialog')
  const switches = sheet.getByRole('switch')
  const switchOf = (name: string) => sheet.getByRole('switch', { name, exact: true })
  // `quiet` and `broken` both read other than `connected`, so both offer Reconnect (#1583's rule).
  const reconnects = sheet.getByRole('button', { name: 'Reconnect', exact: true })
  const notice = sheet.getByText(REFUSED, { exact: true })
  const open = async () => {
    await page.locator('.conversation__overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Channel info' }).click()
    await expect(sheet.getByText('MCP servers', { exact: true })).toBeVisible()
  }
  const close = () => sheet.getByRole('button', { name: 'Close', exact: true }).click()
  const sent = (...requests: [string, boolean][]) =>
    requests.map(([name, enabled]) => ({ conversation_id: SEEDED_ROW.id, server_name: name, enabled }))

  await open()
  // Every row, the working one included; off exactly where the report said `disabled`.
  await expect(switches).toHaveCount(3)
  await expect(switchOf('docs')).toBeChecked()
  await expect(switchOf('quiet')).not.toBeChecked()
  await expect(switchOf('broken')).toBeChecked()
  await sheet.screenshot({ path: test.info().outputPath('mcp-toggle-switches.png') })

  // No toggle answer is configured, so the flip meets silence: the switch keeps the reported state and every
  // control in the section is disabled.
  await switchOf('docs').click()
  await expect.poll(() => fake.mcpToggleRequests()).toEqual(sent(['docs', false]))
  for (const index of [0, 1, 2]) await expect(switches.nth(index)).toBeDisabled()
  await expect(reconnects).toHaveCount(2)
  for (const index of [0, 1]) await expect(reconnects.nth(index)).toBeDisabled()
  await expect(switchOf('docs')).toBeChecked()

  // Closing ends the wait; the reopen's own status ask meets silence, so no report is what re-enables.
  fake.setMcpStatusAnswer(SEEDED_ROW.id, null)
  await close()
  await open()
  await expect(switchOf('docs')).toBeEnabled()
  for (const index of [0, 1]) await expect(reconnects.nth(index)).toBeEnabled()

  // An accepted toggle answers with a fresh report, and the switch reads what came back.
  fake.setMcpToggleAnswer(SEEDED_ROW.id, report(server('docs', 'disabled'), server('quiet', 'disabled'), server('broken', 'failed')))
  await switchOf('docs').click()
  await expect(switchOf('docs')).not.toBeChecked()
  await expect(sheet.getByText('disabled', { exact: true })).toHaveCount(2)
  await expect(switchOf('docs')).toBeEnabled()

  // A refusal re-enables the controls, keeps every switch as reported and shows the notice.
  fake.setMcpToggleAnswer(SEEDED_ROW.id, 'refused')
  await switchOf('quiet').click()
  await expect(notice).toBeVisible()
  await expect(switchOf('quiet')).not.toBeChecked()
  await expect(switchOf('docs')).not.toBeChecked()
  await expect(switchOf('broken')).toBeChecked()
  await expect(switchOf('quiet')).toBeEnabled()
  for (const index of [0, 1]) await expect(reconnects.nth(index)).toBeEnabled()
  expect(fake.mcpToggleRequests()).toEqual(sent(['docs', false], ['docs', false], ['quiet', true]))
  await sheet.screenshot({ path: test.info().outputPath('mcp-toggle-refused.png') })

  // The notice stays until the next report for the conversation, here an unsolicited one.
  daemon.pushFrame(frame(report(server('docs', 'connected'), server('quiet', 'connected'), server('broken', 'failed'))))
  await expect(notice).toHaveCount(0)
  await expect(switchOf('quiet')).toBeChecked()
  await expect(switchOf('docs')).toBeChecked()
})
