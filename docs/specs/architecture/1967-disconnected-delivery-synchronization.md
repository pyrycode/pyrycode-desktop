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

## Revisions

2026-10-14 — Diagnosis resolves the Open Question with a controlled same-assertion reproduction, rather than unavailable original gate logs. Unchanged automatic samples passed 20/20 and 100/100 with retries disabled. A phase probe confirmed disabled Stop can precede the automatic pairing read (zero reads), but that is still a legitimate disconnected backoff gap: `onDriverEvent` already cleared authentication. No delivery defect is inferred from that probe.

The confirmed observation race is the replay comparison: `Answer 1` visibility precedes final `turn_end` processing. Holding that frame until after `before` reproduced the existing deep-equality assertion failure: expected `Answer 1▎…`, received `Answer 1…`; accepted original payloads, waiting, FIFO and receipt checks before it passed. `TimelineRow` renders `▎` while streaming, so normal settlement changes snapshot text without replaying a message.

Final contract: every scripted answer must visibly stream before its `turn_end` is pushed, then visibly lose its cursor before the replay baseline is read. This deterministic separate-frame ordering retains the reproduction as regression coverage and a positive settlement barrier; no production or reconnect synchronization change is needed. Restore the existing intercepted IPC listeners as planned. Target diff remains one spec and this plan, about 110 inserted lines overall, with no new exports or call-site migrations.

The existing main-process seam also counts `WebSocket.send` calls without reading arguments. Record the count after disconnect and require it unchanged after both commands report waiting, alongside zero decoded daemon sends. Restore the original method in `finally`; this observation adds no production API and retains no frame or credential data. Written work remains below 150 lines.

Final verification after merging `origin/main` (`a24efe21335c`): `xvfb-run -a npx playwright test e2e/disconnected-message-delivery.spec.ts --grep 'settle: automatic' --repeat-each=20 --retries=0 --reporter=json` executed/passed 20, failed/skipped 0. The subsequent same command without `--grep` and `--repeat-each` executed/passed all three cases, failed/skipped 0. Pre-verify passed all five checks, including 10,178 unit passes, zero failures and three existing skips; `npm run build` passed. The socket counter also increases after authenticated delivery, proving the no-write observation is attached to the exercised transport. The dispatcher's full fake-transport verifier gate is required and pending, not replaced by these focused runs.
