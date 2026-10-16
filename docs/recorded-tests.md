# Recorded daemon exchanges

`npm run e2e:recorded` runs Desktop against messages captured from a real daemon
running real Claude. The committed permission scenario also runs in the normal
`npm run e2e` suite. Replay starts only the existing local fake relay and encrypted
fake daemon. It needs no daemon executable, Claude executable or login.

This tier currently covers creating a chat, sending a tool request, showing the
permission, arming and confirming Allow once, dismissing the permission, and
rendering the completed assistant reply. The real capture additionally proves
that the tool creates its witness file only after confirmation.

The recordings do not yet replace the other live scenarios. In particular, the
existing two-turn live test remains the complete connection check. Session grants,
denial, interrupt, queue, reconnect, settings and saved history retain their current
live coverage. This change does not alter the dispatcher's live gate or its floor.
The daemon's own live suite is the intended eventual recording producer. This
Desktop implementation supplies the consumer format and a repeatable local producer.

## Replay contract

`e2e/recordings/permission-allow.json` is a versioned application-message capture.
Its provenance identifies Desktop's source commit, the daemon source revision and
executable checksum, Claude version, capture time and accepted capabilities.
The recorded executable was built from daemon revision
`07b6b35e14aad0de688326fb36d81c54303c691c`. Its Go build reports a modified tree
because the scratch checkout contains the test executable. The executable checksum
identifies the actual producer. No application daemon was replaced.

Replay uses native thread mode. It never invokes the test publisher that converts
older event scripts into thread items. Every actual outgoing request must match
the recorded type and complete payload. Only generated conversation, session,
message, modal, epoch and device identities are rebound. The fresh approval nonce
is also rebound. Text, permission choices, routes, cursors and extra fields remain
part of the comparison. Request IDs in replies follow the actual client request.

User actions are ordered barriers. Background queries may arrive in a different
order before the next action. A query consumes one matching request from that
step. It cannot borrow a later response. Daemon frames retain their recorded order
and wait for every earlier request. Missing, duplicate, extra or changed requests
fail the test, including failures after the final visible assertion. Diagnostics
contain counts and provenance, never request payloads.

Version 1 admits the requests needed by this scenario. Unknown client commands,
handshake frames, rekey controls and multipart payloads are rejected. Replay does
not simulate elapsed network time or establish timing, rekey or reconnect coverage.
Extending those behaviours requires explicit format support and new real captures.

## Capture a replacement

Commit the source being exercised first so the capture identifies reproducible
code. Use an isolated test daemon and the existing configured test login.
Never supply credentials through command arguments or chat.

```sh
PYRY_BIN=/absolute/path/to/test/pyry \
PYRY_RECORDING_OUTPUT=/absolute/path/to/new-candidate.json \
npm run e2e:recordings:capture
```

The selected daemon needs `interactive` and `thread`, plus the remote stdio
permission support used by the live fixture. Normal live-test prerequisites
apply. On macOS request approved execution outside the Codex sandbox before
running any command that launches Electron.

The runner builds the separate capture configuration, executes one controlled
real scenario with no retries, then restores the normal build in `finally`.
It checks that the normal main bundle has no recorder. The normal build never
imports the capture adapter. A runtime environment variable cannot enable it.
Do not package or launch other tests from the capture build.

Only decrypted application messages enter the bounded memory recorder. Handshake
early data, pairing tokens and Noise keys never enter it. Capture writes a new
file with private permissions only after the UI flow and real file-effect checks
pass. Existing files are never overwritten. Workspace paths and fresh approval
nonces are normalized. Credential field names, known credential patterns and the
actual configured Claude credential values are rejected. This is suitable for the
controlled scenario, not arbitrary personal conversations. Inspect a candidate
before committing it. No raw capture is attached to test reports.

## Verify against a current daemon

```sh
PYRY_BIN=/absolute/path/to/test/pyry npm run e2e:recordings:verify
```

This performs the shared UI scenario with real Claude, then restores the normal
build. It replays both the committed recording and the new candidate without
Claude credentials. It compares their request contracts, allowing fresh IDs and
background query reordering within a step. Changed choices, text, query cursors,
missing queries or a changed recovery action fail verification. The final output
contains the current producer identity and hashes of both recordings. Verification
never replaces the committed fixture. Review an explicit replacement when it fails.

This is a semantic check through the same UI assertions. It does not require
Claude to produce byte-identical timing, generated identifiers or progress updates.
Offline success proves Desktop behaviour for the captured protocol. Only an
executed live verification establishes behaviour with the selected current daemon.
Both explicit tiers reject an all-skipped run. No full-suite live result is implied.

## Known initial-history refusal

The captured daemon can return `thread.query_failed` for a new chat's initial
history query because the thread view is unloaded. The scenario uses Desktop's
existing Retry action while permission keeps the conversation active. The real
capture and offline replay include that action, and the fixture records its use.
This test proves permission handling and completion after recovery. It does not
certify healthy initial history loading or fix the daemon. A daemon change that
removes the refusal should produce a reviewed replacement recording.
