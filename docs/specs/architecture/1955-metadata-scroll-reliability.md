# Metadata scroll regression reliability

## Files read

- `e2e/turn-stats-hover.spec.ts` → repeated metadata regression: first wheel clearance and held-reader setup.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin`, `reassertPinnedToBottom`: native input, geometry guards and resize delivery.
- `e2e/thread-scroll-pin.spec.ts` → `stableThreadOffset`: stable offset/content/viewport sampling.
- `e2e/fixtures/desktopIsolation.ts`, `electronLaunch.ts` → Linux shown-window presentation and native launch restrictions.
- `playwright.config.ts` → four-worker default, file scheduling and retries.
- `docs/knowledge/features/conversation-shell-scroll-pin.md` → Thread scroll pin: following intent differs from settled geometry.
- `docs/knowledge/features/conversation-shell-message-bubble.md` → The meta row: hover/focus adds layout height.
- `docs/knowledge/features/development-verification-layout-and-input.md` → Layout and input: rendered overflow and genuine held setup.
- `docs/knowledge/features/development-verification.md`, `docs/knowledge/INDEX.md`, `CLAUDE.md`: verification and repository rules.
- `docs/specs/architecture/1916-permission-reader-setup.md`: causal observation and immutable held baseline pattern.

## Change

Diagnose the first wheel-to-clearance transition using temporary event/geometry observations in the existing fake-transport regression. Distinguish rendered-history readiness, pointer/layout timing and native motion from a product following defect; record the confirmed observation in Revisions and on the issue. Keep the repair local to this spec if readiness is responsible. A demonstrated renderer defect requires a recorded design revision before its minimal hook correction.

Require completed rendered overflowing history, stable scroll/content/viewport geometry, and trusted upward input with positive movement and distance from the bottom before capturing a held reference. Preserve downward wheel navigation through changing metadata, tail hover/focus reveal/collapse and both 1280px and 800px cases. Preserve the existing ≤1px bottom/input clearance and immutable reference-position tolerance after rendered effects. No corrective scroll after an action, changed baseline, sleeps, retries, timeout increases or parallelism changes.

This initial test-only design introduces no exported type, product state or failure mode. No numeric remote feature branch overlaps the spec or scroll hook. The nonnumeric suggestion branch changes only Composer, so a hook change could remain local. Estimate: ≤220 written lines, ≤1 production file, zero consumer migrations, three acceptance behaviours; all size limits hold. No UI change or Figma read is needed unless diagnosis requires a renderer correction.

## Testing strategy

- Reproduce or control the original transition with geometry/event ordering evidence before choosing the repair; temporary diagnostic code stays out of the final diff.
- The existing named Playwright test covers width changes, wheel return, repeated tail reveal/collapse and above-viewport `preventScroll` focus/collapse. Require the above-viewport condition positively and keep one immutable reference through both effects.
- Run 20 focused repetitions with four configured/actual workers, zero retries and zero skips, recording candidate revision, Linux/Xvfb presentation and executed/pass/fail/skip counts.
- Merge main, run pre-verify and build. The verifier/dispatcher owns the full four-worker default gate and its named attempt-zero result; no live Claude proof is required.

## Revisions

2026-10-14 — Diagnosis requires the minimal renderer correction allowed by the ticket. At base `9fddff32`, instrumented original repetitions failed 20/20 (17 first-wheel failures, 3 final-wheel failures); complete event-ordering trials and a 20-stable-frame control each failed 3/3. All 42 rows were present. A representative first wheel began at offset 0, height 3109, viewport 760, hovered row 4. Before scroll delivery hover moved to row 38; offset became 2321 while height remained 3109. The old row's 28px collapse anchored the reader upward while the new row's 28px reveal replaced that height. The 28px bottom distance never resumed following; row resize consequently made no pin write. Settling pre-input geometry cannot repair this native input/layout ordering. Reports: `/tmp/builder-1955/diagnostic.json`, `ordering.json`, `settled-control.json`.

Original verifier evidence at `3bba3878fc`: `verifier-gate_#1953_6.log`, four actual workers, 395 executed / 394 passed / 1 failed / 3 skipped; named test attempt 0 failed at its first clearance, 28px for the 5000ms poll. Focused rerun `2026-10-14T18-44-29-837Z_verifier-gate-rerun_#1953.log`: four configured / one actual worker, 1 executed/passed, zero failed/skipped, attempt 0.

Cleaner shape: extend the existing trusted downward-wheel guard rather than introduce a pending gesture state or new observer. A pixel-mode wheel whose positive delta covers the measured remaining scroll range expresses bottom intent, even before native movement. Set the existing following ref; perform no immediate scroll write. Existing scroll and resize paths restore clearance. Short downward movement does not acquire following early, non-pixel input retains the existing measured-bottom guard, and trusted upward input still releases it synchronously. No new types, state, failure modes or consumer updates; written work remains below 220 lines.

The regression now proves completed overflow and stable pointer/layout, uses trusted upward motion to establish history start and held position, and preserves an immutable content reference after positive above-viewport reveal/collapse. A short 40px downward nudge before that baseline guards against snapping ordinary reader movement to bottom.

2026-10-14 — Further controls distinguish observer effects from passive evidence: diagnostic geometry reads themselves force the vulnerable layout ordering. The strengthened test without those reads passed 20/20 on unchanged production, four configured/actual workers, zero retries/skips (`ready-before20.json`). Reintroducing just one read-only `scrollHeight` access in a one-shot native wheel listener reproduces the first-clearance 28px failure in 3/3 trials despite rendered overflow, trusted upward navigation and 20-frame stable geometry (`layout-read-before.json`). This is the retained deterministic regression: no scroll assignment, input cancellation or extra wheel is involved. It models a layout flush during input delivery and demonstrates that readiness alone cannot cover the product's ordering gap. The original gate cannot establish its exact event schedule retrospectively; the controlled observation confirms the same failure mechanism and residual, rather than claiming the diagnostic traces were passive recordings of that gate.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4225 and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=814-12025, read with screenshots on 2026-10-14. Existing left/right bubbles hug content at rest; row hover/focus reveals the body-small time/stats row with inverse-primary ink and existing action icons. The correction changes scroll intent only; existing components, assets and theme tokens render these states.
