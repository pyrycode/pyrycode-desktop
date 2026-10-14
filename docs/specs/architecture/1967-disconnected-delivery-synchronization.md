# Disconnected delivery regression synchronization

## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: repository boundaries and reading map.
- `docs/knowledge/features/daemon-connection-lifecycle.md` → Disconnected composer message delivery / Delivery verification: authenticated FIFO and receipt contract.
- `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md`: positive processing barriers before absence assertions.
- `e2e/disconnected-message-delivery.spec.ts` → automatic/explicit/terminal cases: held IPC commands, pairing read gate, FIFO and receipt assertions.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: paired fake-daemon fixture and teardown ownership.
- `src/main/transport/fakeRelayForwarder.ts` → `dropClientLeg`: asynchronous socket termination without a client-processing acknowledgement.
- `src/main/daemonConnection.ts` → `onDriverEvent`, `loadDialConfig`, `dial`: authentication clears on close; reconnect loads pairing before redial.
- `src/main/transport/noiseRelayDriver.ts` → `onSupervisorEvent`, `resolveConnection`: automatic retry and fresh authenticated session.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer`, `ComposerSendButton`: disabled Stop derives from composer availability, not reconnect progress.

## Context

Repair one flaky disconnected-delivery regression while retaining the existing product contract. Original #1962 logs are absent here; the published verifier confirms a failed gate followed by a passing rerun but does not identify the assertion. Capture failing evidence before claiming the cause. No ADR or visual design change is needed.

Sizing: one deliverable, three observable acceptance criteria, estimated at most 300 written lines including this plan; zero new exports or consumer migrations, and at most two local test failure paths. The #1953 analogue wrote 116 lines. The remote feature-branch audit found no overlap in the delivery spec.

## Design

Keep scenario synchronization local to the spec and retain `launchPairedApp`. Diagnose the existing automatic branch before selecting the repair. If the observation race is confirmed, make the pairing-read gate report entry and wait for that positive reconnect barrier before forwarding held commands. A read-entry counter/flag exposes progress only, never contents. The automatic close must remain real; do not replace it with explicit reconnect.

Retain all assertions for two accepted original payloads, waiting rows without daemon delivery, authenticated FIFO drain exactly once, queue identity, receipt settlement, replay stability and terminal-case host isolation. Strengthen a no-write proof at the existing main-process seam if needed to distinguish a socket write from daemon arrival. Do not add retries or time delays. Production changes require evidence of a client defect and a recorded revision before implementation.

## State + concurrency model

Only test-owned IPC interception and the existing synthetic pairing-read promise change. A gate entry happens before the underlying read and before reconnect can authenticate. Resume restores `fs.readFile` and resolves/rejects the gate. Restore intercepted command listeners in `finally` and release any blocked work before fixture shutdown. No production store, transport task or wire shape changes are planned.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Two accepted submissions followed by automatic socket loss and retry | `accepted disconnected messages drain and settle: automatic` |
| Explicit reconnect retains original message IDs and FIFO | `accepted disconnected messages drain and settle: explicit` |
| Synthetic load failure and explicit terminal recovery | `accepted disconnected messages drain and settle: terminal` |
| Switching hosts while the first host holds messages | terminal case |
| Queue receipts settle existing echoes; duplicate receipt replay | all three cases |
| Failed assertion releases the gate and IPC interception | spec `finally` and fixture teardown |

## Error handling

Test assertions fail on missing progress, lost/duplicate/reordered payloads or incorrect rows. The existing synthetic read rejection remains terminal-case input. No new product error handling or logging is introduced; diagnostics contain only test phase/count/status data.

## Testing strategy

- Capture an unchanged-code or controlled same-symptom reproduction and identify its assertion/cause on #1967. Distinguish test phase readiness from delivery defects using main-process progress and decoded fake-daemon frames.
- Run automatic case 20 times with `--repeat-each=20 --retries=0`, zero failures/skips; then run all three cases with retries disabled.
- After final merge of main, run pre-verify and `npm run build`. Dispatcher owns the required full fake-transport verifier gate; explicitly leave that evidence pending in the PR. No live Claude proof applies.

## Open Questions

- Which assertion fails, and is its cause setup/observation timing or incorrect delivery? Resolve from captured failure evidence before the final repair; record the answer under Revisions.

## Security review

**Verdict:** PASS

- [Trust boundaries] Existing `pyry:command` handlers validate held renderer commands; the test forwards the exact captured command/event to those handlers without a new IPC API.
- [Tokens] Pairing-read instrumentation observes entry only. No pairing bytes, tokens or keys are returned or logged; production safeStorage remains intact.
- [File/storage] The gate matches the existing client-owned pairing filename and restores the original reader. It creates no production storage path or persistent outbox.
- [Electron attack surface] Test-only `app.evaluate` instrumentation adds no contextBridge export, window setting or navigation capability.
- [Cryptography] Real fixture Noise authentication remains required for drain. No primitive, key, nonce or session changes.
- [Network/I/O] Existing loopback forwarder performs real socket close; no TLS, frame bound, deadline or retry-policy changes.
- [Errors/logs] Synthetic failure is constant text; captured evidence must expose only fixture text and phase/count/status information, never credentials or raw secure storage.
- [Concurrency] MUST FIX addressed by design: release the read gate and restore IPC listeners in `finally`, including assertion failure, before fixture teardown. Progress observations cannot release authentication early.
- [Threat model] Delayed/dropped relay traffic is exercised through the existing Noise boundary. Hostile daemon parsing, disk theft and compromised renderer protections retain their production boundaries because this repair changes only scenario synchronization.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-14
