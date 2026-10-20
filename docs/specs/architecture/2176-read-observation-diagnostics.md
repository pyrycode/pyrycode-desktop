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
- Unit matrix isolates each target guard and verifies exactly one static record, precedence and silent success.
- Extend the existing spec-local mounted fixture with a controlled hook consumer; retain observer callbacks to exercise stale callback branches without a DOM test environment or shared harness.
- Count setup and callback events separately, verify reuse and cleanup, and forward a genuine refused observation through the default pipe to main stdout.
- macOS: affected units, pre-verify, build and the focused `thread-items` Electron spec. Dispatcher owns the complete suite; no live provider check is required.

## Open Questions
None. Estimated total written work: 600 lines; no new exported types/components/stores,
no consumer migrations, three acceptance behaviors, no new state machine.
