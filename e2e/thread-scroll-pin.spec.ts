import { createHash } from 'node:crypto'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { bubbleTextExactly } from './fixtures/bubbleText'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { AT_BOTTOM_TOLERANCE_PX } from '../src/renderer/src/screens/conversation/threadScrollPosition'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import type { AttachmentUploadEvent } from '../src/shared/ipc/attachmentUpload'
import type {
  AssistantDeltaPayload,
  AttachmentChunkPayload,
  QueuedItem,
  QueueStatePayload,
  RequestAttachmentPayload,
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
//
// #1046 ADDED A SECOND MECHANISM TO THIS FILE, and the two are not the same one observed twice. Everything
// above proves the app's OWN pin — the tracked flag plus the dep-free layout re-assert. The two tests at the
// bottom prove the browser's: a thumbnail resolving late grows the thread with NO React render anywhere, so
// the pin provably cannot run, and what holds the reader's place is Chromium's scroll anchoring. Both live
// here because they share every helper below and because a reader of either needs to know the other exists —
// the pin is what re-pins on a render, anchoring is what holds between renders. See that section's own
// header for the measurement and for the one line that defeats it.

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

// A collapsed tool row's height: 1px border + 8px chip padding + the 20px summary line + 8 + 1. Asserted
// below inside the overflowing thread, because that is the only layout in which a shrinkable row shrinks.
const TOOL_ROW_COLLAPSED_HEIGHT_PX = 38

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
  // ITS COLLAPSED HEIGHT, measured in the one thread in this suite that OVERFLOWS. #1102 put the design's
  // clip on .tool-row, and a flex item that clips has an automatic minimum height of 0 rather than its
  // content — so in this scrolling column it was the one child free to shrink, and it shrank to its two
  // 1px borders: no text, a blue line, seen in the running app on 2026-09-05. e2e/tool-row-toggle.spec.ts
  // measures every row in a thread that never overflows, so it cannot observe this by construction; the
  // primer above is what makes this the right place. The expected value is the arithmetic .tool-row's own
  // comment derives (1 + 8 + 20 + 8 + 1), and the row's flex: 0 0 auto is what holds it.
  const toolRowBox = await page.locator('.tool-row').boundingBox()
  expect(Math.round(toolRowBox?.height ?? 0)).toBe(TOOL_ROW_COLLAPSED_HEIGHT_PX)
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

// ---------------------------------------------------------------------------------------------------
// #1046 — a thumbnail that resolves late must not move the reader's place.
//
// THE PIN CANNOT REACH THIS, AND THAT IS A FACT ABOUT THE MECHANISM RATHER THAN A GAP IN ITS WIRING.
// A thumbnail settles in TWO events and only the second one moves geometry. First
// `BubbleAttachmentImage`'s own `useState` flips `pending` -> `ready`: a real React render, but of that leaf
// alone, so `ConversationScreen` does not re-render and the dep-free re-assert above does not run — and at
// that instant the <img> carries a blob: src and deliberately no width/height attributes, so it occupies
// nothing. Then the browser decodes the bytes and lays the picture out, growing the row by
// THUMBNAIL_GROWTH_PX with NO React render anywhere. No dependency array can reach the first event and no
// render exists to observe the second, so hoisting state — #1009's fix for the queued backlog — closes
// nothing here.
//
// WHAT HOLDS THE PLACE IS CHROMIUM'S SCROLL ANCHORING, and it was MEASURED rather than reasoned about.
// `.conversation__thread` leaves `overflow-anchor` unset, which is the default `auto`. Each scenario below
// was run twice against the built app — once as shipped, once with the single line `overflow-anchor: none`
// added to that rule — with the content growing by exactly 172px (160 + 12) against a 488px viewport:
//
//   reader at the bottom, picture above them   0px from the bottom  ->  172px with the line present
//   reader parked mid-thread, picture above    a fixed row's viewport top 218 -> 218  ->  218 -> 390
//   reader parked mid-thread, picture below    scrollTop unchanged  ->  scrollTop unchanged (indifferent)
//
// So the first two tests are the detector for that one line and the third arm is not — it is the OVER-REACH
// guard, whose job is to stay green: a fix that re-pinned on any content growth would yank a scrolled-up
// reader to the bottom, and that is what reddens it. No production code ships for this; the deliverable is
// the proof, because an untested behaviour this app depends on and did not write is exactly what disappears
// in a later Electron bump.
//
// AC2'S LITERAL WORDING IS SPLIT BETWEEN THE TWO DIRECTIONS ON PURPOSE. "The scroll offset left exactly
// where it was" is literally true for a picture BELOW the reader and is asserted as an exact equality. For
// one ABOVE it is unsatisfiable in that form: the only way to leave the reader looking at the same content
// when 172px is inserted above the viewport is to move scrollTop by those 172px, which is what anchoring
// does and what any mechanism satisfying the first criterion must do. So that arm asserts the reader-facing
// fact — a stable row's VIEWPORT-relative top is unchanged — plus, as its own assertion, that the distance
// from the bottom did not move either.
//
// A THUMBNAIL RESOLVING IN THE READER'S OWN LAST ROW IS A DIFFERENT CASE and is deliberately not here: the
// growth is BELOW the reader, anchoring is indifferent to it (172px of drift measured with and without the
// line), and closing it needs production code this ticket's verify-first instruction rules out. Filed as
// #1049.

/** `.bubble__image`'s `max-height`, and the `margin-top` (--space-3) that #869 moved onto the control
 *  wrapping it, `.bubble__image-button`. Their sum is what a resolving
 *  thumbnail adds to the thread, and it is the floor every growth assertion below is measured against —
 *  never an exact equality, so a redrawn bubble that grows the picture does not redden a scroll test. */
const THUMBNAIL_HEIGHT_PX = 160
const THUMBNAIL_GROWTH_PX = THUMBNAIL_HEIGHT_PX + 12

/** The browser lays out in fractional pixels, and every quantity compared here is a measured box. */
const SUBPIXEL_PX = 1.5

// ⭐ CANONICAL ATTACHMENT IDS — hex digits and hyphen only, and load-bearing rather than cosmetic.
// `resolveAttachmentPath`'s canonical id pattern gates the store write AND the read back, so a
// non-canonical id (`attachment-file-row.spec.ts`'s `e2e-download-1` shape) would be refused, the picture
// would become the fallback, and the growth these tests turn on would never happen.
const ID_ABOVE = '5a6b7c8d-9e0f-4a1b-8c9d-5e6f7a8b9c0d'
const ID_BELOW = '6a7b8c9d-0e1f-4a2b-8c9d-6e7f8a9b0c1d'
const ID_LAST = '7a8b9c0d-1e2f-4a3b-8c9d-7e8f9a0b1c2d'

/** A 200x400 solid-colour PNG, generated for this suite and carrying no information at all. Portrait on
 *  purpose: at THUMBNAIL_HEIGHT_PX tall it draws 80 wide, under the bubble's content box at every window
 *  size, so no cap is in play and the growth is the full THUMBNAIL_GROWTH_PX. A few hundred bytes, far
 *  under one chunk's payload budget, so it rides exactly one `attachment_chunk`. */
const THUMBNAIL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAAGQCAIAAABkkLjnAAACz0lEQVR42u3SQQkAAAgEwYtiLtMZ1RKCn4FJsGyqB85FAoyFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsbCWGAsjIWxwFgYC2NhLBUwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsbCWGAsjIWxwFgYC2OBsTAWxsJYKmAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBbGkgBjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2NhLBUwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbH4sADgZVQK/cnv+wAAAABJRU5ErkJggg=='
const THUMBNAIL_BYTES = Buffer.from(THUMBNAIL_PNG_BASE64, 'base64')
const THUMBNAIL_NATURAL_WIDTH = 200
const THUMBNAIL_FILENAME = 'portrait.png'

const ABOVE_TEXT = 'a picture from further up the thread'
const BELOW_TEXT = 'a picture from further down the thread'
// #1049's own message, and its text shares no substring with the four above — `thumbnailBubble` matches on
// `hasText`, which is a substring match, so a shared fragment would silently address the wrong bubble.
const LAST_TEXT = 'a picture in the newest row of all'

/**
 * The daemon's answer to one `request_attachment`: a single `attachment_chunk` carrying the whole file.
 * Taken from `attachment-image-thumbnail.spec.ts`'s own builder, whose two rules both survive here.
 *
 * THE DIGEST IS COMPUTED, NEVER WRITTEN BY HAND. `attachmentReassembler` verifies the assembled bytes
 * against an exact lowercase-hex SHA-256 of the whole file, neither prefix- nor case-insensitive, so a
 * hand-written digest fails closed and the picture silently becomes the fallback. CORRELATION RIDES THE
 * ENVELOPE: `daemonConnection` routes a retrieval chunk by `in_reply_to` against the id of the
 * `request_attachment` this client minted, and drops a frame matching no live retrieval with no event and
 * no log — which is exactly why the id is captured off the wire below rather than guessed.
 */
function attachmentChunkFrame(requestId: number, ask: RequestAttachmentPayload): Uint8Array {
  const payload: AttachmentChunkPayload = {
    attachment_id: ask.attachment_id,
    index: 0,
    total_chunks: 1,
    filename: THUMBNAIL_FILENAME,
    mime_type: 'image/png',
    size: THUMBNAIL_BYTES.length,
    sha256: createHash('sha256').update(THUMBNAIL_BYTES).digest('hex'),
    data: THUMBNAIL_BYTES.toString('base64')
  }
  return encodeEnvelope({
    id: 900 + requestId,
    type: 'attachment_chunk',
    ts: FIXED_TS,
    in_reply_to: requestId,
    payload
  })
}

interface WithheldThumbnails {
  /** Composed into `launchPairedApp` in place of the module-level builder, which it delegates to. */
  buildReplyFrames: (inbound: Uint8Array) => Uint8Array[]
  /** The correlated chunk for one recorded ask, once that ask has actually reached the daemon. */
  serve: (attachmentId: string) => Promise<Uint8Array>
}

/**
 * Withhold every thumbnail's bytes, and hand back the frame that releases one.
 *
 * THE LATE RESOLUTION IS THE WHOLE CASE. A thumbnail whose bytes are in hand when its row first paints
 * exercises nothing — the row is laid out at its final height before the reader ever takes a position. So
 * `request_attachment` is answered with NO frames, the thread is allowed to settle, the reader takes their
 * place, and only then is the correlated frame pushed out of band with `daemon.pushFrame`.
 *
 * PER-TEST STATE, NOT MODULE STATE, and that is forced rather than stylistic: `playwright.config.ts` sets
 * `workers: 1` and `fullyParallel: false`, so every test in this file runs in one worker process and a
 * capture map at module scope would carry one test's request ids into the next.
 *
 * `serve` POLLS rather than reading the map once. The ask is raised by the leaf's own mount effect and
 * travels renderer -> main -> wire, so it is in flight at the moment the bubble appears; reading the map
 * synchronously would race it and produce a frame correlated to nothing, which the connection drops in
 * silence. Keyed by attachment id and overwritten on each ask, so a re-mounted leaf's newer request id
 * wins.
 */
function withheldThumbnails(): WithheldThumbnails {
  const asks = new Map<string, { requestId: number; ask: RequestAttachmentPayload }>()
  return {
    buildReplyFrames: (inbound) => {
      const envelope = decodeEnvelope(inbound)
      if (envelope.type === 'request_attachment') {
        const ask = envelope.payload as RequestAttachmentPayload
        asks.set(ask.attachment_id, { requestId: envelope.id, ask })
        return []
      }
      return buildReplyFrames(inbound)
    },
    serve: async (attachmentId) => {
      await expect
        .poll(() => asks.has(attachmentId), { timeout: STREAM_TIMEOUT_MS })
        .toBe(true)
      const recorded = asks.get(attachmentId)
      if (recorded === undefined) throw new Error('unreachable: the poll above proved the entry exists')
      return attachmentChunkFrame(recorded.requestId, recorded.ask)
    }
  }
}

/** One settled upload exactly as `src/main/attachmentUpload` emits it. The SENDER is the only thing
 *  standing in for production, because the alternative is a native file dialog no Playwright locator can
 *  dismiss — `composer-attach.spec.ts`'s established seam, carried from
 *  `attachment-image-thumbnail.spec.ts`. */
const pushCompletedUpload = (app: ElectronApplication, uploadId: string): Promise<void> =>
  app.evaluate(
    ({ BrowserWindow }, delivery) => {
      const [window] = BrowserWindow.getAllWindows()
      window.webContents.send(delivery.channel, delivery.event)
    },
    {
      channel: ATTACHMENT_UPLOAD_EVENT_CHANNEL,
      event: {
        type: 'completed',
        uploadId,
        filename: THUMBNAIL_FILENAME
      } satisfies AttachmentUploadEvent
    }
  )

/** Send one message carrying one image attachment, and wait for its optimistic echo. The fake answers a
 *  send with no frames (the module-level builder's non-primer arm), so the echo is the whole mutation. */
async function sendWithThumbnail(
  page: Page,
  app: ElectronApplication,
  uploadId: string,
  text: string
): Promise<void> {
  await pushCompletedUpload(app, uploadId)
  await page.getByPlaceholder('Message…').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(thumbnailBubble(page, text)).toHaveCount(1)
}

/** The user bubble carrying one of the two pictures, addressed by its OWN message text.
 *
 *  Deliberately not by index among user bubbles: `primeOverflowingThread` sends a message of its own, so
 *  the picture-bearing rows are not consecutive and an index would silently address the primer's bubble —
 *  a row with no picture in it, on which every position assertion below would answer something true and
 *  irrelevant. `hasText` is a substring match, and the three texts share no substring with each other. */
const thumbnailBubble = (page: Page, text: string): Locator =>
  page.locator('.bubble[data-thread-role="user"]', { hasText: text })

/**
 * Where a row sits relative to the thread's visible band. Both criteria are stated in terms of a picture
 * ABOVE or BELOW the reader, so each test guards which one it actually staged rather than inferring it from
 * the send order — a redrawn bubble or a different window height could quietly move a row into view and
 * turn the criterion into a different, weaker one.
 */
const rowPosition = (bubble: Locator): Promise<'above' | 'below' | 'overlapping'> =>
  bubble.evaluate((element) => {
    const thread = element.closest('.conversation__thread')
    if (thread === null) throw new Error('the bubble is not inside a thread scroll region')
    const view = thread.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    if (box.bottom <= view.top) return 'above'
    if (box.top >= view.bottom) return 'below'
    return 'overlapping'
  })

/**
 * Is this bubble's row the LAST child of the thread's scroll region?
 *
 * #1049's precondition, and it has to be structural rather than positional. `rowPosition` answers
 * `'overlapping'` for this row rather than `'below'` — the last row of a bottom-resting thread is on screen
 * by definition — so the "the growth lands past the fold" claim cannot be made by looking at the viewport.
 * Being the final row plus the reader being at the bottom is what makes it true: everything the row gains
 * extends below where the reader is resting.
 *
 * `Timeline` writes its rows as DIRECT children of `.conversation__thread` (the flex column, its `gap` and
 * its `padding` all live on the scroll container), so `lastElementChild` is the last row and not a wrapper.
 */
const isLastRow = (bubble: Locator): Promise<boolean> =>
  bubble.evaluate((element) => {
    const thread = element.closest('.conversation__thread')
    if (thread === null) throw new Error('the bubble is not inside a thread scroll region')
    return element.closest('.message-row') === thread.lastElementChild
  })

/**
 * The index, among assistant bubbles, of the first one resting ENTIRELY inside the thread's visible band —
 * the reference row whose viewport-relative top is what "the reader's place" means concretely.
 *
 * Chosen live rather than hardcoded: which row is on screen depends on the parked offset, the window
 * height and the drawn bubble, none of which this criterion is about. Throwing when none qualifies is the
 * guard that keeps the reads below meaningful.
 */
const firstFullyVisibleAssistantRow = (page: Page): Promise<number> =>
  page.locator('.conversation__thread').evaluate((thread) => {
    const view = thread.getBoundingClientRect()
    const index = [...thread.querySelectorAll('.bubble[data-thread-role="assistant"]')].findIndex(
      (row) => {
        const box = row.getBoundingClientRect()
        return box.top >= view.top && box.bottom <= view.bottom
      }
    )
    if (index < 0) throw new Error('no assistant bubble rests fully inside the thread viewport')
    return index
  })

/** A row's top edge in VIEWPORT coordinates — unchanged is what a reader experiences as "my place was
 *  left alone", and the quantity anchoring exists to hold. Deliberately not `scrollTop`: see this
 *  section's header for why the two disagree for a picture above the reader. */
const viewportTop = (row: Locator): Promise<number> =>
  row.evaluate((element) => element.getBoundingClientRect().top)

/** How far the thread is resting from its own bottom. */
const distanceFromBottom = (metrics: ThreadMetrics): number =>
  metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight

/**
 * Release one withheld thumbnail and wait until it is DRAWN, not merely delivered.
 *
 * Two gates, and both are needed. `naturalWidth` reaching the served image's own intrinsic width is the
 * round-trip proof — retrieval, store, bytes leg, blob URL — and reads 0 for a source that never decoded.
 * The drawn box reaching THUMBNAIL_HEIGHT_PX is the LAYOUT gate: decoding precedes layout, so the first
 * poll can pass while the row has not grown yet, and it is the growth that every assertion here turns on.
 * The rAF settle then closes the frame in which any scroll adjustment is applied.
 */
async function resolveThumbnail(
  page: Page,
  daemon: { pushFrame: (frame: Uint8Array) => void },
  withheld: WithheldThumbnails,
  attachmentId: string,
  image: Locator
): Promise<void> {
  daemon.pushFrame(await withheld.serve(attachmentId))
  await expect(image).toHaveCount(1, { timeout: STREAM_TIMEOUT_MS })
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth), {
      timeout: STREAM_TIMEOUT_MS
    })
    .toBe(THUMBNAIL_NATURAL_WIDTH)
  await expect
    .poll(async () => Math.round((await image.boundingBox())?.height ?? 0), {
      timeout: STREAM_TIMEOUT_MS
    })
    .toBe(THUMBNAIL_HEIGHT_PX)
  await settleScrollEvent(page)
}

test('a thumbnail resolving above a bottom-resting reader leaves the thread at the bottom', async ({
  launchPairedApp
}) => {
  const withheld = withheldThumbnails()
  const { page, app, daemon } = await launchPairedApp({
    buildReplyFrames: withheld.buildReplyFrames
  })

  // The picture goes in FIRST so the primer's twenty turns pile below it and carry it off the top of the
  // viewport. Its bytes are withheld, so the row it mounts draws nothing and reserves nothing — which is
  // the state the reader is in while they read at the bottom.
  await sendWithThumbnail(page, app, ID_ABOVE, ABOVE_TEXT)
  await primeOverflowingThread(page)

  // The preconditions, and neither is decoration. The reader is genuinely resting at the bottom (the
  // primer's overflow gate has already proved the thread can scroll at all), and the picture is genuinely
  // ABOVE them, which is the case this criterion is scoped to.
  await expectPinnedToBottom(page)
  expect(await rowPosition(thumbnailBubble(page, ABOVE_TEXT))).toBe('above')

  const before = await readThreadMetrics(page)
  await resolveThumbnail(page, daemon, withheld, ID_ABOVE, page.locator('img.bubble__image'))
  const after = await readThreadMetrics(page)

  // NON-VACUITY. Without this the test passes against an app in which the thumbnail never resolved and the
  // thread therefore never moved — which is indistinguishable, at the bottom, from the behaviour under
  // test. A floor rather than an equality: the quantity is a drawn box, not a contract.
  expect(after.scrollHeight - before.scrollHeight).toBeGreaterThanOrEqual(THUMBNAIL_GROWTH_PX)

  // The criterion, asserted with NO frame pushed and no send in between — "with no intervening render to
  // snap them back". Every other re-pin proof in this file rides a screen render; this one has none
  // available, which is exactly why it is a proof of a different mechanism.
  await expectPinnedToBottom(page)
})

test('a thumbnail resolving leaves a scrolled-up reader where they were, above them or below them', async ({
  launchPairedApp
}) => {
  const withheld = withheldThumbnails()
  const { page, app, daemon } = await launchPairedApp({
    buildReplyFrames: withheld.buildReplyFrames
  })

  // Two pictures in one thread, one on each side of where the reader will park: the first ahead of the
  // primer's twenty turns, the second behind them. Both are withheld, so both rows are still empty when the
  // reader takes their position.
  await sendWithThumbnail(page, app, ID_ABOVE, ABOVE_TEXT)
  await primeOverflowingThread(page)
  await sendWithThumbnail(page, app, ID_BELOW, BELOW_TEXT)

  // Park part-way up — programmatic for the reasons the tests above give (it fires the same DOM `scroll`
  // event the production handler listens to, with no hover position and no smooth-scroll timing), at 40%
  // rather than at the top. Zero is the ONE offset at which scroll anchoring does not run at all, so
  // parking there would make the picture-above arm below vacuous in the exact direction that matters.
  const settled = await readThreadMetrics(page)
  const parked = Math.round(settled.scrollHeight * 0.4)
  await page.locator('.conversation__thread').evaluate((el, top) => {
    el.scrollTop = top
  }, parked)
  await settleScrollEvent(page)

  // The preconditions: the reader really is where the test put them, that place is neither the top nor
  // anywhere near the bottom, and each picture really is on the side of them this test claims.
  const before = await readThreadMetrics(page)
  expect(before.scrollTop).toBe(parked)
  expect(before.scrollTop).toBeGreaterThan(0)
  expect(distanceFromBottom(before)).toBeGreaterThan(before.clientHeight)
  expect(await rowPosition(thumbnailBubble(page, ABOVE_TEXT))).toBe('above')
  expect(await rowPosition(thumbnailBubble(page, BELOW_TEXT))).toBe('below')

  // --- The picture BELOW the reader. Content growing out of sight below moves nothing: this is the arm
  // where the criterion's literal wording holds, so the offset is asserted as an exact equality. It is also
  // the over-reach guard — a mechanism that re-pinned on any content growth passes the first test and yanks
  // the reader to the bottom right here. ---
  await resolveThumbnail(
    page,
    daemon,
    withheld,
    ID_BELOW,
    thumbnailBubble(page, BELOW_TEXT).locator('img.bubble__image')
  )
  const afterBelow = await readThreadMetrics(page)
  expect(afterBelow.scrollHeight - before.scrollHeight).toBeGreaterThanOrEqual(THUMBNAIL_GROWTH_PX)
  expect(afterBelow.scrollTop).toBe(before.scrollTop)

  // --- The picture ABOVE the reader. Here the offset MUST move, by exactly what was inserted above the
  // viewport, or the reader ends up looking at different content — so the assertion is the reader-facing
  // quantity instead: a row that was on screen keeps its viewport-relative top. ---
  const referenceRow = page
    .locator('.conversation__thread .bubble[data-thread-role="assistant"]')
    .nth(await firstFullyVisibleAssistantRow(page))
  const referenceTopBefore = await viewportTop(referenceRow)

  await resolveThumbnail(
    page,
    daemon,
    withheld,
    ID_ABOVE,
    thumbnailBubble(page, ABOVE_TEXT).locator('img.bubble__image')
  )
  const afterAbove = await readThreadMetrics(page)

  const grewBy = afterAbove.scrollHeight - afterBelow.scrollHeight
  expect(grewBy).toBeGreaterThanOrEqual(THUMBNAIL_GROWTH_PX)
  // The reader's place, held: the row under their eyes did not move on screen.
  expect(await viewportTop(referenceRow)).toBeCloseTo(referenceTopBefore, 0)
  // The mechanism, made visible: the offset advanced by exactly what was inserted above it. Asserted so
  // that a future reader of a failure can tell "the place moved" from "nothing compensated at all".
  expect(afterAbove.scrollTop - afterBelow.scrollTop).toBeCloseTo(grewBy, 0)
  // And NOT yanked to the bottom — the same distance as before, still a full viewport clear of it.
  expect(distanceFromBottom(afterAbove)).toBeCloseTo(distanceFromBottom(afterBelow), 0)
  expect(distanceFromBottom(afterAbove)).toBeGreaterThan(AT_BOTTOM_TOLERANCE_PX + SUBPIXEL_PX)
})

// ---------------------------------------------------------------------------------------------------
// #1049 — the direction anchoring is indifferent to: a thumbnail resolving in the reader's OWN last row.
//
// This is the case #1046 left open, and it is the one a reader hits with their own message rather than one
// further up the thread. Everything about the settle is identical — the leaf's `useState` flip, then a
// decode-and-layout with no React render anywhere — but the growth lands BELOW the reader, and scroll
// anchoring holds a node's position against growth ABOVE it. The same 172px of drift was measured with and
// without `overflow-anchor: none`, so the browser is not going to close this one.
//
// WHAT CLOSES IT IS THE PIN'S OWN RESIZE OBSERVER, running the SAME guarded write the dep-free layout effect
// runs (`reassertPinnedToBottom`). The hinge is the existing flag, not a new one: growth re-pins while
// `following` is set and writes nothing while it is clear. So the test below and the picture-below arm of the
// test above are the two halves of one condition, and the second is what reddens if the mechanism ever
// re-pins on content growth unconditionally.

test('a thumbnail resolving in the last row leaves a bottom-resting reader at the bottom', async ({
  launchPairedApp
}) => {
  const withheld = withheldThumbnails()
  const { page, app, daemon } = await launchPairedApp({
    buildReplyFrames: withheld.buildReplyFrames
  })

  // THE STAGING ORDER IS THE REVERSE of the picture-above test's, and that reversal is the whole scenario:
  // the primer's twenty turns go in FIRST so the picture's row is genuinely the last one in the thread. Its
  // bytes are withheld, so the row it mounts draws nothing and reserves nothing while the reader rests
  // beneath it.
  await primeOverflowingThread(page)
  await sendWithThumbnail(page, app, ID_LAST, LAST_TEXT)

  // The preconditions. The reader is genuinely resting at the bottom (the primer's overflow gate has already
  // proved the thread can scroll at all), and the picture is genuinely in the FINAL row — which, with the
  // reader at the bottom, is what makes the growth necessarily extend past the fold.
  //
  // `'overlapping'` rather than `'below'`, deliberately: the last row of a bottom-resting thread is on
  // screen, so asserting `'below'` here would fail as a precondition rather than as a finding.
  await expectPinnedToBottom(page)
  expect(await rowPosition(thumbnailBubble(page, LAST_TEXT))).toBe('overlapping')
  expect(await isLastRow(thumbnailBubble(page, LAST_TEXT))).toBe(true)

  const before = await readThreadMetrics(page)
  await resolveThumbnail(
    page,
    daemon,
    withheld,
    ID_LAST,
    thumbnailBubble(page, LAST_TEXT).locator('img.bubble__image')
  )
  const after = await readThreadMetrics(page)

  // NON-VACUITY, and it carries more weight here than anywhere else in this file. At the bottom, "the
  // thumbnail never resolved" is indistinguishable from "the fix worked" — both leave the distance at zero —
  // so without proving the content actually grew first, this test passes against an app with no mechanism in
  // it at all. A floor rather than an equality: the quantity is a drawn box, not a contract.
  expect(after.scrollHeight - before.scrollHeight).toBeGreaterThanOrEqual(THUMBNAIL_GROWTH_PX)

  // The criterion, asserted with NO frame pushed, no send and no other screen render in between — the drift
  // this closes is exactly the window before something unrelated snaps the reader back. Against `main` this
  // reads 172px; the observer takes it to zero.
  await expectPinnedToBottom(page)
})
