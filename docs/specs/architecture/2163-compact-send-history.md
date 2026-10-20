# Compact history after send

## Files read

- `src/renderer/src/store/threadCompact.ts` → `event`, `query`, `pump`: compact progress, certified recovery and one per-host lane.
- `src/renderer/src/store/threadRuntime.ts` → `handle`, `event`, `presentation`: accepted host grants, delivery ordering and selected authority.
- `src/main/daemonConnection.ts` → `onDriverEvent`, `queryThread`: authenticated grants and local refusal boundary.
- `src/main/threadQueryCommand.ts` → `dispatchThreadQuery`: missing-route settlement.
- `src/shared/ipc/commands.ts` → `isRendererCommand`: closed command validation.
- `src/main/transport/threadUpdates.ts` → `logical`, `createThreadUpdateReceiver`: inbound validation, query correlation and marker certification.
- `e2e/threadBodies.test.ts` → `compactRuntime`: production dispatch/preload/inbound regression harness.
- `e2e/compact-demand.spec.ts` → compact demand and recovery controls: mounted synthetic daemon fixtures.
- `e2e/real-daemon-history-on-open.spec.ts`, `e2e/fixtures/realDaemon.ts`: isolated daemon, channel posts and native lifecycle.
- `docs/knowledge/features/thread-runtime-compact.md`: compact and complete authority must remain separate; only successful matching markers certify checkpoints.
- `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/development-verification-live-test-diagnosis.md`, `docs/recorded-tests.md`: positive processing barriers, counted evidence, executable provenance and replay limits.
- Root `CLAUDE.md`, shared working practice and ticket scope/security/UI policies.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4
Read design context and screenshot. Preserve the fixed sidebar, adjacent conversation pane, existing dark surface/message tokens and footer. Reuse the existing history failure and Retry treatment; no new visual component or asset.

## Context

Sending text can leave compact history reporting an older-messages failure. Capability refusal remains a hypothesis: both processes currently require the same owning-host accepted grants. Establish the accepted negotiation and source-version sequence before changing recovery. Attachment retention belongs to #2164.

This is one usable-history repair with its regression and refusal/gap controls. Forecast total written work: 650–750 lines including this plan, focused regressions, one live diagnostic scenario and production changes; no new exported declarations, at most four changed consumers, four observable criteria and fewer than ten reject branches. The scoped #2103 analogue added 158/deleted 28 lines. No public API migration or new dependency. Overlaps #1544 (main settings correlation) and #2089 (runtime unpair cleanup) change different blocks; preserve them when merging.

## Design

Keep the existing compact owner and its separate complete authority. Diagnose through the existing query/receiver/renderer path, using a live diagnostic control before any production edit. The production regression must send through the connection and deliver compact updates through its parser and preload, then page Older. Change only the demonstrated fault in that path; record the causal result and exact revised contract below before implementing a changed recovery rule.

At `queryThread`, distinguish unavailable connection, missing accepted capability and invalid command using static diagnostic codes while retaining the existing typed failure settlement. A sent-query diagnostic means transport handoff only, never daemon receipt. Keep command validation fail-closed and never replace refused compact projection with complete. Automatic selection still uses complete without accepted compact grants.

Considered a second recovery owner: unnecessary, because `createThreadCompact` already owns the bounded lane and explicit Retry. Fix its existing invariant or the validated delivery boundary instead of adding another retry mechanism.

## State + concurrency model

Retain compact snapshots, per-host lane, query identities, generations and cancellation. Live consumed progress is distinct from the marker-certified checkpoint. Recovery starts at that checkpoint, not optimistic or consumed progress. Retained rows survive failure. Failure clears pending work and blocks automatic retries; explicit Retry can dispatch once the cause clears. Navigation, host retirement and disposal cancel queued work and reject stale replies. Add no background task.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Send after loaded compact history, contiguous updates, then Older | New production-dispatch regression in `threadBodies.test.ts`; mounted `compact-demand.spec.ts` send case; live compact-send scenario |
| Genuine gap and matching recovery marker | Existing compact gap/checkpoint tests plus send regression control |
| Local refusal, retained rows, no loop, explicit Retry after cause clears | Existing compact refusal tests plus classified main diagnostics assertions |
| No owning compact grants: automatic complete versus explicit refusal | Existing automatic-selection and explicit compact controls |
| Reconnect, reset, same host/chat reuse, stale reply, deletion/disposal | Existing `threadBodies.test.ts` lifecycle and retirement controls; retain unchanged |

## Error handling

Use existing `threadQueryFailed` reasons and content-free diagnostics. Do not suppress errors, invent receipt evidence or clear retained projection after refusal. Reject malformed inbound/IPC data through the existing validators. Recovery remains bounded and final-marker correlated.

## Testing strategy

- Retain current-daemon diagnostic control before production changes, recording Desktop build/revision, daemon version/source, owning-host equality, the four grant booleans and numerical progress/query/marker sequence. Never retain bodies, raw acknowledgements, peer identities or credentials.
- First run the new focused production-dispatch test red for the demonstrated cause; implement and rerun it plus existing genuine-gap/refusal/lifecycle controls.
- Mounted Electron case positively waits for authoritative echo and any recovery completion before asserting no failure, then positively observes an Older page completing. Capture the existing history treatment at 1280×800 and 800×800.
- Live scenario uses an isolated daemon and loaded history, sends text, observes compact updates and completes Older. Record executed/passed/failed/skipped for before and after. Missing live access requires an exact Juhana handoff and explicit pre-merge hold; replay is not a substitute.
- After final main merge run affected pre-verify checks, build and the focused mounted spec on macOS. Dispatcher owns the full acceptance suite. No second-OS run.

## Open Questions

- What is the first causal divergence in accepted grants/source-version progression? Resolve with diagnostic control before production edits; append result to Revisions.
- Dedicated daemon is 0.41.1, clean source `a935bfb8db70ff5fd5cd47c2a05ab5bc1e83273f`; determine compact support or hand current 0.41.4 acceptance to Juhana with the exact missing evidence.

## Security review

**Verdict:** PASS

- [Trust boundaries] Preserve `isRendererCommand`, authenticated owning-host gates and `createThreadUpdateReceiver` validation; no caller can grant itself compact capability.
- [Tokens] No credential storage or lifecycle change. Tests use the shared login launcher; never read or log credentials ourselves.
- [File/storage] Compact state stays session-only. No message-body persistence or new file path derived from daemon text.
- [Electron] No new IPC channel, API or privilege. Keep isolated/sandboxed renderer and main-process transport.
- [Cryptography] No change to Noise, keys, nonces, TLS or randomness; request IDs retain crypto UUID generation.
- [Network/I/O] Preserve frame/assembly limits, query deadline and one unfinished-query lane. Refusal must settle rather than spin.
- [Errors/logs] Only static classification and numerical sequence evidence. Exclude bodies, raw acknowledgements, peer identifiers, keys and credentials.
- [Concurrency] Preserve host/epoch/generation/request fences, marker correlation, cancellation and teardown. Existing lifecycle controls remain required.
- [Threat alignment] Malicious relay delay/reorder remains subject to bounded recovery; hostile daemon responses retain validation. Compromised renderer cannot bypass main grants or reach keys; disk-token protection stays in safeStorage.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-20

## Revisions

2026-10-20: Pre-implementation v0.41.4 live reproduction (tag/source `4d43574874eec9450c97513adb571092de669d12`, isolated archive build `/tmp/builder-2163/pyry-0.41.4`, normal Desktop build from `2860189f` with test-only dirty files) executed 1, passed 0, failed 1, skipped 0. Owning host and all four accepted grants were true. Successful window checkpoint was 122; a malformed live rejection and malformed recovery failure preceded delivered echo interval (125,127], followed by contiguous intervals through 135. Evidence: `/tmp/builder-2163/live-0.41.4-before.json` and `.stderr`. This is not capability refusal.

The concrete decoder mismatch is `logical`'s `rootItem`: it requires `order`, although the daemon `internal/protocol/thread.go` contract explicitly omits order for queued/dropped/lost sends until delivery. The existing shared DTO and `fullItem` already allow absent order, and compact sorting already treats it as zero. Admit those full non-tool/agent roots without inventing an order, retaining parent/root checks and every present numeric-field validation. Apply the same contract to live updates and query data. No recovery policy change is needed: malformed rejection was creating the spurious gap/recovery failure.

The direct production-dispatch test with an omitted-order post-send root fails before this change; the original ordered contiguous control passes. Diagnostic tests separately fail on all three missing refusal classifications. The old dedicated 0.41.1 binary grants compact but resets after sends and cannot establish this current interval behavior: two attempted controls each executed 1/failed 1/passed 0/skipped 0 waiting for compact echoes. Its source is `a935bfb8db70ff5fd5cd47c2a05ab5bc1e83273f`. Both initial open questions are resolved by using the isolated exact v0.41.4 tag and repairing the demonstrated decoder contract. A test-only Buffer observation returned no shapes and is discarded from the scenario; it supplied no causal evidence.

Security review addendum: absent order is an allowed wire representation, not malformed input. `fullItem` continues to validate any present order as a nonnegative safe integer; kind/parent restrictions remain in `rootItem`. No broader IPC or authentication admission changes.
