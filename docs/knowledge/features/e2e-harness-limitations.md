# E2E harness — limitations

Fixture typechecking, platform requirements and test-tier boundaries. See the [harness overview](e2e-harness.md).

## Edge cases and limitations

- **Not type-checked.** `npm run typecheck` is scoped to `src/` (via `tsconfig.node.json` / `tsconfig.web.json`); `e2e/` and `playwright.config.ts` are transpiled by Playwright at run time, not by `tsc`. Acceptable for scaffolding; a follow-up could add an `e2e/tsconfig.json` if type errors there start biting. **A concrete cost of this gap:** [#1199](https://github.com/pyrycode/pyrycode-desktop/issues/1199) landed `hostLabel` on `launchPairedApp`'s wrong argument (`LaunchPairedAppOptions`, the first, daemon-reply knobs — vs. `LaunchControl`, the second, everything named above). Esbuild's transpile-only run has no excess-property check, so the misplaced property was silently dropped, the spec's premise (a name typed into the pairing form) never happened, and every assertion that didn't read that specific value still passed. The failing assertion was the *only* evidence the setup had happened, and it was also the thing the broken setup made fail — so it could never have discriminated between "the feature is broken" and "the drive never ran" — and a since-withdrawn bug report was filed against the wrong layer before an ad-hoc `tsc --noEmit` over the spec file caught it. That one-command check is cheap enough to run on any new-scenario PR that adds a `LaunchControl`/`LaunchPairedAppOptions` property; it is not run automatically anywhere in this tier.
- **Fixture unit passes do not prove fixture types.** `npm run build` uses the same app
  TypeScript configurations, while Vitest transpiles `e2e/**/*.test.ts` without checking
  types. A separate fixture typecheck caught `readMainProcess` inferring `unknown` in
  `localListFailure.ts` despite all its regression tests passing. The explicit
  `readMainProcess<boolean>` preserves the boolean-or-sentinel inspection contract.
  Include changed helpers in focused fixture typechecking; see
  [test-tier boundaries](development-verification.md#what-each-test-tier-proves).
- **No CI today.** Electron e2e on headless Linux will need `xvfb-run`. macOS (current dev env) no longer runs plain headful: since [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067) every default-tier launch's window is never shown and its renderer is exempted from occlusion/backgrounding throttling — see [Desktop isolation](e2e-harness-desktop-isolation.md#desktop-isolation-default-tier-launches) above — which is what keeps a `workers: 1` run from being disturbed by the operator using the machine mid-run. The `forbidOnly`/`retries` knobs are CI-gated and harmless until then.
- **No `e2e:fast` variant.** Re-building on every run is accepted; a build-skipping variant is deferred until iteration pain is actually observed.
- **Every UI scenario, in order, lives in its own document.** [E2E test harness — scenario history](e2e-harness-scenarios.md) is the chronological log of every scenario and fixture extension built on this harness — #93/#94's first pairing+send drive through [#1091](https://github.com/pyrycode/pyrycode-desktop/issues/1091)'s two-fake-daemon launch — split out because this document sits at `check:docs`'s 50000-byte cap and that log was most of its bulk.

