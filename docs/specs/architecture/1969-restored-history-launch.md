# Restored-history launch readiness

## Files read
- `e2e/fixtures/launchPairedApp.ts` → `LaunchControl.onLaunched`, `launchPairedApp`: hook currently precedes window readiness, but promises installation before pairing/activation only.
- `e2e/queued-own-settlement.spec.ts` → restored-identity variants: replace the saved timeline handler, then preserve expanded tool DOM nodes across both event orders.
- `e2e/fixtures/desktopIsolation.ts` → `launchIsolatedApp`, `ignoreDisplayPointer`: preserve isolation, sandbox launch guard and teardown ownership.
- `e2e/fixtures/electronLaunch.ts` → `electron.launch`: retain the macOS sandbox restriction.
- `src/main/index.ts` → application-ready callback, chat-history registration, `openWindow`: production registers history before creating the first window.
- `node_modules/playwright-core/lib/coreBundle.js` → Electron initialization and `firstWindow`: launch starts application readiness; discovered windows are cached, so waiting after the hook does not itself lose an event.
- `docs/knowledge/features/e2e-harness.md`, `e2e-harness-context-recovery.md`, `development-verification.md`, `development-verification-evidence-that-cannot-pass-too-early.md`: distinguish readiness from mutation acknowledgement and retain positive processing barriers.
- `docs/specs/architecture/1794-confirm-local-list-failure-setup.md`: avoid replaying handler replacement after ambiguous inspection loss.

## Change
Await the first window before running `onLaunched`, retaining its guarantee that it completes before the fixture pairs or opens a conversation. A first-window barrier ensures production history registration has completed before replacement; no production startup changes, retries, delays or timeout increases. Add hook-time assertions in both restored-identity cases that a window and original history handler exist, and confirm the restored timeline is rendered before interaction. Keep every identity/expansion/result assertion and both positive live/prepend receipt barriers. Strengthen order barriers only if fresh evidence shows another setup/processing race.

One deliverable, approximately 180 written lines including this plan and diagnosis evidence; zero production files, new exported types or consumer migrations; three observable criteria and no new reject state machine. The remote overlap scan found no other feature branch touching the three investigated fixture/spec files. The nearest analogue is the initialization ownership repair in #1813; this change is smaller because it adds no acquisition cleanup path.

## Testing strategy
- Run the original two cases with launch diagnostics before edits. Initial focused run: 2 passed; ten repetitions per variant: 20 passed. These do not establish the original cause.
- First add hook readiness assertions to both existing cases and watch them fail against the old fixture. Diagnose handler/window state and startup errors rather than infer a lost window event from the timeout stack.
- Then apply the fixture ordering repair and run the complete queued-settlement spec. Preserve its real pairing and DOM identity assertions.
- Run the complete configured `npm run e2e` tier, without filtering or added skips; record commit, executed/passed/failed/skipped counts and skip reasons here and in the PR.
- After merging final main, run the pre-verify check and build. No live-Claude or visual acceptance is required for this test-only repair.

## Open Questions
Confirm the startup failure mechanism for both variants with fresh evidence. If the hypothesis is disproved, append the actual diagnosis and adjusted contract in Revisions before handoff.

## Revisions
2026-10-14: confirmed startup-registration race, not a lost window event. Both new hook-readiness assertions failed against the original fixture with zero discovered windows; their launch-fate attachments reported a running process, exit code 0 after cleanup and no teardown failures. The repaired fixture passed all eight queued-settlement cases, including both original restored-identity variants (1.6s and 1.9s).

A separate diagnostic launched the same built app with isolated user data, hidden-window presentation and the existing throttling switches, then immediately performed the original handler capture/remove/install sequence. With no injected delay or retry, attempt 4 observed `originalHandlerPresent=false` and zero native windows. Application startup subsequently rejected its own history registration as a second handler, leaving no window. This is the race shared by the two variants: neither uses `historyFirst` until after launch and restoration.

An explicit promise barrier around application readiness also forced the same ordering for each variant: installation found no original handler and no window; releasing startup produced the duplicate-registration error and the unchanged 30000ms `firstWindow` timeout with zero native windows. This isolates the registration failure from Playwright page discovery. Diagnostic scripts and logs are under `/tmp/builder-1969/`; no diagnostic preload or startup control ships in the test suite.

The final contract is unchanged from Change: first-window readiness precedes the hook; hook completion precedes pairing/activation. Original-handler presence is checked before any removal, restored-answer visibility precedes expansion, and every original identity/expanded-state/child-result assertion and positive live/prepend receipt barrier remains. The Open Question is resolved; no production, protocol, timeout, retry or sandbox change is needed.
