# E2E test harness

The end-to-end harness that launches the **built** Electron app and drives its renderer window with Playwright, so UI-level scenarios (pairing, send, stream) can be asserted against the real assembled app instead of only unit-testing pieces in isolation.

The topics below cover launch ownership and teardown, transport evidence,
[desktop isolation](e2e-harness-desktop-isolation.md),
[launch diagnostics](e2e-harness-launch-fate.md),
[inspection-context recovery](e2e-harness-context-recovery.md),
[limitations](e2e-harness-limitations.md) and
[related references](e2e-harness-references.md).

## What it does

Runs the whole app as a user would get it: `npm run e2e` builds (`npm run build`) then launches the compiled app from `out/main/index.js`, waits for the main window, and asserts the app shell rendered in real Electron DOM. It is a test-side process supervisor — no app source changes, no new runtime code. The smoke test proves the app boots and the [app-shell router](app-shell.md) routes a genuinely unpaired launch to the PairingScreen (`.pairing` visible) — see [#105](../codebase/105.md).

Playwright's `_electron` API launches the project's **own** `electron` binary and drives the renderer over the DevTools protocol — this is a strictly different test layer from the existing vitest unit suites (`renderToStaticMarkup`, no real window). The two layers are kept two-way separate (see below).

## How it works

### The three pieces

| File | Role |
|---|---|
| `playwright.config.ts` (repo root) | `testDir: './e2e'` (Playwright scans only `e2e/`), several workers with `fullyParallel: false` (files spread across workers, the tests in one file stay in order), `reporter: 'list'`, CI-gated `forbidOnly`/`retries`. The worker count defaults to four, or half the cores when that is fewer, and `PW_WORKERS` overrides it; `PW_WORKERS=1` is the old serial run. Every launch owns its user-data dir, its loopback ports and its process. The OS clipboard is shared: the specs that copy or paste are listed in `CLIPBOARD_SPECS` and run in a `clipboard` project capped at one worker, beside the `parallel` project. A new spec that touches the clipboard belongs in that list. Shown windows also share native pointer input; see Desktop isolation below. There is no `browserName` — Electron launches its own binary, so there is **no** `npx playwright install` step. |
| `e2e/smoke.spec.ts` | The single smoke assertion: `expect(page.locator('.pairing')).toBeVisible()`, launched through its own local isolated-userData fixture (see below) — see [#105](../codebase/105.md). |

### The launch fixture (retired)

`e2e/fixtures/electronApp.ts` shipped as the original reusable primitive (`electronApp`/`page`, `args: ['.']`, no `--user-data-dir` isolation) but never gained an importer: #105 moved `smoke.spec.ts` off it onto its own isolated-userData fixture precisely because it inherited the developer's real userData, and every later scenario launches through `launchPairedApp` or `realDaemon.ts` instead (see below). **[#546](../codebase/546.md) deleted it** after confirming zero importers across 26 specs. There is no shared scenario-agnostic launch fixture today — a new scenario either drives a real fake-daemon pairing flow through `launchPairedApp`, drives a real `pyry` through `realDaemon.ts`, or forks its own minimal local fixture the way `smoke.spec.ts` does.

**Why the built renderer gets exercised** (still the governing constraint for every fixture below). `createWindow` (`src/main/index.ts:50-68`) computes `devRendererUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']`. Under `electron.launch` the app is **not packaged**, so the built-vs-dev choice hangs purely on that env var. Every launch fixture therefore launches with a copy of `process.env` that has `ELECTRON_RENDERER_URL` **deleted** — if the var leaked from a dev shell, `createWindow` would `loadURL` a non-running dev server instead of `loadFile('out/renderer/index.html')`, and the test would hang until timeout.

Build before launching and leave `out/` unchanged until Electron tests finish. A concurrent
rebuild replaces the renderer assets and can invalidate launch evidence.

### Deterministic teardown

Teardown must run on **every** exit path — success, test failure, and a failure raised after a resource (the Electron process, its `--user-data-dir`) came up but before `use()` returns. The naive shape (cleanup code placed textually after `await use(...)`) only covers the first two: Playwright's fixture lifecycle runs that code on pass and fail alike, but a setup-time throw — say `firstWindow()` rejecting — never reaches it, so the process and dir both leak. A leaked launch then sits there for the rest of its worker's run, competing with every later launch.

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

See [Desktop isolation (default-tier launches)](e2e-harness-desktop-isolation.md#desktop-isolation-default-tier-launches) for window presentation, renderer throttling and real-pointer observations.

Shown default-tier launches ignore the display's native pointer on current and
later windows while retaining Playwright renderer input and normal pairing.
The linked guidance covers the independent input-enabled cover, initialization
cleanup, counted acceptance and the separate unresolved Welcome stall in #1842.
Existing row regressions also re-deliver hover and observe actual `:hover` with
exact computed treatment; those local observations retain styling sensitivity.

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

See [Launch-fate diagnostics](e2e-harness-launch-fate.md#launch-fate-diagnostics) for launch liveness, exit reports and unconditional diagnostic attachments.

### Pre-Electron fake-daemon setup failures

`launchPairedApp` awaits its fake-daemon connections before `launchIsolatedApp`.
A dial failure can therefore leave no launch-fate attachment: Electron does not
exist yet. `startFakeDaemonForTest` in `e2e/fixtures/fakeDaemonSetup.ts` translates
an unrecovered error into `Fake daemon setup failed before Electron launch: <class>`,
where `<class>` comes from a private `classifySetupFailure`, never from the
original error's own text — one of a `NoiseLoadError`'s `reason` (`wasm-load-failed`
/ `wasm-load-timeout`), a `code` matched against a fixed socket-error allowlist
(`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EPIPE`, `ECONNABORTED`,
`EHOSTUNREACH`, `ENETUNREACH`, `EADDRNOTAVAIL`, `EAI_AGAIN`, `ENOTFOUND`), the
digits of a message matching exactly `Unexpected server response: NNN` (so the
original 404 case still reads `HTTP 404`), or `unclassified` for anything else —
an unrecognised `NoiseLoadError` reason, `code` or message shape included. No
caught error, cause, URL, headers, options or payload enter the replacement
diagnostic; the thrown `Error` carries no `cause`.

The helper permits one retry only for an `Error` whose exact socket `code` is
`ECONNRESET` before WebSocket open. `startFakeDaemon` frees the failed attempt's
Noise handshake and terminates its socket before rejection; no handle reaches
fixture teardown on that failure. The successor uses a fresh fake and handshake.
No client handshake, command or event has been sent at this stage, so this retry
cannot duplicate delivery. A second reset fails after two attempts. Every other
class fails immediately, including HTTP rejections and Noise loading errors;
existing teardown still drains the forwarder.

`fakeDaemonSetup.test.ts` destroys the first real loopback HTTP upgrade socket,
accepts the second and checks exactly two attempts, a usable handle and cleanup of
both handshake states, with failed-state cleanup asserted before the next state
is allocated. Stubbed tests cover reset exhaustion and immediate non-retryable
failures without exposing error contents. This proves bounded setup recovery,
not the cause of the original intermittent host-side reset, which remains
undiagnosed.

The same unit file drives a real local HTTP 404, checks
success pass-through, and asserts each classified suffix via `it.each` (both
`NoiseLoadError` reasons, two allowlisted socket codes, one non-404 HTTP status),
plus an `it.each` over unclassified inputs — including a `code` outside the
allowlist and a `cause` — that all collapse to `unclassified` with no original
text in message, `cause` or stack ([#1601](https://github.com/pyrycode/pyrycode-desktop/issues/1601)).
This proves the setup-stage classification, not the cause of the intermittent 404
seen in the host-edit drive, nor any new recurrence — a classified suffix on a
future flake only narrows which of these paths to chase; that original responder
remains unidentified.

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

Unconditional `reconnectResendFrames` prove delivery after a handshake, but cannot
prove replay negotiation. For that, use `buildReconnectFrames(hello)`, which reads
the authenticated reconnect hello and takes precedence over unconditional resends.
[`reconnect-event-replay.spec.ts`](../../../e2e/reconnect-event-replay.spec.ts)
seeds a visible prefix with `event_id: 41`, drops the client leg and releases the
missed tail only when the hello carries exactly `last_event_id: 41`. It checks the
received cursor and absent `last_seen_ts`, retained rows, once-only ordering,
subsequent live events and no additional `request_history`. Omitting or changing
the cursor must prevent tail delivery and fail the proof. Capture only replay
metadata from the hello, never its token or identity. See
[cursor lifetime and resync](daemon-connection-lifecycle.md#replay-cursor-lifetime).

Return `[]` for a nonmatching cursor. A thrown `buildReconnectFrames` callback
currently leaves the reconnect's fresh Noise handshake unfreed before it reaches
`Split()`; the fake's ordinary `close()` does not own that local handshake. This
test-only failure-path limitation remains outside the replay proof.

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

See [Tolerating a transient inspection-context loss on reads](e2e-harness-context-recovery.md#tolerating-a-transient-inspection-context-loss-on-reads) for read tolerance and confirmation before resending mutations or native setup.

## Configuration and usage

- **Run the suite:** `npm run e2e` = `npm run build && playwright test`. The build is chained so e2e never runs against a stale `out/` — a silently-stale build is a worse failure than a slower run.
- **Precondition when bypassing the script:** running `npx playwright test` directly against a clean tree fails fast with Electron's "Unable to find application" (there is no `out/`). The sanctioned entrypoint is `npm run e2e`.
- **Add a scenario:** create `e2e/<name>.spec.ts`. A scenario that needs **per-run env or state isolation** (extra `env`, an isolated `--user-data-dir` — true of every scenario today, since the unisolated `electronApp.ts` primitive was retired by #546) either drives a real fake-daemon pairing flow — in which case it imports the shared **`launchPairedApp`** fixture (`e2e/fixtures/launchPairedApp.ts`, [#433](../codebase/433.md)) rather than forking its own harness — or drives a real `pyry` through the shared **`realDaemon.ts`** fixture ([#420](../codebase/420.md)) — or, if neither fits, declares its **own** local `test.extend` in-file re-implementing only the hardening moves it needs (`args: ['.']`, strip `ELECTRON_RENDERER_URL`, isolate `--user-data-dir`) — see [smoke.spec.ts](../codebase/105.md) (#105), which forked the same shape stripped to the minimum smoke needs (no fake relay/daemon, no pairing env flags). Whichever launch path, teardown must reap the app and its dir on every raised exit path, not only after `use()` returns — see [Deterministic teardown](#deterministic-teardown) and [#517](../codebase/517.md).
- **Need two paired servers?** Pass `{ secondServer: {} }` (or a populated `LaunchPairedAppOptions` to script its replies) as `launchPairedApp`'s second argument instead of forking a second harness — see [Two-server launches](#two-server-launches) above and `e2e/multi-server-launch.spec.ts` for a worked example.
- **Dependency:** `@playwright/test` (dev-only). `@playwright/test` re-exports the core `_electron` API, so no separate `playwright` import is needed.
- **Artifacts:** `test-results/` and `playwright-report/` are git-ignored (Playwright creates `test-results/` even on a passing run).

## Edge cases and limitations

See [Edge cases and limitations](e2e-harness-limitations.md#edge-cases-and-limitations) for fixture typechecking, platform requirements and test-tier boundaries.

## Related

See [Related](e2e-harness-references.md#related) for related feature topics, architecture plans and historical fixture evidence.
