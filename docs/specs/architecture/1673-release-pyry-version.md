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

## Revisions

### 2026-09-27 — validate before requesting an Electron page

The verifier found that the permission-mode test's `page` fixture calls
`withIsolatedElectronApp` before entering the test body. The original plan's
“before any page use” claim therefore did not guarantee validation before launch.
Remove `page` from that test's fixture dependencies and wrap its page-driven work
in `withIsolatedElectronApp` after `daemonIdentity` succeeds, retaining listener
cleanup inside the application's lifetime. The effort and queue tests already
use this ordering.

Add a Vitest regression that loads the actual permission-mode test with mocked
registration and version-command boundaries. Invalid stdout must throw the shared
rejection message without requesting the eager page fixture or calling the explicit
app launcher. This test requires neither Electron nor Claude. Run it RED before
changing the spec, then run both affected unit files and the build; the dispatcher
still owns live execution of the five affected tests.

The refreshed overlap check still finds #1544; its permission-flow rewrite is
already represented in this checkout, and this local launch-order correction
needs no additional interface from that branch. The rework remains one deliverable:
0 production files, approximately 180 additional written lines including the
reindented test body, 0 new exported types/components/stores, 1 consumer, 3 original
acceptance criteria and 1 existing rejection branch. No open design questions.
