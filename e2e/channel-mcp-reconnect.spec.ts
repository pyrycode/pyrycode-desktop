import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { MCPServerStatus, MCPStatusPayload } from '../src/shared/wire/types'

// #1583: a server row that is not `connected` offers Reconnect. A press sends one `mcp_reconnect`, and
// every control in the section stays disabled until the next report, a refusal, or the sheet closing. The
// answer re-renders the rows even when they read `pending`. A refusal re-enables the controls and keeps
// the rows, and a client-owned notice shows until the next report.

const REFUSED = 'The daemon refused to reconnect the MCP server.'
const server = (name: string, status: string): MCPServerStatus => ({ name, status, error: '', scope: 'user', version: '1' })
const report = (...servers: MCPServerStatus[]): MCPStatusPayload =>
  ({ conversation_id: SEEDED_ROW.id, servers, dropped_servers: 0 })
const frame = (payload: MCPStatusPayload) =>
  encodeEnvelope({ id: 1, type: 'mcp_status', ts: '2026-09-23T12:00:00Z', payload })

test('Reconnect sends once, waits, re-renders from the answer and shows a refusal as a notice', async ({ launchPairedApp }) => {
  const fake = conversationStateFake({
    conversations: [SEEDED_ROW],
    mcpStatusAnswers: { [SEEDED_ROW.id]: report(server('docs', 'connected'), server('broken', 'failed'), server('slow', 'pending')) }
  })
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake })
  const sheet = page.getByRole('dialog')
  const reconnects = sheet.getByRole('button', { name: 'Reconnect', exact: true })
  const rowOf = (name: string) =>
    sheet.locator('.channel-info__mcp-server').filter({ has: page.getByText(name, { exact: true }) })
  const notice = sheet.getByText(REFUSED, { exact: true })
  const open = async () => {
    await page.locator('.conversation__overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Channel info' }).click()
    await expect(sheet.getByText('MCP servers', { exact: true })).toBeVisible()
  }
  const close = () => sheet.getByRole('button', { name: 'Close', exact: true }).click()
  const sent = (...names: string[]) => names.map((name) => ({ conversation_id: SEEDED_ROW.id, server_name: name }))

  await open()
  await expect(rowOf('broken').getByText('failed', { exact: true })).toBeVisible()
  // The tone's split: the connected row offers nothing, the two others one control each.
  await expect(rowOf('docs').getByRole('button')).toHaveCount(0)
  await expect(reconnects).toHaveCount(2)
  await expect(reconnects.nth(0)).toBeEnabled()

  // No reconnect answer is configured, so the press meets silence and the wait holds.
  await rowOf('broken').getByRole('button', { name: 'Reconnect' }).click()
  await expect.poll(() => fake.mcpReconnectRequests()).toEqual(sent('broken'))
  await expect(reconnects.nth(0)).toBeDisabled()
  await expect(reconnects.nth(1)).toBeDisabled()

  // Closing ends the wait. The reopen's own status ask meets silence too, so no report is what re-enables.
  fake.setMcpStatusAnswer(SEEDED_ROW.id, null)
  await close()
  await open()
  await expect(reconnects).toHaveCount(2)
  await expect(reconnects.nth(0)).toBeEnabled()
  await expect(reconnects.nth(1)).toBeEnabled()

  // An accepted reconnect answers with a fresh report; the row shows what came back, `pending` included.
  fake.setMcpReconnectAnswer(SEEDED_ROW.id, report(server('docs', 'connected'), server('broken', 'pending'), server('slow', 'pending')))
  await rowOf('broken').getByRole('button', { name: 'Reconnect' }).click()
  await expect(rowOf('broken').getByText('pending', { exact: true })).toBeVisible()
  await expect(rowOf('broken').getByText('failed', { exact: true })).toHaveCount(0)
  await expect(reconnects.nth(0)).toBeEnabled()
  expect(fake.mcpReconnectRequests()).toEqual(sent('broken', 'broken'))

  // A refusal re-enables the controls, keeps the held rows and shows the client-owned notice.
  fake.setMcpReconnectAnswer(SEEDED_ROW.id, 'refused')
  await rowOf('slow').getByRole('button', { name: 'Reconnect' }).click()
  await expect(notice).toBeVisible()
  await expect(reconnects.nth(0)).toBeEnabled()
  await expect(reconnects.nth(1)).toBeEnabled()
  await expect(rowOf('broken').getByText('pending', { exact: true })).toBeVisible()
  await expect(rowOf('docs')).toBeVisible()
  expect(fake.mcpReconnectRequests()).toEqual(sent('broken', 'broken', 'slow'))
  await sheet.screenshot({ path: test.info().outputPath('mcp-reconnect-refused.png') })

  // The notice stays until the next report for the conversation, here an unsolicited one.
  daemon.pushFrame(frame(report(server('docs', 'connected'), server('broken', 'connected'), server('slow', 'failed'))))
  await expect(notice).toHaveCount(0)
  await expect(rowOf('broken').getByRole('button')).toHaveCount(0)
  await expect(reconnects).toHaveCount(1)
})
