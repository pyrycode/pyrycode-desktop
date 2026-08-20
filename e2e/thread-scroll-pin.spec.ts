import type { Page } from '@playwright/test'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { AT_BOTTOM_TOLERANCE_PX } from '../src/renderer/src/screens/conversation/threadScrollPosition'
import type {
  AssistantDeltaPayload,
  SendMessagePayload,
  SessionTransitionPayload,
  ToolUsePayload,
  TurnEndPayload,
  TurnStatePayload,
  WireTurnState
} from '../src/shared/wire/types'

// The thread scroll-pin e2e (#601) — the liveness proof for "keep the thread pinned to the bottom when it
// is already at the bottom". It ships WITH the fix rather than in a follow-up because it is the only tier
// that can prove it: vitest runs the `node` environment (vitest.config.ts:27), so renderer tests are
// renderToStaticMarkup string assertions in which effects never run and no layout exists. The pure
// at-bottom arithmetic is unit-tested by threadScrollPosition.test.ts (#600); the ref, the scroll handler
// and the re-assert are untested reviewed glue, and this spec is what covers them.
//
// It drives the *built* app against the in-process fake relay forwarder (#90) + fake Noise_IK daemon (#91)
// through the shared launchPairedApp fixture (#433), and reads real scroll metrics off
// `.conversation__thread` via `evaluate` — the one tier in this repo where scrollTop / scrollHeight /
// clientHeight actually exist.
//
// AT_BOTTOM_TOLERANCE_PX is IMPORTED, never hardcoded, so the band keeps exactly one definition. That
// module has zero imports and no React or DOM reference, so it resolves under Playwright's Node transform
// with no alias config, and `e2e/` sits outside both tsconfig projects so this crosses no typecheck
// boundary. The RAW distance (scrollHeight - scrollTop - clientHeight) is asserted against it directly and
// `isAtBottom` is deliberately NOT used as the oracle: a test that transposed its own metrics would then
// agree with a production glue that transposed them identically, and the metric mapping is the one thing
// this feature can get wrong with no type error and no unit test.
//
// EVERY PUSHED FRAME IS ONE A REAL DAEMON PRODUCES (run-config-settings.spec.ts's standing rule: a
// fake-tier spec may not supply an input production does not produce). A daemon emits `tool_use` mid-turn,
// `session_transition` on a `/clear`, and `turn_state{thinking}` when a turn starts. None is a manufactured
// precondition — each is simply a different timeline or chrome mutation, which is the dimension this spec
// varies. The pin mechanism reads neither `kind` nor `items`, so what a row *renders* is a dimension it
// provably never looks at.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM geometry, text and counts
// only; the reply texts, conversation_id, turn ids, tool ids and session ids are non-secret display &
// routing literals. The pairing plumbing (synthetic token, fake static key) lives in launchPairedApp and is
// never echoed. No failure diagnostic serialises a token, key, or plaintext.

// The primer's reply travels a real send -> Noise -> decode -> render round-trip; generous headroom for a
// cold runner (the siblings' value).
const STREAM_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes
// pushes by envelope id, so one fixed id is reused across every frame.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The primer send's reply: REPLY_TURNS separate TURNS, each an assistant_delta plus its turn_end, so the
// timeline grows REPLY_TURNS distinct assistant bubbles. Separate turns rather than newlines inside one
// delta because same-turn deltas coalesce into a single bubble (threadTimeline.appendDelta), so newlines
// would grow one bubble instead of the row count this spec varies. (#607 since gave the assistant bubble
// `white-space: pre-wrap`, so a newline now does buy height — the reason above is the one that stands.)
// 20 is sized for headroom over the 1100x800 window (src/main/index.ts:37-38), not measured — if
// the thread does not overflow, the scrollHeight > clientHeight gate fails loudly, which is the gate
// working. Raise the count; never weaken the gate.
const REPLY_TURNS = 20
const replyText = (turn: number): string => `Streamed reply line ${turn}`

// Three typed messages with distinct texts. The PRIMER is the one the fake answers with the overflow
// stream; the other two are pure optimistic-echo plants (buildReplyFrames' non-primer arm below returns no
// frames), so every send is unambiguous by text as well as by order.
const PRIMER_TEXT = 'prime the thread with a long reply'
const SECOND_TEXT = 'a second message sent from the bottom'
// #602: sent while the operator is parked at the very top of the history, so the send is the only thing
// that could have brought the view back down.
const SCROLLED_UP_TEXT = 'a third message sent from far up the history'

// --- Spec-local frame builders (the seedConversationsFrame idiom): each seals one envelope through the
// production codec, deterministic id/ts. ---

const assistantDeltaFrame = (turn: number): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'assistant_delta',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: `turn-${turn}`,
      seq: 0,
      text: replyText(turn)
    } satisfies AssistantDeltaPayload
  })

const turnEndFrame = (turn: number): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_end',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: `turn-${turn}`,
      stop_reason: 'end_turn'
    } satisfies TurnEndPayload
  })

/** A pending tool call -> a `toolCall` item, rendered as `.tool-row` (a chip, not a bubble). */
const toolUseFrame = (): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'tool_use',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: 'turn-tool',
      tool_use_id: 'tool-use-1',
      name: 'read_file',
      input_summary: 'src/main/index.ts'
    } satisfies ToolUsePayload
  })

/** A `/clear` boundary -> a `sessionBoundary` item, rendered as `.session-delimiter` (no data-thread-role
 *  at all). `workspace_cwd` is literal null for `clear`, per the wire contract. NOTE there is no
 *  conversation_id on this payload — a session boundary is attributed by the connection it arrives on. */
const sessionTransitionFrame = (): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_transition',
    ts: FIXED_TS,
    payload: {
      previous_session_id: 'session-601-a',
      new_session_id: 'session-601-b',
      reason: 'clear',
      occurred_at: FIXED_TS,
      workspace_cwd: null
    } satisfies SessionTransitionPayload
  })

/** The coarse turn-phase scalar. `thinking` mounts the working indicator (and the interrupt control) —
 *  chrome BETWEEN the thread and the composer, which is what the fourth criterion is about. */
const turnStateFrame = (state: WireTurnState): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })

/**
 * One buildReplyFrames dispatching on the decoded inbound type. `send_message` -> the ordered overflow
 * stream; every other inbound (the auto-fired `list_conversations`, plus any later non-send frame) -> the
 * shared one-row seed, since a scripted buildReplyFrames overrides the fixture's default arm.
 *
 * Only the PRIMER send streams. Every other send is answered with NOTHING, on purpose: it is the userText
 * plant (the queued-backlog-interrupt idiom — the fake no-ops send_message and the optimistic echo renders
 * on its own), and a second 20-turn stream would add no coverage while racing the assertion it exists to
 * make.
 *
 * #448 regression guard, carried from send-and-stream: the send arm replies only when the inbound
 * `conversation_id` is the OPENED row's id. A client regression to a hardcoded/placeholder id gets no reply
 * frames and the stream wait times out, mirroring the real daemon's KnownConversation rejection.
 */
const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  switch (envelope.type) {
    case 'send_message': {
      const payload = envelope.payload as SendMessagePayload
      if (payload.conversation_id !== SEEDED_ROW.id) return []
      if (payload.text !== PRIMER_TEXT) return []
      return Array.from({ length: REPLY_TURNS }, (_, index) => [
        assistantDeltaFrame(index + 1),
        turnEndFrame(index + 1)
      ]).flat()
    }
    default:
      return [seedConversationsFrame()]
  }
}

interface ThreadMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

/** The three live metrics off the real scroll container — the whole reason this proof lives in e2e. */
const readThreadMetrics = (page: Page): Promise<ThreadMetrics> =>
  page.locator('.conversation__thread').evaluate((el) => ({
    scrollTop: el.scrollTop,
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight
  }))

/**
 * Drive one send whose reply overflows the thread, then assert it ACTUALLY overflows.
 *
 * The overflow gate lives here, in the shared primer, rather than being copied into each test: that makes
 * it structurally impossible for a pin assertion to run before it. It is the fifth criterion's non-vacuity
 * requirement — a thread shorter than its viewport reads as at-bottom unconditionally, so without it both
 * pin assertions would pass against an app with no feature in it at all.
 *
 * Waiting for the LAST bubble's exact text is the settle gate: the trailing streaming cursor drops only
 * when that turn's `turn_end` lands, so an exact match proves the whole stream arrived and the layout is
 * final before anything is measured.
 */
async function primeOverflowingThread(page: Page): Promise<void> {
  const assistantBubbles = page.locator('.bubble[data-thread-role="assistant"]')

  await page.getByPlaceholder('Message…').fill(PRIMER_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(assistantBubbles).toHaveCount(REPLY_TURNS, { timeout: STREAM_TIMEOUT_MS })
  await expect(assistantBubbles.last()).toHaveText(replyText(REPLY_TURNS))

  const { scrollHeight, clientHeight } = await readThreadMetrics(page)
  expect(scrollHeight).toBeGreaterThan(clientHeight)
}

/**
 * Assert the thread is resting at the bottom, within the merged helper's tolerance.
 *
 * A plain (non-polling) assertion is correct here rather than an `expect.poll`: every call site first
 * awaits a locator for the arriving element, and an element can only be observed once React's commit —
 * layout effects included — has finished, because that commit is one synchronous task. The re-assert is a
 * LAYOUT effect precisely so no observable state exists in which the DOM has the new row but the pin has
 * not been applied; polling here would paper over exactly the jitter that guarantee removes.
 */
async function expectPinnedToBottom(page: Page): Promise<void> {
  const { scrollTop, clientHeight, scrollHeight } = await readThreadMetrics(page)
  expect(scrollHeight - scrollTop - clientHeight).toBeLessThanOrEqual(AT_BOTTOM_TOLERANCE_PX)
}

/**
 * Yield one full "update the rendering" step so the DOM `scroll` event that assigning `scrollTop` queued
 * has actually dispatched and React's onScroll handler has run. Scroll steps run BEFORE animation-frame
 * callbacks within that step, so one rAF already suffices; the second is free insurance. Without this the
 * pushed frame could land in the same frame as the assignment, and the test would be asserting against a
 * flag the operator's scroll had not yet moved.
 */
const settleScrollEvent = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )

test('an arriving item of every kind leaves a bottom-resting thread at the bottom', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames })

  await primeOverflowingThread(page)

  // `assistantText` — the streamed bubble, and the state the operator is in at the end of a reply.
  await expectPinnedToBottom(page)

  // `toolCall` — a non-bubble row.
  daemon.pushFrame(toolUseFrame())
  await expect(page.locator('.tool-row')).toHaveCount(1, { timeout: STREAM_TIMEOUT_MS })
  await expectPinnedToBottom(page)

  // `sessionBoundary` — a row carrying no data-thread-role at all.
  daemon.pushFrame(sessionTransitionFrame())
  await expect(page.locator('.session-delimiter')).toHaveCount(1, { timeout: STREAM_TIMEOUT_MS })
  await expectPinnedToBottom(page)

  // The fourth criterion. Chrome mounting between the thread and the composer shrinks the thread's
  // VIEWPORT by tens of pixels while its scrollTop and scrollHeight are untouched. A shrinking viewport
  // raises the maximum scroll offset, so the browser never clamps scrollTop and no scroll event fires —
  // the tracked flag is untouched by construction, and the re-assert returns the view to the new bottom.
  // A raw re-measurement at arrival time would instead read "not at bottom" and silently un-pin here.
  daemon.pushFrame(turnStateFrame('thinking'))
  await expect(page.locator('.conversation__thinking')).toBeVisible({ timeout: STREAM_TIMEOUT_MS })
  await expectPinnedToBottom(page)

  // `userText` — the only kind that reaches the store through the local optimistic dispatch instead of an
  // inbound frame. The fake answers this send with no frames, so the echo is the whole mutation.
  await page.getByPlaceholder('Message…').fill(SECOND_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveCount(2)
  await expectPinnedToBottom(page)

  // The two remaining kinds need no case: `turnBoundary` draws no element, and `unrecognizedMessage`
  // differs from the four covered kinds only in the markup its row renders — a dimension the pin provably
  // never reads, since neither the scroll handler nor the re-assert mentions `kind` or `items`.
})

test('an arriving item leaves the scroll offset unchanged when the operator has scrolled up', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames })

  await primeOverflowingThread(page)

  // Scroll back to the top. Deliberately programmatic rather than `mouse.wheel`: assigning scrollTop fires
  // the same DOM `scroll` event the production handler listens to, with no hover position and no
  // smooth-scroll timing to go flaky on, and the top is an exact integer offset. This criterion is about
  // the pin logic, not about input plumbing.
  await page.locator('.conversation__thread').evaluate((el) => {
    el.scrollTop = 0
  })
  await settleScrollEvent(page)

  // Wait for the row to ACTUALLY arrive before asserting. Skipping this wait makes the test vacuous: it
  // would assert an unchanged offset before anything had changed.
  daemon.pushFrame(toolUseFrame())
  await expect(page.locator('.tool-row')).toHaveCount(1, { timeout: STREAM_TIMEOUT_MS })

  // Both failure directions are covered by this one assertion: had no scroll event fired, the flag would
  // still be set and the pin would have dragged the view off zero; had the metric mapping been transposed,
  // the flag would read at-bottom and the pin would likewise have dragged it off zero.
  const { scrollTop } = await readThreadMetrics(page)
  expect(scrollTop).toBe(0)
})

test('sending from far up the history jumps to the bottom and leaves the thread pinned', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames })

  await primeOverflowingThread(page)

  // Park the operator at the very top — the same programmatic idiom as the test above, for the same
  // reasons. The rAF settle is NOT optional, and the direction of the hazard is INVERTED from that test's:
  // there, skipping it makes a correct app fail; here it would make a BROKEN app pass. The tracked flag is
  // still `true` at the instant of the assignment, so without waiting for the queued scroll event to
  // dispatch and clear it, the send would find a thread that was already following and the view would land
  // at the bottom with no feature present at all.
  await page.locator('.conversation__thread').evaluate((el) => {
    el.scrollTop = 0
  })
  await settleScrollEvent(page)

  // The precondition guard. Without it the test cannot distinguish "the send pulled the view down" from
  // "the view was never up" — the primer leaves the thread resting at the bottom.
  const before = await readThreadMetrics(page)
  expect(before.scrollTop).toBe(0)

  await page.getByPlaceholder('Message…').fill(SCROLLED_UP_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()

  // The first criterion. The optimistic echo is the second user bubble (the primer was the first), and
  // awaiting it is what makes the plain assertion that follows correct — expectPinnedToBottom's contract.
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveCount(2)
  await expectPinnedToBottom(page)

  // The second criterion: the reply that follows keeps the view, with no second manual scroll. Turn
  // REPLY_TURNS + 1 so it is a distinct turn and therefore a distinct bubble from the primer's stream, and
  // two arrivals rather than one so "the reply keeps the view" is asserted across a stream instead of at a
  // single instant.
  //
  // No rAF settle before these pushes, and the asymmetry with the scroll above is deliberate: the only
  // scroll event outstanding here is the one the pin's OWN write queued, and when it dispatches it computes
  // at-bottom -> true, which is the value the flag already holds. The settle above matters precisely
  // because there the pending event carries the opposite value.
  const assistantBubbles = page.locator('.bubble[data-thread-role="assistant"]')
  daemon.pushFrame(assistantDeltaFrame(REPLY_TURNS + 1))
  await expect(assistantBubbles).toHaveCount(REPLY_TURNS + 1, { timeout: STREAM_TIMEOUT_MS })
  await expectPinnedToBottom(page)

  // The exact-text wait is the settle gate (the primer's idiom): the trailing streaming cursor drops only
  // when this turn's `turn_end` lands, so the match proves the layout is final before it is measured.
  daemon.pushFrame(turnEndFrame(REPLY_TURNS + 1))
  await expect(assistantBubbles.last()).toHaveText(replyText(REPLY_TURNS + 1))
  await expectPinnedToBottom(page)
})
