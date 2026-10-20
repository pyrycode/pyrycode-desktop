import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

test.use({ seedPromoted: true, interactiveRunner: 'stream-json',
  requiredCapabilities: ['interactive', 'thread', 'thread_expansion', 'thread_compact'] })

test('loaded compact history stays usable after text send and Older completes', async ({ relay, daemon }, info) => {
  test.setTimeout(240_000)
  const binary = process.env.PYRY_BIN ?? 'pyry'
  const build = JSON.parse(await readFile(join(process.cwd(), 'out/main/build-provenance.json'), 'utf8'))
  expect(build.profile).toBe('normal')
  const daemonVersion = await promisify(execFile)(binary, ['version'], { timeout: 10_000 })
  await info.attach('compact-send-provenance', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    desktop: build, os: process.platform, daemonVersion: daemonVersion.stdout.trim(),
    daemonSource: process.env.PYRY_TEST_DAEMON_REVISION ?? 'not supplied',
    daemonSha256: process.env.PYRY_BIN ? createHash('sha256').update(await readFile(binary)).digest('hex') : 'not supplied'
  })) })
  const channel = 'compact-send-history'
  const post = async () => {
    try {
      await promisify(execFile)(process.env.PYRY_BIN ?? 'pyry', ['channel',
        `-pyry-socket=${join(dirname(daemon.workdir), '.pyry', 'test.sock')}`, 'post',
        '--name', channel, '--text', 'Synthetic retained history'], { timeout: 30_000 })
    } catch { throw new Error('Synthetic history seed failed') }
  }
  await withIsolatedElectronApp(async ({ page }) => {
    await page.evaluate(() => {
      const requests = new Map<string, string>()
      let checkpoint = 0, consumed = 0
      const evidence = { owningHost: false, grants: {} as Record<string, boolean>,
        sequence: [] as { type: string; version?: number; from?: number; before?: number; checkpoint?: number; consumed?: number;
          final?: boolean; older?: boolean; echo?: boolean; settled?: boolean; reason?: string }[] }
      ;(window as any).compactSendEvidence = evidence
      ;(window as any).compactSendObserveCommand = (command: any) => {
        if (command.type !== 'queryThread') return
        requests.set(command.requestId, command.query.type)
        evidence.sequence.push({ type: command.query.type, version: command.query.payload.version, before: command.query.payload.before_order })
      }
      window.pyry.onDaemonEvent(event => {
        if (event.type === 'connected') {
          evidence.owningHost = event.ack.server_id === event.serverId
          for (const grant of ['interactive', 'thread', 'thread_expansion', 'thread_compact'])
            evidence.grants[grant] = event.ack.capabilities.includes(grant)
        }
        if (event.type === 'threadCompactUpdate') {
          consumed = Math.max(consumed, event.update.payload.version)
          evidence.sequence.push({ type: 'live', checkpoint, consumed, version: event.update.payload.version,
          from: event.update.payload.from_version, echo: event.update.payload.item?.kind === 'user_message' && typeof event.update.payload.item.order === 'number',
          settled: event.update.payload.item?.kind === 'turn_end' && event.update.payload.item.active === false })
        }
        if (event.type === 'threadReply' && event.reply.type === 'thread_reset') evidence.sequence.push({ type: 'reset', version: event.reply.payload.version })
        if (event.type === 'threadReply' && event.reply.type === 'thread_items') {
          const p = event.reply.payload
          const page = requests.get(event.requestId) === 'thread_page'
          if (p.final && !page) { checkpoint = Math.max(checkpoint, p.version); consumed = Math.max(consumed, p.version) }
          evidence.sequence.push({ type: page ? 'page-reply' : 'reply', checkpoint, consumed, version: p.version, final: p.final,
            echo: p.items.some(item => item.kind === 'user_message' && typeof item.order === 'number'),
            ...('from_version' in p ? { from: p.from_version } : {}), ...('older_exists' in p ? { older: p.older_exists } : {}) })
        }
        if (event.type === 'threadQueryFailed') evidence.sequence.push({ type: 'failure', reason: event.reason })
        if (event.type === 'threadRepairNeeded') evidence.sequence.push({ type: 'repair', reason: event.reason })
      })
    })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Debugger.enable')
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'window.pyry.sendCommand' })
    if (!result.objectId) throw new Error('Query observation unavailable')
    await cdp.send('Debugger.setBreakpointOnFunctionCall', { objectId: result.objectId,
      condition: '(globalThis.compactSendObserveCommand(arguments[0]), false)' })
    try {
      await pairFromUnpairedLaunch(page, encodePairingPayload({ ...daemon.pairFields, relay: `${relay.url}/v1/client` }))
      await expect(page.locator('.channel-list__rename')).toBeVisible({ timeout: 45_000 })
      await page.locator('.channel-list__rename').click()
      await page.locator('.edit-channel__input').fill(channel)
      await page.getByRole('dialog', { name: 'Edit channel', exact: true }).getByRole('button', { name: 'OK', exact: true }).click()
      for (let i = 0; i < 60; i++) await post()
      await page.locator('.channel-list__row-open').filter({ hasText: channel }).click()
      await expect.poll(() => page.evaluate(() => (window as any).compactSendEvidence.sequence.some(
        (entry: any) => entry.final === true && entry.older === true)), { timeout: 45_000 }).toBe(true)
      await expect(page.getByText('Synthetic retained history', { exact: true }).first()).toBeVisible()
      await page.getByPlaceholder('Message…').fill('Reply with only READY. Do not use tools.')
      await page.getByPlaceholder('Message…').press('Enter')
      // The daemon-built echo, rather than the optimistic bubble, is the send processing barrier.
      await expect.poll(() => page.evaluate(() => (window as any).compactSendEvidence.sequence.some(
        (entry: any) => entry.echo === true)), { timeout: 90_000 }).toBe(true)
      await expect.poll(() => page.evaluate(() => (window as any).compactSendEvidence.sequence.some(
        (entry: any) => entry.type === 'live' && entry.echo === true)), { timeout: 90_000 }).toBe(true)
      await expect.poll(() => page.evaluate(() => (window as any).compactSendEvidence.sequence.some(
        (entry: any) => entry.settled === true)), { timeout: 90_000 }).toBe(true)
      await expect(page.getByText('Could not load older messages', { exact: false })).toHaveCount(0)
      await page.locator('.conversation__thread').press('Home')
      await page.locator('.conversation__thread').press('ArrowUp')
      await expect.poll(() => page.evaluate(() => (window as any).compactSendEvidence.sequence.some(
        (entry: any) => entry.type === 'page-reply' && entry.final)), { timeout: 45_000 }).toBe(true)
      await expect(page.getByText('Could not load older messages', { exact: false })).toHaveCount(0)
    } finally {
      await info.attach('compact-send-redacted-sequence', { contentType: 'application/json',
        body: Buffer.from(JSON.stringify(await page.evaluate(() => (window as any).compactSendEvidence))) })
      await cdp.detach()
    }
  })
})
