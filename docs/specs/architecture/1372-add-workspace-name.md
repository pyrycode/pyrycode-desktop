# Add workspace optional shared name

## Context and sizing

Add one optional shared workspace name after creation confirms the remote folder.
This is one deliverable: result plumbing has only this new behaviour consumer and
cannot stand alone under the one-consumer floor. Estimated written work: 800 lines,
11 production TypeScript files, no new exported types/components, two forwarding
call sites and four exhaustive event bridges, four acceptance criteria, fewer than
10 failure branches. The 11-file overage is retained under the floor exception
recorded by refinement. No remote feature branch overlaps the planned files after
fetch. Codegraph reported no initialized index; source reads supplied the map.

## Files read

- `src/renderer/src/screens/channels/AddWorkspaceDialog.tsx` — `AddWorkspaceDialog`, `AddWorkspaceDialogView`, `resolveWorkspacePath`: existing create lifecycle and presentation.
- `src/renderer/src/screens/channels/AddWorkspaceDialog.test.tsx` — `renderView`: static presentation proof.
- `src/renderer/src/screens/channels/EditWorkspaceDialog.tsx` — `requestRenameWorkspace`: retain its distinct clear-name semantics.
- `src/main/daemonConnection.ts` — `renameWorkspace`, `createConversation`, `setSystemPrompt`: outbound and correlation patterns.
- `src/main/daemonConnection.test.ts` — `build`, `workspaceUpdatedPlaintext`: fake driver and correlated frame proof.
- `src/main/transport/inboundMessage.ts` — `decodeInboundMessage`: preserve reply correlation on workspace updates.
- `src/shared/ipc/commands.ts` — `RendererCommand`, `isRendererCommand`: validated optional attempt identifier.
- `src/shared/ipc/events.ts` — `DaemonEvent`: additive result contract.
- `src/main/index.ts` — rename command routing: host-addressed forwarding.
- `src/main/connectionRegistry.ts` — legacy facade forwarding of `renameWorkspace`.
- `src/renderer/src/store/{daemonEventBridge,questionBridge,timelineBridge,modalBridge}.ts` — exhaustive event switches: ignore naming results.
- `e2e/sidebar-add-workspace.spec.ts` — `controlledCreates`, `mainEvent`, `openWorkspace`: mounted lifecycle proof.
- `e2e/fixtures/conversationStateFake.ts` — `conversationStateFake`: authoritative list refresh after rename.
- `docs/knowledge/features/add-workspace-dialog.md` — local wait and host-scoped results: preserve same-host create correlation limitation.
- `docs/knowledge/features/daemon-connection-correlation.md` — system-prompt additive acknowledgement pattern.
- `docs/knowledge/features/development-verification.md` — positive-effect assertions and Electron verification boundary.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2110

**Shared presentation:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=489-1942

Read design context and screenshot: a 640px dark blue modal with divided header,
round close asset, Host row, filled folder input, absolute preview, then a single
filled optional name input. Reuse `Modal` and existing add-workspace field classes
for the 41% fill, label/body tokens and centred outlined Cancel / filled OK actions.

## Design

Extend `renameWorkspace(payload, attemptId?)` and its IPC command with an optional
bounded client-generated identifier, never serialized onto the daemon wire. Existing
callers omit it and keep fire-and-forget behaviour. Main maps the wire envelope id
to the identifier. The decoder retains optional `inReplyTo`; a matching success
emits `workspaceRenameResult { attemptId, outcome: 'confirmed' | 'rejected' }` in
addition to unconditional `workspaceUpdated`. Matching daemon errors consume the
pending entry and emit only the content-free rejection. Local failures reject the
identified attempt; missing routing also rejects with the selected host stamp.

The dialog submits an unnamed, unpromoted chat exactly as before. It snapshots the
trimmed name at submission. The first accepted create reply pins `conversation.cwd`
without desktop resolution. Blank names dismiss; nonblank names send a rename to
the selected host, including names equal to the folder fallback. Further create
notifications cannot initiate naming again. No chat mutation or folder change is added.

## State and concurrency

Keep state local to the mounted dialog: name draft, confirmed folder, status and
current naming attempt. Busy guards synchronously cover both creating and naming.
Use a fresh UUID per naming attempt. Only a result matching host, identifier and
the active naming phase settles it. Naming failure unlocks only the name; folder
stays fixed. Explicit OK retries naming only; blank finishes without a rename.
The existing 30-second local deadline is independently armed for each phase.
Connection loss ends either wait. Timeout makes no claim that the server cancelled.
Cancel/close always dismiss, retain any chat, remove listeners and clear the timer.
Closed guards prevent late creates from starting naming. Main clears pending rename
correlation on dial, like its sibling pending maps; late results cannot settle a newer UUID.

## Error handling

Use static failure and uncertainty copy for naming rejection, send failure,
connection loss and deadline. Log lifecycle and classified outcomes only: no path,
name, UUID or daemon error text. Preserve the create failure/cancellation behaviour.
Validate optional attempt IDs at IPC as nonempty strings bounded to 128 code units.
Name admission uses trimmed UTF-16 length at most 128; no new wire validation contract.

## Testing strategy

- RED then GREEN: static view assertions for two empty fields, trimmed length boundary,
  busy and fixed-folder rendering; connection tests for matched, unsolicited, stale,
  rejected and locally failed rename attempts; decoder and IPC guard assertions.
- Fake transport: create then name using confirmed folder; two hosts with same path;
  blank preservation, explicit fallback name, rejection/correction naming-only retry,
  foreign/stale results, disconnect/local failure/deadline, dismissal in both phases.
- Run touched unit files, build, and the focused add-workspace fake spec. Capture the
  actual modal at 1280×800 and 800×240 and compare with Figma; prove keyboard reachability.

## Open questions

None. Existing same-host create correlation remains intentionally unchanged.

## Documentation handoff

Pending for documentation stage: update `docs/knowledge/features/add-workspace-dialog.md`
with optional-name semantics, the create-then-name lifecycle, cancellation and naming-only
retry. Add a workspace-renaming section to
`docs/knowledge/features/daemon-connection-correlation.md` describing the result contract
implemented for this consumer.

## Security review

**Verdict:** PASS

- Trust boundaries / Electron: `isRendererCommand` validates the optional identifier;
  the decoder validates workspace payloads and envelope correlation. Main stamps host
  identity; neither daemon payload nor renderer identifier selects a different host.
- Tokens / crypto: UUIDs identify attempts, not authority. No credential, encryption,
  Noise, storage or privileged window configuration changes.
- Files / storage: confirmed cwd is echoed only into the existing remote rename command;
  no filesystem operation or local resolution. Names and paths are escaped display/input
  text, never markup, URL, filename or logs. No draft persistence.
- Network / I/O: existing transport limits and security remain. A withheld reply ends
  the local wait after 30 seconds; no automatic resend or duplicate create on retry.
- Errors / telemetry: fixed result enum and client-owned copy prevent daemon-error leakage.
  Diagnostics record static lifecycle codes only.
- Concurrency: correlation uses main-owned envelope ids plus client attempt ids; foreign,
  unsolicited and old results cannot complete the active attempt. Cleanup removes local
  timers/subscriptions; dial clears old main correlations.
- Threat alignment: relay delay/drop is uncertainty, not success. A hostile daemon can
  report its own remote cwd but cannot trigger a desktop filesystem operation. Existing
  same-host create ambiguity is explicitly preserved by this ticket's product contract.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13

## Revisions

2026-09-13 — Implementation retained the planned contract. Existing input styles and
the stateful conversation fake already supply the presentation and authoritative
rename refresh, so neither needs modification. The existing
`e2e/host-conversation-list.spec.ts` folder selector now uses its accessible label
to distinguish it from the added name input. A blank name after creation can finish
even while disconnected, since that action sends no command. The focused browser
suite also proves a local rename build failure using a long confirmed remote folder
and a valid name whose JSON escaping exceeds the wire cap; retry sends only a rename.
