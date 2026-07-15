import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { AssistantDeltaPayload, TurnEndPayload } from '../src/shared/wire/types'

// The UI-level send→stream e2e scenario (#94) — the automated side of the Phase-1 milestone round-trip
// (the manual live-stack version is runbook #13). It picks up where #93 (pair-to-conversation.spec.ts)
// stops — the *built* app connected to the in-process fake relay forwarder (#90) + fake Noise_IK daemon
// (#91) with Send enabled, which the shared `launchPairedApp` fixture (#433) drives to — types a
// message into the composer, sends, and asserts BOTH the optimistic user bubble and the streamed daemon
// reply render in the thread. It exercises composer → command channel → main-process outbound send →
// fake daemon → inbound decode → daemon-event channel → timelineStore → ConversationScreen render,
// against real product markup (no test-only hooks).
//
// The launch/env/user-data-dir/pairing plumbing lives in the fixture; this spec supplies only its
// `buildReplyFrames` (the send-reply stream) and its assertions. No failure diagnostic serializes the
// payload, token, or plaintext — the assertions read DOM text/visibility/enabled-state only; the typed
// + reply texts are non-secret literals.

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

// One buildReplyFrames dispatching on the decoded inbound type: `send_message` → the ordered
// [assistant_delta, turn_end] stream (the daemon-bubble assertion); every other inbound (the auto-fired
// `list_conversations`, plus any later non-send frame) → the shared one-row seed (seedConversationsFrame
// from the fixture — the SAME row the fixture's default arm would seed, but a scripted buildReplyFrames
// overrides that default, so this spec owns seeding it). buildReplyFrames (not buildReply) because the
// send reply is a MULTI-frame stream — the fake seals each frame as its own noise_msg and streams them in
// order. The `default` arm — not an explicit `list_conversations` case — mirrors constant-reply-with-dedup
// robustness: only `send_message` must be explicit, so a regression to echoing it (the default-echo trap)
// still fails the daemon-bubble assertion.
const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  switch (decodeEnvelope(inbound).type) {
    case 'send_message':
      return [assistantDeltaFrame(), turnEndFrame()]
    default:
      return [seedConversationsFrame()]
  }
}

// The typed message. A fixed literal that DIFFERS from REPLY_TEXT so the user/daemon bubble assertions
// are unambiguous by both role selector and text.
const TYPED_TEXT = 'hello from the composer'

test('send a message and see the streamed daemon reply render in the thread', async ({
  launchPairedApp
}) => {
  // The fixture reaches "connected thread, Send enabled" through the real pairing UI, scripting the
  // daemon with this spec's send-reply stream. It returns with the composer ready.
  const { page } = await launchPairedApp({ buildReplyFrames })

  // --- Type + send (AC2). ---
  const sendButton = page.getByRole('button', { name: 'Send' })
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
