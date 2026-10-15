# Fetch reconnect reliability

## Files read
- `e2e/hosted-app-view.spec.ts` → `scenario`, reconnect case: commits the held POST before reconnect, then reconciles by GET without replay.
- `e2e/fixtures/launchPairedApp.ts` → `test`: merged #2001 repair excludes app rows from strict conversation selection; Send-enabled remains the handshake gate.
- `docs/knowledge/features/daemon-connection-hosted-resource-views.md` → Hosted Fetch, Connection reset and dispatch, Fetch verification: fresh authority/origin and no automatic mutation replay.
- `docs/knowledge/decisions/0012-hosted-app-native-isolation.md` → native isolation and discovery contract.
- `docs/knowledge/features/development-verification.md` and `development-verification-evidence-that-cannot-pass-too-early.md` → positive barriers and counted evidence; the older unfiltered-selector description predates the merged repair.
- Root `CLAUDE.md`, knowledge index and #2008 refinement: test boundaries and original failure evidence limits.

## Change
Reuse main's `cba79876` selector repair. In the named reconnect case only, install a one-shot Playwright locator handler before pairing that waits for the initial app row before conversation activation. This deliberately exercises the two-row setup that broke the old strict locator, without delaying or disabling discovery, selecting an arbitrary first row, or weakening the Send-enabled gate. Keep the held committed POST, disconnect, discovery-pending refusal, fresh origin, late reply, committed reconciliation GET and exactly-one-POST assertions intact. No production change, new exports, lifecycle state or failure mode. One deliverable, approximately 60 written lines, zero consumer migrations and two observable acceptance criteria; within all sizing limits.

Remote overlap inspection found #1983 adding independent setup diagnostics to `launchPairedApp`; no shipping shared-fixture edit or dependency is needed. Other hosted-view slices share this file; keep the change local to this case.

## Testing strategy
- Install and build, then run the named case with the pre-repair initial locator temporarily restored. Expect a strict-mode launch failure naming both the conversation and app rows, before hosted open/reconnect. Restore the merged selector with an explicit patch and rerun the same regression.
- On Linux run ten separate Playwright invocations selecting the named case, `--retries=0`, then the complete `hosted-app-view.spec.ts` with zero retries. Record exact revision, configuration and executed/passed/failed/skipped counts in Revisions and the issue evidence comment.
- After final merge of main run pre-verify and `npm run build`. Keep raw JSON/stderr in `/tmp/builder-2008/`; commit concise counted evidence here. The truncated original #2001 report cannot establish this occurrence's exact assertion; distinguish the controlled reproduction from original-trace attribution.

## Revisions
2026-10-15: Linux control on base `cba798763b1ca788fee07409c5dd6eb1fe9f54cc` plus the local regression barrier and only the old initial selector restored: 1 executed, 0 passed, 1 failed, 0 skipped, retry 0 (`control-old-selector-run.json`). The handler completed before `locator.click` rejected two targets, “Seeded discussion” and “Example running”, in `launchPairedApp`; no hosted open or reconnect ran. Restoring the merged selector with the identical barrier passed: 1 executed/passed, 0 failed/skipped, retry 0 (`repaired-selector.json`). This confirms a reproducible launch setup race, not a reconnect failure; the original incident's missing stack remains unattributed. An earlier anchored grep selected zero tests and is excluded from evidence. No design change was needed.

Final Linux x86_64 evidence at pushed candidate `bfa5aa04199c5496e52c514d59d618115675d79b`, after final merge of `origin/main` (`cba79876`), 2026-10-15:

| Check | Executed | Passed | Failed | Skipped | Retries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ten independent named-test invocations | 10 | 10 | 0 | 0 | 0 |
| Complete hosted-view spec, named case included | 23 | 23 | 0 | 0 | 0 |
| Full unit suite, 413 passing files | 10331 | 10331 | 0 | 3 | 0 |

Commands: ten separate `npx playwright test e2e/hosted-app-view.spec.ts --grep 'Fetch reconnect reconciles committed uncertain writes without replay$' --retries=0 --reporter=json`; complete spec uses the same command without `--grep`. Original config retained: three configured workers on this machine, one effective worker for this serial file, clipboard/parallel projects, repeatEach 1. All result entries were inspected, including the named case and retry values. No e2e skips or global errors. Pre-verify passed all five checks, final `npm run build` and `npm run check:docs` passed. The three unit skips are existing tests; no test was disabled here.

Reports/stderr are `/tmp/builder-2008/linux-independent-1.json` through `linux-independent-10.json`, `hosted-app-view-full.json`, and matching `.stderr` files; checks are `pre-verify.log`, `build-final.log`, `docs-check.log`. `SHA256SUMS` records the raw artifacts; complete-spec JSON SHA-256 is `34168d95e6cc4976dc6123c1036b7222ff9aba1c2606751a537c4f6bbf067650`. This final revision adds evidence only; the tested spec and production tree remain identical to the candidate. Dispatcher owns the subsequent complete fake suite gate; no live-daemon proof is claimed.
