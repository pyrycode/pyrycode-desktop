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
- **Add a scenario:** create `e2e/<name>.spec.ts`, import `{ test, expect }` from `./fixtures/electronApp`, and drive `page`. Keep the fixture scenario-agnostic — do not grow it with per-scenario setup. A scenario that needs **per-run env or state isolation** (extra `env`, an isolated `--user-data-dir`) declares its **own** local `test.extend` in-file and re-implements only the two hardening moves it needs (`args: ['.']`, strip `ELECTRON_RENDERER_URL`) — see [pair-to-conversation](../codebase/93.md) (#93), the first such scenario, and [smoke.spec.ts](../codebase/105.md) (#105), which forked the same shape stripped to the minimum smoke needs (no fake relay/daemon, no pairing env flags). The shared fixture stays scenario-agnostic precisely so it never couples to one scenario's launch needs — the launch machinery duplication across specs that need isolation is intentional, not a cleanup target.
- **Dependency:** `@playwright/test` (dev-only). `@playwright/test` re-exports the core `_electron` API, so no separate `playwright` import is needed.
- **Artifacts:** `test-results/` and `playwright-report/` are git-ignored (Playwright creates `test-results/` even on a passing run).

## Edge cases and limitations

- **Not type-checked.** `npm run typecheck` is scoped to `src/` (via `tsconfig.node.json` / `tsconfig.web.json`); `e2e/` and `playwright.config.ts` are transpiled by Playwright at run time, not by `tsc`. Acceptable for scaffolding; a follow-up could add an `e2e/tsconfig.json` if type errors there start biting.
- **No CI today.** Electron e2e on headless Linux will need `xvfb-run`; macOS (current dev env) runs headful with no extra setup. The `forbidOnly`/`retries` knobs are CI-gated and harmless until then.
- **Two UI scenarios have landed.** [#93](../codebase/93.md) (`e2e/pair-to-conversation.spec.ts`) drives the real pairing UI through to the conversation screen against the in-process [fake relay forwarder](fake-relay-forwarder.md) + [fake daemon](fake-daemon.md); [#94](../codebase/94.md) (`e2e/send-and-stream.spec.ts`) picks up from that `connected` end-state, sends a message, and asserts the streamed daemon reply renders — together closing the automated side of the Phase-1 milestone. Both fork a **local** `test.extend` for their per-run env + isolated `--user-data-dir` while the shared fixture stays scenario-agnostic. Two harness lessons from the first real scenario: (1) an e2e run is what catches main-process-runtime-only bugs (BoringSSL, `isPackaged`, native modules) that pass every vitest unit test — it surfaced [#101](../codebase/101.md); (2) `npm run e2e` runs **all** of `e2e/`, so a non-hermetic sibling spec fails the whole run — this is exactly what exposed the `.conversation`-at-boot `smoke.spec.ts` assertion as non-hermetic (it predated the [#80 router](app-shell.md); it only passed on the shared, pre-seeded userData), fixed in [#105](../codebase/105.md) by forking the same isolated-launch shape and retargeting the assertion to `.pairing`. New scenarios must launch with an isolated `--user-data-dir` for a hermetic start.
- **No `e2e:fast` variant.** Re-building on every run is accepted; a build-skipping variant is deferred until iteration pain is actually observed.

## Related

- [App shell (router)](app-shell.md) / [#80](../codebase/80.md) — `routeForStatus`, whose unpaired outcome the smoke test now asserts (`.pairing`).
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the shell the UI scenarios ([#93](../codebase/93.md), [#94](../codebase/94.md)) drive to after pairing; no longer what smoke asserts at boot.
- [#40 codebase notes](../codebase/40.md) · Spec: `docs/specs/architecture/40-e2e-electron-harness.md`
- [#105 codebase notes](../codebase/105.md) — made `smoke.spec.ts` hermetic on an unpaired boot (isolated `--user-data-dir` + `.pairing` assertion).
- [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md) — Electron + electron-vite emitting `out/main` · `out/renderer`, the layout the launch target depends on.
- Cross-project prior art: pyrycode `#68` shipped the same spawn+cleanup harness-primitive + one-smoke shape (Go, `internal/e2e/`), with UI scenarios as separate tickets. This mirrors that shape in TypeScript/Playwright.
