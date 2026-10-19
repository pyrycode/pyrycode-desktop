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
