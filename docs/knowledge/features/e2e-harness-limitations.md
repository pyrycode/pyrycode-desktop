# E2E harness — limitations

Fixture typechecking, platform requirements and test-tier boundaries. See the [harness overview](e2e-harness.md).

## Edge cases and limitations

- **Application and client-test typechecks have different scopes.** `npm run typecheck`
  and `npm run build` use the app projects (`tsconfig.node.json` /
  `tsconfig.web.json`), which exclude `e2e/`. The supplementary
  `npm run typecheck:client-tests` uses `tsconfig.client-tests.json`: real scenarios,
  `recorded-clients.spec.ts`, capture specs and their imports, plus declared preload
  and Noise types. It does not check every browser spec or `playwright.config.ts`.
  Playwright transpilation alone performs no typecheck. A concrete historical cost:
  [#1199](https://github.com/pyrycode/pyrycode-desktop/issues/1199) put `hostLabel` on
  `launchPairedApp`'s first argument (`LaunchPairedAppOptions`) instead of its second
  (`LaunchControl`). Transpilation silently dropped the setup property; only an
  ad-hoc `tsc --noEmit` check identified the wrong argument. Check changed scenario
  constructors within a TypeScript project that actually includes them.
- **Fixture unit passes do not prove fixture types.** `npm run build` uses the same app
  TypeScript configurations, while Vitest transpiles `e2e/**/*.test.ts` without checking
  types. A separate fixture typecheck caught `readMainProcess` inferring `unknown` in
  `localListFailure.ts` despite all its regression tests passing. The explicit
  `readMainProcess<boolean>` preserves the boolean-or-sentinel inspection contract.
  The client-test project follows scenario imports but does not include fixture
  `*.test.ts` inputs. In the [scalar evidence repair](../../specs/architecture/2119-tool-content-evidence.md#revisions),
  a separate scratch project including all three affected unit suites caught stale
  correlation fields and incomplete queue item/hello constructors despite passing
  runtime tests and a clean client-test compiler run. Keep regression constructors
  typed against the real IPC/wire unions, and check the unit inputs separately
  without weakening those unions or the existing client compiler coverage.
  Include changed helpers and unit inputs in focused fixture typechecking; see
  [test-tier boundaries](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves).
- **No CI today.** Electron e2e on headless Linux will need `xvfb-run`. macOS (current dev env) no longer runs plain headful: since [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067) every default-tier launch's window is never shown and its renderer is exempted from occlusion/backgrounding throttling — see [Desktop isolation](e2e-harness-desktop-isolation.md#desktop-isolation-default-tier-launches) above — which is what keeps a `workers: 1` run from being disturbed by the operator using the machine mid-run. The `forbidOnly`/`retries` knobs are CI-gated and harmless until then.
- **No `e2e:fast` variant.** Re-building on every run is accepted; a build-skipping variant is deferred until iteration pain is actually observed.
- **Every UI scenario, in order, lives in its own document.** [E2E test harness — scenario history](e2e-harness-scenarios.md) is the chronological log of every scenario and fixture extension built on this harness — #93/#94's first pairing+send drive through [#1091](https://github.com/pyrycode/pyrycode-desktop/issues/1091)'s two-fake-daemon launch — split out because this document sits at `check:docs`'s 50000-byte cap and that log was most of its bulk.
