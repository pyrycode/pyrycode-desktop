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

### Launch-hook readiness

`launchPairedApp` awaits `app.firstWindow()` before invoking
`LaunchControl.onLaunched`, then awaits the hook before the fixture pairs or
activates a conversation. Production registers the saved-history IPC handler
before creating that window, so the hook can replace an existing handler before
the restored conversation's first timeline read. Installing immediately after
process launch could instead claim the channel before startup registers it and
prevent window creation; see the [startup-registration diagnosis](e2e-harness-launch-fate.md#startup-registration-failure-before-window-creation).

The restored-identity cases in
[`queued-own-settlement.spec.ts`](../../../e2e/queued-own-settlement.spec.ts)
check one discovered window, desktop isolation and an original saved-history
handler before replacement. They wait for `Saved answer` before expanding the
tool run, parent and child. Startup readiness does not acknowledge later event
processing: each update still waits for its rendered `Live update receipt barrier`
or `Older history prepend` before checking retained DOM handles, expanded state
and visible child result, in both event orders. Keep these
[positive processing barriers](development-verification-evidence-that-cannot-pass-too-early.md)
when changing setup.

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

### Scalar turn evidence

[`completedHandoverReply`](../../../e2e/fixtures/lunaHandoverProof.ts),
[`createQueueTurnEvidence`](../../../e2e/fixtures/queueTurnEvidence.ts) and
[`createCodexChannelProof`](../../../e2e/fixtures/codexChannelProof.ts) fold full
thread items and explicitly narrow patches to `thread_item_changed` or
`thread_text_append` before reading scalar revision/text fields.
`thread_tool_body` data and final replies cannot supply assistant text, fresh
handover activity, queue markers/IDs or turn completion, even when their content
resembles the expected answer or a successful terminal. The fixture regressions
cover same-epoch replies for both held and missing item IDs, incomplete evidence
staying incomplete, and completed evidence surviving later detail reads.

In the queue reducer, ignore tool detail **before** clearing `appendCompanion`.
A field change can be followed by its text suffix at the same item revision and
thread version. A detail reply between them can leave the current snapshot
unchanged while destroying the pending match and causing the legitimate suffix
to be rejected. Interleave data/final replies inside that pair, then require the
marker and a real completion. Retain the existing same-revision duplicate-suffix
rejection; broadly accepting equal revisions would weaken the evidence.

The Codex channel scenario's `observe` passes the shared collector's `record` to
its exposed callback and retains subscription/stop ownership. Its unit tests use
that same reducer. The collector retains settings/models/acknowledgements/created
projections and host/chat/epoch-qualified item facts used by `deltas` and `ends`.
Keep the revision, ownership and completion assertions alongside the exclusions;
ignoring every event would otherwise satisfy an unchanged-snapshot check.
See [counted Linux validation and replay limits](development-verification-what-each-test-tier-proves.md#scalar-client-evidence-validation)
and the [fixture typechecking boundary](e2e-harness-limitations.md#edge-cases-and-limitations).

### Desktop isolation (default-tier launches)

See [Desktop isolation (default-tier launches)](e2e-harness-desktop-isolation.md#desktop-isolation-default-tier-launches) for window presentation, renderer throttling and real-pointer observations.

Shown default-tier launches ignore the display's native pointer on current and
later windows while retaining Playwright renderer input and normal pairing.
The linked guidance covers the independent input-enabled cover, initialization
cleanup, counted acceptance and the separate unresolved Welcome stall.
Existing row regressions also re-deliver hover and observe actual `:hover` with
exact computed treatment; those local observations retain styling sensitivity.

### Scripted and native thread fixtures

For authored facts, select `{ threadMode: 'canonical', thread }` with one
`createCanonicalThread` per host; see the
[canonical publisher contract](development-verification.md#source-and-contract-checks).
[`queued-backlog-interrupt.spec.ts`](../../../e2e/queued-backlog-interrupt.spec.ts)
and [`queued-send-now.spec.ts`](../../../e2e/queued-send-now.spec.ts) use this route
for all three mounted cases. They observe actual `thread_catch_up` requests and
rendered content, with no `request_history` alias. Author summary/current-session
binding, item sessions, epoch, unique orders, advancing versions and exact-base
revisions. The publisher supplies correlated query data and separate final
certificates; it does not infer acceptance from composer sends or assistant activity.
Correlated session-settings replies retain `mid_turn_input`, context reading and
explicit session provenance; live turn controls name the owning conversation.

For an own send, capture its outbound `message_id` and obtain the authenticated
public identity through `window.pyry.deviceIdentity()`. Supply both on the accepted
`user_message`; keep the item ID distinct from `content.queued_msg_id`. Drop waits
for a hidden dropped revision, and Send now waits for a delivered revision of the
same item. Backlog coverage keeps the delivered row and two distinct queued rows
inside the thread, including an unmatched message, with one row per message and
no separate queue region. Dropping one preserves both unrelated rows.
Capturing either command is a barrier for checking that the queued row
and actions remain. After repeated delivery, observe the subsequent assistant
content before asserting uniqueness. For interrupt, observe accepted/rendered
local sends before the idle baseline: idle alone cannot settle an unaccepted send.
Thinking mounts both Stop and the running indicator; the captured interrupt leaves
both mounted until daemon idle. Geometry, opacity, wrapping, isolated hover and
keyboard focus remain checked at 800 and 1280. See
[counted Linux validation](development-verification-replay-validation.md#canonical-queue-action-validation).

`launchPairedApp` defaults to `threadMode: 'scripted'`. Its test-only publisher in
`e2e/fixtures/scriptedThread.ts` translates event scripts into daemon-authored
items, appends, revisions, session readings and certified query replies. It never
runs the retired renderer reducer. Each fake host owns independent conversation
epochs, versions, queue handles and session state. Own-send identity comes from
the authenticated fake connection; foreign message-ID collisions stay foreign.

`threadMode: 'native'` preserves exact wire scripts, including unanswered queries
and deliberate old-daemon handshakes. Native thread, activation and frame tests use
it. Scripted compatibility aliases for `request_history` are test inputs only;
the assembled app sends `thread_catch_up` and `thread_page`. Tests of outbound
protocol must observe the actual request rather than count the alias invocation.

[`live-user-receipts.spec.ts`](../../../e2e/live-user-receipts.spec.ts) uses native
mode with explicit canonical publisher composition. Delegate valid pushes to
`thread.publish` and query replies to `thread.reply`, retaining correlated data
and separate final certificates. Deliver repeated and conflicting full items
directly: automatic canonical interception rejects duplicate authoring before
the app sees it, while the compatibility adapter can swallow conflicts and
substitute locally sent text. Keep publisher validation intact. Advance delivery
versions while holding equal/older item revisions, so the controls exercise held
content protection rather than stale-envelope rejection. Restore the publisher's
known authoritative facts and current version with `setConversation` before
publishing the later assistant processing marker. See the
[receipt assertions](development-verification-evidence-that-cannot-pass-too-early.md#evidence-that-cannot-pass-too-early)
and [counted Linux validation](development-verification-replay-validation.md#canonical-receipt-validation).

Compatibility remains available to unmigrated siblings; eventual fixture removal
belongs to [#2246](https://github.com/pyrycode/pyrycode-desktop/issues/2246).
The queue migration is one slice of
[#2211](https://github.com/pyrycode/pyrycode-desktop/issues/2211)'s full acceptance;
the separate status and paging repairs remain with #2153 and #2191.

History responses are split into bounded item batches and end with a separate
completion marker. The default empty-thread wait must complete before a spec
pushes live content. Otherwise initial recovery can erase the intended live test
state. The pure fixture unit tests check ownership, revisions, history certificates
and idempotent terminal reports. Tests that exclusively assert retired receipt or
roster reconstruction remain explicitly skipped for the
[cleanup ticket](https://github.com/pyrycode/pyrycode-desktop/issues/2020).
The [activation plan](../../specs/architecture/1908-thread-activation.md#manual-completion-shared-fake-migration-and-client-regressions)
lists every skipped case and final counted evidence.

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

Default-tier Welcome clicks pending after five seconds or failing earlier also
retain [bounded progress evidence](e2e-harness-launch-fate.md#welcome-stall-diagnostics)
in `welcome-stall`, correlated to launch-fate by launch ordinal. Fast clicks add
no probes or waits; observation ends before pairing continues. Controlled capture
coverage establishes no cause for the historical Welcome stall.

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

The owning forwarder binds its HTTP listener with `http.listen(0, '127.0.0.1')`,
matching the advertised IPv4 dial. On macOS a wildcard listener can coexist with
an exact IPv4 listener on the same port, letting the latter receive that dial.
`setupDiagnostics().listenerMatchesDial` checks the actual bound address and
family and retains only a boolean. Preserve the explicit bind when changing
HTTP/WebSocket server ownership; an ephemeral port alone does not establish
ownership of the advertised address. See the [forwarder's observation contract](fake-relay-forwarder.md#setup-observation-and-listener-ownership).

Before each dial, the setup helper snapshots that forwarder's counters. It
synchronously records one content-free attempt after success or rejection, at
most two records because only the first reset can retry. Each record carries
`attempt`, `outcome` (`opened`, `retry-reset`, `failed`), the sanitized
`failureClass`, `listenerMatchesDial`, parser/upgrade/rejection/connection delta
booleans, a fixed parser class and GET/Upgrade/key/version validity booleans.
`responder` is `http-parser` when a parser error was observed, otherwise
`websocket-upgrade` for an observed upgrade rejection, `opened` for an observed
connection, or `unobserved`. Even a successful dial stays `unobserved` if its
owning forwarder observed no connection; an HTTP status alone cannot identify
the responder. No raw request, error, URL, header, key or frame is retained.

`startFakeServer` attaches these records in `finally`, before Electron launch,
as JSON named `fake-daemon-setup-<setupOrdinal>-<forwarderStep>-<attempt>`.
The setup ordinal advances even on failure and is separate from the later
Electron launch ordinal; step names are fixture-owned constants. Registering a
successful daemon's teardown before awaiting attachment I/O prevents an
attachment failure from stranding it or being classified as a dial failure.
Failed dials already release their socket and Noise state; fixture teardown
closes the forwarder's WebSocket server and explicitly owned HTTP listener.

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

Controlled ownership regressions recreate the legacy wildcard listener with a
competing IPv4 responder for HTTP 400, 404 and 501. Each rejects once, records an
unobserved owner, and proves socket close and Noise free before constructing a
fresh explicitly bound owner and completing an encrypted exchange. Darwin uses
its actual wildcard shadowing; other platforms use an IPv6-only negative control
without skipped cases. The exact-bind regression rejects a competing listener
with `EADDRINUSE`, and concurrent-forwarder tests prove independent counters and
opaque exchanges. Parser/upgrade regressions compare response bytes against an
uninstrumented server and prove subsequent usability. These establish the
repairable ownership boundary, without identifying the historical HTTP 400/404/501
responders or attributing a mute-command product failure.

At reviewed revision `9d8ed3efbce3cdb01d2b157d803c484521f7aaca` on macOS arm64,
the unchanged `a setConversationMuted command reaches only the owning host and
settles once` scenario passed ten consecutive executions with retries disabled:
10 executed/passed, zero failed/skipped/retried, all 20 setup records opened with
`listenerMatchesDial: true`. The complete configured four-worker gate recorded
530 executed/passed, zero failed, two existing skips and zero retries;
the named scenario is present and passed. Owning-host dispatch, confirmed/rejected
settlement, unclaimed-ID rejection and list-refresh assertions remain intact.
The [accepted evidence](../../specs/architecture/1983-fake-daemon-rejection-capture.md#accepted-verifier-evidence-2026-10-20)
records commands, report/log paths, skip reasons and the later closure of #2150,
and supersedes earlier pending-gate statements. Earlier failed captures remain
failed and retained in that plan. Other operating systems are outside this
ticket's verification scope; these are recorded results, with no new provider or
live-daemon acceptance claim.

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

Unconditional `reconnectResendFrames` prove delivery after a handshake. The
production connection no longer negotiates event replay: initial and reconnect
hellos omit `last_event_id` and `last_seen_ts`, and legacy `resync` is inert
(#2025). The former `reconnect-event-replay.spec.ts` content proof retired with
renderer producers in #2030. Use the existing `thread-activation.spec.ts` cases
for authoritative reconnect/checkpoint recovery and zero legacy requests. Keep
positive processing/render barriers before absence assertions. See
[retirement evidence](thread-runtime.md#main-request-and-recovery-retirement-validation).

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
