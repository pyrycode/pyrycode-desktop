# Recorded daemon exchanges

The normal `npm run e2e` suite runs every eligible real-client scenario through the actual Desktop application using captured daemon messages. `npm run e2e:recorded` runs the same 29 active scenarios under an executable launch guard. Neither path needs a Claude login, a Claude executable, a daemon executable or a running daemon. The one pre-existing system-prompt reset fixme remains visible and excluded from the successful count.

The scenario inventory, protected tickets and live-only proof boundaries are in [client-replay-migration.md](client-replay-migration.md). The original live specs remain the shared assertion source; the replay wrapper imports them rather than copying their assertions.

## Replay contract

Each `e2e/recordings/*.json` identifies its source Desktop commit, daemon source revision and binary checksum, Claude version, capture time and authenticated capabilities. Version 2 also records sequential authenticated connection lifetimes and explicit test-side causal checkpoints. Observed retryable transport closes carry their actual close code and message prefix; replay forwards every preceding frame before closing the local socket. Version 1 remains readable for older captures from PR #2036.

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
The [counted Linux compatibility evidence](knowledge/features/development-verification.md#replay-build-policy-and-provenance)
preserves both full retained failures: compatibility accepted the complete query
and forwarded the prefix through close index 47, but left 29 requests outstanding.
The subsequent close-ordering repair and combined retained acceptance belong to #2141;
prefix forwarding cannot satisfy its required complete pass.

After installing dependencies or rebuilding SQLite for Node unit tests, run
`npm run rebuild:electron` before replay. Node and Electron require different
native addon ABIs; a successful Node unit run does not establish that Electron
can open SQLite. Replay needs working local storage to restore saved history and
its catch-up cursor after a profile restart.

On initial launch and every profile relaunch, the shared replay fixture probes
`better-sqlite3` in Electron's main process before device binding and pairing. It
loads the application's installed addon, queries an in-memory database and closes
it. An observed false probe produces the static diagnostic
`Replay requires working Electron SQLite; run npm run rebuild:electron before replay.`
Loader errors and paths are not exposed. This prerequisite check does not prove
protected-profile persistence or current provider behavior; see the
[native-storage diagnosis and Linux replay evidence](knowledge/features/development-verification.md#replay-native-storage-prerequisite).

The prerequisite and history's `mainRead` use synchronous inspector evaluation
to bypass persistent collected promises after profile relaunch. An unavailable
inspection remains distinct from a false addon probe or an empty history result;
it fails within the existing five-second bound rather than claiming SQLite is
unavailable. Playwright upgrades must retain checks for the adapter's internal
local session access. See the [inspection contract](knowledge/features/e2e-harness-context-recovery.md#persistent-awaited-inspector-loss)
and [counted Linux relaunch evidence](knowledge/features/development-verification.md#replay-inspection-after-profile-relaunch).

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
