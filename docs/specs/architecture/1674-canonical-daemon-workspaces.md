# Canonical real-daemon workspaces

## Files read

- `e2e/fixtures/realDaemon.ts` — `test`, `SpawnedDaemon`, `seedRegistry`: one temporary home supplies the workdir, registry cwd, trust seed and socket; cleanup surrounds setup.
- `e2e/real-daemon-create-channel.spec.ts` — the create-channel test: `seedCwdSubdir` distinguishes an honoured cwd from the daemon default; exact workspace labels detect split groups.
- `e2e/real-claude-permission-modal.spec.ts` — `create`: compares the returned cwd with `daemon.workdir` without exposing paths.
- `e2e/real-claude-system-prompt.spec.ts` — `createChat`: requires a unique workspace create control; the existing reset-session fixme stays excluded.
- `docs/knowledge/features/development-verification.md` — test boundaries and live-test diagnosis: skips cannot prove acceptance; codegraph unavailable means fall back to source reads.
- `docs/knowledge/features/live-e2e-runbook.md` — Current real-claude gate state: credentialed execution and counts belong to the dispatcher.
- `CLAUDE.md`, `vitest.config.ts`, `playwright.real-claude.config.ts`, `package.json` — scope, test partition and build commands.

## Change

Canonicalise `daemonHome` with the existing `realpathSync` immediately after assigning the result of `mkdtemp`, inside the existing cleanup-protected `try`. Derive `workdir` and optional `seedCwdSubdir` from that canonical parent. The returned workdir, daemon argument and default registry cwd then agree; an opted-in registry cwd remains a distinct child directory. Keep the short `/tmp/pyry-daemon-` allocation and register its original path before canonicalisation so even a resolution failure is cleaned up. Refresh the fixture and create-channel comments that incorrectly say the daemon stores raw paths. Application grouping, assertions, trust behavior and process lifecycle stay unchanged.

One deliverable, approximately 60 written lines including this plan; 0 production files, 2 existing test files, 0 new exported types, 0 consumer signature updates, 2 acceptance criteria, 0 new rejection branches. The #1413 analogue changed 71 added/23 deleted fixture lines; this change is smaller. No Figma needed for test setup. In-flight #1364 and #1544 touch other blocks of `realDaemon.ts`; neither is a dependency.

## Testing strategy

Use the existing credential-light `real-daemon-create-channel.spec.ts` as RED then GREEN against the dedicated pyry 0.27.0 binary, preserving its exact labels, unique create control and seed-subdirectory assertions. Install dependencies and build before the approved Electron launch. Run scoped fixture unit tests and `npm run build`; no full suites.

Dispatcher live acceptance remains pending under `needs-real-claude`: execute the active tests in `real-daemon-create-channel.spec.ts`, `real-claude-permission-modal.spec.ts` and `real-claude-system-prompt.spec.ts` against pyry 0.27.0 or later, recording binary version and executed/pass/skip counts. The existing system-prompt fixme is the only expected exclusion. No credentials are obtained by the builder.

## Documentation handoff

No documentation-only acceptance requirement was specified. Pending for the documentation stage: record the canonical-path fixture contract in `docs/knowledge/features/live-e2e-runbook.md` § Known limitations and gotchas, and the dispatcher’s eventual version and counts in § Current real-claude gate state.

## Revisions

### 2026-09-27 — live-gate attribution; design unchanged

The dispatcher log `2026-09-27T09-49-35-031Z_real-claude-gate_#1674.log` records
23 executed, 18 passed, 5 failed and 1 skipped at `a0777e4fe4` against base `a5da4876a6`.
All three required active tests passed (3 executed, 3 passed, 0 failed); the system-prompt
reset-session fixme was the one excluded test. The log does not record a daemon version.

All five failures reject the version before exercising effort, permission mode or queue delivery.
The three failing spec files are byte-identical to that base. Evaluating their exact revision
guards against the dedicated test binary's current `pyry 0.27.0` output rejects it on both trees.
This is a deterministic prerequisite comparison, not a credentialed base-suite rerun.
Existing [#1673](https://github.com/pyrycode/pyrycode-desktop/issues/1673) owns these release-version
parser failures; no fixture change or weakened assertion is warranted here.

Rework checks: fixture launch unit tests 5 passed; `npm run build` passed. Dispatcher handoff:
rerun the credentialed gate after #1673 lands, retaining `needs-real-claude`, and record the
executed binary version with the new counts. Documentation handoff remains pending as above.

### 2026-09-27 — second live-gate attribution; design unchanged

The newer log `2026-09-27T10-17-14-265Z_real-claude-gate_#1674.log`, at `8d61632302`
against the same base, again records 23 executed / 18 passed / 5 failed / 1 skipped.
All three required active tests passed; only the existing system-prompt fixme was excluded.
All five failures again occur in source-revision guards owned by #1673. Rechecking the
three specs confirms byte-identical contents on base, gated commit and current HEAD;
their exact guards reject the dedicated binary's current `pyry 0.27.0` output on each.
This is deterministic guard evidence, not a credentialed baseline rerun. The new log
still omits the executed daemon version. Fresh install, 5 fixture launch unit tests
and build passed. No code or assertion changes; the existing dispatcher and documentation
handoffs remain pending, with the full live gate awaiting #1673 before another run.
