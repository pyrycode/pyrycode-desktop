# #446 — real-claude e2e: queue-while-busy then drop the queued send over the real wire

**Size:** S — one new `e2e/real-claude-queue-drop.spec.ts` (~150 lines of test code), **zero production `src/` change**. Clones the `real-claude.spec.ts` / `real-claude-interrupt.spec.ts` shape; adds the queue-and-drop liveness body.

**Not security-sensitive** (label absent — removed on the PO pass, same call as the #445 twin). Real-wire DOM-only e2e: drives the already-reviewed Noise/relay/pairing/frame-routing surfaces as a black box, asserts DOM text/visibility/counts only, secret hygiene deterministically enforced by the real-claude config (trace/screenshot/video off). No security-relevant *design* to audit → security-review step skipped.

**Not-Figma** — the spec asserts on existing UI and changes nothing visible; no Design source section.

---

## Files to read first

- `e2e/real-claude-interrupt.spec.ts` (whole, ~180L) — **the closest structural sibling** (#445, merged). Same precondition clone + the interrupt-button running gate + the `SETTLE_MS` negative-re-read pattern + the real-vs-fake divergence doc discipline. Mirror its header comment structure and its quiesce/settle shape; this ticket is its twin.
- `e2e/real-claude.spec.ts` (whole, ~150L) — the base clone. Copy **verbatim**: the precondition (pair → `.channel-list__row-open` visible → New-discussion FAB → `.conversation` visible → `Send` enabled), the `ASSISTANT_ROW` / `CURSOR_CHAR` / `CURSOR_SELECTOR` constants, the `HANDSHAKE_TIMEOUT_MS` / `TURN_TIMEOUT_MS` / `SPEC_TIMEOUT_MS` timeouts, and the `nonEmptyAssistantCount(page)` helper.
- `e2e/queued-backlog-interrupt.spec.ts:143-198` — the fake twin (#296 chain). Reuse its queued-flow selectors **verbatim**: queued rows `.conversation__queued .message-row--user` (also `[data-thread-role="queued"]` for counts), drop button `getByRole('button', { name: 'Drop queued message' })`. **DROP** its in-process outbound capture (`capturingQueueInterruptFake`, `dequeueFramesMatching`, `interruptFrames`) — the real daemon is a separate process behind the content-blind relay, so wire-frame capture is unavailable (the same divergence `real-claude-interrupt.spec.ts` documents).
- `e2e/fixtures/realDaemon.ts:76-316` — the fixture surface. Import `{ test, expect, encodePairingPayload }` from here. `RealDaemonFixtures` = `{ relay, daemon, page }`; `RealDaemonOptions` defaults are `spawnClaude:true` (real claude on `--model haiku`) + `seedPromoted:false` — **set neither** (no `test.use`), exactly as both sibling real-claude specs do. The skip-gate (resolves `pyry` + `claude` + a credential before any resource; `testInfo.skip` on any miss) is inherited for free.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:705-741` — `QueuedBacklog` (read-only). Confirms the container `.conversation__queued`, the row bubble `data-thread-role="queued"`, and the drop control `aria-label={DROP_QUEUED_LABEL}` where `DROP_QUEUED_LABEL = 'Drop queued message'` (:677).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:520-560` — `InterruptButton` (read-only). aria-label `Stop the running turn`, wrapper `.conversation__interrupt`; present **only** while `isTurnRunning(phase)` (thinking ‖ responding), null at idle. This is the "turn 1 still running" gate and half the quiesce signal.
- `src/renderer/src/screens/conversation/composerSend.ts:97-108` — `composerAvailability` (read-only). Returns `canSend:true` **only** on `case 'connected'` — no turn-phase arm. This is the load-bearing premise: `Send` stays enabled mid-turn, so a second send during a running turn goes to the daemon and enqueues. Also note `submitMessage` (:65-67) dispatches an **unconditional optimistic `userText` echo** → the mid-turn send also renders a `data-thread-role="user"` timeline row (see § Design note on the double render).
- `playwright.real-claude.config.ts` (read-only) — `testMatch: /real-.*\.spec\.ts$/`, `retries:0`, `timeout:300_000`, `workers:1`, **no** trace/screenshot/video. The new `real-*` filename is auto-discovered; no config change.
- `package.json:16-17` — `e2e` (default, filename-`testIgnore`s every `real-*`) vs `e2e:real-claude` (this spec's runner). No change.

---

## Context

Tier-3 real-claude e2e, split from #431 (twin of #445, which proved interrupt-mid-turn over the real wire — PR#473, merged). The queued backlog only means something against a **genuinely running turn**: a second send arrives while the real daemon is mid-turn, the daemon holds it and pushes `queue_state`, the client renders it as a queued row, and dropping it dequeues **before** the turn ever drains to it. A fake or claude-less daemon cannot exercise this — claude-less turns complete with no real streaming, so there is no running turn to queue against (the #442 empty-observable-subset trap). Real claude on `--model haiku` gives a genuinely running turn.

The client wiring already ships and is fake-stack-proven (#145 / #292..#296 chain, and the `queued-backlog-interrupt.spec.ts` fake twin). This ticket adds **no production `src/` change** — it is the real-stack liveness net over that shipped wiring, mirroring `real-claude.spec.ts` / `real-claude-interrupt.spec.ts`.

---

## Design

One new file `e2e/real-claude-queue-drop.spec.ts`, one `test()` block, one launch. Structure mirrors `real-claude-interrupt.spec.ts`: a header comment documenting the real-vs-fake divergences, the verbatim constants/helper block, the verbatim precondition, then the queue-and-drop body.

### Constants + helper (reuse verbatim from `real-claude.spec.ts`)

- `ASSISTANT_ROW = '[data-thread-role="assistant"]'`, `CURSOR_CHAR = '▎'`, `CURSOR_SELECTOR = '.bubble__cursor'`.
- `HANDSHAKE_TIMEOUT_MS = 45_000`, `TURN_TIMEOUT_MS = 120_000`, `SPEC_TIMEOUT_MS = 300_000`.
- `nonEmptyAssistantCount(page): Promise<number>` — counts assistant rows whose text is non-empty once the streaming cursor is stripped (copy verbatim).
- New: `SETTLE_MS = 3_000` (from #445) — the content-stability window for the AC4 negative re-read.
- New: the turn-1 prompt is a deliberately-long, cheap haiku prompt kept in a named local so it is trivially tunable, e.g. `Count from 1 to 300, one number per line, and nothing else. run=${runNonce}` with a per-run `runNonce = Date.now()` (content **never** asserted). Keep it long — see § State & timing.

### Selectors (this spec)

- `interruptButton = page.getByRole('button', { name: 'Stop the running turn' })` — the "turn running" affordance.
- `queuedBubbles = page.locator('[data-thread-role="queued"]')` — the queued-row count.
- `queuedRow = (text) => page.locator('.conversation__queued .message-row--user', { hasText: text })`.
- `dropButton = (text) => queuedRow(text).getByRole('button', { name: 'Drop queued message' })`.
- `composer = page.getByPlaceholder('Message…')`, `sendButton = page.getByRole('button', { name: 'Send' })` (from the base clone).

### Precondition (AC1) — verbatim from `real-claude.spec.ts`

`encodePairingPayload({ server, relay: `${relay.url}/v1/client`, token, server_static_pubkey })` from `daemon.pairFields` → fill `textarea[aria-label="Pairing code"]` → Pair → Confirm (`[aria-label="Server key fingerprint"]`) → wait `.channel-list__row-open` visible (the connected gate) → New-discussion FAB → `.conversation` visible → `Send` enabled. Copy this block unchanged.

### Body (the only delta from the base clone)

Two distinct message texts, both carrying the per-run nonce: `msg1` (the long turn-1 prompt) and `msg2` (a short distinct queued-send text, e.g. `A queued task to drop. run=${runNonce}`; content never asserted).

1. **Start turn 1 (AC2 setup).** Fill `composer` with `msg1`, click `Send`.
2. **Gate turn 1 genuinely running.** `expect(interruptButton).toBeVisible({ timeout: TURN_TIMEOUT_MS })` then `expect(CURSOR_SELECTOR.first()).toBeVisible({ timeout: TURN_TIMEOUT_MS })` — the daemon is mid-turn and actually streaming (thinking→responding), so the next send enqueues rather than starting a fresh turn. (Same running gate as #445; OQ-c fallback applies.)
3. **Send msg2 mid-turn (AC2).** Fill `composer` with `msg2`, click `Send`. `Send` is enabled (`canSend` on connected — no turn-phase gate), so the frame goes to the daemon while turn 1 runs.
4. **Assert msg2 enqueues (AC2).** `expect(queuedBubbles).toHaveCount(1, { timeout: TURN_TIMEOUT_MS })` (and optionally `expect(queuedRow(<msg2 text>)).toBeVisible()`). This is the **enqueue liveness proof**: the real daemon held msg2 and pushed `queue_state`. A timeout here is a genuine failure (the "a mid-turn send enqueues" premise is broken) — **do not soften it**; file separately.
5. **Drop-before-drain tightening (pre-drop).** `expect(interruptButton).toBeVisible()` — assert turn 1 is still running at the moment we drop, establishing the drop is issued within turn 1's lifetime.
6. **Drop the queued row (AC3).** `dropButton(<msg2 text>).click()`. Non-optimistic: the drop only emits a `dequeue_message` frame; the row leaves on the daemon's next `queue_state`.
7. **Assert the row leaves (AC3).** `expect(queuedBubbles).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })` — the **dequeue liveness proof**: the daemon removed msg2 and pushed a fresh `queue_state` omitting it.
8. **Drop-before-drain proof (post-drop).** `expect(interruptButton).toBeVisible()` — turn 1 is STILL running after the row left. Because msg2 left the queue **while turn 1 was still running**, turn 1 cannot later drain to it (drain happens only at turn end) → the row left because of the drop, not a drain. (This is the "drop provably precedes drain" the ticket demands, for the realistic timing; see § Accepted limitation for the adversarial edge.)
9. **Let turn 1 drain, wait for quiesce (AC4 setup).** Do **not** interrupt — turn 1 finishes naturally. `expect(interruptButton).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })` AND `expect(CURSOR_SELECTOR).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })` — the two-signal quiesce (turn_state{idle} retracts the button; turn_end drops the cursor).
10. **Capture the settled baseline STRICTLY AFTER quiesce (AC4).** `const settled = await nonEmptyAssistantCount(page)`. Both quiesce signals have fired → no further chunks for this turn → race-free. Assert `expect(settled).toBeGreaterThanOrEqual(1)` — turn 1 (the first send) genuinely produced an assistant reply.
11. **Assert the dropped send produced no assistant turn (AC4).** `await page.waitForTimeout(SETTLE_MS)`, then assert **all three**: `nonEmptyAssistantCount(page) === settled` (no new assistant reply), `expect(interruptButton).toHaveCount(0)`, `expect(CURSOR_SELECTOR).toHaveCount(0)` (no second turn started). Together: exactly the first send's turn ran; the dropped content never became an assistant reply.

### Double-render note (do NOT trip on it)

`submitMessage` dispatches an **unconditional optimistic `userText` echo**, so msg2 renders a `data-thread-role="user"` row in the timeline **as well as** the `data-thread-role="queued"` backlog row. This is expected and harmless:
- The queued-flow assertions scope to `data-thread-role="queued"` / `.conversation__queued`, distinct from the optimistic `user` echo — no collision.
- After the drop, the queued row leaves but the optimistic `user` echo **remains** in the timeline (the drop affects only the queue). Do **not** assert the `user` echo disappears.
- `nonEmptyAssistantCount` counts only `assistant` rows, so neither the `user` echo nor the `queued` row perturbs the AC4 count.

---

## State & concurrency model

- **Stores driven (as a black box):** the queue store (#293 replacement-truth backlog → `QueuedBacklog` rows) and the timeline `phase` (turn_state → `InterruptButton` / cursor). Both are server-push-driven by the **real** daemon here, not a scripted `daemon.pushFrame` (the fake twin's mechanism, which is unavailable — the daemon is a separate process).
- **Concurrency / teardown:** inherited entirely from `e2e/fixtures/realDaemon.ts`. The `relay → daemon → page` fixture chain forces LIFO teardown (page closes first so the supervisor cannot churn-reconnect); the detached `pyry` + real-claude grandchild are reaped as a process group on every exit path. No teardown logic in this spec.
- **The load-bearing timing invariant.** Turn 1 must stay running until msg2 has enqueued **and** been dropped. The prompt is long (a 300-line count on haiku is tens of seconds) while steps 3–7 (send → enqueue render → drop → row leaves) are a handful of relay round-trips (~1–2s). So the drop lands with tens of seconds of turn-1 runway remaining. Step 8 (interrupt button still visible after the row leaves) verifies turn 1 outlived the drop, making drop-before-drain observable, not merely assumed. This is the #442-class dequeue-before-drain hazard the ticket flags.

---

## Error handling / failure surfaces

Every assertion reads DOM text / visibility / counts only. The meaningful failure modes and their correct handling:

- **Enqueue never renders (step 4 timeout):** the mid-turn send did not enqueue — the ticket's central premise is broken (a daemon-side queue regression, or the client's send-gate drifted to turn-phase). A real signal; do not soften.
- **Row never leaves (step 7 timeout):** the drop did not dequeue — a `dropQueuedMessage`/`dequeue_message` regression, or the daemon ignored the drop. Real signal.
- **Turn 1 not running after the drop (step 8):** turn 1 finished early (prompt too short / haiku too fast), so drop-before-drain is no longer observable → tune the prompt longer (OQ). Distinct from step 11 failing.
- **Second turn ran (step 11):** the dropped send drained to an assistant turn — either the drop lost the race (raise the prompt length) or the drop genuinely failed to remove msg2. Real signal.
- **Skip path:** on a machine without `pyry` / `claude` / a credential the fixture skip-gate fires before any resource is created (an unrun test is the correct outcome). No spec-level handling needed.

**Secret hygiene:** assertions read DOM text/visibility/counts only; the two prompts are non-secret nonce literals with content never asserted; the pairing payload is built the `real-claude.spec.ts` way and never echoed into a message; no failure diagnostic serializes the token, keys, or the transcript; trace/screenshot/video stay disabled (the real-claude config already disables all three).

---

## Testing strategy

The spec **is** the test. It runs only under `npm run e2e:real-claude` (auto-discovered by `testMatch: /real-.*\.spec\.ts$/`) and is ignored by the default `npm run e2e` (filename `testIgnore`). Local dev-machine verification is out of the agent's reach (needs `pyry` + `claude` + a credential); the developer confirms:

- `npm run build` clean (the salvage/QA gate), `npm test` unaffected (no production change), and a standalone `./node_modules/.bin/tsc` pass over the new e2e file (the `e2e/` tree is not covered by either project tsconfig — see the repo's known-issue note). Use `./node_modules/.bin/tsc`, not `npx tsc` (resolves the wrong package here).
- The spec **skips cleanly** under the real-claude config on a machine without the stack (the fixture skip path), and is **not** picked up by the default e2e run.
- ⚠ A fresh worktree may have no `node_modules` — run `npm install` first (the #445 developer hit exactly this).

No new fakes/mocks — this is the real stack. No unit tests (zero production surface). Coverage is the five ACs, all via DOM state transitions.

---

## Open questions

- **OQ-a (accepted tier-3 limitation, mirrors #445's OQ-a).** DOM-only over the real wire cannot *deterministically* distinguish "drop won the race" from "drain won" in the adversarial continuous-busy timing (turn 1 ends and turn 2 starts draining msg2 within the drop-reflect window — i.e. the drop LOST the race). That requires the drop to lose against a long turn-1 runway, which the long prompt makes implausible. The mitigation is the long prompt + step 5/8 running gates; step 11 is a best-effort confirmation, not a causation proof. Do **not** try to strengthen it by asserting reply content (secret hygiene + tier-3 no-content-assert).
- **OQ-b (prompt-length tuning).** Turn 1 must be long enough for drop-before-drain runway **and** short enough to fully drain within `TURN_TIMEOUT_MS` (120s) at step 9 (unlike #445, which interrupts turn 1 and never waits for the full count). Start at "count 1 to 300" for consistency with the #445 twin; if step 9 flakes on a drain-timeout, halve the count. If step 8 flakes (turn 1 finishing coincidentally in the drop-reflect window), the count is too short — raise it or relax step 8 to a soft check.
- **OQ-c (running-gate transience, inherited from #445).** If live timing ever shows the cursor too transient to catch at step 2, fall back to the `interruptButton`-visible gate alone (enqueue is valid against a `thinking` turn too).
- **OQ-d (`SETTLE_MS` is pure overhead).** Proving the negative at step 11 has no event to await, so the fixed settle + re-read is the correct and only tool; kept small (3s), same as #445.

---

## AC → step map

| AC | Covered by |
|----|-----------|
| 1 — pair, connected `.conversation`, Send enabled | Precondition (verbatim clone) |
| 2 — start turn, mid-turn second send renders queued | Steps 1–4 |
| 3 — drop the queued row, it leaves the backlog | Steps 6–7 |
| 4 — after drain, only the first send's turn ran | Steps 9–11 (+ steps 5, 8 drop-before-drain) |
| 5 — integrates with harness, skip-gates, auto-runs under `e2e:real-claude` | Structural: `real-*.spec.ts` filename, `realDaemon` fixtures, no `test.use`, no config change |
