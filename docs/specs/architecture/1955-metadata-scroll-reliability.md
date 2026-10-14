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
