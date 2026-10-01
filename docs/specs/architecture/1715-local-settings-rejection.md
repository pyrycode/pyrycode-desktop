# Local session-settings rejection (#1715)

## Files read

- `src/main/daemonConnection.ts` → `setSessionSettings`, `onDriverEvent`, `pendingSettings` — send-after-build and record-after-send ordering, existing correlated confirmation/rejection.
- `src/main/daemonConnection.test.ts` → `build`, `makeDriverFactory`, `captureLog`, `sessionSettingsUpdatedPlaintext` — real encoding with fake driver/sink and existing settlement coverage.
- `src/main/transport/setSessionSettingsEnvelope.ts` → `buildSetSessionSettings` — fresh payload literal and existing plaintext size limit.
- `src/main/receiveCommand.ts` → `onCommand`; `src/shared/ipc/commands.ts` → `isRendererCommand`, `isSetSessionSettingsPayload` — structurally validated renderer command boundary.
- `src/main/emitDaemonEvent.ts` → `emitDaemonEvent`, `bindServerOrigin` — typed, log-free event forwarding and destroyed-window guard.
- `src/main/diagnosticLog.ts` → `DiagnosticLog`, `DiagnosticEvent` — existing static diagnostics interface with nonthrowing logging contract.
- `docs/knowledge/features/session-settings-send.md` § Error handling and Security properties — current swallowed-failure contract that this ticket replaces.
- `docs/knowledge/features/development-verification.md` § Source and contract checks — use repository reads when codegraph is uninitialized; no index changes.

## Change

`setSessionSettings` currently swallows envelope-build and driver-send exceptions, leaving the renderer's fire-and-forget write awaiting an outcome forever. Its catch will emit exactly one fresh `{ type: 'sessionSettingsRejected', changeId }` using the submitted correlation, and log only the static event `session-settings-write-failed` with code `build-or-send-failed`. A successful send will log `session-settings-write-sent` without fields derived from the request. Preserve record-after-send ordering: local failures add no `pendingSettings` entry, so later confirmations cannot settle them. Preserve existing envelope-id advancement, daemon-correlated settlement, and no-retry behavior. The null-driver path is outside this slice.

The method remains synchronous with no new state, async tasks, cancellation needs, public interfaces, renderer changes or wire changes. Exceptions are discarded without reading their text. The typed rejection is the only local failure result delivered over the existing event channel.

In-flight overlaps: #1544, #1657, #1694 and #1699 edit other functions/fixtures in the shared connection files; no dependency or shared-block rewrite. Keep changes local.

Sizing: one deliverable; one production file; approximately 170 total written lines including tests and this plan; zero new exports or consumer updates; two acceptance criteria; one combined local-failure catch. Within all six ticket boundaries and consistent with the refiner estimate and the #269 correlation analogue.

## Testing strategy

Use co-located Vitest boundary tests with the real envelope codec, fake driver and event sink:

- Over-cap settings encoding emits one bare correlated rejection, forwards no frame, does not throw or retry, and a later confirmation for the attempted id produces no settlement. A subsequent valid write can reuse the unconsumed id and confirms its own change once.
- A driver that throws with sensitive exception text is called once, emits one bare correlated rejection, leaves no pending correlation, and a late confirmation produces no settlement. A subsequent valid write uses the next id and remains daemon-settled.
- Capture exact static diagnostic records for failures/success; no settings values, session ids, change ids or exception text. Existing daemon rejection/confirmation tests remain green.

Run RED on the new tests before production edits, then `npm test -- src/main/daemonConnection.test.ts` and `npm run build`. No UI interaction or visual changes require Playwright/Figma evidence.

## Open questions

None.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/session-settings-send.md` error handling and security properties to describe local correlated rejection. This includes replacing the swallowed-failure/no-event description and documenting static diagnostics and payload/exception exclusion.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — `onCommand` validates shape with `isRendererCommand`; `buildSetSessionSettings` reconstructs the wire payload. Only the existing submitted `changeId` returns in the local rejection; it grants no authority.
- [Tokens, secrets, credentials] No findings — this change creates/stores no credentials; neither payload nor caught exception is passed to logging or events.
- [File/storage operations] No findings — no paths, disk writes or renderer storage added. Existing secret storage is unaffected.
- [Electron attack surface] No findings — existing typed event channel and server-origin binding are reused; no bridge, window preference, navigation or remote-content capability changes. Transport remains in main.
- [Cryptographic primitives] No findings — no crypto/key/nonce changes; `nextEnvelopeId` remains an application correlation counter, not a Noise nonce.
- [Network/I/O] No findings — real `encodeEnvelope` size cap remains in force; a caught build/send failure is never retried. No relay URL, frame, timeout or TLS changes.
- [Errors/logs/telemetry] No findings — catch has no exception binding, rejection contains only type/changeId, and diagnostics use literal event names and one literal failure code. No payload-derived values, ids, hashes or exception text are logged.
- [Concurrency] No findings — `setSessionSettings` has no await; `pendingSettings` is still inserted only after successful send. No new timers/subscriptions or teardown paths. Late confirmations for failed writes remain unmatched.
- [Threat model] No findings — oversized renderer input yields local rejection rather than a stuck write; hostile late daemon confirmation has no correlation to consume. Existing relay, key-storage and renderer-isolation protections are not changed by this slice.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-01
