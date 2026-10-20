# Recorded daemon exchanges

The normal `npm run e2e` suite runs every eligible real-client scenario through the actual Desktop application using captured daemon messages. `npm run e2e:recorded` runs the same 29 active scenarios under an executable launch guard. Neither path needs a Claude login, a Claude executable, a daemon executable or a running daemon. The one pre-existing system-prompt reset fixme remains visible and excluded from the successful count.

The scenario inventory, protected tickets and live-only proof boundaries are in [client-replay-migration.md](client-replay-migration.md). The original live specs remain the shared assertion source; the replay wrapper imports them rather than copying their assertions.

## Replay contract

Each `e2e/recordings/*.json` identifies its source Desktop commit, daemon source revision and binary checksum, Claude version, capture time and authenticated capabilities. Version 2 also records sequential authenticated connection lifetimes and explicit test-side causal checkpoints. Observed retryable transport closes carry their actual close code and message prefix; replay forwards every preceding frame before closing the local socket. Version 1 remains readable for older captures from PR #2036.

Capture preserves raw close positions and each call's actual connection identity.
The capture-only session adapter observes a client call before delegating to
`sendMessage`; that observation does not prove a successful socket write. A
session retained until reconnect can therefore have observed calls after its
recorded link-down event. These calls remain in their original connection.

Replay derives a finite close position by scanning only the contiguous client-only
suffix on that same connection after the raw close. It exactly matches those
requests before notifying the transport-close observer once with the original
code and preceding server-frame count. The relay waits for successful socket
writes of that prefix before closing. No daemon frame crosses the raw close;
same-connection daemon data beyond it fails. A close without a tail keeps its
existing position. No recording bytes or connection assignments change.

An unreleased causal checkpoint still blocks tail matching. Missing calls fail
within the existing five-second connection-completion bound; changed, duplicate,
extra and future-connection requests remain fatal and sticky. Reconnect cannot
skip the old connection's requests or borrow future replies, and final
`assertComplete()` still checks the entire exchange. See the
[captured-close controls and counted Linux acceptance](knowledge/features/development-verification.md#captured-close-client-tails).

Replay uses the normal Desktop build by default, native thread mode, the existing encrypted fake daemon and a local forwarding relay. It never invokes the older event-to-thread publisher. Every outgoing envelope field and complete payload must match. Only fresh request IDs/timestamps and explicitly bound opaque identities vary. The same identity binds once across requests, replies and connections. Text, permission choices, routes, cursors and unknown extra fields remain part of the comparison.

For older complete-thread recordings whose accepted capabilities already include
`thread_expansion,thread_compact`, explicitly select the test-only build profile:

```sh
node scripts/run-offline-replay.mjs --profile complete-thread --retries 0
```

This builds the current Desktop source with
`e2e/recordings/complete-thread.config.ts` and runs the original shared assertions
under the executable guard. Its build alias supplies omitted opening options at
both ordinary opening and created-conversation activation, selecting the existing
complete authoritative route throughout the run, including accepted reconnects.
Default replay, with no `--profile`, uses the existing normal output and verifies
automatic projection selection: a compact-capable accepted handshake produces
`projection: 'compact-v1'`. Compatibility verifies the current source's complete
route. Neither profile establishes fresh provider behavior or physical transport
proof. Production compact-demand coverage continues to use the normal build.

The compatibility configuration contains no capture adapter. Selection happens
before application dispatch; normal builds have no environment, IPC or renderer
state switch for it. There is no mismatch fallback, per-request adaptation or
projection stripping. Full envelopes, identities, accepted capabilities, input
bytes, original assertions, causal barriers and exchange-completion checks remain
unchanged; wrong-profile and changed-payload controls still reject strictly.

Compatibility temporarily builds into the ordinary `out/` directory, then rebuilds
normal output in `finally` after success, replay failure or compatibility-build
failure. Restoration failure fails the command. Run builds and replay sequentially
with no competing consumers of that output. The runner refuses a build whose
recorded profile differs from the requested one, including compatibility output
left by an interrupted process; `npm run build` restores normal output explicitly.
Unknown profile selections fail before launch. The default invocation does not
rebuild the application.

`replayExecutedBuild` reports compilation-time `desktopRevision`, `sourceDirty`
and `profile` from `out/main/build-provenance.json`, plus `bundles`, the SHA-256
map of emitted JavaScript, HTML, CSS and JSON outputs. These identify the executed
build rather than the checkout at replay time. Separately, each `replay-input`
attachment records `scenario`, raw-byte `inputSha256` and `captureSource` (the
original Desktop/daemon revisions, daemon binary checksum, Claude version and
capture time). Exchange counts retain capture provenance; a current build never
rewrites the capture's source identity.

For the retained question input, preserve the original selection and add only the
explicit profile argument:

```sh
PYRY_CLIENT_RECORDING_DIR=/tmp/builder-2137/capture-3 \
node scripts/run-offline-replay.mjs --profile complete-thread \
  --grep "real claude changes model during a question and resumes with the original answer" --retries 0
```

Verify input SHA-256
`24bbe5dff65241a77dda96cbd262c9185925d88f6168439a1679b576b984dac1`.
The [combined Linux retained-input acceptance](knowledge/features/development-verification.md#captured-close-client-tails)
records the named case present and passed on clean current source
`3372c1f318aa4da6d46c4638fd0ce4dccb990998`: 1 executed/passed, 0 failed/skipped,
retries zero, 38 matched requests / 201 emitted frames / 0 remaining, and zero
forbidden launches. Complete-thread selection and finite tail scheduling are
both required for that input. The earlier default-profile mismatch and
compatibility-only close-ordering failures remain failed evidence; forwarding a
prefix alone did not establish completion. This is offline replay proof only.

After installing dependencies or rebuilding SQLite for Node unit tests, run
`npm run rebuild:electron` before replay. Node and Electron require different
native addon ABIs; a successful Node unit run does not establish that Electron
can open SQLite. Replay needs working local storage to restore saved history and
its catch-up cursor after a profile restart.

On initial launch and every profile relaunch, the shared replay fixture probes
`better-sqlite3` in Electron's main process before device binding and pairing. It
loads the application's installed addon, opens and queries an in-memory database
and closes it. Only explicit boolean `true` permits startup. Explicit `false`
immediately produces the static diagnostic, without further polling:
`Replay requires working Electron SQLite; run npm run rebuild:electron before replay.`
Load/open/query/close failures return false; native errors and paths are not
exposed. Missing or non-boolean observations, including truthy values, poll every
100 ms within the existing five-second bound and end with
`Replay main-process inspection unavailable` if no conclusive boolean arrives.
Fatal inspector errors propagate immediately. This prerequisite check does not prove
protected-profile persistence or current provider behavior; see the
[native-storage diagnosis and Linux replay evidence](knowledge/features/development-verification-replay-native-storage.md#replay-native-storage-prerequisite).

The prerequisite and history's `mainRead` use synchronous inspector evaluation
to bypass persistent collected promises after profile relaunch. The generic
reader preserves valid `false`, zero, null, undefined, empty strings, arrays and
objects, rejects promise results, and selects a fresh current-process inspector
session on every call. Boolean-only classification belongs to the prerequisite;
an empty history read remains valid. Controls must use static categories or
derived booleans rather than asserting raw inspector exception/value fields,
which can leak content before reader sanitization. Playwright upgrades must
retain these contracts. See the [inspection contract](knowledge/features/e2e-harness-context-recovery.md#persistent-awaited-inspector-loss)
and [counted Linux relaunch evidence](knowledge/features/development-verification-replay-native-storage.md#replay-inspection-after-profile-relaunch).

The [accepted native-observation evidence](knowledge/features/development-verification-replay-native-storage.md#counted-linux-native-observation-validation)
records Linux x64 on 2026-10-20, clean compiled repair
`5569f7cff359a9ac942c1c35642b0c2f1f1a5194`, profile `complete-thread`.
These are retained results, not fresh documentation runs. Under `/tmp/builder-2190/`:

| Check | Executed / passed / failed / skipped | Report | Configured / actual workers |
| --- | --- | --- | --- |
| Original classifier causal units | 43 / 24 / 19 / 0 | `unit-causal-red-corrected.log` | Vitest |
| Final affected units | 43 / 43 / 0 / 0 | `rework-pre-verify.log` | Vitest |
| Original classifier Electron control | 1 / 0 / 1 / 0 | `electron-causal-red.json` | 3 / 1 |
| Original diagnostic assertions | 3 / 0 / 3 / 0 | `rework-diagnostic-leak-red.json` | 3 / 1 |
| Complete repaired control spec | 4 / 4 / 0 / 0 | `rework-electron.json` | 3 / 1 |
| Guarded paired history/thread | 4 / 4 / 0 / 0 | `rework-paired.json` | 3 / 3 concurrent slots |
| Subsequent complete guarded replay | 29 / 29 / 0 / 1 | `rework-recorded-full.json` | 1 / 1 |
| Supplied configured application gate 7 | 533 / 533 / 0 / 4 | Dispatcher gate report | Not supplied |

Each JSON report has separate matching `.log` and `-results/` artifacts. The two
replay summaries retain build/profile, seven-bundle hashes, all worker identities,
input checksums and capture provenance. Node checks finished before Electron-native
preparation; no native rebuild overlapped replay. Both guarded commands restored
normal output, reported zero forbidden launches and used retries zero.

The paired invocation selects exactly
`a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`
and `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`
with `node scripts/run-offline-replay.mjs --profile complete-thread`,
`--fully-parallel --workers 3 --repeat-each 2 --retries 0`.
Both named tests are present and passed twice in that batch, then once in the
complete replay and supplied application gate. Every paired history exchange is
32 requests / 63 emitted frames; every thread exchange is 45 / 378, zero remaining.
All 29 full-suite exchanges complete with zero remaining. The sole full-replay
skip is the existing system-prompt-reset fixme, also skipped in application gate 7,
tracked by [upstream #2436](https://github.com/pyrycode/pyrycode/issues/2436).

The actual-Electron case
`missing inspector values do not diagnose native failure on launch or profile relaunch`
is present and passed in the complete control spec and application gate 7. On each
process it omits one genuine successful probe's value, then forwards another genuine
success. A saved marker proves profile reuse; both processes exit zero without
teardown failures. This establishes the missing-result mechanism without fabricated
success. History/thread input hashes and captured Desktop/daemon/binary identities
remain those recorded below; the linked native-observation reference retains their
full values and report hashes through the plan.

The separately reported historical #2153 macOS batch remains failed: 4 executed /
3 passed / 1 failed / 0 skipped, exchange 10 matched / 21 emitted / 22 remaining.
Its trigger remains unknown. Original `/tmp/builder-2153/paired-3.*` and
`paired-3-results/` paths are recorded separately; the retrievable earlier-run bundle
under `/tmp/builder-2190/evidence-2153/` contains only the builder log, with no raw
paired report/log/results or artifact pointers. New passes do not identify that
historical cause or erase the failure. This harness correction requires no fresh
provider/daemon acceptance; macOS is outside the Linux ticket's verification scope.

Seven named read-only queries may reorder within an action. Every other request is an ordered barrier, including read marks. A query cannot borrow a future reply. Daemon frames retain recorded order and wait for all preceding requests, captured connection transitions and explicit test-side checkpoints. Missing, duplicate, extra or changed requests fail even after the final visible assertion. Diagnostics report counts and source provenance without payloads.

A successful explicit profile close, relaunch or callback completion keeps the
process alive through two boundaries in the replay closing hook:
`exchange.whenConnectionComplete()`, then
`relay.whenServerFramesForwarded(exchange.serverFrameCount())`. The first observes
natural matching and emission for the retiring connection, bounded at five seconds.
It neither supplies requests nor waits for a future connection. An unreleased
checkpoint in that prefix rejects when reached, without releasing it or poisoning
the exchange; a next-connection checkpoint is outside the wait. Missing-prefix
timeouts and request/connection mismatches remain sticky failures. Every outcome
removes the progress listener and timer. There is one active completion method;
the unused `settleConnection` alternative was removed.

Matching and emission alone cannot prove delivery, including when the fake daemon
sends its returned batch synchronously. The second wait snapshots the cumulative
server-frame count (one Noise response per connection plus emitted application
frames) and requires successful client-leg WebSocket send callbacks. It has its own
five-second bound and rejects delivery errors or premature relay closure. This
proves socket forwarding, without claiming receiver/application acknowledgement.
Only then does the process exit before the independent profile starts.

Failure cleanup bypasses both waits and still closes the app, preserving the
scenario error. Retirement failure also closes the app and retains its causal
error even if close fails. Handles are cleared after failed retirement; the replay
fixture deletes both lifecycle hooks in `finally`, including on failure. Strict
reconnect/device boundaries and final `assertComplete()` remain mandatory. See the
[controlled ordering and failure boundaries](knowledge/features/e2e-harness-context-recovery.md#persistent-awaited-inspector-loss).

The [accepted retirement verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2130#issuecomment-6273917715)
records retained Linux x64 results on 2026-10-19, tested implementation
`fbba3bdd7700d69cbfd7fcc9e563a96c58b8a632`, reviewed head
`234f7ad28b6c50c3bf7f8bf8d003f4f0ee4bb6ef`, merged main `3897f0dd`.
The [plan's revisions and fresh evidence](specs/architecture/2072-replay-profile-retirement.md#rework-validation-evidence)
supersede its earlier design and open-#2129 hold; #2129 is closed. These are
recorded results, not documentation-stage test runs.

| Check | Executed / passed / failed / skipped | Workers and retries |
| --- | --- | --- |
| Seven lifecycle/exchange/inspection/native/observer/isolated-app/relay regression files, after replay | 97 / 97 / 0 / 0 | Includes active completion boundaries and held relay confirmation |
| Five consecutive guarded paired batches | 20 / 20 / 0 / 0 | Each 4 / 4 / 0 / 0; three configured/actual slots, retries zero |
| Subsequent complete guarded `npm run e2e:recorded` | 29 / 29 / 0 / 1 | One configured/actual worker, retries zero |
| Supplied dispatcher unit gate 4 | 9803 / 9803 / 0 / 3 | Named replay scenarios belong to application gate 7 |
| Dispatcher application gate 7, `npx playwright test --reporter=json` | 515 / 515 / 0 / 5 | Three configured/actual workers, retries zero |

Both protected cases are present and passed twice per focused batch and once
without retry in the complete recorded suite and configured application gate:
`a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`
and `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`.
Every history exchange matched 32 requests/emitted 63 frames; thread matched
45/emitted 378, all with zero remaining requests. All 29 exchanges in the full
recorded run completed; every builder guard reported zero forbidden launches.
The explicit excluded case is
`real claude picks up a saved channel system prompt at Reset session`; it was
skipped in application gate 7 too and is never counted as passed.

The focused command was `node scripts/run-offline-replay.mjs --grep 'a real daemon lazily fills a served gap|daemon-built thread streams' --fully-parallel --workers=3 --repeat-each=2 --retries=0 --reporter=list,json`.
Reports are `/tmp/builder-2072/rework-focused-{1..5}.json` and
`rework-recorded-full.json`; the plan retains report hashes and build identity.
Node preparation finished before Electron preparation/replay, without concurrent
native rebuilds. The original history proofs still require saved-checkpoint
catch-up, no legacy requests, all 205 closed-app posts, trusted-input paging
progress, ordering and uniqueness. Captures, full payload matching, causal
barriers and original assertions are unchanged.

Recording SHA-256: thread
`53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`;
history `de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`.
Both retain Desktop source `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon
source `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf` and daemon binary SHA-256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`.
Earlier failed runs remain failed evidence in the plan. Offline Linux replay
adds no current provider/daemon or physical-effect proof; macOS is outside this
ticket's verification scope.

History paging observes actual numeric protected coverage through an authorized
`newestThreadPage` request with `limit: 1` before each trusted Home/ArrowUp. It
validates metadata ownership and retains the newest authenticated range start;
an older disconnected range cannot fake progress. Each input still requires a
strictly older protected start within five seconds alongside exactly one
additional request. Pending split-save `unreadable` results cannot become coverage;
dispatch and rendered rows do not establish durability. Full transcript reads
would compete with receipt/persistence on main's serial queue as history grows.
The [reader contract and controlled regression](knowledge/features/chat-history-testing.md#protected-paging-coverage-observation)
retain the split-save controls and demonstrate that contention separately from
unknown historical host timings.

The [latest Linux normal-build evidence](knowledge/features/chat-history-testing.md#counted-linux-bounded-observation-validation)
records the exact history case (1 executed/passed, 0 failed/skipped) followed by
complete guarded replay (29 executed/passed, 0 failed, 1 existing skip), retries
zero. The subsequent application gate recorded 518 executed, 516 passed, 2
unrelated thumbnail failures and 5 skipped; the named history case passed at
retry 0, completing all 32 requests / 63 frames with zero remaining requests.
The verifier accepted the dispatcher's rerun disposition for the thumbnail
failures. Original failing evidence and prior complete-thread results remain
retained in the testing reference. Captures and their provenance above are
unchanged; the reset-prompt fixme stays excluded. These are captured-client results,
with no fresh provider/daemon or physical-effect claim; macOS is outside scope.

The thread scenario separately observes saved replies and the exact host/chat's
protected saved-list string title before relaunch. `readSavedListTitle` repeats
only read-only missing-list, absent-row and unnamed-row observations within the
existing five-second assertion bound; storage errors, rejected reads, wrong hosts
and unexpected results fail immediately. It returns the actual stored string,
including an empty string, and retains the explicit string assertion. Natural
list receipt and persistence supply the title. See the
[controlled ordering regression and counted Linux evidence](knowledge/features/development-verification.md#protected-saved-list-title-observation).

`scenarioEffect` marks an external test action before capture executes it. Replay releases only the subsequent actual recorded frames. `liveProof` executes the original filesystem, registry or process assertions during capture/live runs; replay waits for the exact recorded prefix at their successful checkpoint. Offline success does not establish those physical facts.

Explicit `scenarioInput` values also preserve inputs generated during a scenario.
The [question-answer scenario](client-replay-migration.md#question-answer-proof) generates
its confirmation only after the batch appears and reuses that captured value in replay.
Its interpretation proof excludes snapshots and all pre-submission assistant text;
only fresh original-turn confirmation followed by matching normal completion can count.
The [Linux acceptance record](knowledge/features/development-verification-live-test-diagnosis.md#question-answer-linux-acceptance)
keeps the successful replacement capture, guarded replay and separate live run distinct.

## Capture every scenario

Commit the source first. Build an isolated daemon with Go VCS metadata from clean source, then use the configured dedicated test login. Credentials belong only in the execution environment, never command arguments or chat. The Codex scenario also requires its isolated test login.

```sh
PYRY_BIN=/absolute/path/to/test/pyry \
PYRY_CLIENT_RECORDING_DIR=/absolute/path/to/new-candidates \
npm run e2e:recordings:capture
```

The output directory must be new and outside the checkout. The runner discovers all real specs, runs every eligible case once without retries, then captures the original permission scenario. It rejects missing files, skipped eligible cases, failures, dirty source and incomplete provenance. Failed runs remain private review evidence and never become eligible fixtures. On macOS, approve execution outside the sandbox before launching Electron.

The runner builds a separate recorder configuration and always restores the normal build. It checks the normal main bundle for recorder absence. The normal build never imports recorder code, and no runtime flag can enable it. Packaging includes only the normal output and package metadata.

The bounded recorder retains complete decrypted application JSON after envelope validation. Handshake early data, pairing tokens, Noise keys and rekey controls never enter fixtures. New files use private permissions. Only fixture-owned workspace paths and approval nonces are normalized; application messages are not synthesized. Credential field names, known secret patterns and configured credential values are rejected. Review every candidate before committing it.

## Verify live drift

```sh
PYRY_BIN=/absolute/path/to/test/pyry npm run e2e:recordings:verify
```

Verification makes fresh captures through real Claude and the daemon, including every original live-only assertion. It restores the normal build, replays both committed and fresh captures under the executable guard, checks equal scenario counts and compares complete outgoing request contracts. Fresh opaque IDs and the named read-only query ordering may vary; changed commands, payloads, query cursors or causal order fail. Verification never replaces committed fixtures. Review and capture an explicit replacement after understanding drift.

The report gives equivalent-scope live and replay counts and durations. Provider text and timing need not be byte-identical. A live failure is preserved as a failure; offline success cannot overrule it.

## Live checks remain required

`npm run e2e:real:gate` executes all current real scenarios and rejects an all-skipped run. Keep the existing encryption, transport, rekey, native integration and protected-storage checks: replay validates Desktop against captured application messages, while fresh live execution proves current provider/daemon behavior and physical effects. Do not use a recorded file to satisfy a tool filesystem or operating-system assertion.

The offline runner removes provider credentials and daemon paths, traps CLI names, and preloads a child-process guard throughout its Node/Electron tree. It rejects shell execution and absolute or relative Claude/daemon paths before launch. Successful guarded runs report `forbiddenLaunchAttempts: 0`. Guard denial tests cover direct and shell-based launch attempts.
