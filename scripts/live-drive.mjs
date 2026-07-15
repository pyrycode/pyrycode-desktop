// The LIVE-stack operator drive (#448) — the one command that proves the shipped operator flow on
// the REAL production stack: it launches the built app, pairs a throwaway device against the LIVE
// daemon over the PRODUCTION relay, creates a conversation through the UI, sends a message, waits
// for a real claude reply to stream into the thread, then revokes the pairing. Run it next to the
// harness gate before a ship: `npm run build && node scripts/live-drive.mjs .`
//
// First green 2026-07-15 ("Standby.", 4s round-trip) — the first real end-to-end desktop send ever.
// Prints progress lines only; never prints the pairing payload or token.
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = process.argv[2] ?? process.cwd()
const DEVICE = 'claudian-livetest-448'

function log(msg) {
  console.log(`[drive] ${new Date().toISOString().slice(11, 19)} ${msg}`)
}

// --- 1. Pair a fresh device on the live daemon (CLI writes the registry; #786 reloads at handshake).
const pyry = join(homedir(), '.local/bin/pyry')
let pairStdout = ''
try {
  pairStdout = execFileSync(pyry, ['pair', '--name', DEVICE, '--allow-remote-permissions'], {
    encoding: 'utf-8'
  })
} catch (e) {
  console.error('[drive] pyry pair failed:', e.message)
  process.exit(1)
}
// Scan stdout for the base64url JSON payload (the fixture's decode approach); keep it in memory only.
let payload = null
for (const line of pairStdout.split('\n')) {
  const t = line.trim()
  if (!/^[A-Za-z0-9_-]{40,}$/.test(t)) continue
  try {
    const p = JSON.parse(Buffer.from(t, 'base64url').toString('utf-8'))
    if (p.server && p.token && p.relay) {
      payload = t
      log(`paired device "${DEVICE}" against server ${String(p.server).slice(0, 8)}…, relay ${p.relay}`)
      break
    }
  } catch {
    /* not the payload line */
  }
}
if (!payload) {
  console.error('[drive] no pairing payload found in pyry pair output')
  process.exit(1)
}

// --- 2. Launch the built app with an isolated user-data dir (fresh → pairing screen).
const userDataDir = mkdtempSync(join(tmpdir(), 'pyry-live-drive-'))
const env = { ...process.env }
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({
  cwd: APP_DIR,
  args: ['.', `--user-data-dir=${userDataDir}`],
  env
})
const page = await app.firstWindow()
log('app launched')

try {
  // --- 3. Pair through the real UI.
  const pasteBox = page.locator('textarea[aria-label="Pairing code"]')
  await pasteBox.waitFor({ state: 'visible', timeout: 15000 })
  await pasteBox.fill(payload)
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await page.locator('[aria-label="Server key fingerprint"]').waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  log('pairing confirmed, waiting for the channel list over the production relay')

  // The live daemon has existing conversations; a rendered row is the connected gate.
  await page.locator('.channel-list__row-open').first().waitFor({ timeout: 45000 })
  log('connected — conversation list rendered')

  // --- 4. Create a conversation through the UI and send.
  await page.getByRole('button', { name: 'New discussion' }).click()
  await page.locator('.conversation').waitFor({ timeout: 30000 })
  log('conversation created by the daemon, thread mounted')

  const sendButton = page.getByRole('button', { name: 'Send' })
  const composer = page.getByPlaceholder('Message…')
  await composer.fill(`Reply with a single short word. live-drive-448 ${Date.now()}`)
  await sendButton.click()
  log('message sent — waiting up to 150s for a real claude reply to stream in')

  const deadline = Date.now() + 150000
  let ok = false
  while (Date.now() < deadline) {
    const n = await page
      .locator('[data-thread-role="assistant"]')
      .evaluateAll((els) => els.filter((el) => (el.textContent ?? '').replace('▎', '').trim().length > 0).length)
    if (n >= 1) {
      ok = true
      break
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  if (ok) {
    const text = await page.locator('[data-thread-role="assistant"]').first().textContent()
    log(`REPLY STREAMED: "${(text ?? '').replace('▎', '').trim().slice(0, 80)}"`)
    log('LIVE DRIVE GREEN')
  } else {
    await page.screenshot({ path: '/tmp/live-drive-448-fail.png' })
    log('NO REPLY within 150s — screenshot at /tmp/live-drive-448-fail.png')
    log('LIVE DRIVE RED')
  }
} finally {
  await app.close().catch(() => {})
  rmSync(userDataDir, { recursive: true, force: true })
  try {
    execFileSync(pyry, ['pair', 'revoke', DEVICE], { encoding: 'utf-8' })
    log(`pairing "${DEVICE}" revoked`)
  } catch {
    log(`could not revoke pairing "${DEVICE}" — revoke by hand: pyry pair revoke ${DEVICE}`)
  }
}
