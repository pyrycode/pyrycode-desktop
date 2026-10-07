# Stabilize the sidebar row pointer observation

## Files read
- `e2e/sidebar-row-geometry.spec.ts` → `computedAll`, the Chats-row test: immediate reads after pointer delivery assume hover survives native input.
- `e2e/fixtures/desktopIsolation.ts` → `e2eShowsWindow`, `launchIsolatedApp`: Linux Xvfb windows are shown; throttling exemptions do not isolate native pointer events.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: existing fake transport and per-launch teardown remain the test boundary.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__row:hover`, open-row `:has()` and control reveal: no colour transition; correct styling whenever hover is present.
- `docs/knowledge/features/channel-list-row-hover-control.md` → wrapper fill, sibling glyph and keyboard focus contracts.
- `docs/knowledge/features/e2e-harness.md` → Desktop isolation: shown Linux windows and hidden macOS presentation differ.
- `docs/knowledge/features/development-verification.md` → Layout and input: native window and renderer state must be observed independently.
- `CLAUDE.md`, `docs/knowledge/INDEX.md` → interaction belongs in fake-transport Playwright; no production redesign.

## Change
The defect is the test's assumption that completed `hover()` guarantees hover remains active until a subsequent style read. At baseline `59efab093c13f2ed1bd5658ee836d14e57a04de5`, a controlled shown-window arrival after pointer delivery reproduced the historical transparent resting row with the unchanged CSS: the resting row stopped matching `:hover`, while the open row retained `rgb(0, 51, 85)`. In the scratch observation, cycle 19 also received a native pointer move at (550,373) outside the row after the commanded (226,209) move. Two animation frames did not restore hover. Separate unfocused-window observations retained both hover and the correct fill, so focus alone is not the cause. The original 20-repeat run also failed control reveal once (19 passed, 1 failed), a second symptom of lost hover.

Use local pointer-observation helpers in the named test only. Each polling attempt delivers real Playwright pointer input, then takes one renderer snapshot of target/row hover and the exact computed fills or control opacities being asserted. Check the hover precondition and styling together, including over the trailing glyph and while parked away from rows. Re-delivery handles native input interference; polling a colour without re-delivery would not handle the observed persistent loss. Keep exact colour/opacity assertions and all geometry, typography, keyboard-focus and activation coverage. Keep existing timeouts, test retries and suite parallelism. No DOM/CSS hover forcing, sleeps, renderer changes or shared harness migration.

Historical evidence: `verifier-gate_#1723_6.log` at `1832410096` reports 299 passed, 1 failed, 4 skipped, three actual workers, attempt 0; `2026-10-06T20-25-25-914Z_verifier-gate-rerun_#1723.log` reports the named test 1 executed/passed, no skips, one actual worker, attempt 0. Those logs localized the failure; the controlled observation above distinguishes input interference from a styling defect. Publish the cause and observation evidence on #1819.

Scope: one verifiable deliverable, about 180–240 written lines including plan and tests, no exported symbols, no consumer migrations, three acceptance behaviours. No in-flight branch overlaps the test; #1658 adds unrelated create-channel model styles in `channels.css`, which this ticket does not edit. No documentation handoff requirements or ADR.

## Testing strategy
- First run the unchanged named test under three-worker repetitions and observe its failure; preserve its assertions.
- Controlled native window arrival reproduces absent hover plus transparent fill despite completed real hover; ordinary hover with unchanged CSS restores the correct treatment. Scratch evidence stays under `/tmp/builder-1819` and the durable causal findings go in the issue and PR.
- Exercise the synchronized observation against that same interference, and check that a deliberately wrong expected fill still fails while hover is confirmed.
- After final main merge, run pre-verify and build.
- Run the named test 20 times with three configured/actual workers, retries disabled, zero skips; then run the complete default fake-transport suite with three workers and retries disabled. Record revision, Linux/Xvfb shown-window presentation, actual worker count and executed/pass/fail/skip totals, separating the named test from unrelated failures.
- No live Claude test or visual change is required.

## Revisions
2026-10-07: The sensitivity check uses a scratch copy of the built renderer with the single hover-background declaration removed, rather than an incorrect expected value. The synchronized assertion fails with `hoveredRows: 1` and the resting fill transparent, while control reveal and the open fill remain correct. This directly proves that re-delivering input cannot hide a missing hover style. The test's production expectation remains unchanged.
