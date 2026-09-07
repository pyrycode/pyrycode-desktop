import { type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// #483/T9 — exercise the stream-json interactive runner, matching production (the Mac daemon runs
// interactive_runner: stream-json). KNOWN RED on stream, left as the live oracle for pyrycode#1189: the
// stream runner emits no queue_state, so a mid-turn send never renders as a queued/droppable row and the
// "queued row count == 1" assertion (line ~212) times out. The message is NOT lost — it is held and runs
// after turn 1 — only the queued-backlog UI is missing. Do NOT revert this to PTY or soften the assertion:
// it must stay red until the daemon emits queue_state on the stream path, at which point desktop#483 hits 8/8.
test.use({ interactiveRunner: 'stream-json' })

// Tier-3 real-claude e2e (#446, split from #431, twin of #445) — the LIVENESS NET for queue-while-busy-
// then-drop over the real stack. The queued backlog only means something against a GENUINELY running turn:
// a second send arrives while the real daemon is mid-turn, the daemon HOLDS it and pushes `queue_state`,
// the client renders it as a queued row, and dropping it dequeues BEFORE the turn ever drains to it. It
// clones real-claude.spec.ts's precondition (pair against a freshly-spawned real `pyry` on `--model haiku`,
// bridged to the built Electron window through #251's content-blind routing relay, then CREATE the
// conversation through the New-discussion FAB and reach the connected `.conversation` with Send enabled)
// and swaps only the turn body: start a turn, enqueue a second send while it runs, drop the queued row
// before drain, then release the turn and prove the dropped send produced no assistant turn.
//
// THE HOLD IS A TEST-OWNED GATE FILE (#487), not a long prompt. A long TEXT turn is not viable on
// `--model haiku`: it streams the whole reply in under the ~2s transcript-bind cold-start, so the turn
// collapses into one burst and no running-turn window is observable (the same root the interrupt fix #483
// hit). A bare `sleep` is non-deterministic (haiku may set run_in_background:true and the turn returns at
// once). A chatty per-second loop stays foreground but FLOODS the ordered frame stream, so the msg2
// `queue_state` control frame lands tens of seconds late (measured ~60s on 2026-07-18), racing the turn.
// So turn 1 runs an ORDINARY Bash tool that blocks on a file the test owns —
// `until [ -f <gate> ]; do sleep 0.2; done` — and the spec creates `<gate>` only AFTER it has enqueued
// msg2, asserted the queued row, dropped it, and asserted the dequeue. The turn is then a real, ordinary
// tool-running turn (no permission path), held open deterministically and released by a filesystem event,
// with no `sleep`/timing anywhere. The poll loop is SILENT (no per-second echo) precisely so it does NOT
// flood the frame stream; it stays under the ptyrunner 30s PTY-quiet watchdog because the test releases it
// within a few seconds. A permission-block hold would also be deterministic, but it routes turn 1 through
// the special permission code path and would blind-spot the ORDINARY turn lifecycle — the common, more
// important case; that path is `real-claude-permission-modal.spec.ts`'s job, not this one.
//
// The client wiring is already shipped and fake-stack-proven; this adds NO production `src/` change. The
// fake-stack twin (#427 queued-backlog-interrupt.spec.ts, over the #145/#292..#296 chain) proves the client
// WIRING — the composer's send gate is connection-only (composerAvailability returns canSend:true on the
// `connected` arm and NOWHERE else, no turn-phase gate), so a send issued mid-turn goes to the daemon and
// enqueues; `queue_state` renders into QueuedBacklog rows (data-thread-role="queued" inside
// .conversation__queued), each with a drop control (aria-label "Drop queued message" → dropQueuedMessage,
// firing the ungated dequeueMessage command). But in #427 that queue_state / turn_state is driven by
// `daemon.pushFrame` — a scripted state, not claude actually running a turn. This spec is the liveness
// proof: on the real stack the enqueue-then-dequeue must come from the REAL daemon holding a REAL turn's
// second send and then removing it on the drop.
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
//   - DROP-vs-DRAIN is now DETERMINISTIC (#487, supersedes the old OQ-a limitation): because turn 1 is held
//     on the gate file and the file is created only AFTER the dequeue is asserted, turn 1 CANNOT drain to
//     msg2 before the drop. Turn 1 is provably still running around both the enqueue and the drop (the
//     interrupt affordance stays visible), so the row left because of the drop, not a coincidental drain.
//     No adversarial timing, no "raise the count if it flakes" — the hold is released by a file event.
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
// non-secret nonce literals (the gate path is an isolated temp path, not a secret), model output NEVER
// asserted; the pairing payload is built the real-claude.spec.ts way and never echoed into a message. No
// failure diagnostic serialises the token, keys, or the transcript; trace / screenshot / video stay
// disabled (the real-claude config already disables all three).

// --- Selectors (verbatim from real-claude.spec.ts) ---------------------------
// A real v2 daemon fans the STRUCTURED stream to interactive conns, rendered into the timeline as
// data-thread-role="assistant".
const ASSISTANT_ROW = '[data-thread-role="assistant"]'
// The streaming cursor ▎ (U+258E) is a child <span> INSIDE the assistant bubble, so a row's textContent
// includes it even while the reply text is still empty. Strip it before the non-empty check.
const CURSOR_CHAR = '▎'
// turn_end appends a turnBoundary that drops the cursor — its absence is the per-turn quiesce signal.
const CURSOR_SELECTOR = '.bubble__cursor'
// #1014 filled the meta row's timestamp slot, and `.bubble__meta` is a child of the bubble, so a row's
// textContent now ends in `13.01.2026 - 13:55` whatever the reply says. Strip that subtree before the
// non-empty check too, or this tier's liveness gates green on any assistant row that merely EXISTS.
// Structural rather than digit-shape matching: it survives whatever the row grows next. Kept verbatim
// across the four real-claude specs that read a bubble's text — `rg META_SELECTOR e2e/` finds them all.
const META_SELECTOR = '.bubble__meta'

// --- Timeouts (verbatim from real-claude.spec.ts) ----------------------------
// Generous to absorb real daemon startup latency (registration on /v1/server is async after spawn) plus a
// handshake re-dial or two; Send-enabled is the readiness signal.
const HANDSHAKE_TIMEOUT_MS = 45_000
// One turn = cold PTY claude (spawn + model load + first reply). Also bounds the enqueue/dequeue waits and
// the drain-to-quiesce wait — turn 1 must both start AND, once the gate is released, fully complete within it.
const TURN_TIMEOUT_MS = 120_000
// Whole spec: handshake + one gate-held turn + the enqueue/drop round-trips + drain + headroom.
const SPEC_TIMEOUT_MS = 300_000

// --- New constant (from #445) ------------------------------------------------
// The content-stability window: after the two quiesce signals fire, hold this long and re-read to prove no
// second turn ran for the dropped send. Proving a NEGATIVE has no event to await, so a fixed settle + re-read
// is the correct and only tool; kept small — it is pure overhead (OQ-d).
const SETTLE_MS = 3_000

/**
 * Count assistant rows whose text is non-empty once the streaming cursor ▎ and the meta row are stripped.
 * Runs in the page context. Content-agnostic liveness: a naive "row exists" or unstripped-textContent
 * check would pass on an empty streaming bubble — both the cursor span and #1014's timestamp live INSIDE
 * the row. The strip runs on a detached copy, so the live DOM this spec's other assertions read is
 * untouched.
 */
function nonEmptyAssistantCount(page: Page): Promise<number> {
  return page
    .locator(ASSISTANT_ROW)
    .evaluateAll(
      (els, { cursor, meta }) =>
        els.filter((el) => {
          const content = document.createElement('div')
          content.append(el.cloneNode(true))
          content.querySelectorAll(meta).forEach((node) => node.remove())
          return (content.textContent ?? '').split(cursor).join('').trim().length > 0
        }).length,
      { cursor: CURSOR_CHAR, meta: META_SELECTOR }
    )
}

test('real claude enqueues a mid-turn send, drops it before drain, and runs no turn for it', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // A per-run nonce so reruns differ (defeats any accidental reply caching); content is NEVER asserted on
  // (Date.now() is fine in a Playwright spec). The gate file lives in the daemon workdir (#487, exposed by
  // the fixture) — the daemon spawns claude with cwd = that workdir, and the test shares the same filesystem,
  // so a file the test writes here is exactly what claude's Bash `[ -f ... ]` polls. msg1 drives a real,
  // ordinary tool-running turn that BLOCKS on the gate file: it stays genuinely running (interrupt affordance
  // visible) until the spec creates the gate, independent of model speed. Foreground is instructed explicitly
  // — haiku will otherwise sometimes background a long command and the turn returns at once. The poll loop is
  // SILENT so it does not flood the ordered frame stream and delay msg2's queue_state. msg2 is a short,
  // distinct queued send whose text is matched only to scope the drop control (content we control, not model
  // output).
  const runNonce = Date.now()
  const gatePath = join(daemon.workdir, `queue-drop-gate-${runNonce}`)
  const msg1 =
    `Use the Bash tool to run this exact command in the foreground; do NOT run it in the background. ` +
    `Command: until [ -f "${gatePath}" ]; do sleep 0.2; done. Do nothing else. run=${runNonce}`
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

  const conversation = page.locator('.conversation')
  const sendButton = page.getByRole('button', { name: 'Send' })
  const composer = page.getByPlaceholder('Message…')
  // The interrupt affordance's accessible name (#678: the composer send button's stop-variant aria-label),
  // present ONLY while the turn runs (isTurnRunning === thinking || responding), and replaced by the Send
  // variant at idle — the "turn 1 still running" gate. `sendButton` and this are the SAME element in two
  // states, which is exactly why msg2 below goes in by Enter.
  const interruptButton = page.getByRole('button', { name: 'Stop the running turn' })
  // Queued-flow selectors (verbatim from the #427 fake twin): queued rows live in .conversation__queued and
  // carry data-thread-role="queued"; the drop control is an icon button named "Drop queued message". Scoping
  // by container keeps them distinct from msg2's optimistic .message-row--user timeline echo (see below).
  const queuedBubbles = page.locator('[data-thread-role="queued"]')
  const queuedRow = (text: string) =>
    page.locator('.conversation__queued .message-row--user', { hasText: text })
  const dropButton = (text: string) =>
    queuedRow(text).getByRole('button', { name: 'Drop queued message' })
  // #1213: one DELIVERED timeline echo, addressed by its text. `data-thread-role="user"` is the delivered
  // role and never matches a queued row (those carry "queued"), so the two never collide. msg1 and msg2
  // both end with the run nonce but differ before it, and Playwright's `hasText` is a substring match, so
  // neither text is a substring of the other.
  const deliveredEcho = (text: string) =>
    page.locator('[data-thread-role="user"]', { hasText: text })

  await pairFromUnpairedLaunch(page, payload)

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

  // --- Start turn 1 (AC2 setup) — a real, gate-held tool turn to enqueue against. ---
  await composer.fill(msg1)
  await sendButton.click()

  // --- Gate turn 1 genuinely running (AC2). ---
  // The interrupt affordance is visible only while the turn runs (thinking || responding) — the running-turn
  // proof. A tool-driven turn (the running poll loop) sits in `responding` but streams NO assistant text, so
  // there is no `.bubble__cursor` to strengthen the gate with; the affordance alone is the correct signal
  // here (enqueue is valid against a thinking/responding turn — the same OQ-c fallback the interrupt spec
  // took). The gate file does not exist yet, so once claude reaches the tool it blocks and the turn stays
  // running until the spec releases it below.
  await expect(interruptButton).toBeVisible({ timeout: TURN_TIMEOUT_MS })

  // --- Send msg2 mid-turn (AC2) — by ENTER, not by clicking Send. #678 turned the send button into the stop
  // button while a turn runs, and the gate immediately above has just proven turn 1 IS running, so no Send
  // affordance is on screen here at all; clicking it would hang until timeout. Enter deliberately keeps its
  // send behaviour mid-turn (that asymmetry is #678's AC4) and the composer's own gate is unchanged (canSend
  // on `connected`, no turn-phase gate), so the frame still goes to the daemon while turn 1 runs.
  // submitMessage ALSO dispatches an unconditional optimistic userText echo, so msg2 renders a
  // data-thread-role="user" timeline row TOO. Every queued-flow assertion below scopes to
  // data-thread-role="queued" / .conversation__queued, distinct from the `user` echo, so there is no
  // collision — but that duplicate is NO LONGER harmless once the message is dropped, which is what #1213
  // fixed and what this spec now asserts. This comment used to read "expected and harmless" and scope every
  // assertion away from the echo; a drop that left the echo behind was a delivered-looking bubble for a
  // message claude was never handed, standing in the transcript forever. ---
  await composer.fill(msg2)
  await composer.press('Enter')

  // --- #1213 baseline: msg2's delivered echo IS on screen before the drop. ---
  // The positive half of the post-drop absence below. Without it that absence could pass against a thread
  // where the echo never rendered at all, which is precisely the failure it is meant to catch.
  await expect(deliveredEcho(msg2)).toHaveCount(1, { timeout: TURN_TIMEOUT_MS })

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

  // --- #1213: the drop takes msg2's delivered ECHO too, against a REAL daemon's message_id. ---
  // The queued-row assertion directly above is the positive wait this absence needs: it is a real 1 → 0
  // mutation driven by the daemon's own fresh queue_state, so it cannot have been true before the click.
  // This is also the only tier that proves the correlation key survives the real round trip — the fake tier
  // reads the id back off its own captured frame, while here the real daemon relays it byte-for-byte
  // (pyrycode#2092) and a drift in that field would show up as an echo that stubbornly stays.
  await expect(deliveredEcho(msg2)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })
  // Only the dropped message's echo goes: msg1 RAN, so its delivered row must survive untouched (AC4).
  await expect(deliveredEcho(msg1)).toHaveCount(1)

  // --- Drop-before-drain proof, post-drop (AC4 support). ---
  // Turn 1 is STILL running after the row left (the gate file has not been created yet, so the poll loop is
  // still blocking). Because msg2 left the queue WHILE turn 1 was running, turn 1 cannot later drain to it
  // (drain happens only at turn end) → the row left because of the drop, not a drain.
  await expect(interruptButton).toBeVisible()

  // --- Release turn 1 (AC4 setup) — create the gate file the poll loop is blocking on. ---
  // Only now, strictly AFTER the dequeue is asserted, does turn 1 stop being held: claude's `[ -f <gate> ]`
  // becomes true, the tool returns, and the turn drains naturally (no interrupt). This is the deterministic
  // release that replaces the old timing-dependent long prompt.
  await writeFile(gatePath, '')

  // --- Wait for quiesce (AC4). ---
  // Two independent DOM reflections of the turn ending, different fabric: the button retracts from the real
  // daemon's turn_state{idle}; the cursor drops from turn_end (claude's own post-tool acknowledgment streams
  // and then clears). This gate also ABSORBS that trailing chunk of turn 1, which is why the settled baseline
  // is captured AFTER it, not before.
  await expect(interruptButton).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- Capture the settled baseline STRICTLY AFTER the quiesce gate (AC4). ---
  // Both quiesce signals have fired, so turn 1 is over — no further chunks arrive for it — making this
  // baseline race-free. A naturally-completing foreground tool turn ends with claude's own post-tool
  // acknowledgment, so at least one assistant row exists.
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
