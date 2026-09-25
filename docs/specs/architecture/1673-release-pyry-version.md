# #1673 — Real-claude specs accept a release-build pyry version string

## Files read

- `e2e/real-claude-effort-default.spec.ts` → the `applied effort, confirmed preference…` test's `pyry version` parse — call site 1.
- `e2e/real-claude-permission-mode.spec.ts` → the `operator bypass stays confirmed…` test's parse — call site 2; `revision` also feeds its `daemonRevision` evidence attachment.
- `e2e/real-claude-queue-delivery.spec.ts` → the `real claude ${scenario.name}` loop's parse — call site 3 (three tests); `revision` also feeds `daemonRevision`.
- `e2e/fixtures/daemonCapabilityGate.ts` + `.test.ts` → the analogue: a pure harness helper under `e2e/fixtures/` with a vitest file beside it.
- `vitest.config.ts` → `include` already takes `e2e/**/*.test.ts`, so the new test runs with no config change.

## Design source

N/A — test-only harness change, nothing UI-visible.

## Change

Add `e2e/fixtures/daemonVersion.ts` exporting `daemonIdentity(stdout: string): string`. It accepts `pyry dev-<hex>` / `pyry <hex>` (7–40 lowercase hex, returns the hex) and `pyry <major>.<minor>.<patch>` with an optional leading `v` and an optional semver pre-release (`-…`) and build (`+…`) suffix (returns the version without the `v`, e.g. `0.27.0`). Trailing whitespace is tolerated as before. Anything else throws one `Error` whose message (exported as `DAEMON_IDENTITY_REJECTION`) names both accepted forms and never echoes the stdout. Throwing rather than returning `null` lets the specs drop their `revision!` assertions.

Each of the three specs replaces its regex + `expect(...).toBeTruthy()` pair with `const revision = daemonIdentity(stdout)`. The throw happens before `withIsolatedElectronApp` / any page use, so a bad string still fails before the app launches. The `daemon-revision` annotation, the attachment and the `daemonRevision` evidence fields keep their names and now carry either the revision or the version.

Overlap: `origin/feature/1544` also touches `real-claude-permission-mode.spec.ts`; the edit here is a local swap of the parse lines, not a dependency.

## Testing strategy

New `e2e/fixtures/daemonVersion.test.ts` (vitest):
- `pyry dev-<hex>`, `pyry <hex>` → hex; 7 and 40 digits accepted.
- `pyry 0.27.0\n`, `pyry v0.27.0` → `0.27.0`; pre-release/build suffix kept (`1.2.3-rc.1+abc`).
- `''`, `pyry`, `pyry 0.27`, `pyry dev-XYZ` → throws `DAEMON_IDENTITY_REJECTION`, which names both forms.

AC3 (the live gate executes the five tests on `pyry 0.27.0`) is the dispatcher's real-claude gate, not run here.

## Documentation handoff (pending — documentation stage)

`docs/knowledge/features/live-e2e-runbook.md` § Current real-claude gate state: record that the live specs accept a release build and log its version as `daemon-revision`, and that the gate host has run `pyry 0.27.0` since 2026-09-25.
