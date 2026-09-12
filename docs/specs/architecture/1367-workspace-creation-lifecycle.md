# Workspace creation lifecycle (#1367)

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` — `HostRowControl`, `HostRow`: host-bound entry action and existing error-host treatment.
- `src/renderer/src/screens/channels/AddWorkspaceDialog.tsx` — `AddWorkspaceDialog`, `AddWorkspaceDialogView`: local form state and currently unbounded, origin-blind wait.
- `src/renderer/src/store/conversationCreatedBridge.ts` — `requestNewWorkspaceChat`, `subscribeConversationCreated`, `subscribeConversationCreateRejected`: addressed command and subscriptions that discard origins.
- `src/renderer/src/store/sessionStore.ts` — `selectStatusFor`, `sessionStore`: authenticated status keyed by paired host; absent status is unavailable.
- `src/main/daemonConnection.ts` — `createConversation`, `onDriverEvent`, `emitFailed`, `dial`: send, rejection correlation and connection lifecycle.
- `src/main/transport/noiseRelayDriver.ts` — `sendMessage`, `onSupervisorEvent`: an existing driver need not hold a usable authenticated session.
- `src/main/emitDaemonEvent.ts` — `bindServerOrigin`: main-owned event identity.
- `src/shared/ipc/events.ts` — `StampedDaemonEvent`: origin accompanies both create result arms.
- `src/main/diagnosticLog.ts`, `src/shared/ipc/diagnostics.ts` — `DiagnosticLog`, `RendererDiagnosticEvent`: content-free lifecycle logging.
- `src/main/daemonConnection.test.ts` — `build`, create request and rejection tests: injected failing driver and captured stamped events.
- `src/renderer/src/screens/channels/AddWorkspaceDialog.test.tsx` — `renderView`: static enabled/error matrix.
- `e2e/sidebar-add-workspace.spec.ts`, `e2e/fixtures/launchPairedApp.ts`, `e2e/fixtures/conversationStateFake.ts` — mounted dialog, two authenticated hosts and request-driven list replies.
- `docs/knowledge/features/add-workspace-dialog.md`, `conversation-create.md`, `channel-list-host-row.md`, `daemon-connection-correlation.md` — local form ownership, nullable create contract and unchanged per-request correlation limit.
- `docs/knowledge/features/development-verification.md` — mounted effects require Electron; withheld replies prove pending state; navigation needs a changed active row.

Codegraph context returned an uninitialized-index error; repository text search supplied the symbol and caller inventory.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2110

Read design context and screenshot: a rounded dark blue column panel, title/header separator, labeled fields and bottom Cancel/confirm actions, using scheme colors and M3 title/body/label typography. The ticket explicitly assigns its host label, path preview, optional name and modal redesign to #1346. This change keeps the current single-field `AddWorkspaceDialogView`, its theme-based disabled action and error styling, and Cancel throughout the wait.

## Context and size

An unavailable send or withheld answer currently freezes creation indefinitely. This is one deliverable: a host-isolated, bounded local creation wait. Folder validation/creation and successful refresh/navigation remain the existing daemon and #1363 contracts; no ADR is needed.

Estimate: approximately 650 written lines including tests and this plan; 3 production files, 0 new exported types/components/stores, 1 changed view-prop consumer, 4 acceptance criteria, and at most 8 distinct failure/ignore categories. No signature migration across modules. The six sizing limits hold. A fetched scan of all 21 remote feature branches found no overlap with planned files. No dependencies are added.

## Design

- `HostRowControl` supplies the Add workspace action only for `selectStatusFor(serverId).type === 'connected'`, checking again when invoked.
- `AddWorkspaceDialogView` receives a required `connected` flag. Start chat requires connection, an absolute path and no pending attempt. Cancel and field preservation remain unchanged. Extend the local status union with disconnected and timed-out feedback; all copy is client-owned.
- `AddWorkspaceDialog` uses the stamped `window.pyry.onDaemonEvent` stream directly, replacing its two origin-losing subscriptions without changing their other consumers. Accept results only when a nonempty string origin exactly equals the selected host and a submission has occurred in this open dialog. Missing, null, invalid and other-host origins are ignored.
- A named `WORKSPACE_CREATE_DEADLINE_MS = 30_000` controls the local wait through standard timers (Playwright clock controls time). Timeout says completion could not be confirmed and the chat may still appear. It does not claim cancellation.
- A still-open dialog accepts a matching confirmation after any submitted attempt, including a timeout or local failure. Rejects affect only a currently pending attempt. Success closes the dialog; existing refresh/navigation owns displaying the created chat.
- `createConversation` requires both a driver and an authenticated live-session flag. Set the flag only after validated hello acknowledgement; clear it on failure, relay loss, redial and stop. A retryable relay loss emits the existing disconnected event as well as relay status so the per-host session selector cannot retain a false connected value.
- Unavailable, build and send failures emit the existing content-free `conversationCreateRejected` through the bound sink. Keep fresh payload construction and pending-request registration after a successful send. Logs contain only static lifecycle names/codes, never caught errors or payload fields.

## State + concurrency model

The folder, status, submitted marker and timer belong to the mounted dialog, not a new store. A synchronous status ref gates repeated clicks and result callbacks before React renders. Submission rechecks `sessionStore.getState()` for the selected host, marks pending and arms the deadline before dispatch. There is no await between checking and sending. Disconnect ends pending immediately; reconnect only re-enables an explicit user action.

Every settlement clears the timer. Starting a retry replaces the old timer. Success and Cancel mark the dialog closed synchronously and detach its listener; effect cleanup also clears the timer/listener on unmount. Late success remains observable only while the dialog is still open after submission. No disconnect, timeout or reconnect resends. Same-host concurrent creates remain indistinguishable under the existing protocol, as accepted by the ticket.

## Error handling

Local unavailable/build/send failures and correlated server rejection use the same bare stamped rejection event. The dialog shows generic failure copy, disconnected guidance or the uncertain timeout outcome, keeps inputs and offers explicit retry only when connected. No new IPC/wire shape, raw error, daemon rejection string or cancel command is introduced.

## Testing strategy

- RED first: focused main tests for unavailable/pre-handshake/post-loss refusal and build/send failure rejection, preserving host stamp, content-free logging and no phantom pending request.
- Static view matrix: connection gate, timeout/disconnection copy, unfrozen fields and always-enabled Cancel.
- Extend the existing mounted Electron spec with a spec-local wrapper over `conversationStateFake` that counts requests, holds replies and switches rejection/success. Keep a second host connected; send its confirmation/rejection while the selected host waits. Inject malformed/missing IPC origins only through main's test seam.
- Prove unavailable states, connection loss after opening and during send, immediate local failure and server rejection, 29,999/30,000ms deadline, pending cancellation, cleanup after close/unmount, late success, retry protected from an old timer, and no automatic/repeated send. Keep the original normal success and request-driven list reply.
- Run only touched unit files, `npm run build`, and `e2e/sidebar-add-workspace.spec.ts` through the approved Electron helper. Capture connected/pending/error/timeout states at the 800px minimum and a larger viewport in scratch space, then inspect the images.

## Open questions

None. Main-stamped host identity is the result boundary; per-request correlation and server-side cancellation are explicitly unchanged.

## Documentation handoff

Pending for the documentation stage, exactly as requested: update `docs/knowledge/features/add-workspace-dialog.md` to describe connection gating, the 30-second uncertain outcome, explicit retry and host-scoped results. Update `docs/knowledge/features/conversation-create.md` under “Error handling” to replace the silent local-failure behaviour. Record that timeout/Cancel do not cancel a server-side create and that per-request correlation remains unchanged.

## Security review

**Verdict:** PASS after adversarial review against the builder security checklist.

- **Trust boundaries / IPC:** `bindServerOrigin` supplies identity from the paired record; the dialog checks type, nonempty origin and exact host equality. A hostile second host cannot settle this wait. Existing command validation and fresh payload reconstruction remain in main; no IPC capabilities are added.
- **Tokens / cryptography:** no credential or crypto changes. Noise and keys stay in main; the existing safeStorage ownership is unchanged.
- **File/storage operations:** the typed folder is sent as the existing create payload only. No local filesystem resolution, persistence or new path sink. The daemon continues to own folder confinement and creation.
- **Network / threat model:** a relay withholding a reply cannot freeze the local form beyond 30 seconds. Authentication, not relay reachability, admits a create; relay loss clears the authenticated flag. TLS/Noise transport policy remains unchanged.
- **Errors / logs:** fixed client copy and bare stamped rejections drop daemon/caught error text. Static lifecycle codes describe sent, rejected, disconnected, timeout and closed states without logging host IDs, paths, names or content.
- **Concurrency:** pending state precedes send, timers clear on every settlement/retry/exit, and the closed flag blocks callbacks already queued at teardown. The deadline ends only the local wait; no automatic retry or exactly-once claim. Same-host request correlation is explicitly unchanged by this ticket.
