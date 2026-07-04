# Spec: E2E test harness that launches and drives the built Electron app (#40)

**Size:** S (3 new files + 2 small edits; ~75 lines written). This is *scaffolding only* — the launch primitive plus one smoke assertion. UI scenarios (pairing, send, stream) are follow-ups and out of scope here.

## Design source

N/A — no user-visible UI is added. This ticket delivers test infrastructure; the smoke test asserts against the *existing* `ConversationScreen` shell, which is unchanged.

## Files to read first

- `package.json` — current scripts (`test`, `build`, `typecheck`) and `main` (`./out/main/index.js`). You add one script + one devDependency; confirm the shape before editing.
- `src/main/index.ts:16-69` — `createWindow`. Load-bearing for *why the harness works*: when the app is launched **not packaged and with `ELECTRON_RENDERER_URL` unset** (the e2e case), `devRendererUrl` is `undefined` so the window does `loadFile('out/renderer/index.html')` — the built renderer. This is the exact path the harness exercises. Note the env-var subtlety (below).
- `src/renderer/src/App.tsx:1-9` — the shell: `App` mounts `ConversationScreen`. "Shell renders" = this mounts in the launched window.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:12-19` — the root element is `<div className="conversation">`. **`.conversation` is the DOM anchor the smoke test asserts on.**
- `vitest.config.ts` — the file you edit to keep vitest scoped to `src/` (add an `include`). Currently it has no `include`, so it would otherwise collect `e2e/*.spec.ts`.
- `electron.vite.config.ts` — confirms the build emits `out/main`, `out/preload`, `out/renderer`. No change needed here.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` — the existing unit-test idiom (vitest + `renderToStaticMarkup`). The e2e smoke test is a *different* layer (real Electron DOM via Playwright), but keep naming/style consistent with the repo.

## Context

The repo has unit coverage under `src/main/` and `src/shared/` (vitest, `npm test`), but nothing launches the assembled Electron app and inspects its rendered window. Before the connect-send-stream milestone grows UI flows worth asserting end-to-end, we need the harness those scenarios will hang off of. Cross-project prior art: `pyrycode` #68 shipped a spawn+cleanup harness primitive plus one smoke, with scenarios as separate tickets. We mirror that shape.

This ticket delivers the config, a reusable launch fixture, and a single smoke assertion that the app boots and its shell renders. Actual UI scenarios are follow-ups.

## Decision summary

| Choice | Decision | Why |
|---|---|---|
| Tool | `@playwright/test` (`_electron` API) | Ticket-recommended; `_electron.launch` drives real Electron + renderer DOM. |
| Browser download | **None** — do *not* run `npx playwright install` | `_electron.launch` uses the project's own `electron` binary, not Playwright's bundled Chromium. Keeps install light. |
| E2E location | top-level `e2e/` | Outside every `src/` unit glob; two-way separation from vitest. |
| Launch target | `electron.launch({ args: ['.'] })` | `.` resolves via `package.json` `main` → `out/main/index.js`. Satisfies "launch the built app" with no path math. |
| Build coupling | `npm run e2e` = `npm run build && playwright test` | Deterministic: never tests a stale `out/`. A silently-stale build is a worse failure than a slower run. |
| Parallelism | `workers: 1`, `fullyParallel: false` | Serialize Electron launches — one app process at a time. Deterministic, no resource contention for future multi-file scenarios. |
| Shell anchor | `.conversation` element visible | The `ConversationScreen` root; presence proves the shell mounted. |

## Design

### New file: `playwright.config.ts` (repo root)

Playwright config, TypeScript. Contract (not full body — Playwright's `defineConfig`):

- `testDir: './e2e'` — Playwright only scans `e2e/`, never `src/`. This is half of the two-way vitest separation (AC4): Playwright never picks up `src/**/*.test.ts`.
- `fullyParallel: false`, `workers: 1` — one Electron app at a time.
- `forbidOnly: !!process.env.CI`, `retries: process.env.CI ? 1 : 0` — standard hygiene; harmless with no CI today.
- `reporter: 'list'` — minimal.
- Leave the default 30 s test timeout; first-window + React mount is sub-second once built.
- No `projects`/`use.browserName` block — Electron launches its own binary; a browser project would be dead config.

### New file: `e2e/fixtures/electronApp.ts` — the reusable primitive

This is the scenario-agnostic launch/teardown fixture that follow-up scenarios import. Built with Playwright's `test.extend` so teardown runs through the runner's fixture lifecycle (fires on pass *and* fail — the deterministic teardown AC4 wants, no manual `afterEach`).

Contract (exported surface):

```ts
// Fixtures added on top of Playwright's base test:
type ElectronFixtures = {
  electronApp: ElectronApplication  // the launched app; closed automatically after each test
  page: Page                        // electronApp.firstWindow() — the main renderer window
}

export const test: TestType<...>   // base.extend<ElectronFixtures>(...)
export { expect } from '@playwright/test'
```

Behaviour of each fixture (bodies are ~4 lines each — do not expand):

- `electronApp`: `await electron.launch({ args: ['.'] })` → `await use(app)` → `await app.close()`. The `close()` after `use()` is the teardown; Playwright runs it even when the test body throws. `electron` is `_electron` imported from `@playwright/test`.
- `page`: `await electronApp.firstWindow()` → `await use(page)`. `firstWindow()` resolves when the first `BrowserWindow` is created (it resolves even though the window is created with `show: false`; it shows on `ready-to-show`).

Import note: `import { test as base, expect, _electron as electron } from '@playwright/test'`. `@playwright/test` re-exports the core `_electron` API — no separate `playwright` import needed.

**Env determinism (harden the launch):** the fixture must ensure the child Electron process does **not** inherit a stray `ELECTRON_RENDERER_URL`. If that var is set in the invoking shell, `createWindow` would try to `loadURL` a (non-running) dev server instead of `loadFile` the built renderer, and the smoke test would hang. Launch with an env that drops it, e.g. pass `env` to `electron.launch` derived from `process.env` with `ELECTRON_RENDERER_URL` deleted. One line; prevents a confusing intermittent failure. (`app.isPackaged` is already `false` in this launch mode, so the built-renderer path is gated purely on that env var.)

### New file: `e2e/smoke.spec.ts` — the single smoke assertion

Imports `{ test, expect }` from `./fixtures/electronApp`, so it gets `page` for free. One test:

- **"the app shell renders in the launched window"** — given the built app is launched (via fixture), the `page` for the first window exists, and `expect(page.locator('.conversation')).toBeVisible()` passes within the default timeout. The locator auto-waits, absorbing React's async mount after `DOMContentLoaded`. No `page` teardown code in the test — the fixture owns lifecycle.

Optionally assert the window opened at all (`expect(page).toBeTruthy()` is implicit; a title check `await expect(page).toHaveTitle('Pyrycode Desktop')` is a cheap secondary signal but not required). Keep the test to the one shell assertion the AC demands.

### Edit: `vitest.config.ts` — scope the unit run to `src/`

Add to the `test` block:

```ts
include: ['src/**/*.{test,spec}.{ts,tsx}']
```

vitest `include` **replaces** the default glob (it is not additive), so this makes `npm test` collect only `src/` — it never walks `e2e/`. This is the other half of AC4: `npm test` (vitest) does not execute e2e tests. Verified safe: every existing `*.test.ts(x)` in the repo lives under `src/`, so no current test is dropped.

### Edit: `package.json`

- Add script: `"e2e": "npm run build && playwright test"`.
- Add devDependency: `@playwright/test` (a recent 1.x). Install with `npm install -D @playwright/test`; **do not** run `npx playwright install` (no browsers needed for Electron).

## State + concurrency model

No app state changes — the harness is a test-side process supervisor. Concurrency model is entirely Playwright's: `workers: 1` means Electron apps launch serially; each test's `electronApp`/`page` fixtures scope one app process to one test, torn down before the next launches. No shared mutable state between tests. Teardown is `ElectronApplication.close()`, driven by the fixture `use()` lifecycle — deterministic on pass and fail, so a failing test cannot orphan an Electron process (AC2/AC4). No `AbortController` needed; Playwright owns the process handle.

## Error handling

Test-harness failure modes and how each surfaces:

- **`out/main/index.js` missing (build not run):** cannot occur via `npm run e2e` — the script chains `npm run build` first. If a developer runs `npx playwright test` directly against a clean tree, `electron.launch({ args: ['.'] })` fails fast with Electron's "Unable to find application" error. Acceptable; the sanctioned entrypoint is `npm run e2e`.
- **Window never opens / renderer errors:** `firstWindow()` or the `.conversation` locator times out (30 s) → the test fails with Playwright's timeout diagnostic. No silent pass.
- **Stray `ELECTRON_RENDERER_URL`:** neutralised by the fixture stripping it from the child env (above).
- **Orphaned process on failure:** prevented by fixture-lifecycle teardown, not manual cleanup.

There is no in-app UI error surface to design here — failures are test failures reported by the Playwright runner.

## Testing strategy

The deliverable *is* a test. Layering:

- **`npm test` (vitest, unchanged behaviour):** stays fast and headless-safe. After the `include` edit, confirm it still collects the existing `src/` suites and does **not** collect `e2e/` (run it; expect the same suite count as before, no Playwright import errors).
- **`npm run e2e` (new):** builds, then runs `e2e/smoke.spec.ts` — one passing smoke assertion against the real launched app. This is the acceptance evidence for AC1–AC4.
- **Separation proof (AC4):** demonstrate both directions — `npm test` output shows no `smoke` test; `npm run e2e` output shows no `src/` unit tests.
- **No new unit tests** — there is no new production `src/` code to unit-test. The fixture and smoke are the coverage.

`npm run typecheck` is unchanged and scoped to `src/` (via `tsconfig.node.json` / `tsconfig.web.json`); it does **not** type-check `e2e/` or `playwright.config.ts`. That is acceptable for scaffolding — Playwright transpiles the e2e sources at run time. See Open questions.

## Open questions

- **E2E type coverage.** `e2e/` and `playwright.config.ts` are transpiled by Playwright but not type-checked by `npm run typecheck` (scoped to `src/`). A follow-up could add an `e2e/tsconfig.json` and fold it into `typecheck` if type errors there start biting. Out of scope now — do not widen the tsconfig this ticket.
- **CI / headless Linux.** There is no CI today. When one is added, Electron e2e on headless Linux needs `xvfb-run`; macOS (current dev env) runs headful with no extra setup. Not scoped here.
- **`e2e:fast` variant.** If re-building on every `npm run e2e` becomes a real iteration pain once scenarios accumulate, a `e2e:fast` script that skips the build could be added. No observed pain yet — defer (evidence-based; don't build the escape hatch preemptively).
