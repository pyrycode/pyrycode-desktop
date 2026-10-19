# Scroll-work initial feed readiness

## Files read

- `e2e/thread-scroll-work.spec.ts` → first scenario, `instrument`, `settle`, `reset`, `delta`, `end`: setup precedes the unchanged bounded-work oracle; sibling has a full ordered-content barrier.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: scripted events pass through a native-thread translator, and thread visibility precedes sending.
- `e2e/fixtures/scriptedThread.ts` → `createScriptedThread`, `publish`, `reply`: generated native updates differ from delivered updates and committed rows.
- `src/main/transport/fakeDaemon.ts` → `handleTransport`, `pushFrame`: synchronous sealing/sending supplies no renderer acknowledgement.
- `src/renderer/src/store/threadRuntime.ts` → `event`, `flush`, `handle`; `threadQueryCoordinator.ts` → `receive`: distinguish append scheduling, query recovery and actual row commits.
- `playwright.config.ts` → `workerCount`, configured projects: preserve `PW_WORKERS=3`, projects, workload and zero retries.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`, `development-verification-evidence-that-cannot-pass-too-early.md`, `conversation-shell-scroll-pin.md` → positive commit barriers and bounded anchor/growth verification.
- `docs/specs/architecture/2033-scroll-work-feed-readiness.md` → Revisions: sibling late-rendering evidence does not diagnose this initial-feed cutoff.
- Shared `docs/working-practice.md` and `docs/ticket-scope-policy.md`: publishing, evidence ownership and one independently useful repair.

## Change

Diagnose the existing 32/400-row initial feed on Linux at application revision `1ccee42b96d2495ca450c42743594810ee849b36`. Retain baseline JSON/stderr and inspect progress at and after the original 15-second deadline, including generated frames, received native updates, connection/recovery and committed ordered rows. The repeated row-255 cutoff is a clue, not proof of delayed rendering. Choose a local feed/readiness repair only when the controlled comparison supports it. A deadline increase requires unchanged-feed eventual completeness and a measured bounded deadline; a paced feed requires observed delivery/commit barriers rather than sleeps. A demonstrated production or external defect returns concrete repair scope to refinement instead of concealing it in setup.

For both sizes require every exact ordered Markdown content and completed history row before adding Growing; require exactly `size + 1` assistants and its committed tail before measurement. Keep all readiness outside the existing counter reset. Preserve every geometry/work bound, cross-size comparison, three held growth updates, following growth/positions and the sibling gap/hidden-run/cleanup scenario. No production/shared harness/dependency/configuration/UI changes are planned.

The pre-plan remote feature-branch audit found no overlap with `e2e/thread-scroll-work.spec.ts`. One deliverable: reliable initial setup for the existing regression, including its cause evidence. Forecast 220 written lines, zero new exports or production callers, four observable criteria and no new production reject branches; both sketch and plan fit the ceilings. No lifecycle state is introduced; existing growth identity reuse remains tested by this scenario. No documentation handoff is requested.

## Testing strategy

- Run the unchanged named scenario with `PW_WORKERS=3`, `--retries=0`, JSON/stderr and scratch output. Record application/dependency/build identity.
- Use temporary spec-local diagnostics, excluded from the work oracle, for a controlled same-application/dependency/worker comparison. Retain failed results and diagnostics; distinguish rendering delay from delivery/recovery failure.
- After repair run ten separate consecutive named Linux invocations and both cases in the spec, zero retries. Record configured/effective workers and executed/passed/failed/skipped counts plus raw paths.
- Merge final main, install, run the pre-verify check with the affected scroll-pin unit file and `npm run build`; prepare Electron-native dependencies sequentially before browser checks.
- Verifier/dispatcher owns the complete configured default Linux application gate: named scenario must pass first attempt, original project/concurrency settings, counted results and retained skip reasons. This builder does not claim that later gate passed. Other OS and live-provider checks are outside scope.

## Revisions

Investigation, chosen repair contract and counted validation will be appended here. Raw evidence stays under `/tmp/builder-2140/`.

### 2026-10-19 — cause and selected contract

Controlled Linux x64 comparisons use application `1ccee42b96d2495ca450c42743594810ee849b36`, plan-only HEAD `b8e06d95a5e528957422cfcb3ea9910ee0a4d5a6`, Node 25.8.0, Electron 33.4.11 and Playwright 1.61.1. Lock SHA-256 is `ce7ecdb807ffdceacd7e93c272b989f1c1f3f07a9b045ab58d8879088fe91026`; configuration SHA-256 is `0d1fb967aa3b3d66275b736ec63bc55142dff69708eb297cce6ff3d4898d2643`. `baseline-identity.sha256` and `dependencies.json` retain build/dependency identities. An initial install race left missing dependencies and zero executed tests (`baseline.stderr.log`); a sequential unchanged-lock install and Electron-native preparation completed before all counted controls.

All invocations configure `PW_WORKERS=3`, original native-writer/clipboard/parallel projects and `--retries=0 --reporter=json`; focused diagnostics use `--no-deps` and one effective worker. `control-original.json` passed 2/2, zero failed/skipped (native-writer prerequisite plus named scenario). `control-diagnostic.json` passed 1/1, zero failed/skipped. Its row timeline commits individually through 256 at 8178ms, then commits the remaining 144 together at 13108ms. All 1201 native updates arrive and apply; only the initial version-zero catch-up occurs, with no reconnect, repair or failed query.

Temporary spec-local diagnostics record generated request types, received update versions, MutationObserver row counts/text and content-free main event/code pairs. They do not enter the hook-work oracle. CDP throttling is applied only after launch, identically in controlled before/after runs, and restored before geometry checks; none ships. `diagnostic.patch` and `repaired-diagnostic.patch` retain the exact instrumentation.

`control-twofold.json` reproduces the retained incident's exact assertion: original 15000ms tail wait rejects with `History row 255`. The same unchanged feed subsequently commits all 400 exact ordered contents at 52563ms; the completed-row check also passes before rethrowing the original failure. Received native update count/version is 1201/1201, all apply, with no disconnect, failed query, repair or additional catch-up. `control-twofold-deadline-400.json` and `control-twofold-eventual-400.json` retain the rows and timeline; CDP snapshot execution itself waits behind renderer work, so its read time is later than assertion rejection. This is delayed event processing/React commit of an intact burst, not missing delivery or failed recovery. The historical runs stop on rejection and cannot separately establish their subsequent progress; the same cutoff and eventual completeness are established by this controlled reproduction.

The stronger sixfold stress (`control-slow.json`) remains a failure: 1 executed, 0 passed, 1 timed out, 0 skipped. It retains the original 15-second tail rejection too, and an exact ordered 400-row commit at 108561ms, but exceeds the unchanged 120-second case budget during diagnostic handling/teardown. It is not acceptance evidence.

Choose a local 60000ms initial-history barrier: it exceeds the measured moderate-control complete commit of 52.6 seconds, remains bounded within the existing 120-second scenario, and changes neither global deadlines nor feed/workload. Replace the tail-only check with exact ordered Markdown contents for every row, followed by zero streaming cursors, before adding Growing. Keep Growing's existing 15000ms tail/count checks and every measured assertion. Attach history count/tail/elapsed time for both sizes. No shared harness or production repair is indicated by the controlled evidence.

`repaired-twofold.json` passes 1/1, zero failed/skipped, retry 0, at the identical app/build/dependencies, configured/effective workers 3/1 and twofold post-launch throttle. History barriers observe 32 and 400 completed ordered rows; Growing observes 33 and 401 rows. The 400-row commit is at 33300ms and its completed-row readiness at 33658ms, still beyond the old deadline. All 1201 updates arrive with no recovery; every original geometry, cross-size and held/following-reader assertion passes. This is not a render-speed optimization claim: scheduling and assertion polling affect timings. The stronger barrier's measured success establishes correctness after late completion. All temporary diagnostics/throttling are removed from the shipping diff.

Main-versus-renderer timing further distinguishes delivery from commit: relative to the captured `send_message` request timestamp, the twofold control's main `thread-update-delivered` records cover all 1201 native updates from 321ms through 1122ms, while the renderer's forwarded `thread-items-applied/live` diagnostics run from 335ms through 51845ms. Thus main has received/forwarded the complete burst well before the original deadline; renderer event processing/commit continues afterward. The repaired counterpart delivers all updates by 760ms and applies through 32750ms. These content-free timestamps remain in the extracted comparison JSON, alongside the renderer mutation timeline.

### 2026-10-19 — final Linux validation and verifier handoff

Final checks ran at `d35702ac26045a270e003754a8596622cf149300`, after merging main `3897f0dd5637f16f5f82a337b33ccaed3274389b`. The closing evidence commit changes this plan only. Main and renderer artifact hashes, lockfile and Playwright configuration match `baseline-identity.sha256` byte for byte after rebuilding. Node-native preparation/pre-verify finished before Electron-native preparation and browser checks; no native rebuild overlapped browser validation.

| Reports under `/tmp/builder-2140/` | Executed / passed / failed / skipped | Configured / effective workers |
| --- | --- | --- |
| `final-named-1.json` through `final-named-10.json` | 10 / 10 / 0 / 0 | 3 / 1 each |
| `final-both.json` | 2 / 2 / 0 / 0 | 3 / 1 |

Every report has zero retries and report-level errors, with original native-writer/clipboard/parallel projects configured. No cases were skipped, so skip-reason lists are empty. These focused commands use `PW_WORKERS=3 npx --no-install playwright test e2e/thread-scroll-work.spec.ts --no-deps --retries=0 --reporter=json --output=<scratch-directory>`; named invocations add `--grep 'scroll lookup and same-row growth'`. `run-final.sh` retains the ten separate sequential invocations. The original control also passed the native-writer prerequisite against the identical application build. `audit-final.py` verifies actual execution, every status/retry, project/worker configuration and all readiness attachments; `validation-identity.json` retains the full counted results and revisions.

All ten named runs positively observe 32/400 ordered completed history rows and 33/401 Growing rows. History readiness ranges are 732–1978ms for 32 rows and 14337–26720ms for 400 rows, further demonstrating ordinary completion beyond the original allowance. Every run records hook work `{size:32,scroll:6,growth:14}` and `{size:400,scroll:10,growth:22}`; all enumeration/re-observation, held/following growth and position assertions pass. The both-case run passes the unchanged sibling's gap/hidden-run/cleanup assertions too; its long-history readiness is 14022ms. Matching `.stderr.log` paths and extracted `*-history-readiness-*`, `*-growing-readiness-*` and `*-hook-work.json` attachments are retained beside every raw report.

`pre-verify.log` records all five checks passing, including 15 executed/passed affected unit tests and zero failures/skips in `src/renderer/src/screens/conversation/threadScrollPosition.test.ts`. `build-final.log`, `docs-check.log` and `native-electron-final.log` record successful build, documentation guard and subsequent native preparation. No live-provider tests changed or ran; another OS is outside this ticket's verification scope. The cause and controlled comparison were posted on issue #2140, with final counted evidence supplied separately.

Retained archive `/tmp/builder-2140-evidence.tar.gz` contains 274 evidence files plus `evidence-manifest.sha256`. Archive SHA-256: `7970273a470d0cf43b6324eb5b3a50c3491b2ab2a17a43ce756afae02b39095a`; manifest SHA-256: `85ad5ce8276855978845b6e5d07fc1721091bbc7b423f0425dccbd78d1adb823`. Failed controls and the zero-executed dependency-setup failure remain retained, never converted to passes.

Pending verifier/dispatcher-owned acceptance: run the complete configured default Linux application gate (`PW_WORKERS=3 npx playwright test --retries=0 --reporter=json`, no spec/grep/project/shard filters), retaining JSON/stderr, executed/passed/failed/skipped counts and skip reasons. The named scenario must pass on its first attempt with the original project/concurrency settings. This later-stage gate is not claimed passed by the builder.
