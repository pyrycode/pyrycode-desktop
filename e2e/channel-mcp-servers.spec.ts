import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { MCPServerStatus, MCPStatusPayload } from '../src/shared/wire/types'

const second = { ...SEEDED_ROW, id: 'mcp-second', name: 'Second MCP chat' }
const frame = (type: string, payload: unknown) =>
  encodeEnvelope({ id: 1, type, ts: '2026-09-23T12:00:00Z', payload })
const server = (name: string, status: string, error = ''): MCPServerStatus =>
  ({ name, status, error, scope: 'user', version: '1' })

test('MCP servers retains closed-sheet reports, toggles built-ins and isolates conversations', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] })
  })
  const pushStatus = (payload: MCPStatusPayload) => daemon.pushFrame(frame('mcp_status', payload))
  pushStatus({
    conversation_id: SEEDED_ROW.id,
    servers: [
      server('pyry_approve', 'connected'), server('docs-alpha', 'connected'),
      server('broken-alpha', 'failed', 'spawn failed\nexit 1'), server('pyry_files', 'connected')
    ],
    dropped_servers: 2
  })
  pushStatus({ conversation_id: second.id, servers: [], dropped_servers: 0 })
  // The later list frame is an observable delivery barrier while the sheet is closed.
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, second] }))
  await expect(page.locator('.channel-list__row-open').filter({ hasText: second.name })).toBeVisible()
  const open = async () => {
    await page.locator('.conversation__overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Channel info' }).click()
  }
  await open()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('MCP servers', { exact: true })).toBeVisible()
  await expect(sheet.getByText('docs-alpha', { exact: true })).toBeVisible()
  await expect(sheet.getByText('broken-alpha', { exact: true })).toBeVisible()
  await expect(sheet.locator('.channel-info__mcp-error')).toHaveText('spawn failed\nexit 1')
  await expect(sheet.getByText(/Partial list: 2 more servers/)).toBeVisible()
  await expect(sheet.getByText('pyry_approve', { exact: true })).toHaveCount(0)

  const toggle = sheet.getByRole('checkbox', { name: 'Show built-in' })
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  await expect(sheet.getByText('pyry_approve', { exact: true })).toBeVisible()
  await expect(sheet.getByText('pyry_files', { exact: true })).toBeVisible()
  await expect(sheet.locator('.mcp-server-dot')).toHaveCount(4)
  await sheet.screenshot({ path: test.info().outputPath('mcp-servers.png') })
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()

  await page.locator('.channel-list__row-open').filter({ hasText: second.name }).click()
  await open()
  await expect(sheet.getByText('Claude reported no MCP servers.', { exact: true })).toBeVisible()
  await expect(sheet.getByText('docs-alpha', { exact: true })).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()

  await page.locator('.channel-list__row-open').filter({ hasText: SEEDED_ROW.name ?? '' }).click()
  await open()
  await expect(sheet.getByText('docs-alpha', { exact: true })).toBeVisible()
  await expect(sheet.getByRole('checkbox', { name: 'Show built-in' })).not.toBeChecked()
  await expect(sheet.getByText('pyry_approve', { exact: true })).toHaveCount(0)
})
