# E2E harness — desktop isolation

Window presentation, renderer throttling and real-pointer observations. See the [harness overview](e2e-harness.md).

## Desktop isolation (default-tier launches)

Every default-tier launch used to show and focus its window (`createWindow`'s `ready-to-show → show()`), 49 times per `workers: 1` run — a state Chromium backgrounds and throttles the moment the operator clicks away. That was traced, in [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067), to a one-spec-per-run flake at `pairingArrival.ts`'s fingerprint-card wait: the step is a synchronous BLAKE2s hash with no socket in it, so a 5000ms miss meant the renderer was stopped, not slow — and the fix is isolating the tier from the operator's desktop, not raising that wait's timeout.

Both launch sites — `launchPairedApp.ts` and `smoke.spec.ts` — now go through one shared, side-effect-free module, **`e2e/fixtures/desktopIsolation.ts`** (the `pairingArrival.ts` convention: no `base.extend`, so importing it drags no second fixture extension into a spec). `launchIsolatedApp({ args, env })` replaces `electron.launch` at both sites and applies two levers together, because neither alone is sufficient: three Chromium renderer-throttling switches (`RENDERER_THROTTLING_SWITCHES` — `disable-renderer-backgrounding`, `disable-backgrounding-occluded-windows`, `disable-background-timer-throttling`) appended to `args`, and the [window-presentation dev affordance](window-presentation-affordance.md)'s `HIDDEN_WINDOW_ENV_FLAG` set to `'1'` on `env` — a hidden window is still an occluded one, so hiding it without the switches would earn back exactly the throttling this exists to remove. `readDesktopIsolation(app)` reads the isolation back **from inside the launched app** (`app.commandLine.hasSwitch`, `BrowserWindow.getAllWindows()` filtered on `isVisible()`) rather than matching fixture source text, and `expectDesktopIsolated(app)` asserts all three switches applied, at least one window exists, and none is visible.

`e2e/desktop-isolation.spec.ts` is the cover: one test drives the full pairing arrival through `launchPairedApp` and asserts the isolation held for the whole drive; a second reads the isolation back directly; a third walks every `.ts` file under `e2e/` and asserts the set of files calling `electron.launch(` is exactly `{fixtures/desktopIsolation.ts, fixtures/realDaemon.ts}` — the deterministic guard against a future launch site skipping the shared module the way `electronApp.ts` (above) died of being optional. `smoke.spec.ts` gained its own `expectDesktopIsolated` assertion for the same reason, since it is the tier's other launch site.

`e2e/fixtures/realDaemon.ts` and `e2e/fixtures/pairingArrival.ts` are deliberately untouched — the `real-*` tier is operator-supervised by nature, and this ticket is provable without a live daemon.

**Show-window opt-out for headless Linux (2026-10-04).** On Linux under Xvfb, as in the pyrybox dispatcher container, a window that is never shown produces no frames, so every `page.screenshot` and `locator.screenshot` waits out its 30-second timeout. Measured: three specs went from 3 failed in 2.3 minutes with the window hidden to 4 passed in 10 seconds with it shown. Setting `PYRY_E2E_SHOW_WINDOW=1` (`SHOW_WINDOW_E2E_ENV_FLAG` in `desktopIsolation.ts`) makes both launch sites, `launchIsolatedApp` and `realDaemon.ts`, leave `HIDDEN_WINDOW_ENV_FLAG` off. The throttling switches still apply, and `expectDesktopIsolated` and the isolation spec skip only the not-visible clause. Only the harness reads the variable, so the app's own gate is unchanged. Leave it unset on a machine someone is using: a shown window takes focus.

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
This local observation fix is distinct from the shared native-pointer isolation work
in [#1813 / PR #1836](https://github.com/pyrycode/pyrycode-desktop/pull/1836);
that change is not included here or required for this assertion, and combined execution
was not part of the recorded validation.

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
