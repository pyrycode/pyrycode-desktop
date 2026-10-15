# Held FormData cancellation: Linux reliability (#2006)

## Files read

- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: both conversation selectors exclude app-state rows; strict selection and the Send-enabled handshake gate remain.
- `e2e/hosted-app-view.spec.ts` → `scenario` and the held-serialization cases: initial app discovery remains enabled; body-read, early AbortError, completion, processing, zero-POST and single-settlement barriers remain.
- `docs/knowledge/features/daemon-connection-hosted-resource-views.md` → cancellation ownership and counted fake-transport proof.
- `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md` → positive processing barriers before absence assertions.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: repository conventions and verification boundaries.

## Change

Verify the existing repair from #2001 (`6398cf38`), merged by PR #2004 as
`cba798763b1ca788fee07409c5dd6eb1fe9f54cc`. No production or shipping test
changes are planned. The unfiltered row selector formerly matched both the
seeded conversation and the discovered Example app. The merged selector excludes
app-state rows while remaining strict among conversations, independently of app
arrival order. Preserve initial app discovery and all cancellation assertions.

The only in-flight overlap is #1983's additive fake-daemon setup diagnostics in
`launchPairedApp`; this verification does not depend on or edit that work.
Scope: one verification deliverable, two acceptance behaviors, about 60 written
lines of plan/evidence, zero new exports, consumers or production error branches.

## Testing strategy

- Run a temporary controlled diagnostic: wait for the Example app row before the
  fixture click, restore the old broad selector and observe the strict-mode
  two-target failure. Repeat with the merged selector and the same barrier, then
  remove the diagnostic edits. Commit only this plan and counted evidence.
- On the unmodified shipping tests, run `Fetch cancels held FormData serialization
  on pagehide` in ten separate Playwright processes with `--retries=0` on Linux.
- Run all of `e2e/hosted-app-view.spec.ts` with `--retries=0`, retaining the
  configured projects/workers. Keep fresh JSON/logs outside the worktree and
  record revision, executed/passed/failed/skipped counts and retry counts here
  and on #2006.
- After the final merge of main, run the pre-verify check and `npm run build`.
  No live-daemon or visual proof is required for this test-only verification.
