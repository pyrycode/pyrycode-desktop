import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { MCPServerStatus, MCPStatusPayload } from '../src/shared/wire/types'

// #1494: a failed MCP server raises the status row's trailing slot while the sheet is closed. Pressing the
// notice opens Channel info exactly as the overflow item does (one status request), acknowledges every
// failure the report shows, and a repeated report does not raise it again; a new failure does.
//
// Every server name is a client-owned synthetic literal, so a failure diff discloses nothing.

const frame = (type: string, payload: unknown, in_reply_to?: number) =>
  encodeEnvelope({ id: 1494, type, ts: '2026-09-23T12:00:00Z', payload, in_reply_to })
const server = (name: string, status: string): MCPServerStatus =>
  ({ name, status, error: status === 'failed' ? 'spawn failed' : '', scope: 'user', version: '1' })
const report = (...servers: MCPServerStatus[]): MCPStatusPayload =>
  ({ conversation_id: SEEDED_ROW.id, servers, dropped_servers: 0 })

test('a failed MCP server raises the status row once and opens Channel info', async ({ launchPairedApp }) => {
  const first = report(server('docs-alpha', 'connected'), server('broken-alpha', 'failed'), server('broken-beta', 'failed'))
  const fake = conversationStateFake({ conversations: [SEEDED_ROW], mcpStatusAnswers: { [SEEDED_ROW.id]: first } })
  // An unanswered history request would put a failure in the slot, which outranks this notice.
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: (bytes) => {
      const env = decodeEnvelope(bytes)
      if (env.type === 'request_history') {
        return [frame('history_page', { entries: [], cursor: '', at_start: true }, env.id)]
      }
      return fake(bytes)
    }
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  const pushStatus = (payload: MCPStatusPayload) => daemon.pushFrame(frame('mcp_status', payload))
  const notice = page.locator('.composer-status__mcp-failure')
  const sheet = page.getByRole('dialog')

  // A server that is only pending raises nothing; the first failed one in report order is named.
  pushStatus(report(server('docs-alpha', 'pending')))
  daemon.pushFrame(frame('conversations', { conversations: [{ ...SEEDED_ROW, name: 'Barrier one' }] }))
  await expect(page.locator('.channel-list__row-open').filter({ hasText: 'Barrier one' })).toBeVisible()
  await expect(notice).toHaveCount(0)
  pushStatus(first)
  await expect(notice).toHaveText('MCP server broken-alpha failed')
  await expect(page.getByRole('button', { name: 'MCP server broken-alpha failed' })).toBeVisible()
  await page.locator('.composer-status').screenshot({ path: test.info().outputPath('mcp-failure-row.png') })

  // Pressing opens the sheet with its status refresh and acknowledges both failures.
  await notice.click()
  await expect(sheet.getByText('MCP servers', { exact: true })).toBeVisible()
  await expect(sheet.getByText('broken-beta', { exact: true })).toBeVisible()
  expect(fake.mcpStatusRequests()).toEqual([SEEDED_ROW.id])
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(notice).toHaveCount(0)

  // A repeat of the acknowledged failures stays silent.
  pushStatus(first)
  daemon.pushFrame(frame('conversations', { conversations: [{ ...SEEDED_ROW, name: 'Barrier two' }] }))
  await expect(page.locator('.channel-list__row-open').filter({ hasText: 'Barrier two' })).toBeVisible()
  await expect(notice).toHaveCount(0)

  // A server failing for the first time raises its own notice, and leaves once it recovers.
  pushStatus(report(server('broken-alpha', 'failed'), server('docs-alpha', 'failed')))
  await expect(notice).toHaveText('MCP server docs-alpha failed')
  pushStatus(report(server('broken-alpha', 'failed'), server('docs-alpha', 'connected')))
  await expect(notice).toHaveCount(0)

  // A long name truncates on one line: the row keeps its 32px height and its width at the minimum window.
  await page.setViewportSize({ width: 800, height: 800 })
  const row = page.locator('.composer-status')
  const before = await row.boundingBox()
  pushStatus(report(server('x'.repeat(300), 'failed')))
  await expect(notice).toContainText('MCP server xxx')
  const after = await row.boundingBox()
  const button = await notice.boundingBox()
  expect(after?.height).toBe(32)
  expect(after?.width).toBe(before?.width)
  expect((button?.x ?? 0) + (button?.width ?? Infinity)).toBeLessThanOrEqual((after?.x ?? 0) + (after?.width ?? 0))
  await row.screenshot({ path: test.info().outputPath('mcp-failure-long-name.png') })
})
