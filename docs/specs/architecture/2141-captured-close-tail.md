# Captured close client-tail replay

## Files read
- `e2e/fixtures/exchangeCapture.ts` → `createExchangeCapture`: raw close position and per-call connection identity.
- `e2e/fixtures/captureNoiseSession.ts` → `createNoiseSession`: observes calls before delegating; observation does not prove a successful socket write.
- `e2e/fixtures/captureNoiseRelayDriver.ts` → `createNoiseRelayDriver`: records link-down before forwarding it.
- `e2e/fixtures/recordedExchange.ts` → `drain`, `reply`, `reconnect`, `assertComplete`: strict matcher, causal barriers and completion.
- `e2e/fixtures/recordedLifecycle.test.ts` → `fixture`: connection/close/checkpoint and retirement controls.
- `e2e/fixtures/exchangeCapture.test.ts` → capture controls: unchanged chronology.
- `e2e/fixtures/clientScenario.ts` → replay daemon fixture: actual close-observer wiring and successful-profile retirement.
- `src/main/transport/fakeRelayForwarder.ts` → `closeClientAfterServerFrames`: socket-write boundary.
- `docs/knowledge/features/development-verification.md`: Node/Electron ABI preparation must be sequential.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: guard, original assertions, provenance and offline proof boundaries.

## Context
A recorded transport close may precede observed client calls still assigned to that
session. Immediate replay closure strands those calls and makes reconnect fatal.
This is one behaviour plus its regression/rejection proof; no independent slice or
ADR is needed. Estimated total written work: 450 lines, no exported surfaces or
consumer migrations, four acceptance behaviours, fewer than ten reject branches.
In-flight #2072 adds settlement beside these methods; preserve main's existing
retirement and socket-write handling. It is not a dependency.

## Design
Derive the replay close position from the raw close: scan only the contiguous
client entries belonging to its connection. Keep the recording unchanged. Match
these requests through the existing exact matcher, then notify the existing
transport-close observer once, with the original code and daemon-frame prefix.
Bound request eligibility by that derived position. A same-connection daemon
entry beyond the close is invalid and fails rather than crossing the boundary.
No-tail closes keep their position. Considered a pending-close state object;
deriving the finite boundary avoids another lifecycle state to reset.

## State + concurrency model
Existing index, consumed requests and closure ordinal remain authoritative.
No new async job, timer, production transport change or capture rewrite. Existing
connection-completion deadlines bound missing requests; observer forwarding waits
for actual successful server-frame socket writes as before. Teardown is unchanged.

## State transitions and identity reuse
| Event | Control in `recordedLifecycle.test.ts` |
| --- | --- |
| Close, old-session calls, reconnect; request IDs reused on next connection | capture-to-replay close-tail regression |
| Close without tail, repeated draining | existing close control and regression's exactly-once observer assertion |
| Missing tail | default connection deadline, sticky failure and final-completion control |
| Changed/duplicate/extra/future-connection request | parameterized strict tail rejection controls |
| Checkpoint within tail | unreleased checkpoint control, explicit release only |
| Daemon frame beyond close | boundary rejection control |
| Actual relay socket close | close observer wired to `closeClientAfterServerFrames` control |

## Error handling
Reuse sticky matcher and transport-boundary failures. Missing calls use the
existing five-second connection-prefix deadline. Do not relax payload, identity,
device, connection, checkpoint or final-completion checks.

## Testing strategy
Write the capture-to-replay regression first and record its failure. Capture
controls retain close position/code and actual session ownership. Lifecycle
controls cover strict tail rejection, bounded absence, checkpoints, invalid
post-close daemon data and actual relay close observation. Run focused capture,
exchange and lifecycle tests, pre-verify, client-test typecheck and build after
merging main. Prepare Electron SQLite only after Node checks. Run unchanged
retained question-answer capture with retries zero, then the complete guarded
committed-recording suite. Record counted Linux results and guard/exchange
counters here; preserve historical failure evidence. No new live capture required.

## Open Questions
None. Test fixtures only; no UI or documentation-stage requirements.
