import {
  test as base,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { electron } from './electronLaunch'
import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants, createWriteStream, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  startFakeRoutingRelay,
  type FakeRoutingRelay
} from '../../src/main/transport/fakeRoutingRelay'
import { decideCapabilityGate, readDaemonCapabilities } from './daemonCapabilityGate'
import { e2eShowsWindow, expectDesktopIsolated, RENDERER_THROTTLING_SWITCHES } from './desktopIsolation'
import { HIDDEN_WINDOW_ENV_FLAG } from '../../src/main/windowPresentation'
import { LOOPBACK_RELAY_ENV_FLAG } from '../../src/main/relayPolicy'
import { TEST_SECRET_BACKEND_ENV_FLAG } from '../../src/main/secretBackend'
import type { QrPayload } from '../../src/shared/wire/types'

// The shared real-daemon spawn harness (#420) — extracted verbatim from real-claude.spec.ts (#252, the
// only real-stack e2e). Every future tier-2/tier-3 real-* spec (real-daemon-actions, real-claude
// interrupt/queue, permission modal) imports this instead of re-transcribing the daemon recipe. This is a
// PURE MOVE: the spawn recipe (binary resolution, skip-gating, seedRegistry, spawn args, waitForDaemonReady,
// process-group reap) was unchanged at extraction time — real-claude.spec.ts staying green is the proof.
//
// #1413 changed the setup ORDER (and only the order plus the socket contract — no spec body moved): the
// registry seed still lands before `spawn`, but the device mint now runs AFTER the daemon is up and its
// control socket is dialable, because upstream pyrycode#2393 made bare `pyry pair` a running-service
// operation that dials the selected service and has the live daemon mint. The tier therefore now requires
// a daemon carrying pyrycode#2393. See the comments at `seedRegistry`'s call, at `socketPath`, and at the
// mint itself for the three halves of that contract.
//
// It spawns a freshly-paired REAL `pyry` daemon running real claude, bridged to the built Electron window
// through #251's content-blind routing relay (startFakeRoutingRelay); the daemon sits on the relay's
// /v1/server leg, the app dials /v1/client. The fixture chain relay → daemon → page forces LIFO teardown
// (page → daemon → relay): the app closes FIRST so its supervisor cannot churn-reconnect on the daemon/relay
// drop. The daemon fixture wraps `use()` in try/finally so its detached subprocess (pyry + its real-claude
// grandchild, reaped as a process GROUP) and its temp HOME are reaped on setup failure, test failure,
// AND success — no orphaned child, no leaked temp dir.
//
// #439 adds a claude-less spawn MODE via the `spawnClaude` option (default true = the original behavior
// described here). With `spawnClaude:false` the harness gates on the `pyry` binary ALONE — no `claude`, no
// Anthropic credential, no `.claude.json` — and points `-pyry-claude` at a harness-owned no-op placeholder
// that is never invoked (rename runs no claude turn). That is the credential-light real-daemon tier for
// registry-only actions (rename / archive / …). The `seedPromoted` option sets the seeded conversation's
// `is_promoted`, and #1283's `seedCwdSubdir` moves its `cwd` a level below the daemon's own workdir. All
// are additive; real-claude.spec.ts sets none and gets the exact behavior below.
//
// SKIP-GATING: the harness must SKIP cleanly (never FAIL) on a machine without the real stack. The daemon
// fixture resolves `pyry` (always) plus `claude` / a credential (claude-spawning mode only) and calls
// testInfo.skip on any miss BEFORE creating any resource — an unrun test is the correct outcome on the
// agent machine (no daemon, no claude, no creds). #933 adds the one exception to "before any
// resource": a spec that declares `requiredCapabilities` is additionally gated on what the daemon
// ADVERTISES, which can only be read from a daemon that is already running — see the note at that
// skip. A spec declaring none never dials the probe and is gated exactly as it was.
//
// SECRET HYGIENE (the source spec carries a security-sensitive label): `pyry pair` stdout carries the
// pairing token inside its payload, so mint stdout, stderr and launch errors are NEVER echoed into
// diagnostics. Only daemon startup stderr is surfaced, before any pairing or message flows.
//
// Two `app.isPackaged`-gated dev affordances are consumed (relaxing NO validation here): #97 (accept a
// loopback `ws://` relay, PYRY_ALLOW_LOOPBACK_RELAY) + #99 (a keychain-free secret backend,
// PYRY_TEST_SECRET_BACKEND). A launched-from-`.` build is `!isPackaged`, so the flags take effect exactly
// here; a packaged build never reads them.

// --- Timeouts (harness-internal) ---------------------------------------------
// Control socket must be dialable shortly after spawn (mirrors #854's waitForReady).
const DAEMON_READY_TIMEOUT_MS = 10_000
const PAIR_TIMEOUT_MS = 15_000

// The daemon instance this fixture runs, named once (#1413). It is passed as `-pyry-name` to BOTH the
// spawn and the mint, and it is what the daemon's own resolver turns into the control-socket path
// `$HOME/.pyry/<name>.sock` and the instance registry directory `$HOME/.pyry/<name>/`. Those four uses
// were four independent 'test' literals until upstream pyrycode#2393 made the socket path load-bearing
// for the mint; drift between them IS the defect this ticket repaired, so the coupling is structural now.
const DAEMON_INSTANCE_NAME = 'test'

// The seeded bootstrap POOL id (any valid v4 shape; it only has to match between the two registry files).
// Reused from #854's liveBootstrapUUID for fidelity. Real claude still writes its transcript at its own
// minted uuid — the merged #854 PID-probe resolves the reply, so nothing extra is seeded for that.
const BOOTSTRAP_UUID = '77777777-7777-4777-8777-777777777777'
// One pre-existing conversation, bound to the seeded bootstrap session — legitimate daemon state (a
// prior discussion) that renders as a list row, giving the specs a connected-gate signal and the
// rename spec its target. Any valid v4-shaped id; it deliberately is NOT a client-known constant.
//
// #448 history: this used to be the literal 'default', seeded so the client's then-hardcoded
// placeholder conversation id would have something to land on. That accommodation converted the
// placeholder into a tested invariant and hid the bug from this gate — the operator found it live.
// Rule (posted on #448): a fixture must never seed state whose only purpose is to fit a known client
// placeholder; the daemon's reject-unknown-conversation behavior (pyrycode #678) must stay observable.
const BOUND_CONVERSATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

export interface SpawnedDaemon {
  // Only the three credential fields decoded from `pyry pair` stdout. The QrPayload's `relay` is assembled
  // test-side from the #251 relay's /v1/client leg, never from pyry's output (which points at prod).
  pairFields: Pick<QrPayload, 'server' | 'token' | 'server_static_pubkey'>
  // The daemon's canonical working directory (`-pyry-workdir`, `<daemonHome>/work`), created and reaped by the
  // fixture. Exposed (#487) so a real-claude spec can write a test-OWNED gate file into it and have claude
  // poll that file to hold a turn open deterministically — a real, ordinary tool-running turn released by a
  // filesystem event, with no `sleep`/timing race. The test and the daemon share one filesystem, so a file
  // the test writes here is visible to claude's Bash tool at that absolute path.
  workdir: string
}

/**
 * Additive option fixtures (#439). `spawnClaude` selects the mode: `true` (default) is the original
 * claude-spawning mode (real claude + a credential + `.claude.json`, gated on all three); `false` is the
 * credential-light claude-less mode — a real `pyry` daemon with a no-op `-pyry-claude` placeholder, gated
 * on the `pyry` binary ALONE. `seedPromoted` sets the seeded conversation's `is_promoted` (`false` default
 * = a Recent discussion; `true` = a saved Channel, which renders the Rename pencil). `skipPermissions`
 * (#432) gates the single post-`--` `--dangerously-skip-permissions` claude flag: `true` (default)
 * preserves the current auto-run behavior byte-for-byte; `false` (the permission-modal spec's single
 * consumer) makes a tool call BLOCK on a per-tool permission decision, which is what surfaces the
 * `modal_shown` this ticket proves live. Kept per-spec options, not shared defaults, so the sibling
 * real-* specs toggle the axes freely.
 */
export type RealDaemonOptions = {
  spawnClaude: boolean
  seedPromoted: boolean
  skipPermissions: boolean
  // #483/T9 — select the daemon's interactive runner. "" (default) writes no config file, so the
  // daemon keeps its built-in default (the PTY / terminal-driven supervisor), byte-identical to today.
  // "stream-json" routes the interactive path onto the streamsup runner, which surfaces a per-tool
  // permission prompt as an answerable modal_shown — the desktop#483 gap the PTY live-buffer path
  // cannot close. "pty" pins the default explicitly. Config-file only; the daemon has no runner flag.
  interactiveRunner: '' | 'pty' | 'stream-json'
  /** Scenario opt-in: rule offers require the daemon's stdio permission path. */
  stdioPermissionPrompt: boolean
  // #483/T9 — pair the device WITH `pyry pair --allow-remote-permissions`. The daemon fail-closes a
  // remote permission answer on the device's grant (modal_resolve_v2.go: MayAnswerRemotePermission),
  // so without it a relayed modal renders but the "allow" is denied and the turn never completes. The
  // PTY path masked this second gate by never showing the modal at all. Default false = today.
  allowRemotePermissions: boolean
  // #928 — the model claude is spawned on (`--model <value>`). The default 'haiku' is the value every
  // real-* spec has run under since #252 and is preserved byte-for-byte; only the live question round trip
  // overrides it. That spec needs a model that will actually reach for AskUserQuestion, and the ONLY model
  // under which a live call has been measured in either tree is claude-sonnet-5 (the daemon side runs both
  // its question gates under it deliberately, and records why: tool-selection reliability is worth more
  // than the token delta, because a model that will not reach for the tool DEADLINES the surface wait
  // instead of failing with a useful message). Not consumed in claude-less mode, where no post-`--` claude
  // flag is passed at all.
  claudeModel: string
  // #933 — daemon capabilities this spec REQUIRES. Default `[]` gates the spec exactly as before:
  // on the `pyry` binary alone, with no probe dialled at all. A non-empty list makes the fixture
  // read the daemon's advertised set and SKIP when one is missing — a stale daemon is an
  // environment fault (the same class as a missing credential), and only a skip routes it to the
  // operator; a failure routes it to a builder who cannot rebuild a Go binary.
  //
  // The list is advertised to the daemon verbatim, because hello_ack carries the INTERSECTION of
  // the client's advertised set with the daemon's supported one — a probe advertising nothing
  // learns nothing. See e2e/fixtures/daemonCapabilityGate.ts.
  requiredCapabilities: readonly string[]
  // #1283 — the seeded conversation's `cwd`, as a subdirectory of the daemon's own `-pyry-workdir`.
  // `''` (default) seeds `workdir` itself, byte-identical to every spec predating this option; a
  // non-empty value seeds `<workdir>/<value>` and the fixture creates that directory.
  //
  // WHY IT EXISTS. The daemon's `create_conversation` defaults a null payload `cwd` to its own
  // `-pyry-workdir`, so with the seed sitting in that same directory a create the daemon HONOURED and
  // one it IGNORED both land in the seed's workspace group — and "the new row joined that group" passes
  // either way. Moving the seed one level down makes the two outcomes render differently: an honoured
  // create keeps one workspace group, a defaulted one mints a second labelled after the workdir. That
  // is the whole non-vacuity mechanism of `real-daemon-create-channel.spec.ts`.
  //
  // A SINGLE PLAIN SEGMENT, enforced below rather than documented. The value is spec-authored constant
  // text today and the guard is what keeps it so: it makes "this can never name a directory outside the
  // daemon's workdir" structural, the same reasoning `withIsolatedElectronApp` records for taking no path
  // parameter. The character class also rejects a whitespace-only name, which would be a legal directory
  // whose group `workspaceLabelFor` labels after the WORKDIR — silently restoring the very vacuity the
  // option exists to remove.
  seedCwdSubdir: string
}

export type RealDaemonFixtures = {
  relay: FakeRoutingRelay
  daemon: SpawnedDaemon
  page: Page
}

// Local fixtures (this file only — the shared electronApp.ts stays scenario-agnostic per #40). The chain
// relay → daemon → page forces LIFO teardown (page → daemon → relay): the app closes FIRST so its
// supervisor cannot churn-reconnect on the daemon/relay drop, exactly as #94 enforces. The daemon fixture
// wraps `use()` in try/finally so its subprocess + temp HOME are reaped on setup failure, test failure,
// AND success — no orphaned real-claude child, no leaked temp dir.
export const test = base.extend<RealDaemonOptions & RealDaemonFixtures>({
  // Additive option fixtures. Defaults preserve the existing behavior byte-for-byte: real-claude.spec.ts
  // (and every sibling) sets none, so it gets spawnClaude:true (the claude-spawning mode), seedPromoted:false
  // (an unpromoted seeded conversation), and skipPermissions:true (the `--dangerously-skip-permissions` flag
  // present) — exactly the args every prior real-* spec consumed. Only #432 overrides skipPermissions:false.
  spawnClaude: [true, { option: true }],
  seedPromoted: [false, { option: true }],
  skipPermissions: [true, { option: true }],
  interactiveRunner: ['', { option: true }],
  stdioPermissionPrompt: [false, { option: true }],
  allowRemotePermissions: [false, { option: true }],
  claudeModel: ['haiku', { option: true }],
  requiredCapabilities: [[], { option: true }],
  seedCwdSubdir: ['', { option: true }],

  relay: async ({}, use) => {
    const relay = await startFakeRoutingRelay()
    // #517 consistency conversion — `close` before `use` returns on every raised path, matching `daemon`
    // below. No swallow here, deliberately: one resource means there is no drain for a throwing `finally`
    // to abort, and a fake-relay close failure is a genuine harness signal worth surfacing. This one was
    // never an orphan risk (an in-process server dies with the worker), which is why it gets no test.
    try {
      await use(relay)
    } finally {
      await relay.close()
    }
  },

  daemon: async (
    {
      relay,
      spawnClaude,
      seedPromoted,
      skipPermissions,
      interactiveRunner,
      stdioPermissionPrompt,
      allowRemotePermissions,
      claudeModel,
      requiredCapabilities,
      seedCwdSubdir
    },
    use,
    testInfo
  ) => {
    // --- #1283: validate `seedCwdSubdir` before ANYTHING, resource or skip gate. A bad value is a
    // programming error in the spec, not an environment fault, so it must FAIL loudly rather than skip —
    // and throwing here, ahead of the first `mkdtemp`, means the rejection can never strand a resource.
    // A single plain segment: no separator, no `.`/`..`, no whitespace name (see the option's docblock).
    // The message names the option and the offending segment — spec-source constant text, never a full
    // path — keeping this file's no-echo posture intact. ---
    if (
      seedCwdSubdir !== '' &&
      (!/^[A-Za-z0-9._-]+$/.test(seedCwdSubdir) || seedCwdSubdir === '.' || seedCwdSubdir === '..')
    ) {
      throw new Error(
        `real-daemon: seedCwdSubdir must be a single plain path segment matching [A-Za-z0-9._-]+, got ${JSON.stringify(seedCwdSubdir)}`
      )
    }

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
    // #1413 dropped the separate socket temp dir: the control socket now lives INSIDE daemonHome, which
    // this recursive `rm` already reaps, so tracking it separately would have been a resource nothing
    // creates. Everything this fixture makes is either the process group or a child of daemonHome.
    let daemonHome: string | null = null
    let child: ChildProcess | null = null
    const cleanup = async (): Promise<void> => {
      if (child !== null) await reapDaemon(child)
      if (daemonHome !== null) await rm(daemonHome, { recursive: true, force: true })
    }

    try {
      // Two isolations, two dirs: the daemon HOME (fresh registry + empty claude sessions dir) is separate
      // from the app's --user-data-dir (guaranteed-unpaired start, owned by the page fixture).
      //
      // A SHORT `/tmp` BASE IS MANDATORY, not cosmetic (#1413, inheriting pyrycode#860). The daemon's
      // control socket is `$HOME/.pyry/<name>.sock`, so the 104-byte macOS `sun_path` limit now binds on
      // the HOME rather than on a separate socket dir. Measured 2026-09-13: `os.tmpdir()` on this machine
      // yields an 83-byte socket path — it binds, but the margin is the machine's TMPDIR, not a property
      // of this code; `/tmp` yields 39, or 47 after macOS resolves it to `/private/tmp`.
      daemonHome = await mkdtemp('/tmp/pyry-daemon-')
      // Track the allocation before resolving it so cleanup also runs if realpath fails. Derive every
      // workspace path from the canonical home: pyry 0.27.0 canonicalises created conversation cwd.
      daemonHome = realpathSync(daemonHome)
      const workdir = join(daemonHome, 'work')
      await mkdir(workdir, { recursive: true, mode: 0o700 })
      // #1283 — where the SEEDED conversation lives, which is `workdir` itself unless a spec moved it.
      // `SpawnedDaemon.workdir` deliberately keeps meaning the daemon's `-pyry-workdir` (#487's consumer
      // writes its gate file there); only the registry row's `cwd` moves. Created HERE, immediately after
      // its parent and inside the tracked `try`, so `cleanup`'s recursive `rm` of `daemonHome` reaps it on
      // every exit path — a `mkdir` placed before `daemonHome` is assigned would leak on a raised setup.
      const seedCwd = seedCwdSubdir === '' ? workdir : join(workdir, seedCwdSubdir)
      if (seedCwd !== workdir) await mkdir(seedCwd, { recursive: true, mode: 0o700 })
      if (claudeJsonBytes !== null) {
        // Pre-trust the harness workdir in the seeded .claude.json — OPERATOR-STATE FIDELITY, not an
        // accommodation (#448's fixture rule): live, the default workspace is a folder the operator
        // trusted long ago, and without the entry claude shows the trust-folder dialog at startup,
        // which tui-driver's readiness correctly fails loudly (UnexpectedModalError, #173). The daemon
        // does NOT pre-trust interactive session workdirs today (only `pyry agent-run` calls
        // MarkWorkdirTrusted, #469) — the untrusted-cwd case is a real daemon bug (silent msgqueue
        // retry loop) tracked separately; when the daemon gains the pre-trust, this seed becomes
        // redundant but stays harmless. Key must be the REALPATH (trust.go resolves symlinks; the
        // /var/folders temp dir is a symlink to /private/var/folders on macOS).
        const trusted = JSON.parse(claudeJsonBytes.toString('utf-8')) as {
          projects?: Record<string, Record<string, unknown>>
        }
        const workdirReal = realpathSync(workdir)
        trusted.projects = trusted.projects ?? {}
        trusted.projects[workdirReal] = {
          ...(trusted.projects[workdirReal] ?? {}),
          hasTrustDialogAccepted: true
        }
        await writeFile(join(daemonHome, '.claude.json'), JSON.stringify(trusted), { mode: 0o600 })
        // Suppress the Bypass-Permissions acceptance dialog — the SECOND startup dialog an isolated
        // HOME hits (confirmed by hand 2026-07-15: a PTY claude in a fresh HOME renders "WARNING:
        // Claude Code running in Bypass Permissions mode … Yes, I accept" before anything else).
        // Operator-state fidelity again: the operator's real ~/.claude/settings.json carries
        // skipDangerousModePermissionPrompt: true, accepted long ago, and every daemon and agent
        // spawn on the host silently rides it. The daemon arguably should set this in its own
        // generated session settings (it chooses bypass mode); tracked on pyrycode#988.
        const claudeDir = join(daemonHome, '.claude')
        await mkdir(claudeDir, { recursive: true, mode: 0o700 })
        await writeFile(
          join(claudeDir, 'settings.json'),
          JSON.stringify({ skipDangerousModePermissionPrompt: true }),
          { mode: 0o600 }
        )
      }

      // #483/T9 — select the interactive runner for THIS spawned daemon. resolveConfigPath() is
      // $HOME/.pyry/config.json and HOME is daemonHome below, so a config here is the daemon's own.
      // Defaults leave the file absent. Only the permission drive enables stdio rule offers.
      if (interactiveRunner !== '' || stdioPermissionPrompt) {
        const pyryDir = join(daemonHome, '.pyry')
        await mkdir(pyryDir, { recursive: true, mode: 0o700 })
        await writeFile(
          join(pyryDir, 'config.json'),
          JSON.stringify({ ...(interactiveRunner !== '' ? { interactive_runner: interactiveRunner } : {}),
            ...(stdioPermissionPrompt ? { stdio_permission_prompt: true } : {}) }),
          { mode: 0o600 }
        )
      }

      // The isolated HOME + creds env shared by `pyry pair` and the daemon. process.env already carries
      // the credential var(s); HOME is overridden to the fresh daemon home.
      const daemonEnv: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: daemonHome,
        PYRY_ALLOW_INSECURE_RELAY: '1',
        PYRY_MOBILE_V2: '1'
      }

      // Seed the binding BEFORE spawn — and it must stay before spawn for a reason that is now DIFFERENT
      // from the mint's (#1413): the registry is read once at daemon startup with no reload, whereas the
      // device mint lands in the RUNNING daemon's own state and so must come after. Binds the seeded
      // conversation to the bootstrap pool session, so the router resolves it and the reply stream binds.
      await seedRegistry(daemonHome, seedCwd, seedPromoted)

      // Where the daemon's control socket lands. NOT passed as `-pyry-socket`: the daemon derives this
      // path from `-pyry-name`, and `pyry pair` derives its dial path from the same flag in the same
      // binary, so listen and dial agree structurally instead of by an equality this fixture asserts
      // between its own `join` and the daemon's resolver. The value is computed here for ONE purpose —
      // the readiness dial below — so a future change to the daemon's naming convention reddens as a loud
      // `waitForDaemonReady` timeout rather than as a silent mint against a socket nothing listens on.
      const socketPath = join(daemonHome, '.pyry', `${DAEMON_INSTANCE_NAME}.sock`)

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
        // No `-pyry-socket` (#1413): see socketPath above — the name alone decides where it listens.
        `-pyry-name=${DAEMON_INSTANCE_NAME}`,
        `-pyry-claude=${claudeArg}`,
        '-pyry-idle-timeout=0',
        `-pyry-workdir=${workdir}`,
        // #251's relay identifies the daemon leg by the PATH /v1/server (NOT /v2/server, a Go-fake
        // convention its legFor() would reject). The daemon preserves an explicit relay path verbatim.
        `-pyry-relay=${relay.url}/v1/server`,
        // The post-`--` claude flags run only in claude-spawning mode. Claude-less mode omits them: no
        // claude turn ever runs, and the daemon appends `--session-id <uuid>` regardless.
        // `--dangerously-skip-permissions` is gated on `skipPermissions` (#432, default true): dropping it
        // makes a tool call block on a per-tool permission decision, surfacing the `modal_shown` under test.
        // The `--model` value is `claudeModel` (#928, default 'haiku'): the flag and its position are
        // unchanged, so a spec that overrides nothing spawns the exact argv it always has.
        ...(spawnClaude
          ? [
              '--',
              '--model',
              claudeModel,
              ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
              // Operator bypass otherwise suppresses the daemon's own prompt injection.
              // Retain stdio so an in-band downgrade can ask for approval on the same child.
              ...(skipPermissions && stdioPermissionPrompt ? ['--permission-prompt-tool', 'stdio'] : [])
            ]
          : [])
      ]
      // detached: true puts pyry + its claude grandchild in one process group so teardown reaps the whole
      // group. stdout ignored; stderr piped for a startup-only, content-free diagnostic.
      child = spawn(pyryBin, args, {
        env: daemonEnv,
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })

      // Debug affordance (#448 diagnosis): PYRY_E2E_DAEMON_LOG=<path> tees the daemon's full stderr to a
      // file for the WHOLE run, not just startup. The transport is content-free by construction (#62), so
      // this leaks no message plaintext; it is opt-in and off in every gate.
      const daemonLogPath = process.env.PYRY_E2E_DAEMON_LOG
      if (daemonLogPath) {
        const daemonLog = createWriteStream(daemonLogPath, { flags: 'a' })
        child.stderr?.pipe(daemonLog)
      }

      await waitForDaemonReady(child, socketPath)

      // Mint the device credential FROM THE RUNNING DAEMON (#1413). Upstream pyrycode#2393 turned bare
      // `pyry pair` into a running-service operation: it resolves the service named by `-pyry-name`, dials
      // that service's control socket, and the live daemon mints. Before this it ran ahead of `spawn` and
      // aborted the whole tier in setup with `connect: no such file or directory`. It does NOT need the
      // relay leg up — probed 2026-09-13, the mint succeeded while the daemon was still failing to dial a
      // deliberately dead relay URL — so `waitForDaemonReady` (the control socket) is the right gate.
      //
      // A mint failure here leaves a live daemon, which the `finally` below reaps on this path exactly as
      // it does on every other: `cleanup` was registered before the `try` and `child` is already assigned.
      const pairStdout = await runPyryPair(pyryBin, daemonEnv, allowRemotePermissions, 'realclaude-e2e')
      const pairFields = decodePairFields(pairStdout)

      // --- Capability gating (#933): the ONE skip that necessarily lands AFTER resource creation.
      // Every skip above fires before anything is created, so a skip can never leak a resource. This
      // one cannot: reading what the daemon SUPPORTS requires the daemon to be running. It is safe
      // anyway — the `finally` below reaps the process group and the temp HOME on every exit path,
      // skip included — but the ordering is the exception to this file's rule, so it is stated here
      // rather than left to be rediscovered.
      //
      // No declared capabilities → no dial at all, so the nine specs predating this ticket run byte
      // for byte as they did. The decision itself is pure and unit-tested (daemonCapabilityGate);
      // the read fails closed into a skip and never throws, so it can neither fail a spec nor hang
      // the suite.
      if (requiredCapabilities.length > 0) {
        // The daemon binds a pairing to its first Noise static key. The probe has its own temporary
        // key, so it must claim a separate pairing and leave the app's pairing untouched. It answers
        // no permission prompts and needs no remote-permission grant.
        const probeFields = decodePairFields(
          await runPyryPair(pyryBin, daemonEnv, false, 'capability-probe-e2e')
        )
        const decision = decideCapabilityGate(
          requiredCapabilities,
          await readDaemonCapabilities({
            relayUrl: relay.url,
            pairFields: probeFields,
            advertise: requiredCapabilities
          })
        )
        if (decision.skip) testInfo.skip(true, decision.reason)
      }

      await use({ pairFields, workdir })
    } finally {
      await cleanup()
    }
  },

  page: async ({ daemon }, use) => {
    // `daemon` is depended on for teardown ordering only; its value is consumed in the test body.
    void daemon
    await withIsolatedElectronApp(({ page }) => use(page))
  }
})

export type IsolatedElectronApp = {
  page: Page
  app: ElectronApplication
  userDataDir: string
  relaunch(): Promise<IsolatedElectronApp>
}

/**
 * Launch the BUILT app against a throwaway `--user-data-dir`, hand the handles to `run`, and reap both.
 *
 * Verbatim from #94: `args: ['.']` launches the built app, ELECTRON_RENDERER_URL is stripped to force the
 * built-renderer path, the two `app.isPackaged`-gated dev-affordance flags are set, and userData is
 * isolated for a guaranteed-unpaired start.
 *
 * Lifted out of the `page` fixture closure by #517 so the real setup path is reachable from a test (the
 * fixture above is now a one-line delegation). It takes NO path parameter — the `rm` target is always the
 * value `mkdtemp` just returned, so this never becomes an arbitrary recursive-delete primitive.
 *
 * Both resources are reaped on EVERY raised exit path — success, `run` failing, and a setup failure raised
 * after the resource came up (#517: `firstWindow()` rejecting used to strand both). The current app is
 * registered before awaiting its window, including on relaunch. Relaunch waits for process exit before
 * reusing the same profile and environment. Nesting also gives AC2's app-close-then-
 * `rm` order for free: the inner `finally` completes before the outer one begins. NOT covered: an `await`
 * that never settles (a hung `firstWindow()`) — Playwright kills the worker without unwinding the stack,
 * so no `finally` runs. Whatever `run` or setup threw is rethrown; teardown never replaces it.
 */
export async function withIsolatedElectronApp(
  run: (handles: IsolatedElectronApp) => Promise<void>
): Promise<void> {
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL
  env[LOOPBACK_RELAY_ENV_FLAG] = '1'
  env[TEST_SECRET_BACKEND_ENV_FLAG] = '1'
  // The same desktop isolation as the default tier (#1067, #1672): the dispatcher runs this tier
  // unattended on the operator's machine, so a launch must neither show and focus a window nor be
  // throttled when the operator works in another one. The harness's show-window opt-out shows it
  // instead, for Xvfb runs where a hidden window never paints (see SHOW_WINDOW_E2E_ENV_FLAG).
  if (e2eShowsWindow()) delete env[HIDDEN_WINDOW_ENV_FLAG]
  else env[HIDDEN_WINDOW_ENV_FLAG] = '1'
  const userDataDir = await mkdtemp(join(tmpdir(), 'pyry-e2e-realclaude-'))
  let current: ElectronApplication | null = null
  let relaunching = false
  const close = async (app: ElectronApplication): Promise<void> => {
    const child = app.process()
    await app.close()
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null, {
      message: 'Electron process exited before relaunch', timeout: 15_000
    }).toBe(true)
  }
  const launch = async (): Promise<IsolatedElectronApp> => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, ...RENDERER_THROTTLING_SWITCHES.map((name) => `--${name}`)],
      env
    })
    current = app
    const page = await app.firstWindow()
    await expectDesktopIsolated(app)
    return {
      app, page, userDataDir,
      async relaunch() {
        if (current !== app || relaunching) throw new Error('restart fixture: stale app handle')
        relaunching = true
        try {
          await close(app)
          current = null
          return await launch()
        } finally {
          relaunching = false
        }
      }
    }
  }
  try {
    try {
      await run(await launch())
    } finally {
      // Best-effort, like launchPairedApp.ts's drain: a throwing `finally` would REPLACE the causal error
      // the developer needs, and would abort the unwind before the outer `rm` — leaving the
      // credential-bearing dir behind, i.e. this very bug on a narrower path. Discarded without logging:
      // a close error can carry the launch argv, which embeds `--user-data-dir=<path>`, and this file's
      // no-echo rule extends to teardown diagnostics.
      try {
        if (current !== null) await close(current)
        current = null
      } catch {
        // best-effort
      }
    }
  } finally {
    try {
      await rm(userDataDir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
}

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
 * Run `pyry pair` under the isolated HOME + cred env and resolve its stdout. Since upstream pyrycode#2393
 * this is a RUNNING-SERVICE operation, not an offline one: `-pyry-name` selects the service, the command
 * dials that service's control socket at `$HOME/.pyry/<name>.sock`, and the live daemon mints — so the
 * caller must have spawned the daemon and awaited its readiness first (#1413).
 *
 * Rejects on non-zero exit / launch failure / timeout with fixed status-only diagnostics. Drop stdout,
 * stderr and launch-error contents: the mint handles secrets, and none may reach Playwright reports.
 */
function runPyryPair(
  pyryBin: string,
  env: NodeJS.ProcessEnv,
  allowRemotePermissions: boolean,
  deviceName: 'realclaude-e2e' | 'capability-probe-e2e'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const pairArgs = ['pair', `-pyry-name=${DAEMON_INSTANCE_NAME}`, `--name=${deviceName}`]
    // #483/T9 — grant this device the remote-permission answer capability (default OFF, per #702).
    if (allowRemotePermissions) pairArgs.push('--allow-remote-permissions')
    const child = spawn(pyryBin, pairArgs, { env })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    // Drain without retaining secret-bearing subprocess diagnostics.
    child.stderr.resume()
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`pyry pair timed out after ${PAIR_TIMEOUT_MS}ms`))
    }, PAIR_TIMEOUT_MS)
    child.once('error', () => {
      clearTimeout(timer)
      reject(new Error('pyry pair failed to launch'))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(new Error(`pyry pair exited with code ${code ?? 'null'}`))
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
 * Seed <daemonHome>/.pyry/test/ with the bootstrap session + one bound conversation, replicating #854's
 * seedBootstrapRegistry / seedBoundConversation field-for-field (`is_promoted` is the #439 `isPromoted`
 * param, not a hardcoded false; the conversation id is a plain UUID — see BOUND_CONVERSATION_ID's #448
 * note). Mode 0o600, matching the Go seeds. `cwd` goes through JSON.stringify for correct escaping.
 *
 * `cwd` was the daemon's `-pyry-workdir` verbatim until #1283 gave it the `seedCwdSubdir` option; it is
 * still that directory whenever the option is left at its default. Both paths derive from the canonical
 * daemon home, matching pyry's canonicalised create cwd. The client's `groupByWorkspace` keys on the
 * supplied string, so seeding a symlink alias would split one workspace into two sidebar groups.
 */
async function seedRegistry(
  daemonHome: string,
  cwd: string,
  isPromoted: boolean
): Promise<void> {
  const regDir = join(daemonHome, '.pyry', DAEMON_INSTANCE_NAME)
  // `mode: 0o700` is LOAD-BEARING, not hygiene (#1413). The daemon refuses to start on a key directory
  // laxer than 0700 — `keys: … insecure key directory mode`, raised at relay start before it ever binds
  // its socket. This used to be incidental because the offline `pyry pair` created the directory first;
  // now this call runs before the daemon, so it is what satisfies the check. Probed by hand 2026-09-13:
  // the same spawn under a 0755 registry dir dies at startup. `recursive: true` applies the mode to
  // `.pyry` as well as to `.pyry/<name>`.
  await mkdir(regDir, { recursive: true, mode: 0o700 })

  const sessionsJson =
    `{"version":1,"sessions":[{"id":"${BOOTSTRAP_UUID}","label":"",` +
    '"created_at":"2026-01-01T00:00:00Z","last_active_at":"2026-01-01T00:00:00Z",' +
    '"bootstrap":true,"lifecycle_state":"active"}]}'
  await writeFile(join(regDir, 'sessions.json'), sessionsJson, { mode: 0o600 })

  const conversationsJson =
    `{"conversations":[{"id":"${BOUND_CONVERSATION_ID}","cwd":${JSON.stringify(cwd)},` +
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
