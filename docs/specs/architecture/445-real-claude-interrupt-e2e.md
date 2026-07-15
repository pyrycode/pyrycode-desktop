# #445 — real-claude e2e: interrupt a running turn over the real wire

**Size:** S · **Type:** Tier-3 real-claude e2e · **Production `src/` change:** none · **Fixture/config change:** none

## Design source

N/A — test-only ticket; drives already-shipped UI as a black box, no new visible surface. Visual fidelity of the interrupt affordance is owned by #307 (fake-stack render test).

## Files to read first

- `e2e/real-claude.spec.ts:1-147` — **the clone target.** Its precondition (fixture imports; the `encodePairingPayload` pairing drive; the UI-create-conversation flow via the **New discussion** FAB → daemon `conversation_created` → thread nav → Send enabled), its selector constants (`ASSISTANT_ROW`, `CURSOR_CHAR`, `CURSOR_SELECTOR`), the `nonEmptyAssistantCount(page)` helper, and the timeout constants are all reused verbatim. Copy the whole precondition; replace only the two-turn body (`:124-147`) with the interrupt body of this spec.
- `e2e/queued-backlog-interrupt.spec.ts:135-198` — **the fake-stack interrupt twin (#307/#427).** Source of the exact interrupt-button locator `page.getByRole('button', { name: 'Stop the running turn' })`, the running-indicator `.conversation__thinking`, and the load-bearing note (`:44-49`, `:190-197`) that interrupt is **non-optimistic**: `sendInterrupt` only emits a frame, the controls retract **only** when the daemon's `turn_state{idle}` arrives (fact 3, `:38-42`). Mirror the DOM shape; drop **all** frame capture (`capturingQueueInterruptFake`, `interruptFrames`, the `expect.poll` on captured envelopes) — the real daemon is a separate process behind the content-blind relay, so in-process outbound capture is unavailable here (same divergence `real-daemon-workspace.spec.ts` documents).
- `e2e/fixtures/realDaemon.ts:83-167,252-273` — the `spawnClaude` / `seedPromoted` option fixtures. **`spawnClaude` defaults to `true`** (`:110`) → claude is spawned on `--model haiku` (`:273`). The skip-gate resolves `pyry` (universal) + `claude` on PATH + `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` **before** creating any resource (`:120-160`). This spec sets **neither** option → it inherits the claude-spawning mode and the full skip-gate for free (AC5, no code).
- `e2e/real-daemon-workspace.spec.ts:20-50` — the **real-daemon-divergences header idiom**: how a real-wire spec documents what it can/cannot assert vs its fake twin, and why it captures no outbound frame. Mirror this doc discipline in the new spec's header comment.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:516-560` — `isTurnRunning(phase)` (`thinking || responding`) and `InterruptButton` (`.conversation__interrupt` wrapper, `.interrupt-button`, aria-label `Stop the running turn`; returns `''`/null when `!isRunning`). Confirms the affordance is present **only** while the turn runs. **Read-only — do not modify.**
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:290-300` — the `.bubble__cursor` streaming-cursor `<span>` (child of the assistant bubble). Its **absence** is the per-turn quiesce signal (`turn_end` appends a turn boundary that drops the cursor). **Read-only.**
- `playwright.real-claude.config.ts` — `testMatch: /real-.*\.spec\.ts$/`, `timeout: 300_000`, `retries: 0`, and **no** trace/screenshot/video. Confirms auto-discovery + deterministic secret hygiene with zero config change (AC5).
- `package.json:16-17` — `e2e` (default, `real-*` ignored) vs `e2e:real-claude` (the operator pre-ship gate that runs this spec).

## Context

Interrupt only means something against a **genuinely running turn** — the daemon's turn lifecycle + claude's actual streaming + the client-side quiesce when the interrupt frame lands. A fake or claude-less daemon can't exercise it: the fake-stack twins (#307 render, #427 chain) prove the client *wiring* (button gated on `isTurnRunning`, `sendInterrupt` fires bare `interrupt`, controls retract on a *pushed* `turn_state{idle}`), but the retraction there is driven by `daemon.pushFrame`, not by claude actually stopping. This ticket is the **liveness net**: on the real stack, the retraction must come from the real daemon ending a real, streaming turn in response to the interrupt.

Zero production `src/` change. The interrupt wiring already ships; this drives it as a black box on the merged `e2e/fixtures/realDaemon.ts` (#420) fixtures, mirroring `real-claude.spec.ts` itself. New artifact: one `real-*.spec.ts` scenario.

## Design

**New file:** `e2e/real-claude-interrupt.spec.ts` (starts with `real-` → auto-discovered by the config's `testMatch`; **ignored** by the default `npm run e2e`). ~150 lines, one `test()` block, one launch.

### Reused verbatim from `real-claude.spec.ts`

- Fixture import: `import { test, expect, encodePairingPayload } from './fixtures/realDaemon'` + `import { type Page } from '@playwright/test'`.
- Selector constants `ASSISTANT_ROW = '[data-thread-role="assistant"]'`, `CURSOR_CHAR = '▎'`, `CURSOR_SELECTOR = '.bubble__cursor'`.
- The `nonEmptyAssistantCount(page): Promise<number>` helper (strips the cursor char before the non-empty check).
- Timeouts `HANDSHAKE_TIMEOUT_MS = 45_000`, `TURN_TIMEOUT_MS = 120_000`, `SPEC_TIMEOUT_MS = 300_000`.
- The whole precondition block (`:85-122`): pairing, the **New discussion** FAB create-through-UI flow, and the `await expect(sendButton).toBeEnabled(...)` connected gate.
- No `test.use(...)` — defaults (`spawnClaude: true`, `seedPromoted: false`) are exactly what's wanted.

### New constant

- `SETTLE_MS = 3_000` — the content-stability window (see § Testing strategy, step 6). Small; pure overhead.

### New locator

- `const interruptButton = page.getByRole('button', { name: 'Stop the running turn' })` (the #427 idiom, `:153`).

### The long-turn prompt

- A cheap, deliberately long-streaming haiku prompt with a per-run nonce; content **never** asserted. Suggested shape: `` `Count from 1 to 300, one number per line, and nothing else. run=${runNonce}` ``. Err **long** — a turn that finishes before the interrupt window is the primary flakiness risk (§ Open questions a). Same `runNonce = Date.now()` idiom as `real-claude.spec.ts:82` (`Date.now()` is fine in a Playwright spec — the workflow-script ban does not apply here).

### Interrupt body (replaces the two-turn body)

Drive, in order:

1. **Send the long turn.** `composer.fill(message)`, `sendButton.click()`.
2. **Gate on the turn genuinely running.** `await expect(interruptButton).toBeVisible({ timeout: TURN_TIMEOUT_MS })` (AC3: the affordance is visible). **Strengthening (recommended):** also `await expect(page.locator(CURSOR_SELECTOR).first()).toBeVisible({ timeout: TURN_TIMEOUT_MS })` — a live cursor proves claude has started **streaming** (phase `responding`), not merely `thinking`; safe because the prompt is deliberately long, so the cursor appears well before natural completion.
3. **Activate interrupt.** `interruptButton.click()`.
4. **Assert quiesce (two signals, different fabric).** `await expect(interruptButton).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })` **and** `await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })`. These are two independent DOM reflections of the turn ending — the button from `turn_state{idle}`, the cursor from `turn_end` — so asserting both is a belt-and-suspenders quiesce proof. This step also **absorbs any trailing chunk** the daemon emits after the interrupt lands (technical note): the count may still tick up here, which is why the baseline is captured *after* this gate, not at the click.
5. **Capture the settled baseline** *strictly after* the quiesce gate: `const settled = await nonEmptyAssistantCount(page)`. Because both quiesce signals have fired, the turn is over — no further chunks arrive for this turn — so this baseline is race-free.
6. **Assert content stops growing.** Hold the settle window, then re-read: `await page.waitForTimeout(SETTLE_MS)`; `expect(await nonEmptyAssistantCount(page)).toBe(settled)`. Content only ever grows, so equality proves it froze. This is the AC's "once quiesced the assistant content stops growing."

### Header comment (doc discipline)

Open the file with a header mirroring `real-daemon-workspace.spec.ts:1-50` and `real-claude.spec.ts:1-33`: what real stack it drives, that it's the liveness net over the shipped #307/#427 wiring, the **real-claude divergences from the fake twin** (no `pushFrame` — the daemon ends the turn; no outbound frame capture — separate process), the skip-gate inheritance, and the SECRET-HYGIENE line (assertions read DOM text/visibility/counts only; no diagnostic serialises the token/keys/transcript; trace/screenshot/video off by config).

## State + concurrency model

No client state authored — the spec is a black-box driver. The turn lifecycle is owned by the real daemon: `send_message` → `turn_state{thinking}` → `turn_state{responding}` + streamed assistant chunks (each mounting/updating the `.bubble__cursor` bubble) → **on interrupt**: `interrupt` (bare frame, `sendInterrupt`) → daemon stops the turn → `turn_state{idle}` (retracts `InterruptButton`) + `turn_end` (drops `.bubble__cursor`). The client is unidirectional throughout: `sendInterrupt` emits a frame and does **no** local dispatch, so every DOM transition the spec asserts is gated on a real daemon reply — never an optimistic pre-render.

Teardown: fixture-owned. The `realDaemon` fixture reaps the daemon process-group and closes the relay/page on test end; the spec adds no teardown.

## Error handling

- **Turn never starts / never streams** → step 2 times out at `TURN_TIMEOUT_MS`. A genuine liveness failure (the fresh-daemon deadlock class `real-claude.spec.ts` guards) — surface it, do not extend the timeout.
- **Interrupt does not quiesce the turn** → step 4 times out (button or cursor never reaches count 0). This is the exact gap this ticket exists to catch: the daemon received the interrupt but did not end the turn. File it separately; do **not** soften the assertion.
- **Content keeps growing after quiesce** → step 6 fails on inequality. Would indicate the quiesce signals fired while chunks were still arriving (a daemon ordering bug) — a real finding.
- **Real stack unavailable** (no `pyry`/`claude`/creds) → the fixture skip-gate marks the test skipped **before** any resource is created (AC5). An unrun test is the correct outcome, never a hard failure.
- `retries: 0` (config): a real-stack failure is a signal to inspect, not a flake to paper over.

## Testing strategy

This *is* the test. It runs only under `npm run e2e:real-claude` (the operator pre-ship gate), serialized, workers: 1. No unit tests, no fixture edits, no config edits. Verification the developer owns:

- `npm run build` (the salvage/QA gate — typecheck + build) must stay green; the new spec is pure e2e and must not perturb `src/`.
- **e2e is not covered by either project tsconfig** ([[e2e-not-typechecked-by-project-config]]) — run a standalone `tsc` pass over the new spec (the sibling real-* specs' idiom) to catch type errors the build won't.
- The spec cannot be *run* to green in the agent pipeline (no daemon/claude/creds) — it will **skip**, which is the correct pipeline outcome. Confirm it skips cleanly (not errors) under `npm run e2e:real-claude` in the pipeline, and that it is *not* picked up by the default `npm run e2e`.
- Assertion coverage maps 1:1 to AC: AC1 = the connected `.conversation` + Send-enabled precondition; AC2 = the long-turn send; AC3 = interrupt-button-visible gate + click; AC4 = the two-signal quiesce gate + the settled-stability check; AC5 = filename auto-discovery + inherited skip-gate + config secret hygiene.

## Open questions

- **(a) Prompt length vs the interrupt window.** The spec cannot prove *causation* (interrupt-caused quiesce vs natural turn completion) content-agnostically on the real wire — a turn that finishes on its own also retracts the affordance. Mitigation is a prompt long enough that natural completion within the interrupt window is implausible; the developer should tune the count/list length up if live runs show the turn completing before/at the click. This is an accepted property of the tier-3 liveness net (the ticket frames it as "the liveness proof only"); do not attempt to strengthen it into a causation proof by asserting content.
- **(b) `page.waitForTimeout` in step 6.** Proving a *negative* (no further growth) over a bounded window has no event to await — a fixed settle + re-read is the correct and only tool, and is standard for "assert nothing else happens" checks. Keep `SETTLE_MS` small. If a future daemon exposes a distinct "turn-fully-terminated" DOM signal, this could be replaced, but none exists today.
- **(c) Cursor-present gate (step 2 strengthening).** If live timing shows the cursor is too transient to catch reliably on a `responding`→`idle` fast path, fall back to the AC-required `interruptButton` visibility alone as the running gate; the interrupt is valid against a `thinking` turn too. Prefer keeping the cursor gate when timing allows — it makes "genuinely streaming" concrete.
