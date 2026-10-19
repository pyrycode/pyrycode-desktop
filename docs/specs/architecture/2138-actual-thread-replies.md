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
