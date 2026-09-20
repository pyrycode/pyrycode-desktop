import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { type Page } from '@playwright/test'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import type { DaemonEvent } from '../src/shared/ipc/events'

// The bootstrap turn populates the daemon's model-list fallback for never-messaged conversations.
// Observe real settings replies and acknowledgements; no store injection or optimistic-label proof.
// The dispatcher owns execution with a daemon containing pyrycode#2517 and its existing credential.
test.use({ seedPromoted: false })
const ROUNDTRIP = 15_000
const TURN = 120_000

type Reading = Pick<Extract<DaemonEvent, { type: 'runConfigReceived' }>,
  'conversationId' | 'effort' | 'effectiveEffort'>

async function observe(page: Page) {
  const readings: Reading[] = []
  let confirmations = 0
  await page.exposeFunction('recordEffortProof', (reading: Reading | null) => {
    if (reading === null) confirmations++
    else readings.push(reading)
  })
  await page.evaluate(() => {
    const target = window as unknown as {
      pyry: { onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void }
      recordEffortProof: (reading: Reading | null) => Promise<void>
    }
    target.pyry.onDaemonEvent(event => {
      if (event.type === 'runConfigReceived') {
        const { conversationId, effort, effectiveEffort } = event
        void target.recordEffortProof({ conversationId, effort, effectiveEffort })
      } else if (event.type === 'sessionSettingsUpdated') {
        void target.recordEffortProof(null)
      }
    })
  })
  return { readings, confirmations: () => confirmations }
}

async function assistantCount(page: Page): Promise<number> {
  return page.locator('[data-thread-role="assistant"]').evaluateAll(els => els.filter(el => {
    const copy = el.cloneNode(true) as HTMLElement
    copy.querySelectorAll('.bubble__meta, .bubble__cursor').forEach(node => node.remove())
    return (copy.textContent ?? '').trim().length > 0
  }).length)
}

async function turn(page: Page, number: number): Promise<void> {
  const before = await assistantCount(page)
  await page.getByPlaceholder('Message…').fill(`Reply with one short word. run=${Date.now()} turn=${number}`)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => assistantCount(page), { timeout: TURN }).toBeGreaterThan(before)
  await expect(page.locator('.bubble__cursor')).toHaveCount(0, { timeout: TURN })
}

async function showFresh(page: Page, proof: Awaited<ReturnType<typeof observe>>, after: number): Promise<Reading> {
  await expect.poll(() => proof.readings.length, { timeout: ROUNDTRIP }).toBeGreaterThan(after)
  const reading = proof.readings[proof.readings.length - 1]
  await expect(page.locator('.composer__effort-label')).toHaveText(reading.effectiveEffort || 'Effort')
  return reading
}

async function refresh(page: Page, proof: Awaited<ReturnType<typeof observe>>): Promise<Reading> {
  const before = proof.readings.length
  await page.locator('.channel-list__row-open[aria-current="true"]').click()
  return showFresh(page, proof, before)
}

test('applied effort, confirmed preference, restart and recall in chats and channels', async ({ relay, daemon }, testInfo) => {
  test.setTimeout(480_000)
  // Read the actual binary's embedded source revision; never claim an unversioned daemon passed.
  const { stdout } = await promisify(execFile)(process.env.PYRY_BIN || 'pyry', ['version'], { timeout: 10_000 })
  const revision = /^pyry (?:dev-)?([a-f0-9]{7,40})\s*$/.exec(stdout)?.[1]
  expect(revision, 'the tested daemon must carry a source revision').toBeTruthy()
  testInfo.annotations.push({ type: 'daemon-revision', description: revision! })
  await testInfo.attach('daemon-revision', { body: Buffer.from(revision!), contentType: 'text/plain' })

  await withIsolatedElectronApp(async ({ page: initialPage, relaunch }) => {
    let page = initialPage
    let proof = await observe(page)
    await pairFromUnpairedLaunch(page, encodePairingPayload({
      server: daemon.pairFields.server, relay: `${relay.url}/v1/client`,
      token: daemon.pairFields.token, server_static_pubkey: daemon.pairFields.server_static_pubkey
    }))
    await expect(page.locator('.channel-list__row-open')).toBeVisible({ timeout: 45_000 })
    await page.locator('.channel-list__row-open').click()
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    await turn(page, 1)
    const inherited = await refresh(page, proof)
    expect(inherited.effort).toBe('')
    expect(inherited.effectiveEffort, 'live daemon must report applied effort after a turn').not.toBeUndefined()
    expect(inherited.effectiveEffort).not.toBe('')
    expect(await page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBeNull()

    // Pool.mintSettings copies the bootstrap's saved effort into new sessions. Keep that seed
    // unset: choosing there would make later chats explicit already, so recall must not run.
    const beforeCreate = proof.readings.length
    await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
    const unset = await showFresh(page, proof, beforeCreate)
    expect(unset.conversationId).not.toBe(inherited.conversationId)
    expect(unset.effort).toBe('')
    const originalName = 'Effort explicit chat'
    await page.locator('.channel-list__row').filter({
      has: page.locator('.channel-list__row-open[aria-current="true"]')
    }).locator('.channel-list__chat-edit').click()
    const edit = page.getByRole('dialog')
    await edit.getByRole('textbox', { name: 'Channel name:', exact: true }).fill(originalName)
    await edit.getByRole('button', { name: 'OK', exact: true }).click()
    await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText(originalName)

    await page.locator('.composer__effort').click()
    const panel = page.getByRole('menu', { name: 'Effort', exact: true })
    const published = await panel.getByRole('menuitem').allTextContents()
    const pickedIndex = published.findIndex(level => level !== inherited.effectiveEffort)
    expect(pickedIndex, 'requires a supported choice different from inherited effort').toBeGreaterThanOrEqual(0)
    const picked = published[pickedIndex]
    const beforePick = proof.readings.length
    const ackBeforePick = proof.confirmations()
    await panel.getByRole('menuitem').nth(pickedIndex).click()
    await expect.poll(proof.confirmations, { timeout: ROUNDTRIP }).toBeGreaterThan(ackBeforePick)
    const selected = await showFresh(page, proof, beforePick)
    expect(selected.effort).toBe(picked)
    expect(await page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBe(picked)
    const originalId = selected.conversationId
    await turn(page, 2)
    const running = await refresh(page, proof)
    expect(running.effectiveEffort).not.toBeUndefined()
    expect(running.effectiveEffort).not.toBe('')

    // The shared lifecycle owns both processes and preserves the isolated profile.
    page = (await relaunch()).page
    proof = await observe(page)
    expect(await page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBe(picked)
    const original = page.getByRole('button', { name: originalName, exact: true })
    await expect(original).toBeVisible({ timeout: 45_000 })
    await original.click()
    const restored = await showFresh(page, proof, 0)
    expect(restored.conversationId).toBe(originalId)
    expect(restored.effort).toBe(picked)
    expect(proof.confirmations()).toBe(0)

    for (const kind of ['chat', 'channel'] as const) {
      const before = proof.readings.length
      const ackBefore = proof.confirmations()
      if (kind === 'chat') {
        await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
      } else {
        await page.getByRole('button', { name: 'Create channel', exact: true }).click({ force: true })
        await page.locator('.create-channel__input').fill('Effort recall channel')
        await page.locator('.create-channel-overlay .modal__action--confirm').click()
      }
      await expect(page.locator('.bubble')).toHaveCount(0)
      await expect.poll(() => proof.readings.length, { timeout: ROUNDTRIP }).toBeGreaterThan(before)
      const opening = proof.readings[before]
      expect(opening.conversationId).not.toBe(originalId)
      expect(opening.conversationId).not.toBe(inherited.conversationId)
      expect(opening.effort, 'recall requires an empty saved choice at opening').toBe('')
      await expect.poll(proof.confirmations, { timeout: ROUNDTRIP }).toBeGreaterThan(ackBefore)
      await expect.poll(() => proof.readings.slice(before).some(r => r.effort === picked), { timeout: ROUNDTRIP }).toBe(true)
      const recalled = await showFresh(page, proof, before)
      expect(recalled.conversationId).not.toBe(originalId)
      expect(recalled.effort).toBe(picked)
      expect(proof.confirmations()).toBe(ackBefore + 1)
      await turn(page, kind === 'chat' ? 3 : 4)
      const applied = await refresh(page, proof)
      expect(applied.effectiveEffort).not.toBeUndefined()
      expect(applied.effectiveEffort).not.toBe('')
      expect(applied.effort).toBe(picked)
      expect(proof.confirmations()).toBe(ackBefore + 1)
      await expect(page.locator('[data-thread-role="user"]')).not.toContainText('/effort')
    }

    // Remember a different choice on the channel, then reopen the original explicit chat.
    await page.locator('.composer__effort').click()
    const reopenedPanel = page.getByRole('menu', { name: 'Effort', exact: true })
    const levels = await reopenedPanel.getByRole('menuitem').allTextContents()
    const otherIndex = levels.findIndex(level => level !== picked)
    expect(otherIndex).toBeGreaterThanOrEqual(0)
    const beforeChange = proof.readings.length
    const ackBeforeChange = proof.confirmations()
    await reopenedPanel.getByRole('menuitem').nth(otherIndex).click()
    await expect.poll(proof.confirmations).toBeGreaterThan(ackBeforeChange)
    await showFresh(page, proof, beforeChange)
    const remembered = levels[otherIndex]
    expect(await page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBe(remembered)
    const beforeReopen = proof.readings.length
    // Reopen the named explicit chat independently of sidebar ordering.
    await page.getByRole('button', { name: originalName, exact: true }).click()
    const explicit = await showFresh(page, proof, beforeReopen)
    expect(explicit.conversationId).toBe(originalId)
    expect(explicit.effort).toBe(picked)
    await refresh(page, proof)
    expect(proof.confirmations()).toBe(ackBeforeChange + 1)
    expect(await page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBe(remembered)
  })
})
