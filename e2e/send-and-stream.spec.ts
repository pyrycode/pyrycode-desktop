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
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import { LOOPBACK_RELAY_ENV_FLAG } from '../src/main/relayPolicy'
import { TEST_SECRET_BACKEND_ENV_FLAG } from '../src/main/secretBackend'
import type {
  AssistantDeltaPayload,
  ConversationSummary,
  ConversationsPayload,
  QrPayload,
  TurnEndPayload
} from '../src/shared/wire/types'

// The UI-level send→stream e2e scenario (#94) — the automated side of the Phase-1 milestone round-trip
// (the manual live-stack version is runbook #13). It picks up where #93 (pair-to-conversation.spec.ts)
// stops — the *built* app connected to the in-process fake relay forwarder (#90) + fake Noise_IK daemon
// (#91) with Send enabled — types a message into the composer, sends, and asserts BOTH the optimistic
// user bubble and the streamed daemon reply render in the thread. It exercises the full path composer →
// command channel → main-process outbound send → fake daemon → inbound decode → daemon-event channel →
// timelineStore → ConversationScreen render, against real product markup (no test-only hooks).
//
// The harness is #93's, reused: the file-local forwarder/daemon/page fixtures (the shared electronApp.ts
// stays scenario-agnostic per #40), the two `app.isPackaged`-gated dev affordances it consumes without
// relaxing — #97 (loopback ws:// relay) + #99 (keychain-free secret backend) — the synthetic pairing
// token, and the isolated `--user-data-dir` for a guaranteed-unpaired start. Each Playwright spec
// launches its own app instance (workers:1, serialized), so this re-runs the real pairing flow rather
// than sharing #93's process; the reuse is the harness pattern, not a running app. #94's `buildReplyFrames`
// below adds the `send_message` → [assistant_delta, turn_end] stream on top of #93's list-seeding reply.
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

// The daemon's structured reply to a `send_message` — the v2 interactive stream (#199), NOT the coarse
// `message` fan-out that #179 retired. Assistant text now renders ONLY via `assistant_delta` (a coarse
// `message` decodes to a `messageReceived` sessionStore write the timeline never renders — pyrycode #699).
// Two frames, streamed in order: an `assistant_delta` carrying the whole REPLY_TEXT (→ an `assistantText`
// timeline item, `.bubble[data-thread-role="assistant"]`), then a `turn_end` closing the turn (→ a
// `turnBoundary`, which drops the streaming cursor off the bubble so its text is EXACTLY REPLY_TEXT — an
// assistant_delta alone leaves a trailing ▎ that fails toHaveText). Fixed literals keep the assertion
// deterministic; the decoded fields (turn_id, seq, stop_reason) are not inspected, and conversation_id is
// dropped by the transport (the timeline is conversation_id-free, ADR 0004).
const REPLY_TEXT = 'streamed reply from the fake daemon'
const FIXED_TS = '2026-07-07T12:00:00.000Z'
const TURN_ID = 'turn-1'
const assistantDeltaFrame = (): Uint8Array =>
  encodeEnvelope({
    id: 99,
    type: 'assistant_delta',
    ts: FIXED_TS,
    payload: {
      conversation_id: 'default',
      turn_id: TURN_ID,
      seq: 0,
      text: REPLY_TEXT
    } satisfies AssistantDeltaPayload
  })
const turnEndFrame = (): Uint8Array =>
  encodeEnvelope({
    id: 100,
    type: 'turn_end',
    ts: FIXED_TS,
    payload: {
      conversation_id: 'default',
      turn_id: TURN_ID,
      stop_reason: 'end_turn'
    } satisfies TurnEndPayload
  })

// #140: pairing now lands on the ChannelList (route='list'), so this scenario must drive one real
// list→thread step (a row click) before `.conversation` mounts. Seed a one-row `conversations` reply so
// ChannelList has a clickable row. The row renders only after the handshake completes (ConversationList-
// Data auto-fires `list_conversations` on the connected edge), so the row's auto-wait is the connected
// gate. Fixed literals only — deterministic, non-secret display text; `id`/`ts` are structurally
// required by decodeEnvelope but never inspected by the drive.
const SEEDED_ROW: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded discussion',
  is_promoted: false,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: FIXED_TS,
  last_used_at: FIXED_TS
}
const conversationsSeed = (): Uint8Array =>
  encodeEnvelope({
    id: 1,
    type: 'conversations',
    ts: FIXED_TS,
    payload: { conversations: [SEEDED_ROW] } satisfies ConversationsPayload
  })

// One buildReplyFrames dispatching on the decoded inbound type: `send_message` → the ordered
// [assistant_delta, turn_end] stream (the daemon-bubble assertion); every other inbound (the auto-fired
// `list_conversations`, plus any later non-send frame) → the idempotent one-row seed. buildReplyFrames
// (not buildReply) because the send reply is a MULTI-frame stream — the fake seals each frame as its own
// noise_msg and streams them in order. The `default` arm — not an explicit `list_conversations` case —
// mirrors constant-reply-with-dedup robustness: only `send_message` must be explicit, so a regression to
// echoing it (the default-echo trap) still fails the daemon-bubble assertion. The seed answering a
// non-`list_conversations` frame is harmless (each bridge filters to its own arm); a stateful,
// type-faithful reply table is #434's job, not this drive-enabling fake's.
const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  switch (decodeEnvelope(inbound).type) {
    case 'send_message':
      return [assistantDeltaFrame(), turnEndFrame()]
    default:
      return [conversationsSeed()]
  }
}

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
    // Pass the dispatching buildReplyFrames: it seeds the one-row conversation list (the list→thread
    // gate, like #93) AND streams the [assistant_delta, turn_end] reply on `send_message` (the
    // daemon-bubble assertion). buildReplyFrames takes precedence over buildReply for every inbound.
    const d = await startFakeDaemon({ url: forwarder.url, buildReplyFrames })
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

  // #140: pairing lands on the ChannelList (route='list'), not the conversation screen. Drive the one
  // real list→thread step — click the seeded row (AC3: a real `.channel-list__row-open` product button,
  // not a test hook / forced dispatch / store mutation). The row renders only after the handshake
  // completes (requestConversations fires on the connected edge → the one-row `conversations` reply
  // arrives), so this row-click auto-wait IS the connected gate.
  await page.locator('.channel-list__row-open').click()
  await expect(conversation).toBeVisible()

  // Send is gated on the `connected` daemon event, NOT on the route (reaching .conversation only proves
  // the pairing record persisted). Because the seeded row (hence the click above) could not appear
  // before `connected`, Send is already enabled here; the generous timeout is retained as headroom for a
  // cold runner. Waiting for Send-enabled is load-bearing: sending before the handshake completes hits
  // the canSend guard, drops the send, and posts no optimistic echo.
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Type + send (AC2). ---
  await page.getByPlaceholder('Message…').fill(TYPED_TEXT)
  await sendButton.click()

  // --- Optimistic user bubble (AC3): dispatched synchronously inside submitMessage, before any reply.
  // Since #179 the echo routes into the timeline as a `userText` item — `.bubble[data-thread-role="user"]`,
  // NOT the retired MessageThread's `data-message-role`. Asserted as a distinct step before the daemon
  // assertion; NOT paired with a daemon-absent check (the reply is a real round-trip that could land fast
  // — a "user present AND daemon absent" assert is racy).
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveText(TYPED_TEXT)

  // --- Streamed daemon bubble (AC4): auto-waited through the genuine handshake + Noise round-trip. The
  // assistant text renders as an `assistantText` timeline row — `.bubble[data-thread-role="assistant"]`
  // (the retired coarse `message` / `data-message-role` path no longer renders in the timeline). A
  // regression to echoing the `send_message` (the default-echo trap) decodes to no assistant_delta and
  // times out here; the [assistant_delta, turn_end] stream is the guard, and turn_end drops the streaming
  // cursor so the bubble text matches REPLY_TEXT exactly. ---
  await expect(page.locator('.bubble[data-thread-role="assistant"]')).toHaveText(REPLY_TEXT, {
    timeout: MESSAGE_TIMEOUT_MS
  })
})
