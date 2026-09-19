import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { COMMAND_CHANNEL, type RendererCommand } from '../src/shared/ipc/commands'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { createQueueTurnEvidence } from './fixtures/queueTurnEvidence'

// The dispatcher owns credentialed execution. Keep the old drop-only case alongside these
// positive delivery cases; neither queue disappearance nor bubble counts establish a turn.
test.use({ interactiveRunner: 'stream-json' })
const TURN_TIMEOUT = 120_000
type Evidence = ReturnType<typeof createQueueTurnEvidence>
type EvidenceWindow = typeof window & { queueTurnEvidence: Pick<Evidence, 'snapshot'> & { stop: () => void } }
type Send = { conversationId: string; messageId: string }
type CaptureGlobal = typeof globalThis & { queueSendCapture: { sends: Send[]; stop: () => void } }
const readEvidence = (page: Page, expected: number[]) => page.evaluate(markers =>
  (window as EvidenceWindow).queueTurnEvidence.snapshot(markers), expected)

for (const scenario of [
  { name: 'delivers one queued follow-up exactly once', count: 1, drop: false },
  { name: 'delivers two queued follow-ups in submission order', count: 2, drop: false },
  { name: 'drops the queued head and completes the remaining follow-up', count: 2, drop: true }
]) {
  test(`real claude ${scenario.name}`, async ({ relay, daemon }, testInfo) => {
    test.setTimeout(540_000)
    // The fixture resolves this same executable. Read the binary, not a checkout that may be newer.
    const { stdout } = await promisify(execFile)(process.env.PYRY_BIN || 'pyry', ['version'], { timeout: 10_000 })
    const revision = /^pyry (?:dev-)?([a-f0-9]{7,40})\s*$/.exec(stdout)?.[1]
    expect(Boolean(revision), 'live acceptance requires a daemon built with its source revision').toBe(true)
    testInfo.annotations.push({ type: 'daemon-revision', description: revision! })

    await withIsolatedElectronApp(async ({ app, page }) => {
      const nonce = Date.now()
      const markers = ['FIRST', 'SECOND', 'THIRD'].map(label => `QUEUE_${label}_${nonce}_DONE`)
      const expected = scenario.drop ? [0, 2] : scenario.count === 1 ? [0, 1] : [0, 1, 2]
      const gate = join(daemon.workdir, `queue-release-${nonce}`)
      const entered = join(daemon.workdir, `queue-entered-${nonce}`)
      const first = 'Use Bash to run this exact command in the foreground, never in the background: ' +
        `\`touch "${entered}"; until [ -f "${gate}" ]; do sleep 0.2; done\`. ` +
        `After the command finishes, reply with only ${markers[0]}. Do not write the release file yourself.`
      const followups = markers.slice(1, scenario.count + 1).map(marker => `Reply with only ${marker}. Do not use tools.`)
      const composer = page.getByPlaceholder('Message…')
      const stop = page.getByRole('button', { name: 'Stop the running turn', exact: true })
      const rowsFor = (text: string) => page.locator('[data-thread-role="user"], [data-thread-role="queued"]', { hasText: text })
      const queuedFor = (text: string) => page.locator('.message-row--queued', { hasText: text })
      let released = false
      let queuedBeforeRelease = 0

      await page.evaluate(createQueueTurnEvidence, { conversationId: '', markers, subscribe: true })
      await app.evaluate(({ ipcMain }, channel) => {
        const sends: Send[] = []
        const listener = (_event: unknown, command: RendererCommand) => {
          if (command.type === 'sendMessage') sends.push({ conversationId: command.payload.conversation_id,
            messageId: command.payload.message_id })
        }
        ipcMain.on(channel, listener)
        ;(globalThis as CaptureGlobal).queueSendCapture = {
          sends, stop: () => ipcMain.removeListener(channel, listener)
        }
      }, COMMAND_CHANNEL)
      try {
        await pairFromUnpairedLaunch(page, encodePairingPayload({ ...daemon.pairFields, relay: `${relay.url}/v1/client` }))
        await expect(page.locator('.channel-list__row-open')).toBeVisible({ timeout: 45_000 })
        await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled({ timeout: 45_000 })
        await expect.poll(async () => (await readEvidence(page, expected)).conversationId.length).toBeGreaterThan(0)
        await composer.fill(first)
        await composer.press('Enter')
        await expect.poll(() => existsSync(entered), { timeout: TURN_TIMEOUT }).toBe(true)
        await expect(stop).toBeVisible()
        expect(existsSync(gate)).toBe(false)

        for (const message of followups) {
          await composer.fill(message)
          await composer.press('Enter')
          await expect(queuedFor(message)).toHaveCount(1, { timeout: TURN_TIMEOUT })
          await expect(rowsFor(message)).toHaveCount(1)
          await expect(queuedFor(message).getByRole('button', { name: 'Drop queued message' })).toBeVisible()
        }
        const sends = await app.evaluate(() => (globalThis as CaptureGlobal).queueSendCapture.sends)
        expect(sends).toHaveLength(1 + scenario.count)
        const conversationId = (await readEvidence(page, expected)).conversationId
        expect(sends.every(send => send.conversationId === conversationId)).toBe(true)
        expect(new Set(sends.map(send => send.messageId)).size).toBe(sends.length)
        const queuedIds = sends.slice(1).map(send => send.messageId)
        await expect.poll(async () => (await readEvidence(page, expected)).queuedMessageIds,
          { timeout: TURN_TIMEOUT }).toEqual(queuedIds)
        queuedBeforeRelease = queuedIds.length

        if (scenario.drop) {
          await queuedFor(followups[0]).getByRole('button', { name: 'Drop queued message' }).click()
          await expect.poll(async () => (await readEvidence(page, expected)).queuedMessageIds,
            { timeout: TURN_TIMEOUT }).toEqual(queuedIds.slice(1))
          await expect(rowsFor(followups[0])).toHaveCount(0)
          await expect(queuedFor(followups[1])).toHaveCount(1)
        }
        // Enqueue (and any drop) is established while the ordinary first turn is still held.
        expect((await readEvidence(page, expected)).turns.every(turn => turn.completions === 0)).toBe(true)
        await expect(stop).toBeVisible()
        expect(existsSync(gate)).toBe(false)
        await writeFile(gate, 'release\n', { mode: 0o600 })
        released = true

        await expect.poll(async () => (await readEvidence(page, expected)).complete,
          { timeout: TURN_TIMEOUT * (scenario.count + 1), message: 'each queued reply needs its own normal turn completion' }).toBe(true)
        await expect(stop).toHaveCount(0, { timeout: TURN_TIMEOUT })
        await expect(page.locator('.bubble__cursor')).toHaveCount(0)
        for (const [index, message] of followups.entries()) {
          if (scenario.drop && index === 0) continue
          await expect(page.locator('[data-thread-role="user"]', { hasText: message })).toHaveCount(1)
          await expect(rowsFor(message)).toHaveCount(1)
          await expect(queuedFor(message)).toHaveCount(0)
          await expect(page.locator('.message-row', { hasText: message })
            .getByRole('button', { name: 'Drop queued message' })).toHaveCount(0)
          // Assert the response is rendered as well as received, without dumping model text on failure.
          await expect.poll(() => page.locator('[data-thread-role="assistant"]').evaluateAll(
            (rows, marker) => rows.some(row => row.textContent?.includes(marker)), markers[index + 1])).toBe(true)
        }
        // Negative evidence needs a bounded observation period after positive completion.
        await page.waitForTimeout(3_000)
        expect((await readEvidence(page, expected)).complete).toBe(true)
        expect((await readEvidence(page, expected)).queuedMessageIds).toEqual([])
        expect(await app.evaluate(() => (globalThis as CaptureGlobal).queueSendCapture.sends)).toEqual(sends)
        await expect(stop).toHaveCount(0)
        if (scenario.drop) await expect(rowsFor(followups[0])).toHaveCount(0)
      } finally {
        const evidence = await readEvidence(page, expected)
        await testInfo.attach('queue-delivery-evidence', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
          daemonRevision: revision, scenario: scenario.name, released, queuedBeforeRelease,
          complete: evidence.complete, turns: evidence.turns, queueSnapshots: evidence.queueSnapshots,
          remainingQueueCount: evidence.queuedMessageIds.length
        })) })
        await page.evaluate(() => (window as EvidenceWindow).queueTurnEvidence.stop())
        await app.evaluate(() => (globalThis as CaptureGlobal).queueSendCapture.stop())
      }
    })
  })
}
