import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  Envelope,
  QueuedItem,
  QueueStatePayload,
  TurnStatePayload,
  DequeueMessagePayload,
  SendMessagePayload,
  WireTurnState
} from '../src/shared/wire/types'

// Fake-stack UI e2e for three already-shipped, server-push-driven flows the queue/turn wiring exposes,
// none of it covered today (#427, sibling of #425/#426/#451/#452): the QUEUED-BACKLOG render (#294 over
// the replacement-truth queue store #293), DROPPING a queued message (#296/#300), and INTERRUPTING a
// running turn (#215 indicator + #307 control). It drives them end-to-end through renderer → IPC → main →
// Noise wire → decode (the send half) and back over daemon.pushFrame (the reflecting-state half) on the
// launchPairedApp fixture (#433). Zero production code.
//
// ONE test() block, ONE launch (the run-config precedent, NOT #423/#426's two-block split). Those siblings
// split only for one-way-per-launch state (a promotion that can't un-happen; the FIFO reject residue).
// This ticket has no such trap: the queue store and the timeline `phase` are independent and each is fully
// re-settable within one launch by pushing a fresh snapshot/state, so a single continuous drive covers
// every AC and doesn't triple the ~60s real-handshake launch cost.
//
// THREE load-bearing facts a naive clone of the template would miss (read from the code, not inferred):
//   1. queue_state MUST carry conversation_id === SEEDED_ROW.id. ConversationScreen reads
//      selectBacklogFor(activeConversation.id) — the read #1009 hoisted out of the region's own control, so
//      the routing is unchanged — and list-open records the clicked SEEDED_ROW as active
//      (PairedShell.tsx), so activeConversation.id === 'seed-conversation'. A snapshot under any other id
//      lands in the store but is selected by nothing → zero rows render, SILENTLY (the run-config
//      session-id gate analogue). turn_state has no such gate (timelineBridge drops its conversation_id,
//      ADR 0004) — set it to SEEDED_ROW.id anyway for realism.
//   2. subscribeQueue resets backlogs on every `connected` event (the #197 reconnect reconcile, scoped
//      by #1138 to the conversations the reconnecting server has listed — with one server that is every
//      conversation this spec touches). The fixture's completion signal (Send enabled) is gated on that
//      same `connected`, so by the time launchPairedApp resolves `connected` has already fired; no
//      rekey/reconnect happens in this spec, so no further `connected` wipes the backlog. Push
//      queue_state ONLY AFTER launch resolves — never before.
//   3. Interrupt phase-gating: isTurnRunning(phase) is `thinking || responding`, and since #648 the same
//      running-turn reading gates the ThinkingIndicator too. So turn_state{thinking} lights BOTH the
//      interrupt button and the running indicator; turn_state{idle} returns `phase` to idle and retracts
//      BOTH — the crisp "both gone" assertion. turn_end is NOT the quiescing signal (it appends a turn
//      boundary but does not reset `phase`, threadTimeline.ts); only turn_state{idle} retracts the
//      phase-gated controls. TurnPhase has no literal `running` — do not push that value.
//      SINCE #650 THE TWO CONTROLS NO LONGER SHARE ONE GATE, and the delivered-echo plant below is exactly
//      where that bites: the composer's accept opens the working indicator LOCALLY, through a scalar beside
//      `phase` that the interrupt control cannot see. So after the plant the indicator is already mounted
//      while `phase` is still idle, and the interrupt leg's "thinking mounts the running indicator" half
//      would assert against an element that was on screen the whole time. The plant closes its own window
//      with a turn_state{idle} to keep that half honest — see the AC block.
//
// TWO-PART ASSERTION PER MUTATION (both drop and interrupt are non-optimistic — dropQueuedMessage.ts /
// sendInterrupt.ts only emit a frame, the store is never mutated locally): (a) act, (b) expect.poll the
// captured OUTBOUND frame — the send-half proof (#425/#456 precedent), because the DOM alone cannot prove
// the send landed — then (c) daemon.pushFrame the reflecting state and assert the DOM change (the dropped
// row leaves only when the fresh queue_state omitting it arrives; the interrupt controls retract only when
// turn_state{idle} arrives).
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM text/roles/counts and
// captured wire frames only; queued_msg_id / conversation_id / the item texts are non-secret routing &
// display literals; the pairing plumbing (synthetic token, fake static key) lives in launchPairedApp and is
// never echoed. No failure diagnostic serialises a token, key, or plaintext.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process, so a short headroom over
// Playwright's 5s default suffices for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes
// pushes by envelope id, so one fixed REPLY_ENVELOPE_ID is reused across every pushed frame.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// One delivered user row (planted via a real composer Send — the fake no-ops send_message, the optimistic
// echo renders) to contrast the queued rows against. Its text differs from both queued texts so the
// role-partition assertion is unambiguous by text as well as by data-thread-role.
const DELIVERED_TEXT = 'A delivered user message'

// Two queued items with distinct texts + ids. "Keyed by queued_msg_id" is proven behaviorally by the
// dequeue step (a DOM React key is not an inspectable attribute; correct keying = removing exactly the
// omitted row while the other stays).
//
// #1213: each item also carries the `message_id` of the `send_message` that produced it
// (pyrycode#2092) — the key that lets a drop take the sending window's own timeline echo out too. A's is
// NOT a literal: it is the id the renderer minted for its real composer send, read off the captured frame
// at run time (`sentMessageId` below), because a client-minted UUID cannot be known in advance and a
// fabricated one would correlate with nothing. B's IS a fabricated literal, and deliberately — it is the
// "an item whose id matches no local echo" case, which must remove nothing.
//
// ⭐ NOTHING TYPECHECKS `e2e/` (no tsconfig includes it; Playwright strips types with esbuild), and
// `message_id` is OPTIONAL, so a fixture that omitted it would compile, run, and simply fail to correlate
// with no red anywhere. That is why it is spelled out here rather than left to the type to demand.
const QUEUED_A: Omit<QueuedItem, 'message_id'> = {
  queued_msg_id: 1,
  text: 'First queued task',
  ts: FIXED_TS
}
const QUEUED_B: QueuedItem = {
  queued_msg_id: 2,
  text: 'Second queued task',
  ts: FIXED_TS,
  message_id: 'an-id-no-echo-in-this-window-carries'
}

// Spec-local frame builders (the seedConversationsFrame idiom): each seals one pushed envelope via the
// production codec, deterministic id/ts. Both carry conversation_id === SEEDED_ROW.id (fact 1).

// A replacement-truth queue snapshot — the whole current backlog, not a delta (queueStore #293).
function queueStateFrame(items: readonly QueuedItem[]): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'queue_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, queued: [...items] } satisfies QueueStatePayload
  })
}

// The coarse turn-phase scalar (thinking mounts the interrupt controls, idle retracts them — fact 3).
function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })
}

/**
 * The spec-local capturing reply factory (the #456 capturingWorkspaceFake shape). The fake daemon runs in
 * the TEST process (via the loopback forwarder), so a spec-held `captured` array written here is directly
 * readable from the test body. Only list_conversations needs a reply (the seeded launch row); send_message
 * (the delivered-echo plant), dequeue_message and interrupt are all captured for the send-half proof but
 * need NO reply — their reflecting state (queue_state / turn_state) is pushed explicitly by the test. The
 * closure is stateless (discrimination is by envelope `type` only); the double-decode (capture, then
 * dispatch) is pure and harmless, exactly as run-config's factory does.
 */
function capturingQueueInterruptFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    switch (env.type) {
      case 'list_conversations':
        return [seedConversationsFrame()]
      default:
        return []
    }
  }
}

// Count captured dequeue_message frames whose payload deep-equals `expected`. `.toBe(1)` proves BOTH
// send-once AND the exact { conversation_id, queued_msg_id } at once — the payload is fully deterministic
// (no opaque token, unlike modal_answer #426), so a whole-payload deep-equal is correct here.
function dequeueFramesMatching(captured: Envelope[], expected: DequeueMessagePayload): number {
  return captured.filter((e) => e.type === 'dequeue_message' && isDeepStrictEqual(e.payload, expected))
    .length
}

// #1213: the `message_id` the renderer minted for the composer send carrying `text`. The correlation key
// is client-minted (crypto.randomUUID) so the spec cannot know it in advance — it reads it back off the
// captured outbound frame, which is exactly the value the real daemon would relay into its queue_state.
// Returns undefined until the frame lands, so it is safe to poll on.
function sentMessageId(captured: Envelope[], text: string): string | undefined {
  const frame = captured.find(
    (e) => e.type === 'send_message' && (e.payload as SendMessagePayload).text === text
  )
  return frame === undefined ? undefined : (frame.payload as SendMessagePayload).message_id
}

// Count captured interrupt frames. The interrupt payload is bare `{}` (no ids to match), so match by
// `type` only, never a payload deep-equal; `.toBe(1)` proves send-once.
function interruptFrames(captured: Envelope[]): number {
  return captured.filter((e) => e.type === 'interrupt').length
}

test('queued backlog renders distinctly, drops a queued message, and interrupts a running turn', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: capturingQueueInterruptFake(captured)
  })

  // Locators scoped by container so the shared .message-row--user / .bubble--user markup never collides:
  // queued rows live in .conversation__queued and carry data-thread-role="queued"; the delivered echo lives
  // in the timeline and carries data-thread-role="user". That role difference IS the AC "distinct from
  // delivered" seam — assert on the role attribute, never the shared class.
  const queuedRow = (text: string) =>
    page.locator('.conversation__queued .message-row--user', { hasText: text })
  const dropButton = (text: string) =>
    queuedRow(text).getByRole('button', { name: 'Drop queued message' })
  const queuedBubbles = page.locator('[data-thread-role="queued"]')
  const deliveredUser = page.locator('[data-thread-role="user"]')
  // #1213: one delivered echo, addressed by its text. The three texts in this spec share no substring, so
  // Playwright's case-insensitive SUBSTRING `hasText` cannot select two rows at once.
  const deliveredEcho = (text: string) =>
    page.locator('[data-thread-role="user"]', { hasText: text })
  const interruptButton = page.getByRole('button', { name: 'Stop the running turn' })
  const runningIndicator = page.locator('.conversation__thinking')

  // --- AC: queue render (distinct from delivered) ---
  // Plant one delivered user row: the fake no-ops send_message, so the optimistic echo renders on its own
  // with no daemon reply. Assert it lands BEFORE pushing queue_state (the echo is synchronous → no race).
  await page.getByPlaceholder('Message…').fill(DELIVERED_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(deliveredUser).toHaveCount(1)

  // #1213: a SECOND real composer send, and this one is the message the daemon will report as queued. It
  // has to go through the composer rather than be fabricated, because only a real send mints the
  // `message_id` that both the wire frame and the optimistic echo carry — which is the whole correlation
  // this ticket establishes. The fake no-ops send_message here too, so this row is an echo and nothing else.
  await page.getByPlaceholder('Message…').fill(QUEUED_A.text)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(deliveredUser).toHaveCount(2)
  // Read the minted id back off the captured frame. `.poll` because the send crosses IPC → main → Noise →
  // the loopback fake, so the frame lands a tick or two after the click.
  await expect
    .poll(() => sentMessageId(captured, QUEUED_A.text), { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual(expect.any(String))
  const queuedMessageId = sentMessageId(captured, QUEUED_A.text)

  // #650: close the working-indicator window the accept above opened locally (fact 3). The fake no-ops
  // send_message, so nothing else ever would — and a real daemon ends every turn with this frame anyway,
  // including one it answered with nothing. The zero-count gate is the load-bearing half: it is what makes
  // the interrupt leg's indicator assertion measure a MOUNT rather than an element already on screen.
  daemon.pushFrame(turnStateFrame('idle'))
  await expect(runningIndicator).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // Push the queue snapshot (AFTER launch resolved → past the `connected` backlog reset, fact 2; under
  // SEEDED_ROW.id → selected by the active-conversation backlog, fact 1). The live subscription re-renders.
  // #1213: A carries the id the composer just minted, so it correlates with the echo above — the shape a
  // real daemon produces for a message THIS window sent mid-turn. B carries an id no echo here holds.
  daemon.pushFrame(queueStateFrame([{ ...QUEUED_A, message_id: queuedMessageId }, QUEUED_B]))
  await expect(queuedBubbles).toHaveCount(2, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(queuedRow('First queued task')).toBeVisible()
  await expect(queuedRow('Second queued task')).toBeVisible()
  // The two roles partition: the delivered rows are untouched by the queue push (the AC "distinct" seam).
  // Both echoes are on screen HERE, which is what makes the post-drop absence below a real mutation check
  // rather than an assertion that was already true at launch.
  await expect(deliveredUser).toHaveCount(2)
  await expect(deliveredEcho(QUEUED_A.text)).toHaveCount(1)
  await expect(deliveredEcho(DELIVERED_TEXT)).toHaveCount(1)

  // --- AC: dequeue (non-optimistic — send half proven from the captured frame, then reflect) ---
  await dropButton('First queued task').click()
  await expect
    .poll(() => dequeueFramesMatching(captured, { conversation_id: SEEDED_ROW.id, queued_msg_id: 1 }), {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBe(1)
  // --- #1213: the ECHO goes at the click, unlike the row. ---
  // The poll above is the positive wait this absence needs: it reads the drop's OWN effect (the captured
  // dequeue frame), is unreachable from the pre-click state, and only once it has fired can the removal
  // that rides the same click have run. A bare toHaveCount(0) here would otherwise pass before the click's
  // async work resolved.
  await expect(deliveredEcho(QUEUED_A.text)).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  // ONLY the dropped message's echo goes: the unrelated delivered row is still there, still attributed.
  await expect(deliveredEcho(DELIVERED_TEXT)).toHaveCount(1)
  await expect(deliveredUser).toHaveCount(1)

  // Row A is NOT gone yet (non-optimistic — #296 AC3, unchanged by #1213: the daemon owns the backlog).
  // Push the fresh replacement snapshot omitting A → it leaves.
  daemon.pushFrame(queueStateFrame([QUEUED_B]))
  await expect(queuedRow('First queued task')).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(queuedRow('Second queued task')).toBeVisible()
  await expect(queuedBubbles).toHaveCount(1)
  // The drain half of AC4, from the other direction: that replacement snapshot also removed B's item from
  // nothing — no echo left the thread on a snapshot, only on the click above.
  await expect(deliveredUser).toHaveCount(1)

  // --- AC: interrupt (thinking lights both controls; idle retracts both) ---
  daemon.pushFrame(turnStateFrame('thinking'))
  await expect(interruptButton).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(runningIndicator).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // Non-optimistic: the interrupt helper only emits a bare `interrupt` frame; the controls retract only on
  // the daemon's turn_state{idle}, not on the click.
  await interruptButton.click()
  await expect.poll(() => interruptFrames(captured), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)

  daemon.pushFrame(turnStateFrame('idle'))
  await expect(interruptButton).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(runningIndicator).toHaveCount(0)
})
