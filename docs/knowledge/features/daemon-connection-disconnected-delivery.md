# Daemon connection — disconnected composer delivery

Part of [Daemon connection — lifecycle](daemon-connection-lifecycle.md). This document covers the per-host composer hold, delivery settlement and its verification.

## Disconnected composer message delivery

Each host connection owns a main-memory FIFO of copied `SendMessagePayload` values,
including the original conversation, message ID, text and attachment IDs. Accepted
submissions during initial bootstrap, handshake or reconnect wait here. The existing
offline composer Send gate remains; the FIFO closes the renderer/main disconnect race.
It stores payloads rather than ciphertext and rebuilds envelopes for the current dial.

Admission validates the message and encodes it against `MAX_PLAINTEXT_BYTES`, the
existing per-frame plaintext bound. The FIFO permits at most 128 messages and 1 MiB
of encoded envelope bytes per host. Invalid/oversized payloads and incoming overflow
emit `not-sent`; overflow never evicts an older entry. A synchronous draining guard
keeps reentrant submissions behind the existing remainder. Keep the draining head's
count and bytes reserved until the driver accepts it: removing it before handoff
would admit an extra message if a reentrant submission arrived and the head was refused.

Drain only after `parseHelloAck` validates the authenticated handshake, on automatic
or explicit reconnect as well as initial connect. A synchronous `send-refused`
observation leaves the head in place, marks it waiting and stops draining. A later
successful handshake resumes the never-written remainder in submission order.
Other send failures emit `not-sent` and remove that entry from automatic retry.
An accepted send without an immediate observation belongs to `noiseSession`'s rekey
buffer; main removes it from its FIFO and lets the eventual observation report its
outcome. Holding it in both places would duplicate delivery.

`messageDelivery` IPC carries only conversation/message IDs and the closed status
`waiting | not-sent | written`, with the existing host stamp. Its observer works
independently of `MessageLifecycle.sending`, which may supply no diagnostic observer
and records only one attempt. Local holding does not report a diagnostic drop;
final acceptance/failure or permanent release completes that observation.
`written` means `WebSocket.send` returned, not daemon acknowledgement. Written
messages leave the FIFO permanently; a missing receipt or repeated connected
notification cannot trigger a resend. See [composer delivery and settlement](composer-send-internals.md#2-local-delivery-status-and-receipt-settlement).

Terminal connection failure marks retained echoes `not-sent` while keeping their
payloads. Existing explicit Reconnect changes them back to waiting and retries after
authentication only if the pairing is unchanged. Compare `server`, `relay`, `token`
and `server_static_pubkey` on every dial reload, using the copied
[`sendPairing` snapshot](daemon-connection-lifecycle.md#hello-and-held-send-pairing-lifetime).
Initial bootstrap adopts the first pairing. Missing or changed
pairing fails and releases the old FIFO; registry removal and connection `stop()`
also fail and release it before driver teardown. Surviving echoes remain Not sent,
and no old payload reaches a replacement pairing. Holds survive thread switches,
but app shutdown releases them; there is no disk outbox or restart delivery.

### Delivery verification

`daemonConnection.test.ts` covers admission limits, initial holding, ordered/reentrant
draining, repeated handshakes, a second refusal, terminal recovery, pairing removal/
replacement/disposal and deferred rekey observations. Store/composer tests cover
synchronous status-before-send, bridge rollback and host-owned inactive echoes.
The mounted `e2e/disconnected-message-delivery.spec.ts` checks fake-daemon decoded
frames and visible waiting/failed rows, running-turn queue correlation, ordered
settlement and replay stability, with automatic, explicit and terminal recovery.

During the disconnected gap, both accepted commands must report waiting while a
main-process `WebSocket.send` counter remains unchanged and no decoded send reaches
the fake daemon. The counter must increase after authenticated delivery, so the
no-write assertion cannot pass with a disconnected observer. Instrumentation counts
calls without inspecting frame arguments; teardown restores the socket method, IPC
listeners and pairing reader and releases the blocked read in `finally`.

Visible assistant text does not establish settlement. Each scripted answer first
renders with `.bubble__cursor`; only then does the fake send its `turn_end`, and the
test waits for that answer's cursor to disappear before recording the replay baseline.
Otherwise normal cursor removal can fail whole-row equality despite correct delivery.
Keep both the streaming and settled observations: cursor absence alone could pass
before the delta arrived. See [positive processing barriers](development-verification-evidence-that-cannot-pass-too-early.md#evidence-that-cannot-pass-too-early).

Recorded evidence for #1853 at `cfa9de8b`: verifier gate 6 executed 335 fake-transport
tests, with 335 passed, 0 failed and 4 skipped. The [verifier PASS verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1855#issuecomment-6036469849)
confirms that all three named “accepted disconnected messages drain and settle:
automatic”, “accepted disconnected messages drain and settle: explicit” and
“accepted disconnected messages drain and settle: terminal” scenarios were present
and passed, as did the repaired switch-agent regression. The same verdict records
9,343 unit tests executed/passed, 0 failed and 3 skipped. This client delivery
regression requires no new real-Claude acceptance; these counts establish fake
transport and unit evidence only.

For #1967 at `3d5278633668`, the [diagnosis](https://github.com/pyrycode/pyrycode-desktop/issues/1967#issuecomment-6179663671)
records a controlled delayed-`turn_end` reproduction: 1 executed, 0 passed, 1 failed,
0 skipped. The existing replay equality expected `Answer 1` with its streaming cursor
and received the settled row without it; earlier waiting, FIFO, payload and receipt
checks passed. The original gate logs were unavailable, so their failing assertion
remains unknown. Disabled Stop preceding the automatic pairing read was a valid
disconnected backoff phase, not evidence of a delivery defect.

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1972#issuecomment-6179920114)
confirms these counted fake-transport runs:

| Command | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| `xvfb-run -a npx playwright test e2e/disconnected-message-delivery.spec.ts --grep 'settle: automatic' --repeat-each=20 --retries=0 --reporter=json` | 20 | 20 | 0 | 0 |
| `xvfb-run -a npx playwright test e2e/disconnected-message-delivery.spec.ts --retries=0 --reporter=json` (subsequent run) | 3 | 3 | 0 | 0 |
| Dispatcher full `npx playwright test --reporter=json` | 395 | 394 | 1 | 3 |
| Dispatcher rerun of the unrelated chat-history receipt-saturation failure | 1 | 1 | 0 | 0 |

The automatic case passed all 20 repetitions; the subsequent three-case run and
the full dispatcher run each contained and passed all three named “accepted
disconnected messages drain and settle: automatic”, “accepted disconnected messages
drain and settle: explicit” and “accepted disconnected messages drain and settle:
terminal” tests. The verifier accepted the full gate plus unrelated rerun under the
dispatcher's flaky-test policy; the initial full run was not failure-free. No
real-Claude evidence is required or claimed for this client-only repair.
