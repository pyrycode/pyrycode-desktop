# #1127 — Record the launched Electron process's fate on a failing fake-tier spec

## Files read

Codegraph is not initialized in this repo (`mcp__codegraph__codegraph_*` returns "CodeGraph not
initialized"), so this reading list came from Grep/Read over `e2e/` and the package overview rather
than from `codegraph_context`. Noted as a gap, not a shortcut.

- `e2e/fixtures/desktopIsolation.ts` → `launchIsolatedApp`, `RENDERER_THROTTLING_SWITCHES`,
  `readDesktopIsolation`, `expectDesktopIsolated` — the tier's single launch chokepoint and the module
  this ticket extends. Its header states the two properties this ticket must not break: the module is
  plain and side-effect-free (no `base.extend`), and its SECRET HYGIENE contract reports `hasSwitch`
  booleans and counts, never `process.argv`.
- `e2e/fixtures/launchPairedApp.ts` → the `launchPairedApp` factory fixture and its LIFO teardown drain
  — the first of the two sites, home of the `catch {}` AC2 names. Its drain order (app → daemon →
  forwarder → `rm`) and its "each thunk is best-effort so one failure doesn't abort the rest" contract
  are both load-bearing and survive unchanged.
- `e2e/smoke.spec.ts` → the local `launched` fixture — the second site, with two more `catch {}`. Its
  comment states the reason they are silent: *"a close error can carry the launch argv, which embeds
  `--user-data-dir=<path>`"*. That is the constraint AC3 encodes.
- `e2e/fixture-teardown-leak.spec.ts` → `isAlive`, `waitForDeath` and the whole test — the pattern AC4's
  spec follows (drive the extracted body directly, force a throw, assert post-state) and the precedent
  for booleans-only assertions over a launched process.
- `e2e/desktop-isolation.spec.ts` → the third test, `every default-tier Electron launch goes through the
  shared module` — the repo's established shape for a *source* guard that catches a site which skips a
  shared module, which no in-app read-back can see.
- `playwright.config.ts` → `testIgnore` (`real-*` partition), `workers: 1`, `retries` — confirms the new
  spec runs in the default tier and that a leaked process poisons the rest of a run.
- `node_modules/playwright/lib/runner/index.js`, the failure-formatting block → **the terminal only
  prints an attachment inline when its `contentType` starts with `text/` and it carries an in-memory
  `body`, and it truncates that body at 300 characters.** This is why the diagnostic is `text/plain`
  JSON and why its size is bounded by construction. An `application/json` attachment would be silently
  invisible in the `reporter: 'list'` output the operator actually reads.
- `node_modules/playwright/types/test.d.ts` → `TestInfo.attach` (`body` and `path` are mutually
  exclusive; a `body` attachment is held in memory, no filesystem write) and
  `TestInfo.status?: "passed"|"failed"|"timedOut"|"skipped"|"interrupted"`.
- `docs/knowledge/features/e2e-harness.md` § Desktop isolation, § Deterministic teardown, and the
  #1067 entry → the harness lessons that shape this design: #546 (a shared launch primitive that was
  optional drifted to zero importers and died), #517 (a throwing `finally` replaces the causal error and
  aborts the unwind), and #1067's own conclusion that the tier has no fails-on-main repro for a flake of
  this shape.
- `docs/knowledge/features/window-presentation-affordance.md` (skimmed) → `HIDDEN_WINDOW_ENV_FLAG`, the
  env flag `launchIsolatedApp` sets; untouched here.

## Design source

**Figma:** N/A — this ticket touches only the Playwright harness under `e2e/`. Nothing renders, no
component or token changes, and no user-visible surface moves. The visual-fidelity check is
intentionally not applicable.

## Context

The fake-transport tier (`npm run e2e`) reddens intermittently, on a different spec each run, and one
observed failure landed on an untouched merge-base. Every such red costs a verifier baseline run to
prove innocent, and neither observed failure reproduces on demand.

#1067 already spent one guess at the cause of a flake with this exact shape and fixed a real one
(renderer throttling). The two failures that motivated this ticket are post-#1067 and carry different
signatures, so guessing again is the move that has already been made once.

This ticket therefore buys **evidence, not a cure**. The harness already holds three facts about a
failing launch and throws all three away:

1. Nothing reads the launched process's exit code or terminating signal, so `socket hang up` cannot be
   told apart from an OOM kill, a crash, or a clean early exit.
2. Nothing records whether the app was still alive when the test failed, so the 1.0m timeout cannot be
   told apart from "app dead" vs "app alive but wedged".
3. Teardown failures are swallowed by bindingless `catch {}`, so an `app.close()` that failed — which
   under `workers: 1` leaks an Electron process into the next spec's launch — leaves no trace at all.

Capturing those three turns each of the ticket's filed candidate causes into something readable off a
single failing run.

No ADR is warranted: this adds a diagnostic to an existing test fixture and decides nothing about
product architecture.

## Design

### Module placement

Everything new lives in `e2e/fixtures/desktopIsolation.ts`, and it stays a **plain, side-effect-free
module** — no `base.extend`, no module-level mutable state. The log is a value the caller creates and
owns, so two concurrently-alive fixtures could not share one even if `workers: 1` ever changed.

The *attaching* needs `testInfo`, so it is a function that takes the sink; each site's teardown
epilogue calls it. Nothing under `src/` changes.

### The launch log

```ts
export type LaunchFate = {
  runningAtOutcome: boolean | null   // null = its close was never reached
  exitCode: number | null
  signal: string | null              // a POSIX name from Node's closed NodeJS.Signals set
}
export type TeardownStep = 'app' | 'daemon' | 'forwarder' | 'user-data-dir'
export type LaunchFateReport = { launches: LaunchFate[]; teardownFailures: TeardownStep[] }
```

`LaunchFateLog` (created by `createLaunchFateLog()`) carries four members:

- `watch(app)` — registers a launch. Called by `launchIsolatedApp`, never by a site.
- `closeWatched(app)` — the only supported way to close a watched app. Observes liveness **first**,
  then `await app.close()`, then waits (bounded) for Node to record the exit. Propagates a close
  failure to the caller, so the site's existing `catch` shape is unchanged.
- `recordTeardownFailure(step)` — the body a site's bindingless `catch` gains.
- `report()` — the `LaunchFateReport`, read after the drain.

**Why `closeWatched` rather than a separate `observe()` step.** AC1's three facts have a strict
ordering: liveness has to be read before the close and the exit code only settles after it. A separate
`observe()` would be a call a future edit can move or drop with nothing to notice. Folding the ordering
into the one call that replaces `app.close()` makes it unforgettable at both sites — the site writes
one call where it already wrote one.

**Why `launchIsolatedApp` takes the log as a required option.** `e2e/` is outside both tsconfigs and
Playwright strips types with esbuild, so a type alone guarantees nothing at runtime. Making the option
required means a future third launch site that omits it fails loudly at its first launch rather than
silently recording nothing — the failure mode that killed `electronApp.ts` (#546) and that #1067 needed
a source guard to close. The existing `electron.launch(` source guard in `desktop-isolation.spec.ts`
already funnels every new site through `launchIsolatedApp`; registration is unconditional once there.

**Liveness reads Node's `ChildProcess` record, not a `process.kill(pid, 0)` probe.** `app.process()`
already exposes `exitCode` and `signalCode`, and `exitCode === null && signalCode === null` is exactly
"Node has not seen this process exit". It needs no pid, no syscall, and it is the same object the three
reported facts come from, so the triple is one consistent snapshot. Its one weakness — a process that
died microseconds before the read, whose `'exit'` has not been delivered — is self-correcting for a
reader, because the post-drain `exitCode`/`signal` then contradict it. `fixture-teardown-leak.spec.ts`'s
`isAlive` probe is deliberately **not** reused or lifted: it answers a different question (did teardown
reap a pid) in a spec this ticket does not touch, and moving it would be adjacent refactoring.

**The exit wait.** `app.close()` resolving does not guarantee Node has recorded the exit in the same
tick, and a `null` exit code that means "not yet recorded" would read as "never exited" — a misleading
diagnostic is worse than an absent one. `closeWatched` therefore waits, after the close, for the record
to settle: it returns immediately when `exitCode`/`signalCode` are already set, otherwise races the
`'exit'` event against a short bounded timer whose handle is cleared. Only reached during teardown.

### Attaching

```ts
export type LaunchFateSink = Pick<TestInfo, 'status' | 'attach'>
export function attachLaunchFate(sink: LaunchFateSink, log: LaunchFateLog): Promise<void>
```

- Attaches only when `sink.status` is one of `failed` / `timedOut` / `interrupted`, and only when the
  log holds at least one launch or one teardown failure. A passing or skipped test therefore carries
  no attachment at all, so a green run's output and its report are byte-identical to today's (AC1).
- One attachment, fixed name `LAUNCH_FATE_ATTACHMENT` (`'launch-fate'`), `contentType: 'text/plain'`,
  body = `JSON.stringify(report())`. The content type is not cosmetic: the terminal reporter prints an
  attachment body inline only for `text/*`, and skips names beginning with `_`.
- The parameter is `Pick<TestInfo, …>`, not `TestInfo`, so AC4's spec can drive the real function with a
  recording double and read back exactly what a failing run would carry.

**Placement at the sites.** The call is the last statement of each epilogue, after the drain. It
performs no filesystem I/O — `attach` with a `body` keeps the payload in memory — so it does not
reintroduce the #517 hazard of a throwing `finally` replacing the causal error.

### Secret hygiene (AC3)

Three independent structural guarantees, none of them a discipline someone has to remember:

1. **The report is built from primitives only.** Booleans, integers, `null`, and a POSIX signal name.
   No path, no argv entry, no env value is in scope at the point the body is serialized.
2. **Every `catch` stays bindingless.** `catch {` with no binding means the error object — which is
   what can carry the launch argv and therefore `--user-data-dir=<path>` — is not reachable from the
   recording code. This is why the diagnostic names the *step* and never the message.
3. **The step label is a closed union of fixed literals** declared beside the log, so the only strings
   that can reach the body are ones written in this repo's source.

`desktopIsolation.ts`'s existing SECRET HYGIENE contract (`hasSwitch` booleans and counts, never
`process.argv`) holds unchanged; this extends it to a second report on the same module.

### Data flow

```
launchIsolatedApp({args, env, fate})  →  fate.watch(app)          [registration, at launch]
        …test runs…
fate.closeWatched(app)                →  liveness read, close, exit settles   [drain, per app]
catch { fate.recordTeardownFailure(step) }                        [drain, per step]
attachLaunchFate(testInfo, fate)      →  one text/plain attachment on failure [epilogue]
```

## State + concurrency model

The log is per-fixture-instance state, created inside the fixture body and dropped when the fixture
tears down; nothing is module-scoped, so no state crosses tests. A `Map<ElectronApplication, …>` keyed
by identity holds the per-launch records, which is what lets the relaunch-persistence spec's two
launches each get their own fate rather than the second stamping the first.

The only asynchronous work added is the bounded post-close exit wait. It owns one `'exit'` listener and
one timer, and clears both on whichever settles first, so it leaves no listener or handle behind. It
runs only inside teardown, and only after `app.close()` has already resolved.

Ordering constraints, all owned by `closeWatched` rather than by the call sites: liveness before close,
exit code after it.

## Error handling

- `closeWatched` **propagates** a close failure. The site's existing `try/catch` shape then records the
  step, which keeps the recording uniform across all four drain steps instead of splitting it between
  the log and the loop.
- The drain stays best-effort: one failing step must not abort the rest of the LIFO drain (AC2). The
  loop shape is unchanged; only the catch body goes from empty to one synchronous array push, which
  cannot throw.
- A launch whose close is never reached reports `runningAtOutcome: null`. That is deliberately not
  coerced to a boolean — "the drain never got here" is a distinct and diagnostic outcome.
- `attachLaunchFate` does not swallow. It has no failure path of its own: it serializes primitives and
  hands them to an in-memory attachment.

## Testing strategy

Vitest is not applicable — `vitest.config.ts` includes only `src/**`, and nothing under `src/` changes.
All coverage is Playwright, in the **default** tier: the new spec launches the built app through
`launchIsolatedApp` and needs no `pyry`, no `claude`, and no credential (AC4). It is not named `real-*`,
so `playwright.config.ts`'s `testIgnore` leaves it in the default run.

New spec `e2e/launch-fate.spec.ts`, following `fixture-teardown-leak.spec.ts`: drive the extracted
functions directly and force the failure, rather than nesting a Playwright run inside a test (the
cross-project lesson from pyrycode #68 — an inner test's failure propagates to the parent and ends it
before the post-state assertions run).

Scenarios:

- **A killed launch's fate is captured.** Launch, `SIGKILL` the process, await its `'exit'`, run
  `closeWatched`, read the report. Asserts `runningAtOutcome === false`, `signal === 'SIGKILL'`,
  `exitCode === null`. This is the `socket hang up` shape made deterministic; it reddens if `watch`,
  the liveness read, or the exit read is removed.
- **A live launch's fate is captured.** Launch, wait for the first window, `closeWatched`. Asserts
  `runningAtOutcome === true` and that the exit settled with no signal. This is the "app alive but
  wedged" arm — the one the 1.0m timeout needs — and it is the mutation control for the arm above.
- **The diagnostic's hygiene, on a real launch with a real `--user-data-dir`.** Attach through a
  recording sink and assert the body contains neither the launch's own dir nor any `/` at all, and that
  it stays under the reporter's 300-character inline cap with `contentType: 'text/plain'`.
- **Teardown failures are named, and only a failing test carries the diagnostic.** Record two step
  labels, attach through a `failed` sink and a `passed` sink; assert the failed sink got exactly one
  attachment whose parsed body lists both labels in drain order, and the passed sink got none.
- **A source guard**, mirroring `desktop-isolation.spec.ts`'s third test: walk every `.ts` under `e2e/`
  and assert the set of files calling `createLaunchFateLog(` equals the set calling `attachLaunchFate(`,
  excluding the defining module. This is the only check that can see a site which creates a log and then
  forgets to attach it — an in-process assertion structurally cannot.

There is deliberately **no fails-on-main test for the flake itself**, for the same reason #1067 had
none: it does not reproduce on demand. What ships is the capture, and the spec proves the capture.

Hand typecheck: no tsconfig includes `e2e/` and Playwright strips types with esbuild, so a type error in
a touched spec surfaces in no gate. The touched `e2e/` files get an ad-hoc `tsc --noEmit` pass, read by
filename (the `realDaemon.ts` / noise-chain diagnostics are known pre-existing config artefacts).

## Open questions

- Does `ElectronApplication.close()` already leave Node's `exitCode` recorded, making the bounded exit
  wait a no-op in practice? Resolve by observing the live-launch scenario: if the wait never fires, keep
  it as the documented safety net rather than deleting it, since its absence is exactly what would turn
  a real `exitCode` into a misleading `null` on a slow runner.
- Does a `SIGKILL`ed app's `app.close()` resolve or throw? Either is acceptable — the killed-launch
  scenario deliberately does not assert on `teardownFailures`, so the answer only decides a comment.

## Revisions

### 2026-09-05 — `watch` captures the `ChildProcess`; it does not re-read it

**What changed.** `watch(app)` now stores `app.process()` in the per-launch record, and both
`closeWatched` and `report()` read the stored handle. The plan implied the handle could be re-read off
the app on demand.

**Why.** `ElectronApplication.process()` reaches through a channel object that `close()` tears down, so a
read after the close throws `TypeError: Cannot read properties of undefined (reading '_object')`. Since
the exit code is by definition only readable *after* the close, a lazy read makes the diagnostic
unobtainable in exactly the case it exists for. The `ChildProcess` handle itself stays valid and keeps
reporting `exitCode` / `signalCode` long after the app is gone — capturing it early is what makes the
post-close read work at all. Caught by the live-launch scenario, which is why that scenario exists as the
mutation control for the killed one: the killed arm passed straight through the bug, because
`app.close()` on a `SIGKILL`ed app throws and never reached the broken read.

**Open questions, resolved.**

- *Is the bounded post-close exit wait a no-op in practice?* Yes on the normal path — a clean
  `closeWatched` reports `exitCode: 0` with the wait never firing. Kept as the documented safety net
  rather than deleted, per the plan: its absence is what would turn a real exit code into a misleading
  `null` on a slow runner, and the live-launch scenario's `exitCode !== null` assertion is its detector.
- *Does a `SIGKILL`ed app's `close()` resolve or throw?* It throws, which is why `closeWatched`
  propagating (rather than swallowing) matters: the site's bindingless catch records the `'app'` step and
  the drain continues. No assertion depends on it; the killed scenario deliberately does not assert on
  `teardownFailures`.

**Verified end to end**, beyond the cover spec: a temporarily broken assertion in `smoke.spec.ts`
produced, inline in the `reporter: 'list'` terminal output,
`attachment #1: launch-fate (text/plain)` followed by
`{"launches":[{"runningAtOutcome":true,"exitCode":0,"signal":null}],"teardownFailures":[]}` — 88
characters, no path, no argv — reading exactly as intended: the app was alive when the test failed and
closed cleanly, so this red was an assertion, not a dead process. The forced failure was reverted.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — nothing in this change crosses a trust boundary. The data flows
  one way, out of a test-harness process into a test report, and its entire source is
  `ChildProcess.exitCode` / `.signalCode` (Node's own bookkeeping about a process this harness spawned)
  plus string literals from this repo's source. No daemon field, no relay frame, no renderer IPC
  message, and no pairing payload is read, parsed, or forwarded. `launchIsolatedApp` keeps owning the
  args and env it is handed; the added option is a local object, never serialized.
- **[Tokens, secrets, credentials]** SHOULD FIX, addressed in the design — the launch argv embeds
  `--user-data-dir=<path>`, which is where `PYRY_TEST_SECRET_BACKEND` persists the run's pairing record,
  and an Electron close error can carry that argv (the reason `smoke.spec.ts` discards close errors
  unlogged today). A diagnostic that stringified the caught error would publish that path into every
  failure diff and into `test-results/`. The design never binds the error: every `catch` stays
  bindingless and the report names a `TeardownStep` literal instead. The proving spec asserts the
  attached body contains neither the launch's own dir nor any `/`, so this is enforced by a red test,
  not by a comment. No token, key, Noise transcript, or pairing payload is in scope at any point.
- **[File / storage operations]** No findings — no path is constructed, resolved, read, or written. The
  attachment uses `attach`'s `body` form, which is mutually exclusive with `path` and is held in memory,
  so no new file lands under `test-results/` and there is no TOCTOU and no traversal surface. The
  existing `mkdtemp` / `rm` teardown at both sites is unchanged.
- **[Inter-process / Electron attack surface]** No findings — no `webPreferences`, no `contextBridge`
  API, no `ipcMain` channel, no custom protocol, and no navigation guard is added or altered. Nothing
  under `src/` changes at all, so the app's IPC surface after this ticket is byte-identical.
  `launchIsolatedApp` still appends only the three `RENDERER_THROTTLING_SWITCHES` and still sets only
  `HIDDEN_WINDOW_ENV_FLAG`; the new option is consumed in-process and never reaches argv or env. A
  regression there would redden `desktop-isolation.spec.ts`'s in-app read-back, which asserts the
  applied switch set exactly.
- **[Cryptographic primitives]** Not applicable, and stated rather than skipped: this change introduces
  no randomness, no comparison against a secret, no key handling, and no hashing. The `SIGKILL` in the
  proving spec is a process signal, not a primitive. The Noise variant constant and the handshake are
  untouched.
- **[Network & I/O]** No findings — no socket is opened, no URL is parsed or dialled, and no frame is
  read. The only new I/O-adjacent work is one `'exit'` listener on a child process this harness already
  owns. Worth naming explicitly: the bounded exit wait is a *timeout*, not a retry, so it cannot spin.
- **[Error messages, logs, telemetry]** No findings, and this is the category the whole design turns on.
  The MUST-NOT-publish set here is the launch argv, the `--user-data-dir` path, and any environment
  value; the MUST-publish set is exit code, signal, liveness, and step label. The report is built from
  primitives only, and the two remaining channels by which a secret could reach it — an error object and
  a free-form step string — are closed structurally (bindingless catch; closed union of literals). The
  attachment lands in the Playwright report, which is git-ignored (`test-results/`,
  `playwright-report/`) and local to the operator's machine; nothing is transmitted anywhere. The
  300-character terminal cap is a display bound, not a hygiene control, and is not relied on as one.
- **[Concurrency]** No findings — the added async work is one bounded wait that owns one listener and
  one timer and clears both on either settle path, so it leaks neither. It runs inside teardown after
  `app.close()` has resolved, so it races nothing. The log is per-fixture state keyed by app identity;
  there is no shared mutable module state and therefore no check-then-act window. The drain's
  best-effort contract is preserved: the new catch body is a synchronous array push.
- **[Threat model alignment]** The desktop-specific threats do not reach this change: no relay is
  contacted (hostile or otherwise), no token is read from disk, no daemon response is parsed, and the
  renderer is not involved. The one threat that *is* in scope is an operator-local one — a failure
  diagnostic disclosing the path to the run's secret store, into a report file and a terminal an
  operator may paste into a ticket. That is what the hygiene design and its proving assertion address.
  OUT OF SCOPE and deferred by the ticket itself: root-causing the flake (a follow-up ticket once the
  diagnostic names a cause), changing `retries`, and Playwright traces/video — the last of which has its
  own secret-hygiene surface precisely because a trace captures far more than three integers.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-05
