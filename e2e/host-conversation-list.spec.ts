import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope } from '../src/main/transport/codec'

test('addressed lists load both hosts and refresh a chat while another host is offline', async ({
  launchPairedApp
}, testInfo) => {
  const firstFake = conversationStateFake({ conversations: [SEEDED_ROW] })
  const secondFake = conversationStateFake({ conversations: [SECOND_SEEDED_ROW] })
  const counts = [0, 0]
  const creates = [0, 0]
  const reply = (index: number, fake: typeof firstFake) => (bytes: Uint8Array) => {
    const request = decodeEnvelope(bytes)
    if (request.type === 'list_conversations') counts[index]++
    if (request.type === 'create_conversation') creates[index]++
    return fake(bytes)
  }
  const { page, servers } = await launchPairedApp(
    { buildReplyFrames: reply(0, firstFake) },
    { hostLabel: 'Connected host', secondServer: { buildReplyFrames: reply(1, secondFake) } }
  )
  // Each row came from its transport's list reply. With two saved hosts the router
  // refuses an unaddressed request, so the second reply also proves addressing.
  expect(counts).toEqual([1, 1])
  await expect(page.locator('.channel-list__row-open')).toHaveText([
    'Seeded discussion', 'Server two chat'
  ])
  const hosts = page.locator('.channel-list__host')
  await expect(hosts).toHaveCount(2)
  servers[1].forwarder.closeClientLeg(4401)
  const offlineDot = hosts.nth(1).locator('.channel-list__host-dot').first()
  await expect(offlineDot).toHaveAttribute('aria-label', 'Pyrycode Offline')
  await expect(hosts.nth(0).locator('.channel-list__host-dot').first())
    .toHaveAttribute('aria-label', 'Pyrycode Connected')

  await expect(page.getByRole('button', { name: 'Create chat', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Create chat', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create chat', exact: true })
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('Untitled')
  await expect(page.locator('.channel-list__row-open')).toHaveText([
    'Seeded discussion', 'Untitled', 'Server two chat'
  ])
  expect(creates).toEqual([1, 0])
  expect(counts).toEqual([2, 1])
  await page.getByPlaceholder('Message…').fill('A valid draft')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await expect(page.locator('.conversation__banner')).toHaveCount(0)
  await expect(page.locator('.composer-status__error')).toHaveCount(0)
  await expect(offlineDot).toHaveAttribute('aria-label', 'Pyrycode Offline')
  await page.screenshot({ path: testInfo.outputPath('host-conversation-list.png'), animations: 'disabled' })
})
