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
| `e2e/fixtures/electronApp.ts` | The reusable primitive. `test.extend` adds two fixtures: `electronApp` (`ElectronApplication`) and `page` (`Page`, the main window). This is what follow-up scenarios import. |
| `e2e/smoke.spec.ts` | The single smoke assertion: `expect(page.locator('.pairing')).toBeVisible()`, launched through its own isolated-userData fixture (see below), not the shared `electronApp.ts` — see [#105](../codebase/105.md). |

### The launch fixture (the reusable primitive)

`e2e/fixtures/electronApp.ts` re-exports a Playwright `test` extended with:

- **`electronApp`** — `electron.launch({ args: ['.'], env })` → `use(app)` → `app.close()`. `args: ['.']` resolves through `package.json` `main` → `out/main/index.js`, so it launches the *built* app with no path math. The `close()` after `use()` is the teardown.
- **`page`** — `electronApp.firstWindow()` → `use(page)`. `firstWindow()` resolves when the first `BrowserWindow` is created, even though the window opens `show: false` (it shows on `ready-to-show`).

Scenarios import `{ test, expect }` from `./fixtures/electronApp` and get `page` for free:

```ts
import { test, expect } from './fixtures/electronApp'

test('…', async ({ page }) => { /* drive the real window */ })
```

**Why the built renderer gets exercised.** `createWindow` (`src/main/index.ts:50-68`) computes `devRendererUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']`. Under `electron.launch` the app is **not packaged**, so the built-vs-dev choice hangs purely on that env var. The fixture therefore launches with a copy of `process.env` that has `ELECTRON_RENDERER_URL` **deleted** — if the var leaked from a dev shell, `createWindow` would `loadURL` a non-running dev server instead of `loadFile('out/renderer/index.html')`, and the smoke test would hang until timeout. Stripping it makes the launch deterministic against the built renderer.

### Deterministic teardown

Teardown runs through Playwright's fixture lifecycle (the code after `use()`), which fires on **pass and fail** alike — a failing test can never orphan an Electron process, and there is no manual `afterEach`. With `workers: 1`, apps launch serially and each test's `electronApp`/`page` scope one app process that is torn down before the next launches. Playwright owns the process handle; no `AbortController` is needed.

### Two-way separation from the vitest unit run

`npm test` (vitest) must stay fast and headless-safe and must never collect the Playwright specs; the Playwright runner must never collect the `src/` unit files. Both directions are enforced structurally:

- **Playwright → only `e2e/`:** `testDir: './e2e'` in `playwright.config.ts`.
- **vitest → only `src/`:** `include: ['src/**/*.{test,spec}.{ts,tsx}']` in `vitest.config.ts`. vitest's `include` **replaces** the default glob (it is not additive), so vitest never walks `e2e/`. Every existing `*.test.ts(x)` lives under `src/`, so none is dropped.

## Configuration and usage

- **Run the suite:** `npm run e2e` = `npm run build && playwright test`. The build is chained so e2e never runs against a stale `out/` — a silently-stale build is a worse failure than a slower run.
- **Precondition when bypassing the script:** running `npx playwright test` directly against a clean tree fails fast with Electron's "Unable to find application" (there is no `out/`). The sanctioned entrypoint is `npm run e2e`.
- **Add a scenario:** create `e2e/<name>.spec.ts`, import `{ test, expect }` from `./fixtures/electronApp`, and drive `page`. Keep the fixture scenario-agnostic — do not grow it with per-scenario setup. A scenario that needs **per-run env or state isolation** (extra `env`, an isolated `--user-data-dir`) either drives a real fake-daemon pairing flow — in which case it imports the shared **`launchPairedApp`** fixture (`e2e/fixtures/launchPairedApp.ts`, [#433](../codebase/433.md)) rather than forking its own harness — or, if it needs isolation without the fake-daemon pairing drive, declares its **own** local `test.extend` in-file re-implementing only the two hardening moves it needs (`args: ['.']`, strip `ELECTRON_RENDERER_URL`) — see [smoke.spec.ts](../codebase/105.md) (#105), which forked the same shape stripped to the minimum smoke needs (no fake relay/daemon, no pairing env flags). The shared `electronApp.ts` fixture itself stays scenario-agnostic precisely so it never couples to one scenario's launch needs.
- **Dependency:** `@playwright/test` (dev-only). `@playwright/test` re-exports the core `_electron` API, so no separate `playwright` import is needed.
- **Artifacts:** `test-results/` and `playwright-report/` are git-ignored (Playwright creates `test-results/` even on a passing run).

## Edge cases and limitations

- **Not type-checked.** `npm run typecheck` is scoped to `src/` (via `tsconfig.node.json` / `tsconfig.web.json`); `e2e/` and `playwright.config.ts` are transpiled by Playwright at run time, not by `tsc`. Acceptable for scaffolding; a follow-up could add an `e2e/tsconfig.json` if type errors there start biting.
- **No CI today.** Electron e2e on headless Linux will need `xvfb-run`; macOS (current dev env) runs headful with no extra setup. The `forbidOnly`/`retries` knobs are CI-gated and harmless until then.
- **Two UI scenarios have landed.** [#93](../codebase/93.md) (`e2e/pair-to-conversation.spec.ts`) drives the real pairing UI against the in-process [fake relay forwarder](fake-relay-forwarder.md) + [fake daemon](fake-daemon.md); [#94](../codebase/94.md) (`e2e/send-and-stream.spec.ts`) picks up from the same connected thread, sends a message, and asserts the streamed daemon reply renders — together closing the automated side of the Phase-1 milestone. Two harness lessons from the first real scenario: (1) an e2e run is what catches main-process-runtime-only bugs (BoringSSL, `isPackaged`, native modules) that pass every vitest unit test — it surfaced [#101](../codebase/101.md); (2) `npm run e2e` runs **all** of `e2e/`, so a non-hermetic sibling spec fails the whole run — this is exactly what exposed the `.conversation`-at-boot `smoke.spec.ts` assertion as non-hermetic (it predated the [#80 router](app-shell.md); it only passed on the shared, pre-seeded userData), fixed in [#105](../codebase/105.md) by forking the same isolated-launch shape and retargeting the assertion to `.pairing`. New scenarios must launch with an isolated `--user-data-dir` for a hermetic start.
  - **Both scenarios were later found red on `main`** ([#140](../codebase/140.md)'s `PairedShell` nav-shell changed the paired route's entry point to the ChannelList (`route='list'`), not straight into `ConversationScreen` — so the post-Confirm `.conversation`/Send assertions both timed out, invisibly, since `npm run e2e` is not CI-gated). [#435](../codebase/435.md) repaired both: the fake daemon seeds a one-row `conversations` reply (via `buildReply`/`buildReplyFrames`) so ChannelList has a clickable `.channel-list__row-open` row, and each spec drives that real row click before asserting `.conversation`/Send — the row's Playwright auto-wait doubles as a connected gate, since the seed only arrives on the connected rising edge. #94 additionally had drifted a *second*, independent way (post-#140 renames in [#179](../codebase/179.md)/[#245](../codebase/245.md)/[#203](../codebase/203.md) moved message rendering from `data-message-role` to the timeline's `data-thread-role`, and retired the coarse `message` reply in favor of `[assistant_delta, turn_end]`) — both fixed in the same ticket. The lesson: a long-red e2e can accumulate more than one layer of staleness past its first failing assertion.
  - **Both scenarios' file-local `test.extend` forks were then extracted into one shared factory fixture**, `e2e/fixtures/launchPairedApp.ts` ([#433](../codebase/433.md)) — the #435 repaired drive (paste → Pair → Confirm → seed-row-click → Send-enabled) plus the launch/env/user-data-dir plumbing, all fixture-owned now. `pair-to-conversation.spec.ts` went thin; `send-and-stream.spec.ts` keeps its own reply-frame builders but scripts them through the fixture's `LaunchPairedAppOptions` (an `Omit<FakeDaemonOptions,'url'>` passthrough) and reuses the fixture's exported `seedConversationsFrame()` for its own default arm. This is the harness a future fake-daemon UI scenario (the #422–#429/#434/#420 batch) should import — not `electronApp.ts`, and not a fresh local fork.
- **No `e2e:fast` variant.** Re-building on every run is accepted; a build-skipping variant is deferred until iteration pain is actually observed.
- **A fourth scenario, gated out of the default run.** [#252](../codebase/252.md)'s
  [real-claude liveness e2e](real-claude-liveness-e2e.md) (`e2e/real-claude.spec.ts`) drives a real
  `pyry` + real `claude` instead of the fake relay/daemon pair. It is excluded from `npm run e2e` via
  a `testIgnore` in `playwright.config.ts` and runs only under its own
  `playwright.real-claude.config.ts` via `npm run e2e:real-claude` — the first scenario to need a
  second config rather than fitting inside the shared one.
  - **Its spawn recipe was later extracted into its own shared fixture**, `e2e/fixtures/realDaemon.ts`
    ([#420](../codebase/420.md)) — the real-stack counterpart of `launchPairedApp.ts` (#433): the
    `relay → daemon → page` chain (binary resolution, skip-gating, `seedRegistry`, spawn args,
    `waitForDaemonReady`, process-group reap) moved verbatim so the coming tier-2/tier-3 real-* specs
    (real-daemon-actions, interrupt/queue, permission modal) reuse it. Both configs' `real-*`
    partition widened together — `playwright.real-claude.config.ts`'s `testMatch` and
    `playwright.config.ts`'s `testIgnore` both went from `/real-claude\.spec\.ts$/` to
    `/real-.*\.spec\.ts$/` — so a future `real-*` spec can't leak into the daemon-less default
    `npm run e2e`. Unlike `launchPairedApp`, the pairing/drive body stayed in the spec; only the spawn
    recipe (AC1's scope) moved.
  - **The fixture then grew a second, credential-light spawn mode.** [#439](../codebase/439.md) added two
    additive Playwright option fixtures (`spawnClaude`, `seedPromoted`) to `realDaemon.ts`, so a spec can
    opt into a real `pyry` daemon with **no** `claude` and **no** Anthropic credential — see
    [real-daemon credential-light e2e](real-daemon-credential-light-e2e.md). `real-claude.spec.ts` sets
    neither option and keeps its exact prior behavior.

## Related

- [App shell (router)](app-shell.md) / [#80](../codebase/80.md) — `routeForStatus`, whose unpaired outcome the smoke test now asserts (`.pairing`).
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the shell the UI scenarios ([#93](../codebase/93.md), [#94](../codebase/94.md)) drive to after pairing; no longer what smoke asserts at boot.
- [#40 codebase notes](../codebase/40.md) · Spec: `docs/specs/architecture/40-e2e-electron-harness.md`
- [#105 codebase notes](../codebase/105.md) — made `smoke.spec.ts` hermetic on an unpaired boot (isolated `--user-data-dir` + `.pairing` assertion).
- [#433 codebase notes](../codebase/433.md) — extracted `launchPairedApp`, the shared fake-daemon pairing fixture both #93 and #94 now import; the intended home for future fake-daemon UI scenarios.
- [#435 codebase notes](../codebase/435.md) — repaired the list→thread drive #433 later extracted.
- [#420 codebase notes](../codebase/420.md) — extracted `e2e/fixtures/realDaemon.ts`, the real-stack sibling of `launchPairedApp.ts`, from `real-claude.spec.ts`; the intended home for future real-* scenarios.
- [#439 codebase notes](../codebase/439.md) / [Real-daemon credential-light e2e](real-daemon-credential-light-e2e.md) — added the claude-less spawn mode to `realDaemon.ts` and the first credential-light real-* scenario.
- [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md) — Electron + electron-vite emitting `out/main` · `out/renderer`, the layout the launch target depends on.
- Cross-project prior art: pyrycode `#68` shipped the same spawn+cleanup harness-primitive + one-smoke shape (Go, `internal/e2e/`), with UI scenarios as separate tickets. This mirrors that shape in TypeScript/Playwright.
