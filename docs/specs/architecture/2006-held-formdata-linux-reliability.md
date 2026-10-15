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

## Revisions

2026-10-15: verification completed on Linux x64, Node v25.8.0, revision
`193548839b60f7ebb6dde000be4752f659c8f213`, containing main `cba79876`.
No shipping code or assertions changed. The opposite arrival order was also
checked by holding the requested initial discovery reply until launch returned,
then releasing it before the unchanged cancellation assertions.

| Run | Executed | Passed | Failed | Skipped | Retries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Old selector, app visible before click (controlled diagnostic) | 1 | 0 | 1 | 0 | 0 |
| Merged selector, identical app-visible barrier | 1 | 1 | 0 | 0 | 0 |
| Merged selector, app discovery completed after launch | 1 | 1 | 0 | 0 | 0 |
| Unmodified named case, ten independent invocations | 10 | 10 | 0 | 0 | 0 |
| Complete `hosted-app-view.spec.ts` | 23 | 23 | 0 | 0 | 0 |

Commands: `node_modules/.bin/playwright test e2e/hosted-app-view.spec.ts
--grep 'Fetch cancels held FormData serialization on pagehide$' --retries=0
--reporter=json`; the whole-file run omitted `--grep`. Default configuration
retained four configured workers, one effective worker for this single file,
and the `parallel` project. Every report has zero report errors and retry zero;
every launch-fate attachment has clean teardown and exit zero. The diagnostic
failure names both Seeded discussion and Example running in strict mode.

All temporary patches were removed before the ten runs. Fresh reports, stderr,
control patches and checks are under `/tmp/builder-2006/`; `summary.json` SHA-256
is `f35b5387ebc91b3f8eec82256b214324cfb8c7ec4c828908a6a70922e3763dc8`.
After the final main merge, pre-verify passed all five checks (413 unit files,
10,331 passed tests, 3 existing skips), and `npm run build` passed.
