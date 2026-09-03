import type { Locator, Page } from '@playwright/test'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { bubbleTextExactly } from './fixtures/bubbleText'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { AT_BOTTOM_TOLERANCE_PX } from '../src/renderer/src/screens/conversation/threadScrollPosition'
import type {
  AssistantDeltaPayload,
  QueuedItem,
  QueueStatePayload,
  SendMessagePayload,
  SessionTransitionPayload,
  StallPayload,
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
// `session_transition` on a `/clear`, `queue_state` when a message is enqueued behind a busy turn, and
// `turn_state{thinking}` when a turn starts. None is a manufactured precondition — each is simply a
// different timeline or chrome mutation, which is the dimension this spec varies. The pin mechanism reads
// neither `kind` nor `items`, so what a row *renders* is a dimension it provably never looks at.
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

/** The tool this spec's pending call names. Held as a constant because #649's status label reads it: the
 *  call is pushed with no matching `tool_result`, so it stays open for the rest of the run and the working
 *  label names it wherever that label shows. */
const TOOL_NAME = 'read_file'

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
      name: TOOL_NAME,
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

/** The coarse turn-phase scalar. `thinking` puts the working label in the status row (and arms the send
 *  button's stop variant); `idle` closes both, and since #650 it is also what closes the window the
 *  composer's own accept opens locally, which is why the primer's reply stream ends with one.
 *
 *  #796 NARROWED what this frame does to the LAYOUT. The working indicator's text is no longer a bubble in
 *  the loose region between the thread and the composer — it is the label inside a status row that is
 *  mounted at all times, precisely so the composer stops moving when the text comes and goes. So this
 *  frame does not shrink the thread's viewport and is not what the fourth criterion turns on.
 *
 *  #967 took the SUCCESSOR subject away too: the stall block that inherited that job has folded into the
 *  same row, so `queueStateFrame` below is the criterion's subject now. What this frame proves here is
 *  the stall's self-clear — pushed after a stall, it is the turn activity that retracts it, and since both
 *  states render the SAME label element the assertions discriminate on the label's TEXT. It also leaves
 *  the turn running for the userText step after it. */
const turnStateFrame = (state: WireTurnState): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })

/** The stall onset (#315/#317) — a server push a real daemon emits when claude goes quiet mid-turn, the
 *  stall-bundle.spec.ts builder's shape. Since #967 it puts STALL_COPY in the status row's label rather
 *  than mounting a bubble of its own, so it shrinks nothing; what it still proves here is the onset →
 *  self-clear pair, and that the stall shows with the phase already back at `idle` (the folded statuses
 *  are not gated on a running turn). conversation_id is set for realism; the timeline bridge drops it
 *  (#732), so it does not gate rendering. */
const stallFrame = (): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'stall',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id } satisfies StallPayload
  })

/** A replacement-truth queue snapshot (#293/#294) — the whole current backlog, not a delta. Taken verbatim
 *  from queued-backlog-interrupt.spec.ts's own builder. #967 made this the fourth criterion's subject: the
 *  backlog is a region of dimmed rows that mounts between the thread and the composer, so it shrinks the
 *  thread's viewport by tens of pixels, which is the magnitude that criterion needs. */
const queueStateFrame = (items: readonly QueuedItem[]): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'queue_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, queued: [...items] } satisfies QueueStatePayload
  })

/** Two queued messages, so the region is unambiguously tens of pixels tall rather than one row's worth.
 *  Their text is display-only here — this spec asserts geometry, not queue contents. */
const QUEUED_BACKLOG: readonly QueuedItem[] = [
  { queued_msg_id: 1, text: 'First queued task', ts: FIXED_TS },
  { queued_msg_id: 2, text: 'Second queued task', ts: FIXED_TS }
]

/** The SAME backlog with a third message queued behind it. A snapshot is REPLACEMENT truth, so a real daemon
 *  re-sends the whole list rather than a delta — this is the frame it produces when one more message is
 *  enqueued behind the same busy turn.
 *
 *  #1009's growth criterion turns on the pair: a fix keyed on "the backlog is non-empty" passes the mount above
 *  and fails here, because that boolean does not change while the region gains a row and shrinks the thread's
 *  viewport again. Growing an ALREADY-MOUNTED region is also the case a `null`-at-rest mount check cannot see. */
const GROWN_BACKLOG: readonly QueuedItem[] = [
  ...QUEUED_BACKLOG,
  { queued_msg_id: 3, text: 'Third queued task', ts: FIXED_TS }
]

/** The two status-row labels this spec discriminates between, held as local literals rather than imported
 *  from the renderer screen (the stall-bundle.spec.ts convention — importing that module would pull React
 *  into the Playwright node context). Both are client-owned constants there; if either value drifts, its
 *  own unit test pins it and this spec fails loudly rather than silently passing.
 *
 *  The working label is the TOOL-NAMED one (#649), not `Thinking…`: `toolUseFrame` above leaves a call open
 *  with no `tool_result`, so `openToolName` still answers by the time the stall clears. That is production
 *  behaviour rather than an accident of this spec, and asserting the label it actually renders is what
 *  keeps the assertion exact. */
const STALL_COPY = 'The turn seems to have stalled…'
const WORKING_COPY_WITH_TOOL = `Running ${TOOL_NAME}…`

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
      return [
        ...Array.from({ length: REPLY_TURNS }, (_, index) => [
          assistantDeltaFrame(index + 1),
          turnEndFrame(index + 1)
        ]).flat(),
        // The turn's terminal phase. Faithful first — a real daemon ends every turn with it, and
        // `turn_end` is NOT that signal (it appends a boundary and leaves `phase` alone; the pairing
        // threadTimeline.ts documents on its `turnEnd` arm). #650 then made it LOAD-BEARING: the composer's
        // accept now opens the working indicator locally, so without this frame the primer would leave
        // `.conversation__thinking` mounted for the rest of the run and the stall step below could not tell
        // an arriving label from one already on screen. `primeOverflowingThread` gates on it.
        //
        // #967 also made it the setup for AC2's own claim: with the phase back at `idle`, the stall pushed
        // later still shows, which is the "the folded statuses are not gated on a running turn" behaviour.
        turnStateFrame('idle')
      ]
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

/** The queued backlog's rows — the arrival gate for every `queue_state` push below, and the region whose height
 *  is the shrink under test. Scoped to `.conversation__queued` so it can never match a delivered user bubble
 *  in the thread above. */
const queuedRows = (page: Page): Locator => page.locator('.conversation__queued .message-row--user')

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
  await expect(assistantBubbles.last()).toHaveText(bubbleTextExactly(replyText(REPLY_TURNS)))

  // #650: the primer's turn has fully ENDED — the stream's trailing `turn_state{idle}` closed the working
  // indicator that the composer's accept opened locally. This is a NON-VACUITY gate of the same kind as the
  // overflow check below, and it is here in the shared primer for the same reason: so no test can run a
  // chrome-mount assertion before it. Without it the label element would already be on screen and the
  // stall step below would be asserting against a row it never changed.
  //
  // #967 SHARPENED why this matters and did not remove the need for it. The label element is now shared by
  // all four thread statuses, so `toBeVisible` on it can no longer distinguish "the stall mounted this"
  // from "something else already had it" — which is why the assertions below discriminate on the label's
  // TEXT. A zero-count gate here is the other half of that: the row's label starts genuinely absent.
  // It is also the settle gate for the last frame in the stream, so the metrics below are read against a
  // final layout.
  await expect(page.locator('.conversation__thinking')).toHaveCount(0, { timeout: STREAM_TIMEOUT_MS })

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
  //
  // #796 MOVED THIS ONTO THE STALL INDICATOR and #967 MOVED IT AGAIN, onto the queued backlog. The swap
  // is the whole point of the criterion rather than a cosmetic one, and it has now happened twice for the
  // same reason. The working indicator used to be this region's shrinking chrome; #796 made its text the
  // label of a status row mounted at all times, so `turn_state{thinking}` mounts a label INSIDE an
  // already-present row and shrinks nothing. The stall block inherited the job because it kept its bubble
  // and its null-at-rest posture — and #967 folded that block into the same row, so it shrinks nothing
  // either. Left pointing at either, this criterion would still pass, against a viewport that never
  // moved, testing nothing.
  //
  // THE QUEUED BACKLOG (#294) is the subject now: a `queue_state` push mounts a region of dimmed rows
  // between the thread and the composer, so the shrink is tens of pixels — 116px measured here, the
  // magnitude this criterion's reasoning above depends on. Deliberately NOT #963's row growth, the other
  // candidate: that is 8px, and driving it needs a terminal connection error this spec has no reason to
  // stage.
  //
  // #1009 CLOSED THE GAP #967 COULD ONLY MEASURE AND COMMENT, so this is asserted IMMEDIATELY — as soon as
  // the queued rows are on screen, with no other frame pushed and no send in between. `QueuedBacklogControl`
  // used to hold its own queue-store subscription, so a `queue_state` push re-rendered THAT control and not
  // this screen; the pin's dep-free layout effect runs on SCREEN renders, so it had not run when the region
  // appeared and the thread rested 116px off the bottom until something unrelated re-rendered the screen.
  // `ConversationScreen` now reads the open conversation's backlog itself, so the rows and the re-pin land in
  // one commit — which is also what makes the plain (non-polling) assertion correct rather than racy, per
  // expectPinnedToBottom's contract.
  daemon.pushFrame(queueStateFrame(QUEUED_BACKLOG))
  await expect(queuedRows(page)).toHaveCount(QUEUED_BACKLOG.length, { timeout: STREAM_TIMEOUT_MS })
  await expectPinnedToBottom(page)

  // The SAME criterion one snapshot later, on a region that is already mounted: a backlog that GROWS shrinks
  // the viewport again by exactly one row while every "is there a backlog" boolean stays true. A fix keyed on
  // emptiness passes the assertion above and fails this one, which is why the growth is asserted separately
  // rather than folded into the mount.
  daemon.pushFrame(queueStateFrame(GROWN_BACKLOG))
  await expect(queuedRows(page)).toHaveCount(GROWN_BACKLOG.length, { timeout: STREAM_TIMEOUT_MS })
  await expectPinnedToBottom(page)

  // The stall onset — a chrome change that moves NO geometry at all, the complement of the two pushes above.
  // It mutates only the status row's label text (since #967 it mounts nothing of its own), so whatever the pin
  // does here, it does on the flag alone.
  //
  // It is also the e2e proof of two things #967 changed and one it preserved: the stall reaches the status
  // row's label, it reaches it with the phase already back at `idle` (the folded statuses are not gated on
  // a running turn), and `.conversation__thinking` is still the label's identity hook.
  //
  // EXACT TEXT, not `toBeVisible`. All four thread statuses render this one element now, so a visibility
  // assertion reads the element's current state rather than which frame put the stall in it — the very
  // vacuity the primer's zero-count gate exists to prevent, one state later.
  const statusLabel = page.locator('.conversation__thinking')
  daemon.pushFrame(stallFrame())
  await expect(statusLabel).toHaveText(STALL_COPY, { timeout: STREAM_TIMEOUT_MS })
  await expectPinnedToBottom(page)

  // Turn activity self-clears the stall (#317's reducer), and the working label takes the slot back. Both
  // halves are one text assertion on one element: the stall copy is GONE and the working label is there,
  // which is a claim neither a count nor a visibility check on this element could still make. The frame is
  // also what the userText step below needs, since it leaves the turn RUNNING.
  //
  // The working label arrives TOOL-NAMED — the `tool_use` pushed at the top of this test is still open, so
  // #649's derivation names it. It is asserted as what it is rather than steered around: the stall
  // outranking that same open tool while it lasts, and yielding to it after, is #967's precedence visible
  // end to end on one element.
  daemon.pushFrame(turnStateFrame('thinking'))
  await expect(statusLabel).toHaveText(WORKING_COPY_WITH_TOOL, { timeout: STREAM_TIMEOUT_MS })

  // `userText` — the only kind that reaches the store through the local optimistic dispatch instead of an
  // inbound frame. The fake answers this send with no frames, so the echo is the whole mutation.
  //
  // Sent by ENTER, not by clicking Send: the frame above left the turn RUNNING (deliberately — the mounted
  // indicator is this criterion's whole setup, so returning the phase to idle here would undo it), and #678
  // turns the send button into the stop button for exactly that phase, so no Send affordance is on screen.
  // Enter deliberately keeps its send behaviour mid-turn (#678's AC4), so the optimistic echo is identical.
  await page.getByPlaceholder('Message…').fill(SECOND_TEXT)
  await page.getByPlaceholder('Message…').press('Enter')
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

  // #1009's third criterion: the SAME two `queue_state` pushes the first test now asserts a re-pin for must
  // move nothing at all here. This is the half that keeps the fix honest — making the region's mount and its
  // growth screen renders hands the pin a chance to run on a daemon-driven event, and the tracked flag is
  // still what decides whether anything scrolls. An implementation that scrolled on a backlog change instead
  // of on the flag passes the first test and yanks the view out from under the operator here.
  //
  // Exactly zero, not a tolerance: a shrinking viewport raises the maximum scroll offset, so the browser
  // clamps nothing and the top stays the top. Each push is awaited by its own row count first, for the tool
  // row's reason above — asserting an unchanged offset before anything changed would be vacuous.
  daemon.pushFrame(queueStateFrame(QUEUED_BACKLOG))
  await expect(queuedRows(page)).toHaveCount(QUEUED_BACKLOG.length, { timeout: STREAM_TIMEOUT_MS })
  expect((await readThreadMetrics(page)).scrollTop).toBe(0)

  daemon.pushFrame(queueStateFrame(GROWN_BACKLOG))
  await expect(queuedRows(page)).toHaveCount(GROWN_BACKLOG.length, { timeout: STREAM_TIMEOUT_MS })
  expect((await readThreadMetrics(page)).scrollTop).toBe(0)
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
  await expect(assistantBubbles.last()).toHaveText(bubbleTextExactly(replyText(REPLY_TURNS + 1)))
  await expectPinnedToBottom(page)
})

// #603: re-opening a discussion lands at the most recent messages. The proof for the claim
// ConversationScreen.tsx:157-159 already makes — the pin "must not survive a remount (ADR 0006), so a
// re-entered thread starts pinned again". That guarantee holds today as an emergent product of three
// INDEPENDENT choices — `following` starts `true`, Back swaps a different component type into the same
// position so React destroys the subtree, and the dep-free layout effect pins before paint — any one of
// which could be changed without anyone noticing this broke. Nothing tested it until here.
//
// This is re-ENTRY, not first open, because re-entry is the only reachable form of the complaint: the
// timeline has no history backfill (its only writers are the live stream and the composer's echo, and
// buildClientHello never sends `last_seen_ts`), so opening a DIFFERENT discussion always starts empty and
// `.conversation__thread` does not even mount. The leg rests on rows already in the store rather than a
// second send — buildReplyFrames answers only the PRIMER — which is what makes this a "content already
// present on open" proof rather than a second live stream.
test('re-opening a discussion lands at the most recent messages and leaves the thread pinned', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames })

  await primeOverflowingThread(page)

  // Park the operator at the very top — the programmatic idiom of the two tests above, for their reasons.
  // The rAF settle is NOT optional and its hazard direction is test 3's: skipping it leaves the queued
  // scroll event undispatched, so a broken app — one whose flag SURVIVED the remount — would re-enter
  // still following and land at the bottom with no feature under test at all.
  await page.locator('.conversation__thread').evaluate((el) => {
    el.scrollTop = 0
  })
  await settleScrollEvent(page)

  // The precondition guard. Without it the test cannot distinguish "re-entry pulled the view down" from
  // "the view was never up" — the primer leaves the thread resting at the bottom.
  const before = await readThreadMetrics(page)
  expect(before.scrollTop).toBe(0)

  // Leave. Back dispatches the shell's `back` route flip and touches no store; the two-pane shell's chat
  // pane then renders `null` in place of the ConversationScreen, so React destroys the subtree and the
  // pin's ref and flag go with it. #670 re-pointed the gate that follows: it used to await the LIST,
  // which was a sound unmount proof only while the list and the thread were mutually exclusive. The list
  // is now always on screen, so that assertion would pass instantly and the re-entry below could race
  // the unmount — reading the thread's OWN disappearance restores the gate.
  await page.locator('.conversation__back').click()
  await expect(page.locator('.conversation')).toHaveCount(0)

  // Re-enter the SAME row, through the real product-UI click the fixture itself performs — never a forced
  // route dispatch or store mutation. activateConversation resets the timeline only when the active
  // conversation id CHANGES (activateConversation.ts:74), and this is the same seeded id, so every row
  // survives the round trip. One seeded row keeps the bare selector unambiguous.
  await page.locator('.channel-list__row-open').click()
  await expect(page.locator('.conversation')).toBeVisible()

  // The rows survived, and the thread is showing the RECENT ones. The count is the "same conversation, no
  // reset" claim; the last bubble's text is the user story's "most recent messages" claim. Exact text is
  // safe here for the primer's reason verbatim — that turn's `turn_end` appended a turnBoundary, so the
  // trailing streaming cursor is not on this bubble.
  const assistantBubbles = page.locator('.bubble[data-thread-role="assistant"]')
  await expect(assistantBubbles).toHaveCount(REPLY_TURNS)
  await expect(assistantBubbles.last()).toHaveText(bubbleTextExactly(replyText(REPLY_TURNS)))

  // Non-vacuity on the RE-ENTERED thread specifically, not merely in the primer: this is a freshly mounted
  // scroll node, and a thread shorter than its viewport reads as at-bottom unconditionally.
  const reEntered = await readThreadMetrics(page)
  expect(reEntered.scrollHeight).toBeGreaterThan(reEntered.clientHeight)
  await expectPinnedToBottom(page)

  // Left PINNED, not merely positioned: one further pushed frame keeps the bottom with no manual scroll.
  // A `tool_use` rather than an assistant delta on purpose — one frame, one unambiguous arrival gate and no
  // `turn_end` follow-up, so this step needs no settle of its own. Its row is tens of pixels tall, an order
  // of magnitude above AT_BOTTOM_TOLERANCE_PX, so a thread that had merely SAT at the old bottom fails here.
  daemon.pushFrame(toolUseFrame())
  await expect(page.locator('.tool-row')).toHaveCount(1, { timeout: STREAM_TIMEOUT_MS })
  await expectPinnedToBottom(page)
})
