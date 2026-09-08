import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type {
  ThinkingProgressPayload,
  TurnEndPayload,
  TurnStatePayload,
  WireTurnState
} from '../src/shared/wire/types'

// #1314 AC4: the status row's thinking label carries the daemon's running token estimate, and it stops
// carrying it when the turn ends. This is the whole feature's only end-to-end proof — the unit specs hold
// the reducer's clear rules and the formatter's table, but nothing below the Electron launch shows that a
// `thinking_progress` frame decoded in main actually reaches that one span in the window.
//
// THE CLOSING READ IS POSITIVE, AND THAT IS THE POINT OF THE STEP ORDER. `turn_end` appends a boundary and
// deliberately does NOT reset `phase` (threadTimeline's `turnEnd` arm), so the row is still mounted and
// still showing the thinking label after it — which is what lets the last assertion read the BARE
// `Thinking…` on a live row. Pushing `turn_state{idle}` as well would unmount the label, and an absence
// check against an unmounted row passes whether the scalar cleared or not: it would be green with the
// clear rule deleted. The detector only exists in this ordering.
//
// THE THREE READINGS ARE ASSERTED ONE AT A TIME, not pushed together and read once at the end. Read once,
// the spec proves only "the last frame won" and would pass against an implementation that ignored the
// first two; stepped, it proves the label TRACKS. The values are chosen so each step also carries a fact
// the wire contract insists on:
//
//   120  — under 1000, so it renders verbatim.
//   1250 — at or above 1000, so it rounds to the nearest hundred (1300, not 1200 and not 1250).
//   640  — a DROP. The reading restarts near zero at every inference-request boundary, four times inside
//          the daemon's own single-turn capture, so going DOWN is ordinary traffic. A `Math.max` or any
//          monotonic filter would hold 1300 here, and this step is what reddens if one is ever added.
//
// Secret hygiene, carried from the siblings: every assertion reads the label's own text. The estimate is a
// side-channel on how much claude thought about private work, so it reaches no log on any path — nothing
// here writes it to the console or serialises page content into a failure diagnostic.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process; the siblings' headroom
// over Playwright's 5s default covers a cold runner.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness). A constant envelope id
// across frames matches the sibling specs; nothing on this path correlates by it.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

const TURN_ID = 'turn-1314'

function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })
}

// The id is load-bearing HERE, unlike on `turn_state` above whose conversation_id the timeline bridge
// drops: #1314 routes the reading by its own `conversation_id`, so a frame naming another conversation
// would land on that conversation's slice and never on the open one.
function thinkingProgressFrame(estimatedTokens: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'thinking_progress',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      estimated_tokens: estimatedTokens,
      // Required on the wire (no `omitempty`) and deliberately unconsumed by this client — the deltas do
      // not sum to the turn's total, so nothing accumulates them.
      estimated_tokens_delta: 64
    } satisfies ThinkingProgressPayload
  })
}

function turnEndFrame(): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_end',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: TURN_ID,
      stop_reason: 'end_turn'
    } satisfies TurnEndPayload
  })
}

test('the thinking label tracks the running token estimate and drops it at turn end', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  const label = page.locator('.composer-status__label')

  // Open a turn. The bare copy first — with no reading held the row reads exactly as it did before this
  // slice, which is AC2's other half and the baseline every step below is measured against.
  daemon.pushFrame(turnStateFrame('thinking'))
  await expect(label).toHaveText('Thinking…', { timeout: ROUNDTRIP_TIMEOUT_MS })

  // Reading one: under 1000, verbatim.
  daemon.pushFrame(thinkingProgressFrame(120))
  await expect(label).toHaveText('Thinking… ~120 tokens', { timeout: ROUNDTRIP_TIMEOUT_MS })

  // Reading two: at or above 1000, rounded to the nearest hundred.
  daemon.pushFrame(thinkingProgressFrame(1250))
  await expect(label).toHaveText('Thinking… ~1300 tokens', { timeout: ROUNDTRIP_TIMEOUT_MS })

  // Reading three: a drop. The label holds the LATEST reading, never a maximum.
  daemon.pushFrame(thinkingProgressFrame(640))
  await expect(label).toHaveText('Thinking… ~640 tokens', { timeout: ROUNDTRIP_TIMEOUT_MS })

  // The turn ends. `phase` is untouched, so the row stays mounted showing the thinking label — and it
  // reverts to the bare copy. A POSITIVE read on a live row, not an absence check against an unmounted
  // one; see the header for why that distinction is the whole detector.
  daemon.pushFrame(turnEndFrame())
  await expect(label).toHaveText('Thinking…', { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(label).toBeVisible()
})
