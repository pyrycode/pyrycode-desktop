import {
  test as base,
  expect,
  _electron as electron,
  type Page
} from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeRelayForwarder, type FakeRelayForwarder } from '../src/main/transport/fakeRelayForwarder'
import { startFakeDaemon, type FakeDaemon } from '../src/main/transport/fakeDaemon'
import { LOOPBACK_RELAY_ENV_FLAG } from '../src/main/relayPolicy'
import { TEST_SECRET_BACKEND_ENV_FLAG } from '../src/main/secretBackend'
import type { QrPayload } from '../src/shared/wire/types'

// The first UI-level e2e scenario (#93): drive the *built* app's main-process transport at a
// controllable target — the in-process fake relay forwarder (#90) + fake Noise_IK responder daemon
// (#91), the same doubles the transport-level round-trip test (#89) drives — through the REAL pairing
// screen, and assert the window advances to the conversation screen with Send enabled. No live relay,
// no real `pyry` daemon, repeatable, run by `npm run e2e`.
//
// It consumes two already-merged, `app.isPackaged`-gated dev affordances and relaxes NO validation
// itself: #97 (accept a loopback `ws://` relay, `PYRY_ALLOW_LOOPBACK_RELAY=1`) and #99 (a keychain-free
// secret backend, `PYRY_TEST_SECRET_BACKEND=1`). A launched-from-`.` build is `!isPackaged`, so the two
// flags take effect exactly here; a packaged build never reads them.
//
// The pasted payload carries a SYNTHETIC token (never a real credential) and the fake daemon's static
// public key, so the handshake terminates at the fake daemon. All persisted secrets land in a throwaway
// per-run `--user-data-dir` that teardown removes — the developer's real userData is never touched, and
// the isolated dir also guarantees a genuinely unpaired start (unlike smoke.spec.ts's shared, stale-
// pairing userData). No failure diagnostic serializes the payload or any secret — the assertions read
// DOM visibility / enabled-state only.

// A synthetic literal, NEVER a real credential (Security review: fake-target token discipline; mirrors
// the round-trip test's DUMMY_TOKEN). The relay requires a non-empty token but ignores its value under
// v2; the Noise static-key handshake is the real gate.
const DUMMY_TOKEN = 'dummy-token-not-a-real-credential'

// Electron launch spawns the app, the fake daemon compiles the shared wasm once, and the post-confirm
// path runs a genuine Noise_IK handshake over loopback — all fast, but generous headroom keeps a cold
// CI runner from flaking while a genuine hang still fails inside the bound.
const TEST_TIMEOUT_MS = 60_000
const HANDSHAKE_TIMEOUT_MS = 15_000

type Fixtures = {
  forwarder: FakeRelayForwarder
  daemon: FakeDaemon
  page: Page
}

// Local fixtures (this file only — the shared electronApp.ts fixture stays scenario-agnostic per #40).
// The dependency chain forwarder → daemon → page makes Playwright tear down LIFO (page → daemon →
// forwarder): the app closes FIRST so its supervisor cannot churn-reconnect / emit a spurious `failed`
// when the fake target's socket drops — the same discipline the round-trip test enforces with its
// reversed cleanup array. Each `use()` epilogue fires on pass *and* fail, so no process is orphaned.
const test = base.extend<Fixtures>({
  forwarder: async ({}, use) => {
    const fwd = await startFakeRelayForwarder()
    await use(fwd)
    await fwd.close()
  },
  daemon: async ({ forwarder }, use) => {
    // Default buildReply (echo) is fine — this scenario sends no message, so whenSettled stays pending
    // (settling is #94's concern). Its `/v1/server` leg is OPEN when this resolves, so the client's
    // msg1 (dialed only after confirm) is never dropped — no explicit whenReady barrier needed.
    const d = await startFakeDaemon({ url: forwarder.url })
    await use(d)
    await d.close()
  },
  page: async ({ daemon }, use) => {
    // The `daemon` dependency is for teardown ordering only; its value is unused here.
    void daemon
    // Mirror electronApp.ts's hardening: `args: ['.']` launches the built app (package.json `main`),
    // and stripping ELECTRON_RENDERER_URL keeps createWindow on the built-renderer path. Plus this
    // scenario's two env flags and an isolated user-data dir for a guaranteed-unpaired start.
    const env = { ...process.env }
    delete env.ELECTRON_RENDERER_URL
    env[LOOPBACK_RELAY_ENV_FLAG] = '1'
    env[TEST_SECRET_BACKEND_ENV_FLAG] = '1'
    const userDataDir = await mkdtemp(join(tmpdir(), 'pyry-e2e-'))
    // `--user-data-dir` is the Electron switch that overrides app.getPath('userData'); `.` stays the
    // first non-switch arg (the app path). Isolating it makes the launch-time pairing-status query
    // resolve `not-paired`, so the router shows the pairing screen (not the conversation screen).
    const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env })
    const page = await app.firstWindow()
    await use(page)
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

/** Encode a QrPayload the way the daemon's `pair.Encode` does: JSON → URL-safe, no-pad base64url
 *  (the strict alphabet parsePairingPayload requires). There is no `pyry://` wrapper. */
function encodePairingPayload(qr: QrPayload): string {
  return Buffer.from(JSON.stringify(qr), 'utf-8').toString('base64url')
}

// The submit → fingerprint step derives a BLAKE2s-256 fingerprint (src/main/pairingConfirmation.ts).
// Electron ships BoringSSL, which has NO BLAKE2 family, so driving this in the REAL Electron runtime
// was blocked on #101 (which moved that digest off node:crypto's `createHash('blake2s256')` — a
// "Digest method not supported" throw under BoringSSL — onto @noble/hashes BLAKE2s). #101 has landed
// on this branch, so the pairing UI reaches the fingerprint card and this scenario runs.
test('pair through the window against the fake target and reach the conversation screen', async ({
  forwarder,
  daemon,
  page
}) => {
  test.setTimeout(TEST_TIMEOUT_MS)

  // The fake target's coordinates flow into the app through the PASTED payload (the point of driving
  // the pairing UI), not through env. relay = the forwarder's client leg (loopback ws://, no userinfo →
  // passes #97 + the un-relaxed relay-has-credentials check); server_static_pubkey = base64-std of the
  // fake daemon's 32-byte static (identical to codec.base64StdEncode, so no codec import).
  const payload = encodePairingPayload({
    server: 'fake-daemon',
    relay: `${forwarder.url}/v1/client`,
    token: DUMMY_TOKEN,
    server_static_pubkey: Buffer.from(daemon.staticPublicKey).toString('base64')
  })

  const pasteBox = page.locator('textarea[aria-label="Pairing code"]')
  const fingerprint = page.locator('[aria-label="Server key fingerprint"]')
  const conversation = page.locator('.conversation')

  // Pre-state (AC4): on the pairing screen, conversation NOT mounted — so the later transition, not a
  // static end-state, is the evidence. Asserting the paste box first waits out the pending→pairing
  // route settle before checking conversation is absent.
  await expect(pasteBox).toBeVisible()
  await expect(conversation).toHaveCount(0)

  // Paste + submit. `exact` avoids the busy `Pairing…` label and the `Cancel` button.
  await pasteBox.fill(payload)
  await page.getByRole('button', { name: 'Pair', exact: true }).click()

  // Fingerprint card (proves #97 active): reached only because parsePairingPayload accepted the
  // loopback ws:// relay. Its presence is the proof — no need to compare the fingerprint text.
  await expect(fingerprint).toBeVisible()

  // Confirm.
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()

  // Route flip (proves #99 active + pair-through-UI works): confirm-succeeded persisted the record
  // (secureStore.set succeeded under the keychain-free backend) → App.onPaired flips to conversation.
  await expect(conversation).toBeVisible()

  // Handshake (proves Noise_IK completed): the Send button starts disabled at conversation-mount
  // (status connecting/disconnected) and enables ONLY on the `connected` daemon event, which arrives
  // only after the real handshake terminates at the fake daemon. This is the one DOM-observable
  // handshake proof — `.conversation` alone would pass even if the handshake later failed.
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })
})
