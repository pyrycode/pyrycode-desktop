# Fetch reconnect reliability

## Files read
- `e2e/hosted-app-view.spec.ts` → `scenario`, reconnect case: commits the held POST before reconnect, then reconciles by GET without replay.
- `e2e/fixtures/launchPairedApp.ts` → `test`: merged #2001 repair excludes app rows from strict conversation selection; Send-enabled remains the handshake gate.
- `docs/knowledge/features/daemon-connection-hosted-resource-views.md` → Hosted Fetch, Connection reset and dispatch, Fetch verification: fresh authority/origin and no automatic mutation replay.
- `docs/knowledge/decisions/0012-disposable-native-hosted-views.md` → native isolation and discovery contract.
- `docs/knowledge/features/development-verification.md` and `development-verification-evidence-that-cannot-pass-too-early.md` → positive barriers and counted evidence; the older unfiltered-selector description predates the merged repair.
- Root `CLAUDE.md`, knowledge index and #2008 refinement: test boundaries and original failure evidence limits.

## Change
Reuse main's `cba79876` selector repair. In the named reconnect case only, install a one-shot Playwright locator handler before pairing that waits for the initial app row before conversation activation. This deliberately exercises the two-row setup that broke the old strict locator, without delaying or disabling discovery, selecting an arbitrary first row, or weakening the Send-enabled gate. Keep the held committed POST, disconnect, discovery-pending refusal, fresh origin, late reply, committed reconciliation GET and exactly-one-POST assertions intact. No production change, new exports, lifecycle state or failure mode. One deliverable, approximately 60 written lines, zero consumer migrations and two observable acceptance criteria; within all sizing limits.

Remote overlap inspection found #1983 adding independent setup diagnostics to `launchPairedApp`; no shipping shared-fixture edit or dependency is needed. Other hosted-view slices share this file; keep the change local to this case.

## Testing strategy
- Install and build, then run the named case with the pre-repair initial locator temporarily restored. Expect a strict-mode launch failure naming both the conversation and app rows, before hosted open/reconnect. Restore the merged selector with an explicit patch and rerun the same regression.
- On Linux run ten separate Playwright invocations selecting the named case, `--retries=0`, then the complete `hosted-app-view.spec.ts` with zero retries. Record exact revision, configuration and executed/passed/failed/skipped counts in Revisions and the issue evidence comment.
- After final merge of main run pre-verify and `npm run build`. Keep raw JSON/stderr in `/tmp/builder-2008/`; commit concise counted evidence here. The truncated original #2001 report cannot establish this occurrence's exact assertion; distinguish the controlled reproduction from original-trace attribution.
