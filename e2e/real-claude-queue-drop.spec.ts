import { type Page } from '@playwright/test'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'

// Tier-3 real-claude e2e (#446, split from #431, twin of #445) — the LIVENESS NET for queue-while-busy-
// then-drop over the real stack. The queued backlog only means something against a GENUINELY running turn:
// a second send arrives while the real daemon is mid-turn, the daemon HOLDS it and pushes `queue_state`,
// the client renders it as a queued row, and dropping it dequeues BEFORE the turn ever drains to it. It
// clones real-claude.spec.ts's precondition (pair against a freshly-spawned real `pyry` on `--model haiku`,
// bridged to the built Electron window through #251's content-blind routing relay, then CREATE the
// conversation through the New-discussion FAB and reach the connected `.conversation` with Send enabled)
// and swaps only the turn body: start a long turn, enqueue a second send while it streams, drop the queued
// row before drain, then let the turn finish and prove the dropped send produced no assistant turn.
//
// The client wiring is already shipped and fake-stack-proven; this adds NO production `src/` change. The
// fake-stack twin (#427 queued-backlog-interrupt.spec.ts, over the #145/#292..#296 chain) proves the client
// WIRING — the composer's send gate is connection-only (composerAvailability returns canSend:true on the
// `connected` arm and NOWHERE else, no turn-phase gate), so a send issued mid-turn goes to the daemon and
// enqueues; `queue_state` renders into QueuedBacklog rows (data-thread-role="queued" inside
// .conversation__queued), each with a drop control (aria-label "Drop queued message" → dropQueuedMessage,
// firing the ungated dequeueMessage command). But in #427 that queue_state / turn_state is driven by
// `daemon.pushFrame` — a scripted state, not claude actually running a turn. This spec is the liveness
// proof: on the real stack the enqueue-then-dequeue must come from the REAL daemon holding a REAL, streaming
// turn's second send and then removing it on the drop.
//
// REAL-CLAUDE DIVERGENCES from the fake twin #427 (the only deltas — mirrors the real-claude-interrupt.spec.ts
// and real-daemon-workspace.spec.ts doc discipline):
//   - NO `daemon.pushFrame`: the real daemon owns the queue + turn lifecycle end-to-end. `queue_state`
//     (holding then omitting msg2) and `turn_state{thinking → responding → idle}` / `turn_end` are emitted
//     by claude actually running, not by a scripted push. So the queued row appearing then leaving after the
//     drop is a real transition, not a reflected one.
//   - NO outbound frame capture: the daemon is a SEPARATE process behind the content-blind relay, so #427's
//     in-process outbound capture (capturingQueueInterruptFake, dequeueFramesMatching, interruptFrames, the
//     expect.poll on captured envelopes) is unavailable — the SAME divergence the sibling real-* specs
//     document. Every assertion reads DOM text / visibility / counts only.
//   - Accepted limitation (OQ-a): DOM-only over the real wire cannot DETERMINISTICALLY distinguish "drop won
//     the race" from "drain won" in the adversarial continuous-busy timing (turn 1 ends and drains msg2
//     within the drop-reflect window). The mitigation is a turn-1 prompt long enough that the drop lands
//     with tens of seconds of runway remaining (steps 5/8 assert turn 1 is still running around the drop, so
//     the row left because of the drop, not a drain). Step 11 is a best-effort confirmation, not a causation
//     proof; do NOT try to strengthen it into one by asserting reply content.
//
// It inherits the real-claude harness for free: `spawnClaude` defaults to true (claude on `--model haiku`),
// so setting NO `test.use(...)` gives the claude-spawning mode AND the full skip-gate (resolves `pyry` +
// `claude` on PATH + a credential BEFORE creating any resource; testInfo.skip on any miss). It is
// auto-discovered by playwright.real-claude.config.ts's `testMatch: /real-.*\.spec\.ts$/` (runs under
// `npm run e2e:real-claude`, the operator pre-ship gate) and IGNORED by the default `npm run e2e` (whose
// filename `testIgnore` excludes every `real-*` spec). When the real stack is unavailable the spec SKIPS
// cleanly — an unrun test is the correct outcome there, not a hard failure.
//
// SECRET HYGIENE (AC5): every assertion reads DOM text / visibility / counts only; both prompts are
// non-secret nonce literals, model output NEVER asserted; the pairing payload is built the real-claude.spec.ts
// way and never echoed into a message. No failure diagnostic serialises the token, keys, or the transcript;
// trace / screenshot / video stay disabled (the real-claude config already disables all three).

// --- Selectors (verbatim from real-claude.spec.ts) ---------------------------
// A real v2 daemon fans the STRUCTURED stream to interactive conns, rendered into the timeline as
// data-thread-role="assistant".
const ASSISTANT_ROW = '[data-thread-role="assistant"]'
// The streaming cursor ▎ (U+258E) is a child <span> INSIDE the assistant bubble, so a row's textContent
// includes it even while the reply text is still empty. Strip it before the non-empty check.
const CURSOR_CHAR = '▎'
// turn_end appends a turnBoundary that drops the cursor — its absence is the per-turn quiesce signal.
const CURSOR_SELECTOR = '.bubble__cursor'

// --- Timeouts (verbatim from real-claude.spec.ts) ----------------------------
// Generous to absorb real daemon startup latency (registration on /v1/server is async after spawn) plus a
// handshake re-dial or two; Send-enabled is the readiness signal.
const HANDSHAKE_TIMEOUT_MS = 45_000
// One turn = cold PTY claude (spawn + model load + first reply). Also bounds the enqueue/dequeue waits and
// the drain-to-quiesce wait — turn 1 must both start streaming AND fully complete within this budget.
const TURN_TIMEOUT_MS = 120_000
// Whole spec: handshake + one long turn (streamed AND drained) + the enqueue/drop round-trips + headroom.
const SPEC_TIMEOUT_MS = 300_000

// --- New constant (from #445) ------------------------------------------------
// The content-stability window: after the two quiesce signals fire, hold this long and re-read to prove no
// second turn ran for the dropped send. Proving a NEGATIVE has no event to await, so a fixed settle + re-read
// is the correct and only tool; kept small — it is pure overhead (OQ-d).
const SETTLE_MS = 3_000

/**
 * Count assistant rows whose text is non-empty once the streaming cursor ▎ is stripped. Runs in the page
 * context. Content-agnostic liveness: a naive "row exists" or unstripped-textContent check would pass on an
 * empty streaming bubble (the cursor span is inside the row).
 */
function nonEmptyAssistantCount(page: Page): Promise<number> {
  return page
    .locator(ASSISTANT_ROW)
    .evaluateAll(
      (els, cursor) =>
        els.filter((el) => (el.textContent ?? '').split(cursor).join('').trim().length > 0).length,
      CURSOR_CHAR
    )
}

test('real claude enqueues a mid-turn send, drops it before drain, and runs no turn for it', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // A per-run nonce so reruns differ (defeats any accidental reply caching); content is NEVER asserted on
  // (Date.now() is fine in a Playwright spec). msg1 is a deliberately-long, cheap haiku prompt kept LONG so
  // turn 1 is still streaming when msg2 enqueues AND is dropped — a turn that finishes before the drop lands
  // is the primary flakiness risk (OQ-b): if step 8 shows turn 1 finishing coincidentally in the drop-reflect
  // window, raise the count; if step 9 flakes on a drain-timeout, halve it. msg2 is a short, distinct queued
  // send whose text is matched only to scope the drop control (routing/display content we control, not model
  // output).
  const runNonce = Date.now()
  const msg1 = `Count from 1 to 300, one number per line, and nothing else. run=${runNonce}`
  const msg2 = `A queued task to drop. run=${runNonce}`

  // --- Precondition (AC1): pair against the real daemon, dial the test relay's /v1/client leg. ---
  // Verbatim from real-claude.spec.ts: the app dials `${relay.url}/v1/client` unchanged (NOT pyry's emitted
  // prod relay); the loopback affordance (#97) accepts the ws://127.0.0.1 relay.
  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  const pasteBox = page.locator('textarea[aria-label="Pairing code"]')
  const fingerprint = page.locator('[aria-label="Server key fingerprint"]')
  const conversation = page.locator('.conversation')
  const sendButton = page.getByRole('button', { name: 'Send' })
  const composer = page.getByPlaceholder('Message…')
  // The interrupt affordance's accessible name (InterruptButton's aria-label), present ONLY while the turn
  // runs (isTurnRunning === thinking || responding), null at idle — the "turn 1 still running" gate.
  const interruptButton = page.getByRole('button', { name: 'Stop the running turn' })
  // Queued-flow selectors (verbatim from the #427 fake twin): queued rows live in .conversation__queued and
  // carry data-thread-role="queued"; the drop control is an icon button named "Drop queued message". Scoping
  // by container keeps them distinct from msg2's optimistic .message-row--user timeline echo (see below).
  const queuedBubbles = page.locator('[data-thread-role="queued"]')
  const queuedRow = (text: string) =>
    page.locator('.conversation__queued .message-row--user', { hasText: text })
  const dropButton = (text: string) =>
    queuedRow(text).getByRole('button', { name: 'Drop queued message' })

  await expect(pasteBox).toBeVisible()
  await pasteBox.fill(payload)
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(fingerprint).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()

  // --- Create the conversation THROUGH THE UI (#448) — the operator flow, not a pre-bound seed. ---
  // The seeded row renders only after the real daemon's `conversations` reply arrives on the connected edge,
  // so its visibility IS the connected gate; only then click the FAB, which fires a real create at the real
  // daemon and navigates on `conversation_created`. Send is enabled once the thread is connected.
  await expect(page.locator('.channel-list__row-open')).toBeVisible({
    timeout: HANDSHAKE_TIMEOUT_MS
  })
  await page.getByRole('button', { name: 'New discussion' }).click()
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Start turn 1 (AC2 setup) — a real, streaming turn to enqueue against. ---
  await composer.fill(msg1)
  await sendButton.click()

  // --- Gate turn 1 genuinely running (AC2). ---
  // The interrupt affordance is visible only while the turn runs (thinking || responding); a live cursor
  // strengthens "running" to "streaming" (claude reached `responding`, real output). Safe because the prompt
  // is deliberately long. (OQ-c: if live timing ever shows the cursor too transient to catch on a fast
  // responding→idle path, fall back to the interruptButton-visible gate alone — enqueue is valid against a
  // `thinking` turn too.)
  await expect(interruptButton).toBeVisible({ timeout: TURN_TIMEOUT_MS })
  await expect(page.locator(CURSOR_SELECTOR).first()).toBeVisible({ timeout: TURN_TIMEOUT_MS })

  // --- Send msg2 mid-turn (AC2) — Send is enabled (canSend on `connected`, no turn-phase gate), so the frame
  // goes to the daemon while turn 1 runs. submitMessage ALSO dispatches an unconditional optimistic userText
  // echo, so msg2 renders a data-thread-role="user" timeline row TOO; that is expected and harmless — every
  // queued-flow assertion below scopes to data-thread-role="queued" / .conversation__queued, distinct from
  // the `user` echo, so there is no collision. ---
  await composer.fill(msg2)
  await sendButton.click()

  // --- Assert msg2 enqueues (AC2) — the ENQUEUE liveness proof: the real daemon held msg2 mid-turn and
  // pushed queue_state, rendering exactly one queued row. A timeout here means the "a mid-turn send enqueues"
  // premise is broken (a daemon-side queue regression, or the client send-gate drifted to turn-phase); a
  // genuine failure — do NOT soften it, file separately. ---
  await expect(queuedBubbles).toHaveCount(1, { timeout: TURN_TIMEOUT_MS })
  await expect(queuedRow(msg2)).toBeVisible()

  // --- Drop-before-drain tightening, pre-drop (AC4 support). ---
  // Turn 1 is still running at the moment we drop → the drop is issued within turn 1's lifetime.
  await expect(interruptButton).toBeVisible()

  // --- Drop the queued row (AC3) — non-optimistic: the drop only emits a dequeue_message frame; the row
  // leaves on the daemon's next queue_state. ---
  await dropButton(msg2).click()

  // --- Assert the row leaves (AC3) — the DEQUEUE liveness proof: the real daemon removed msg2 and pushed a
  // fresh queue_state omitting it. A timeout here is a real dropQueuedMessage/dequeue_message regression (or
  // the daemon ignored the drop) — file separately. ---
  await expect(queuedBubbles).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- Drop-before-drain proof, post-drop (AC4 support). ---
  // Turn 1 is STILL running after the row left. Because msg2 left the queue WHILE turn 1 was running, turn 1
  // cannot later drain to it (drain happens only at turn end) → the row left because of the drop, not a
  // drain. (If this flakes, turn 1 finished too early — raise msg1's count; see OQ-b.)
  await expect(interruptButton).toBeVisible()

  // --- Let turn 1 drain, wait for quiesce (AC4 setup) — do NOT interrupt; turn 1 finishes naturally. ---
  // Two independent DOM reflections of the turn ending, different fabric: the button retracts from the real
  // daemon's turn_state{idle}; the cursor drops from turn_end. This gate also ABSORBS any trailing chunk of
  // turn 1, which is why the settled baseline is captured AFTER it, not before.
  await expect(interruptButton).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- Capture the settled baseline STRICTLY AFTER the quiesce gate (AC4). ---
  // Both quiesce signals have fired, so turn 1 is over — no further chunks arrive for it — making this
  // baseline race-free. At least turn 1's own reply must have streamed.
  const settled = await nonEmptyAssistantCount(page)
  expect(settled).toBeGreaterThanOrEqual(1)

  // --- Assert the dropped send produced NO assistant turn (AC4). ---
  // Hold the settle window, then assert all three: the assistant count did not grow (no new reply), and
  // neither running affordance returned (no second turn started). Together: exactly the first send's turn
  // ran; the dropped msg2 never became an assistant reply.
  await page.waitForTimeout(SETTLE_MS)
  expect(await nonEmptyAssistantCount(page)).toBe(settled)
  await expect(interruptButton).toHaveCount(0)
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0)
})
