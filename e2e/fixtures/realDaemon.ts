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
} from '../../src/main/transport/fakeRoutingRelay'
import { LOOPBACK_RELAY_ENV_FLAG } from '../../src/main/relayPolicy'
import { TEST_SECRET_BACKEND_ENV_FLAG } from '../../src/main/secretBackend'
import type { QrPayload } from '../../src/shared/wire/types'

// The shared real-daemon spawn harness (#420) — extracted verbatim from real-claude.spec.ts (#252, the
// only real-stack e2e). Every future tier-2/tier-3 real-* spec (real-daemon-actions, real-claude
// interrupt/queue, permission modal) imports this instead of re-transcribing the daemon recipe. This is a
// PURE MOVE: the spawn recipe (binary resolution, skip-gating, seedRegistry, spawn args, waitForDaemonReady,
// process-group reap) is unchanged — real-claude.spec.ts staying green is the proof.
//
// It spawns a freshly-paired REAL `pyry` daemon running real claude, bridged to the built Electron window
// through #251's content-blind routing relay (startFakeRoutingRelay); the daemon sits on the relay's
// /v1/server leg, the app dials /v1/client. The fixture chain relay → daemon → page forces LIFO teardown
// (page → daemon → relay): the app closes FIRST so its supervisor cannot churn-reconnect on the daemon/relay
// drop. The daemon fixture wraps `use()` in try/finally so its detached subprocess (pyry + its real-claude
// grandchild, reaped as a process GROUP) and its two temp dirs are reaped on setup failure, test failure,
// AND success — no orphaned child, no leaked temp dir.
//
// #439 adds a claude-less spawn MODE via the `spawnClaude` option (default true = the original behavior
// described here). With `spawnClaude:false` the harness gates on the `pyry` binary ALONE — no `claude`, no
// Anthropic credential, no `.claude.json` — and points `-pyry-claude` at a harness-owned no-op placeholder
// that is never invoked (rename runs no claude turn). That is the credential-light real-daemon tier for
// registry-only actions (rename / archive / …). The `seedPromoted` option sets the seeded conversation's
// `is_promoted`. Both are additive; real-claude.spec.ts sets neither and gets the exact behavior below.
//
// SKIP-GATING: the harness must SKIP cleanly (never FAIL) on a machine without the real stack. The daemon
// fixture resolves `pyry` (always) plus `claude` / a credential (claude-spawning mode only) and calls
// testInfo.skip on any miss BEFORE creating any resource — an unrun test is the correct outcome on the
// agent machine (no daemon, no claude, no creds).
//
// SECRET HYGIENE (the source spec carries a security-sensitive label): `pyry pair` stdout carries the
// pairing token inside its payload, so it is NEVER echoed into an error — only the (content-free, #62)
// daemon stderr is surfaced, and only on a STARTUP failure before any message flows.
//
// Two `app.isPackaged`-gated dev affordances are consumed (relaxing NO validation here): #97 (accept a
// loopback `ws://` relay, PYRY_ALLOW_LOOPBACK_RELAY) + #99 (a keychain-free secret backend,
// PYRY_TEST_SECRET_BACKEND). A launched-from-`.` build is `!isPackaged`, so the flags take effect exactly
// here; a packaged build never reads them.

// --- Timeouts (harness-internal) ---------------------------------------------
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

export interface SpawnedDaemon {
  // Only the three credential fields decoded from `pyry pair` stdout. The QrPayload's `relay` is assembled
  // test-side from the #251 relay's /v1/client leg, never from pyry's output (which points at prod).
  pairFields: Pick<QrPayload, 'server' | 'token' | 'server_static_pubkey'>
}

/**
 * Additive option fixtures (#439). `spawnClaude` selects the mode: `true` (default) is the original
 * claude-spawning mode (real claude + a credential + `.claude.json`, gated on all three); `false` is the
 * credential-light claude-less mode — a real `pyry` daemon with a no-op `-pyry-claude` placeholder, gated
 * on the `pyry` binary ALONE. `seedPromoted` sets the seeded conversation's `is_promoted` (`false` default
 * = a Recent discussion; `true` = a saved Channel, which renders the Rename pencil). Kept a per-spec
 * option, not a shared default, so the sibling real-daemon-* specs (#440–#443) toggle both axes freely.
 */
export type RealDaemonOptions = {
  spawnClaude: boolean
  seedPromoted: boolean
}

export type RealDaemonFixtures = {
  relay: FakeRoutingRelay
  daemon: SpawnedDaemon
  page: Page
}

// Local fixtures (this file only — the shared electronApp.ts stays scenario-agnostic per #40). The chain
// relay → daemon → page forces LIFO teardown (page → daemon → relay): the app closes FIRST so its
// supervisor cannot churn-reconnect on the daemon/relay drop, exactly as #94 enforces. The daemon fixture
// wraps `use()` in try/finally so its subprocess + temp dirs are reaped on setup failure, test failure,
// AND success — no orphaned real-claude child, no leaked temp dir.
export const test = base.extend<RealDaemonOptions & RealDaemonFixtures>({
  // Two additive option fixtures (#439). Defaults preserve the existing behavior byte-for-byte:
  // real-claude.spec.ts sets neither, so it gets spawnClaude:true (the claude-spawning mode) and
  // seedPromoted:false (an unpromoted seeded conversation) — exactly what it consumed before.
  spawnClaude: [true, { option: true }],
  seedPromoted: [false, { option: true }],

  relay: async ({}, use) => {
    const relay = await startFakeRoutingRelay()
    await use(relay)
    await relay.close()
  },

  daemon: async ({ relay, spawnClaude, seedPromoted }, use, testInfo) => {
    // --- Skip-gating: resolve binaries + creds BEFORE creating any resource, so a skip never leaks. ---
    // `pyry` is the ONLY universal gate — both modes spawn the daemon. The claude binary, the Anthropic
    // credential, and the operator's ~/.claude.json are resolved + gated ONLY in claude-spawning mode
    // (#439): the claude-less mode runs a real daemon with no claude turn, so it must NOT skip when
    // `claude` or a credential is absent, and it seeds no `.claude.json`.
    const pyryBin = resolvePyryBin()
    testInfo.skip(
      pyryBin === null,
      'real-daemon: `pyry` not found — set PYRY_BIN or put it on PATH, built from a #820+#854-inclusive tree'
    )

    let claudeBin: string | null = null
    let claudeJsonBytes: Buffer | null = null
    if (spawnClaude) {
      claudeBin = resolveOnPath('claude')
      testInfo.skip(claudeBin === null, 'realclaude: `claude` not on PATH')

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
    }

    // testInfo.skip returns void (not `never`), so TS cannot narrow `pyryBin` away — re-assert once. Not
    // reachable: it was skip-gated above. (`throw` keeps the types honest without a blind cast.) `claudeBin`
    // is narrowed locally in the spawn-args branch below, its only consumer.
    if (pyryBin === null) {
      throw new Error('real-daemon: unreachable — pyry was skip-gated above')
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
      await seedRegistry(daemonHome, workdir, seedPromoted)

      socketDir = await mkdtemp('/tmp/pyry-sock-')
      const socketPath = join(socketDir, 'pyry.sock')

      // What `-pyry-claude` points at. Claude-spawning mode: the resolved real `claude` (narrowed here,
      // its sole consumer — no `!`). Claude-less mode (#439): a harness-owned no-op executable written
      // into daemonHome (cleaned up with it). Rename triggers no `send_message`, and the daemon spawns
      // claude lazily on the first turn, so the placeholder is never executed — it only has to be an
      // executable path accepted at flag-parse time. Pointing the flag at our own file removes any
      // dependence on the daemon's default claude resolution (which might fall back to a PATH `claude`
      // a claude-less machine lacks). The daemon is designed to accept substitutable claude binaries
      // (its own multi-session e2e uses `/bin/sleep`-style fakes as `-pyry-claude`).
      let claudeArg: string
      if (spawnClaude) {
        if (claudeBin === null) {
          throw new Error('real-daemon: unreachable — claude was skip-gated above')
        }
        claudeArg = claudeBin
      } else {
        claudeArg = join(daemonHome, 'noop-claude.sh')
        await writeFile(claudeArg, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      }

      const args = [
        `-pyry-socket=${socketPath}`,
        '-pyry-name=test',
        `-pyry-claude=${claudeArg}`,
        '-pyry-idle-timeout=0',
        `-pyry-workdir=${workdir}`,
        // #251's relay identifies the daemon leg by the PATH /v1/server (NOT /v2/server, a Go-fake
        // convention its legFor() would reject). The daemon preserves an explicit relay path verbatim.
        `-pyry-relay=${relay.url}/v1/server`,
        // The post-`--` claude flags run only in claude-spawning mode. Claude-less mode omits them: no
        // claude turn ever runs, and the daemon appends `--session-id <uuid>` regardless.
        ...(spawnClaude ? ['--', '--model', 'haiku', '--dangerously-skip-permissions'] : [])
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
export function encodePairingPayload(qr: QrPayload): string {
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
 * seedBootstrapRegistry / seedBoundConversation field-for-field (the changes: convId = 'default', not a
 * UUID; `is_promoted` is the #439 `isPromoted` param, not a hardcoded false). Mode 0o600, matching the Go
 * seeds. `workdir` goes through JSON.stringify for correct escaping.
 */
async function seedRegistry(
  daemonHome: string,
  workdir: string,
  isPromoted: boolean
): Promise<void> {
  const regDir = join(daemonHome, '.pyry', 'test')
  await mkdir(regDir, { recursive: true, mode: 0o700 })

  const sessionsJson =
    `{"version":1,"sessions":[{"id":"${BOOTSTRAP_UUID}","label":"",` +
    '"created_at":"2026-01-01T00:00:00Z","last_active_at":"2026-01-01T00:00:00Z",' +
    '"bootstrap":true,"lifecycle_state":"active"}]}'
  await writeFile(join(regDir, 'sessions.json'), sessionsJson, { mode: 0o600 })

  const conversationsJson =
    `{"conversations":[{"id":"${BOUND_CONVERSATION_ID}","cwd":${JSON.stringify(workdir)},` +
    `"current_session_id":"${BOOTSTRAP_UUID}","is_promoted":${isPromoted},` +
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

export { expect }
