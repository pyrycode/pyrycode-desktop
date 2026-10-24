# Canonical background task Stop gate

## Files read
- `e2e/background-task-stop.spec.ts` → continuous pending/settlement scenario: preserve trusted interactions, request identity, viewport and outcome assertions.
- `e2e/fixtures/conversationStateFake.ts` → `taskStopReply`, `ConversationStateFake`: retain callable/list/MCP/workspace behavior and stop controls; replace only obsolete outcome answers.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: retained authored facts, exact-base revisions and correlated query replies.
- `e2e/background-task-finished-count.spec.ts`, `e2e/background-task-drawer.spec.ts` → linked task facts, scoped session controls and positive opening barriers.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: wire contract for explicit identities and lifecycle.
- `src/renderer/src/screens/conversation/threadTaskPresentation.ts` → `threadTaskPresentations`, `createThreadTaskStops`: saved lifecycle and separate pending control identity.
- `e2e/fixtures/launchPairedApp.ts`, `playwright.config.ts`, `tsconfig.client-tests.json` → canonical selection, configured native prerequisite and focused typing requirements.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/e2e-harness.md`, `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`, `docs/client-replay-migration.md` → fixture ownership, positive barriers, native/replay evidence boundaries.

## Context
Migrate the existing mounted Stop contract from legacy task translation to daemon-authored thread facts, retaining the three settlements in one scenario. No production/UI change, documentation requirement or ADR. Remote feature-branch overlap inspection found no edits to either owned file. Reuse merged #2210; #2246's later cleanup and separate #2153/#2191 repairs are not prerequisites.

## Design
Seed both conversation scopes in one canonical publisher with explicit summaries/current sessions, epochs, version 1 and complete linked tool-call facts: unique item/order/revision, raw task/tool identity, Claude/session attribution and active running lifecycle. Initially list only the first conversation for pairing, then announce the second through the existing list update. Capture outbound envelopes, positively observe authored content and scoped version-zero queries, and assert no history aliases.

Preserve the continuous mounted scenario, existing timeout and viewport/footer behavior. Stop records the exact conversation/raw task pair, disables only that task and rejects duplicate dispatch. Publish progress with explicit envelope session attribution. Publish the saved patch through an exact-base item revision, including its patch cut metadata. Close/reopen and navigate to the explicitly seeded second scope and back before settlement; positively observe navigation before checking retained pending state.

Replace `'stopped'`/`{ roster }` stop answers with an authored `thread_item_changed` update. The scenario supplies all routing, version, revision and changes; the fake only encodes that update. Existing publisher admission retains it for later queries. Keep `'silent'`/`'refused'`, callable API, method names/arity, return shapes, default/configured silence, recording and delayed request-correlated refusal with deliberately unrelated payload conversation.

First settle the patched item with explicit inactive `stopped`; configure the next request with explicit inactive `gone`, retaining the stopped item. Refuse the last request using its recorded correlation; only its button re-enables and its running lifecycle stays intact. Preserve exact three-request order/count. No acknowledgement or roster omission creates lifecycle.

## State + concurrency model
No new production state or async work. Publisher facts update synchronously; existing launch teardown owns Electron/daemon/relay. Await rendered markers and captured requests before absence/count assertions. Complete Node-native checks before Electron-native preparation; do not rebuild output during mounted execution.

## State transitions and identity reuse
All mounted rows are covered by `silent stops survive navigation and settle on stopped, omission and correlated refusal`.

| Event | Oracle |
| --- | --- |
| Both scopes open | Owning catch-up requests and positive authored content; no history alias. |
| Stop/duplicate dispatch | One exact owning-conversation/raw-task request; only matching button disabled. |
| Progress and saved patch | Positive progress/patch/cut marker; pending button remains disabled. |
| Panel close/reopen and conversation away/back | Positive second-scope content then restored first patch; pending retained and count remains one. |
| Delayed stopped revision | Finished Stopped row with no Stop control. |
| Configured gone revision | Outcome unknown, inactive with no Stop; prior Stopped retained. |
| Delayed correlated refusal | Matching button enabled, Running retained, settled rows unchanged, exact request order. |

Fixture units cover default/configured silence, exact-pair routing, authored configured/delayed update bytes, publisher admission/query retention and delayed refusal correlation despite unrelated payload conversation. Existing fixture units preserve unrelated behavior.

## Error handling
No production error branches. Invalid authored updates fail publisher ownership checks. Keep refusal semantics and all existing failure controls; no legacy translator or inferred lifecycle.

## Testing strategy
- Write fixture regression tests first, observe failure on the old outcome seam, then replace it and migrate the mounted scenario.
- After final main merge: pre-verify for the stop fixture tests, applicable canonical publisher units, app/client typechecks, strict focused TypeScript including both changed e2e inputs and new units, and build.
- Run owned mounted spec with retries zero on Linux, retaining configured native-writer prerequisite and counted source-revision evidence. No duplicate full suite.
- Dispatcher/verifier owns complete configured unit/application acceptance including captured-client replay, canonical activation, captured history, protected storage and native prerequisites. Existing live-only assertions remain in their original tiers; no fresh provider/encryption/physical-effect claim. macOS is outside this ticket's verification scope.

## Open Questions
None. The merged publisher provides the required seam.

## Scope check
One independently useful mounted command/control contract; three acceptance criteria, about 300 written lines including plan/tests/evidence, zero production files, zero new exported declarations, one migrated consumer and no new production reject branches. Sketch and written plan fit every ceiling; one-consumer fake changes stay with this scenario.
