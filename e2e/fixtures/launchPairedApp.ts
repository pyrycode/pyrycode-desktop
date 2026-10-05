import {
  test as base,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  startFakeRelayForwarder,
  type FakeRelayForwarder
} from '../../src/main/transport/fakeRelayForwarder'
import type { FakeDaemon, FakeDaemonOptions } from '../../src/main/transport/fakeDaemon'
import { startFakeDaemonForTest } from './fakeDaemonSetup'
import { encodeEnvelope } from '../../src/main/transport/codec'
import { LOOPBACK_RELAY_ENV_FLAG } from '../../src/main/relayPolicy'
import { TEST_SECRET_BACKEND_ENV_FLAG } from '../../src/main/secretBackend'
import {
  attachLaunchFate,
  createLaunchFateLog,
  launchIsolatedApp,
  type TeardownStep
} from './desktopIsolation'
import { pairAnotherServerFromSettings, pairFromUnpairedLaunch } from './pairingArrival'
import type {
  ConversationSummary,
  ConversationsPayload,
  QrPayload
} from '../../src/shared/wire/types'

// The shared fake-daemon pairing harness (#433). It stands up the in-process fake relay forwarder
// (#90) + fake Noise_IK daemon (#91), launches the *built* app against them, and drives the REAL
// pairing UI through to the connected conversation thread with Send enabled — so a fake-daemon UI
// e2e spec starts at "paired, connected, on the thread, Send enabled" instead of re-transcribing the
// harness. It extracts the drive #93 (pair-to-conversation) and #94 (send-and-stream) hand-rolled;
// #435 (PR#436) repaired that drive post-#140 (the paired route enters at the ChannelList, so a real
// list→thread row click is the only path to the thread) and this fixture is its single home.
//
// It consumes two already-merged, `app.isPackaged`-gated dev affordances and relaxes NO validation
// itself: #97 (accept a loopback `ws://` relay, PYRY_ALLOW_LOOPBACK_RELAY=1) + #99 (a keychain-free
// secret backend, PYRY_TEST_SECRET_BACKEND=1). A launched-from-`.` build is `!isPackaged`, so the
// flags take effect exactly here; a packaged build never reads them.
//
// Security discipline (carried verbatim from the two specs): the pasted payload carries a SYNTHETIC
// token (never a real credential) and the fake daemon's static public key, so the handshake
// terminates at the fake. Every persisted secret lands in a throwaway per-run `--user-data-dir` that
// teardown removes. No failure diagnostic serializes the payload, token, or any plaintext — the drive
// asserts DOM visibility / enabled-state only.

// A synthetic literal, NEVER a real credential (mirrors the round-trip test's DUMMY_TOKEN). The relay
// requires a non-empty token but ignores its value under v2; the Noise static-key handshake gates.
const DUMMY_TOKEN = 'dummy-token-not-a-real-credential'

// #1091: the SECOND server pastes a DISTINCT synthetic literal. Neither is a credential and the relay
// ignores the value under v2 (the Noise static-key handshake is what gates), so this changes no
// behaviour today. It exists so that a later per-server credential-isolation assertion — "server A's
// token never reaches server B", #1152's natural territory — cannot pass vacuously against two servers
// that happened to share one literal.
const SECOND_DUMMY_TOKEN = 'second-dummy-token-not-a-real-credential'

// The two pasted `server` ids. They MUST differ, and a collision fails SILENTLY rather than loudly:
// `decodeCollection` treats a repeated `server` as a malformed collection, and a malformed collection
// collapses to the absent outcome — so the app would read as *unpaired* instead of raising. Declared
// side by side for exactly that reason. The first is the literal the pasted payload has always carried.
export const FIRST_SERVER_ID = 'fake-daemon'
export const SECOND_SERVER_ID = 'fake-daemon-2'

// Electron launch spawns the app, the fake daemon compiles the shared wasm once, and the post-confirm
// path runs a genuine Noise_IK handshake over loopback. Any spec using this fixture inherently needs
// that budget, so the fixture owns the per-test timeout (removing the boilerplate from every
// consumer); the Send-enabled wait keeps its own element-level headroom for a cold runner.
const LAUNCH_TEST_TIMEOUT_MS = 60_000
const HANDSHAKE_TIMEOUT_MS = 15_000

// #140: pairing lands on the ChannelList (route='list'), not the conversation screen — so the drive
// must cross one real list→thread step (a row click) before `.conversation` mounts. A clickable row
// exists only when the list is non-empty, so the default fake reply seeds a one-row `conversations`
// list. ConversationListData auto-fires `list_conversations` on the connected RISING EDGE, so the
// seeded row renders ONLY after the handshake completes — making the row's own auto-wait the connected
// gate (when the row is clickable, Send is already enabled). Fixed literals only, no Date.now()/
// randomness — deterministic per the fakeDaemon convention. The row's fields are non-secret display
// text; `id`/`ts` are structurally required by decodeEnvelope but never inspected by the drive.
export const SEEDED_ROW: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded discussion',
  is_promoted: false,
  is_archived: false,
  cwd: '/fake/workspace',
  workspace_label: null,
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
}

/**
 * The SECOND server's seeded row (#1091). A distinct `id` is load-bearing, not cosmetic: `ChannelList`
 * keys its rows by `c.id` alone and not by server, so two rows sharing `SEEDED_ROW`'s id would collide
 * on the React key. Its own `cwd` too, so the two servers' rows land in their own workspace groups —
 * both groups mount expanded (`defaultExpanded`), so both rows are clickable. Fixed literals only, the
 * fakeDaemon convention; the fields are non-secret display text.
 *
 * The `name` shares NO SUBSTRING with `SEEDED_ROW`'s, deliberately. Playwright's `hasText` is a
 * case-INSENSITIVE substring match, so a name like "Seeded discussion on server two" would be matched
 * by a filter for "Seeded discussion" — one server's row filter would silently select both servers'
 * rows, and the per-server specs riding this fixture (#1070, #1150, #1152) are exactly the ones that
 * filter by row name. Measured here: the first draft of #1091's own spec failed on it.
 */
export const SECOND_SEEDED_ROW: ConversationSummary = {
  id: 'seed-conversation-2',
  name: 'Server two chat',
  is_promoted: false,
  is_archived: false,
  cwd: '/fake/workspace-2',
  workspace_label: null,
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
}

/**
 * The reusable one-row `conversations` seed. The fixture's default `buildReply`; also exported so a
 * spec that scripts its own `buildReplyFrames` reuses the SAME seed on its default arm (a scripted
 * `buildReplyFrames` overrides the fixture's default `buildReply`, so that spec owns seeding the row)
 * instead of re-declaring the row.
 *
 * #1091 gave it a defaulted `row` parameter so the second server's row comes off the same builder. The
 * DEFAULT keeps every existing caller byte-identical.
 */
export function seedConversationsFrame(row: ConversationSummary = SEEDED_ROW): Uint8Array {
  return encodeEnvelope({
    id: 1,
    type: 'conversations',
    ts: '2026-07-07T12:00:00.000Z',
    payload: { conversations: [row] } satisfies ConversationsPayload
  })
}

/** Reply-scripting options passed straight through to `startFakeDaemon`. `url` is fixture-supplied
 *  (from the forwarder); everything else (`buildReply`, `buildReplyFrames`, `helloAck`, plus future
 *  daemon knobs) passes through, so a spec scripts daemon replies without editing the fixture. */
export type LaunchPairedAppOptions = Omit<FakeDaemonOptions, 'url'>

/** Launch-lifecycle control, orthogonal to the daemon-reply `options` (#466). One flag couples two
 *  inseparable behaviours: a reused *paired* dir MUST skip the pairing drive (the paste→Pair→Confirm
 *  drive would hang waiting for a pairing screen that never appears), so dir-reuse and drive-skip are
 *  one option, not two. Used only by the relaunch-persistence spec; absent = the default fresh-dir,
 *  full-drive behaviour every other consumer relies on. */
export type LaunchControl = {
  /** Install command observation before pairing or conversation activation. */
  onLaunched?: (app: ElectronApplication) => Promise<void>
  /** Return at Welcome so mounted pairing tests can control authentication delivery. */
  skipPairing?: boolean
  /** Load the window from this loopback URL through createWindow's unpackaged dev-renderer path, so a
   *  spec can run an alternate renderer build. Absent = the built `out/renderer` every other spec uses. */
  rendererUrl?: string
  /** Reuse this exact `--user-data-dir` (typically a prior launch's `userDataDir`) instead of minting a
   *  fresh throwaway. The persisted pairing blob in the dir boots the app straight to the ChannelList, so
   *  the fixture skips the pairing drive and returns at the list (no row click, no Send-enabled wait —
   *  the persisted launch-1 relay URL can't reconnect through this launch's fresh forwarder). No `rm`
   *  teardown is registered here: the minting launch already registered one, so the dir is removed
   *  exactly once, after every launch on it is closed (the end-of-test LIFO drain). */
  reuseUserDataDir?: string
  /** Type this operator host name into the pairing form's optional Host-name field before Pair (#834),
   *  so the sidebar host row renders a real name instead of the fallback word. Absent = the default: no
   *  label typed, so every other spec's sidebar keeps reading the fallback and is structurally
   *  unaffected. INERT alongside `reuseUserDataDir`, which skips the pairing drive entirely — the label
   *  would then come from whatever the reused dir already persisted. No runtime guard: the two options
   *  have no reason to be combined, and a throw here would be a new failure mode for no observed
   *  mistake. Lives on `LaunchControl` (launch lifecycle) rather than `LaunchPairedAppOptions`, which is
   *  daemon-reply knobs only. */
  hostLabel?: string
  /** Pair a SECOND fake daemon inside this SAME launch (#1091), so a spec can prove per-server
   *  behaviour. ABSENT is the default and is byte-identical to what this fixture has always done —
   *  which is what keeps the 54 spec files that import it passing with no edits. `{}` opts in with the
   *  default daemon options; a populated object scripts the second daemon's replies exactly as the
   *  top-level `options` argument scripts the first's.
   *
   *  Its second forwarder + daemon are constructed ONLY when it is present, so a default launch starts
   *  exactly what it started before. INERT alongside `reuseUserDataDir`, which returns before any
   *  pairing drive — the same posture `hostLabel` has, and for the same reason: no runtime guard for a
   *  combination no caller has reason to write. */
  secondServer?: LaunchPairedAppOptions
}

/** One fake server behind the app: the daemon to script, the forwarder whose legs it can drop or
 *  close, and the `server` id that was pasted for it — the three things a per-server spec needs, per
 *  server. One forwarder holds exactly one client leg and one server leg and `terminate()`s a second
 *  dial onto a filled slot, so a second daemon needs a second forwarder on its own ephemeral port;
 *  that is what makes `closeClientLeg` per-server by construction, with `fakeRelayForwarder.ts`
 *  unchanged. */
export type PairedServerHandle = {
  serverId: string
  daemon: FakeDaemon
  forwarder: FakeRelayForwarder
}

/** The handle a spec receives. On the default drive: the window on the connected conversation thread.
 *  On a `reuseUserDataDir` launch: the window on the ChannelList (paired-from-persistence, no live
 *  connection). Always carries the full fake-daemon control surface (`staticPublicKey`, `pushFrame`,
 *  `initiateRekey`, `whenSettled`, `close`) and the `--user-data-dir` in use, so a relaunch spec can
 *  hand launch 1's dir to launch 2. The forwarder is exposed for its leg controls — #464 is the first
 *  in-scope consumer (its Re-pair case fires `forwarder.closeClientLeg(4401)` to drive the supervised
 *  client to a terminal failure); on the default drive its client leg is live when this resolves.
 *
 *  #1091 added `servers`, the same control surface PER SERVER. `daemon` and `forwarder` are unchanged
 *  and are the FIRST server's, so nothing that reads them needs to know a second one can exist. */
export type PairedApp = {
  page: Page
  app: ElectronApplication
  daemon: FakeDaemon
  forwarder: FakeRelayForwarder
  userDataDir: string
  /** Every fake server behind this launch, in pairing order (#1091): one entry by default, two when
   *  `control.secondServer` opted a second one in. `daemon` and `forwarder` above are `servers[0]`'s
   *  and stay exactly what they were, so nothing that reads them needs to learn this member exists. */
  servers: readonly PairedServerHandle[]
}

type PairedAppFixtures = {
  launchPairedApp: (options?: LaunchPairedAppOptions, control?: LaunchControl) => Promise<PairedApp>
}

/** Encode a QrPayload the way the daemon's `pair.Encode` does: JSON → URL-safe, no-pad base64url
 *  (the strict alphabet parsePairingPayload requires). There is no `pyry://` wrapper. */
function encodePairingPayload(qr: QrPayload): string {
  return Buffer.from(JSON.stringify(qr), 'utf-8').toString('base64url')
}

/**
 * Build one server's pasted pairing code from that server's WHOLE handle (#1091), never from loose
 * values. The relay URL and the pinned static key are the two halves of one server's identity, and
 * taking both off one object makes it structurally impossible to paste daemon 1's key against
 * forwarder 2's URL — a mismatch whose only symptom would be a handshake that silently never
 * completes. Both pairings go through here.
 *
 * The fake target's coordinates flow into the app through this PASTED payload — the point of driving
 * the pairing UI — never through env. relay = the forwarder's client leg (loopback ws://, no userinfo
 * → passes #97 + the un-relaxed relay-has-credentials check); server_static_pubkey = base64-std of
 * that daemon's own 32-byte static, which `startFakeDaemon` generates per instance from the noise-c
 * CSPRNG, so the two servers are independently pinnable.
 */
function pairingPayloadFor(server: PairedServerHandle, token: string): string {
  return encodePairingPayload({
    server: server.serverId,
    relay: `${server.forwarder.url}/v1/client`,
    token,
    server_static_pubkey: Buffer.from(server.daemon.staticPublicKey).toString('base64')
  })
}

// A FACTORY fixture, not a value fixture: each spec passes different reply options, which a plain
// value can't accept. The fixture yields a function; its epilogue (after `use`) tears down every
// resource the function created. Teardown thunks are pushed in creation order and drained LIFO,
// giving the AC2 order app.close → daemon.close → forwarder.close → rm(userDataDir): app-first so the
// supervisor can't churn-reconnect / emit a spurious `failed` when the fake target's socket drops.
// Registering each thunk as its resource comes up (not after the whole drive succeeds) keeps a
// mid-drive failure (e.g. the row click times out) from leaking resources. Each thunk is best-effort
// so one failure doesn't abort the rest of the drain; `close()` on both fakes is idempotent. The
// epilogue runs through Playwright's fixture lifecycle, so it fires on pass AND fail — no orphans.
//
// #1127: each thunk now carries a fixed-literal STEP LABEL, because "best-effort" used to mean the drain
// left no trace of what failed — and a failed `app.close()` under `workers: 1` leaks an Electron process
// into the next spec's launch. The catch stays BINDINGLESS on purpose: an Electron close error can carry
// the launch argv, which embeds `--user-data-dir=<path>`, so the label is what gets recorded and the
// error is never in scope. The drain's contract is unchanged — one failing step still does not abort the
// rest of the LIFO drain.
//
// #1091: with a second server opted in, the drain order becomes app → daemon 2 → forwarder 2 → daemon 1
// → forwarder 1 → user-data-dir. That falls straight out of the push order, because BOTH fake servers
// are started before `launchIsolatedApp` — see `startFakeServer`'s call sites.
export const test = base.extend<PairedAppFixtures>({
  launchPairedApp: async ({}, use, testInfo) => {
    testInfo.setTimeout(LAUNCH_TEST_TIMEOUT_MS)
    const fate = createLaunchFateLog()
    const teardown: Array<{ step: TeardownStep; run: () => Promise<void> }> = []

    await use(async (options = {}, control = {}) => {
      // Isolated `--user-data-dir`. Default: `mkdtemp` a fresh throwaway for a guaranteed-unpaired start
      // (the launch-time pairing-status query resolves `not-paired`, so the router shows the pairing
      // screen) and to keep every persisted secret out of the developer's real userData. A `rm` teardown
      // is registered so the dir is removed once. Reuse (#466): launch against the caller's dir and do
      // NOT register a second `rm` — the minting launch's `rm` (pushed first, drained last) removes the
      // dir exactly once, after every launch on it has closed.
      const reuseUserDataDir = control.reuseUserDataDir
      const userDataDir = reuseUserDataDir ?? (await mkdtemp(join(tmpdir(), 'pyry-e2e-')))
      if (reuseUserDataDir === undefined) {
        teardown.push({
          step: 'user-data-dir',
          run: () => rm(userDataDir, { recursive: true, force: true })
        })
      }

      // One fake server: its own forwarder on its own ephemeral port, and a daemon dialled onto that
      // forwarder's `/v1/server` leg. Both servers go through here, so the two are constructed
      // identically and the drain order falls out of the CALL order — each thunk is pushed as its
      // resource comes up, never after the drive succeeds, so a mid-drive failure leaks nothing.
      //
      // Default `buildReply` seeds the one-row list so the list→thread path exists with the spec
      // supplying nothing. `...options` spreads AFTER, so a caller's `buildReply`/`buildReplyFrames`
      // wins; because fakeDaemon prefers `buildReplyFrames`, a spec that scripts frames owns seeding
      // its own default arm via the exported seedConversationsFrame(). The `/v1/server` leg is OPEN
      // when this resolves, so the client's msg1 (dialed only after Confirm) is never dropped.
      const startFakeServer = async (
        serverId: string,
        serverOptions: LaunchPairedAppOptions,
        steps: { forwarder: TeardownStep; daemon: TeardownStep }
      ): Promise<PairedServerHandle> => {
        const forwarder = await startFakeRelayForwarder()
        teardown.push({ step: steps.forwarder, run: () => forwarder.close() })
        const daemon = await startFakeDaemonForTest({
          url: forwarder.url,
          buildReply: () => seedConversationsFrame(
            serverId === SECOND_SERVER_ID ? SECOND_SEEDED_ROW : SEEDED_ROW
          ),
          ...serverOptions
        })
        teardown.push({ step: steps.daemon, run: () => daemon.close() })
        return { serverId, daemon, forwarder }
      }

      const first = await startFakeServer(FIRST_SERVER_ID, options, {
        forwarder: 'forwarder',
        daemon: 'daemon'
      })
      // #1091: the second server starts HERE, before the launch, even though its coordinates are only
      // pasted much further down. Nothing forces it to start late, and starting it early buys two
      // things. The drain order stays app-first (app → daemon 2 → forwarder 2 → daemon 1 → forwarder 1
      // → user-data-dir), so the supervisor cannot churn-reconnect or emit a spurious `failed` when a
      // fake target's socket drops. And its `/v1/server` leg is open long before its client leg dials,
      // so its msg1 is never dropped — the same reason the first daemon starts before the launch.
      const second =
        control.secondServer === undefined
          ? null
          : await startFakeServer(SECOND_SERVER_ID, control.secondServer, {
              forwarder: 'forwarder-2',
              daemon: 'daemon-2'
            })
      const servers = second === null ? [first] : [first, second]
      const { daemon, forwarder } = first

      // Mirror electronApp.ts's hardening: `args: ['.']` launches the built app (package.json `main`),
      // stripping ELECTRON_RENDERER_URL keeps createWindow on the built-renderer path. Plus the two
      // isPackaged-gated dev flags and the isolated user-data dir.
      const env = { ...process.env }
      delete env.ELECTRON_RENDERER_URL
      if (control.rendererUrl !== undefined) env.ELECTRON_RENDERER_URL = control.rendererUrl
      env[LOOPBACK_RELAY_ENV_FLAG] = '1'
      env[TEST_SECRET_BACKEND_ENV_FLAG] = '1'
      // #1067: through the shared launch, not `electron.launch` directly — it adds the desktop isolation
      // (renderer-throttling switches + the third isPackaged-gated dev flag, which keeps the window
      // hidden) that this fixture's 48 spec files all need and none should re-derive. Everything above
      // stays here: the scenario's env and its per-run user-data dir are this fixture's business.
      const app = await launchIsolatedApp({
        args: ['.', `--user-data-dir=${userDataDir}`],
        env,
        fate
      })
      // #1127: `fate.closeWatched` replaces `app.close()` and owns the one ordering that yields a
      // readable fate — liveness read before the close, exit code after it. It propagates a close
      // failure, so the drain below records it under this thunk's label exactly like any other step.
      teardown.push({ step: 'app', run: () => fate.closeWatched(app) })

      await control.onLaunched?.(app)
      const page = await app.firstWindow()

      // Reuse (#466): the persisted pairing blob in the reused dir routes the app straight to the
      // ChannelList at mount (App.tsx → routeForStatus reads the persisted pairing record, not the Noise
      // handshake). Skip the pairing drive — it would hang waiting for a pairing screen that never
      // appears — and return at the list. NO row click and NO Send-enabled wait: the persisted launch-1
      // relay URL can't reconnect through this launch's fresh forwarder, so `connected` may never fire;
      // waiting for Send would hang. The forwarder + daemon are still started above (kept unconditional
      // so `PairedApp.daemon` stays a non-optional `FakeDaemon`), but are vestigial on this launch —
      // and so is a `control.secondServer` combined with this flag, which returns before any pairing
      // drive. No runtime guard: the two options have no reason to be combined, and a throw would be a
      // new failure mode for no observed mistake (the `hostLabel` posture).
      if (reuseUserDataDir !== undefined) {
        await expect(page.locator('section[aria-label="Conversations"]')).toBeVisible()
        return { page, app, daemon, forwarder, userDataDir, servers }
      }

      // --- Drive the real pairing UI → the connected conversation thread. The pairing drive itself is
      // the shared arrival step (#661, ./pairingArrival) — the one place #662 edited when the unpaired
      // entry point moved behind the welcome screen; the navigation selectors below live here, per-flow
      // assertion selectors stay in the specs. ---
      //
      // `control.hostLabel` is undefined for every caller but #834's spec, and the arrival step's third
      // parameter is optional — so the default drive is byte-identical to what it was.
      if (control.skipPairing) return { page, app, daemon, forwarder, userDataDir, servers }
      await pairFromUnpairedLaunch(page, pairingPayloadFor(first, DUMMY_TOKEN), control.hostLabel)

      // #140: the paired route enters at the ChannelList — drive the one real list→thread step by
      // clicking the seeded row. This is a REAL product-UI navigation (`.channel-list__row-open`,
      // onClick → dispatch `open` → route 'thread'), never a test hook / forced route dispatch /
      // store mutation. The seeded row renders only after the handshake completes (requestConversations
      // fires on the connected edge → the one-row `conversations` reply arrives), so this click's
      // auto-wait IS the connected gate.
      //
      // #1091: this locator is UNFILTERED and runs in Playwright strict mode, which is why the second
      // pairing below happens strictly after it — a second row existing at this moment would break the
      // click outright. (#1070's AC5 protects the same locator.)
      await page.locator('.channel-list__row-open').click()

      // Send enables ONLY on the `connected` daemon event — after the real Noise_IK handshake
      // terminates at the fake. This is the fixture's completion signal; it resolves here. Because the
      // seeded row (hence the click above) could not appear before `connected`, Send is already
      // enabled; the generous timeout is headroom for a cold runner.
      await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({
        timeout: HANDSHAKE_TIMEOUT_MS
      })

      // --- #1091: the SECOND pairing, inside this same launch. `src/main/index.ts` wires
      // `onPaired: () => registry.reconcile()`, and reconcile re-reads the store and dials the
      // connection it builds for the new record — so no relaunch is needed between the two pairings.
      // Driven through the real product UI (gear → "Pair another server" → paste → Pair → Confirm),
      // never a test hook, a forced route dispatch or a store mutation. ---
      if (second !== null) {
        await pairAnotherServerFromSettings(page, pairingPayloadFor(second, SECOND_DUMMY_TOKEN))

        // Post-Confirm the shell routes to the NEW server's list (onPairServerPaired →
        // navigateToNewServerList). #1141 established that pairing another server clears nothing the
        // first pairing's session put in place, so the first server's row is still standing here.
        await expect(page.locator('section[aria-label="Conversations"]')).toBeVisible()

        // The addressed connection request must earn this row from the second transport.
        // No unsolicited seed push: a missing request now fails the fixture's connected gate.
        await expect(page.locator('.channel-list__row-open')).toHaveCount(2, {
          timeout: HANDSHAKE_TIMEOUT_MS
        })
      }

      return { page, app, daemon, forwarder, userDataDir, servers }
    })

    for (const { step, run } of teardown.reverse()) {
      try {
        await run()
      } catch {
        // Best-effort: one failing teardown must not abort the rest of the LIFO drain. Bindingless —
        // the error can carry the launch argv, so only the fixed step label is recorded.
        fate.recordTeardownFailure(step)
      }
    }

    // Last, after the drain: the exit codes only settle once the closes have run.
    //
    // #1202: this attaches UNCONDITIONALLY now. It used to gate on `testInfo.status`, and this epilogue
    // is exactly where that gate is unsound — the status here is not the test's final one, so a failure
    // established after this point (a teardown that drains later, or an unhandled `socket hang up` the
    // worker attributes to the still-open test) left the red carrying no diagnostic at all. Which is the
    // bug #1202 fixed. A green run's terminal output is still unchanged: Playwright prints an attachment
    // only inside a failing result's block.
    await attachLaunchFate(testInfo, fate)
  }
})

export { expect }
