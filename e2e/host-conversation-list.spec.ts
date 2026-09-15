import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope } from '../src/main/transport/codec'

test('addressed lists load both hosts and refresh a created workspace while another host is offline', async ({
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
  await expect(hosts).toHaveCount(4)
  servers[1].forwarder.closeClientLeg(4401)
  const offlineDot = hosts.nth(3).locator('.channel-list__host-dot').first()
  await expect(offlineDot).toHaveAttribute('aria-label', 'Pyrycode Offline')
  await expect(hosts.nth(2).locator('.channel-list__host-dot').first())
    .toHaveAttribute('aria-label', 'Pyrycode Connected')

  await hosts.nth(2).hover()
  await hosts.nth(2).getByRole('button', { name: 'Add workspace' }).click()
  await page.getByRole('textbox', { name: 'Workspace folder on the host (relative or absolute path):' }).fill('/fake/new-workspace')
  await page.getByRole('dialog', { name: 'Add workspace' }).getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add workspace' })).toHaveCount(0)
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('Untitled')
  // TWO since #1485 — the dialog starts a CHAT, and the Channels tree now draws the new folder too.
  // That is this ticket's first acceptance criterion, read from the spec that already drove the dialog.
  await expect(page.locator('.channel-list__workspace-label').filter({ hasText: 'new-workspace' }))
    .toHaveCount(2)
  expect(creates).toEqual([1, 0])
  expect(counts).toEqual([2, 1])
  // The flat sidebar sequence places the new workspace beneath its owning host.
  // `.first()` since #1485 put the same label in both trees. Either would answer the question this asks —
  // both are drawn under the SAME machine, which is the per-host union's whole point — so the first is
  // taken rather than the trees being told apart for a claim that holds in each.
  const newWorkspace = page.locator('.channel-list__workspace-label').filter({ hasText: 'new-workspace' }).first()
  const containingHost = newWorkspace.locator('xpath=ancestor::div[@class="channel-list__workspace-head"]/preceding-sibling::div[contains(concat(" ", @class, " "), " channel-list__host ")][1]')
  await expect(containingHost.locator('.channel-list__host-label')).toHaveText('Connected host')
  await page.getByPlaceholder('Message…').fill('A valid draft')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await expect(page.locator('.conversation__banner')).toHaveCount(0)
  await expect(page.locator('.composer-status__error')).toHaveCount(0)
  await expect(offlineDot).toHaveAttribute('aria-label', 'Pyrycode Offline')
  await page.screenshot({ path: testInfo.outputPath('host-conversation-list.png'), animations: 'disabled' })
})
