# Development verification

Shared lessons for refining, building and reviewing Pyrycode Desktop.
These were brought across from the active local-memory index on 2026-09-11.
Check current code before applying an observation about a particular implementation.

| Topic | Reference |
| --- | --- |
| [What each test tier proves](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves) | Static, mounted and live proof boundaries, with counted regression evidence. |
| [Evidence that cannot pass too early](development-verification-evidence-that-cannot-pass-too-early.md#evidence-that-cannot-pass-too-early) | Positive processing barriers and nonvacuous absence assertions. |
| [Layout and input](development-verification-layout-and-input.md#layout-and-input) | Measured layout, native input, focus and capture verification. |
| [Live-test diagnosis](development-verification-live-test-diagnosis.md#live-test-diagnosis) | Executable identity, credential ownership and counted live evidence. |

## Source and contract checks

Search the source and its production callers before estimating a change.
Search both `src/` and `e2e/`. If the code graph reports that it is not initialized,
use text search and file reads. An unavailable index is not evidence of no callers.

Comments wrap across lines. Search the concept as well as the identifier.
Removing the final consumer can invalidate comments that never name it.
A contract inherited from another consumer needs checking against the new sinks.
An untrusted string used as a Map key does not have the prototype behaviour of an
ordinary object key. Review the actual data structure.

The daemon's handling of unmatched event types differs from its explicit ignored
list. Read the individual dispatch arms before generalising a phrase across them.
On the client, trace the actual inbound parser rather than trusting an old symbol name.
A shared model-row lookup can govern behaviour as well as display text.
Read all callers before broadening what an empty identifier means.

## Replay native storage prerequisite

Node and Electron require different `better-sqlite3` native addon ABIs. Rebuild
for Electron after installation or a Node rebuild before replay; the
[replay contract](../../recorded-tests.md#replay-contract) describes the command
and startup diagnostic. A missing Electron addon can look like captured-contract
drift: unavailable history storage makes a restarted profile send a fresh
`thread_catch_up` cursor. Diagnose native storage before changing recorded
requests or query ordering. The replay fixture checks an in-memory database in
each opened Electron main process, including relaunches, before device binding.
The probe proves addon load/open/query/close, not protected-profile persistence.
History IPC cannot substitute for this pre-pair check because it requires paired
host membership.

Finish pre-verify's Node rebuild before Electron-native preparation and browser
checks; running them concurrently can change the addon underneath a launched app.
The [#2097 repair evidence](https://github.com/pyrycode/pyrycode-desktop/pull/2105)
retains seven storage failures from that overlap in `rework-specs.json`. After
sequential native preparation, `rework-final.json` recorded 37 executed/passed,
0 failed/skipped, covering the complete thread-activation, whitespace and reader-menu
specs. These reports are under `/tmp/builder-2097/`; the failed run remains failed.
See [saved traversal diagnostics](e2e-harness-context-recovery.md#saved-traversal-diagnostics)
for the separate listener-confirmation repair and accepted configured-gate evidence.

The [effort-default verifier evidence](https://github.com/pyrycode/pyrycode-desktop/pull/2071#issuecomment-6220345807)
records Linux x64 results for #2069. Failed unchanged-main evidence remains failed:
**1 executed, 0 passed, 1 failed, 0 skipped**, zero forbidden launches. At request
41 on connection 2, actual `thread_catch_up` used epoch `""` / version 0 instead
of the recorded saved epoch / version 14, followed by worker exit 7. Rebuilding
SQLite for Electron made the identical archived app/capture pass: **1 executed,
1 passed, 0 failed, 0 skipped**, zero forbidden launches. The
[plan's evidence paths](../../specs/architecture/2069-replay-native-storage.md#validation-evidence)
retain `baseline-native.log`, `historical-main-recorded.log` and the successful
`native-ready.log` under `/tmp/builder-2069/`.

The original focused effort-default scenario was present and passed:
**1 executed, 1 passed, 0 failed, 0 skipped** (`candidate-focused.log`). Complete
guarded replay recorded **29 executed, 29 passed, 0 failed, 1 existing
system-prompt-reset fixme**, zero retries and zero forbidden launches
(`recorded-final.log` / `recorded-final.json` in the same evidence directory).
Effort-default, model-recall and daemon-session-settings were present and passed;
all 29 exchanges had zero remaining requests. Effort-default matched all 96
requests and emitted 396 frames with the capture, original assertions, strict
matcher and causal barriers unchanged. These are recorded offline Linux results;
current provider behavior and live physical effects are not established, and
macOS is outside this ticket's verification scope.

## Replay inspection after profile relaunch

Bounded `app.evaluate` polling cannot recover persistent inspector await-promise
loss. At unchanged main `5c0793c7`, controlled inspection of `__threadHistoryAsks`
failed six consecutive times with `Runtime.callFunctionOn: Promise was collected`.
Even an awaited constant failed while the same-process synchronous history read
succeeded with `awaitPromise: false`; scheduling a Node turn did not restore it.
The original #2069 failures at `340f6a961a` retained only Playwright's rewritten
destroyed-context error: thread lost `assertReplayNativeStorage` after relaunch
(6 requests remaining), and history exhausted `mainRead` (14 remaining).
The unchanged rerun passed both with zero remaining; #2068 hit the same history
boundary. The controlled reproduction establishes the mechanism at that boundary;
the original reports do not expose their underlying protocol errors.

[`readReplayMainProcess`](../../../e2e/fixtures/replayNativeStorage.ts) bypasses
the awaited path only for the SQLite prerequisite and history's synchronous
`mainRead` observations. Public `evaluateHandle` also forces `awaitPromise` and
is not an alternative. The adapter obtains the current app's local inspector
session on every call; it never caches a session across relaunch. Playwright's
internal `_connection.toImpl(app)._nodeSession` access is isolated here and depends
on the lockfile-pinned implementation. Dependency upgrades must retain the
synchronous-inspection regressions and both relaunch replay checks. See the
[inspection contract](e2e-harness-context-recovery.md#persistent-awaited-inspector-loss)
for valid empty values, bounded unavailability and mutation boundaries.

The [verifier evidence](https://github.com/pyrycode/pyrycode-desktop/pull/2073#issuecomment-6221253088)
records Linux x64 on 2026-10-16, implementation `db6c6bb9`, reviewed head
`20fd3f8b`, main `5c0793c7`. These are retained results, not documentation reruns:

- Controlled regression `checks storage when the inspector loses every
  awaitPromise acknowledgement`: original **6 executed, 5 passed, 1 failed,
  0 skipped**; repaired targeted run **23 executed/passed, 0 failed/skipped**,
  including that case and all four observer-registration cases.
- Five consecutive focused guarded runs each used two actual workers,
  `--fully-parallel --workers 2 --retries 0`: **2 executed/passed, 0 failed/skipped**
  per run, **10 executed/passed, 0 failed/skipped** total. Both named scenarios
  were present and passed in every run:
  `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`
  and `a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`.
  Every thread exchange matched 45 requests/emitted 378 frames; history matched
  32/emitted 63. All ten had zero remaining requests and zero forbidden launches.
- Subsequent complete guarded `npm run e2e:recorded` used one worker, retries zero:
  **29 executed/passed, 0 failed, 1 skipped**. Both named cases were present and
  passed; all 29 exchanges had zero remaining requests, with zero forbidden launches.
  The explicit skip remains `real claude picks up a saved channel system prompt at Reset session`.
- Configured application gate used two actual workers, retries zero:
  **492 executed, 491 passed, 1 failed, 4 skipped**. Both named cases passed on
  their first attempt with the same complete exchanges above; all 29 replay
  exchanges had zero remaining requests. The unrelated visible-tail failure is
  tracked in #2074; its separate rerun was **2 executed/passed, 0 failed/skipped**.
  This does not turn the original full gate into a failure-free run. Skips were
  three macOS-only cases and the system-prompt-reset fixme.

Capture bytes, assertions, strict matching and causal barriers are unchanged:
Desktop source `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon source
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, binary SHA256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`.
The [plan's evidence paths](../../specs/architecture/2072-replay-inspection.md#validation-evidence)
retain diagnostics, red/green regression reports and `focused-1` through
`focused-5` plus `recorded-full` reports under `/tmp/builder-2072/`.
Offline replay establishes no fresh provider/daemon or physical-effect evidence;
macOS is outside this Linux ticket's verification scope. The SQLite ABI
prerequisite above still applies independently of inspection availability.

## Owned history mutation evidence

A one-item edit after full replacement can conceal an unbounded production append
path. Start empty and measure successive additions at growing saved sizes, keeping
untouched placement bytes as an independent assertion. Measure changed-item
serialization/protection separately from logarithmic sequence-index reads/writes;
ciphertext equality alone does not prove that no full scan occurred. Batch fixtures
must also check each shared authenticated path flushes once, because correct final
bytes can hide repeated work that stalls mounted browser setup.

Compare separately flushed, coalesced and held-failure progress after fresh protected
reopen. A completion flag combined with later metadata can erase saved/pending fences;
carry exact version intervals and certified availability boundaries instead. Include
same-epoch explicit resets, memory-only holder recreation and lost acknowledgements.
Individually admitted JSON additions must still fit full-reader aggregate bounds.
See [owned regression assertions and counted Linux/package validation](chat-history-testing-storage.md#owned-mutation-regressions-and-counted-validation)
for the final #2044 verifier evidence: 9,103 units executed/passed, 0 failed, 3 skipped;
435 configured fake cases executed/passed, 0 failed, 3 skipped; packaged owned-update
reopen present/passed, 1 executed, 0 failed/skipped. These are recorded results on
`5005bf69`, Linux x64, not checks rerun by documentation. The skips provide no live
acceptance; macOS and live-Claude are outside that ticket's scope. Historical failures
and teardown follow-up #2054 remain linked from the testing reference.

## Authoritative thread read evidence

Renderer units are static `renderToStaticMarkup` in Node: they prove markup and pure decisions,
not effects, focus, scrolling or publication. The existing `rendererFixture` in
[`e2e/thread-items.spec.ts`](../../../e2e/thread-items.spec.ts) supplies route, immutable
snapshot, summary, completion and reader inputs to the isolated item view. Keep
`ConversationListData` mounted when replacing `App`; writing a mark directly into the list
store does not test received owning-daemon confirmation.

Assert three boundaries separately: renderer publisher attempts with host/conversation/target,
wire commands recorded by the fake daemon, and received marks reflected through the mounted
receipt bridge. Main can refuse a host-qualified attempt when two connected hosts claim the
same conversation ID. Fake `conversation_updated` acknowledgements must correlate with the
recorded wire request; also exercise unsolicited late marks. A below-target clamp stays
pending, while a confirming mark retires it. Neither a successful send nor an attempt count
establishes acknowledgement.

Fence absence assertions with positive callback/processing and React-commit barriers. For the
pre-commit race, receive a same-row append and newer summary, trigger focus/scroll/list probes
before committing, then show that only committed complete visible content permits the newer
target. Receipt/list output must commit before checking exclusions after clamps, epoch/host
replacement, deletion or owner loss, with the observer still mounted. Cover blur, reader,
above-tail/chrome overlap, collapsed descendants, hidden trailing items, shown unordered/queued
items, older/incomplete/abandoned batches and repair fences. A poll that immediately sees no
command can otherwise pass before any input reaches the consumer.

History fakes need the same ownership discipline. In
[`e2e/tool-groups.spec.ts`](../../../e2e/tool-groups.spec.ts), keep the quiet conversation's
history request pending and positively observe it before returning to the seeded chat. Capture
requests by host/conversation and answer the seeded request, then wait for its historical child
to commit before asserting the finished marker. One shared latest-request slot can reply to the
wrong chat because main correlates replies by request ID and suppresses repeated pending asks.
Reply to `list_conversations` with the current roster, retaining the single-row launch seed and
both rows afterwards; a catch-all one-row list response can silently remove quiet ownership.
The [controlled shared-ID proof](../../specs/architecture/1936-visible-thread-read-marks.md#revisions)
failed at the historical-child commit barrier (`0 tools`, expected `1 tool`); selecting the
owning request passed the existing identity, finished-marker and navigation assertions. Preserve
that barrier and request ordering when reusing the scenario to validate another platform.

The [final verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1965#issuecomment-6188903924)
records the configured Linux gate on `20d0f07140931f3f0aaad4977f6a186c5f761727`, 2026-10-15:
`npx playwright test --reporter=json` ran **407 executed, 407 passed, 0 failed, 3 skipped,
0 flaky**, with four workers, clipboard/parallel projects and zero retries. All 12 thread-items
and 6 tool-groups cases were present and passed, including both 1280/800 variants of
`publishes only committed visible authoritative read evidence` and
`connect roster Agents appear before history and keep identity through live and historical launches`.
The three skips are macOS-only badge/window lifecycle cases. Units recorded 10,279 executed/passed,
0 failed, 3 skipped across 405 passing files. Install, docs guard and build passed; pre-verify
recorded 3 passed and 2 deliberately skipped by `--no-suite`, with typecheck subsequently in build.
These results supersede the earlier red complete gates; a focused pass or a baseline comparison
alone did not satisfy that full-suite requirement.

The [connect-roster verifier](https://github.com/pyrycode/pyrycode-desktop/pull/2000#issuecomment-6189606015)
records the unchanged scenario/configuration on `1e6cc84ce2117dd6c06a31d11af901f25ac7d6eb`,
2026-10-15: the complete Linux gate ran **427 executed, 427 passed, 0 failed, 3 skipped,
0 flaky**, four actual workers and zero retries. The named connect-roster scenario above was
present and passed: **1 executed, 1 passed, 0 failed, 0 skipped**, retry 0. The skips were two
macOS badge cases and the macOS window-reopen case. Retained reports are
`/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#1998.pass.json` and
`verifier-gate_#1998_6.log` (Playwright JSON) with its stderr log in that directory; shared
verifier evidence bundle `7e872c636b8d6eb367de8e665f72659b5feea9c4cbce0cf933466bd04cf00a29`
includes the verdict and report tail, with the full-report pointer in `pointers.json`.

The [native validation evidence](../../specs/architecture/1998-connect-roster-native-validation.md#validation-evidence)
now includes inspected managed `desktop-fake-suite` task
`0234f9aa222747faa60ae91272b3c4c0a8c191f095a48b442728b5adbb6e44ce`, run on the MacBook
at revision `0573bc79d97199427d6eebdf4f36f9d3785f7321`, 2026-10-15. The complete configured
suite recorded **429 executed, 429 passed, 0 failed, 1 skipped, 0 flaky**, four actual
workers and zero retries. The named connect-roster scenario above was present and passed:
**1 executed, 1 passed, 0 failed, 0 skipped**, retry 0. The sole skip was the independent
input-enabled-cover hover case because a never-shown window receives no display pointer.
The named case's `launch-fate` attachment records a running app at outcome, exit 0 and no
teardown failures; the setup summary is `[]`, with no top-level report errors.

Documentation inspected all six retained artifacts in `/tmp/docs-1998-native-20261015/desktop/`:
`capture.json`, `playwright.json`, `playwright.list.log`, `execution.log`, returned
`playwright.config.ts` and `fake-daemon-setup.json`. They remain retrievable through the
managed task. Its invocation was Playwright `test --config=playwright.config.ts`, without
file, grep, project or shard filters; all 430 configured cases are accounted for.
The returned configuration SHA256 is
`f2868e97d72733c286ff8c3098f09adc62e2e8bfa3ad9393e000eebf9a429d5a`, matching the
candidate and original failing configuration. The scenario is unchanged in the current
branch; later main merges changed configuration, so these counts belong to the recorded
candidate. Reuse the controlled ownership proof above rather than adding another regression
or replacing the complete configured gate with a filtered pass.

Native execution is verified; acceptance remains pending the builder's required returned-artifact
inspection and evidence commit, as specified by the PR/verifier handoff. The earlier task-access
blocker is resolved. This documentation inspection does not stand in for that builder-owned step;
return the existing task reports to the builder without requesting duplicate execution.

Separate native/macOS evidence for older candidate `ddb9bce8db99546129037f00713b753f603562d9`
remains unverified and handed to the dispatcher: task
`400bbaf6852f5e7efa8c860719fcf81552c8014a58142a12f66936d55fa14a07` has no verified result
in the verdict. Any result needs its own revision/configuration, executed/failed/skipped counts,
named cases and setup-attachment review before native acceptance. Replacement-epoch captures at
1280×773 and 800×773 show existing bubbles and copy/reply controls; the supplied fixture omits
the surrounding sidebar/top/input chrome, so they do not prove integrated chrome fidelity.
No real-Claude/live-daemon test ran or was required for this supplied seam.
Production activation has separate [counted fake-suite evidence](thread-runtime.md#validation-boundaries).
Credentialed live acceptance remains pending in the live runbook.

## Hosted app link verification

[`e2e/hosted-app-links.spec.ts`](../../../e2e/hosted-app-links.spec.ts) clicks links
in the production conversation renderer through privileged preload/IPC and inspects
native hosted content and fake-daemon dispatch. `launchPairedApp` uses legacy
non-UUID host IDs; use `skipPairing` and spec-local canonical UUIDv4 pairing for
this grammar instead of silently testing targets the parser must refuse.

The configured verifier gate on `fd19fde4bd34febc3111693f2171d62a520015a4`,
2026-10-15, ran `npx playwright test --reporter=json`: **436 executed, 436 passed,
0 failed, 3 skipped**. All four named cases below were present and passed, as
confirmed by the dispatcher gate report and
[final verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2005#issuecomment-6191844871).
The skips were three macOS-only badge/window lifecycle cases on Linux.

| Passed scenario | Behavior covered |
| --- | --- |
| `streaming and settled links preserve conversation drafts` | Pending/frozen and settled activation, repeated opens, keyboard activation, unchanged healthy discovery and sidebar return releasing native content/restoring the draft. |
| `latest host selection survives delayed replies` | Equal app IDs on two hosts, cross-host selection and delayed A discovery/command replies after selecting B. |
| `invalid and unpaired links stay bounded` | Malformed destinations stay visible/inert, manual pairing cancel preserves the draft, and successful pairing does not open the original target automatically. |
| `links reuse discovery recovery` | Missing/stopped/failed apps, offline/reconnect and unsupported recovery, failed discovery refresh and held completion, Reopen and removal. |

Fence zero-dispatch/OS-handoff assertions with positive processing evidence.
The delayed-selection case releases old discovery, observes a newer B label and
uses an ordered snapshot response after releasing A's command result before
checking B's generation/native identity and zero A assets. Recovery observes
authoritative status/discovery processing before excluding resources; a requested
walk alone does not establish readiness. Ready content and return-to-conversation
checks precede the final `shell.openExternal` spy assertions.

Static parser/renderer tests pin exact raw destinations, normalized-destination
denial, escaped titles/reference-label delimiters, meaningful labels, opt-in output
and no render-time activation. Main boundary units independently cover attached
privileged main-frame and named paired-host admission. Static renders cannot prove
clicks, effects or native composition. Existing
[native-view/Fetch proof](daemon-connection-hosted-resource-views.md#native-viewer-verification)
retains its scope; these synthetic reply scenarios establish no real Claude
creation/publish, daemon/relay or SQL acceptance, which remains #1929.

## Review and document hygiene

The pipeline uses one GitHub identity. A reviewer cannot approve or request changes
on its own account's pull request. Post the verdict as a comment and use the role's
issue labels. Keep the issue number separate from the pull request number.

Scratch directories keyed only by pull request can contain an earlier rework run's
review. Read existing evidence and use a distinct file for the new verdict.

Inspect the end of every added Markdown document for tool-call scaffolding.
The documentation guard scans feature docs and cannot prove that every changed
Markdown file is clean. A successful rendered preview can also hide stray tags.

CodeGraph's existing ignore patterns do not cover every runtime artifact. Check
`.codegraph/codegraph.lock`, `.codegraph/writer.pid`, `.codegraph/codegraph.db-shm`
and `.codegraph/codegraph.db-wal` against both the tracked diff and
`git check-ignore -v`; an ignored file can still be tracked. Repository-local Git
exclusions keep these generated lock/PID and mutable SQLite sidecar files out of
automatic commits while preserving the running index's local files.

A listener-count warning may predate the change. Compare against the base before
calling it the cause. Browser console events need explicit collection when the
existing fixture does not forward them.
