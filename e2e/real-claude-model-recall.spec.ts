import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
import { daemonIdentity } from './fixtures/daemonVersion'
import type { DaemonEvent } from '../src/shared/ipc/events'

test.use({ seedPromoted: false })
type ProofEvent = Extract<DaemonEvent, { type: 'runConfigReceived' | 'modelList' | 'modelAnnounced' | 'sessionSettingsUpdated' }>

async function observe(page: Page) {
  const events: ProofEvent[] = []
  await page.exposeFunction('recordModelRecallProof', (event: ProofEvent) => { events.push(event) })
  await page.evaluate(() => {
    const target = window as unknown as { pyry: { onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void },
      recordModelRecallProof: (event: ProofEvent) => Promise<void> }
    target.pyry.onDaemonEvent(event => {
      if (event.type === 'runConfigReceived' || event.type === 'modelList' ||
          event.type === 'modelAnnounced' || event.type === 'sessionSettingsUpdated') {
        void target.recordModelRecallProof(event)
      }
    })
  })
  return events
}

async function sendTurn(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled({ timeout: 15000 })
  await page.getByPlaceholder('Message…').fill('Reply with one short word.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => page.locator('[data-thread-role="assistant"]').count(), { timeout: 120000 }).toBeGreaterThan(0)
  await expect(page.locator('.bubble__cursor')).toHaveCount(0, { timeout: 120000 })
}

test('confirmed model survives profile restart and governs the new chat first announcement', async ({ relay, daemon }, testInfo) => {
  test.setTimeout(360000)
  const { stdout } = await promisify(execFile)(process.env.PYRY_BIN || 'pyry', ['version'], { timeout: 10000 })
  await testInfo.attach('daemon-revision', { body: Buffer.from(daemonIdentity(stdout)), contentType: 'text/plain' })
  await withIsolatedElectronApp(async ({ page: firstPage, relaunch }) => {
    let page = firstPage
    let events = await observe(page)
    await pairFromUnpairedLaunch(page, encodePairingPayload({ server: daemon.pairFields.server,
      relay: `${relay.url}/v1/client`, token: daemon.pairFields.token,
      server_static_pubkey: daemon.pairFields.server_static_pubkey }))
    await expect(page.locator('.channel-list__row-open')).toBeVisible({ timeout: 45000 })
    await page.locator('.channel-list__row-open').click()
    await sendTurn(page)
    const inherited = events.find(e => e.type === 'modelAnnounced')
    expect(inherited?.type).toBe('modelAnnounced')
    if (inherited?.type !== 'modelAnnounced') throw Error('Missing inherited announcement')
    // Pick in another chat: changing the daemon bootstrap session can seed future sessions itself.
    const beforeCreate = events.length
    await confirmCreateChat(page)
    await expect.poll(() => events.slice(beforeCreate).some(e => e.type === 'modelList')).toBe(true)
    const list = events.slice(beforeCreate).find(e => e.type === 'modelList')
    if (list?.type !== 'modelList') throw Error('Missing published list')
    const rows = list.models.filter(row => (row.agent ?? 'claude') === 'claude' && row.value !== 'default')
    const index = rows.findIndex(row => row.value !== '' && row.resolved_model !== '' &&
      row.resolved_model !== inherited.model && row.value !== inherited.model &&
      !row.truncated_fields?.includes('value') && !row.truncated_fields?.includes('resolved_model'))
    expect(index, 'requires a published model different from the inherited default').toBeGreaterThanOrEqual(0)
    const picked = rows[index]
    await expect(page.locator('.composer__model')).toBeEnabled()
    await page.locator('.composer__model').click()
    const menu = page.getByRole('menu', { name: 'Model', exact: true })
    await expect(menu.getByRole('menuitem')).toHaveCount(rows.length)
    const beforePick = events.length
    await menu.getByRole('menuitem').nth(index).click()
    await expect.poll(() => events.slice(beforePick).some(e => e.type === 'sessionSettingsUpdated')).toBe(true)
    expect(await page.evaluate(() => localStorage.getItem('pyry.lastModel'))).toBe(picked.value)

    page = (await relaunch()).page
    events = await observe(page)
    expect(await page.evaluate(() => localStorage.getItem('pyry.lastModel'))).toBe(picked.value)
    await expect(page.getByRole('button', { name: 'Create chat', exact: true })).toBeVisible({ timeout: 45000 })
    await confirmCreateChat(page)
    await expect.poll(() => events.some(e => e.type === 'runConfigReceived')).toBe(true)
    const opening = events.find(e => e.type === 'runConfigReceived')
    if (opening?.type !== 'runConfigReceived') throw Error('Missing new chat settings')
    expect(opening.model, 'new chat must start with inherited settings before recall').not.toBe(picked.value)
    await expect.poll(() => events.some(e => e.type === 'sessionSettingsUpdated' &&
      e.sessionId === opening.sessionId), { timeout: 15000 }).toBe(true)
    await sendTurn(page)
    await expect.poll(() => events.some(e => e.type === 'modelAnnounced' &&
      e.conversationId === opening.conversationId), { timeout: 120000 }).toBe(true)
    const first = events.find(e => e.type === 'modelAnnounced' && e.conversationId === opening.conversationId)
    expect(first?.type === 'modelAnnounced' ? first.model : null).toBe(picked.resolved_model)
    await testInfo.attach('first-model-recall', { body: Buffer.from(JSON.stringify({ picked, inherited: inherited.model,
      opening, firstAnnouncement: first })), contentType: 'application/json' })
  })
})
