# Canonical background task progress gate

## Files read
- `e2e/background-task-progress.spec.ts` → `progress`, `fake` and the mounted scenario: preserve activity, counts, absence and menu interactions.
- `e2e/background-task-drawer.spec.ts` → `task`, `capturingFake`: matched task/tool linkage and actual opening-query observation.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: retained authored facts and correlated query certificates.
- `src/shared/wire/thread.ts` → `ThreadItem`: explicit item, revision, order, session and agent attribution.
- `src/renderer/src/screens/conversation/threadTaskPresentation.ts` → `threadTaskPresentations`: canonical membership and scoped progress join.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `TaskProgress`: current activity and formatted counters.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/e2e-harness.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md` → canonical authoring, teardown and positive barriers.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `playwright.config.ts`, `tsconfig.client-tests.json` → native prerequisites, replay boundaries and focused compiler coverage.
- `docs/specs/architecture/2269-canonical-background-task-drawer.md` → retained analogous migration and red-control strategy.

## Context
Migrate one mounted progress-display gate from #2228 / #2213 / feature root #2209 to authored daemon thread facts. Only the owned spec and this plan change; no product UI, design, shared harness, wire or documentation changes. No ADR is needed. The remote feature-branch overlap check found no other branch editing the owned spec. #2153/#2191 remain separate repairs; #2213 owns integrated acceptance.

## Design
Seed one canonical conversation with an explicit current session, epoch and version 1. Its shared-wire `ThreadItem` is a shown, active, running `tool_call`, with item ID 1, order 10, revision 1, matching session and Claude agent. Its `content.task_id` and `content.tool_use_id` match `task_link.task_id` and `task_link.tool_call_id`; the linked description is `BUILD`.

Launch with `{ threadMode: 'canonical', thread }` and capabilities `interactive` and `thread`. A local capture records outbound envelopes and answers only the conversation list; the publisher owns all content/query replies and final certificates. After positively rendering the linked task, assert the actual owning-conversation version-zero `thread_catch_up` and zero legacy history requests. Remove roster/history-script setup and aliases. Keep the original menu clicks, running-task pill, initial absence, both exact progress readings and final single-block assertion. Both progress envelopes explicitly carry the current `session_id`, conversation and task. No canonical item update is required.

## State + concurrency model
No new production state or asynchronous jobs. One launch and continuous drive use existing awaited rendered-content barriers. The fixture owns process/relay teardown. Finish Node checks before Electron native preparation and keep output/native binaries unchanged during mounted runs.

## State transitions and identity reuse
All rows are covered by `a progress frame for a listed running task draws its activity and meta line in the open panel`.

| Event | Oracle |
| --- | --- |
| Opening canonical conversation | `1 task running`, linked `BUILD` row, actual scoped version-zero query, zero history aliases. |
| Menu opens drawer before progress | Original menu interaction, visible drawer/row and zero progress blocks. |
| First matching scoped reading | Exact `FIRST_ACTIVITY` and `Bash · 4 tools · 18k tokens · 2m 41s`. |
| New reading reuses session/task identity | Exact `LATER_ACTIVITY` and `1 tool · 850 tokens · 41s`, exactly one progress block; counters replace previous values. |

## Error handling
No new failure modes or reject branches. Retain all existing assertions and timeout bounds; publisher validation rejects invalid authored facts. No legacy compatibility content supplies this scenario.

## Testing strategy
- Test first: capture the real opening query and assert zero legacy history requests in the original scenario; observe failure after its task visibly renders, then migrate setup.
- After final main merge, run pre-verify on existing canonical publisher units, existing selector units, app/client-test typechecks, focused strict TypeScript including the owned spec and transitive helpers, and build.
- Prepare Electron ABI only after Node checks. Run the owned mounted spec on Linux with retries zero and its configured native-writer prerequisite. Retain reports, source/build identity and executed/passed/failed/skipped counts under `/tmp/builder-2282/`.
- Dispatcher/verifier own the complete configured unit/application gate, captured replay, canonical activation, captured history and protected storage/native prerequisites. Do not duplicate the full gate. Preserve live-only assertions and exclusions; this synthetic migration introduces no fresh provider, encryption or physical-effect proof. macOS is outside this ticket's verification scope.

## Open Questions
None. Reuse the merged publisher and existing scoped progress path.

## Scope check
One independently useful behaviour, two acceptance criteria, approximately 150 written lines including plan/evidence, zero production files/new exports/new reject branches and one consumer. Sketch and written plan fit all five ceilings. The #2269 analogue added 39 scenario lines and deleted 26, plus its plan/evidence. No safe or necessary further partition exists.
