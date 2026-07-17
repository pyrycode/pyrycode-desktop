import { type Page } from '@playwright/test'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'

// Tier-3 real-claude e2e (#445, split from #431) — the LIVENESS NET for interrupt-mid-turn over the real
// stack. Interrupt only means something against a GENUINELY running turn: the daemon's turn lifecycle +
// claude's actual streaming + the client-side quiesce when the interrupt frame lands. It clones
// real-claude.spec.ts's precondition (pair against a freshly-spawned real `pyry` on `--model haiku`,
// bridged to the built Electron window through #251's content-blind routing relay, then CREATE the
// conversation through the New-discussion FAB and reach the connected `.conversation` with Send enabled)
// and swaps only the turn body: start a deliberately-long turn, interrupt it while it streams, and prove
// the turn quiesces.
//
// The client wiring is already shipped and fake-stack-proven; this adds NO production `src/` change. The
// fake-stack twins (#307 InterruptButton render, #427 the queued-backlog-interrupt chain) prove the client
// WIRING — the button is gated on `isTurnRunning(phase)` (thinking || responding), `sendInterrupt` fires a
// bare `interrupt` command and does NO local dispatch (non-optimistic), and the controls retract only when
// the daemon's `turn_state{idle}` arrives while the streaming cursor `.bubble__cursor` clears on `turn_end`.
// But in #427 that retraction is driven by `daemon.pushFrame` — a scripted state, not claude actually
// stopping. This spec is the liveness proof: on the real stack the retraction must come from the REAL
// daemon ending a REAL, streaming turn in response to the interrupt.
//
// REAL-CLAUDE DIVERGENCES from the fake twin #427 (the only deltas — mirrors the real-daemon-workspace.spec.ts
// doc discipline):
//   - NO `daemon.pushFrame`: the real daemon owns the turn lifecycle end-to-end. `turn_state{thinking →
//     responding → idle}` and `turn_end` are emitted by claude actually running and then actually stopping,
//     not by a scripted push. So the running-state affordance appearing then disappearing is a real
//     transition, not a reflected one.
//   - NO outbound frame capture: the daemon is a SEPARATE process behind the content-blind relay, so #427's
//     in-process outbound capture (`capturingQueueInterruptFake`, `interruptFrames`, the `expect.poll` on
//     captured envelopes) is unavailable — the SAME divergence real-daemon-workspace.spec.ts documents.
//     Every assertion reads DOM text / visibility / counts only.
//   - Accepted limitation (OQ-a): DOM-only over the real wire CANNOT prove interrupt CAUSATION — a turn
//     that finishes on its own also retracts the affordance. The mitigation is a prompt long enough that
//     natural completion within the interrupt window is implausible; this is an accepted property of the
//     tier-3 liveness net (the ticket frames it as "the liveness proof only"). Do NOT try to strengthen it
//     into a causation proof by asserting content.
//
// It inherits the real-claude harness for free: `spawnClaude` defaults to true (claude on `--model haiku`),
// so setting NO `test.use(...)` gives the claude-spawning mode AND the full skip-gate (resolves `pyry` +
// `claude` on PATH + a credential BEFORE creating any resource; testInfo.skip on any miss). It is
// auto-discovered by playwright.real-claude.config.ts's `testMatch: /real-.*\.spec\.ts$/` (runs under
// `npm run e2e:real-claude`, the operator pre-ship gate) and IGNORED by the default `npm run e2e` (whose
// filename `testIgnore` excludes every `real-*` spec). When the real stack is unavailable the spec SKIPS
// cleanly — an unrun test is the correct outcome there, not a hard failure.
//
// SECRET HYGIENE (AC5): every assertion reads DOM text / visibility / counts only; the long-turn prompt is a
// non-secret nonce literal, content NEVER asserted; the pairing payload is built the real-claude.spec.ts way
// and never echoed into a message. No failure diagnostic serialises the token, keys, or the transcript;
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
// One turn = cold PTY claude (spawn + model load + first reply). Also bounds the quiesce-after-interrupt wait.
const TURN_TIMEOUT_MS = 120_000
// Whole spec: handshake + one long turn + interrupt + headroom.
const SPEC_TIMEOUT_MS = 300_000

// --- New constant ------------------------------------------------------------
// The content-stability window: after the two quiesce signals fire, hold this long and re-read the count to
// prove the assistant content has frozen. Proving a NEGATIVE (no further growth) has no event to await, so a
// fixed settle + re-read is the correct and only tool; kept small — it is pure overhead (OQ-b).
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

test('real claude quiesces a genuinely running turn when interrupted', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // A TOOL-DRIVEN turn that stays GENUINELY RUNNING for a controlled window, independent of model speed.
  // Long text output does NOT work on `--model haiku`: it streams the whole reply in well under the ~2s
  // claude cold-start, so `responding`→`idle` collapse into one burst and no running-turn window is ever
  // observable (the failed "count to 300" premise this replaces — see OQ-a). The command is a FOREGROUND
  // loop that echoes once per second, NOT a bare `sleep`: a bare `sleep` is non-deterministic on haiku
  // (claude may set run_in_background:true and the turn returns at once) and a silent multi-second command
  // trips the ptyrunner's 30s PTY-quiet watchdog. Per-second output keeps the PTY active and the
  // run_in_background ban keeps the turn blocking in `responding` — a real, interruptible turn. Per-run
  // nonce defeats reply caching; content is NEVER asserted on (Date.now() is fine in a Playwright spec).
  const runNonce = Date.now()
  const message =
    `Use the Bash tool to run this exact command in the foreground; do NOT run it in the background. ` +
    `Command: for i in $(seq 20); do echo $i; sleep 1; done. Do nothing else. run=${runNonce}`

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
  // The #427 idiom: the interrupt affordance's accessible name (InterruptButton's aria-label), present ONLY
  // while the turn runs (isTurnRunning === thinking || responding), null at idle.
  const interruptButton = page.getByRole('button', { name: 'Stop the running turn' })

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

  // --- Start the long turn (AC2) — a real, streaming turn to interrupt. ---
  await composer.fill(message)
  await sendButton.click()

  // --- Gate on the turn genuinely running (AC3). ---
  // The interrupt affordance is visible only while the turn runs (thinking || responding).
  await expect(interruptButton).toBeVisible({ timeout: TURN_TIMEOUT_MS })
  // The interrupt affordance above IS the running-turn proof (visible only while isTurnRunning === thinking
  // || responding). A tool-driven turn (a running `sleep`) sits in `responding` but streams NO assistant
  // text, so there is no `.bubble__cursor` to strengthen the gate with — this is exactly the OQ-c fallback
  // the original text prompt anticipated. The tool keeps the turn genuinely running for ~20s, the real,
  // model-speed-independent window this spec needs to interrupt within.

  // --- Activate interrupt (AC3). ---
  await interruptButton.click()

  // --- Assert quiesce (AC4): two independent DOM reflections of the turn ending, different fabric. ---
  // The button retracts from the real daemon's turn_state{idle}; the cursor drops from turn_end. Asserting
  // BOTH is a belt-and-suspenders quiesce proof. This gate also ABSORBS any trailing chunk the daemon emits
  // after the interrupt lands — the count may still tick up here, which is why the settled baseline is
  // captured AFTER this gate, not at the click. A timeout here is the exact gap this ticket exists to catch
  // (the daemon received the interrupt but did not end the turn); file it separately, do NOT soften it.
  await expect(interruptButton).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- Capture the settled baseline STRICTLY AFTER the quiesce gate (AC4). ---
  // Both quiesce signals have fired, so the turn is over — no further chunks arrive for this turn — making
  // this baseline race-free.
  const settled = await nonEmptyAssistantCount(page)

  // --- Assert content stops growing (AC4). ---
  // Hold the settle window and re-read. Content only ever grows, so equality proves it froze once quiesced.
  await page.waitForTimeout(SETTLE_MS)
  expect(await nonEmptyAssistantCount(page)).toBe(settled)
})
