import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeRelayForwarder } from '../../src/main/transport/fakeRelayForwarder'
import { startFakeDaemon, type FakeDaemon, type FakeDaemonOptions } from '../../src/main/transport/fakeDaemon'
import { encodeEnvelope } from '../../src/main/transport/codec'
import { LOOPBACK_RELAY_ENV_FLAG } from '../../src/main/relayPolicy'
import { TEST_SECRET_BACKEND_ENV_FLAG } from '../../src/main/secretBackend'
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
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z'
}

/**
 * The reusable one-row `conversations` seed. The fixture's default `buildReply`; also exported so a
 * spec that scripts its own `buildReplyFrames` reuses the SAME seed on its default arm (a scripted
 * `buildReplyFrames` overrides the fixture's default `buildReply`, so that spec owns seeding the row)
 * instead of re-declaring the row.
 */
export function seedConversationsFrame(): Uint8Array {
  return encodeEnvelope({
    id: 1,
    type: 'conversations',
    ts: '2026-07-07T12:00:00.000Z',
    payload: { conversations: [SEEDED_ROW] } satisfies ConversationsPayload
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
  /** Reuse this exact `--user-data-dir` (typically a prior launch's `userDataDir`) instead of minting a
   *  fresh throwaway. The persisted pairing blob in the dir boots the app straight to the ChannelList, so
   *  the fixture skips the pairing drive and returns at the list (no row click, no Send-enabled wait —
   *  the persisted launch-1 relay URL can't reconnect through this launch's fresh forwarder). No `rm`
   *  teardown is registered here: the minting launch already registered one, so the dir is removed
   *  exactly once, after every launch on it is closed (the end-of-test LIFO drain). */
  reuseUserDataDir?: string
}

/** The handle a spec receives. On the default drive: the window on the connected conversation thread.
 *  On a `reuseUserDataDir` launch: the window on the ChannelList (paired-from-persistence, no live
 *  connection). Always carries the full fake-daemon control surface (`staticPublicKey`, `pushFrame`,
 *  `initiateRekey`, `whenSettled`, `close`) and the `--user-data-dir` in use, so a relaunch spec can
 *  hand launch 1's dir to launch 2. The forwarder is intentionally not exposed — no in-scope spec needs
 *  its leg controls. */
export type PairedApp = {
  page: Page
  app: ElectronApplication
  daemon: FakeDaemon
  userDataDir: string
}

type PairedAppFixtures = {
  launchPairedApp: (options?: LaunchPairedAppOptions, control?: LaunchControl) => Promise<PairedApp>
}

/** Encode a QrPayload the way the daemon's `pair.Encode` does: JSON → URL-safe, no-pad base64url
 *  (the strict alphabet parsePairingPayload requires). There is no `pyry://` wrapper. */
function encodePairingPayload(qr: QrPayload): string {
  return Buffer.from(JSON.stringify(qr), 'utf-8').toString('base64url')
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
export const test = base.extend<PairedAppFixtures>({
  launchPairedApp: async ({}, use, testInfo) => {
    testInfo.setTimeout(LAUNCH_TEST_TIMEOUT_MS)
    const teardown: Array<() => Promise<void>> = []

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
        teardown.push(() => rm(userDataDir, { recursive: true, force: true }))
      }

      const forwarder = await startFakeRelayForwarder()
      teardown.push(() => forwarder.close())

      // Default `buildReply` seeds the one-row list so the list→thread path exists with the spec
      // supplying nothing. `...options` spreads AFTER, so a caller's `buildReply`/`buildReplyFrames`
      // wins; because fakeDaemon prefers `buildReplyFrames`, a spec that scripts frames owns seeding
      // its own default arm via the exported seedConversationsFrame(). The `/v1/server` leg is OPEN
      // when this resolves, so the client's msg1 (dialed only after Confirm) is never dropped.
      const daemon = await startFakeDaemon({
        url: forwarder.url,
        buildReply: () => seedConversationsFrame(),
        ...options
      })
      teardown.push(() => daemon.close())

      // Mirror electronApp.ts's hardening: `args: ['.']` launches the built app (package.json `main`),
      // stripping ELECTRON_RENDERER_URL keeps createWindow on the built-renderer path. Plus the two
      // isPackaged-gated dev flags and the isolated user-data dir.
      const env = { ...process.env }
      delete env.ELECTRON_RENDERER_URL
      env[LOOPBACK_RELAY_ENV_FLAG] = '1'
      env[TEST_SECRET_BACKEND_ENV_FLAG] = '1'
      const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env })
      teardown.push(() => app.close())

      const page = await app.firstWindow()

      // Reuse (#466): the persisted pairing blob in the reused dir routes the app straight to the
      // ChannelList at mount (App.tsx → routeForStatus reads the persisted pairing record, not the Noise
      // handshake). Skip the pairing drive — it would hang waiting for a pairing screen that never
      // appears — and return at the list. NO row click and NO Send-enabled wait: the persisted launch-1
      // relay URL can't reconnect through this launch's fresh forwarder, so `connected` may never fire;
      // waiting for Send would hang. The forwarder + daemon are still started above (kept unconditional
      // so `PairedApp.daemon` stays a non-optional `FakeDaemon`), but are vestigial on this launch.
      if (reuseUserDataDir !== undefined) {
        await expect(page.locator('section[aria-label="Conversations"]')).toBeVisible()
        return { page, app, daemon, userDataDir }
      }

      // --- Drive the real pairing UI → the connected conversation thread. All pairing/navigation
      // selectors live here; per-flow assertion selectors stay in the specs. ---
      //
      // The fake target's coordinates flow into the app through the PASTED payload (the point of
      // driving the pairing UI), not through env. relay = the forwarder's client leg (loopback ws://,
      // no userinfo → passes #97 + the un-relaxed relay-has-credentials check); server_static_pubkey =
      // base64-std of the fake daemon's 32-byte static.
      const payload = encodePairingPayload({
        server: 'fake-daemon',
        relay: `${forwarder.url}/v1/client`,
        token: DUMMY_TOKEN,
        server_static_pubkey: Buffer.from(daemon.staticPublicKey).toString('base64')
      })

      const pasteBox = page.locator('textarea[aria-label="Pairing code"]')
      // Settle the pending→pairing route before pasting. `exact` on Pair avoids the busy `Pairing…`
      // label and the `Cancel` button.
      await expect(pasteBox).toBeVisible()
      await pasteBox.fill(payload)
      await page.getByRole('button', { name: 'Pair', exact: true }).click()

      // Fingerprint card proves #97 active — reached only because parsePairingPayload accepted the
      // loopback ws:// relay. Its presence is the proof; no need to compare the fingerprint text.
      await expect(page.locator('[aria-label="Server key fingerprint"]')).toBeVisible()
      await page.getByRole('button', { name: 'Confirm', exact: true }).click()

      // #140: the paired route enters at the ChannelList — drive the one real list→thread step by
      // clicking the seeded row. This is a REAL product-UI navigation (`.channel-list__row-open`,
      // onClick → dispatch `open` → route 'thread'), never a test hook / forced route dispatch /
      // store mutation. The seeded row renders only after the handshake completes (requestConversations
      // fires on the connected edge → the one-row `conversations` reply arrives), so this click's
      // auto-wait IS the connected gate.
      await page.locator('.channel-list__row-open').click()

      // Send enables ONLY on the `connected` daemon event — after the real Noise_IK handshake
      // terminates at the fake. This is the fixture's completion signal; it resolves here. Because the
      // seeded row (hence the click above) could not appear before `connected`, Send is already
      // enabled; the generous timeout is headroom for a cold runner.
      await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({
        timeout: HANDSHAKE_TIMEOUT_MS
      })

      return { page, app, daemon, userDataDir }
    })

    for (const step of teardown.reverse()) {
      try {
        await step()
      } catch {
        // Best-effort: one failing teardown must not abort the rest of the LIFO drain.
      }
    }
  }
})

export { expect }
