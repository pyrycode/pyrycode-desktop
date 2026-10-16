import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from '../fixtures/realDaemon'
import { pairFromUnpairedLaunch } from '../fixtures/pairingArrival'
import { drivePermissionScenario, PERMISSION_PROMPT, PERMISSION_REPLY, PERMISSION_WITNESS } from '../fixtures/permissionScenario'
import { parseRecording, type Recording, type RecordedEntry } from '../fixtures/recordedExchange'
import type { ExchangeCapture } from '../fixtures/exchangeCapture'

type CaptureGlobal = typeof globalThis & { __desktopExchangeCapture?: ExchangeCapture }
type Observation = { capabilities: string[]; allowLabel: string }
type ObservedWindow = typeof window & { exchangeObservation: Observation; stopExchangeObservation: () => void }

test.use({ skipPermissions: false, interactiveRunner: 'stream-json', stdioPermissionPrompt: true,
  allowRemotePermissions: true, requiredCapabilities: ['interactive', 'thread'] })

test('capture and verify a controlled real Claude permission exchange', async ({ relay, daemon }, info) => {
  test.setTimeout(240_000)
  const output = process.env.PYRY_RECORDING_OUTPUT
  if (!output || !process.env.PYRY_BIN) throw new Error('Capture requires an output file and an explicit test daemon binary')
  const binary = resolve(process.env.PYRY_BIN)
  const build = execFileSync('go', ['version', '-m', binary], { encoding: 'utf8' })
  const daemonRevision = /vcs.revision=([a-f0-9]{40})/.exec(build)?.[1]
  if (!daemonRevision) throw new Error('Capture daemon must identify its source revision')
  await withIsolatedElectronApp(async ({ app, page }) => {
    await app.evaluate(() => {
      const capture = (globalThis as CaptureGlobal).__desktopExchangeCapture
      if (!capture) throw new Error('Capture requires the separate capture build')
      capture.begin()
    })
    await page.evaluate(() => {
      const target = window as ObservedWindow
      target.exchangeObservation = { capabilities: [], allowLabel: '' }
      target.stopExchangeObservation = window.pyry.onDaemonEvent(event => {
        if (event.type === 'connected') target.exchangeObservation.capabilities = event.ack.capabilities ?? []
        if (event.type === 'modalShown' && event.class === 'permission')
          target.exchangeObservation.allowLabel = event.options.find(option => option.id === 'allow_once')?.label ?? ''
      })
    })
    try {
      const identity = await page.evaluate(() => window.pyry.deviceIdentity())
      if (!identity.ok) throw new Error('Capture device identity unavailable')
      await pairFromUnpairedLaunch(page, encodePairingPayload({ ...daemon.pairFields, relay: `${relay.url}/v1/client` }))
      const witness = join(daemon.workdir, PERMISSION_WITNESS)
      const scenario = await drivePermissionScenario(page, {
        allowLabel: () => page.evaluate(() => (window as ObservedWindow).exchangeObservation.allowLabel),
        beforeApproval: async () => { expect(existsSync(witness)).toBe(false) },
        afterApproval: async () => { await expect.poll(() => existsSync(witness), { timeout: 120_000 }).toBe(true) }
      })
      const observed = await page.evaluate(() => (window as ObservedWindow).exchangeObservation)
      expect(observed.capabilities).toEqual(expect.arrayContaining(['interactive', 'thread']))
      const wire: RecordedEntry[] = await app.evaluate(() => (globalThis as CaptureGlobal).__desktopExchangeCapture!.take())
      await info.attach('capture-request-types', { contentType: 'text/plain', body: Buffer.from(JSON.stringify({
        types: wire.filter(entry => entry.direction === 'client').map(entry => entry.message.type)
      })) })
      const answers = wire.filter(entry => entry.direction === 'client' && entry.message.type === 'modal_answer')
      expect(answers).toHaveLength(1)
      expect((answers[0].message.payload as Record<string, unknown>).option_id).toBe('allow_once')
      // Replace only known ephemeral workspace paths and client-owned answer nonces.
      // No arbitrary text scrubbing that could hide a leaked credential or change protocol behaviour.
      const answerNonces = answers.map(entry => (entry.message.payload as Record<string, unknown>).answer_token)
      const normalize = (value: unknown): unknown => {
        if (typeof value === 'string') {
          const nonce = answerNonces.indexOf(value)
          return nonce >= 0 ? `recorded-answer-nonce-${nonce + 1}` : value.replaceAll(daemon.workdir, '/recorded/workspace')
        }
        if (Array.isArray(value)) return value.map(normalize)
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]))
        return value
      }
      const recording: Recording = { format: 'pyrycode.daemon-exchange', version: 1,
        source: { capturedAt: new Date().toISOString(), daemonRevision,
          desktopRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          daemonBinarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
          claudeVersion: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim() },
        scenario: { id: 'permission-allow', prompt: PERMISSION_PROMPT, expectedReply: PERMISSION_REPLY,
          allowLabel: observed.allowLabel, ...scenario }, capabilities: observed.capabilities,
        deviceId: identity.deviceId, wire: normalize(wire) as RecordedEntry[] }
      const encoded = JSON.stringify(recording, null, 2) + '\n'
      for (const name of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'PYRY_LIVE_CLAUDE_TOKEN'])
        if (process.env[name] && encoded.includes(process.env[name]!)) throw new Error('Invalid daemon recording: credential present')
      parseRecording(encoded)
      // Publish only after the full real UI flow and side-effect checks pass. Never overwrite a fixture.
      writeFileSync(output, encoded, { mode: 0o600, flag: 'wx' })
      await info.attach('capture-provenance', { contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ source: recording.source, frames: wire.length, historyRetry: scenario.historyRetry })) })
    } finally {
      await app.evaluate(() => (globalThis as CaptureGlobal).__desktopExchangeCapture?.stop())
      await page.evaluate(() => (window as ObservedWindow).stopExchangeObservation())
    }
  })
})
