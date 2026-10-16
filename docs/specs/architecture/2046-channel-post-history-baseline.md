# Restore channel-post history-on-open acceptance

## Files read

- `e2e/real-daemon-history-on-open.spec.ts` → `post`, `savedText`: baseline, restart and fresh-profile acceptance.
- `e2e/fixtures/realDaemon.ts` → `test`, `seedRegistry`, `withIsolatedElectronApp`: immediate-exit Claude-less executable, independent pairings and process-exit barrier.
- `e2e/fixtures/phaseReconnectEvidence.ts` → `watchPhaseReconnect`: owning-host interactive/thread evidence.
- `e2e/fixtures/realDaemon.test.ts` → registered fixture tests: preserve credential ownership and cleanup.
- `docs/knowledge/features/real-daemon-credential-light-e2e.md`: Claude-less mode proves registry operations, not a healthy interactive session.
- `docs/knowledge/features/real-claude-liveness-e2e.md`: real subprocess isolation, readiness and credential rules.
- `docs/knowledge/features/development-verification.md` and `development-verification-live-test-diagnosis.md`: authoritative evidence and executable provenance.
- Daemon `cmd/pyry/channel_delivery.go` → `accept`, `drain`, `held`, `deliver`; `channel.go` → `channelPoster`: durable acceptance precedes record/publication.

## Context

The history scenario fails before exercising storage. Its promoted bootstrap session uses an executable that exits immediately. Determine whether delivery is held, recorded without publication, or published without rendering before selecting the repair. CLI success alone proves only acceptance. No ADR is needed.

One deliverable: restore this acceptance. Forecast at most 400 written lines, no new exported abstractions, one scenario consumer, four observable acceptance criteria and no new runtime error state machine. Recount before implementation remains within all five limits.

Overlap: #2026/PR #2048 removes this spec's retired storage fallback; retain that daemon-item-only adaptation and remove its #2046 skip. #1364 and #1544 touch other fixture blocks; no required dependency or shared-block redesign is planned.

## Design

Prefer a scenario-local use of existing fixture options (`spawnClaude: true`) or an existing scenario precondition, based on the observed failure boundary. Do not change the shared Claude-less default, introduce a harness, or seed thread/storage data. Preserve the exact test title. If diagnosis identifies a necessary Desktop publication repair instead, record the narrow contract in Revisions and add its regression before production edits.

Observe daemon-authored thread items for the selected host/conversation and the synthetic baseline, requiring one entry and a non-null protected `readThread` checkpoint. Retain the initial visible exact-once assertion. Preserve 205 distinct posts after Electron exit, saved-profile catch-up from that checkpoint and independent fresh-profile paging. Keep owning-host interactive/thread handshake and zero legacy requests. Attach only synthetic/count/provenance evidence, including binary SHA256 and source-stamped daemon revision.

## State + concurrency model

No production state changes are planned. The daemon fixture owns and reaps its subprocess group. `withIsolatedElectronApp.relaunch` closes Electron and confirms child exit before invoking the posting callback; the protected profile is reused only on this path. A separate minted pairing authenticates the fresh profile. Test observers belong to their app/page and are unsubscribed or removed at teardown.

## State transitions and identity reuse

All rows are covered by the exact live test `a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`.

| Event | Required proof |
| --- | --- |
| Initial channel post | One daemon-owned baseline item, one visible bubble, persisted checkpoint |
| Electron exits; 205 posts arrive | Posting callback runs after child exit; unique content cannot preexist in saved profile |
| Same protected profile reopens | First opening query is catch-up at saved checkpoint; baseline and newest post visible |
| Independent pairing/profile opens same conversation | No saved checkpoint; newest window then user-demanded page retrieves baseline |

## Error handling

Retain fixed-text subprocess errors; never echo CLI argv, pairing output or credentials. Failed publication, missing checkpoint or wrong query must fail acceptance. Do not extend timeouts, add retries or substitute optimistic rows. Diagnostic reads may inspect only synthetic test delivery/history state and report counts/booleans, never credentials.

## Testing strategy

- First reproduce the unchanged failing baseline against a clean source-stamped prerequisite daemon, then establish its accepted/recorded/published boundary.
- Run scoped fixture units when touched; use the restored live scenario as regression for a scenario-only option/precondition repair.
- Linux: merge final main, install, pre-verify full unit/type checks and build. Run applicable focused fake transport checks if runtime changes.
- Final counted live acceptance and retained report/attachment belong to the dispatcher, as explicitly assigned by the ticket. Diagnostic focused live execution may inform the repair; never report pending acceptance as passed.

## Open Questions

- Does the immediate-exit seeded interactive session hold delivery, or does publication fail downstream? Settle from the source-stamped reproduction before repair and record the result in Revisions.

## Security review

**Verdict:** PASS

- **Trust boundaries:** CLI exit is acceptance only; require typed daemon thread publication and protected `readThread`, qualified by owning server/conversation. No new IPC or parsing boundary.
- **Tokens/credentials:** Existing `mintPairing` supplies independent device identities; never persist or attach pairing tokens. Existing isolated credential setup/cleanup remains authoritative.
- **Files/storage:** No manual thread writes. Reuse fixture-owned private temporary roots and protected history API; no caller-supplied cleanup paths or plaintext credential cache.
- **Electron attack surface:** Existing isolated launch and preload allowlist remain unchanged. No navigation, window options, protocols or renderer privileges added.
- **Cryptography:** No crypto changes; existing main-process Noise and protected secret backend remain in use. SHA256 identifies the executable only.
- **Network/I/O:** Reuse bounded CLI invocation and existing isolated loopback relay. No production TLS, frame size or reconnect changes.
- **Errors/logs:** Fixed subprocess errors; attach only test-authored synthetic counts and executable identity, never argv, message bodies, tokens or full frames.
- **Concurrency:** Existing process-exit barrier precedes all closed-window posts; fixture owns process groups, relay and profiles. Observers end with their windows or explicit unsubscribe.
- **Threat model:** Malicious relay/hostile frames continue through existing Noise/parser boundaries; compromised renderer gains no API; token theft remains mitigated by existing protected storage. This test changes no production threat boundary.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-16

## Revisions

2026-10-16 — Diagnosis requires prerequisite [#2050](https://github.com/pyrycode/pyrycode-desktop/issues/2050), linked as blocked-by; implementation is deferred. No fixture option or Desktop production change restores the required cold-query proof against the supplied daemon. Temporary diagnostic edits were preserved under `/tmp/builder-2046/diagnostic-history-on-open.spec.ts` and removed from the working spec; no failing test change is committed.

The source-stamped reproduction separates the boundaries: baseline accepted, pending delivery **0**, recorded baseline **1**, authoritative baseline item received by Desktop **1**, visible bubble **0**, protected baseline/checkpoint **absent**. Initial queries produce `daemon-error` without `thread_items`. This rules out a held channel post and missing thread publication. Both enabling real Claude and posting before opening (with a positive authoritative publication barrier) still fail. `spawnClaude: false` is not the demonstrated cause, so its shared and scenario defaults remain unchanged.

The daemon's `threadShadow.follow` unloads idle usable state after recording its consumed version. Its rediscovery does not reload unchanged history. `installDaemonThreadRelay` calls bounded `Store.CatchUp`/`Store.HistoryPage`, which deliberately neither load nor wait for recovery; `V2SessionManager.runThreadQuery` refuses non-usable state. Existing daemon `TestDaemonThreadQueriesReadiness` explicitly asserts that a cold query stays `StateNotLoaded` and passed (1 executed, 1 passed). A Desktop retry or accepting an unknown-epoch live addition cannot certify the missing cold history window. The prerequisite needs daemon demand/recovery lifecycle integration around the bounded providers, outside this ticket's allowed scope. Daemon #3337 optimizes an already initiated load and does not own initiating query demand.

### Linux evidence and pending work

- Desktop runtime `1700f67f`, plan-only test HEAD `75b19322`; `npm install` and `npm run build` passed. No daemon source changes.
- Clean daemon source `0917625fc6e91eeb2a16556f09e5ba0bbf62aabf`, binary `/tmp/builder-2046/pyry`, version `dev-0917625fc6e91eeb2a16556f09e5ba0bbf62aabf`, SHA256 `c3c701f23fc51149c16d252212a3cf42a352c2158d46353cc755596192a99428`.
- Configured `live-claude-gate.py desktop` selected the exact named scenario with retries 0. Each diagnostic report executed **1**, passed **0**, failed **1**, skipped **0**: `old-mode-report.json`, `publication-report.json`, `real-session-report.json`, `query-boundary-report.json`, `post-before-open-report.json`, all under `/tmp/builder-2046/`. These are failures, not acceptance.
- Count-only `baseline-delivery-boundary` attachment for the post-before-open variant: `accepted=true, pending=0, recorded=1, visible=0, publication.threadItems=1, publication.queryFailures=[daemon-error], publication.replies=[], protected.checkpoint=null, protected.baselineItems=0`.
- An earlier `baseline-report.json` launched before the build finished and failed on missing `out/main/index.js`; excluded from causal evidence. The subsequent diagnostic launches all used the completed build.
- No saved-history success attachment exists: the scenario stops before that boundary. After #2050, preserve #2048's daemon-item-only adaptation, restore the exact unskipped title, finish baseline/restart/paging proof, merge final main and run pre-verify/build plus applicable Linux checks. Dispatcher owns final counted live acceptance and retained report/saved-history attachment. No PR is opened for this dependency handoff; macOS remains outside scope.
