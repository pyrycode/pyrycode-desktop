# Tool-content replies stay outside scalar evidence

## Files read
- `e2e/fixtures/lunaHandoverProof.ts` → `completedHandoverReply`: freshness, ownership and revision fences.
- `e2e/fixtures/lunaHandoverProof.test.ts` → existing completion and revision scenarios to retain.
- `e2e/fixtures/queueTurnEvidence.ts` → `createQueueTurnEvidence`: marker/completion derivation and invalid-patch fence.
- `e2e/fixtures/queueTurnEvidence.test.ts` → same-revision suffix/duplicate regression remains intact.
- `e2e/real-claude-codex-channel.spec.ts` → `observe`: local scalar reducer and proof projections to extract.
- `src/shared/wire/thread.ts` → `ThreadReply`, `ThreadUpdate`: tool-body data/final variants have no scalar base revision or append text.
- `vitest.config.ts`, `tsconfig.client-tests.json`, `package.json`: existing fixture unit discovery and supplementary compiler coverage.
- `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/development-verification-what-each-test-tier-proves.md`, `docs/recorded-tests.md`: counted proof boundaries and sequential Node/Electron native preparation.

## Context
The scalar discriminant guards already landed in #2102. Lock their admission invariant with typed regression events; no production, wire, IPC or visible behavior changes. This is one useful behavior slice, including its one-consumer Codex testability extraction. No ADR is needed.

## Design
Move the Codex observer's event collection, scalar reducer and existing settings/models/acks/created/deltas/ends projections into `e2e/fixtures/codexChannelProof.ts`, exposing `createCodexChannelProof()` and its event type. `observe` supplies that collector to its existing exposed callback and retains subscription/stop ownership. There is no copied reducer or shared harness. Preserve scalar revision admission and all scenario assertions.

Extend the two existing fixture unit suites and add a Codex collector suite. Construct typed `thread_tool_body` data and final replies for held and missing IDs in the same epoch, with content resembling expected assistant text, markers and successful terminal metadata. Assert unchanged public proof before/after every reply, incomplete evidence remaining incomplete and completed evidence remaining accepted. Follow replies with genuine item changes and appends to demonstrate continued processing.

The simpler shape is a direct extraction of the existing collector rather than introducing reducer abstractions or an adapter layer. In-flight #2079 changes only the Codex subscription call in the shared scenario file; retain that local wiring through later merges.

Size recheck: approximately 330 written lines including this plan and moved collector, two exported test-helper declarations, one scenario consumer, three observable acceptance criteria, no new rejection branches. Below all ceilings; #1662's measured handover helper/test subset was 200 added lines.

## State + concurrency model
Collector state remains per observer: event array and host/chat/epoch-qualified item map. Reduction is synchronous; no new async work, store, subscription or teardown. The scenario still owns and stops its existing renderer subscription.

## State transitions and identity reuse
| Event | Regression coverage |
| --- | --- |
| Same-epoch tool data/final replies, repeated for held and missing IDs | Each suite's tool-body exclusion regression |
| Incomplete turn followed by unrelated detail, then real scalar changes/appends/completion | Each suite's tool-body exclusion regression |
| Completed turn followed by more detail replies | Each suite's tool-body exclusion regression |
| Duplicate/stale scalar revisions and same-revision queue suffix | Existing handover revision and queue suffix tests; Codex revision regression |
| Equal item IDs across host/chat/epoch owners | Codex ownership regression; existing handover ownership/reset regressions |

## Error handling
No new failure mode. Tool detail is ignored by explicit scalar event guards; existing queue invalid-patch detection and handover completion rejection remain unchanged.

## Testing strategy
- Run focused Vitest suites against the actual reducers; demonstrate the queue regression rejects the historical catch-all via a temporary controlled mutation, then restore the explicit guard.
- Run `npm run typecheck:client-tests` unchanged with zero diagnostics, preserving all configured files and unions.
- After final main merge, run pre-verify for each affected fixture suite and `npm run build`.
- Prepare the Electron SQLite addon after Node checks, then run configured guarded `npm run e2e:recorded` on Linux, retaining original assertions and strict requests. Record executed/passed/failed/skipped counts. No fresh provider, transport or physical-effect claim; macOS is outside this ticket's scope.

## Open Questions
None.
