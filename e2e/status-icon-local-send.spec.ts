import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  Envelope,
  QueuedItem,
  QueueStatePayload,
  SendMessagePayload,
  TurnStatePayload,
  WireTurnState
} from '../src/shared/wire/types'

// #1725: the local window now reads `Sending…` until a `queue_state` lists the sent `message_id`, then
// `Waiting for Claude` until the daemon's first `turn_state`; `Thinking…` comes only from the daemon. The
// staged assertions here distinguish local acceptance, queue acknowledgement and daemon activity.
//
// #1556 AC1: the snowflake turns as soon as the local label appears — on the composer's own
// accept, BEFORE any server phase — keeps turning when the daemon's first `turn_state{thinking}` arrives,
// and stops when the turn returns to idle.
//
// THIS INTERVAL IS ONLY REACHABLE HERE. The bug lives between the composer accepting a submit and the
// daemon's first `turn_state` crossing the wire, so proving it needs (a) a real send and (b) server events
// that arrive when the spec says they do. A renderer spec has neither: vitest renders through
// renderToStaticMarkup with `environment: 'node'`, so nothing in this repo can click Send (CLAUDE.md), and
// the container's running arm is unreachable under server render anyway (zustand v5 reads
// getInitialState() → phase: 'idle'). The unit specs hold the gate's own truth table; what only this tier
// can hold is that a real send reaches it with no daemon frame in between.
//
// THE FAKE NO-OPS `send_message` (queued-backlog-interrupt.spec.ts's own recorded fact), which is exactly
// what makes "delayed server events" a spec-controlled delay rather than a race: after the click NOTHING
// arrives until a pushFrame below, so step 2 measures the pre-response interval with no timing assumption.
// Never assert on an elapsed duration or a frame here — the assertions are class presence and label text,
// both discrete.
//
// THE CONTROL ARM IS STEP 1, and it is load-bearing for the same reason the reduced-motion spec's is: a
// suite that only ever asserts the spinning class PRESENT would pass against an icon that spins
// unconditionally, which is a different bug with the same green. Step 4 closes the other end — the class
// must come back OFF at idle, or "it spins now" would be indistinguishable from "it never stops".
//
// AC2's reduced-motion and stop-eligibility halves are NOT re-proven here. Reduced motion keys on the same
// class this widens the emission of and is held by e2e/composer-status-reduced-motion.spec.ts; stop and Esc
// eligibility read `isTurnRunning(phase)` alone, untouched by this ticket, and their own specs cover them.
//
// SECRET HYGIENE (carried from the siblings): every assertion reads a class or visible label text. The
// message text below is a spec-owned display literal; the pairing plumbing lives in launchPairedApp and is
// never echoed. No failure diagnostic serialises a token, key or plaintext.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process; the siblings' headroom
// over Playwright's 5s default covers a cold runner.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The message the operator sends. Its only job is to be accepted by the composer, which is what opens the
// local window (#650) this ticket wires the icon to.
const SENT_TEXT = 'A message whose reply has not started yet'

// The coarse turn-phase scalar. A spec-local copy, as composer-status-reduced-motion.spec.ts and
// stall-bundle.spec.ts each keep — the shipped convention; extracting a shared helper is a wider refactor
// than this ticket. timelineBridge drops turn_state's conversation_id (ADR 0004), so the id is not a gate
// here, but it carries SEEDED_ROW.id for realism as the siblings do.
function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })
}

// A replacement-truth queue snapshot for the seeded conversation (queued-backlog-interrupt.spec.ts's shape).
function queueStateFrame(items: readonly QueuedItem[]): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'queue_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, queued: [...items] } satisfies QueueStatePayload
  })
}

function queuedItem(message_id: string, text = SENT_TEXT): QueuedItem {
  return { queued_msg_id: 1, text, ts: FIXED_TS, message_id }
}

// Captures every outbound envelope so the spec can read back the `message_id` the composer minted; only
// list_conversations needs a reply (the seeded launch row).
function capturingFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    return env.type === 'list_conversations' ? [seedConversationsFrame()] : []
  }
}

function sentMessageId(captured: Envelope[]): string | undefined {
  const frame = captured.find(
    (e) => e.type === 'send_message' && (e.payload as SendMessagePayload).text === SENT_TEXT
  )
  return frame === undefined ? undefined : (frame.payload as SendMessagePayload).message_id
}

test('the status row reads Sending, then Waiting for Claude, then Thinking, with the icon turning throughout', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: capturingFake(captured) })

  const icon = page.locator('.composer-status__icon')
  const spinningIcon = page.locator('.composer-status__icon--spinning')
  const label = page.locator('.composer-status__label')

  // --- 1. The control arm: the row mounts idle, the mark is there and still ---
  await expect(icon).toBeVisible()
  await expect(spinningIcon).toHaveCount(0)
  await expect(label).toHaveCount(0)

  // --- 2. AC1, the interval this ticket exists for: a real send, and NO server frame ---
  // The fake no-ops send_message, so between this click and step 3 the daemon says nothing at all. Both
  // assertions are the point: the label appearing is #650's shipped behaviour, the mark turning beside it
  // is this ticket's. Asserting the label too is what stops step 3 from being credited with step 2's work.
  await page.getByPlaceholder('Message…').fill(SENT_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(label).toHaveText('Sending…', { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(spinningIcon).toBeVisible()
  await expect
    .poll(() => sentMessageId(captured), { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual(expect.any(String))
  const messageId = sentMessageId(captured) ?? ''

  // --- #1725 AC4: another device's item and an id-less item do not advance the label ---
  // The two queued rows drawing is what proves the snapshot was applied before the label is read.
  const queuedRows = page.locator('[data-thread-role="queued"]')
  daemon.pushFrame(queueStateFrame([
    queuedItem('another-device-id', 'Queued from another device'),
    queuedItem('', 'Queued with no id')
  ]))
  await expect(queuedRows).toHaveCount(2, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(label).toHaveText('Sending…')

  // --- #1725 AC1: the daemon lists the sent id, so it holds the message ---
  daemon.pushFrame(queueStateFrame([queuedItem(messageId)]))
  await expect(label).toHaveText('Waiting for Claude', { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(spinningIcon).toBeVisible()

  // Claude commits the item before its first turn_state: the snapshot empties and the label stays.
  daemon.pushFrame(queueStateFrame([]))
  await expect(queuedRows).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(label).toHaveText('Waiting for Claude')
  await expect(spinningIcon).toBeVisible()

  // --- 3. #1725 AC2: Thinking only from the daemon's turn_state{thinking}; the mark keeps turning ---
  daemon.pushFrame(turnStateFrame('thinking'))
  await expect(label).toHaveText('Thinking…', { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(spinningIcon).toBeVisible()

  // --- 4. AC1, the other end: idle stops it, and the mark stays on screen ---
  // Both halves, for ComposerStatusArea's own reason: a lone absent-modifier assertion passes vacuously
  // against a row that lost its icon entirely, and AC2's still-rendered posture is what the row is for.
  daemon.pushFrame(turnStateFrame('idle'))
  await expect(spinningIcon).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(icon).toBeVisible()
  await expect(label).toHaveCount(0)

  // A session failure can also arrive before the queue acknowledgement.
  await page.getByPlaceholder('Message…').fill('A second locally accepted message')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(label).toHaveText('Sending…')
  await expect(spinningIcon).toBeVisible()
  daemon.pushFrame(encodeEnvelope({ id: REPLY_ENVELOPE_ID, type: 'session_error', ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, code: 'session.blocked', message: 'Ignored daemon text' } }))
  await expect(page.locator('.top-overlay-pill--error')).toHaveText(
    'Claude did not pick up your last message. It was not delivered.')
  await expect(label).toHaveCount(0)
  await expect(spinningIcon).toHaveCount(0)
  await expect(icon).toBeVisible()
})
