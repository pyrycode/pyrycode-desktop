# #104 — fakeRelayForwarder "socket hang up": deterministic dial-lifecycle hardening

**Size:** S (arguably XS). **Test-only:** the change lands in one file, `src/main/transport/fakeRelayForwarder.test.ts`. **No production `src/` change**, no new exported type, no new dependency, no wire-type drift, no consumer cascade. The content-blind forwarder module (`fakeRelayForwarder.ts`) is **not** touched — so its import list, and with it the content-blindness invariant, is preserved by construction.

## Files to read first

- `src/main/transport/fakeRelayForwarder.test.ts:19-64` — the flaky test and its `connect()` / `nextFrame()` helpers. **This is the whole edit surface.** The `connect()` helper at :21-27 is the suspect: a raw `ws` dial with a *persistent* `on('error', reject)` and `once('open', resolve)`, no retry.
- `src/main/transport/fakeDaemon.ts:243-258` — the sibling dial, **more robust** than the flaky helper. It uses `once('error', onDialError)` **removed on open** (`socket.off('error', onDialError)`), then attaches benign post-open `on('error', close)` / `on('close', close)`. This is the lifecycle pattern the fix should mirror. `terminate()` in `close()` (:237) "cancels an in-flight dial too" — the ordered-teardown idiom.
- `src/main/transport/fakeRelayForwarder.ts:86-200` — the forwarder module. Confirm the fix needs **no change here**: it already await-listens (resolve on `'listening'`, :188), gates frame delivery behind the positive `whenReady` deferred (:158-170), and has idempotent `close()` (:172-185). Read the module header (:1-16) — the import list (`ws` + Node built-ins only) is the content-blindness contract; **do not add any import** while hardening.
- `src/main/transport/relayConnection.test.ts:35-78` — the other sibling that stands up `WebSocketServer({ port: 0 })`; `startRelay`'s `close()` (:72-77) shows the `terminate()`-then-`wss.close(cb)` teardown the forwarder mirrors. Useful to confirm the ephemeral-port pattern is shared across the whole transport test suite (6 files stand up ws servers — the concurrent-churn surface).
- `docs/knowledge/codebase/90.md` — the #90 ship note. §"Testing" lists all 8 forwarder cases (the AC4/AC5 non-regression set); §"Patterns established" documents why the readiness gate and idempotent close already close the *frame-order* races (so the remaining flake is below them, in the raw dial).
- `docs/knowledge/features/fake-relay-forwarder.md` — evergreen API contract; read only if you need the forwarder's content-blind guarantee restated.
- Memory: `flaky-fakerelayforwarder-socket-hangup.md` — the prior QA observation (passes 5/5 in isolation, clean on full-suite re-run, baseline all-green) that established this as a pre-existing flake, not a regression.

## Context

`src/main/transport/fakeRelayForwarder.test.ts > startFakeRelayForwarder > forwards a frame byte-identical in both directions, content-blind (AC2, AC3)` intermittently fails with `Error: socket hang up` when the **full** vitest suite runs under CPU contention. It passes in isolation and on re-run. It is a pre-existing flake on `main`, not caused by any PR — but a single-shot pre/post QA partition mislabels whichever PR trips it as introducing a "regression" (happened during QA of PR #103), forcing hand-triage on every future PR that hits it. A deterministic fix removes the false signal at its source.

## Design

### Root cause (hypothesis — AC1 requires the developer to confirm it via the spike, then record it in the PR)

`"socket hang up"` is Node's `ECONNRESET`-during-handshake. The failure surfaces as a **rejected `await connect(...)`**, i.e. a *pre-open* dial reset — one of the test's **two** raw `ws` dials (`/v1/client` and `/v1/server`) gets its TCP/upgrade connection reset before the 101 arrives. Reasoning that pins it to the dial, not the frame exchange:

- A reset *during* the frame exchange would leave `nextFrame(...)` unresolved and the test would fail with vitest's **5000ms timeout**, not `"socket hang up"`. The reported message is the dial-time error class → the reject is pre-open.
- The persistent `on('error', reject)` in `connect()` means a *post-open* error is a harmless no-op (the promise already resolved). So the only path from `"socket hang up"` to a red test is a pre-open reject.

Why only under full-suite concurrency, and why always the **first** test:

- The flake needs many workers each churning ephemeral-port `WebSocketServer`s at once (6 transport test files do). That peak ephemeral-port/accept-queue pressure is a loopback-server phenomenon, invisible when the file runs in isolation.
- vitest runs the file's `it` blocks in source order; the byte-identical test is first. Across workers, every file's *first* test starts at roughly the same wall-clock moment → contention peaks exactly then → the first test is the consistent victim. This also explains why re-runs and isolation pass (contention has dispersed).

**Confirmation the spike must produce (AC1):** instrument `connect()` (test file only — never the module) to capture, on reject, *which* leg and the error's `code`/`message`. Confirm it is a pre-open reset of the transient class (`ECONNRESET` / `"socket hang up"` / `ECONNREFUSED`). If the spike instead reveals a genuine forwarder ordering/teardown bug (a leg terminated mid-upgrade by the module itself), **that** is the thing to fix and the retry below is the wrong tool — record the actual cause and apply the matching deterministic fix. The design below is written for the most-likely case; the spike gates it.

### The fix — bounded, transient-scoped dial retry in the test helper's `connect()`

Harden `connect()` in `fakeRelayForwarder.test.ts` so a single dial converges against a transient pre-open reset, mirroring `fakeDaemon.ts`'s cleaner lifecycle. Contract (not the body — the developer writes it in the file's idiom):

```
connect(url: string, attemptsLeft = 5): Promise<WebSocket>
```

- On `'open'`: **remove** the pre-open error handler (`off('error', onDialError)`), attach a benign swallow handler (`on('error', () => {})`) so a later reset doesn't crash the process, resolve the socket. (Behaviourally equivalent to today's persistent no-op reject, but explicit — the `fakeDaemon.ts` pattern.)
- On a *pre-open* `'error'`: if the error is transient (`err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || /socket hang up/.test(err.message)`) **and** `attemptsLeft > 1`, terminate the failed socket and re-dial (`connect(url, attemptsLeft - 1)`) after a tiny fixed backoff (~20-25ms). Otherwise reject with the error.

Why this is deterministic hardening and not "hiding the flake":

- The server is guaranteed listening before any dial (`startFakeRelayForwarder` resolves on `'listening'`). A transient reset clears on an immediate re-dial — that is the definition of a recoverable transient, and a bounded retry converges. This is the same *category* as the ticket's own accepted examples ("await-listen", "ordered close-before-next"): socket-lifecycle hardening of the exact racy operation.
- It is **not** "blindly retrying the whole test" — no assertions re-run, so a real logic bug is never masked. The retry is scoped to a specific pre-open error class and bounded to ~5 attempts, so a genuinely-down server still fails fast instead of looping.

**The forwarder module needs no change.** The frame-order races the ticket enumerates ("both legs' upgrade completes before the first frame is sent", "101-before-registration") are *already* closed by `await forwarder.whenReady()` running before the first `client.send` and by the positive readiness deferred. Do **not** re-implement those. Leaving the module untouched is what guarantees AC4's "no behavioural change to the content-blind forwarding contract" and the "no codec/Noise imports" constraint — for free.

## Socket-lifecycle & concurrency model

- **Establishment:** `startFakeRelayForwarder` (await-listen) → `connect('/v1/client')` (retry-until-open) → `connect('/v1/server')` (retry-until-open) → `await whenReady()` (both legs registered server-side) → first `send`. Every hop is awaited; the retry only affects the two `connect` hops.
- **Teardown (unchanged):** `afterEach` runs the `cleanups` array in insertion order — `forwarder.close()` (terminates both server-side legs, `wss.close(cb)`) is awaited first, then the test's raw `client`/`server` `terminate()`. The `wss.close` callback fires only after the http server's connections are gone, so each test's server is fully closed before the next test's fresh `port: 0` bind. No cross-test-within-file bleed (confirmed: the flaky test is *first*, so nothing precedes it anyway).
- **Retry re-entrancy:** each retry attempt is a fresh `WebSocket` on a fresh socket; the failed one is `terminate()`d before re-dial so no half-open socket leaks. The backoff is a real-timer `setTimeout` (the suite already uses real timers on loopback).

## Error handling

- **Transient (retry):** pre-open `ECONNRESET` / `"socket hang up"` / `ECONNREFUSED`. The reset clears on re-dial against the already-listening server.
- **Non-transient (reject immediately, or after attempts exhausted):** any other pre-open error, or the transient class after ~5 attempts. Rejecting preserves fast failure for a genuinely mis-wired dial (e.g. wrong port) — the test still turns red rather than hanging.
- **Post-open errors:** swallowed by the benign handler (a dropped leg during the exchange surfaces as an unresolved `nextFrame` → vitest timeout, which is the correct, legible failure for a real mid-exchange break — not something the retry should mask).

## Testing strategy

1. **Repro spike first (AC1).** The flake does **not** reproduce by repeating the single file in isolation (it passes there) — it needs the full suite under load. Reproduce by running `npm test` repeatedly under artificial CPU contention (e.g. spawn N background busy-loops sized to the core count, then loop `npm test`), with the `connect()` instrumentation from the Design section capturing the failing leg + error `code`/`message`. Record the observed pre-fix failure rate — you need at least one captured reproduction to justify the fix and to prove the 10×-green run below actually cleared something.
2. **Post-fix evidence bar (AC3).** ≥10 **consecutive** full-suite `npm test` runs, **zero** failures, on a loaded machine (keep the artificial CPU load running). Because the flake is low-rate, prefer running more than 10 if the pre-fix reproduction rate was low — enough to be confident, not merely enough to satisfy the literal count. **Record the run count (and, ideally, the pre-fix failure rate) in the PR.**
3. **Non-regression (AC4/AC5).** The other 7 forwarder cases must pass unchanged: opcode preservation, `whenReady` pending-then-resolve, send-immediately-after-`whenReady`, `whenReady` timeout, close-before-both-legs, idempotent teardown, ephemeral-loopback URL shape (see `docs/knowledge/codebase/90.md` §Testing for the full list). The forwarder's content-blind byte+opcode-verbatim contract is untouched because the module doesn't change. `npm run build` and `npm test` both green.
4. **No new test case is required** — the fix hardens an existing helper. A new "dials survive under simulated reset" unit test is optional and hard to make deterministic (you can't reliably inject a pre-open reset); do not add one unless the spike surfaces a clean injection seam. The 10×-under-load green run *is* the regression guard.

## Constraints (carry-over ACs, restated so they aren't dropped)

- **Content-blindness:** do not add `./codec`, Noise, or any `@shared` wire import to `fakeRelayForwarder.ts` — and the simplest way to honour that is to not touch the module at all. The `connect()` instrumentation logs connection errors (`code`/`message`), never frame bytes, and lives in the test file — remove or comment it out before commit so shared test infra stays log-free.
- **No skip / `.fixme` / quarantine / whole-test retry.** The fix must be the scoped dial-lifecycle hardening above (or whatever deterministic fix the spike's actual root cause dictates).

## Open questions

- **Backoff/attempt tuning.** ~5 attempts × ~20-25ms is a starting point sized to clear a transient loopback reset without stretching the suite. If the spike shows resets cluster (multiple consecutive attempts reset), nudge attempts up rather than the backoff — bounded, still deterministic. Final values are the developer's call from the spike data.
- **Spike contradicts the hypothesis.** If instrumentation shows the reject is *not* a pre-open transient reset (e.g. it's a forwarder-side mid-upgrade `terminate`, or a duplicate-leg refusal), abandon the retry, record the real cause per AC1, and fix that path deterministically instead. The retry is the fix for the *most-likely* cause, not an unconditional prescription.
