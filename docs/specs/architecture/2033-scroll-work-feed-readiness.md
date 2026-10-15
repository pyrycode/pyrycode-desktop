# Scroll-work feed readiness

## Files read

- `e2e/thread-scroll-work.spec.ts` → `instrument`, `settle`, `correctAnchor` and both scenarios: preserve the bounded-work and lifecycle oracles; change only second-scenario setup.
- `src/main/transport/fakeDaemon.ts` → `FakeDaemon.pushFrame`: synchronous seal/send is not renderer acknowledgement.
- `playwright.config.ts` → `workerCount`, clipboard/parallel projects: preserve configuration and use `PW_WORKERS=2`, zero retries.
- `e2e/fixtures/runDisplay.ts` → `globalSetup`: Linux runs own their Xvfb display.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: repository and proof boundaries.
- `docs/knowledge/features/conversation-shell-scroll-pin.md` → Bounded anchor and growth verification: exclude readiness from measured hook work.
- `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md`: require positive committed input before absence/geometry assertions.
- Shared `docs/working-practice.md`: publishing, validation and evidence ownership.

## Change

The gap/hidden-run scenario currently pushes 100 completed replies then waits only the default five seconds for the final rendered text. Investigate the unchanged scenario on Linux at main `0d299bd26ede123c5dbda7295f7c5f85b52453d6`, then repair only its local feed/readiness setup. If the same feed completes after five seconds, use a bounded local rendering deadline justified by measurements, with positive checks for all 100 assistant rows and the final `History row 99` before any DOM geometry mutation. Verify completion rather than relying on animation frames or send completion. Keep instrumentation disabled until its existing reset, and retain every subsequent assertion and the sibling case unchanged. No production code, shared fixture, dependency, global timeout, project or concurrency changes.

No in-flight remote feature branch overlaps `e2e/thread-scroll-work.spec.ts` in the pre-plan audit. One deliverable; forecast ≤180 written lines, zero new exports, zero migrated production callers, four observable acceptance criteria and no new error branches. No UI change or documentation-stage requirement.

## Testing strategy

- First run the unmodified named scenario with `PW_WORKERS=2`, `--retries=0`, JSON report and retained stderr. Record dependencies and revision.
- Diagnose unchanged-feed progress after the original five-second deadline without ending the app; record count/tail at five seconds and at completion. Keep diagnostics local and exclude them from the shipping work oracle.
- Run the repaired named scenario in ten separate consecutive Linux invocations with zero retries, then both cases in the file. Preserve configured workers and record effective workers from each report.
- Run the complete configured fake suite with `PW_WORKERS=2`, zero retries, unchanged clipboard/parallel projects. Retain JSON, stderr, skip reasons, report errors and exact named-case result.
- After final merge of main, run pre-verify and build. This ticket explicitly requires the full fake suite in builder validation; no live-Claude tests change.

## Revisions

Investigation and counted validation outcomes will be appended here before handoff. Evidence files stay under `/tmp/builder-2033/`; this plan records their provenance and results.
