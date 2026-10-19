## Files read
- `e2e/real-claude-thread.spec.ts` → daemon-built thread scenario: retain prompts, capability, agent, delimiter, title and relaunch assertions.
- `e2e/fixtures/phaseReconnectEvidence.ts` → `watchPhaseReconnect`, `readPhaseReconnect`: connection and created-conversation observations.
- `e2e/fixtures/queueTurnEvidence.ts` → `createQueueTurnEvidence`: native revision and ordered same-revision suffix handling.
- `e2e/fixtures/realDaemon.ts` → `withIsolatedElectronApp`: waits for full process exit before reopening the same profile.
- `src/shared/wire/thread.ts` → `ThreadItem`: native identity and attribution contract; user delivery has order/session but no turn field.
- `src/shared/chatHistory.ts` → `ThreadSnapshot`: protected saved-history identity/content inspection.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `docs/knowledge/features/development-verification.md`: strict replay matching and sequential Electron SQLite preparation.
- `docs/knowledge/features/development-verification-live-test-diagnosis.md`, root `CLAUDE.md`, knowledge index: counted live evidence and source-stamped daemon requirements.

## Context
One behaviour: prove that this scenario's actual driven replies survive reconnect/reset/profile restart without requiring model-authored markers. The observation helper has only this consumer and stays with it. No production or visual change. No ADR needed. Remote feature overlap check found no overlapping files.
Sizing: approximately 400 total written lines, 0 production files, at most 4 exported types, 1 consumer, 5 acceptance behaviours, fewer than 10 reject branches. The refiner's 360-line estimate is consistent with this sketch and below all ceilings.

## Design
Keep a scenario-local native collector in `e2e/fixtures/threadReplyEvidence.ts`, evaluated synchronously in the page and exercised by Vitest. Retain items by host/conversation/epoch/id, applying full revisions and ordered suffix companions without treating revisions as fresh identities. Before each send, capture existing item and turn identities. Observe the outbound send without replacing the preload API, retaining its message ID and route.
Bind the fresh delivered user item to that send's message ID. Native user messages have no turn: bind the first fresh top-level turn after its delivery order in the same session/agent, before any subsequent user delivery. Require a fresh nonempty settled assistant and normal terminal item with that exact session/agent/turn/parent attribution. Retain stable identity and exact assistant text, independently of rendered cursor/statistics chrome.
After observed reconnect, require the same first reply identity and text. After reset use a new baseline and require a different reply and turn. Compare both recorded replies with protected `readThread` results before retirement and in the new process before opening the conversation; require the fresh window to have no open thread before that read, so history-on-open cannot refill it. Reopen by the existing saved title and check rendered assistant content for both replies.

## State + concurrency model
Test-only synchronous collector; no application state changes. An event subscription and outbound CDP observation belong to the initial page and are disposed before retirement/in cleanup. Full process retirement remains owned by `withIsolatedElectronApp`. No sleeps or mutation retries.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Stale, wrong-route, nested or unrelated turn evidence | `threadReplyEvidence.test.ts` rejects unrelated evidence |
| Full revision, text append and ordered same-revision suffix; duplicate replay | `threadReplyEvidence.test.ts` accepts legitimate updates once |
| Missing/error/wrong-attribution completion | `threadReplyEvidence.test.ts` requires normal matching completion |
| Reconnect repeats items | shared scenario asserts recorded identity/text after connection count advances |
| Reset and second send | shared scenario and unit substitution regression require fresh identity/turn |
| Missing/changed saved reply, pre-reset substitution | `threadReplyEvidence.test.ts` saved comparisons and shared scenario before/after process retirement |

## Error handling
Missing or mismatched evidence fails bounded polling or exact assertions. No fallback title and no repair to #2129. No I/O failures are swallowed or reclassified as a reply.

## Testing strategy
Write deterministic collector/selection and saved-comparison tests first and observe failure before implementation. Run the affected Vitest file, pre-verify, client-test typecheck and build after final main merge. Finish native SQLite preparation before focused guarded `claude-thread` replay; require complete exchange and zero forbidden launches. Keep captured bytes and outgoing prompts unchanged.
Run the exact named live scenario through the shared live launcher on Linux with retries disabled when credentials and an isolated source-stamped daemon are available; retain counted report and provenance. Otherwise explicitly hand Juhana/operator the live criterion and hold merge pending verifier acceptance. Replay is offline evidence only; macOS is outside scope.

## Open Questions
None. Prefer one self-contained collector plus pure saved comparison over changing the shared phase observer.

## Revisions
2026-10-19: Focused replay/live both exposed Playwright's TSX transformation rejecting React server rendering of the imported view. Rendered-body checks instead use the existing `markdownPlainText` parser, remove code/task chrome from cloned body nodes and normalize layout whitespace. Saved/native comparisons still require exact original text. Reports `replay.log`, `live.log` and `live-stderr.log` under `/tmp/builder-2138/` preserve these failed checks.

2026-10-19 rework: Verifier finding 1 identified that equal reply text let one rendered body satisfy two recorded replies. Snapshot each assistant body's nearest `data-read-row` ID with its normalized body text, and require every recorded reply's exact numeric ID and parsed text in the same poll through `renderedRepliesMatch`. The open conversation supplies the host/conversation/epoch scope; the row supplies the item ID. Deterministic coverage requires two identically worded replies to have both identified rows, rejecting either missing row, an unowned body, a substituted ID and changed content. Existing collector, saved-history, title and lifecycle contracts stay intact. This is the same reply-identity invariant, approximately 60 additional written lines, no production changes or new exported types, one consumer, and no remote file overlaps.

## Validation evidence
Linux x64, 2026-10-19, implementation `1c83393ee95977f16c14a0689c557d95dda47cf6`, after merging main `3fbfcfdb5944`. macOS is outside this ticket's verification scope.

| Check | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Pre-verify targeted `threadReplyEvidence.test.ts` | 21 | 21 | 0 | 0 |
| Guarded exact `claude-thread` replay | 1 | 1 | 0 | 0 |
| Exact real-Claude scenario | 1 | 1 | 0 | 0 |

Pre-verify's five checks, `npm run typecheck:client-tests` and `npm run build` passed. Electron SQLite preparation finished after pre-verify's Node rebuild and before either browser run. Both selected Playwright runs used retries 0; no flaky results. Guarded replay matched 45 requests, emitted 378 frames, left 0 requests and recorded 0 forbidden launches. Capture bytes, provenance and outgoing prompts are unchanged.

Live report started `2026-10-19T10:37:05.509Z`, duration 32,382ms, one worker. It records the exact scenario title, `passed` at retry 0, Desktop `1c83393ee95977f16c14a0689c557d95dda47cf6`, daemon `664305939d73e5a146457503081d8232fcca5407`, and actual authenticated capabilities `interactive`, `multi_agent`, `stop_background_task`, `thread`, `thread_expansion`, `thread_compact`. The isolated `/tmp/builder-2138/pyry` was built from clean daemon source with `vcs.modified=false`; SHA-256 `ba2831b24dd8f880c0a707fb694bab8b99cfe2535d76eaa6129dbf11e4d0b869`.

Retained reports under `/tmp/builder-2138/`:
- `live-corrected.log`: complete counted JSON and capability/revision attachment; SHA-256 `d001cee3f2875dea451e03aa5d363f9e9af7595e85c1ba63c457db18eed55a59`.
- `live-corrected-stderr.log`: shared launcher's `1 executed; 1 passed; 0 failed; process exit 0`; SHA-256 `de15904c455ebe2a7e85a21a4c24c002ff62908bc0a2f0edf9409877f620f735`.
- `replay-corrected.log`: complete counted JSON, strict exchange attachment and launch-guard result; SHA-256 `b161dd8e0ef791f89d2aa1f013cff22dc5a40e2c018ec04c112985b89f7e24dc`.
- `unit.xml`, `build.log`, `electron-native.log`, `daemon-build.txt`, `daemon-sha256.txt`: focused unit counts, build and native preparation, source/checksum proof.

The earlier `replay.log` and `live.log` remain failed reports, superseded only after fixing their test-only TSX comparison error. No acceptance assertion was skipped and #2129 required no change.

## Rework validation evidence
Linux x64, 2026-10-19, implementation `5d06a2c7bcd080ea5b80817b2cf50166be3e5de8`, main `3fbfcfdb5944`. The extracted text-only matcher first failed the identical-text/missing-row regression (22 passed, 1 failed); requiring the native row ID made all 23 tests pass. Pre-verify passed all five checks with 23 executed/passed, 0 failed/skipped. Client-test typecheck and build passed. Electron SQLite preparation completed after pre-verify's Node preparation and before either browser launch.

The exact named scenario passed guarded replay and real Claude once each, both with 0 failed/skipped/flaky and retries 0. Replay started `2026-10-19T11:27:28.148Z`, matched 45 requests, emitted 378 frames, left 0 requests and recorded 0 forbidden launches. Live started `2026-10-19T11:27:49.423Z`, duration 27,366ms, with Desktop `5d06a2c7bcd080ea5b80817b2cf50166be3e5de8` and daemon `664305939d73e5a146457503081d8232fcca5407`. The isolated binary's clean VCS metadata and SHA-256 `ba2831b24dd8f880c0a707fb694bab8b99cfe2535d76eaa6129dbf11e4d0b869` were checked again. Authenticated capabilities: `interactive`, `multi_agent`, `stop_background_task`, `thread`, `thread_expansion`, `thread_compact`. Captures, prompts and provenance remain unchanged; replay adds no live acceptance. macOS remains outside scope.

Retained fresh reports under `/tmp/builder-2138/`:

- `rework-live.log`: counted JSON and revision/capability attachment; SHA-256 `2b26c55149a6640c221bd8fd3d79df63011ff47f464756bdb3e590848a065e18`.
- `rework-live-stderr.log`: launcher counts; SHA-256 `de15904c455ebe2a7e85a21a4c24c002ff62908bc0a2f0edf9409877f620f735`.
- `rework-replay.log`: build, counted JSON, complete exchange and guard result; SHA-256 `c144e9eda77645212d41f9bf66cc74073258e09ffe40f03fcd4b2078d67b0c49`.
- `rework-unit.xml`, `rework-pre-verify-ready.log`, `rework-client-typecheck.log`, `rework-build.log`, `rework-electron-native.log`: successful focused checks and sequential native preparation.

`rework-pre-verify.log` retains the earlier prerequisite failure before unit execution: the initial interrupted dependency installation lacked Electron's executable. Its package install script restored the executable before the successful gate. No acceptance assertion was skipped or weakened, and #2129 was unchanged.
