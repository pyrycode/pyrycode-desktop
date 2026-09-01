# #904 — `fakeRoutingRelay.test.ts` dial-retry budget and stall-path listener

Bound the dial-retry ladder in `fakeRoutingRelay.test.ts`'s `connect()` by wall clock instead of by
attempt count, and stop the stall path from dropping its only `'error'` listener across
`terminate()`. Test-harness only: no file under `src/main/` other than `fakeRoutingRelay.test.ts`
changes.

**Design source:** N/A — test-harness plumbing with no UI surface, so no Figma anchor applies.

## Files read

- `src/main/transport/fakeRoutingRelay.test.ts` → `connect`, `DIAL_STALL_MS`, `isTransientDialError`,
  `serverLeg`, `clientLeg` — the file under repair. `connect` is the only symbol whose body changes;
  `serverLeg`/`clientLeg` are read to confirm the public call shape stays fixed.
- `src/main/transport/fakeDaemon.test.ts` → `connect`, `bounded`, `DIAL_STALL_MS`, `AWAIT_BUDGET_MS`
  — the sibling that already carries this repair (#550). The listener *swap* before `terminate()` and
  the `Math.min(DIAL_STALL_MS, remaining)` per-attempt cap are ported from here verbatim in shape.
- `docs/knowledge/codebase/550.md` § "Open item (SHOULD FIX, not blocking)" — names *this* file as
  carrying the identical drop-the-listener shape, "confirmed by reproduction rather than suspected by
  analogy", and names `net.createServer(() => {})` as the verified repro. That is the origin of this
  ticket's AC1 test and of the decision to pin the remedy branch rather than trust it by reading.
- `docs/knowledge/codebase/550.md` § lessons — "#342's dial timer had an un-closed hole — don't clone
  it verbatim into a new file" (`5 × 1500 = 7500ms` out-running the 5000ms timeout), and "one shared
  wall-clock deadline, not per-step budgets". Both shape the Design below.
- `vitest.config.ts` → the `test` block — confirms no `testTimeout` override, so the per-test budget
  really is vitest's 5000ms default. This is the number the new budget must stay provably under.
- `docs/knowledge/features/fake-routing-relay.md` — the package overview for the module under test.
  Confirms the relay's two-leg path-identified shape (`/v1/server`, `/v1/client`); it carries no dial
  harness lesson, which is why the #550 archive note above is the load-bearing reading here.
- `package.json` → the `ws` dependency pin — `^8.21.0`, the version whose `terminate()` on a
  `CONNECTING` socket takes the `abortHandshake` branch that this ticket's second defect depends on.

## Context

`connect()` in `fakeRoutingRelay.test.ts` carries two defects that compound each other, both
introduced by #342 and both already repaired in the sibling `fakeDaemon.test.ts` by #550, which
explicitly left this file untouched under its scope guard.

1. **The retry budget out-runs the test timeout.** `DIAL_STALL_MS` is 1500ms and the default
   `attemptsLeft` is 5, so a fully-stalled dial spends 7500ms against vitest's 5000ms default. The
   descriptive `dial to ${url} stalled: …` rejection the helper builds is therefore unreachable in
   practice — vitest kills the test first, and the operator reads a bare `Test timed out in 5000ms`.
   The hardening is defeated by its own arithmetic.
2. **The stall path drops its only `'error'` listener before `terminate()`.** A stall timer can only
   fire while the socket is still `CONNECTING`, and under ws@8 `terminate()` on a `CONNECTING` socket
   takes the `abortHandshake` branch, which emits `'error'` on `nextTick`. With zero listeners Node
   raises `Unhandled 'error' event` out of band — killing the re-dial that the same code path exists
   to run. This is a correctness defect, not cleanup noise, which is why the two halves belong in one
   ticket.

No ADR is warranted: this restates a decision #550 already made, on a second file.

## Design

All changes are inside `fakeRoutingRelay.test.ts`. The module's public helpers keep their exact
signatures, so all 32 existing `serverLeg` / `clientLeg` / `connect` call sites are untouched.

### The wall-clock bound, armed inside `connect()`

`connect(url, opts)` keeps its signature and becomes a thin entry point that arms **one deadline**
and delegates to a new private recursive `dial(url, headers, attemptsLeft, deadline)`. The retry
recursion calls `dial`, never `connect`, so the deadline is established exactly once per logical dial
and cannot be extended by a re-dial.

- New constant `DIAL_BUDGET_MS` — the whole-dial wall-clock bound. `DIAL_STALL_MS` stays 1500 as the
  per-attempt stall window; `VITEST_DEFAULT_TIMEOUT_MS` is introduced as a named 5000 so the
  relationship between the two is stated in the file rather than inferred.
- Each attempt's stall timer is capped by the remainder: `Math.min(DIAL_STALL_MS, max(0, deadline -
  now))`, mirroring `fakeDaemon.test.ts`'s `connect`.
- Both re-dial gates — the stall timer's and `onDialError`'s transient-error ladder — add a
  `Date.now() < deadline` conjunct alongside the existing `attemptsLeft > 1`.

The bound then holds **by construction, whatever `attemptsLeft` is set to**: every re-dial gate
re-checks the deadline and no attempt's timer can extend past it, so a stalled dial rejects at
`start + DIAL_BUDGET_MS` at the latest rather than at `attemptsLeft × DIAL_STALL_MS`.

**Budget value: 3000ms.** It admits two full-margin attempts (1500 + 1500), preserving #342's intent
that a stall gets a real retry rather than a truncated one, and leaves ~2000ms of headroom inside the
5000ms per-test budget for the test's own work, the rejection's unwinding, and `afterEach` teardown.

**Why the bound is per-`connect()` and not per-test.** `fakeDaemon.test.ts` threads one deadline
through a whole test via its `bounded(step, work, deadline)` wrapper. That is deliberately *not*
ported here, for two reasons. Mechanically, this file has 32 dial call sites and threading a deadline
would blow the ≤10-call-site size boundary on its own. Substantively, it would buy little: an
exhausted dial **rejects**, which fails its test immediately, so stalls cannot accumulate across
sequential dials the way per-step budgets could. A test-anchored deadline would also introduce a new
hazard this file does not have today — a healthy-but-slow test would hand its late dials a truncated
stall window and reject them spuriously.

### The listener swap on the stall path

The stall path replaces `ws.off('error', onDialError)` + `terminate()` with the #550 shape: detach
`onDialError`, **attach a benign swallow**, then `terminate()`. Detaching still prevents
`terminate()`'s teardown events from spawning a duplicate re-dial, and the swallow keeps the socket
listened so `abortHandshake`'s `nextTick` emit has somewhere to land. This mirrors what the `'open'`
path in the same function already does.

`onDialError`'s own `terminate()` is deliberately left unchanged: by the time it runs, ws has already
emitted `'error'` and driven the socket out of `CONNECTING`, so `terminate()` does not take the
`abortHandshake` branch there. That path is also not implicated by the observed evidence, and #550
left the identical line alone on the sibling file.

### Comments

Three comment blocks encode the reasoning this ticket invalidates and are rewritten alongside the
code: the `DIAL_STALL_MS` block (which reasons about "≥2 attempts inside the 5000ms per-test
budget"), the stall-timer block above `dialTimer` (which reasons about *dropping* the listener), and
the per-test note in the AC1 readiness test that justifies its `whenReady(4000)` in terms of
`DIAL_STALL_MS = 1500`. That last note still reads true — a stalled dial now settles by 3000ms, still
inside the 4000ms readiness gate — but it is re-anchored to the budget rather than to the
per-attempt window.

## State + concurrency model

No store, no React, no IPC. The concurrency surface is a single `Promise` per dial with three
mutually-exclusive settle paths (`'open'`, `onDialError`, the stall timer). The existing invariant
holds unchanged: whichever path fires first `clearTimeout`s the stall timer, so no timer outlives its
dial and no handle survives into `afterEach`. Recursion through `dial` chains a fresh Promise per
attempt; the deadline is the only state carried across attempts.

Cancellation: the new test's stall target and its accepted sockets are registered in the file's
existing `cleanups` array, destroyed and closed in `afterEach`, so no listener and no half-open
socket outlives the test.

## Error handling

- A **stalled** dial rejects with the existing descriptive message, extended to name the exhausted
  budget as well as the attempts (`fakeDaemon.test.ts`'s wording, with `DIAL_BUDGET_MS` in place of
  its `AWAIT_BUDGET_MS`). This message becomes reachable for the first time.
- A **transient emitted error** keeps its existing classify-and-re-dial ladder via
  `isTransientDialError`, now additionally deadline-gated. `isTransientDialError` itself is unchanged
  — this ticket adds no error classes.
- A **non-transient** error still rejects immediately with the original error object, unchanged, so a
  genuine never-accept regression fails fast rather than burning the budget.
- An `abortHandshake` `'error'` raised by `terminate()` on the stall path is swallowed rather than
  escaping to `process`.

## Testing strategy

Vitest (node environment), real timers — consistent with the rest of the file, whose whole subject is
real socket timing. One new test, in its own `describe` block; the 12 existing tests are unmodified.

The new test drives the harness's own remedy branch, which #550 flagged as untested:

- **Stall target** — `net.createServer(() => {})` bound to an ephemeral loopback port. It accepts the
  TCP connection and never answers the HTTP upgrade, so `ws` emits neither `'open'` nor `'error'`.
  This is the same injection #550's rework commit used to verify its own fix; it is a genuine stall,
  not a mocked timer.
- **Assertion 1 (AC1)** — `connect()` against it rejects with `/stalled/` rather than dying on the
  vitest timeout. Red on `main`: 5 × 1500ms out-runs the 5000ms budget.
- **Assertion 2 (AC2)** — elapsed time is at least one full stall window and below the documented
  budget plus a contention margin, with that margin itself asserted to sit under
  `VITEST_DEFAULT_TIMEOUT_MS`.
- **Assertion 3 (AC3, re-dial half)** — the stall target observed **more than one** connection,
  proving the re-dial that follows the `terminate()` actually ran. Asserted as a lower bound, not an
  exact count: the final attempt's stall window is the deadline remainder, so a late-firing timer can
  legitimately admit one more short attempt.
- **Assertion 4 (AC3, unhandled-error half)** — a `process.on('uncaughtException')` probe registered
  for the duration of the test captures nothing. On `main` the `abortHandshake` emit lands here. The
  probe is removed via `cleanups`, and the assertion runs after a macrotask tick so a `nextTick` emit
  has landed before it is read.

No Playwright spec: there is no interaction and no rendered surface. No production code changes, so
nothing else in the suite is reachable from this diff.

## Open questions

- **Does `net.createServer(() => {})` reliably produce a *stall* rather than an error under Node's
  default backlog on macOS and CI?** #550 verified exactly this shape, so the expectation is yes.
  Resolve by observing the new test go red on `main` for the timeout reason and green after the fix;
  if the target errors instead, the dial would take the transient ladder and reject early with a
  non-`/stalled/` message, which the AC1 assertion would catch.
- **Is 3000ms the right budget, or does the full-suite contention that produced the original report
  need more headroom?** Resolve by running the file and watching the new test's own elapsed
  assertion; if a full-suite run shows the healthy path anywhere near the per-attempt window the
  budget is the wrong lever and the stall window is.

Each is resolved during implementation; any resolution that changes the design above is recorded in a
`## Revisions` entry.

## Revisions

**2026-09-02 — both open questions resolved, no design change.** Recorded here so the audit does not
have to infer that they were answered rather than dropped.

- **The `net.createServer(() => {})` stall is genuine.** The new test is red on the pre-fix `connect`
  with `Test timed out in 5000ms` — the reported failure's exact text, not an early transient-ladder
  rejection — and green after, settling at ~3060ms against the 3000ms budget.
- **3000ms is the right budget, and the stall window is not the lever.** The file's other 12 tests
  total ~200ms of the 3257ms run, so the healthy dial path sits two orders of magnitude below the
  1500ms per-attempt window; the contention margin needed was in the whole-ladder bound, exactly
  where this ticket put it.

One thing the plan did not anticipate and the implementation checked: the unhandled-error assertion
could have passed vacuously. Removing only the `'error'` swallow — budget fix left in place — was run
as a discrimination check, and the assertion captured two `WebSocket was closed before the connection
was established` errors, one per stalled attempt, matching the ticket's evidence. So the assertion is
load-bearing, and the re-dial after the terminate is confirmed to run.
