# Read-observation refusal diagnostics

## Files read
- `src/renderer/src/store/conversationReadPublisher.ts` → `readTargetFor`, `useReadObservation`: preserve eligibility, geometry, listener reuse and publication.
- `src/renderer/src/store/conversationReadPublisher.test.ts` → target/publisher scenarios: extend pure eligibility coverage.
- `e2e/thread-items.spec.ts` → `rendererFixture`: existing mounted Electron seam for committed read inputs.
- `e2e/message-lifecycle-diagnostics.spec.ts` → `collect`: main stdout proves receiver delivery.
- `src/shared/ipc/diagnostics.ts` → `RendererDiagnosticEvent`: existing event/code projection stays unchanged.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/conversation-last-read-store.md`: authoritative committed-read contract.
- `docs/knowledge/features/development-verification.md`: static tests cannot prove effects; count mounted checks and use processing barriers.

## Context
Unread investigations cannot currently distinguish missing evidence from visibility exclusions.
This is one independently useful diagnostic behavior, with target/setup/callback phases.
No user-visible output changes, protocol changes or ADR are needed.
Remote feature-branch overlap scan found no branches touching the three intended files.
Sibling #2175 is coordination only; compact eligibility is outside this change.

## Design
Keep production changes in the publisher. Emit only static `event` and `code` values
through the existing `window.pyry.sendDiagnostic` pipe. Events identify read target,
observer setup and observer callback phases. An optional diagnostic sink defaults to
that same pipe and lets mounted tests count synchronous invocations precisely.
Split grouped guards into meaningful reasons in their existing eligibility order:
scope, read metadata, invalid target, checkpoint, completion, repair, missing tail,
coverage and queued/unordered shown evidence. Success in target calculation is silent.
Setup classifies missing inputs, reader, DOM and tail DOM. A delegated target rejection
emits its own event only. Reuse emits `reused`, then invokes the retained callback;
each phase is counted separately. Avoid eager duplicate target evaluation on reuse.
Callback classifies missing inputs, reader, stale scope/tail/route, focus, document
visibility, disconnected/hidden/queued tail and empty/above/below viewport geometry.
The sink receives no identities, content, DOM values, errors or dynamic payloads.

## State + concurrency model
No new store or async task. Keep committed-input refs, setup identity, listeners,
ResizeObserver and subscription lifetime unchanged. Diagnostics are synchronous.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Repeated setup with same tail and changed metadata | mounted diagnostic case: reused plus one callback result |
| Delegated target rejection at setup/callback | unit matrix and mounted diagnostic case: one target event |
| Inputs removed, reader opened, host/chat/epoch replaced | mounted diagnostic case: retained callback checks committed inputs |
| Tail replaced, route replaced, tail detached/hidden/queued | mounted diagnostic case: old callback exclusions |
| Focus/visibility/viewport change | mounted diagnostic case: one event per callback invocation |
| Unmount and remount | mounted diagnostic case: listener/observer cleanup and fresh setup |

## Error handling
No new failure or error state. Existing refusals retain their return values and precedence.
No publisher send/sync diagnostics are added.

## Testing strategy
- The mounted diagnostic case is `read observation explains each committed refusal, reuse and receiver delivery` in `e2e/thread-items.spec.ts`.
- Unit matrix isolates each target guard and verifies exactly one static record, precedence and silent success.
- Extend the existing spec-local mounted fixture with a controlled hook consumer; retain observer callbacks to exercise stale callback branches without a DOM test environment or shared harness.
- Count setup and callback events separately, verify reuse and cleanup, and forward a genuine refused observation through the default pipe to main stdout.
- macOS: affected units, pre-verify, build and the focused `thread-items` Electron spec. Dispatcher owns the complete suite; no live provider check is required.

## Open Questions
None. Estimated total written work: 600 lines; no new exported types/components/stores,
no consumer migrations, three acceptance behaviors, no new state machine.

## Revisions
2026-10-20: Target diagnostics distinguish unavailable owning scope from a mismatched
scope. Reuse avoids the old eager target calculation, leaving the retained callback
as the sole target evaluator for that phase; eligibility and send behavior are unchanged.
The spec-local mounted consumer counts active observers, listeners and list subscriptions
and retains disposed callbacks to exercise committed-input replacement directly.

2026-10-20 repair: the saved FAIL at `d1433431` identified one shared invariant:
diagnostic exceptions must never affect read eligibility or publication. Add one
best-effort emission boundary around only the injected sink or default bridge lookup
and invocation. Keep domain evaluation, DOM work and publication outside that catch.
Missing transport is silent; throwing diagnostics are dropped without retries or logging.
No new state, exported types, consumer migration or failure mode is introduced.

The main merge brings #2175's compact evidence and route epochs. Preserve its guard
precedence: scope/metadata/target, ordered tail, then compact proof or complete evidence,
then pending shown rows. Compact refusals distinguish snapshot mismatch, stale authority,
insufficient completion and uncovered tail. Both route-epoch exclusions keep `route-stale`.
The remote overlap scan found no other feature branches touching the three files.
The repair and its regressions remain the same diagnostic behavior; estimated total
branch work stays below 650 written lines, with no new exported surfaces or call sites.

| Repeated event / failure | Added regression |
| --- | --- |
| Each target refusal with a throwing sink | target diagnostic matrix, normal and throwing sinks |
| Missing/throwing default transport access | target transport matrix and mounted hook bridge cases |
| Setup/callback refusal with throwing diagnostics | mounted diagnostic case, preserving single attempts |
| Reuse while the sink throws | mounted diagnostic case, exact eligible publication once and deduplication |
| Compact proof replacement and route reuse | compact unit reasons and retained mounted callbacks |

The existing main-receiver proof and cleanup assertions remain. Run the new tests
before the exception boundary to retain raw fails-before evidence. Verify native
preparation including its unchanged five-second Node provenance probe before focused
Electron checks. Complete macOS dispatcher gates and fresh verifier judgment remain
required later-stage acceptance; focused passes cannot replace them. Historical FAIL
and failed runs remain failed; the original target matrix's raw before-run evidence
was not retained and is not reconstructed by this repair.

## Documentation handoff
- Pending documentation stage: `docs/knowledge/features/conversation-shell.md`,
  `### Authoritative thread read publication`: document static target/setup/observer
  event names and reason codes, compact/route exclusions, delegated single-event
  counting, reuse as success, and best-effort behavior when diagnostics are absent or throw.
- Pending documentation stage: `docs/knowledge/features/conversation-last-read-store.md`,
  `## How it works`: explain that diagnostic failure cannot change eligibility,
  observer lifetime, geometry, publication or deduplication, and no identity/content is emitted.

## Verification evidence
macOS arm64, 2026-10-20; final main merge was already up to date at `2d8a7e32`.
- Test-first target matrix: 21 failed / 5 passed before implementation (missing records).
- Final pre-verify: 5 checks passed, affected units 27 executed/passed, 0 failed/skipped. Evidence copied to `/tmp/builder-2176/final-units/`.
- `npm run build` passed after that merge and pre-verify.
- After explicit `native-preparation.py electron`, native-writer control: 1 executed/passed, 0 failed/skipped/flaky; `/tmp/builder-2176/native-writer-prepared.json`.
- Final `node node_modules/@playwright/test/cli.js test --config=playwright.config.ts e2e/thread-items.spec.ts --no-deps --grep "read observation explains|publishes only committed|defers 8333" --reporter=json`: 4 executed/passed, 0 failed/skipped/flaky, one actual worker. Report: `/tmp/builder-2176/final-read-observation.json`. Includes default-pipe receiver delivery and listener/subscription reuse/cleanup.
- Earlier unprepared dependency run failed readiness (1 failed, 14 not run); follow-up #2179 was resolved/closed after the prepared control passed. An earlier direct full-file run had 13 passed / 1 expansion timeout while native rebuilds competed; the unchanged expansion control passed in the final sequential run. Preserve these as failed evidence, not a product reliability repair. The earlier artifacts are under `/tmp/builder-2176/thread-items-first-run/`.
No live provider test was required or claimed. The dispatcher owns complete-suite acceptance; other operating systems are outside this ticket's verification scope.

### Repair verification, macOS arm64, 2026-10-20
Final main integration is `e83ec64f`; merge resolution committed as `e3d05900`.
Raw repair evidence is retained under `/tmp/builder-2176/repair-20261020/`.
- Before the exception boundary, with new regressions on `ff771067`: units 41 executed,
  29 failed / 12 passed, 0 skipped (`units-before.log`); mounted run 2 executed,
  1 native-writer passed / 1 hook setup failed on `diagnostic failure`, 0 skipped
  (`electron-before.json`, `electron-before.stderr.log`, `electron-before-results/`).
- Initial pre-verify failed test-helper type inference; fixed with an explicit compact
  evidence return type. Its failed log remains `pre-verify.log`.
- Final pre-verify: 5/5 checks passed, units 41 executed/passed, 0 failed/skipped;
  `pre-verify-final.log`, with full unit reports/JUnit copied to `final-units/`.
- `npm run build` and `npm run check:docs` passed: `build-final.log`, `docs-check.log`.
- Both native preparations passed the unchanged provenance probe and rebuild;
  `preparation-before.log`, `preparation-final.log`, `native-preparation-final.json`.
- Final `thread-items.spec.ts` selection `read observation explains|publishes only committed|defers 8333`:
  5 executed/passed including its normal native-writer dependency, 0 failed/skipped/flaky;
  `thread-after.json`, `thread-after.stderr.log`, `thread-after-results/`.
- `visible-tail-read.spec.ts` selection `read setup is reused|committed folded tails`,
  run sequentially with `--no-deps` after that dependency passed: 2 executed/passed,
  0 failed/skipped/flaky; `visible-tail.json`, `visible-tail.stderr.log`, `visible-tail-results/`.
The mounted test retains genuine default-bridge/main-receiver proof, checks compact
authority/route exclusions and throwing setup/callback/delegated/reuse emissions,
and requires exactly one eligible command despite repeated throwing reuse diagnostics.
Controlled document focus proves reason selection; it adds no native focus claim.
These focused results do not replace complete macOS dispatcher unit/replay gates or
fresh verifier judgment, both pending with their owning stages. Documentation handoff
is pending. No fresh provider/daemon or physical-effect acceptance is required.

### 2026-10-20 synchronization repair design
The recovered verifier FAIL at `bf3131b5` confirms the diagnostic-exception repair
and identifies two test barriers that can pass before the intended commit. Integrate
the existing #2173 reply-readiness and #2186 pending-read repairs locally; do not
republish the refused #2173 comment. Overlap #2150 changes only the separate native
focus helper and needs no dependency. No production behavior changes are planned.

The reply scenario must await the exact rendered suffix and absence of the streaming
cursor before activating its retained Reply control. A controlled held runtime drain
must show that the old visible-container barrier quotes only the partial source,
while the repaired barrier waits and then quotes the complete source. Keep all
existing quote, focus, caret, edited-send and clipboard assertions.

For the pending-read scenario, retain both native frame and paired timer callbacks
by function identity, count their actual scheduling opportunities and real preload
receipt, and establish target 4/content unchanged before focus and scroll. Await
the ordered outgoing context sentinel before excluding target 5. Restore APIs and
unsubscribe in `finally`; release must commit the suffix and publish exactly target 5.
Keep hidden/queued exclusions, observer lifetime checks and runtime fallback units.

Verification: first run both original named macOS cases under normal admission;
then retain controlled before/after evidence, run both repaired specs and the mounted
diagnostic/receiver selection. After final main merge, run affected pre-verify units,
build and client-test typecheck; prepare Electron sequentially. Push the complete
candidate and request the configured macOS application gate. Fresh verifier judgment
remains owned by the next stage. Historical FAILs and missing original target-matrix
raw before-evidence remain unchanged. One synchronization invariant is repaired;
estimated total branch written work remains under 800 lines, with no new exported
surface, consumer migration, state or production failure branch.
