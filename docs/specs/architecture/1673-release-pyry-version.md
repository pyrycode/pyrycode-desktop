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

### 2026-09-27 — attribute the live-gate failures

No implementation change is warranted by the returned gate. Dispatcher log
`2026-09-27T10-03-05-547Z_real-claude-gate_#1673.log` tested `ffb4c2dc7c`
against base `a5da4876a6`: 23 executed, 19 passed, 4 failed, 1 skipped.
All five tests required by this ticket executed and annotated `daemon-revision`
as `0.27.0`. Permission-mode and all three queue-delivery cases passed. Effort-default
passed identity validation and failed later at the existing unscoped Create chat
locator in its chat/channel recall loop, which resolved to two buttons.

The other failures were permission-modal's `create` cwd-equality assertion,
system-prompt's `createChat` resolving two Create chat buttons, and create-channel's
workspace-label assertion receiving four identical labels instead of two.
These three specs and `realDaemon` are byte-identical to the gate's base;
effort-default's recall loop is also unchanged. The fixture seeds `/tmp` paths
while pyry canonicalises created conversation paths to `/private/tmp`, the
already tracked scope of #1674. No assertions are weakened or skipped here.

Independent evidence: dispatcher log
`2026-09-27T10-17-14-265Z_real-claude-gate_#1674.log` tested `8d61632302`
against the same base, with #1674's canonical-path correction. Permission-modal,
the active system-prompt case and create-channel all passed. Its five failures
were the old version checks fixed here. This is a neighbouring-branch comparison,
not a same-tree rerun or a pristine-base run. Effort-default's duplicate-button
failure fits the same workspace split, but that attribution still needs a live
run containing both fixes: #1674 alone rejects its release version first.

The ticket-specific live requirement (all five execute without version rejection)
is evidenced. The full live suite is still red. Keep `needs-real-claude`; the
dispatcher must validate a tree containing both #1673 and #1674 and record its
revision, daemon version and executed/pass/fail/skip counts. Rerunning either
branch alone reproduces the other's known failure and does not establish a new
regression. Documentation handoff above remains pending.

This rework adds only this evidence entry (0 production files, types, consumers
or rejection branches). Codegraph was unavailable, so file reads and Git diffs
supplied the comparison. The refreshed branch check still finds only #1544
overlapping the permission-mode spec; no implementation edits are needed.
