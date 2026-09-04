# #1067 — Isolate default-tier e2e launches from the operator's desktop

## Files read

Codegraph is not usable in this worktree (`mcp__codegraph__*` answers "CodeGraph not initialized"), so this
list came from `grep`/`Read` over `e2e/` and `src/main/` with no `--include` filter.

- `e2e/fixtures/launchPairedApp.ts` → the `launchPairedApp` factory fixture — launch site 1 of 2 (48 of
  the 49 default-tier spec files); the `electron.launch({ args: ['.', '--user-data-dir=…'], env })` call
  and the env-copy hardening this ticket extends.
- `e2e/smoke.spec.ts` → its file-local `page` fixture — launch site 2 of 2; the same launch shape,
  stripped to no fake relay/daemon and no pairing env flags.
- `e2e/fixtures/pairingArrival.ts` → `pairFromUnpairedLaunch` — the shared arrival step whose
  fingerprint wait is the flaking assertion. **Read only. Not edited** (AC4).
- `e2e/fixtures/realDaemon.ts` → its own `electron.launch` at the `withIsolatedElectronApp` seam — the
  third launch site in the tree, belonging to the `real-*` tier. **Read only. Not edited** (AC4); it is
  the one allowlisted exemption in the launch-site guard below.
- `src/main/index.ts` → `createWindow` (the `show: false` + `ready-to-show → show()` pair that makes every
  launch frontmost, and the `webPreferences` block), `openWindow` (the per-window composition seam #519
  introduced, which the dock-reopen `activate` handler also goes through).
- `src/main/relayPolicy.ts` → `LOOPBACK_RELAY_ENV_FLAG`, `selectRelayPolicy` — the `isPackaged`-false-first
  env-flag precedent this ticket's flag copies verbatim in shape.
- `src/main/secretBackend.ts` → `TEST_SECRET_BACKEND_ENV_FLAG`, `selectSecretEncryption` — the second
  instance of the same precedent, including the "exactly the string `'1'`" opt-in.
- `playwright.config.ts` → `testMatch` / `testIgnore` / `workers: 1` — why a new `e2e/fixtures/*.ts`
  module is not collected as a spec, and why the `real-*` partition keeps this ticket off the live tier.
- `docs/knowledge/features/e2e-harness.md` § "Edge cases and limitations" → the "macOS runs headful with
  no extra setup" line this ticket is the deviation from, and § "The launch fixture (retired)" → why
  there is no shared scenario-agnostic launch primitive today (`electronApp.ts` was deleted by #546 for
  having zero importers). The lesson that matters here: the last shared launch primitive died of being
  optional, so the shared place this ticket introduces is made non-optional by a guard, not by a convention.
- `e2e/message-copy.spec.ts` header → its own note that the copy control's `navigator.clipboard.writeText`
  runs "in a focused window"; the one spec whose passing may depend on window focus, and the reason the
  Open Questions below carry a named fallback.

## Context

The default (fake-transport) Playwright tier reddens one spec per full run, a different spec each run,
always at `pairFromUnpairedLaunch`'s fingerprint-card wait. That step is pure synchronous work — pairing
IPC → `parsePairingPayload` → `prepare`'s BLAKE2s hash — with no socket and no handshake, so a 5000 ms
miss means the renderer was stopped, not that the step was slow. Every default-tier launch shows and
focuses a window (`createWindow`'s `ready-to-show → show()`), 49 times per `workers: 1` run, so the
operator using their own machine while a run is in progress is the readily-available explanation: a window
just clicked away from is occluded/unfocused, and Chromium backgrounds and throttles exactly that.

There is deliberately no fails-on-`main` test for the flake; it reproduces about once per 77 tests and only
under operator interference. The evidence this ticket ships is the four acceptance criteria.

No ADR is warranted. The one durable decision here — a non-packaged build may be asked not to show its
window — is a third instance of a pattern two existing ADR-less modules already established
(`relayPolicy.ts`, `secretBackend.ts`); it belongs in the e2e-harness package overview, which the
documentation phase owns.

## Design

Both levers from the Technical Notes land, because the ticket's own warning binds: a hidden window is an
occluded window, so (b) without (a) earns the throttling this exists to remove.

**One shared place: `e2e/fixtures/desktopIsolation.ts`.** A plain side-effect-free module (the
`pairingArrival.ts` / `conversationStateFake.ts` convention — it calls no `base.extend`, so it drags no
second fixture extension into any spec). It owns the `electron.launch` call for the whole default tier;
neither launch site calls `electron.launch` itself any more.

- `RENDERER_THROTTLING_SWITCHES` — the readonly bare switch names (no `--`), the single source for both
  the `args` the launch applies and the read-back that proves it: `disable-renderer-backgrounding`,
  `disable-backgrounding-occluded-windows`, `disable-background-timer-throttling`. Lever (a).
- `launchIsolatedApp({ args, env })` → `ElectronApplication`. Appends `--<switch>` for each name to the
  caller's `args` (so `.` stays the first non-switch arg, exactly as `--user-data-dir` is appended today)
  and sets `HIDDEN_WINDOW_ENV_FLAG` to `'1'` on a copy of the caller's env. Lever (b)'s opt-in.
  It adds nothing else: stripping `ELECTRON_RENDERER_URL` and minting `--user-data-dir` stay with the
  callers, which is where the per-scenario state isolation already lives.
- `readDesktopIsolation(app)` → `{ switchesApplied, windows, visibleWindows }`, read **from inside the
  launched app** via one `app.evaluate`: `app.commandLine.hasSwitch(name)` for each switch (Chromium's own
  parsed command line, not a string the fixture wrote) and `BrowserWindow.getAllWindows()` filtered on
  `isVisible()`.
- `expectDesktopIsolated(app)` — asserts every switch applied, `windows > 0`, `visibleWindows === 0`. The
  `windows > 0` clause is not decoration: without it a launch with no window at all passes vacuously.

**Lever (b) in the main process: `src/main/windowPresentation.ts`.** The third instance of the
`relayPolicy` / `secretBackend` shape, quarantined the same way so `index.ts` grows no env/dev code.

```ts
export const HIDDEN_WINDOW_ENV_FLAG = 'PYRY_HIDDEN_WINDOW'
export type WindowPresentation = 'shown' | 'hidden'
export function selectWindowPresentation(opts: {
  isPackaged: boolean
  env: Record<string, string | undefined>
}): WindowPresentation
```

Bounded on two independent axes, both required: `isPackaged` checked **false-first**, so a packaged build
never reads the env at all; then an opt-in equal to exactly `'1'`. Pure and synchronous; the effectful
choice (`app.isPackaged`, `process.env`) is passed in, so the module unit-tests with plain values and
imports no `electron`.

**`src/main/index.ts`.** `selectWindowPresentation` is called once at the composition root beside
`selectRelayPolicy`, and the resulting value is passed into `createWindow` (a new parameter) from
`openWindow` — so the dock-reopened window of the `activate` handler gets the same presentation as the
first one, with no second decision site. Inside `createWindow`, `presentation === 'hidden'` does two
things and nothing else:

1. the `ready-to-show → show()` listener is not attached, so the window is never shown (`show: false` in
   the constructor options is already there and is unchanged);
2. `webPreferences.backgroundThrottling` is `false`. This is the Electron-level half of lever (a) and the
   half that actually matters for a never-shown window: it is the only knob that keeps the Page Visibility
   API reporting visible, so timers, transitions and Playwright's own rAF-based stability check keep
   running. On the `'shown'` path it is `true`, which is the documented default — a packaged build's
   window options are unchanged in effect.

Nothing else in `createWindow` moves: `sandbox`, `contextIsolation`, the `will-navigate` guard, the
`setWindowOpenHandler` deny, and the built-vs-dev renderer choice are all untouched.

**The two launch sites** each swap their `electron.launch(...)` for `launchIsolatedApp(...)` with the
identical argument they pass today. `launchPairedApp.ts` changes on one line plus its import;
`smoke.spec.ts` changes on one line plus its import, and its fixture starts yielding
`{ page, app }` instead of a bare `page` so the smoke site can be asserted on too.

## State + concurrency model

No store slice, no async task, no stream. `launchIsolatedApp` is one `await` that returns the same
`ElectronApplication` the callers hold today, so every existing teardown path is unchanged: the paired
fixture's LIFO drain still pushes `app.close()` in the same position, and `smoke.spec.ts`'s nested
`try`/`finally` still reaps the app before the dir. The main-process change adds no listener — it removes
one (`ready-to-show`) on the hidden path — and no timer.

`backgroundThrottling: false` keeps the renderer's timers running while the window is not visible. That is
the whole point on the hidden path, and it is confined to it.

## Error handling

No new failure mode is introduced and no result type changes. `launchIsolatedApp` does not catch: an
Electron launch failure must keep propagating to the caller's existing handling, which is what reaps the
`--user-data-dir` in both fixtures. Nothing in the new module logs, prints, or attaches argv or env to the
report — both carry `--user-data-dir=<path>`, and `smoke.spec.ts` already discards close errors unlogged
for that exact reason.

`selectWindowPresentation` is total: every input that is not (`!isPackaged` and the flag exactly `'1'`)
returns `'shown'`.

## Testing strategy

Vitest (node environment, plain values — the `relayPolicy.test.ts` / `secretBackend.test.ts` shape):

- `src/main/windowPresentation.test.ts` — packaged + flag set → `'shown'` (the packaged build cannot be
  made to take the flag, which is the security question the label was applied for); unpackaged + flag
  `'1'` → `'hidden'`; unpackaged + unset / `''` / `'0'` / `'true'` → `'shown'`; packaged + flag unset →
  `'shown'`.

Playwright, default tier (the only tier that can observe a real launched window):

- `e2e/desktop-isolation.spec.ts`
  - *isolation is in effect after the full pairing drive* — takes the `launchPairedApp` fixture (whose
    resolution IS the completed welcome CTA → paste → Pair → fingerprint card → Confirm → row click →
    Send-enabled drive) and then calls `expectDesktopIsolated`. One test covers AC1 for launch site 1 and
    AC2 in full: the window was never shown, and the whole drive ran anyway.
  - *every default-tier launch goes through the shared place* — reads every `e2e/**/*.ts` file and asserts
    the set containing an `electron.launch(` call is exactly `{ fixtures/desktopIsolation.ts,
    fixtures/realDaemon.ts }`, the second being the out-of-scope `real-*` tier. This is the deterministic
    detector for AC1's second consequence ("adding a launch site that skips it"), which an in-app read-back
    structurally cannot see; the in-app read-back above is what covers the first ("dropping it"). The
    guard's own file is excluded by name — it contains the needle in its own source.
- `e2e/smoke.spec.ts` — a third test calling `expectDesktopIsolated` on its own launch, covering AC1 for
  launch site 2. It reuses the existing fixture rather than adding a launch.

Fakes over mocks throughout: the vitest cover passes plain objects for `isPackaged`/`env`, and the e2e
cover asserts against a real launched Electron app rather than a double.

**AC3 (`npm run e2e` fully green) is the verifier's gate, not this run's.** Within this run the specs most
likely to notice a change in window presentation are exercised directly — `message-copy.spec.ts` (a real
`navigator.clipboard.writeText` from the renderer), `composer-paste-image.spec.ts` (a real OS-clipboard
paste through `webContents.paste()`), `thread-scroll-pin.spec.ts` and `attachment-image-thumbnail.spec.ts`
(image decode + scroll geometry), plus `smoke.spec.ts` and the new spec.

## Open questions

1. **Does `navigator.clipboard.writeText` still resolve in a never-shown window?** Chromium refuses the
   async clipboard write when `document.hasFocus()` is false, and `message-copy.spec.ts`'s own header
   describes its window as focused. `backgroundThrottling: false` makes the page report *visible*, which
   is not the same property as *focused*. Resolved empirically in Phase B by running that spec. If it
   reddens, the fallback is a value change at the same seam and not a redesign: add `'inactive'` to
   `WindowPresentation`, backed by `showInactive()` — shown, never activated, never frontmost, still
   taking none of the operator's keystrokes. That satisfies AC2's headline ("never frontmost") while
   departing from its parenthetical ("never shown, or hidden"), so taking it means a `## Revisions` entry
   here and an explicit note in the PR body.
2. **Do image decode and scroll geometry survive a never-shown window?** `thread-scroll-pin.spec.ts` polls
   `naturalWidth` and a drawn box height, and `attachment-image-thumbnail.spec.ts` depends on decode.
   Resolved empirically in Phase B by running both.
3. **Is `--disable-backgrounding-occluded-windows` doing anything once the window is never shown?** It is
   kept regardless: it costs one argv entry, it is the switch that matters if question 1 forces the
   `showInactive` fallback, and dropping a switch from the trio would weaken the read-back for no gain.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings, but the boundary is real and is named here rather than assumed away:
  `process.env` is attacker-controllable by anything already running as the user, and this ticket adds a
  second env var that changes shipped-process behaviour. `selectWindowPresentation` reads it only after
  `isPackaged` has been checked **false-first**, so a packaged build never consults it — the exact bound
  `selectRelayPolicy` and `selectSecretEncryption` already hold. The residual case (an attacker who can
  make a packaged build report `isPackaged === false`) requires write access to the app bundle, which is a
  compromise that subsumes this flag entirely; it is the same residual the two precedents accept. Accepted
  cost, also matching precedent: an operator who exports the flag globally gets a `npm run dev` window that
  never appears.
- [Electron attack surface] **The finding this label was applied for, and the reason the gate is
  false-first rather than merely consistent:** a window that is never shown while the app is otherwise
  fully live — IPC handlers registered, daemon session connected, secrets readable — is an *invisible
  paired client*. If a packaged build could be made to take the flag, an attacker with env control would
  have a way to run the operator's paired client with no visible surface. It cannot: `selectWindowPresentation`
  returns `'shown'` on `isPackaged` before reading `env` at all, and `src/main/windowPresentation.test.ts`
  asserts the packaged-plus-flag-set case explicitly rather than only the happy paths. Nothing else in the
  window's posture moves — `sandbox: true`, `contextIsolation: true`, the `will-navigate` same-target
  guard and `setWindowOpenHandler`'s deny are untouched, no `nodeIntegration` is introduced, and no IPC
  channel, `contextBridge` API, or protocol handler is added. `backgroundThrottling: false` is reachable
  only on the hidden path; it keeps timers running while not visible, which is a CPU/battery property, not
  a privilege one.
- [Electron attack surface] No findings on the read-back, and the shape is deliberate: `app.commandLine`
  is read **only inside `app.evaluate` from the test side**. No production code gains a way to read the
  launch command line, so this ticket adds no route by which a launch-time switch can influence shipped
  behaviour. The three Chromium switches are applied by the harness and never by the app; a packaged app
  hand-launched with them would take them, but that is true of every Chromium switch today and is
  unchanged here.
- [Tokens, secrets, credentials] SHOULD FIX, carried into Phase B: no token, key or credential is created,
  stored, compared or moved by this change, but `launchIsolatedApp` now handles the caller's `args` and
  `env`, which carry `--user-data-dir=<path>` — the directory every persisted secret of the run lands in.
  The module must not log, print, or attach either to the Playwright report, and `readDesktopIsolation`
  must return `hasSwitch` booleans and integer counts rather than `process.argv`, which would carry that
  path into a failure diff. This is why the read-back is shaped as it is, not a stylistic choice; the
  verifier should check it landed.
- [File / storage operations] No findings — no path is derived from untrusted input. The launch-site guard
  walks a fixed repo-rooted glob under `e2e/`, reads only, and writes nothing; there is no check-then-open
  and no temp file.
- [Cryptographic primitives] Not applicable by construction — no primitive, RNG or comparison is touched,
  and `e2e/fixtures/pairingArrival.ts`, which drives the real Noise handshake and holds the payload
  hygiene contract, is unchanged by AC4 (an empty `git diff` on it is an acceptance criterion, so the
  constraint is enforced, not merely intended).
- [Network & I/O] No findings — no socket, relay URL, frame cap, timeout or TLS setting is in scope. The
  fake relay forwarder and fake daemon wiring in `launchPairedApp` is untouched apart from which function
  performs the launch.
- [Error messages, logs, telemetry] No findings beyond the Tokens item above. `expectDesktopIsolated`'s
  failure output is switch names and integer counts only — no path, no env, no pairing payload — so a red
  assertion cannot become a disclosure.
- [Concurrency] No findings — nothing async, no timer, no shared mutable state. The hidden path *removes*
  a listener (`ready-to-show`) rather than adding one, and every teardown path (the paired fixture's LIFO
  drain, `smoke.spec.ts`'s nested `try`/`finally`) keeps its current shape and ordering.
- [Threat model alignment] The one new desktop-specific threat is the invisible-live-client case above,
  addressed by the `isPackaged` gate. Malicious relay, token theft from disk, hostile daemon response and
  renderer-compromise-reaching-the-transport are all unchanged in surface by this ticket, and none is
  deferred by it. SHOULD FIX, carried into Phase B: keep the presentation decision at exactly one call
  site (the composition root, passed down through `openWindow`) so the dock-reopened window cannot
  silently diverge from the first one — two decision sites would be how a future window ends up shown
  while the tier believes it is hidden, or the reverse.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04

## Revisions

### 2026-09-04 — Open Questions resolved empirically; design unchanged

All three Open Questions were answered by running the tier rather than by reasoning, and none of them
moved the design. Recorded here because the answers are the part worth keeping — the plan's fallback was
real, and knowing it was *not* taken is what makes the shipped shape a choice rather than an accident.

1. **`navigator.clipboard.writeText` in a never-shown window: resolved, it works.**
   `e2e/message-copy.spec.ts` passes with the window never shown — the real renderer write lands on the
   real OS clipboard and the main-process read-back finds it. So Chromium's document-focus requirement for
   the async clipboard write is satisfied here, and `backgroundThrottling: false` reporting the page as
   visible is evidently enough. **The `'inactive'` / `showInactive()` fallback was NOT taken**, and
   `WindowPresentation` stays the two-member union the plan specified. AC2 is met in its strict form (never
   shown), not the weaker "never frontmost" reading the fallback would have needed.
2. **Image decode and scroll geometry: resolved, they survive.** All seven `thread-scroll-pin.spec.ts`
   tests and `attachment-image-thumbnail.spec.ts` pass, including the three that gate on a thumbnail
   actually decoding before reading scroll metrics.
3. **`--disable-backgrounding-occluded-windows` with a never-shown window: kept, as planned.** With
   question 1 resolved the switch is doing less than the other two, but it stays for the reason given: the
   trio is one contract read back as one list, and thinning it would weaken the read-back for no gain.

**Also confirmed beyond what the plan predicted:** `e2e/window-reopen-converges.spec.ts` passes, so the
dock-reopened window of the `activate` handler inherits the same presentation as the first — which is the
single-decision-site property the security review's last SHOULD FIX asked for, now observed rather than
argued.
</content>
</invoke>
