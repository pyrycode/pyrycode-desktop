# E2E test harness

The end-to-end harness that launches the **built** Electron app and drives its renderer window with Playwright, so UI-level scenarios (pairing, send, stream) can be asserted against the real assembled app instead of only unit-testing pieces in isolation.

Introduced in [#40](../codebase/40.md). Everything lives under the top-level `e2e/` directory — outside every `src/` unit glob — plus `playwright.config.ts` at the repo root. This ticket ships **scaffolding only**: the config, one reusable launch fixture, and a single smoke assertion. The actual UI scenarios are follow-ups that reuse the fixture.

## What it does

Runs the whole app as a user would get it: `npm run e2e` builds (`npm run build`) then launches the compiled app from `out/main/index.js`, waits for the main window, and asserts the app shell rendered in real Electron DOM. It is a test-side process supervisor — no app source changes, no new runtime code. The smoke test proves the app boots and the [app-shell router](app-shell.md) routes a genuinely unpaired launch to the PairingScreen (`.pairing` visible) — see [#105](../codebase/105.md).

Playwright's `_electron` API launches the project's **own** `electron` binary and drives the renderer over the DevTools protocol — this is a strictly different test layer from the existing vitest unit suites (`renderToStaticMarkup`, no real window). The two layers are kept two-way separate (see below).

## How it works

### The three pieces

| File | Role |
|---|---|
| `playwright.config.ts` (repo root) | `testDir: './e2e'` (Playwright scans only `e2e/`), `workers: 1` + `fullyParallel: false` (one Electron process at a time), `reporter: 'list'`, CI-gated `forbidOnly`/`retries`. No `projects`/`browserName` block — Electron launches its own binary, so a browser project would be dead config and there is **no** `npx playwright install` step. |
| `e2e/smoke.spec.ts` | The single smoke assertion: `expect(page.locator('.pairing')).toBeVisible()`, launched through its own local isolated-userData fixture (see below) — see [#105](../codebase/105.md). |

### The launch fixture (retired)

`e2e/fixtures/electronApp.ts` shipped as the original reusable primitive (`electronApp`/`page`, `args: ['.']`, no `--user-data-dir` isolation) but never gained an importer: #105 moved `smoke.spec.ts` off it onto its own isolated-userData fixture precisely because it inherited the developer's real userData, and every later scenario launches through `launchPairedApp` or `realDaemon.ts` instead (see below). **[#546](../codebase/546.md) deleted it** after confirming zero importers across 26 specs. There is no shared scenario-agnostic launch fixture today — a new scenario either drives a real fake-daemon pairing flow through `launchPairedApp`, drives a real `pyry` through `realDaemon.ts`, or forks its own minimal local fixture the way `smoke.spec.ts` does.

**Why the built renderer gets exercised** (still the governing constraint for every fixture below). `createWindow` (`src/main/index.ts:50-68`) computes `devRendererUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']`. Under `electron.launch` the app is **not packaged**, so the built-vs-dev choice hangs purely on that env var. Every launch fixture therefore launches with a copy of `process.env` that has `ELECTRON_RENDERER_URL` **deleted** — if the var leaked from a dev shell, `createWindow` would `loadURL` a non-running dev server instead of `loadFile('out/renderer/index.html')`, and the test would hang until timeout.

Build before launching and leave `out/` unchanged until Electron tests finish. A concurrent
rebuild replaces the renderer assets and can invalidate launch evidence.

### Deterministic teardown

Teardown must run on **every** exit path — success, test failure, and a failure raised after a resource (the Electron process, its `--user-data-dir`) came up but before `use()` returns. The naive shape (cleanup code placed textually after `await use(...)`) only covers the first two: Playwright's fixture lifecycle runs that code on pass and fail alike, but a setup-time throw — say `firstWindow()` rejecting — never reaches it, so the process and dir both leak. With `workers: 1`, one leaked launch then poisons every remaining spec in the run, since apps launch serially and the orphan just sits there.

The fixtures use nested `try`/`finally` so app cleanup precedes profile removal, including when
window setup fails. Both steps are best-effort and discard teardown errors without logging: a
throwing `finally` would replace the causal error and could strand the credential-bearing directory.
`realDaemon.ts` exposes `withIsolatedElectronApp(run)` so regression tests exercise the real setup
path directly. A setup `await` that never settles remains outside this guarantee: Playwright kills
the worker without unwinding, so no `finally` runs. See [the original teardown repair](../codebase/517.md).

`withIsolatedElectronApp` also owns same-profile restarts through the returned
`IsolatedElectronApp.relaunch()`. It closes the current app, waits for process exit, then launches
with the same fixture-owned directory and environment. Each replacement becomes the current app
before `firstWindow()` is awaited, so a window-setup failure still reaches cleanup. Continue through
the returned handle; stale handles and concurrent relaunch calls reject. The outer fixture closes
the active replacement before removing the profile on success or failure. `fixture-teardown-leak.spec.ts`
checks distinct processes, prior-process exit, persisted effort bytes, stale-handle rejection and
both cleanup outcomes.

Keep restarts inside this lifecycle: the launch-site guard scans live specs as well as the default
tier and permits direct Electron launches only in `desktopIsolation.ts` and `realDaemon.ts`.
An inline restart in a live spec fails that guard even when its profile reuse is otherwise correct.
The [live effort proof](composer-effort-menu.md#testing-the-default-apply-1169) exercises the shared
restart while retaining the daemon and its conversations.

### Two-way separation from the vitest unit run

`npm test` (vitest) must stay fast and headless-safe and must never collect the Playwright specs; the Playwright runner must never collect the `src/` unit files. Both directions are enforced structurally:

- **Playwright:** `testDir: './e2e'` and `testMatch: '**/*.spec.ts'` in `playwright.config.ts`.
- **Vitest:** `include: ['src/**/*.{test,spec}.{ts,tsx}', 'e2e/**/*.test.ts']` in `vitest.config.ts`. Within `e2e/`, the suffix separates pure fixture unit tests from browser specs. `fakeDaemonSetup.test.ts`, for example, runs a local HTTP server without launching Electron.

### Desktop isolation (default-tier launches)

Every default-tier launch used to show and focus its window (`createWindow`'s `ready-to-show → show()`), 49 times per `workers: 1` run — a state Chromium backgrounds and throttles the moment the operator clicks away. That was traced, in [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067), to a one-spec-per-run flake at `pairingArrival.ts`'s fingerprint-card wait: the step is a synchronous BLAKE2s hash with no socket in it, so a 5000ms miss meant the renderer was stopped, not slow — and the fix is isolating the tier from the operator's desktop, not raising that wait's timeout.

Both launch sites — `launchPairedApp.ts` and `smoke.spec.ts` — now go through one shared, side-effect-free module, **`e2e/fixtures/desktopIsolation.ts`** (the `pairingArrival.ts` convention: no `base.extend`, so importing it drags no second fixture extension into a spec). `launchIsolatedApp({ args, env })` replaces `electron.launch` at both sites and applies two levers together, because neither alone is sufficient: three Chromium renderer-throttling switches (`RENDERER_THROTTLING_SWITCHES` — `disable-renderer-backgrounding`, `disable-backgrounding-occluded-windows`, `disable-background-timer-throttling`) appended to `args`, and the [window-presentation dev affordance](window-presentation-affordance.md)'s `HIDDEN_WINDOW_ENV_FLAG` set to `'1'` on `env` — a hidden window is still an occluded one, so hiding it without the switches would earn back exactly the throttling this exists to remove. `readDesktopIsolation(app)` reads the isolation back **from inside the launched app** (`app.commandLine.hasSwitch`, `BrowserWindow.getAllWindows()` filtered on `isVisible()`) rather than matching fixture source text, and `expectDesktopIsolated(app)` asserts all three switches applied, at least one window exists, and none is visible.

`e2e/desktop-isolation.spec.ts` is the cover: one test drives the full pairing arrival through `launchPairedApp` and asserts the isolation held for the whole drive; a second reads the isolation back directly; a third walks every `.ts` file under `e2e/` and asserts the set of files calling `electron.launch(` is exactly `{fixtures/desktopIsolation.ts, fixtures/realDaemon.ts}` — the deterministic guard against a future launch site skipping the shared module the way `electronApp.ts` (above) died of being optional. `smoke.spec.ts` gained its own `expectDesktopIsolated` assertion for the same reason, since it is the tier's other launch site.

`e2e/fixtures/realDaemon.ts` and `e2e/fixtures/pairingArrival.ts` are deliberately untouched — the `real-*` tier is operator-supervised by nature, and this ticket is provable without a live daemon.

### Two-server launches

[#1091](https://github.com/pyrycode/pyrycode-desktop/issues/1091) gave `launchPairedApp` an opt-in
second fake daemon, so a spec can prove per-server behaviour — the tier the sidebar grouping (#1070),
the unpair-scoped renderer clear (#1150) and the per-server unpair (#1152) all need. Passing
`{ secondServer: {} }` as the fixture's second (`LaunchControl`) argument starts a second forwarder +
daemon *before* the launch (so the LIFO drain stays app-first: `app → daemon 2 → forwarder 2 →
daemon 1 → forwarder 1 → user-data-dir`) and, after the existing row-click and Send-enabled wait,
drives a second pairing through the real UI — Settings → "Pair another server", the new
`pairAnotherServerFromSettings` export in `pairingArrival.ts` — inside the same launch, relying on
`onPaired: () => registry.reconcile()` to dial the new record with no relaunch. `PairedApp` gained
`servers: readonly PairedServerHandle[]` (one entry by default, two when opted in); the pre-existing
top-level `daemon`/`forwarder` are unchanged and alias `servers[0]`'s, so all 54 pre-existing importers
pass with no edits.

Each daemon's default reply builder returns its own seed: `SEEDED_ROW` for the first,
`SECOND_SEEDED_ROW` for the second. After the second pairing, the fixture waits for two chat rows
within `HANDSHAKE_TIMEOUT_MS`. Since [#1363](https://github.com/pyrycode/pyrycode-desktop/issues/1363),
that second row must arrive through the [conversation-list bridge](conversation-list-store.md)'s
addressed connection request and transport reply. The old repeated unsolicited seed push hid a
missing production request; restoring it would let fixture setup pass while list loading was broken.
`createServerRouter` still refuses an unaddressed request when several connections are registered.

[`host-conversation-list.spec.ts`](../../../e2e/host-conversation-list.spec.ts) supplies a separate
`conversationStateFake` per host and counts `list_conversations` envelopes on each transport.
Initial rows require counts `[1, 1]`. After the second host goes offline, Add workspace on the first
host creates a chat and triggers its re-list, advancing counts to `[2, 1]`. The test waits for the
selected chat and workspace under the connected host before checking enabled Send for a valid
draft, absent connection warnings and the other host still offline. Neither renderer-store row
insertion nor an unsolicited list push supplies those rows: request/reply delivery is part of the
proof, not just setup for a rendering assertion.

### Launch-fate diagnostics

[#1127](https://github.com/pyrycode/pyrycode-desktop/issues/1127) closes a related gap: the tier reddens intermittently, a different spec each run, and no failure reproduces on demand — the harness knew the failing launch's exit code, signal, and liveness, and threw all three away. `launchIsolatedApp` now takes a required `fate: LaunchFateLog` (`createLaunchFateLog()`) and registers each launch itself — required, not optional, the `electronApp.ts` (#546) lesson applied early. `closeWatched(app)` replaces `app.close()` at both drain sites: liveness read before the close, exit code settled after, off a `ChildProcess` handle captured at `watch()` time (`ElectronApplication.process()` throws once `close()` tears its channel down). Each drain thunk carries a fixed-literal `TeardownStep` label; the catch stays bindingless — a close error can carry the launch argv, embedding `--user-data-dir=<path>` — so only the step name is recorded. `closeWatched` is the supported close path *for a teardown drain*, not the only way to ever close a watched app: `push-toggle-persist-relaunch.spec.ts` still closes launch 1 directly mid-test for its `SingletonLock` barrier, and the later drain's `closeWatched` on that app still reports honestly. As with #1067, no fails-on-main test for the flake itself — see `e2e/launch-fate.spec.ts`.

`attachLaunchFate` attaches the report **unconditionally**, whenever it is non-empty — not gated on the test's status. It originally returned early unless `sink.status` was in `{failed, timedOut, interrupted}`, and [#1202](https://github.com/pyrycode/pyrycode-desktop/issues/1202) found that gate is why the diagnostic didn't fire on the one red it was built for: both drain sites call `attachLaunchFate` from a *fixture epilogue*, where the test's status is not yet final. `TestInfoImpl.status` stays `'passed'` until Playwright calls `_failWithError`, and that can happen later than the epilogue in two ways this tier hits — a teardown that drains after `launchPairedApp`'s (a fixture set up before it tears down after it), and `WorkerMain.unhandledError` routing an `uncaughtException`/`unhandledRejection` to the still-open current test, which is the shape of a bare `socket hang up` with no in-spec stack frame on a worker that owns two fake sockets. Deferring the attach into a fixture that drains last would beat the first mechanism and still lose to the second, so the fix removes the status read rather than relocating it: `LaunchFateSink` narrowed from `Pick<TestInfo, 'status' | 'attach'>` to `Pick<TestInfo, 'attach'>`, so restoring the gate is a visible type edit, not a one-line condition slipped back in. The kept early return is for an empty report (no launches, no teardown failures), not for status.

Suppression on a green run did not disappear, it moved to where it was always actually enforced: Playwright's terminal reporter (`reporter: 'list'`) prints an attachment's body only from `formatFailure`, reached only for a result that carries errors, so a passing test's attachment exists in its result but is never printed — the `text/plain` content type (name not underscore-prefixed, truncated at 300 chars) is what makes it inline-readable when it is. Measured, not assumed: a green run leaves one *empty* `test-results/` directory per test that actually attaches (`TestInfo.attach` calls `outputPath()`, which `mkdirSync`s it), and Playwright wipes `test-results/` at the start of every run, so this is per-run litter with no growth. `e2e/launch-fate.spec.ts` drives the real `testInfo` throughout rather than the `recordingSink` double it used to use — that double supplied a constant `status`, substituting exactly the seam that turned out to be broken, so every one of its assertions could pass while a real red carried nothing.

### Pre-Electron fake-daemon setup failures

`launchPairedApp` awaits its fake-daemon connections before `launchIsolatedApp`.
A dial failure can therefore leave no launch-fate attachment: Electron does not
exist yet. `startFakeDaemonForTest` in `e2e/fixtures/fakeDaemonSetup.ts` translates
the exact `ws` error `Unexpected server response: 404` into the static message
`Fake daemon setup failed before Electron launch: HTTP 404`. Other failures use
`Fake daemon setup failed before Electron launch`. No caught error, cause, URL,
headers, options or payload enter the replacement diagnostic.

The helper does not retry; errors still fail the test, and existing teardown drains
the forwarder. `fakeDaemonSetup.test.ts` drives a real local HTTP 404, checks
success pass-through and verifies arbitrary-error redaction. This proves the
setup-stage classification, not the cause of the intermittent 404 seen in the
host-edit drive; that original responder remains unidentified.

### Reconnect delivery evidence

A fresh handshake does not guarantee another `list_conversations` request. A fake
that waits for that request before emitting its reconnect marker can leave a
successful reconnect unobservable. Use the fake daemon's `reconnectResendFrames`
to send a distinct frame after a new handshake, then wait for its rendered effect
before asserting status cleanup or retained rows. In
[`compaction-divider.spec.ts`](../../../e2e/compaction-divider.spec.ts),
`forwarder.dropClientLeg()` forces the supervisor to reconnect; a resent assistant
delta is the positive barrier before checking that the Compacting label is gone.
A subsequent boundary also proves delivery of the preceding repeated false frame
before the test checks the final divider count.

### Stopped-turn evidence

`e2e/stopped-turn.spec.ts` drives max-turn, context-overflow and API-error reports
through fake transport and the real decoder. It checks retained boundary rows,
conversation isolation, trailing-idle recovery retention, clearing on Compact
submission and daemon activity, disabled Compact, `/compact` dispatch without
draft loss, and billing/auth guidance. The priority scenario injects connection
failures at the typed IPC boundary and checks re-pair/error precedence over
recovery, and recovery over usage. At 800px it measures status/thread containment
and verifies long stop labels stay on one line with truncation.

The decoder unit tests cover live/history compatibility and UTF-8 bounds; the
renderer/reducer tests cover wording, cancellation, escaping, tool-stack joins and
history rows without recovery. Together these prove Desktop rendering and existing
command dispatch. They do not prove successful compaction by a live Claude.
Reported API categories have synthesized upstream contract evidence, not live
captures establishing the account's state. See [stopped records](conversation-shell-timeline-render.md#stopped-turn-records)
and [recovery](conversation-shell-composer-status.md#stopped-turn-recovery).

### Tolerating a transient inspection-context loss on reads

`app.evaluate` can raise Playwright's `Execution context was destroyed, most likely because of a
navigation.` while the launched app is demonstrably alive — a `launch-fate` attachment on an observed
failure reported `runningAtOutcome: true`, `exitCode: 0`, no teardown failures. `retries` is `0` off
CI, so one such read turns a green branch red with no `flaky` line.
[#1380](https://github.com/pyrycode/pyrycode-desktop/issues/1380) hit this first, in
`pairing-authentication.spec.ts`'s `readAuthentication` (see [pairing input
screen](pairing-input-screen.md#edge-cases-and-limitations)), and tolerated the exact message on
**reads only**: a mutation must never be replayed — a retried `app.evaluate` that installs a counting
wrapper would wrap the wrapper, and a retried click or pushed frame would double the thing under test.

[#1502](https://github.com/pyrycode/pyrycode-desktop/issues/1502) lifted that rule into a shared
module once a second site hit the identical race. `e2e/fixtures/mainProcessRead.ts` exports
`readMainProcess(app, read)`: it returns what `read` produced, or the sentinel `NOT_YET_AVAILABLE`
when the raised error's message contains `Execution context was destroyed`; any other error,
including a non-`Error` throw, rethrows unchanged and at once. `app` is typed as a one-method
structural evaluator rather than `ElectronApplication`, so `mainProcessRead.test.ts` (vitest, the
`daemonCapabilityGate.ts`/`.test.ts` shape) drives every branch — a completed value including a falsy
`0`, the tolerated message, and a fatal error — with a plain stub, since the race itself does not
reproduce on demand. Bounding the retry stays the caller's job and visible at the call site:
`chat-history-recording.spec.ts`'s confirmed-deletion counter reads pass `{ timeout: 5_000 }`, the
bound #1380 used, so a genuinely dead app still fails inside five seconds instead of waiting out the
test timeout.

`sidebar-add-workspace.spec.ts` also uses `readMainProcess` for the naming-retry
`workspaceAttempts[1]` read. Its five-second poll requires a nonempty string and
retains the successful attempt ID for the foreign/stale-result assertions, avoiding
a second unguarded read. A one-shot injected context-loss error must recover through
a real Electron read; listener installation, clicks and pushed events are never replayed.

`readAuthentication` keeps its own private copy of the same tolerance.

## Configuration and usage

- **Run the suite:** `npm run e2e` = `npm run build && playwright test`. The build is chained so e2e never runs against a stale `out/` — a silently-stale build is a worse failure than a slower run.
- **Precondition when bypassing the script:** running `npx playwright test` directly against a clean tree fails fast with Electron's "Unable to find application" (there is no `out/`). The sanctioned entrypoint is `npm run e2e`.
- **Add a scenario:** create `e2e/<name>.spec.ts`. A scenario that needs **per-run env or state isolation** (extra `env`, an isolated `--user-data-dir` — true of every scenario today, since the unisolated `electronApp.ts` primitive was retired by #546) either drives a real fake-daemon pairing flow — in which case it imports the shared **`launchPairedApp`** fixture (`e2e/fixtures/launchPairedApp.ts`, [#433](../codebase/433.md)) rather than forking its own harness — or drives a real `pyry` through the shared **`realDaemon.ts`** fixture ([#420](../codebase/420.md)) — or, if neither fits, declares its **own** local `test.extend` in-file re-implementing only the hardening moves it needs (`args: ['.']`, strip `ELECTRON_RENDERER_URL`, isolate `--user-data-dir`) — see [smoke.spec.ts](../codebase/105.md) (#105), which forked the same shape stripped to the minimum smoke needs (no fake relay/daemon, no pairing env flags). Whichever launch path, teardown must reap the app and its dir on every raised exit path, not only after `use()` returns — see [Deterministic teardown](#deterministic-teardown) and [#517](../codebase/517.md).
- **Need two paired servers?** Pass `{ secondServer: {} }` (or a populated `LaunchPairedAppOptions` to script its replies) as `launchPairedApp`'s second argument instead of forking a second harness — see [Two-server launches](#two-server-launches) above and `e2e/multi-server-launch.spec.ts` for a worked example.
- **Dependency:** `@playwright/test` (dev-only). `@playwright/test` re-exports the core `_electron` API, so no separate `playwright` import is needed.
- **Artifacts:** `test-results/` and `playwright-report/` are git-ignored (Playwright creates `test-results/` even on a passing run).

## Edge cases and limitations

- **Not type-checked.** `npm run typecheck` is scoped to `src/` (via `tsconfig.node.json` / `tsconfig.web.json`); `e2e/` and `playwright.config.ts` are transpiled by Playwright at run time, not by `tsc`. Acceptable for scaffolding; a follow-up could add an `e2e/tsconfig.json` if type errors there start biting. **A concrete cost of this gap:** [#1199](https://github.com/pyrycode/pyrycode-desktop/issues/1199) landed `hostLabel` on `launchPairedApp`'s wrong argument (`LaunchPairedAppOptions`, the first, daemon-reply knobs — vs. `LaunchControl`, the second, everything named above). Esbuild's transpile-only run has no excess-property check, so the misplaced property was silently dropped, the spec's premise (a name typed into the pairing form) never happened, and every assertion that didn't read that specific value still passed. The failing assertion was the *only* evidence the setup had happened, and it was also the thing the broken setup made fail — so it could never have discriminated between "the feature is broken" and "the drive never ran" — and a since-withdrawn bug report was filed against the wrong layer before an ad-hoc `tsc --noEmit` over the spec file caught it. That one-command check is cheap enough to run on any new-scenario PR that adds a `LaunchControl`/`LaunchPairedAppOptions` property; it is not run automatically anywhere in this tier.
- **No CI today.** Electron e2e on headless Linux will need `xvfb-run`. macOS (current dev env) no longer runs plain headful: since [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067) every default-tier launch's window is never shown and its renderer is exempted from occlusion/backgrounding throttling — see [Desktop isolation](#desktop-isolation-default-tier-launches) above — which is what keeps a `workers: 1` run from being disturbed by the operator using the machine mid-run. The `forbidOnly`/`retries` knobs are CI-gated and harmless until then.
- **No `e2e:fast` variant.** Re-building on every run is accepted; a build-skipping variant is deferred until iteration pain is actually observed.
- **Every UI scenario, in order, lives in its own document.** [E2E test harness — scenario history](e2e-harness-scenarios.md) is the chronological log of every scenario and fixture extension built on this harness — #93/#94's first pairing+send drive through [#1091](https://github.com/pyrycode/pyrycode-desktop/issues/1091)'s two-fake-daemon launch — split out because this document sits at `check:docs`'s 50000-byte cap and that log was most of its bulk.

## Related

- [E2E test harness — scenario history](e2e-harness-scenarios.md) — the full chronological log this document was split from; every entry above from #93 onward has its detail there.
- Spec: `docs/specs/architecture/1091-launch-against-two-fake-daemons.md` — the original two-daemon design and its historical seed-push workaround. [Host-addressed conversation list lifecycle](../../specs/architecture/1363-host-conversation-list.md) replaces that workaround with request-driven rows.
- Spec: `docs/specs/architecture/1127-launch-fate-diagnostic.md` — the launch-fate diagnostic design and its `ChildProcess`-capture-at-`watch()`-time revision.
- [Window-presentation dev affordance](window-presentation-affordance.md) / [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067) — the third `isPackaged`-false-first dev-only gate, letting a non-packaged build keep its window unshown; consumed by `desktopIsolation.ts` above.
- [App shell (router)](app-shell.md) / [#80](../codebase/80.md) — `routeForStatus`, whose unpaired outcome the smoke test now asserts (`.pairing`).
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the shell the UI scenarios ([#93](../codebase/93.md), [#94](../codebase/94.md)) drive to after pairing; no longer what smoke asserts at boot.
- [#40 codebase notes](../codebase/40.md) · Spec: `docs/specs/architecture/40-e2e-electron-harness.md`
- [#105 codebase notes](../codebase/105.md) — made `smoke.spec.ts` hermetic on an unpaired boot (isolated `--user-data-dir` + `.pairing` assertion).
- [#433 codebase notes](../codebase/433.md) — extracted `launchPairedApp`, the shared fake-daemon pairing fixture both #93 and #94 now import; the intended home for future fake-daemon UI scenarios.
- [#435 codebase notes](../codebase/435.md) — repaired the list→thread drive #433 later extracted.
- [#420 codebase notes](../codebase/420.md) — extracted `e2e/fixtures/realDaemon.ts`, the real-stack sibling of `launchPairedApp.ts`, from `real-claude.spec.ts`; the intended home for future real-* scenarios.
- [#439 codebase notes](../codebase/439.md) / [Real-daemon credential-light e2e](real-daemon-credential-light-e2e.md) — added the claude-less spawn mode to `realDaemon.ts` and the first credential-light real-* scenario.
- [#434 codebase notes](../codebase/434.md) — `conversationStateFake`, the stateful fake-daemon sibling of `realDaemon.ts`'s credential-light mode; holds and mutates a conversation list across a real UI drive for the #422–#429 per-flow family.
- [#451 codebase notes](../codebase/451.md) — first `conversationStateFake`-riding per-flow scenario: FAB create-nav, the Channel-info sheet rename entry point, and the grown two-row Channel List.
- [#452 codebase notes](../codebase/452.md) — #451's independent sibling: the destructive archive → restore → delete lifecycle, fake-stack twin of [#440](../codebase/440.md).
- [#423 codebase notes](../codebase/423.md) — the third #422-family sibling: the save-as-channel promote dialog's scratch/dedicated branches; the two-block shape and captured-envelope compose-over idiom [#456](../codebase/456.md) reuses.
- [#456 codebase notes](../codebase/456.md) — the Workspace Picker sheet's recent-pick + create-folder round-trips; adds the shared `recent_workspaces` fake answer split sibling #457 reuses.
- [Conversation workspace change](conversation-workspace-change.md) / [#379 codebase notes](../codebase/379.md) — the `change_workspace` transport slice [#456](../codebase/456.md) drives and asserts on the wire, since its reply has no DOM reflection.
- [Recent-workspaces store](recent-workspaces-store.md) / [#382 codebase notes](../codebase/382.md) — the renderer store + bridge [#456](../codebase/456.md) exercises end-to-end via the picker's `recent_workspaces` request.
- [#425 codebase notes](../codebase/425.md) — the run-config sheet's model/effort/YOLO round-trip; the spec-local capturing-fake precedent applied to `set_session_settings`, plus the session-id + snapshot preconditions any future run-config scenario needs.
- [#457 codebase notes](../codebase/457.md) — the default-workspace preference reaching `create_conversation`'s `cwd`; the split twin of [#456](../codebase/456.md), reusing its shared `recent_workspaces` fake answer with a zero-verb-handling capturing wrapper and the race-free negative-guard-after-positive-poll pattern.
- [Default workspace store](default-workspace-store.md) / [#403 codebase notes](../codebase/403.md) — the `localStorage`-backed store [#457](../codebase/457.md) is the first e2e to drive.
- [#426 codebase notes](../codebase/426.md) — the permission/trust modal's five answer paths (default tap, confirm/Back, cancel, reject banner, remote dismiss); the FIFO-not-`in_reply_to` reject model that forces the two-block split.
- [#427 codebase notes](../codebase/427.md) — the queued-backlog render, dequeue, and interrupt flows, all server-push-driven; establishes why a flow does NOT need #423/#426's two-block split (no one-way residue) and the two-part act/capture/push-reflect assertion shape for non-optimistic push-reflected mutations.
- [#428 codebase notes](../codebase/428.md) — the stall indicator, screen snapshot, and debug-bundle download; the last of the reliability-affordance surfaces, covering a server push, a request→reply, and a chunked reply stream in a single launch.
- [#465 codebase notes](../codebase/465.md) — the paired region's inner navigation: the pair-another-server round-trip and the thread/settings/archive back-chain, plus the Cancel→Settings round-trip as the only realizable teardown proof when two routes render the same component.
- [#466 codebase notes](../codebase/466.md) — the push-notification toggle's relaunch persistence; the first two-launch scenario in the family, and the `reuseUserDataDir` fixture affordance (dir-reuse + drive-skip as one flag) it added to `launchPairedApp`.
- [#515 codebase notes](../codebase/515.md) — closed Gap A (`shouldRefreshList` now covers `conversationCreated`); zero e2e assertion changes, comment-only reconciliation across #440/#451/#452.
- [#546 codebase notes](../codebase/546.md) — deleted the retired `electronApp.ts` fixture (zero importers).
- [#517 codebase notes](../codebase/517.md) — closed the teardown-on-setup-failure leak in `realDaemon.ts`'s `page`/`relay` and `smoke.spec.ts`'s local `page`; added `withIsolatedElectronApp`.
- [#661 codebase notes](../codebase/661.md) — extracted `e2e/fixtures/pairingArrival.ts`, the shared
  unpaired-launch pairing-arrival step all ten drive sites (the fixture + nine `real-*` specs) now call;
  the one-line edit point #662 needs to change the unpaired entry point.
- [Push-notification preference store](push-notification-preference-store.md) / [#408 codebase notes](../codebase/408.md) — the `pyry.pushNotificationsEnabled` `localStorage` contract [#466](../codebase/466.md) is the first e2e to prove survives a full app relaunch.
- [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md) — Electron + electron-vite emitting `out/main` · `out/renderer`, the layout the launch target depends on.
- Cross-project prior art: pyrycode `#68` shipped the same spawn+cleanup harness-primitive + one-smoke shape (Go, `internal/e2e/`), with UI scenarios as separate tickets. This mirrors that shape in TypeScript/Playwright.
