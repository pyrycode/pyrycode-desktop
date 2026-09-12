# Authenticated pairing completion

## Files read

- `src/shared/ipc/pairing.ts` — `PairingConfirmResponse`: saved confirmation contract.
- `src/main/pairingHandler.ts` — `registerPairingHandler`: consumes the pending identity before saving.
- `src/main/connectionRegistry.ts` — `sameRecord`, reconciliation: changed credentials reconnect only their host.
- `src/renderer/src/screens/pairing/pairingState.ts` — `pairingReducer`, `runConfirm`: shared controller seam.
- `src/renderer/src/screens/pairing/PairingScreen.tsx` — `PairingScreen`, `PairingModal`, `ReviewCard`: both presentations and completion ownership.
- `src/renderer/src/PairedShell.tsx` — `PairedShell`: generation-fenced navigation and preserved invoking view.
- `src/renderer/src/App.tsx` — `App`: daemon and relay bridges remain mounted during onboarding.
- `src/renderer/src/store/sessionStore.ts` — `selectStatusFor`, `withStatus`: main-stamped per-host map with fresh status objects.
- `src/renderer/src/store/relayLinkStore.ts` — `selectRelayLinkStatusFor`: per-host daemon absence.
- `e2e/pairing-modal.spec.ts`, `e2e/pairing-recovery.spec.ts`, `e2e/fixtures/launchPairedApp.ts` — existing mounted modal and delayed-response proof.
- `docs/knowledge/features/pairing-input-screen.md`, `pairing-ipc-channel.md`, `paired-shell-routing.md` — consume-before-await, origin preservation, delayed save refresh.
- `docs/knowledge/features/development-verification.md` — mounted proof and positive event barriers.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2559

Read design context and screenshot: a 640px column modal with Pair header, close icon, separator, fingerprint panel, centered explanation and Cancel/Pair footer. Reuse `Modal` and existing pairing typography, colors and actions for pending/error/Retry; onboarding keeps its card presentation.

## Context and scope

Saving credentials currently navigates immediately, even when the selected daemon is unavailable. Completion must mean a fresh authenticated connection for the main-confirmed identity. One behavior, four production files, approximately 750 total written lines including tests and this plan, one new exported controller function, fewer than ten consumer sites, four acceptance criteria and fewer than ten failure branches. No overlap found after fetching remote feature branches. Codegraph is uninitialized; source reads supplied the map.

## Design

`PairingConfirmResponse` success gains only `serverId`, from the pending record retained by `registerPairingHandler`. No credentials or daemon-reported identity cross back. `runConfirm` forwards that identity; the reducer enters `verifying`, not `paired`. Post-save state discards the paste and label.

Add `createPairingVerification` beside the reducer with injected session/relay store read-subscribe surfaces and an event callback. Create it before invoking confirmation, snapshot the per-host status map, and subscribe immediately. Its `saved(serverId)` starts a 30-second wait when successful confirmation is received. Only a connected status object newer than the confirmation snapshot for that exact identity may emit authenticated completion, including an event arriving before the response. Relay-connected and other hosts cannot satisfy it.

Temporary unavailability (daemon absence or deadline), authentication failure, and explicit pairing rejection enter sticky failure states. Only temporary unavailability offers Retry, which starts another 30-second observation of the same host through the existing reconnect loop, never another save. A fresh connected status received after the original confirmation may satisfy Retry. Rejection copy directs users to cancel and explicitly pair with a fresh code.

## State and concurrency

The controller owns two subscriptions and one timer. Completion settles once; failure stops the active wait until Retry. Cancel, unmount and replacement dispose subscriptions/timers and invalidate all completion callbacks. Existing synchronous submit/confirm guards remain. Post-save pending and failure allow Cancel, close and Escape.

`PairingScreen` refreshes saved-host information after successful persistence even if unmounted, independently of authenticated navigation. This preserves the existing late-save refresh contract without changing `PairedShell`. Cancellation does not undo persistence or touch conversation state; existing shell generation checks remain a second navigation fence.

## Error handling and logging

Keep existing validation and storage errors unchanged. Use fixed UI copy and static diagnostic codes for waiting, authentication, timeout, daemon absence, rejection, authentication failure, retry and cancellation. Never forward daemon error text or log identity, code, fingerprint or credentials. Disconnect/transport loss keeps waiting within the deadline; handshake/auth errors fail explicitly.

## Testing strategy

- Main-handler assertions require the confirmed identity and exclude secret fields, including superseding submissions.
- Controller tests with fake timers prove identity isolation, stale status exclusion, response races, sticky errors, 30-second deadlines, retry and teardown; reducer/runner expectations distinguish saving from authentication.
- Mounted fake-transport Playwright checks cover onboarding and add/repair modal purposes, another connected host, delayed selected authentication, rejection, retry without saving twice, cancellation and newer interaction. Existing modal/recovery specs retain their guards.
- Run touched unit tests, build and focused Playwright specs; capture pending/failure modal evidence at desktop and minimum width. Full suites belong to the verifier.

## Open questions

None. Identical saved credentials may leave an already-connected host unchanged; its stale status must not complete this flow. This ticket deliberately waits for fresh authentication rather than adding a reconnect command.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/pairing-input-screen.md` (phase machine, effect-runners and concurrency), `docs/knowledge/features/pairing-ipc-channel.md` (confirm response), and `docs/knowledge/features/paired-shell-routing.md` (host recovery and navigation lifetime) to distinguish saved confirmation from authenticated completion and describe the 30-second wait, retry, cancellation and retained saved host.

## Security review

**Verdict:** PASS

- Trust boundaries: `registerPairingHandler` returns the retained parsed identity; `selectStatusFor` reads main-stamped origins, never `ack.server_id`. Snapshot comparison excludes pre-confirmation success.
- Tokens and storage: existing confirmation and safeStorage remain the sole save path; Retry cannot call them. Post-save state drops the paste. Cancellation retains the authorized saved host.
- File operations: no new paths, storage keys or writes; host lookup uses Map and equality.
- Electron surface: no new channel, request, capability, window configuration or navigation policy. The existing request guard remains authoritative.
- Cryptography and network: no changes to Noise, TLS, relay policy or reconnect backoff. A hostile relay can delay completion only until the bounded deadline.
- Logs and UI: fixed classified codes and escaped client-owned copy only; no daemon error text, secrets or identity logged.
- Concurrency: subscribe before confirmation; settle once; dispose on cancel/unmount; late persistence refresh is separate from navigation. Failure is sticky until user action.
- Threat alignment: compromised relay cannot mint main-stamped authenticated status; daemon identity cannot select a different host. Restart reuse remains owned by #1364; daemon code selection remains outside this ticket.
