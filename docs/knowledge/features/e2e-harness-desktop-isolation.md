# E2E harness — desktop isolation

Window presentation, renderer throttling and real-pointer observations. See the [harness overview](e2e-harness.md).

## Desktop isolation (default-tier launches)

Every default-tier launch used to show and focus its window (`createWindow`'s `ready-to-show → show()`), 49 times per `workers: 1` run — a state Chromium backgrounds and throttles the moment the operator clicks away. That was traced, in [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067), to a one-spec-per-run flake at `pairingArrival.ts`'s fingerprint-card wait: the step is a synchronous BLAKE2s hash with no socket in it, so a 5000ms miss meant the renderer was stopped, not slow — and the fix is isolating the tier from the operator's desktop, not raising that wait's timeout.

Both default-tier launch sites, `launchPairedApp.ts` and `smoke.spec.ts`, use
[`desktopIsolation.ts`](../../../e2e/fixtures/desktopIsolation.ts), a side-effect-free
module with no `base.extend`. `launchIsolatedApp({ args, env, fate })` appends three
Chromium switches: `disable-renderer-backgrounding`,
`disable-backgrounding-occluded-windows` and `disable-background-timer-throttling`.
It copies the environment and selects presentation through `e2eShowsWindow`:
Linux always shows windows; macOS and Windows default to hidden, with exact
`PYRY_E2E_SHOW_WINDOW=1` opting into shown windows. Hidden launches set
`HIDDEN_WINDOW_ENV_FLAG='1'`; shown launches remove an inherited flag. The
[window-presentation affordance](window-presentation-affordance.md) also disables
`backgroundThrottling` for hidden windows, which otherwise remain occluded.
Shown windows retain normal product presentation. Before its default pairing
drive, `launchPairedApp` also disables background throttling on the exact pairing
window, including shown launches; see [Welcome readiness](#separate-welcome-readiness-boundary).
The smoke and real-tier launch paths retain their existing throttling policy.

`readDesktopIsolation(app)` reads Chromium's parsed switches and actual window
visibility inside the acquired app. `expectDesktopIsolated(app)` requires all
three switches and at least one window, and asserts none is visible only for
hidden launches. It does not prove native-pointer isolation; that requires the
independent-cover regression below.

`e2e/desktop-isolation.spec.ts` drives normal Welcome → pairing → fingerprint
confirmation → seeded-row selection → enabled Send, reads isolation directly,
and guards launch sites. Its source scan requires `electron.launch(` only in
`fixtures/desktopIsolation.ts` and `fixtures/realDaemon.ts`, excluding its own
intentional independent-cover launch and unit `.test.ts` files. This prevents a
new default-tier fixture from bypassing shared initialization. `smoke.spec.ts`
also calls `expectDesktopIsolated`.

`realDaemon.ts` keeps a separate launch lifecycle and applies the presentation
policy and throttling switches itself. It does not use `launchIsolatedApp`'s
native-pointer initialization. `pairFromUnpairedLaunch` retains its calling
contract; the shared launch fix changes no pairing/authentication behavior,
product UI, toolbar assertions, actionability checks, timeouts or retry policy.

**Show-window opt-out for headless Linux (2026-10-04).** On Linux under Xvfb, as in the pyrybox dispatcher container, a window that is never shown produces no frames, so every `page.screenshot` and `locator.screenshot` waits out its 30-second timeout. Measured: three specs went from 3 failed in 2.3 minutes with the window hidden to 4 passed in 10 seconds with it shown. Setting `PYRY_E2E_SHOW_WINDOW=1` (`SHOW_WINDOW_E2E_ENV_FLAG` in `desktopIsolation.ts`) makes both launch sites, `launchIsolatedApp` and `realDaemon.ts`, leave `HIDDEN_WINDOW_ENV_FLAG` off. The throttling switches still apply, and `expectDesktopIsolated` and the isolation spec skip only the not-visible clause. Only the harness reads the variable, so the app's own gate is unchanged. On macOS and Windows, leave it unset on a machine someone is using: shown windows still take focus. Linux's shown default below targets unattended virtual-display runs.

**Linux shows the window by default (\#1796, 2026-10-06).** The dispatcher sets the flag for its gates, but a Codex agent's shell keeps only allowlisted variables, so a builder's own Playwright runs in the same container launched hidden and timed out on screenshots the gate passed. `e2eShowsWindow` now returns true on Linux whatever the flag says, so agent runs and gates share one presentation. macOS and Windows keep the hidden default and the exact `'1'` opt-out.

**One X display per run (2026-10-15).** On Linux, [`runDisplay.ts`](../../../e2e/fixtures/runDisplay.ts) is the global setup of both Playwright configs. Before any worker starts, it starts a private Xvfb with the container display's screen and `-noreset`, and points the run's `DISPLAY` at it. Workers inherit that, and every launch site copies `process.env` into Electron's environment. It applies however the run starts: the verifier gate, its `-g` re-run, the live gate, `npm run e2e` or an agent's own `npx playwright test`. Before this, all of them drew on the agent container's one display `:99` and shared its clipboard, which the `clipboard` project can only serialise within one run. Wrapping a run in `xvfb-run -a` is no longer needed and does no harm.

- `PYRY_E2E_DISPLAY=inherit` keeps the inherited `DISPLAY`, for example to watch a run on a Linux desktop. `PYRY_E2E_SHOW_WINDOW` cannot serve as the switch, because the container sets it for gates.
- macOS and Windows are untouched. Linux without Xvfb uses the inherited `DISPLAY` and fails at setup when there is none.
- `-displayfd` lets the server pick a free number and report it once it is listening, so concurrent runs never collide.
- A small shell holds the server and stops it when the runner's end of its standard input closes. A kill of the runner alone therefore stops it too, and a signal to the process group reaches it directly.
- The display is per run, not per worker. Workers of one run already ignore the display's pointer (#1813), get Playwright's focus emulation and take turns on the clipboard. Measured on 2026-10-15, the shared server used under 2 percent of one core during a four-worker run.

**The harness hands out a loaded window (2026-10-15).** `appWindow(app)` in `desktopIsolation.ts` returns the first window once `#root` exists and the app document's `load` has fired. `launchPairedApp` (before `onLaunched`), `realDaemon.ts`, `smoke.spec.ts` and `pairing-recovery.spec.ts` take the window from it. Playwright already holds back a new page's initial empty document until the first real navigation commits, so `firstWindow()` never hands out a page that is about to navigate away. In 66 of 80 probed launches, though, the app document was still `interactive` when it resolved. `onLaunched` hooks now always run after the bundle has executed and React has mounted, and still before pairing.

**"Execution context was destroyed" from the main process is not a navigation.** Playwright rewrites every protocol error from an evaluation that is neither a JavaScript exception nor a closed session into that sentence. With the original error kept, all 11 losses reproduced from `app.evaluate` and `browserWindow().evaluate` in the agent image were V8's `Promise was collected`, long after the renderer had loaded. The tolerances in `mainProcessRead.ts`, `confirmedPush.ts`, `composerWindowSetup.ts`, `localListFailure.ts` and `pairing-authentication.spec.ts` therefore stay: every one of them wraps a main-process evaluation, which a window load wait does not reach.

Shown Xvfb windows share native pointer input even though each launch owns its process
and profile. Throttling exemptions do not isolate that input. In the
[sidebar hover investigation](https://github.com/pyrycode/pyrycode-desktop/issues/1819#issuecomment-6029550135),
showing a second native window after a completed Playwright `hover()` cleared the row's
`:hover` in 11 of 30 snapshots with unchanged CSS. One cycle recorded an outside-row
pointer move; the resting fill became transparent while the open fill stayed correct.
Two animation frames did not restore hover, and separate unfocused-window observations
kept the correct treatment. Focus loss alone therefore does not explain this failure.

The Chats-row test's local `expectPointerTreatment` re-delivers real pointer input on
each polling attempt and reads target hover, hovered-row count, exact fills and both
control opacity sets in one synchronous renderer snapshot. Pointer-away observations
also deliver input before checking that no row is hovered. Polling style alone could
time out while hover stays lost. Geometry, keyboard focus and activation retain
their existing checks; timeout, retry and parallelism settings are unchanged. See
[the verification method](development-verification-layout-and-input.md#layout-and-input) and
[row regression evidence](channel-list-row-hover-control.md#testing-pointer-observations).
This local observation fix remains distinct from the shared native-pointer
isolation in [PR #1836](https://github.com/pyrycode/pyrycode-desktop/pull/1836).
The row's original validation preceded that launch fix; final full-suite evidence
for the combined tree is recorded below.

The [failed-host investigation](https://github.com/pyrycode/pyrycode-desktop/issues/1821#issuecomment-6029849641)
confirmed the same mechanism on the host row: showing/focusing a competing native
window cleared actual hover in six of 30 cycles on Linux x86_64 with shown Xvfb
`:99` windows at baseline `59efab093c13f2ed1bd5658ee836d14e57a04de5`.
One cycle moved the pointer from `(220,127)` to `(550,373)` outside the host;
Edit opacity became `0` while all four host/label/Edit/Repair boxes stayed identical
and document focus remained true. Two frames did not restore hover; ordinary
`host.hover()` restored actual hover and opacity `1` in all 30 cycles. Replaying
the outside-host move made the old passive opacity wait fail for its original
five-second timeout. Focus and stable geometry alone cannot establish hover.

The failed-host test's local `hoverHost` re-delivers ordinary `host.hover()` on
each default `expect.poll` attempt, then reads `matches(':hover')` and Edit computed
opacity in one synchronous renderer snapshot, requiring
`{ hovered: true, editOpacity: '1' }`. It also runs before the screenshot. There is
no opacity transition to wait out. Removing only the host-hover opacity declaration
from a scratch built renderer made this assertion fail with true hover and opacity
`0`, so synchronization still detects incorrect styling. The
[host-row coverage and counted acceptance](channel-list-host-row.md#the-host-row)
retain geometry and ordinary activation; renderer styles and shared launch behavior
did not change for this correction.

The [collapse-tool preference review](https://github.com/pyrycode/pyrycode-desktop/pull/1793#issuecomment-6003905659)
records the same trap for Settings on/off captures: a hidden Linux window reached
correct DOM state but emitted no screenshot frames. Under the virtual display,
`PYRY_E2E_SHOW_WINDOW=1` enabled captures from the existing focused spec at 800×800
and 1280×800 windows. DOM assertions alone cannot establish screenshot readiness;
use the harness option for capture work rather than adding another launch path.

### Native display-pointer protection

The display has a real pointer independent of Playwright's CDP-injected pointer.
On shared Xvfb it rests at screen centre, under the workers' centred windows.
Mapping or closing another window there produces an X crossing event; Chromium
turns the native exit into loss of document `:hover` even while Playwright's
pointer remains on the control. Throttling switches do not prevent this input.

The [causal report](https://github.com/pyrycode/pyrycode-desktop/issues/1813#issuecomment-6029766023)
records an unchanged toolbar test failing once in 30 under three workers and CPU
load at pill visibility, and an instrumented copy failing once in 40 at
`missing tooltip box`. The latter observed `pointerout` at `(550,372)`, screen
centre in content coordinates, 27ms after simulated hover, unchanged element
geometry and an empty hover chain. In the controlled check, opening a window
over the display pointer ended hover; opening the same window in the corner
retained it despite the focus change. These distinguish native crossing from
focus loss. The original instrumented failure and corner control are reported
evidence: raw artifacts were not linked or independently replayed by the verifier.

For shown default-tier launches, `ignoreDisplayPointer` calls
`setIgnoreMouseEvents(true)` on all existing windows and installs a
`browser-window-created` listener for later windows in the same main-process
callback. A cover created within that app inherits the listener and cannot
model an input-enabled competing worker. The protection removes display-pointer
input while leaving Playwright's renderer hit testing, hover, click, focus and
actionability intact. Hidden windows receive no display pointer and skip this
initialization. Ordinary product launches do not use this harness protection.
Acquired-app ownership until initialization succeeds, including rejection
cleanup, is described in [launch-fate diagnostics](e2e-harness-launch-fate.md#initialization-ownership).

The committed test `an independent input-enabled cover preserves isolated hover`
launches a separate Electron process with its own temporary profile. Its cover
stays input-enabled, maps over `screen.getCursorScreenPoint()` and reports paint
before inspection. Raising the app and cover above unrelated shared-display
windows lets the crossing reach the intended boundary. The test retains the
protection installed by launch, requires actual hover, zero pointer exits and a
visible name pill, and drains the cover and scratch directory in `finally`.
It skips only when presentation is hidden, which receives no native pointer.

A same-process cover could remain green after deleting initial-window protection,
because the inherited listener also disables the interference. The final
single-worker deletion mutation instead removes that initial protection and
fails with `{ hovered: false, displayPointerExits: 1 }`. Concurrent unprotected
negative controls compete for the display's single real pointer (5 of 10 failed
under three workers), so that extra arm was removed from the committed test.
The protected case runs concurrently; its sensitivity is established separately
by the mutation, without a second global input harness or weakened assertions.

### Recorded pointer-isolation acceptance

The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1836#issuecomment-6031117734)
inspected the retained results below. All use Linux x86_64, Electron 33.4.11,
shared Xvfb 1920×1080, shown 1100×800 app windows and retries disabled.
The named test is `toolbar controls show their existing name-pill treatment on
hover and keyboard focus` in `sidebar-section-header-plus-name-pill.spec.ts`.
It was present, executed and passed in both repetition runs and both full runs.
Its text, style, geometry, leave, keyboard modality/focus, blur and overflow
assertions have no diff.

| Run | Revision | Workers | Executed / passed / failed / skipped | Retained result |
| --- | --- | --- | --- | --- |
| Named toolbar test, 20 repetitions | `834d9743` | 1 | 20 / 20 / 0 / 0 | `/tmp/builder-1813/rework/named-one.json` |
| Named toolbar test, 20 repetitions | `a134365b` | 3 | 20 / 20 / 0 / 0 | `/tmp/builder-1813/rework/named-three.json` |
| Builder full default fake-transport suite | `a134365b` | 3 | 325 / 325 / 0 / 4 | `/tmp/builder-1813/rework/full-default.json` |
| Final protected cover, 10 repetitions | Pre-commit code for `3de358bd` | 3 | 10 / 10 / 0 / 0 | `/tmp/builder-1813/rework/cover-final-ten.json` |
| Initial protection deleted; expected mutation failure | Pre-commit mutation for `3de358bd` | 1 | 1 / 0 / 1 / 0 | `/tmp/builder-1813/rework/cover-final-mutation.json` |
| Dispatcher full default gate, 2026-10-07 | `7442319e58a6b9ec04f94fe4b933fdf0644ed070` | 3 | 325 / 325 / 0 / 4 | `verifier-gate_#1813_6.log` in dispatcher logs |

Both the builder full run and final dispatcher gate executed and passed their
independent-cover regression once. The earlier full run used the pre-final
two-arm regression; the dispatcher confirms the final committed protected-only
test. Repetition revisions precede the final regression changes and main merge;
the launch fix and named toolbar assertions stayed unchanged. The dispatcher
log is at `/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#1813_6.log`;
the supplied gate report and final verdict provide its counted evidence.
Scratch JSON paths record retained evidence, not committed artifacts or a new
documentation-stage run. Acceptance is fake transport and needs no live Claude.
Required app typechecks passed; auxiliary strict e2e typechecking remained red
on the unchanged shared launch environment type mismatch, and is not claimed green.

The [attachment-pill comparison](https://github.com/pyrycode/pyrycode-desktop/issues/1833#issuecomment-6127206600)
extends this boundary to box disappearance between successful visibility/treatment checks
and geometry reads. On historical `188fd6b7`, the independent input-enabled cover over the
native pointer produces one new `pointerout`, slot hover true → false, display block → none
and pill box present → null. Protected main `f2e0d6104c9593e83bfc0241d506b118def8bc52`
retains hover and the identical box with zero new exits. Serial deletion of only the
initial-window protection reproduces the historical result, isolating that variable.

Actual over-pointer cover bounds `(860,440,200,200)` contain cursor `(960,540)`;
the same cover at `(0,0,200,200)` excludes it. App bounds are `(410,140,1100,800)`.
All corner controls retain hover/display/box despite the cover taking native focus.
Slot focus-within stays false in both arms. Renderer `document.hasFocus()` stays true
even when native app focus becomes false; record these separately rather than treating
renderer focus as native focus. Historical exit coordinates `(550,373)` differ from
the injected tile hover `(482.5,619)`. Every observation includes timestamped pointer
events and all six nullable layout boxes; strip/input resting geometry stays unchanged.

Each historical/protected/deletion comparison executed/passed two scenarios, with one
actual worker, zero failed/skipped/flaky results and zero retries, on Linux x86_64,
Electron 33.4.11 and dedicated 1920×1080 Xvfb with shown 1100×800 windows. The
[verifier audit](https://github.com/pyrycode/pyrycode-desktop/pull/1943#issuecomment-6127503162)
checked all six observations and matching report attachments. Exact patches, JSON and
observations remain under `/tmp/builder-1833/`, bundled in `retained-proof.tar.gz`.
These controls confirm the reproduced mechanism's protection, not its contemporaneous
historical trigger; the overwritten original #1818 occurrence remains unconfirmed.
The [attachment testing contract and counted acceptance](composer-attach-name-pill.md#controlled-hover-and-geometry-verification)
record the unchanged spec and separate background/offset sensitivity controls.

### Recorded host-pill acceptance

The unchanged `sidebar-host-row-control-name-pill.spec.ts` test, `Edit host keeps
its pointer name pill without a host Add workspace control`, did not reproduce
after the merged protection (`2f2cca62`, PR #1836). The
[diagnosis and retained failure logs](https://github.com/pyrycode/pyrycode-desktop/issues/1823#issuecomment-6037020215)
record null `after` pill boxes for #1761 (`e0b178ce89`) and #1660 (`9f8601f1bb`),
and a null `before` box for #1818 (`5d1b88adaa`), followed by same-tree passes.
Those logs contain no pointer-event capture proving historical causation.
The controlled native-pointer mechanism above is confirmed; attributing these
host occurrences to it remains inferred, even after green repetition runs.

The [host-pill verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1857#issuecomment-6037254010)
inspected JSON and matching logs for revision
`1d8d34e65be97d5c3baccb6d656be92948ffcf81`, containing main `44d28c65034c`
and #1836. All three acceptance runs used Linux x86_64, Electron 33.4.11,
shared Xvfb `:99`, shown default 1100×800 windows with native-pointer protection
and explicit `--retries=0`. The named host test was present, executed and passed
in both repetition runs and once in the full run.

| Run | Workers | Executed / passed / failed / skipped | Retained result |
| --- | --- | --- | --- |
| Named host test, 20 repetitions | 1 | 20 / 20 / 0 / 0 | `/tmp/builder-1823/named-one.json` |
| Named host test, 20 repetitions | 3 | 20 / 20 / 0 / 0 | `/tmp/builder-1823/named-three.json` |
| Full default fake-transport suite | 3 | 335 / 335 / 0 / 4 | `/tmp/builder-1823/full-default.json` |

Matching `.log` files and `*-results/` artifact directories are retained in
`/tmp/builder-1823/`. The full run also executed/passed the independent-cover
regression once. Its four skips are existing macOS-only badge and window-reopen
checks; there were no unrelated failures. The dispatcher verifier gate on
`339423caac720ca3ac4391d956ab7b04f244fe90` independently recorded 335 executed,
335 passed, zero failed and four skipped, with the named host test present and
passed. Its source, launch fixture and product presentation were unchanged.

This is an evidence-only resolution: retain the
[host-pill contract](channel-list-control-name-pill.md#host-edit-pill-verification)
without another observation or fixture correction. These passes do not diagnose
the separate Welcome stall assigned to #1842 below. The results record in the
[plan](../../specs/architecture/1823-host-pill-reliability.md#revisions) changes no
tested code; no live-Claude acceptance applies.

### Separate Welcome readiness boundary

The [maintainer's rescope](https://github.com/pyrycode/pyrycode-desktop/issues/1813#issuecomment-6030925132)
moved the original 30-second Welcome actionability stall to
[#1842](https://github.com/pyrycode/pyrycode-desktop/issues/1842). Historical
Welcome findings in the [plan](../../specs/architecture/1813-launch-readiness.md)
and PR predate that decision; their unresolved diagnosis does not block the
accepted pointer fix and is not fixed by it. Process liveness and clean teardown
do not establish renderer responsiveness or animation-frame progress.

Shown/hidden/minimize-request/unthrottled checks retained in
`/tmp/builder-1813/rework/window-states.log` all produced ten animation frames,
a responsive timer, an enabled Welcome CTA and visible document state. Xvfb
never reported `isMinimized() === true`, so the minimize request proves nothing
about minimized behavior. The clean after-build observer run at `a134365b`
executed/passed 100 launches, 0 failed, 0 skipped, three workers, retries zero
(`observed-launches-after-build.json` in that directory); none reproduced the
stall or triggered its delayed observer. The earlier `observed-launches.json`
overlapped rebuilding `out/` and is invalid evidence. Green launches cannot
diagnose the original failure.

Default-tier `launchPairedApp` now registers page-specific Welcome diagnostics
around its initial `pairFromUnpairedLaunch(page, payload, label?)` drive. The
shared helper wraps the ordinary click without changing its contract or callers;
unregistered pages, including the real tier, click directly. A click pending for
five seconds or rejecting earlier starts one capture, before teardown. Fast
success performs no diagnostic renderer/native probes, attachment or extra wait.
The observer ends at click settlement; pairing and confirmation are not sampled.
The 30-second actionability timeout, retries, real input, native-pointer protection
and normal flow remain unchanged.

The fixed `welcome-stall` JSON attachment correlates with launch-fate through a
one-based launch ordinal captured at `watch` registration, before concurrent
launch setup can change the count. Native visibility/minimization/focus/bounds
are read independently of renderer response. Renderer readings contain Welcome
presence/enabled/bounds and frame/timer progress over a recorded interval.
Probes share a two-second capture budget, with a 750ms sampling target and
explicit unavailable outcomes; only validated primitives and fixed labels enter
the report. See [capture and cleanup ownership](e2e-harness-launch-fate.md#welcome-stall-diagnostics)
and [revision-separated acceptance](e2e-harness-launch-fate.md#recorded-welcome-diagnostic-acceptance).

The original instrumentation's controlled nonresponse and advancing-timer/zero-frame
faults prove capture only, without requiring actual OS minimization. The later
[#1986 investigation](https://github.com/pyrycode/pyrycode-desktop/issues/1986#issuecomment-6182367676)
reproduced a native-hidden mechanism at `cfd0ad90`, with app/helper sources identical
to the historical `df4ce98b` Welcome timeout. Native hiding left the renderer
responsive and the CTA enabled, but produced zero animation frames and 14 timer
ticks over 750ms. The ordinary click timed out after 30000ms waiting for visibility,
enabled state and stability; no pointerdown, pointerup or click arrived. Shown and
covered controls delivered trusted input and reached the pairing form. Showing
the window or disabling background throttling released the pending ordinary click.
Renderer timers therefore do not establish frame progress or click actionability.

Shown launches can still be native-hidden before their first paint: all 100 normal
initial-hook samples observed hidden/loading windows with throttling enabled.
The Chromium switches alone did not protect that interval. `launchPairedApp` now
acquires `app.browserWindow(page)` after the launch hook and reuse/skip checks,
sets `webContents.setBackgroundThrottling(false)` before the ordinary pairing
drive, and disposes the handle in `finally`. The setting lasts for that window's
lifetime; disposing the handle does not restore throttling. Native presentation,
`pairFromUnpairedLaunch(page, payload, label?)`, real-tier callers and diagnostic
capture/cleanup remain unchanged.

`ordinary Welcome pairing stays responsive while its native window is hidden`
in `e2e/welcome-stall.spec.ts` holds the exact native window hidden after its normal
first show (or retains hidden presentation). It requires one trusted Welcome click,
normal pairing/confirmation through enabled Send, hidden native state with throttling
disabled, two real animation-frame callbacks and no stall attachment. Removing
only the fixture repair reproduces the original click boundary. See
[revision-separated repair evidence](e2e-harness-launch-fate.md#recorded-welcome-repair-acceptance).

This controlled defect is distinct from the unrecorded historical trigger: the
natural failure's raw call log and attachment remain unavailable, and normal green
launches do not explain why its hidden interval persisted. The separate hover
diagnosis supplies no Welcome cause. Retain native, renderer/frame and input
evidence on any new natural failure; macOS/Windows native execution and actual
minimized-window behavior are not established by the Linux hidden-window proof.
