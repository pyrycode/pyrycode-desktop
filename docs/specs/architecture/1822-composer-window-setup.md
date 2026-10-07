# Composer native setup recovery

## Files read
- `e2e/composer-options-clamp.spec.ts` → parameterized long-model cases: native setup precedes unchanged geometry, keyboard and final-line click assertions; separate resize case stays untouched.
- `e2e/fixtures/mainProcessRead.ts` → `readMainProcess`, `isTransientContextLoss`: only read callbacks may tolerate context loss.
- `e2e/fixtures/localListFailure.ts` and its tests → `installUnreadableLocalList`: confirm effect before resending; guard late callbacks.
- `docs/knowledge/features/e2e-harness.md` → Tolerating a transient inspection-context loss on reads / Confirmed control resends: inconclusive reads cannot authorize controls.
- `docs/knowledge/features/development-verification.md` → Layout and input: confirm content size divided by zoom, allow rounding, wait two frames.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `package.json`, `playwright.config.ts`, `vitest.config.ts`: test boundaries and default workers/retries.

## Context
The #1761 full gate at `e0b178ce89` failed the initial long-model resize evaluation after 1268ms, before menu assertions. Launch-fate shows the app running, exit code 0 and clean teardown; a focused retry-0 rerun passed in 2407ms. This confirms an ambiguous inspection acknowledgement. Whether the native change executed, and the upstream Playwright/Electron trigger, remain unproven. No product visual change or external prerequisite is established.

## Design
Add a single-consumer `configureComposerWindow(app, size, zoom)` helper beside the fixtures. Return the confirmed native content dimensions. Combine size and zoom setup rather than introduce a generic mutation framework: both belong to one native geometry contract. The serialized control callback checks each current value before setting it, so applied fields and late callbacks never repeat a setter.

After each control evaluation, inspect outer size, content size and zoom through `readMainProcess`. Permit at most two control evaluations, each followed by at most three inspections, separated by 100ms. Matching state succeeds immediately. Only a transient control loss plus a final conclusive mismatch authorizes the second guarded control. A final unavailable inspection fails, even if an earlier inspection found absence. A successful control with persistent mismatch fails rather than being replayed.

In the two long-model cases call this helper for each zoom. Poll renderer inner dimensions against confirmed content dimensions divided by zoom, allowing one pixel rounding, with a five-second bound; then await two animation frames before opening the menu. Keep every existing assertion and the separate resize/width-restoration case intact.

No overlapping in-flight remote branch touches the planned files. Size: one deliverable, four observable acceptance criteria, about 300 written lines, one new exported function, one parameterized consumer, fewer than ten reject branches. No dependencies or production edits.

## State + concurrency model
Only native window state changes; no stores, streams or IPC contracts change. Controls are awaited in sequence. Read retries do not mutate anything. Confirmation covers a lost acknowledgement before or after either field's effect; per-field guards protect partial application and late original callbacks. Renderer polling and frame waits complete before user interaction. Each test owns its Electron process and teardown.

## Error handling
Reuse the existing transient recognizer. Unrelated errors and non-Error throws propagate unchanged from control and inspection. Missing windows fail. Permanent loss, unconfirmed effects, and renderer geometry timeout fail within the explicit attempt/poll bounds; inconclusive inspection never succeeds or resends.

## Testing strategy
- Vitest runs actual serialized callbacks against a fake native window; inject loss before and after control execution and during reads.
- Cover normal and already-applied state, partial application, late original callbacks, confirmed-absence resend, permanent/inconclusive loss, finite exhaustion, acknowledged mismatch, missing window and unrelated failures.
- Preserve the 1280×800 and 800×600 long-label proofs at zoom 1 and 1.25; run each ten times with retries disabled, then the full fake suite once at default workers. Record counts and evidence on the issue and PR.
- After final main merge run pre-verify and build. No live Claude required.

## Open Questions
None. Fault injection establishes recovery semantics without claiming an upstream trigger was reproduced.
