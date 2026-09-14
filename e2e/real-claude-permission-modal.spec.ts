import { type Page } from '@playwright/test'
import { existsSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// Authenticated execution belongs to the dispatcher. An absent offer fails this scenario;
// fixture prerequisite skips never establish acceptance. Keep trace/video/screenshots disabled.
test.use({ skipPermissions: false, interactiveRunner: 'stream-json',
  stdioPermissionPrompt: true, allowRemotePermissions: true })
const HANDSHAKE_TIMEOUT_MS = 45_000
const TURN_TIMEOUT_MS = 120_000
const STALE_SECONDS = 1

// Retain only routing/observation metadata, never whole events, transcripts, rules or answer tokens.
type Drive = {
  created: { id: string; cwd: string }[]
  modals: { conversationId: string; allowLabel: string | null; offered: boolean }[]
  completed: string[]
  sessions: Map<string, { id: string; received: number }>
  off: () => void
}
type DriveWindow = typeof window & { permissionDrive: Drive }
const driveCounts = (page: Page, conversationId: string) => page.evaluate(id => {
  const drive = (window as DriveWindow).permissionDrive
  return { modals: drive.modals.filter(m => m.conversationId === id).length,
    completed: drive.completed.filter(c => c === id).length }
}, conversationId)

async function sessionId(page: Page, conversationId: string): Promise<string> {
  const before = await page.evaluate(id => (window as DriveWindow).permissionDrive.sessions.get(id)?.received ?? 0,
    conversationId)
  await page.evaluate(id => window.pyry.sendCommand({ type: 'requestSessionSettings',
    payload: { conversation_id: id } }), conversationId)
  await expect.poll(() => page.evaluate(id => (window as DriveWindow).permissionDrive.sessions.get(id)?.received ?? 0,
    conversationId), { timeout: HANDSHAKE_TIMEOUT_MS }).toBeGreaterThan(before)
  return page.evaluate(id => (window as DriveWindow).permissionDrive.sessions.get(id)!.id, conversationId)
}

test('real claude session checkbox grants repeated Bash use only in the current session', async ({ relay, daemon, page }) => {
  test.setTimeout(420_000)
  // Same grantable Bash command as TestInteractiveStreamStdioAlwaysAllowIsSessionScoped.
  const witness = join(daemon.workdir, 'pyrycode-always-allow-witness.txt')
  const message = 'Use the Bash tool to run exactly `touch pyrycode-always-allow-witness.txt`. ' +
    'Do not use another tool. After it completes, reply with one short word.'
  const modified = (): number => existsSync(witness) ? statSync(witness).mtimeMs : 0
  const panel = page.locator('.permission-panel')
  const composer = page.getByPlaceholder('Message…')
  const send = page.getByRole('button', { name: 'Send', exact: true })

  await page.evaluate(() => {
    const drive: Drive = { created: [], modals: [], completed: [], sessions: new Map(), off: () => {} }
    drive.off = window.pyry.onDaemonEvent(event => {
      if (event.type === 'conversationCreated') drive.created.push({ id: event.conversation.id, cwd: event.conversation.cwd })
      if (event.type === 'modalShown' && event.class === 'permission') drive.modals.push({
        conversationId: event.conversationId,
        allowLabel: event.options.find(option => option.id === 'allow_once')?.label ?? null,
        offered: event.alwaysAllow?.offered === true
      })
      if (event.type === 'turnEnd') drive.completed.push(event.conversationId)
      if (event.type === 'runConfigReceived' && event.sessionId) drive.sessions.set(event.conversationId, {
        id: event.sessionId, received: (drive.sessions.get(event.conversationId)?.received ?? 0) + 1
      })
    })
    ;(window as DriveWindow).permissionDrive = drive
  })
  try {
    await pairFromUnpairedLaunch(page, encodePairingPayload({ server: daemon.pairFields.server,
      relay: `${relay.url}/v1/client`, token: daemon.pairFields.token,
      server_static_pubkey: daemon.pairFields.server_static_pubkey }))
    await expect(page.locator('.channel-list__row-open')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

    const create = async (count: number): Promise<string> => {
      await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
      await expect.poll(() => page.evaluate(() => (window as DriveWindow).permissionDrive.created.length),
        { timeout: HANDSHAKE_TIMEOUT_MS }).toBe(count)
      // Compare paths inside the page: failed assertions expose only a Boolean.
      expect(await page.evaluate(workdir => (window as DriveWindow).permissionDrive.created.at(-1)?.cwd === workdir,
        daemon.workdir)).toBe(true)
      await expect(send).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })
      return page.evaluate(() => (window as DriveWindow).permissionDrive.created.at(-1)!.id)
    }
    const submit = async (): Promise<void> => { await composer.fill(message); await send.click() }
    const conversationId = await create(1)
    expect(existsSync(witness)).toBe(false)
    await submit()
    await expect(panel).toBeVisible({ timeout: TURN_TIMEOUT_MS })
    expect(await page.evaluate(id => (window as DriveWindow).permissionDrive.modals
      .filter(modal => modal.conversationId === id).at(-1)?.offered, conversationId),
    'The daemon must offer rules; the dedicated test binary requires upstream #2365, including the mixed-offer fix.'
    ).toBe(true)
    const checkbox = panel.getByRole('checkbox', { name: "Don't ask again this session for:", exact: true })
    await expect(checkbox).toBeVisible()
    await expect(checkbox).not.toBeChecked()
    expect(await panel.locator('.permission-panel__rules li').count()).toBeGreaterThan(0)
    expect(existsSync(witness)).toBe(false)
    await panel.locator('.permission-panel__session-offer label').click()
    await expect(checkbox).toBeChecked()
    const allowLabel = await page.evaluate(() => (window as DriveWindow).permissionDrive.modals.at(-1)?.allowLabel)
    expect(typeof allowLabel === 'string').toBe(true)
    if (!allowLabel) throw new Error('The supplied permission has no allow_once option')
    await panel.getByRole('radio', { name: allowLabel, exact: true }).press('Space')
    await panel.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(checkbox).toBeChecked()
    await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
    expect(existsSync(witness)).toBe(false)
    await panel.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.poll(modified, { timeout: TURN_TIMEOUT_MS }).toBeGreaterThan(STALE_SECONDS * 1000)
    await expect.poll(async () => (await driveCounts(page, conversationId)).completed,
      { timeout: TURN_TIMEOUT_MS }).toBe(1)
    await expect(panel).toHaveCount(0)
    const originalSession = await sessionId(page, conversationId)

    utimesSync(witness, STALE_SECONDS, STALE_SECONDS)
    expect(modified()).toBe(STALE_SECONDS * 1000)
    const beforeRepeat = await driveCounts(page, conversationId)
    await submit()
    // Observing every permission event catches a transient panel as well as a held one.
    await expect.poll(async () => {
      const counts = await driveCounts(page, conversationId)
      if (counts.modals !== beforeRepeat.modals) return 'unexpected-permission'
      return counts.completed > beforeRepeat.completed && modified() > STALE_SECONDS * 1000 ? 'fresh-effect' : 'waiting'
    }, { timeout: TURN_TIMEOUT_MS }).toBe('fresh-effect')
    expect((await driveCounts(page, conversationId)).modals).toBe(beforeRepeat.modals)
    expect(await sessionId(page, conversationId) === originalSession).toBe(true)

    utimesSync(witness, STALE_SECONDS, STALE_SECONDS)
    const freshConversation = await create(2)
    expect(freshConversation !== conversationId).toBe(true)
    const beforeFresh = await driveCounts(page, freshConversation)
    await submit()
    // A new session in the SAME workspace must ask before a fresh tool effect.
    await expect(panel).toBeVisible({ timeout: TURN_TIMEOUT_MS })
    expect((await driveCounts(page, freshConversation)).modals).toBeGreaterThan(beforeFresh.modals)
    expect(modified()).toBe(STALE_SECONDS * 1000)
    expect(await sessionId(page, freshConversation) !== originalSession).toBe(true)
    await expect(checkbox).not.toBeChecked()
    // The acceptance is complete above: the fresh session asked before any effect. Cancelling is
    // this client's own path, so the drive asserts only what this repo owns — the unconditional
    // local dismissal and the still-absent effect. What the daemon does with a stdio permission
    // prompt after a modal_cancel has no upstream proof, so no assertion here waits on it.
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(panel).toHaveCount(0)
    expect(modified()).toBe(STALE_SECONDS * 1000)
  } finally {
    await page.evaluate(() => { (window as DriveWindow).permissionDrive.off(); delete (window as any).permissionDrive })
  }
})
