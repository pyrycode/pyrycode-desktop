import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { MCPServerStatus, MCPStatusPayload } from '../src/shared/wire/types'

// #1579: every Channel info open asks the daemon for fresh MCP status, the section re-renders from the
// answer, an unavailable refusal appends a client-owned notice without touching held rows, and an
// unclassified refusal changes nothing.
//
// "EXACTLY ONE PER OPEN" is read from the fake's recorded requests with `toEqual` on the whole list after
// each open's answer has rendered. One IPC channel and one socket carry every request in order, so a
// duplicate from an earlier open would already be recorded by the time a later open's answer shows.

const second = { ...SEEDED_ROW, id: 'mcp-request-second', name: 'Second MCP chat' }
const UNAVAILABLE = 'The daemon could not report MCP status right now.'
const frame = (type: string, payload: unknown) =>
  encodeEnvelope({ id: 1, type, ts: '2026-09-23T12:00:00Z', payload })
const server = (name: string): MCPServerStatus => ({ name, status: 'connected', error: '', scope: 'user', version: '1' })
const report = (conversationId: string, ...names: string[]): MCPStatusPayload =>
  ({ conversation_id: conversationId, servers: names.map(server), dropped_servers: 0 })

test('Channel info asks for MCP status on every open and shows an unavailable refusal as a notice', async ({ launchPairedApp }) => {
  const fake = conversationStateFake({
    conversations: [SEEDED_ROW],
    mcpStatusAnswers: { [SEEDED_ROW.id]: report(SEEDED_ROW.id, 'docs-alpha') }
  })
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake })
  const sheet = page.getByRole('dialog')
  const notice = sheet.getByText(UNAVAILABLE, { exact: true })
  const asked: string[] = []
  const open = async (conversationId: string) => {
    await page.locator('.conversation__overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Channel info' }).click()
    await expect(sheet.getByText('MCP servers', { exact: true })).toBeVisible()
    asked.push(conversationId)
  }
  const close = () => sheet.getByRole('button', { name: 'Close', exact: true }).click()
  const openRow = (name: string) => page.locator('.channel-list__row-open').filter({ hasText: name }).click()

  // launchPairedApp needs exactly one row to click, so the second arrives by a pushed list frame.
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, second] }))
  // Nothing is asked before the sheet opens: activation is not the trigger.
  await expect(page.locator('.channel-list__row-open').filter({ hasText: second.name })).toBeVisible()
  expect(fake.mcpStatusRequests()).toEqual([])

  await open(SEEDED_ROW.id)
  await expect(sheet.getByText('docs-alpha', { exact: true })).toBeVisible()
  expect(fake.mcpStatusRequests()).toEqual(asked)
  await close()

  // A reopen asks again, and the answer replaces the rows.
  fake.setMcpStatusAnswer(SEEDED_ROW.id, report(SEEDED_ROW.id, 'docs-beta'))
  await open(SEEDED_ROW.id)
  await expect(sheet.getByText('docs-beta', { exact: true })).toBeVisible()
  await expect(sheet.getByText('docs-alpha', { exact: true })).toHaveCount(0)
  expect(fake.mcpStatusRequests()).toEqual(asked)
  await close()

  // An unclassified refusal changes nothing. The pushed list frame is sent after the refusal on the same
  // socket, so once the renamed row shows, the refusal has been handled.
  fake.setMcpStatusAnswer(SEEDED_ROW.id, 'unclassified')
  await open(SEEDED_ROW.id)
  await expect.poll(() => fake.mcpStatusRequests()).toEqual(asked)
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, { ...second, name: 'Barrier chat' }] }))
  await expect(page.locator('.channel-list__row-open').filter({ hasText: 'Barrier chat' })).toBeVisible()
  await expect(sheet.getByText('docs-beta', { exact: true })).toBeVisible()
  await expect(notice).toHaveCount(0)
  await close()

  // An unavailable refusal appends the notice and leaves the rows on screen.
  fake.setMcpStatusAnswer(SEEDED_ROW.id, 'unavailable')
  await open(SEEDED_ROW.id)
  await expect(notice).toBeVisible()
  await expect(sheet.getByText('docs-beta', { exact: true })).toBeVisible()
  await sheet.screenshot({ path: test.info().outputPath('mcp-status-unavailable.png') })
  expect(fake.mcpStatusRequests()).toEqual(asked)
  await close()

  // That refusal named the seed, so the other conversation's section shows no notice. It has no answer
  // configured, so its request meets silence and nothing can arrive to add one.
  await openRow('Barrier chat')
  await open(second.id)
  await expect.poll(() => fake.mcpStatusRequests()).toEqual(asked)
  await expect(sheet.getByText('No MCP report has arrived yet.', { exact: true })).toBeVisible()
  await expect(notice).toHaveCount(0)
  await close()

  // A later report for the seed replaces the notice, here an unsolicited one while the sheet is open.
  await openRow(SEEDED_ROW.name ?? '')
  await open(SEEDED_ROW.id)
  await expect(notice).toBeVisible()
  daemon.pushFrame(frame('mcp_status', report(SEEDED_ROW.id, 'docs-gamma')))
  await expect(sheet.getByText('docs-gamma', { exact: true })).toBeVisible()
  await expect(notice).toHaveCount(0)
  await expect(sheet.getByText('docs-beta', { exact: true })).toHaveCount(0)
  expect(fake.mcpStatusRequests()).toEqual(asked)
})
