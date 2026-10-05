import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { daemonIdentity } from './fixtures/daemonVersion'
import { createQueueTurnEvidence } from './fixtures/queueTurnEvidence'

// #1726, real pyry + real claude: Send now delivers a queued message INTO the running turn. Turn 1 is
// held open by an ordinary foreground Bash tool blocked on a test-owned gate file (the
// real-claude-queue-drop / real-claude-queue-delivery idiom), a second message asking for a marker word
// is queued behind it, and Send now is clicked while the hold stands. Then the gate is released.
//
// Proof, from the daemon events the renderer receives (queueTurnEvidence) and the DOM:
//   - the marker appears in the HELD turn's assistant text — the only turn there is;
//   - exactly one turn ever completes, so Claude ran no separate later turn for the message;
//   - the queued row lost its queued treatment and the message is one delivered row.
//
// Needs a PYRY_BIN built from a pyrycode revision containing pyrycode#2729 (`send_queued_now`) and
// #2730 (`mid_turn_input`); against an older daemon the Send now control never draws, and the spec fails
// at that visibility check rather than passing vacuously. Model output is matched only for the marker,
// a per-run nonce this spec wrote; nothing secret is asserted or attached.
test.use({ interactiveRunner: 'stream-json' })
const TURN_TIMEOUT = 120_000
type Evidence = ReturnType<typeof createQueueTurnEvidence>
type EvidenceWindow = typeof window & { queueTurnEvidence: Pick<Evidence, 'snapshot'> & { stop: () => void } }
const readEvidence = (page: Page) => page.evaluate(() =>
  (window as EvidenceWindow).queueTurnEvidence.snapshot([0]))

test('real claude reads a Send now message inside the running turn', async ({ relay, daemon }, testInfo) => {
  test.setTimeout(360_000)
  const { stdout } = await promisify(execFile)(process.env.PYRY_BIN || 'pyry', ['version'], { timeout: 10_000 })
  const revision = daemonIdentity(stdout)
  testInfo.annotations.push({ type: 'daemon-revision', description: revision })

  await withIsolatedElectronApp(async ({ page }) => {
    const nonce = Date.now()
    const marker = `SENDNOW_${nonce}_MARK`
    const gate = join(daemon.workdir, `send-now-release-${nonce}`)
    const entered = join(daemon.workdir, `send-now-entered-${nonce}`)
    const first = 'Use Bash to run this exact command in the foreground, never in the background: ' +
      `\`touch "${entered}"; until [ -f "${gate}" ]; do sleep 0.2; done\`. ` +
      'After the command finishes, reply briefly. Do not write the release file yourself.'
    const second = `Include the word ${marker} in your final reply. Do not use tools for this.`
    const composer = page.getByPlaceholder('Message…')
    const stop = page.getByRole('button', { name: 'Stop the running turn', exact: true })
    const queuedRow = page.locator('.message-row--queued', { hasText: second })
    const rowsFor = page.locator('[data-thread-role="user"], [data-thread-role="queued"]', { hasText: second })
    let released = false

    await page.evaluate(createQueueTurnEvidence, { conversationId: '', markers: [marker], subscribe: true })
    try {
      await pairFromUnpairedLaunch(page, encodePairingPayload({ ...daemon.pairFields, relay: `${relay.url}/v1/client` }))
      await expect(page.locator('.channel-list__row-open')).toBeVisible({ timeout: 45_000 })
      await confirmCreateChat(page)
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled({ timeout: 45_000 })
      await expect.poll(async () => (await readEvidence(page)).conversationId.length).toBeGreaterThan(0)

      await composer.fill(first)
      await composer.press('Enter')
      await expect.poll(() => existsSync(entered), { timeout: TURN_TIMEOUT }).toBe(true)
      await expect(stop).toBeVisible()

      await composer.fill(second)
      await composer.press('Enter')
      await expect(queuedRow).toHaveCount(1, { timeout: TURN_TIMEOUT })
      const sendNow = queuedRow.getByRole('button', { name: 'Send queued message now' })
      await expect(sendNow).toBeEnabled()
      expect(existsSync(gate)).toBe(false)
      await sendNow.click()

      // The daemon takes the message off the backlog for the running turn; the hold still stands.
      await expect.poll(async () => (await readEvidence(page)).queuedMessageIds, { timeout: TURN_TIMEOUT }).toEqual([])
      await expect(queuedRow).toHaveCount(0, { timeout: TURN_TIMEOUT })
      await expect(rowsFor).toHaveCount(1)
      await expect(stop).toBeVisible()
      expect((await readEvidence(page)).turns.every((turn) => turn.completions === 0)).toBe(true)

      await writeFile(gate, 'release\n', { mode: 0o600 })
      released = true
      await expect(stop).toHaveCount(0, { timeout: TURN_TIMEOUT })
      await expect(page.locator('.bubble__cursor')).toHaveCount(0)

      // One turn — the held one — completed normally and carries the marker; none follows it.
      await page.waitForTimeout(3_000)
      const evidence = await readEvidence(page)
      expect(evidence.turns).toHaveLength(1)
      expect(evidence.turns[0]).toMatchObject({ completions: 1, normal: true, markers: [0] })
      await expect(stop).toHaveCount(0)
      await expect(queuedRow).toHaveCount(0)
      await expect(page.locator('[data-thread-role="user"]', { hasText: second })).toHaveCount(1)
      await expect(rowsFor).toHaveCount(1)
    } finally {
      const evidence = await readEvidence(page)
      await testInfo.attach('send-now-evidence', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
        daemonRevision: revision, released, turns: evidence.turns, queueSnapshots: evidence.queueSnapshots,
        remainingQueueCount: evidence.queuedMessageIds.length
      })) })
      await page.evaluate(() => (window as EvidenceWindow).queueTurnEvidence.stop())
    }
  })
})
