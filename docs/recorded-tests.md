# Recorded daemon exchanges

The normal `npm run e2e` suite runs every eligible real-client scenario through the actual Desktop application using captured daemon messages. `npm run e2e:recorded` runs the same 29 active scenarios under an executable launch guard. Neither path needs a Claude login, a Claude executable, a daemon executable or a running daemon. The one pre-existing system-prompt reset fixme remains visible and excluded from the successful count.

The scenario inventory, protected tickets and live-only proof boundaries are in [client-replay-migration.md](client-replay-migration.md). The original live specs remain the shared assertion source; the replay wrapper imports them rather than copying their assertions.

## Replay contract

Each `e2e/recordings/*.json` identifies its source Desktop commit, daemon source revision and binary checksum, Claude version, capture time and authenticated capabilities. Version 2 also records sequential authenticated connection lifetimes and explicit test-side causal checkpoints. Observed retryable transport closes carry their actual close code and message prefix; replay forwards every preceding frame before closing the local socket. Version 1 remains readable for older captures from PR #2036.

Replay uses the normal Desktop build, native thread mode, the existing encrypted fake daemon and a local forwarding relay. It never invokes the older event-to-thread publisher. Every outgoing envelope field and complete payload must match. Only fresh request IDs/timestamps and explicitly bound opaque identities vary. The same identity binds once across requests, replies and connections. Text, permission choices, routes, cursors and unknown extra fields remain part of the comparison.

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

`scenarioEffect` marks an external test action before capture executes it. Replay releases only the subsequent actual recorded frames. `liveProof` executes the original filesystem, registry or process assertions during capture/live runs; replay waits for the exact recorded prefix at their successful checkpoint. Offline success does not establish those physical facts.

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
