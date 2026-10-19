## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: verification boundaries and native ABI prerequisite.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `docs/knowledge/features/e2e-harness-context-recovery.md`: strict replay, synchronous inspection and observer protections remain unchanged; QMD search confirmed these owning topics.
- `e2e/fixtures/realDaemon.ts` → `withIsolatedElectronApp`: explicit retirement and process-exit guarantee, best-effort failure cleanup.
- `e2e/fixtures/clientAppLifecycle.ts`, `clientScenario.ts` → lifecycle hooks and replay fixture ownership.
- `e2e/fixtures/recordedExchange.ts` → `reply`, `drain`, `reconnect`, `checkpointWhenReady`, `assertComplete`: strict prefix and sticky failure semantics.
- `src/main/transport/fakeDaemon.ts` → `handleTransport`: returns from `reply`, then synchronously seals and sends every returned frame before yielding. No production change.
- `e2e/real-daemon-history-on-open.spec.ts` → resumed `fresh.close`: all original history assertions precede independent-profile launch.
- `e2e/fixtures/recordedLifecycle.test.ts`, `realDaemon.test.ts`: existing connection and process-boundary fakes.

## Context

The reopened failure reaches independent-profile pairing with connection 2's final list request and two replies outstanding. The inspector repair is already merged and stays intact. One behaviour ships here: a successful profile retirement settles its own recorded connection before exit. Its regression belongs to the same slice. Historical timing remains unobserved; controlled ordering will establish the premature-close mechanism, not claim its upstream trigger.

## Design

Add `RecordedExchange.settleConnection(): Promise<void>`: snapshot the current connection's end, observe natural replay progress without advancing or matching anything, reject sticky failures and unreleased checkpoints within that prefix, and bound missing-prefix waiting to five seconds. It resolves only after the entire prefix has drained. Promise continuations run after the synchronous fake-daemon reply/send loop, so the outgoing batch is sent before the app is closed, rather than closing on the request matcher counter. It never waits for the next connection or releases a test-side action.

Give the existing closing hook a completion flag. Explicit close/relaunch and successful callback completion pass true; failure cleanup passes false. Replay installs a closing hook that awaits settlement only for successful retirement, and removes both hooks in finally. Clear the current handle even when retirement fails after process cleanup. Preserve the retirement error if cleanup also fails. No application changes, captures, request matching, scenario assertions, deadlines, concurrency or retries change.

Cleaner-shape check: use existing progress subscriptions and lifecycle hooks. A new relay harness or application delivery API would widen this repair unnecessarily. Outgoing send ordering follows the existing synchronous daemon loop; no receiver acknowledgement is invented.

Overlap: `feature/1364` changes profile encryption/relaunch in `realDaemon.ts`; current main already has relaunch. Preserve its independent encryption work. `feature/1544` changes child spawn options in another block. Neither is a required dependency.

Size re-count: one useful behaviour, approximately 450–550 written lines including evidence/tests/plan, no new exported types, three consuming seams, four acceptance behaviours and fewer than ten reject branches. Within all ceilings.

## State + concurrency model

Each settlement snapshots one connection ordinal/end. Progress subscriptions and its deadline are removed on success/failure. No cached app handle crosses relaunch. Existing strict reconnect rejects crossing an incomplete prefix. Failed scenario cleanup never waits for new application work.

## State transitions and identity reuse

| Event | Regression |
| --- | --- |
| Delayed final resumed list after visible assertions | controlled profile retirement test: request, outgoing replies, process exit, independent connection ordering |
| Completed prefix followed by future connection | settlement scopes to retiring connection |
| Missing request | fake-timer bounded rejection and listener cleanup |
| Unreleased action barrier | immediate rejection without releasing it |
| Request/connection mismatch | sticky causal error propagation |
| Retirement/setup/scenario failure | process cleanup preserves primary error and bypasses settlement |
| Next case/relaunch | lifecycle hooks removed; current handle cleared after close failure |

## Error handling

Use static prefix-incomplete/checkpoint diagnostics and existing sticky errors. Never log payloads, native loader details or credentials. Cleanup remains mandatory after retirement failure, without replacing the causal error. Final exchange completion still fails missing work.

## Testing strategy

- Test first through actual isolated-profile lifecycle and replay closing hook with fake Electron process boundaries and real exchange matching; delay the final resumed list through a microtask after assertions, without sleeps or synthetic application requests.
- Test missing-prefix bounds, barriers, sticky errors, future-connection scope, outgoing-batch-before-close ordering, failure cleanup and hook disposal with fake timers.
- Linux: five guarded focused batches, both original cases repeated twice, fully parallel, three workers, zero retries (20 expected executions), then complete guarded recorded suite. Preserve system-prompt-reset fixme and capture provenance.
- Run lifecycle/exchange/inspection/observer regressions, final main merge, affected-file pre-verify, build and client-test typecheck. Dispatcher owns configured application gate; no live-provider or macOS acceptance is claimed.

## Open Questions

None. Append measured red/green ordering and counted Linux results before handoff.
