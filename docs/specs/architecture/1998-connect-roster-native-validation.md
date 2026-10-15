# Connect-roster finished-marker validation

## Files read
- `e2e/tool-groups.spec.ts` → `connect roster Agents appear before history and keep identity through live and historical launches`: owning request capture, quiet-request barrier, historical-child commit and unchanged identity/marker/navigation assertions.
- `src/main/daemonConnection.ts` → `DaemonConnection.requestHistory`: replies identify their conversation through the original request ID, rather than their payload.
- `docs/specs/architecture/1936-visible-thread-read-marks.md` → Revisions and Rework validation: controlled shared-ID red/green proof and merged fixture repair.
- `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md` → Authoritative thread read evidence: current ownership discipline and counted complete Linux gate.
- `CLAUDE.md` and agents `docs/working-practice.md`: validation boundaries, native launcher and evidence retention.
- PR #1965 final verifier and shared #1936 builder/verifier bundles: completed Linux proof, native evidence still unverified.

## Change
Validate the existing repair from `ddb9bce8db99546129037f00713b753f603562d9`;
no production or scenario edit is planned. The old shared latest-request slot could
route seeded history into the quiet conversation, while a catch-all one-row list
reply could remove quiet ownership. The merged scenario captures requests by
host/conversation, preserves the current list, positively observes quiet's pending
request, answers the seeded request and waits for its historical child to commit.
Reuse its controlled failure (`0 tools`, expected `1 tool`) and subsequent passing
identity/finished-marker assertions rather than duplicating the regression.
Record native provenance and counted results here after inspecting exact reports.
No new state, type, lifecycle, failure branch, dependency or visual behavior is added.
The pre-plan remote-branch audit found no numeric feature branch touching
`e2e/tool-groups.spec.ts`. Size: one deliverable, two observable criteria,
under 100 written lines, zero exports or consumer changes.

## Testing strategy
- Retain all existing scenario assertions, workers, projects, timeouts and zero retries.
- Prior controlled proof: #1936 builder bundle
  `b92925fd388e40cf9b7271bf2722fd5ee74dfd4f1428bb69bd104ab671389d36`;
  final verifier [PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1965#issuecomment-6188903924)
  on `20d0f07140931f3f0aaad4977f6a186c5f761727`: complete Linux suite,
  407 executed/passed, 0 failed, 3 macOS-only skips, 0 flaky.
- Existing native task `400bbaf6852f5e7efa8c860719fcf81552c8014a58142a12f66936d55fa14a07`
  cannot be read from this admitted ticket; the service reports it unavailable or
  outside this ticket. Shared #1936 evidence contains no verified native result.
- Push the complete validation candidate and request `desktop-fake-suite` through
  the managed Mac launcher. This recipe runs the complete configured suite; extract
  the named scenario's executed/passed/failed/skipped counts separately and inspect
  configuration, revision, retries, failures, skip reasons and setup attachments.
- After the final main merge, run install, pre-verify and build. Do not replace the
  dispatcher-owned complete gate with a filtered passing run. No new live test or
  real-Claude check is required. Any queued native evidence is explicitly pending,
  never a pass; commit inspected evidence on return before native acceptance.

## Validation evidence
2026-10-15: candidate `0573bc79d97199427d6eebdf4f36f9d3785f7321`
contains main `dc55fcf5dbf361c6733a6cf1c318e65b27418c21`. Install, all five
pre-verify checks, build and docs guard passed. Units: 10,292 executed/passed,
0 failed, 3 existing skips, 408 passing files. Logs: `/tmp/builder-1998/pre-verify.log`
and `/tmp/builder-1998/build.log`. The scenario and configuration remain byte-for-byte
unchanged from merged main.
Configuration SHA256: `f2868e97d72733c286ff8c3098f09adc62e2e8bfa3ad9393e000eebf9a429d5a`,
identical to the original macOS failure. Scenario-file SHA256:
`5bcaa01b1d16335b5a97589e2e36a6be79ce44bca85ea4123c600872a8457a32`.

Native task `0234f9aa222747faa60ae91272b3c4c0a8c191f095a48b442728b5adbb6e44ce`
completed on the managed MacBook using `desktop-fake-suite` for that exact pushed
candidate. Documentation retrieved and inspected its full artifacts on 2026-10-15
at `/tmp/docs-1998-native-20261015/desktop/`: `capture.json`, `playwright.json`,
`playwright.list.log`, `execution.log`, `playwright.config.ts` and
`fake-daemon-setup.json`. The managed task retains those six files for retrieval.

The run started at 09:55:05 UTC: **429 executed, 429 passed, 0 failed, 1 skipped,
0 flaky**, four actual workers, clipboard/parallel projects, zero retries. All
430 configured cases appear in the report and listing; the command has no file,
grep, project or shard filter. The named scenario
`connect roster Agents appear before history and keep identity through live and historical launches`
was present and passed: **1 executed, 1 passed, 0 failed, 0 skipped**, retry 0,
2,587 ms. Its `launch-fate` attachment records an app running at outcome, exit
code 0, no signal and no teardown failures. `fake-daemon-setup.json` is empty
(`[]`); no setup failure or top-level report error was recorded. The sole skip is
`an independent input-enabled cover preserves isolated hover`, with reason
“a never-shown window receives no pointer from the display”.

Launcher provenance is the managed `desktop-fake-suite` recipe on machine
`macbook`; its recorded invocation is Playwright `test --config=playwright.config.ts`.
The returned configuration hash matches the recorded candidate hash above and the
original failing configuration. The scenario file still matches the candidate
hash in the current branch. Later main merges changed the configuration (clipboard
partition and Linux display setup), so this native result applies to the exact
candidate, not to a new full-suite run on the current branch. The existing
controlled red/green proof explains the original failure without a duplicate
regression, timeout increase, retry or reduced assertion.

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2000#issuecomment-6189606015)
records the complete Linux gate on `1e6cc84ce2117dd6c06a31d11af901f25ac7d6eb`:
427 executed, 427 passed, 0 failed, 3 skipped, 0 flaky; four actual workers and zero
retries. The named connect-roster scenario was present and passed: 1 executed,
1 passed, 0 failed, 0 skipped, retry 0. Skips were two macOS badge cases and the
macOS window-reopen case. Reports remain at
`/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#1998.pass.json` and
`verifier-gate_#1998_6.log`, with corresponding stderr logs in that directory.
The earlier verifier/documentation reads could not access the native result;
that access blocker is resolved by the completed report inspected above.
Ownership/commit-barrier guidance and counted evidence are recorded in
[development verification](../../knowledge/features/development-verification.md#authoritative-thread-read-evidence).

Acceptance handoff: the inspected native report supplies the macOS criterion's
counted full-suite and named-scenario evidence. The PR/verifier handoff separately
requires the builder to inspect the returned artifacts and commit its native
evidence before native acceptance. No such builder return commit is present;
this documentation inspection records existing evidence and does not replace that
builder-owned step. Return this managed task and the retained paths above to the
builder; no duplicate native run is needed. Native acceptance remains pending that
required evidence commit, rather than missing or failed macOS execution.
