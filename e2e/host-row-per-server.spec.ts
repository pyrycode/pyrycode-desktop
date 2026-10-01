import { test, expect } from './fixtures/launchPairedApp'
import { COMPOSER_REPAIR_BUTTON_COPY } from '../src/renderer/src/screens/conversation/composerSend'

const HOST_LABEL = 'Pyrybox'
const FALLBACK_LABEL_LENGTH = 6
const FIRST_ROW_NAME = 'Seeded discussion'
const FATAL_CLOSE_CODE = 4401

test('host B connection loss leaves host A healthy and its composer usable', async ({ launchPairedApp }) => {
  const { page, servers } = await launchPairedApp({}, { hostLabel: HOST_LABEL, secondServer: {} })
  const [, serverB] = servers
  await page.locator('.channel-list__row-open').filter({ hasText: FIRST_ROW_NAME }).click()
  await expect(page.locator('.conversation')).toBeVisible()
  const hosts = page.locator('.channel-list__host')
  await expect(hosts).toHaveCount(2)
  const hostA = hosts.nth(0)
  const hostB = hosts.nth(1)
  const contentA = page.locator('.channel-list__host-content').nth(0)
  const contentB = page.locator('.channel-list__host-content').nth(1)
  const disclosureA = hostA.locator('.channel-list__host-disclosure')
  const labelLengthA = () => hostA.locator('.channel-list__host-label').evaluate(el => (el.textContent ?? '').length)
  await expect.poll(labelLengthA).toBe(HOST_LABEL.length)
  // Establish healthy behavior on both machines before inducing B's terminal loss.
  await expect(disclosureA).toHaveAttribute('aria-expanded', 'true')
  await expect(hostB.locator('.channel-list__host-disclosure')).toHaveCount(1)
  await expect(contentA.getByRole('button', { name: 'Create chat', exact: true })).toHaveCount(1)
  await expect(contentB.getByRole('button', { name: 'Create chat', exact: true })).toHaveCount(1)
  await expect(hostB.getByRole('button', { name: 'Repair host' })).toHaveCount(0)
  serverB.forwarder.closeClientLeg(FATAL_CLOSE_CODE)

  // Positive observation of B's settled failure comes before assertions about A staying healthy.
  await expect(hostB).toHaveClass(/channel-list__host--failed/)
  await expect(hostB.getByRole('button', { name: 'Repair host' })).toBeVisible()
  await expect(hostB.locator('.channel-list__host-disclosure')).toHaveCount(0)
  await expect(contentB.getByRole('button', { name: 'Create chat', exact: true })).toHaveCount(0)
  await expect.poll(labelLengthA).toBe(HOST_LABEL.length)
  await expect(hostA).not.toHaveClass(/channel-list__host--failed/)
  await expect(hostA.getByRole('button', { name: 'Repair host' })).toHaveCount(0)
  await expect(contentA.getByRole('button', { name: 'Create chat', exact: true })).toHaveCount(1)
  await disclosureA.click()
  await expect(disclosureA).toHaveAttribute('aria-expanded', 'false')
  await disclosureA.click()
  await expect(disclosureA).toHaveAttribute('aria-expanded', 'true')
  const input = page.getByPlaceholder('Message…')
  await expect(input).toBeEditable()
  await input.fill('Draft for the connected host')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY, exact: true })).toHaveCount(0)
  await expect(page.locator('.composer-status__error')).toHaveCount(0)
  await expect(page.locator('.conversation__banner')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Repair pairing', exact: true })).toHaveCount(0)
})

test('each host row shows the label stored for the machine IT names', async ({ launchPairedApp }) => {
  const { page } = await launchPairedApp({}, { hostLabel: HOST_LABEL, secondServer: {} })

  await page.locator('.channel-list__row-open').filter({ hasText: FIRST_ROW_NAME }).click()
  await expect(page.locator('.conversation')).toBeVisible()

  // Read as LENGTHS, never as values — the fallback word is six characters and the typed name is seven,
  // so the whole comparison lands without printing either, which is the treatment the host-name field
  // gets throughout (it sits directly below the pairing-code field, and a mis-pasted payload into it is
  // an anticipated mistake).
  //
  // The ARRAY FORM pins the count at two, each row's answer, and saved host order. A row
  // reading the app-wide "most recently stored" answer would show the fallback everywhere (server 2
  // paired second and stored nothing), and a tree that named every row after the first machine would show
  // the typed length everywhere; both fail here, in opposite directions.
  await expect
    .poll(async () =>
      page
        .locator('.channel-list__host-label')
        .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').trim().length))
    )
    .toEqual([HOST_LABEL.length, FALLBACK_LABEL_LENGTH])
})
