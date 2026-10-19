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
