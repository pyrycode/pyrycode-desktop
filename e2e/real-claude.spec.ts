import {
  test as base,
  expect,
  _electron as electron,
  type Page
} from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  startFakeRoutingRelay,
  type FakeRoutingRelay
} from '../src/main/transport/fakeRoutingRelay'
import { LOOPBACK_RELAY_ENV_FLAG } from '../src/main/relayPolicy'
import { TEST_SECRET_BACKEND_ENV_FLAG } from '../src/main/secretBackend'
import type { QrPayload } from '../src/shared/wire/types'

// The real-claude UI e2e (#252) — the thin client-layer net over the daemon-side liveness test (#854).
// Every OTHER Desktop e2e (#89 transport round-trip, #93/#94 UI pair/send/stream) drives a fake relay +
// a fake daemon that ALWAYS answer, so they stay green even if the real daemon never responds. This spec
// drives the REAL stack the operator ships: a freshly-spawned real `pyry` daemon running real claude on
// `--model haiku`, bridged to the built Electron UI through #251's content-blind routing relay
// (startFakeRoutingRelay). The window stands in for #854's headless phone.
//
// It is gated OUT of the default `npm run e2e` (agent pipeline: no daemon, no claude, no creds) by a
// filename `testIgnore` in playwright.config.ts; it runs only under playwright.real-claude.config.ts via
// `npm run e2e:real-claude`, part of the operator's pre-ship gate alongside `npm run build` / `npm test`.
// When the real stack is unavailable the spec SKIPS cleanly (missing binaries/creds) — an unrun test is
// the correct outcome there, not a hard failure.
//
// SCOPE: zero production `src/` change. The app, as built, already works against the real daemon+relay
// (#179 advertises `interactive` and renders the structured reply as data-thread-role="assistant"; #251
// is the routing bridge). The whole deliverable is this spec + its config + gating wiring.
//
// The harness reuses #94's pattern verbatim: the two `app.isPackaged`-gated dev affordances (#97 loopback
// ws:// relay via PYRY_ALLOW_LOOPBACK_RELAY, #99 keychain-free secret backend via PYRY_TEST_SECRET_BACKEND),
// an isolated `--user-data-dir` for a guaranteed-unpaired start, the encodePairingPayload helper, the
// paste/Pair/Confirm/Send-enabled flow, and file-local fixtures with LIFO teardown. The SUBSTANTIVE swap:
// #251's startFakeRoutingRelay replaces #94's fakeRelayForwarder + fakeDaemon pair, and a spawned real
// `pyry` daemon sits on the relay's /v1/server leg.
//
// SECRET HYGIENE (security-sensitive label): assertions read DOM text / visibility / counts only; no
// failure diagnostic serialises the pairing token, keys, or the transcript. `pyry pair` stdout carries the
// token inside the payload, so it is NEVER echoed into an error — only the (content-free, #62) daemon
// stderr is surfaced, and only on a STARTUP failure before any message flows.

// --- Selectors ---------------------------------------------------------------
// The one place #94 is stale: a real v2 daemon fans the STRUCTURED stream to interactive conns, which
// renders into the timeline (ConversationScreen.tsx:154) as data-thread-role="assistant" — NOT the
// non-interactive MessageBubble (#94's data-message-role="daemon", never fired here).
const ASSISTANT_ROW = '[data-thread-role="assistant"]'
// The streaming cursor ▎ (U+258E) is a child <span> INSIDE the assistant bubble, so a row's textContent
// includes it even while the reply text is still empty. Strip it before the non-empty check.
const CURSOR_CHAR = '▎'
// turn_end appends a turnBoundary that drops the cursor — its absence is the per-turn quiesce signal.
const CURSOR_SELECTOR = '.bubble__cursor'

// --- Timeouts ----------------------------------------------------------------
// Generous to absorb real daemon startup latency (registration on /v1/server is async after spawn) plus a
// handshake re-dial or two: if the app's first noise_init reaches the relay before the daemon leg is OPEN,
// #251's relay drops it silently and the app's supervisor re-dials on a fresh conn_id. Send-enabled is the
// readiness signal (whenReady() is chicken-and-egg here — the client leg exists only once the app dials).
const HANDSHAKE_TIMEOUT_MS = 45_000
// One turn = cold PTY claude (spawn + model load + first reply). Matches #854's per-turn budget.
const TURN_TIMEOUT_MS = 120_000
// Whole spec: handshake + 2×turn + headroom.
const SPEC_TIMEOUT_MS = 300_000
// Control socket must be dialable shortly after spawn (mirrors #854's waitForReady).
const DAEMON_READY_TIMEOUT_MS = 10_000
const PAIR_TIMEOUT_MS = 15_000

// The seeded bootstrap POOL id (any valid v4 shape; it only has to match between the two registry files).
// Reused from #854's liveBootstrapUUID for fidelity. Real claude still writes its transcript at its own
// minted uuid — the merged #854 PID-probe resolves the reply, so nothing extra is seeded for that.
const BOOTSTRAP_UUID = '77777777-7777-4777-8777-777777777777'
// The desktop sends conversation_id 'default' verbatim (composerSend.ts MILESTONE_CONVERSATION_ID) and
// cannot seed the daemon registry from the client side. A fresh real daemon does NOT auto-bind an ad-hoc
// 'default' conversation (send_message rejects an unbound conv, pyrycode #678), so the fixture binds
// 'default' → the seeded bootstrap session before spawn. 'default' is a legal opaque conversation id.
const BOUND_CONVERSATION_ID = 'default'

interface SpawnedDaemon {
  // Only the three credential fields decoded from `pyry pair` stdout. The QrPayload's `relay` is assembled
  // test-side from the #251 relay's /v1/client leg, never from pyry's output (which points at prod).
  pairFields: Pick<QrPayload, 'server' | 'token' | 'server_static_pubkey'>
}

type RealClaudeFixtures = {
  relay: FakeRoutingRelay
  daemon: SpawnedDaemon
  page: Page
}

// Local fixtures (this file only — the shared electronApp.ts stays scenario-agnostic per #40). The chain
// relay → daemon → page forces LIFO teardown (page → daemon → relay): the app closes FIRST so its
// supervisor cannot churn-reconnect on the daemon/relay drop, exactly as #94 enforces. The daemon fixture
// wraps `use()` in try/finally so its subprocess + temp dirs are reaped on setup failure, test failure,
// AND success — no orphaned real-claude child, no leaked temp dir.
const test = base.extend<RealClaudeFixtures>({
  relay: async ({}, use) => {
    const relay = await startFakeRoutingRelay()
    await use(relay)
    await relay.close()
  },

  daemon: async ({ relay }, use, testInfo) => {
    // --- Skip-gating: resolve binaries + creds BEFORE creating any resource, so a skip never leaks. ---
    const claudeBin = resolveOnPath('claude')
    testInfo.skip(claudeBin === null, 'realclaude: `claude` not on PATH')

    const pyryBin = resolvePyryBin()
    testInfo.skip(
      pyryBin === null,
      'realclaude: `pyry` not found — set PYRY_BIN or put it on PATH, built from a #854-inclusive tree'
    )

    const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
    const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? ''
    testInfo.skip(
      apiKey === '' && oauthToken === '',
      'realclaude: neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set. Max-only Mac: extract the ' +
        "OAuth token via `security find-generic-password -s 'Claude Code-credentials' -w | " +
        "jq -r '.claudeAiOauth.accessToken'` and export CLAUDE_CODE_OAUTH_TOKEN."
    )

    // On the OAuth path, seed <daemonHome>/.claude.json from the operator's real ~/.claude.json so
    // interactive (PTY) claude skips the onboarding theme picker — without it ptyrunner reads the picker
    // glyph as "ready" and the turn deadlocks (pyrycode #496). Read it BEFORE isolating HOME.
    let claudeJsonBytes: Buffer | null = null
    if (oauthToken !== '') {
      const src = join(process.env.HOME ?? homedir(), '.claude.json')
      try {
        claudeJsonBytes = await readFile(src)
      } catch {
        testInfo.skip(
          true,
          `realclaude: CLAUDE_CODE_OAUTH_TOKEN is set but ${src} could not be read. Run \`claude\` once ` +
            'directly to complete onboarding (writes ~/.claude.json), then re-run.'
        )
      }
    }

    // testInfo.skip returns void (not `never`), so TS cannot narrow the nulls away — re-assert once. Not
    // reachable: every null above was skip-gated. (`throw` keeps the types honest without a blind cast.)
    if (claudeBin === null || pyryBin === null) {
      throw new Error('realclaude: unreachable — binaries were skip-gated above')
    }

    // --- Resource creation, tracked so `cleanup` reaps everything on any exit path. ---
    let daemonHome: string | null = null
    let socketDir: string | null = null
    let child: ChildProcess | null = null
    const cleanup = async (): Promise<void> => {
      if (child !== null) await reapDaemon(child)
      if (daemonHome !== null) await rm(daemonHome, { recursive: true, force: true })
      if (socketDir !== null) await rm(socketDir, { recursive: true, force: true })
    }

    try {
      // Two isolations, two dirs: the daemon HOME (fresh registry + empty claude sessions dir) is separate
      // from the app's --user-data-dir (guaranteed-unpaired start, owned by the page fixture).
      daemonHome = await mkdtemp(join(tmpdir(), 'pyry-daemon-'))
      const workdir = join(daemonHome, 'work')
      await mkdir(workdir, { recursive: true, mode: 0o700 })
      if (claudeJsonBytes !== null) {
        await writeFile(join(daemonHome, '.claude.json'), claudeJsonBytes, { mode: 0o600 })
      }

      // The isolated HOME + creds env shared by `pyry pair` and the daemon. process.env already carries
      // the credential var(s); HOME is overridden to the fresh daemon home.
      const daemonEnv: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: daemonHome,
        PYRY_ALLOW_INSECURE_RELAY: '1',
        PYRY_MOBILE_V2: '1'
      }

      // Pair BEFORE the daemon starts (mints the bearer token + responder static pubkey, writes the
      // registry the daemon loads at startup). `-pyry-name=test` → registry dir <home>/.pyry/test/.
      const pairStdout = await runPyryPair(pyryBin, daemonEnv)
      const pairFields = decodePairFields(pairStdout)

      // Seed the binding BEFORE spawn (the registry loads once at startup, no reload): bind 'default' →
      // the bootstrap pool session so router.Route('default') resolves and the reply stream binds.
      await seedRegistry(daemonHome, workdir)

      socketDir = await mkdtemp('/tmp/pyry-sock-')
      const socketPath = join(socketDir, 'pyry.sock')
      const args = [
        `-pyry-socket=${socketPath}`,
        '-pyry-name=test',
        `-pyry-claude=${claudeBin}`,
        '-pyry-idle-timeout=0',
        `-pyry-workdir=${workdir}`,
        // #251's relay identifies the daemon leg by the PATH /v1/server (NOT /v2/server, a Go-fake
        // convention its legFor() would reject). The daemon preserves an explicit relay path verbatim.
        `-pyry-relay=${relay.url}/v1/server`,
        '--',
        '--model',
        'haiku',
        '--dangerously-skip-permissions'
      ]
      // detached: true puts pyry + its claude grandchild in one process group so teardown reaps the whole
      // group. stdout ignored; stderr piped for a startup-only, content-free diagnostic.
      child = spawn(pyryBin, args, {
        env: daemonEnv,
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })

      await waitForDaemonReady(child, socketPath)

      await use({ pairFields })
    } finally {
      await cleanup()
    }
  },

  page: async ({ daemon }, use) => {
    // `daemon` is depended on for teardown ordering only; its value is consumed in the test body.
    void daemon
    // Verbatim from #94: launch the BUILT app (`args: ['.']`), strip ELECTRON_RENDERER_URL to force the
    // built-renderer path, set the two dev-affordance flags, and isolate userData for an unpaired start.
    const env = { ...process.env }
    delete env.ELECTRON_RENDERER_URL
    env[LOOPBACK_RELAY_ENV_FLAG] = '1'
    env[TEST_SECRET_BACKEND_ENV_FLAG] = '1'
    const userDataDir = await mkdtemp(join(tmpdir(), 'pyry-e2e-realclaude-'))
    const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env })
    const page = await app.firstWindow()
    await use(page)
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

/** Encode a QrPayload the way the daemon's `pair.Encode` does: JSON → URL-safe, no-pad base64url (the
 *  strict alphabet parsePairingPayload requires). Copied from #94; there is no `pyry://` wrapper. */
function encodePairingPayload(qr: QrPayload): string {
  return Buffer.from(JSON.stringify(qr), 'utf-8').toString('base64url')
}

/** Resolve an executable on PATH, returning its absolute path or null. */
function resolveOnPath(bin: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    const full = join(dir, bin)
    try {
      accessSync(full, constants.X_OK)
      return full
    } catch {
      // not here — keep scanning
    }
  }
  return null
}

/** Resolve `pyry`: the PYRY_BIN override (verified executable) else PATH. Null when unavailable. */
function resolvePyryBin(): string | null {
  const override = process.env.PYRY_BIN
  if (override !== undefined && override !== '') {
    try {
      accessSync(override, constants.X_OK)
      return override
    } catch {
      return null
    }
  }
  return resolveOnPath('pyry')
}

/**
 * Run `pyry pair` under the isolated HOME + cred env and resolve its stdout. `pyry pair` is offline (no
 * control socket). Rejects on non-zero exit / launch failure / timeout — NEVER echoing stdout, which
 * carries the pairing token; only the (content-free, #62) stderr is surfaced.
 */
function runPyryPair(pyryBin: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(pyryBin, ['pair', '-pyry-name=test', '--name=realclaude-e2e'], { env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf-8')
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`pyry pair timed out after ${PAIR_TIMEOUT_MS}ms`))
    }, PAIR_TIMEOUT_MS)
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`pyry pair failed to launch: ${err.message}`))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(new Error(`pyry pair exited with code ${code ?? 'null'}; stderr:\n${stderr}`))
    })
  })
}

/** True iff `value` is a non-null, non-array object. Local so the helper narrows without a blind cast. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Scan `pyry pair` stdout for the base64url-JSON payload line and return the three credential fields.
 * Defensive (security review SHOULD FIX): tolerate non-payload lines (QR art, prose) so a format change
 * surfaces as a clear failure. NEVER echoes stdout on failure — a decodable line embeds the token.
 */
function decodePairFields(stdout: string): SpawnedDaemon['pairFields'] {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.from(trimmed, 'base64url').toString('utf-8'))
    } catch {
      continue // not the payload line
    }
    if (
      isRecord(parsed) &&
      typeof parsed.server === 'string' &&
      typeof parsed.token === 'string' &&
      typeof parsed.server_static_pubkey === 'string'
    ) {
      return {
        server: parsed.server,
        token: parsed.token,
        server_static_pubkey: parsed.server_static_pubkey
      }
    }
  }
  throw new Error('pyry pair produced no decodable pairing payload on stdout')
}

/**
 * Seed <daemonHome>/.pyry/test/ with the bootstrap session + the 'default' binding, replicating #854's
 * seedBootstrapRegistry / seedBoundConversation field-for-field (the one change: convId = 'default', not a
 * UUID). Mode 0o600, matching the Go seeds. `workdir` goes through JSON.stringify for correct escaping.
 */
async function seedRegistry(daemonHome: string, workdir: string): Promise<void> {
  const regDir = join(daemonHome, '.pyry', 'test')
  await mkdir(regDir, { recursive: true, mode: 0o700 })

  const sessionsJson =
    `{"version":1,"sessions":[{"id":"${BOOTSTRAP_UUID}","label":"",` +
    '"created_at":"2026-01-01T00:00:00Z","last_active_at":"2026-01-01T00:00:00Z",' +
    '"bootstrap":true,"lifecycle_state":"active"}]}'
  await writeFile(join(regDir, 'sessions.json'), sessionsJson, { mode: 0o600 })

  const conversationsJson =
    `{"conversations":[{"id":"${BOUND_CONVERSATION_ID}","cwd":${JSON.stringify(workdir)},` +
    `"current_session_id":"${BOOTSTRAP_UUID}","is_promoted":false,` +
    '"last_used_at":"2026-01-01T00:00:00Z"}]}'
  await writeFile(join(regDir, 'conversations.json'), conversationsJson, { mode: 0o600 })
}

/** Resolve when a unix-domain socket connect succeeds; false on any error. */
function dialUnixSocket(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(socketPath)
    const finish = (ok: boolean): void => {
      sock.removeAllListeners()
      sock.destroy()
      resolve(ok)
    }
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Block until the daemon's control socket is dialable, polling ~50ms with a cap; fail fast if the process
 * exits first (mirrors #854's waitForReady). This gates "process up"; relay registration is covered by the
 * app's Send-enabled readiness signal. On failure the daemon stderr is surfaced — safe because it is a
 * STARTUP failure (before any message flows) and the transport is content-free by construction (#62).
 * After readiness the capture stops (deterministic guard against a post-handshake tee) while the listener
 * stays attached to keep the stderr pipe drained.
 */
async function waitForDaemonReady(child: ChildProcess, socketPath: string): Promise<void> {
  let stderrBuf = ''
  let capturing = true
  child.stderr?.on('data', (chunk: Buffer) => {
    if (capturing && stderrBuf.length < 8192) stderrBuf += chunk.toString('utf-8')
  })
  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `pyry exited (code=${child.exitCode ?? 'null'}, signal=${child.signalCode ?? 'null'}) before ` +
            `its control socket became dialable; stderr:\n${stderrBuf}`
        )
      }
      if (await dialUnixSocket(socketPath)) return
      await delay(50)
    }
    throw new Error(
      `pyry control socket not dialable within ${DAEMON_READY_TIMEOUT_MS}ms; stderr:\n${stderrBuf}`
    )
  } finally {
    capturing = false
  }
}

/** Send a signal to the whole process group (negative pid), swallowing ESRCH (already dead). Teardown
 *  must not throw, so any other error is also swallowed. */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // ESRCH (already dead) or a benign teardown-time error — nothing to do.
  }
}

/**
 * Reap the daemon AND its real-claude grandchild: SIGTERM the process group → grace → SIGKILL the group if
 * it has not exited. Killing the group (negative pid, enabled by detached:true) guarantees the grandchild
 * dies even if pyry is force-killed before it can reap its own child.
 */
async function reapDaemon(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (pid === undefined) return
  if (child.exitCode !== null || child.signalCode !== null) return // already dead

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  killGroup(pid, 'SIGTERM')

  let done = false
  await Promise.race([exited.then(() => (done = true)), delay(3000)])
  if (!done && child.exitCode === null && child.signalCode === null) {
    killGroup(pid, 'SIGKILL')
    await Promise.race([exited, delay(1000)])
  }
}

/**
 * Count assistant rows whose text is non-empty once the streaming cursor ▎ is stripped. Runs in the page
 * context. Content-agnostic liveness: a naive "row exists" or unstripped-textContent check would pass on
 * an empty streaming bubble (the cursor span is inside the row).
 */
function nonEmptyAssistantCount(page: Page): Promise<number> {
  return page
    .locator(ASSISTANT_ROW)
    .evaluateAll(
      (els, cursor) =>
        els.filter((el) => (el.textContent ?? '').split(cursor).join('').trim().length > 0).length,
      CURSOR_CHAR
    )
}

test('real claude streams a reply into the thread for two consecutive sends', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // A per-run nonce so turn 2 differs from turn 1 and reruns differ (defeats any accidental reply caching),
  // never asserted on. The single-short-word phrasing (from #854) discourages tool calls without pinning
  // content — the strictly-increasing count below is robust to a tool split regardless.
  const runNonce = Date.now()
  const message = (turn: number): string => `Reply with a single short word. run=${runNonce} turn=${turn}`

  // --- Precondition (AC1): pair against the real daemon, dial the test relay's /v1/client leg. ---
  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    // The app dials this verbatim (relayConnection uses config.url unchanged); NOT pyry's emitted relay
    // (which points at prod). The loopback affordance (#97) accepts the ws://127.0.0.1 relay.
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  const pasteBox = page.locator('textarea[aria-label="Pairing code"]')
  const fingerprint = page.locator('[aria-label="Server key fingerprint"]')
  const conversation = page.locator('.conversation')
  const sendButton = page.getByRole('button', { name: 'Send' })
  const composer = page.getByPlaceholder('Message…')

  await expect(pasteBox).toBeVisible()
  await pasteBox.fill(payload)
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(fingerprint).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  // Reaching .conversation proves the pairing record persisted; Send-enabled proves the Noise handshake
  // completed and `interactive` was granted — the generous timeout absorbs real startup + a re-dial or two.
  await expect(conversation).toBeVisible()
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Turn 1 (AC2): a fresh session — proves the reply bridge binds. ---
  await composer.fill(message(1))
  await sendButton.click()
  await expect
    .poll(() => nonEmptyAssistantCount(page), {
      timeout: TURN_TIMEOUT_MS,
      message: 'turn 1: no non-empty assistant reply streamed within the timeout (the fresh-daemon deadlock #854 fixes)'
    })
    .toBeGreaterThanOrEqual(1)
  // Wait for turn 1 to fully quiesce (turn_end received → cursor cleared) before turn 2, so the turn-1/
  // turn-2 count comparison is race-free.
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- Turn 2 (AC3): the session now exists — proves the bridge survives past the first turn. ---
  const base = await nonEmptyAssistantCount(page)
  await composer.fill(message(2))
  await sendButton.click()
  await expect
    .poll(() => nonEmptyAssistantCount(page), {
      timeout: TURN_TIMEOUT_MS,
      message: 'turn 2: no additional non-empty assistant reply streamed within the timeout'
    })
    .toBeGreaterThan(base)
})
