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
Shown windows retain normal product presentation and background throttling.

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
[the verification method](development-verification.md#layout-and-input) and
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
diagnose the original failure; #1842 needs renderer responsiveness, frame/timer
progress and native window state from a failing launch before teardown.
