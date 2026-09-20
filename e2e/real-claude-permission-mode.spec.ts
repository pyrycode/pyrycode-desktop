import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DaemonEvent } from '../src/shared/ipc/events'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// Preserve the operator-owned stdio approval surface when launching in bypass.
// Authenticated execution is dispatcher-owned; a prerequisite skip is not acceptance.
test.use({ skipPermissions: true, stdioPermissionPrompt: true,
  interactiveRunner: 'stream-json', allowRemotePermissions: true })
const ROUNDTRIP = 15_000
const TURN = 120_000
type Reading = Pick<Extract<DaemonEvent, { type: 'runConfigReceived' }>, 'conversationId' | 'sessionId' | 'permissionMode'> & { ackCount: number }
type Proof = { readings: Reading[]; acks: string[]; turns: string[];
  modals: { conversationId: string; read: boolean; allow: string | null }[];
  tools: { conversationId: string; read: boolean }[]; off: () => void }
type DriveWindow = typeof window & { permissionProof: Proof }

test('operator bypass stays confirmed through a no-op write, then Plan and Manual approval enforce Read', async ({ relay, daemon, page }, testInfo) => {
  test.setTimeout(360_000)
  const { stdout } = await promisify(execFile)(process.env.PYRY_BIN || 'pyry', ['version'], { timeout: 10_000 })
  const revision = /^pyry (?:dev-)?([a-f0-9]{7,40})\s*$/.exec(stdout)?.[1]
  expect(revision, 'tested daemon must identify its source revision').toBeTruthy()
  testInfo.annotations.push({ type: 'daemon-revision', description: revision! })
  await testInfo.attach('daemon-revision', { body: Buffer.from(revision!), contentType: 'text/plain' })
  // sessions.settingsFromEntry normalizes absent permission_mode + false/absent yolo to default.
  const registry = JSON.parse(await readFile(join(dirname(daemon.workdir), '.pyry/test/sessions.json'), 'utf8'))
  expect(registry.sessions[0].yolo ?? false).toBe(false)
  expect(registry.sessions[0].permission_mode || 'default').toBe('default')
  const noteDir = join(dirname(daemon.workdir), '.pyry/test/handoff-notes')
  await mkdir(noteDir, { recursive: true, mode: 0o700 })
  const note = join(noteDir, 'permission-probe.txt')
  await writeFile(note, 'synthetic permission witness\n', { mode: 0o600 })
  await page.evaluate(() => {
    const proof: Proof = { readings: [], acks: [], turns: [], modals: [], tools: [], off: () => {} }
    proof.off = window.pyry.onDaemonEvent(event => {
      if (event.type === 'runConfigReceived') {
        const { conversationId, sessionId, permissionMode } = event
        proof.readings.push({ conversationId, sessionId, permissionMode, ackCount: proof.acks.length })
      }
      if (event.type === 'sessionSettingsUpdated') proof.acks.push(event.sessionId)
      if (event.type === 'turnEnd') proof.turns.push(event.conversationId)
      if (event.type === 'modalShown' && event.class === 'permission') proof.modals.push({
        conversationId: event.conversationId, read: event.title === 'Read',
        allow: event.options.find(option => option.id === 'allow_once')?.label ?? null
      })
      if (event.type === 'toolUse') proof.tools.push({ conversationId: event.conversationId, read: event.name === 'Read' })
    })
    ;(window as DriveWindow).permissionProof = proof
  })
  const proof = () => page.evaluate(() => {
    const { off: _off, ...value } = (window as DriveWindow).permissionProof
    return value
  })
  const label = page.locator('.composer__permission-label')
  const send = async (message: string) => {
    await page.getByPlaceholder('Message…').fill(message)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
  }
  try {
    await pairFromUnpairedLaunch(page, encodePairingPayload({ server: daemon.pairFields.server,
      relay: `${relay.url}/v1/client`, token: daemon.pairFields.token,
      server_static_pubkey: daemon.pairFields.server_static_pubkey }))
    await expect(page.locator('.channel-list__row-open')).toBeVisible({ timeout: 45_000 })
    await page.locator('.channel-list__row-open').click()
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    await send('Reply with the single word ready. Do not use tools.')
    await expect.poll(async () => (await proof()).turns.length, { timeout: TURN }).toBe(1)
    await expect(label).toHaveText('Bypass approvals', { timeout: ROUNDTRIP })
    const initial = (await proof()).readings.at(-1)!
    expect(initial.permissionMode).toBe('bypassPermissions')
    expect(initial.sessionId.length > 0).toBe(true)
    const pick = async (name: string, confirmed: string) => {
      const before = await proof()
      const deadline = Date.now() + ROUNDTRIP
      const timeout = () => Math.max(1, deadline - Date.now())
      await page.locator('.composer__permission').click()
      await page.getByRole('menu', { name: 'Permission mode', exact: true })
        .getByRole('menuitem', { name, exact: true }).click()
      await expect.poll(async () => (await proof()).acks.length, { timeout: timeout() }).toBe(before.acks.length + 1)
      expect((await proof()).acks.at(-1) === initial.sessionId).toBe(true)
      await expect.poll(async () => (await proof()).readings.slice(before.readings.length).some(r =>
        r.ackCount === before.acks.length + 1 && r.conversationId === initial.conversationId &&
        r.sessionId === initial.sessionId && r.permissionMode === confirmed
      ), { timeout: timeout() }).toBe(true)
      await expect(label).toHaveText(confirmed === 'bypassPermissions' ? 'Bypass approvals' : name, { timeout: timeout() })
      expect((await proof()).turns.length).toBe(1)
    }
    // Stored default can acknowledge without applying. The footer must continue to tell the truth.
    await pick('Manual approval', 'bypassPermissions')
    await pick('Plan', 'plan')
    await pick('Manual approval', 'default')
    expect((await proof()).modals).toHaveLength(0)
    expect((await proof()).tools).toHaveLength(0)
    await send(`Use the Read tool once to read the file at ${note}, then reply with its exact contents and nothing else. ` +
      'Do not use any other tool. If the read is denied or fails, do not retry it and reply with the single word blocked.')
    const panel = page.locator('.permission-panel')
    await expect(panel).toBeVisible({ timeout: TURN })
    const modal = (await proof()).modals.at(-1)!
    expect(modal.conversationId === initial.conversationId && modal.read).toBe(true)
    expect(modal.allow !== null).toBe(true)
    await panel.getByRole('radio', { name: modal.allow!, exact: true }).press('Space')
    await panel.getByRole('button', { name: 'Continue', exact: true }).click()
    await panel.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.poll(async () => (await proof()).turns.length, { timeout: TURN }).toBe(2)
    const after = await proof()
    expect(after.tools.length).toBeGreaterThan(0)
    expect(after.tools.every(tool => tool.conversationId === initial.conversationId && tool.read)).toBe(true)
    expect(after.readings.every(r => !r.sessionId || r.sessionId === initial.sessionId)).toBe(true)
    await expect(label).toHaveText('Manual approval')
    await testInfo.attach('permission-confirmation-result', {
      body: Buffer.from(JSON.stringify({ executed: true, daemonRevision: revision, noOpRemainedBypass: true,
        planConfirmed: true, manualConfirmed: true, sameSessionReadApproval: true })), contentType: 'application/json'
    })
  } finally {
    await page.evaluate(() => { (window as DriveWindow).permissionProof.off(); delete (window as Partial<DriveWindow>).permissionProof })
  }
})
