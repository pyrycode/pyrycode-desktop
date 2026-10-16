# Effort-default replay native storage prerequisite

## Files read
- `e2e/fixtures/recordedExchange.ts` → `RecordedExchange.reply`, `drain`: strict matching and connection boundaries remain unchanged.
- `e2e/fixtures/clientScenario.ts` → replay `_clientReplay`: app-open hook precedes pairing and every relaunch.
- `e2e/fixtures/realDaemon.ts` → `withIsolatedElectronApp`: owns isolated profile and process teardown.
- `e2e/real-claude-effort-default.spec.ts` → effort scenario: reopens a persisted thread after profile restart.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`: pre-pair IPC cannot probe storage because membership is required.
- `src/main/chatHistoryStore.ts` → `createChatHistoryStore`: unavailable native database becomes a typed unreadable result.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`, `docs/client-replay-migration.md`: verification scope, strict request contract, native storage and capture provenance.

## Context
On unchanged main `be2afa3f`, request 41 is actually `thread_catch_up` with empty epoch and version 0; the capture requires its saved epoch and version 14 on connection 2. The local diagnostic archive preserves this failure in `/tmp/builder-2069/baseline-native.log`. The earlier main evidence remains `/tmp/builder-2068/main-recorded.log`.

The installed SQLite native addon was unavailable. After `npm run rebuild:electron`, the identical archived source, capture and built app pass (1 executed/passed, zero forbidden launches). Missing native storage, rather than provider drift or query ordering, causes the fresh catch-up. Node unit tests and Electron require different native module ABIs.

One deliverable: make faithful replay's native storage prerequisite explicit and executable. Repair this run's dependency setup with the existing rebuild command; fail future incorrectly prepared runs at startup with actionable diagnostics before replay diverges. No ADR is needed. No overlapping remote feature branch touches the planned files (checked before planning).

## Design
Add `assertReplayNativeStorage(app): Promise<void>` in `e2e/fixtures/replayNativeStorage.ts`. In the actual Electron main process, resolve the installed `better-sqlite3` from the application's package, open an in-memory database, execute a simple query and close it. Return only success/failure across the test boundary; do not expose loader exceptions or paths. Failure throws a static message naming `npm run rebuild:electron`.

Invoke the check from replay's existing app-open hook before device binding, including profile relaunch. Use the in-memory probe because history IPC refuses unpaired hosts. This is simpler than adding a new storage API or changing the guarded launcher. It requires no provider executable, shell process, production code, capture edit, matcher relaxation, timing sleep or new dependency.

## State + concurrency model
No new retained state or background work. Await one probe per opened Electron process. The probe owns and closes its database in `finally`; existing app lifecycle owns process cleanup after failure.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| First app open with unavailable native addon | Controlled native-load failure regression in `replayNativeStorage.test.ts`; errors before scenario requests. |
| Successful open and repeated/profile-relaunch open | `replayNativeStorage.test.ts` repeated probe; original effort-default replay checks persisted version 14 and completes all requests. |
| Probe query fails after opening | `replayNativeStorage.test.ts` verifies close and static failure. |

## Error handling
Native load/open/query failure returns false from Electron, then throws the same content-free prerequisite error in the Playwright fixture. Never swallow an exchange mismatch. Existing sticky failures, read-mark barriers, full payload checks and completion assertion remain unchanged.

## Testing strategy
- Test first: controlled missing-addon/query failures must reject with the static prerequisite error; a healthy probe must close and succeed, including repeated calls.
- Keep the failed unchanged-main diagnostic archive and run the original focused Linux replay after native rebuild.
- Run the complete guarded recorded suite with its existing retries/skips and record counts and forbidden launches. This proves captured client behavior only.
- After final merge of main, run pre-verify, build and client-test typecheck. Rebuild SQLite for Node before unit tests and Electron before replay.

## Open Questions
None. Actual-versus-recorded divergence and dependency-only A/B reproduction are established before implementation.

## Documentation handoff
Pending documentation stage: `docs/recorded-tests.md`, § Replay contract: explain `npm run rebuild:electron` before replay after installation or rebuilding SQLite for Node tests, and the startup diagnostic. Preserve Linux-only evidence scope.

Sizing: approximately 200 written lines including plan, helper and tests; at most 2 exported functions, 1 updated consumer, 3 observable acceptance criteria, and 1 classified prerequisite failure. All limits hold.

## Validation evidence
Linux x64, Node 25.8.0, Electron 33.4.11; final main merge contains `be2afa3ffc3c`. No production files changed. The capture, original effort-default spec and `RecordedExchange` are byte-for-byte unchanged against main.

- Before implementation, the diagnostic main archive failed at request 41: connection 2, actual `thread_catch_up` epoch `""` / version 0, eligible recorded request nonempty epoch / version 14. Worker exited with code 7. Retained logs: `/tmp/builder-2069/baseline-native.log` and `/tmp/builder-2069/historical-main-recorded.log` (copy of the original #2068 main evidence).
- Rebuilding SQLite for Electron made the same archived app/capture pass: 1 executed, 1 passed, 0 failed/skipped; `/tmp/builder-2069/native-ready.log`.
- Test-first prerequisite regressions: 3 failed, 1 passed against the no-op scaffold; `/tmp/builder-2069/native-regression-red.log`. Final five regressions all pass, including load/open failure, repeated probes, cleanup and success.
- Controlled actual wrong-ABI run after `npm run rebuild:node`: 1 executed, 1 expected failure, 0 skipped. It reports the static SQLite prerequisite error before consuming any of the 96 requests, with a normal Playwright failure and zero forbidden launches; `/tmp/builder-2069/wrong-abi.log`.
- Final pre-verify: all 5 checks passed; 401 unit files, 9,245 passed, 0 failed, 3 existing skips; `/tmp/builder-2069/pre-verify.log`. Client-test typecheck and docs guard also passed.
- After restoring Electron SQLite, `npm run e2e:recorded` built successfully and ran every active scenario: 29 executed/passed, 0 failed, 1 existing system-prompt-reset fixme, 0 retries, 0 forbidden launches. All 29 exchange attachments report zero remaining requests. Effort-default matched 96 requests and emitted 396 recorded frames. Reports: `/tmp/builder-2069/recorded-final.log` and `/tmp/builder-2069/recorded-final.json`.

The effort capture retains Desktop source `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, and Claude 2.1.280 provenance. These runs prove offline captured behavior; no provider/live or macOS acceptance is claimed.
