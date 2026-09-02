# #931 — One shared wall-clock deadline for every stallable await in `fakeDaemon.test.ts`

## Files read

- `src/main/transport/fakeDaemon.test.ts` → `bounded`, `connect`, `AWAIT_BUDGET_MS`, `DIAL_STALL_MS`,
  `makeWaiter`, `standUp`, `driveClient`, `isTransientDialError` — the whole subject of the ticket. The
  #550 mechanism already exists here; the gap is that exactly one of the 12 tests arms it.
- `src/main/transport/fakeDaemon.ts` → `FakeDaemon`, `startFakeDaemon` — `whenSettled()` is cached and
  *never rejects*, so a daemon that never settles is a silent stall with no error to surface. That is
  precisely the shape a wall-clock bound has to cover, and it is why `whenSettled` is named in AC1.
  `startFakeDaemon` resolves only once its `/v1/server` leg is OPEN, so it is stallable too. The returned
  value is a plain object literal (`staticPublicKey` / `whenSettled` / `initiateRekey` / `pushFrame` /
  `close`), which is what makes the spread-with-one-override wrapper below sound.
- `src/main/transport/fakeRelayForwarder.ts` → `FakeRelayForwarder`, `whenReady`, `dropClientLeg`,
  `close` — `whenReady(timeoutMs = 1000)` *does* reject on its own, but only after 1000ms and with a
  static message that names no step; it is also cached, so the first caller's timeout governs every
  later one. `dropClientLeg` is why `standUp` must keep returning the raw forwarder.
- `src/main/transport/relayConnection.ts` → `createRelayConnection` — its unexpected-response handler
  suppresses a 404 upgrade into a silent `closed{1006,'connect-error'}`, which is what `driveClient`'s
  re-dial ladder keys on. That ladder is bounded by attempts alone today.
- `docs/knowledge/features/fake-routing-relay.md` § "Test-file dial harness (`connect()`, #904)" — the
  sibling file's version of this exact fix, and the lesson that governs this one: an attempt-count ladder
  is not a bound, because *"vitest killed the test first"* **regardless of how the descriptive rejection
  was worded**. It also records why the stall path must swap its `'error'` listener for a benign swallow
  rather than drop it (ws@8's `abortHandshake` branch), which is why `connect` keeps that shape here.
  One deliberate divergence: #904 arms its deadline **once per `connect()` call**, which cannot bound a
  *sibling* step; #931 arms once per **test**, so summed budgets across different steps are covered too.
- `docs/knowledge/features/fake-daemon.md` — `whenSettled()` is *"a diagnostic aid, not the primary
  oracle"* and the round-trip assertion in the consuming test is. That is the licence for AC2's carve-out:
  clamping a `wait()` to resolve early is sound precisely because the caller's own assertion is the
  oracle. It also confirms the daemon is deliberately wall-clock-free, so the deadline must live in the
  test file rather than be pushed into the fake.

## Context

`src/main/transport/fakeDaemon.test.ts` stalls intermittently and dies as a bare
`Test timed out in 5000ms`, naming nothing. The ticket establishes — and the file corroborates — that
this is the seventh instance of one family: a step whose budget is bounded by attempt count or by a
per-step constant, never by the wall clock vitest actually enforces.

The unsoundness is provable by construction rather than by reproduction. `makeWaiter().wait()` *resolves*
after a default 2000ms, and several tests make three sequential calls — 6000ms of per-step budget against
a 5000ms per-test budget, before `standUp`, `driveClient` and `whenReady` have spent anything. That
arithmetic also explains the one symptom a per-test cause cannot: the failing test *name varies between
runs*, because the tests differ in how many budgets they sum and none of them names its stall.

#550 already built the cure — `bounded`, `AWAIT_BUDGET_MS`, and a deadline-capped `connect` — and armed
it in exactly one test, closing with *"11 sibling tests are unchanged."* This ticket is those 11. It is a
rollout of an existing in-file pattern, not a new design.

**This ticket buys the diagnosis, not the cure.** The cause is not confirmed and nothing here presumes
it. What changes is that the next occurrence names its step instead of dying anonymously. No ADR is
warranted: this extends an established in-file pattern and introduces no cross-cutting decision.

## Design

### The shape: an ambient per-test deadline, not a threaded parameter

Threading a `deadline` argument through every stallable await would touch all 35 `.wait(` call sites and
all 12 test bodies — over the size-S call-site limit, for no gain in expressiveness. Instead one deadline
is armed per test in a `beforeEach` and read by the shared helpers. Call sites stay untouched; the bound
arrives underneath them.

Module-level state and its accessors:

- `armDeadline(budgetMs = AWAIT_BUDGET_MS): void` — sets the ambient deadline to `now + budgetMs` and
  records the budget for the message text. Called from `beforeEach`; re-callable inside a test, which is
  what the AC3 test uses to provoke a bound cheaply.
- `remainingMs(): number` — `max(0, deadline - now)`. The single source of "how long is left".
- `AWAIT_BUDGET_MS = 4000` keeps its current value and its rationale: ~1000ms of headroom under vitest's
  5000ms default absorbs the rejection's own unwinding plus `afterEach` teardown.

`bounded(step, work)` and `connect(url, attemptsLeft?)` both drop their explicit `deadline` parameter and
read the ambient one. Behaviour is otherwise unchanged, including `bounded`'s central property: a settle
of `work` — value *or* error — passes through untouched, so a specific diagnosis always beats the generic
bound. The rejection message gains the *armed* budget rather than the `AWAIT_BUDGET_MS` constant, so a
re-armed deadline reports honestly instead of quoting 4000ms at a 150ms bound.

### Coverage of each stallable await named in AC1

| Step | How it becomes deadline-governed |
|---|---|
| forwarder start-up | `startForwarder()` — `bounded('startFakeRelayForwarder', …)` |
| daemon start-up | `startDaemon(opts)` — `bounded('startFakeDaemon /v1/server dial', …)` |
| `whenReady()` | `whenForwarderReady(forwarder)` — `bounded('forwarder.whenReady', …)`, returned by `standUp` as its `whenReady` |
| `whenSettled()` | `standUp` returns the daemon with `whenSettled` overridden to `bounded('daemon.whenSettled', …)`; every other member passes through |
| client dial | `driveClient` bounds `createNoiseSession`; the raw-`ws` path already goes through the deadline-capped `connect` |
| the re-dial ladder | `driveClient`'s `closed`-triggered re-dial gains a `remainingMs() > 0` guard beside its existing attempt guard |
| each `makeWaiter().wait()` | clamps its own timeout to `min(timeoutMs, remainingMs())` |

`wait()` **keeps its resolve-on-timeout contract** — its callers assert the resulting state and that
already yields a real assertion diff, which is a better diagnosis than a generic rejection. What changes
is only that its wait can no longer outlive the deadline. This is the one deliberate asymmetry in the
design and AC2 carves it out explicitly.

### Teardown must not be traded away for the bound

`standUp` currently registers `() => forwarder.close()` *after* the start resolved, and `afterEach`
awaits it. Once the start is bounded, a rejecting bound would skip that registration and leak a
late-resolving listening server into the rest of the run — a clean diagnostic rejection converted into a
worker-level hang. The #550 test already solved this by registering against the **start promise**; that
discipline moves into a helper so every caller inherits it:

- `closeWhenStarted(start: Promise<{ close(): … }>): void` — pushes a disposer that chains off the start
  promise and awaits the `close()`, but races it against a short teardown cap so a start that never
  settles cannot stall `afterEach`. Awaiting the close (rather than the fire-and-forget `void` the #550
  test uses) is deliberate: 12 tests each leaving a still-closing forwarder behind would add exactly the
  port contention this file keeps flaking on.

`startForwarder` / `startDaemon` each bound the start and register through `closeWhenStarted`, so the
leak-safety is structural rather than per-test.

### Call sites that do change

Only the two tests that construct a forwarder/daemon directly, and only in setup lines:

- the #550 leg-boundary test — its local `const deadline` collapses into the ambient one and its
  hand-rolled start-promise disposers collapse into `startForwarder` / `startDaemon`, per the ticket's
  instruction that the local deadline not survive alongside the shared mechanism.
- the `close()`-idempotence test — routed through the same two helpers.

No assertion in either changes. The other 10 test bodies are untouched.

## State + concurrency model

The ambient deadline is module-level mutable state in a single test file. Vitest runs the tests in a file
sequentially in one worker, so there is exactly one live deadline at any moment and no interleaving to
guard. `beforeEach` re-arms it, so a test that re-arms a short budget cannot leak that budget into its
successor.

Cancellation: `bounded` clears its timer on every settle path, so no handle outlives the test and no
rejection fires after the body has moved on. `wait()` clears its timer on the notify path and splices
itself out of the waiter list on the timeout path — unchanged. `connect` continues to `terminate()` a
half-open socket before re-dialling and to swap its pre-open reject handler for a benign swallow, so a
stall timer firing on a CONNECTING socket cannot spawn an out-of-band `Unhandled 'error' event`.

An important non-property: `bounded` does **not** cancel the work it bounds. It cannot — none of these
steps takes an `AbortSignal`. That is exactly why `closeWhenStarted` registers against the start promise:
teardown, not cancellation, is what reclaims a late-resolving server.

## Error handling

Failure modes and what each surfaces:

- A step overruns the deadline → `bounded` rejects with a message naming the step and the armed budget.
  This is the whole point of the ticket.
- The step fails on its own → its own error propagates unchanged; the bound never masks a specific
  diagnosis with a generic one.
- A `wait()` predicate never holds → resolves as today, and the caller's own assertion produces the diff.
- A dial stalls or resets → `connect`'s existing ladders, now additionally floored by `remainingMs()` so
  the per-attempt constant can no longer sum past the wall clock.
- A start never settles → `afterEach` gives up on that disposer at the teardown cap rather than hanging
  the worker.

## Testing strategy

The subject is a test file, so the proof is the file itself plus one added test.

- **AC3 (the new test)** — drive a deliberately stalled step through an *ordinary* helper path and assert
  on the **message**, not on the timing. A forwarder is started with no daemon, so `whenReady()` cannot
  resolve (it gates on *both* legs). The deadline is re-armed to a budget well inside `whenReady`'s own
  1000ms self-rejection, so the mechanism under test is provably what fires rather than the forwarder's
  pre-existing timeout. The assertion is a `rejects.toThrow` on a pattern naming the step and the budget.
  This uses `whenForwarderReady` — the same helper the 11 tests reach through `standUp`, not the #550
  test's bespoke path.
- **AC4** — every existing assertion in all 12 tests stays byte-identical; nothing is skipped or
  loosened. Verified by `npm test -- src/main/transport/fakeDaemon.test.ts`, then `npm run build`, then
  10 consecutive isolated runs of `npx vitest run src/main/transport/fakeDaemon.test.ts`.

Ten green isolated runs is a smoke check, not proof of absence — the ticket's own baseline ran green 6x
in isolation and still flaked. The deliverable is the named diagnosis, not a proof of stability.

No fakes or mocks are added: the file already drives the real initiator primitives against the real fake
daemon, and weakening that is out of scope.

## Open questions

1. **Does clamping `wait()` to `remainingMs()` turn a formerly-passing assertion red?** It can only fire
   when the summed budgets already exceeded the deadline — the unsound case. If a test legitimately needs
   more than the deadline allows, that is a finding worth surfacing, not a regression to paper over.
   Resolve by running the file; record the outcome in `## Revisions` if anything moves.
2. **Is the teardown cap long enough for a normal `close()` under full-suite contention?** It only ever
   binds when a close is pathologically slow, and giving up on a disposer is strictly better than hanging
   the worker. Confirm across the 10 isolated runs and the touched-scope suite.

## Revisions

**2026-09-02 — both Open Questions resolved during implementation. No design change.**

1. *Does clamping `wait()` to `remainingMs()` turn a formerly-passing assertion red?* **No.** All 13 tests
   are green, and the file ran green across 10 consecutive isolated runs. No test needed more than the
   deadline allows, so the clamp never bound in practice — it only removes the *possibility* of summing
   past it.
2. *Is the teardown cap long enough for a normal `close()` under full-suite contention?* **Yes** at
   `TEARDOWN_CAP_MS = 500`; it never bound across the touched-scope run or the 10 isolated runs.

One implementation note worth recording, since it is the kind of thing the design section could not have
predicted: `standUp`'s daemon wrapper is a spread-with-one-override, and an object spread silently drops
nothing but also silently *adds* nothing — the mistake to avoid there is re-listing members by hand and
forgetting one. Restricting the wrapper to a single overridden key keeps that failure mode unreachable.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. Nothing in this change moves data across a trust boundary. The one
  boundary this file exercises — daemon frames entering the client via `driveClient`'s `deliverFrame` —
  is untouched: its decode, its `base64StdDecode`, and its fail-closed `catch` keep their current shape,
  and no new frame source is introduced. The added deadline reads only `Date.now()`.
- **[Tokens, secrets, credentials]** No findings, and one invariant explicitly preserved: `buildTestHello`
  and `makeRelay` keep carrying the synthetic `dummy-fakedaemon-token-not-a-real-credential`, and every
  keypair stays freshly generated in-process. No new value reaches a header, a message, or a hello. The
  bound's message text is built from a *step label that is a client-owned constant* and an integer
  millisecond budget — no URL with credentials, no frame bytes, no key material, no transcript. This was
  the category most worth checking, because the deliverable of this ticket **is** a new error string: a
  bound that interpolated the failing work's value or a dialled URL with embedded credentials would leak
  through the very diagnostic being added. It interpolates neither.
- **[File / storage operations]** Not applicable by design decision: this ticket touches one test file and
  the change performs no filesystem access whatsoever — no path is constructed, read, or written, so
  there is no traversal, TOCTOU, or at-rest surface to reason about.
- **[Inter-process / Electron attack surface]** Not applicable by design decision: no `BrowserWindow`, no
  `contextBridge` API, no `ipcMain` channel, no custom protocol registration is added or altered. The
  file runs under vitest's node environment and never constructs a renderer.
- **[Cryptographic primitives]** No findings. Nothing here re-implements, wraps, or reconfigures any part
  of the Noise handshake, the key schedule, or the AEAD framing — `createNoiseSession` and `loadNoiseLib`
  are composed exactly as today, merely awaited through `bounded`, which is transparent to the value it
  passes through. The `Noise_IK_25519_ChaChaPoly_BLAKE2s` variant is not referenced, let alone changed.
  One nonce-reuse question is worth stating rather than assuming away: `driveClient`'s re-dial ladder
  gains a wall-clock guard, and a re-dial that re-drove a half-advanced handshake would risk exactly the
  reuse this category warns about. It cannot — the guard is strictly *narrowing* (an additional condition
  on an existing branch, never a new re-dial path), and the ladder still fires only before the first
  `connected`, where the initiator is pristine and msg1 has never been sent.
- **[Network & I/O]** No findings, and this change is directionally *toward* the category's own advice:
  the ticket's substance is timeout discipline, replacing attempt-count bounds with wall-clock ones. All
  sockets remain loopback `ws://127.0.0.1` to an in-process forwarder — the production `wss://`, TLS, and
  `maxPayload` posture lives in `relayConnection.ts` and is deliberately not touched. No timeout is
  loosened anywhere: `AWAIT_BUDGET_MS` keeps its value, `DIAL_STALL_MS` keeps its value, and `wait()`'s
  clamp can only ever shorten a wait. Raising `testTimeout` is explicitly out of bounds per the ticket.
- **[Error messages, logs, telemetry]** No findings, and the file's strictest oracle is preserved. Three
  tests assert *zero console output* across the whole handshake + transport + error path, and `bounded`
  emits on no path — the new helpers (`armDeadline`, `remainingMs`, `closeWhenStarted`, `startForwarder`,
  `startDaemon`, `whenForwarderReady`) add no `console` call either, so the log-free assertions keep
  measuring the harness plus daemon alone. `closeWhenStarted` deliberately swallows a start-promise
  rejection into a no-op rather than logging it, for the same reason. `peekInnerType`'s discipline —
  record the inner `type`, never `.data` — is untouched.
- **[Concurrency]** No findings; this is the category the design actually turns on, so the reasoning is
  recorded rather than asserted. Every timer this change introduces is cleared or raced to completion:
  `bounded` clears on all three settle paths, `closeWhenStarted`'s cap timer resolves its own race, and
  `wait()`'s clamp changes a timer's duration without changing its lifecycle. The ambient deadline is
  read-mostly module state in a file vitest runs sequentially in one worker, so the check-then-act
  concern does not arise — and `beforeEach` re-arming removes any cross-test carry. The one real risk here
  was **the fix creating a leak**: a bounded start that rejects before its disposer is registered would
  strand a listening server, which is why `closeWhenStarted` registers against the start promise, and why
  it awaits the close rather than firing it and forgetting. Duplicate connections are bounded as before —
  the re-dial guard narrows, never widens.
- **[Threat model alignment]** No findings. The hostile-relay, token-theft, hostile-daemon, and
  renderer-compromise threats all live in production paths this ticket does not touch; the ticket's own
  scope boundary forbids modifying any production file under `src/main/transport/`. Two oracles that
  *encode* parts of that threat model — the `frame-decode-failed` fail-closed assertion at the leg
  boundary and the `transport-decrypt-failed` rekey-window assertion — are load-bearing security tests,
  and AC4 forbids weakening either. They are preserved verbatim; the only change reaching them is that
  their surrounding awaits gain an outer bound that fires strictly *earlier* than vitest's, which cannot
  convert a red oracle into a green one.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
