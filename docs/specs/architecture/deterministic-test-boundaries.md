# Deterministic test boundaries

The shared harness currently exposes independent process, renderer, storage and desktop schedules to
individual tests. This change gives those boundaries explicit owners while retaining existing scenario
assertions and native input. It does not change the product layout or daemon protocol.

## Implementation

- `electronLaunch` installs an app-owned main-process operation registry. Dispatch and receipt reads use
  the existing local inspector session synchronously, avoiding its collected awaited-result promises.
  Each invocation has one identity and deadline. A lost acknowledgement repeats observation of that
  identity, never the mutation. The application retains asynchronous work and its result. Callback
  failures are separate from transport failures; unsupported returned objects preserve Playwright's
  undefined-result behavior. Failed adapter initialization closes the acquired application.
- `RecordedExchange.whenConnectionComplete` observes the retiring connection's natural prefix without
  advancing a recording, matching a future request or releasing a checkpoint. The replay closing hook
  also waits for successful forwarding socket writes. Explicit retirement and successful scenario
  completion settle; error cleanup stays prompt. Retirement errors survive secondary cleanup errors.
- Linux display ownership moves from the runner to each worker process. All apps within a scenario share
  that worker's display. The existing EOF guardian stops Xvfb when its worker exits, including failure.
  The inherited-display opt-out and guarded offline runner remain available. Concurrency is unchanged.
- `installPausedClock` initializes before its target instant, so setup latency cannot make `pauseAt`
  travel backwards. All permission notice deadline assertions are unchanged.

The independently opened PR #2130 demonstrates the same retirement boundary and provides the basis for
`replayProfileRetirement.test.ts`. Its lifecycle error-preservation and successful-callback handling are
retained here alongside the socket-write barrier. That PR's separate saved-title acceptance remains
tracked by #2129; this change does not claim to repair that product/test failure or close those tickets.

## Security review

Verdict: test-only control with no new shipping interface. Callbacks originate in the local test source,
never daemon messages. The adapter runs only after the test launcher returns an application, adds no
socket or application IPC endpoint and is outside the packaging allowlist. Operation arguments, source,
paths and payloads are never attached to diagnostics. The fake relay stays byte- and content-blind.
Existing sandbox launch checks, native Secret Service checks, Noise setup and offline executable guards
remain enforced. No dependency, production entry point or renderer bridge is added.

## Validation

Fault tests cover lost acknowledgements before/after effect, asynchronous completion, non-serializable
cleanup results, callback failures, fatal inspector errors, expiry and delayed dispatch. Lifecycle tests
execute the registered replay hook and isolated app helper, including delayed trailing requests, missing
prefixes, future connections, unreleased checkpoints, cleanup errors and hook disposal. Socket tests
verify the delivery barrier against real loopback writes. Clock tests advance setup time before pause.

Initial Mac native gate: 498 passed, 10 failed, 3 skipped at four workers/retry zero. Three failures
exposed unsupported cleanup return values and were repaired. Second gate: 501 passed, 7 failed, 3 skipped;
all seven require native focus. An exact named-case comparison with the original evaluator also fails
with `Visible-tail window is not visible and focused`; a direct original/owned comparison reports visible
true/focused false in both paths. These are retained baseline failures, not candidate passes. Focus
assertions, worker count and retries were not weakened. Initial focused smoke/notice gate passed 6/6.

Linux validation on the generic HP container passed 9729 unit assertions but has no running desktop
Secret Service; native protected-storage failures there are environment failures. Final native acceptance
runs in the existing desktop container on Fractal with its throwaway Secret Service. Transfer metadata
was removed from the isolated scratch tree before the corrected Linux unit run; no real source file was
removed. Counted final results and the merged rollout revision are recorded in the PR.

## Upgrade and failure boundaries

The adapter depends on Playwright's local `_nodeSession` and Node/Electron V8 value serialization.
Upgrades must rerun its fault tests and native client coverage. BrowserWindow handles and DOM operations
remain Playwright-owned. A running async callback cannot be cancelled generically after timeout; process
cleanup owns it. Worker display ownership isolates X state, not CPU or native secret services. Product
layout-neutral hover and bounded renderer batching remain independent changes with their existing design
and runtime acceptance requirements.

## Final candidate review

Candidate implementation `b1bd18b` preserves the tested source apart from the explicit packaged-probe
worker-display fix. Complete Mac units: 9733 passed, 0 failed, 6 existing skips. Typecheck, client-test
typecheck, build and docs guard pass. The affected-file pre-verifier passes main ancestry, removed-string,
typecheck and all 10 command-control regressions; its ticket-label check does not apply to this branch.
Guarded final recorded clients: 29 passed, 0 failed, 1 existing fixme, zero retries/forbidden launches.

Fractal desktop runtime, implementation `63d6812`, two workers/retry zero: complete native gate 505
passed, 1 failed, 5 existing skips. The only failure was the packaged probe, whose child launched without
DISPLAY after display ownership moved out of global setup. Runtime stderr identified the missing X
server. `b1bd18b` explicitly passes `withWorkerDisplay` to that child without changing protection or
history assertions; the corrected native case passes 1/1 on the same runtime, retry zero. A complete
confirmation run on this final implementation is retained separately. Its counted result and deployed
merge revision are recorded in PR #2132. No old failed report is represented as a successful full run.
