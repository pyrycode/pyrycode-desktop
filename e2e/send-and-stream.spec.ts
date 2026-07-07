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
import { encodeEnvelope } from '../src/main/transport/codec'
import { LOOPBACK_RELAY_ENV_FLAG } from '../src/main/relayPolicy'
import { TEST_SECRET_BACKEND_ENV_FLAG } from '../src/main/secretBackend'
import type { MessagePayload, QrPayload } from '../src/shared/wire/types'

// The UI-level send→stream e2e scenario (#94) — the automated side of the Phase-1 milestone round-trip
// (the manual live-stack version is runbook #13). It picks up where #93 (pair-to-conversation.spec.ts)
// stops — the *built* app connected to the in-process fake relay forwarder (#90) + fake Noise_IK daemon
// (#91) with Send enabled — types a message into the composer, sends, and asserts BOTH the optimistic
// user bubble and the streamed daemon reply render in the thread. It exercises the full path composer →
// command channel → main-process outbound send → fake daemon → inbound decode → daemon-event channel →
// sessionStore → ConversationScreen render, against real product markup (no test-only hooks).
//
// The harness is #93's, reused: the file-local forwarder/daemon/page fixtures (the shared electronApp.ts
// stays scenario-agnostic per #40), the two `app.isPackaged`-gated dev affordances it consumes without
// relaxing — #97 (loopback ws:// relay) + #99 (keychain-free secret backend) — the synthetic pairing
// token, and the isolated `--user-data-dir` for a guaranteed-unpaired start. Each Playwright spec
// launches its own app instance (workers:1, serialized), so this re-runs the real pairing flow rather
// than sharing #93's process; the reuse is the harness pattern, not a running app. The ONE change from
// #93's fixtures is the reply-driving `buildReply` below.
//
// TEST-ONLY: importing the permissive-`ws://` doubles + codec here keeps them out of the production
// graph, exactly as #89/#93 do. No failure diagnostic serializes the payload, token, or plaintext — the
// assertions read DOM text/visibility/enabled-state only; the typed + reply texts are non-secret literals.

// A synthetic literal, NEVER a real credential (mirrors #93 / the round-trip test's DUMMY_TOKEN). The
// relay requires a non-empty token but ignores its value under v2; the Noise static-key handshake gates.
const DUMMY_TOKEN = 'dummy-token-not-a-real-credential'

// Launch + one-time wasm compile + a genuine Noise_IK handshake over loopback, then a single sealed
// round-trip. Generous headroom keeps a cold CI runner from flaking while a genuine hang still fails
// inside the bound.
const TEST_TIMEOUT_MS = 60_000
const HANDSHAKE_TIMEOUT_MS = 15_000
// The daemon reply travels a real send→Noise→decode→render round-trip after Send is enabled; auto-waited
// with generous headroom for a cold runner.
const MESSAGE_TIMEOUT_MS = 15_000

// The one substantive addition over #93. The fake daemon's reply MUST be a `message` envelope carrying
// role 'assistant' — NOT the default verbatim echo, which re-sends the client's own `send_message` that
// parseInboundMessage deliberately ignores, so no daemon bubble would render. Mirrors the buildReply in
// daemonConnection.roundtrip.test.ts. buildReply ignores its inbound-plaintext argument; a fixed literal
// reply keeps the assertion deterministic. id/ts are structurally required but their values are not
// inspected by the daemon.
const REPLY_TEXT = 'streamed reply from the fake daemon'
const FIXED_TS = '2026-07-07T12:00:00.000Z'
const buildReply = (): Uint8Array =>
  encodeEnvelope({
    id: 99,
    type: 'message',
    ts: FIXED_TS,
    payload: {
      // 'default' matches MILESTONE_CONVERSATION_ID; selectMessages does not filter on conversation_id.
      conversation_id: 'default',
      // A fixed literal — cannot collide with the optimistic user message's crypto.randomUUID(), so both
      // survive appendUnique as two distinct bubbles.
      message_id: 'reply-1',
      role: 'assistant',
      text: REPLY_TEXT
    } satisfies MessagePayload
  })

// The typed message. A fixed literal that DIFFERS from REPLY_TEXT so the user/daemon bubble assertions
// are unambiguous by both role selector and text.
const TYPED_TEXT = 'hello from the composer'

type Fixtures = {
  forwarder: FakeRelayForwarder
  daemon: FakeDaemon
  page: Page
}

// Local fixtures (this file only — the shared electronApp.ts fixture stays scenario-agnostic per #40).
// The dependency chain forwarder → daemon → page forces LIFO teardown (page → daemon → forwarder): the
// app closes FIRST so its supervisor cannot churn-reconnect / emit a spurious `failed` when the fake
// target's socket drops — the same discipline #93 and the round-trip test enforce.
const test = base.extend<Fixtures>({
  forwarder: async ({}, use) => {
    const fwd = await startFakeRelayForwarder()
    await use(fwd)
    await fwd.close()
  },
  daemon: async ({ forwarder }, use) => {
    // The one change from #93's daemon fixture: pass the reply-driving buildReply. #93 relies on the
    // default echo because it sends no message; #94 sends one, so the daemon must return a real reply.
    const d = await startFakeDaemon({ url: forwarder.url, buildReply })
    await use(d)
    await d.close()
  },
  page: async ({ daemon }, use) => {
    // The `daemon` dependency is for teardown ordering only; its value is unused here.
    void daemon
    // Mirror electronApp.ts's hardening: `args: ['.']` launches the built app (package.json `main`), and
    // stripping ELECTRON_RENDERER_URL keeps createWindow on the built-renderer path. Plus this
    // scenario's two env flags and an isolated user-data dir for a guaranteed-unpaired start.
    const env = { ...process.env }
    delete env.ELECTRON_RENDERER_URL
    env[LOOPBACK_RELAY_ENV_FLAG] = '1'
    env[TEST_SECRET_BACKEND_ENV_FLAG] = '1'
    const userDataDir = await mkdtemp(join(tmpdir(), 'pyry-e2e-'))
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

test('send a message and see the streamed daemon reply render in the thread', async ({
  forwarder,
  daemon,
  page
}) => {
  test.setTimeout(TEST_TIMEOUT_MS)

  // --- Precondition (AC1): reach the connected conversation screen through the REAL pairing UI. This
  // block mirrors #93's steps; the fake target's coordinates flow in through the PASTED payload. ---
  const payload = encodePairingPayload({
    server: 'fake-daemon',
    relay: `${forwarder.url}/v1/client`,
    token: DUMMY_TOKEN,
    server_static_pubkey: Buffer.from(daemon.staticPublicKey).toString('base64')
  })

  const pasteBox = page.locator('textarea[aria-label="Pairing code"]')
  const fingerprint = page.locator('[aria-label="Server key fingerprint"]')
  const conversation = page.locator('.conversation')
  const sendButton = page.getByRole('button', { name: 'Send' })

  await expect(pasteBox).toBeVisible()
  await pasteBox.fill(payload)
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(fingerprint).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(conversation).toBeVisible()

  // Send is gated on the `connected` daemon event, NOT on the route (reaching .conversation only proves
  // the pairing record persisted). Waiting for Send-enabled is load-bearing: sending before the
  // handshake completes hits the canSend guard, drops the send, and posts no optimistic echo.
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Type + send (AC2). ---
  await page.getByPlaceholder('Message…').fill(TYPED_TEXT)
  await sendButton.click()

  // --- Optimistic user bubble (AC3): dispatched synchronously inside submitMessage, before any reply.
  // Asserted as a distinct step before the daemon assertion; NOT paired with a daemon-absent check (the
  // reply is a real round-trip that could land fast — a "user present AND daemon absent" assert is racy).
  await expect(page.locator('.bubble[data-message-role="user"]')).toHaveText(TYPED_TEXT)

  // --- Streamed daemon bubble (AC4): auto-waited through the genuine handshake + Noise round-trip. A
  // regression to a `send_message` reply (the default-echo trap) would make parseInboundMessage ignore
  // it and time out here — the fixed `message`/`assistant` reply is the guard. ---
  await expect(page.locator('.bubble[data-message-role="daemon"]')).toHaveText(REPLY_TEXT, {
    timeout: MESSAGE_TIMEOUT_MS
  })
})
