# Confirmed running permission mode

## Context

The footer currently overlays pending and acknowledged intent on the daemon's running
permission report. An acknowledgement may leave an operator-bypass child unchanged.
This ticket makes that report authoritative without changing the settings write contract.

## Files read

- `src/renderer/src/screens/conversation/ComposerPermissionModeMenu.tsx` → `ComposerPermissionModeMenu`, `composerPermissionModeMenuModel`: overlay, labels and Auto capability gate.
- `src/renderer/src/screens/conversation/runConfigLive.ts` → `RunConfigLiveData`: app-lifetime read subscription and turn refresh.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `subscribeRunConfig`, `requestRunConfigSnapshot`: conversation attribution and read request.
- `src/renderer/src/store/runSettingsWriteBridge.ts` → `foldWriteEvent`: acknowledgement is write settlement, not applied permission confirmation.
- `src/renderer/src/store/runSettingsWriteStore.ts` → `selectEffectiveSettings`: preserve model/effort overlays.
- `src/renderer/src/PairedShell.tsx` → `activateDeps`: existing conversation-switch clearing and refresh.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `useSessionSettingsConnected`: owning-server availability.
- `src/main/daemonConnection.ts` → `requestSessionSettings`, `onDriverEvent`: reply correlation, reset and replacement boundaries.
- `e2e/composer-permission-mode-menu.spec.ts` → `capturingFake`: held fake replies and visual captures.
- `e2e/real-claude-permission-mode.spec.ts`, `e2e/fixtures/realDaemon.ts` → live drive, `RealDaemonOptions`: isolated operator-bypass launch and guarded Electron lifecycle.
- `docs/knowledge/features/composer-permission-mode-menu.md` → label lookup, availability and security: preserve safe constants and bypass exclusion.
- `docs/knowledge/features/run-config-store.md` → conversation attribution and Permission mode: empty mode must also cover a resolved session with unavailable confirmation.
- `docs/knowledge/features/development-verification.md` → evidence that cannot pass too early: hold acknowledgements and observe actual settings replies.
- Upstream `interactive_stream_running_permission_settings_test.go` → `TestInteractiveStreamSessionSettingsReportsConfirmedPermissionMode`; `harness_modal_test.go` → `spawnPermissionDaemon`: retain explicit stdio prompt with operator bypass; use an outside-workspace Read.

Codegraph is uninitialized; repository reads supplied the symbol map.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3678
and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

Read design context and screenshots for both nodes. Retain the compact body-small
primary-colour label and upward chevron, with the existing vertically stacked rounded
options panel. Reuse `ComposerOptionsMenu` and existing tokens; no geometry or asset changes.

## Design

`ComposerPermissionModeMenu` passes `snapshot?.permissionMode ?? ''` to its view.
The model join still uses `selectEffectiveSettings`. No fallback to yolo or session facts.
The current selection uses that same confirmed mode; the permission-only write is unchanged.

Add `subscribeConfirmedRunConfig` in a sibling module `confirmedRunConfig.ts` with
injected event/context subscriptions, writes store, snapshot setters, refresh and logger.
It owns accepted read delivery, owner/context invalidation and permission confirmation
refreshes. `RunConfigLiveData` wires it instead of the basic read subscriber; existing
turn-completion refresh remains. No wire or IPC types change.

In `createDaemonConnection`, abandon pending settings reads on reset edges and session
replacement. A new read supersedes older outstanding reads for that conversation so
reordered responses and an A→B→A revisit cannot restore an older report.

## State + concurrency model

The existing run-config snapshot remains the only display state. The subscription
tracks pending permission change IDs independently of write-listener ordering. A
correlated acknowledgement starts immediate reads plus 500ms retries for at most 15s;
stop when a fresh report matches the requested mode. Rejection triggers one read.
An early old-mode reply remains truthful and does not stop retries.
Context changes, owning-server reconnect, reset and replacement clear confirmation,
cancel retries and pending tracking. Reset-active suppresses reads until reset ends;
replacement guards the new session ID. Other hosts cannot clear or populate this state.
Unsubscribe cancels all listeners and the timer. No effects or new store in the menu.

## Error handling

Keep existing rejection and availability handling. Missing/empty mode hides the control.
Timeout preserves the last report and records a static `unconfirmed` diagnostic. Log
only lifecycle codes through `sendDiagnostic`, never IDs, mode values or daemon text.

## Testing strategy

- RED first: mounted static container with pending/acknowledged overlays still shows bypass; empty report stays hidden.
- Store/bridge tests with fake timers: acknowledgement before confirmation, rejection, retry deadline, teardown, chat/host changes, unrelated host events, reset/replacement and stale sessions.
- Main correlation tests: reset/replacement and superseded reads discard stale replies.
- Fake transport: held write and read replies, unchanged selection while pending/acknowledged, fresh confirmation, rejection, resolved empty mode, lifecycle isolation. Capture existing menu at 1100 and 800px.
- Live spec: operator bypass with stored default; correlated report and footer; acknowledged no-op default remains bypass; menu Plan then Manual approval each confirmed inside 15s without another turn; same-session outside-workspace Read produces attributable permission prompt. Record daemon revision. Dispatcher executes this spec with its credential; builder does not run it.
- Scoped Vitest and focused fake Playwright; `npm run build`. No full-suite capstone.

## Scope check

One deliverable: truthful confirmed permission display, with lifecycle and live proof.
Estimate ~750 written lines; four production files, zero new exported types/components,
one existing consumer rewired, four acceptance criteria, fewer than ten rejection branches.
Overlap check found only `feature/1364` on `e2e/fixtures/realDaemon.ts`; operator exception
in the issue permits this overlap and preserves that parked branch. No new dependencies.

## Open questions

None. The maintainer reports dedicated daemon revision
`dccd18286b8f80d113c055322e22df3125bd1735` containing upstream PRs 2513 and 2520;
the live gate must record its actual binary revision and executed result.

## Documentation handoff

Pending for documentation stage: Update `docs/knowledge/features/composer-permission-mode-menu.md`
and `docs/knowledge/features/run-config-store.md` under **Permission mode** to distinguish
confirmed running posture from stored/acknowledged intent and explain that an empty mode
can accompany a resolved session.

## Security review

**Verdict:** PASS

- [Trust boundaries] `onDriverEvent` retains request correlation; the new subscriber checks client-stamped server ownership, active conversation and replacement session before accepting a report. Main invalidation prevents old same-conversation requests crossing a session boundary.
- [Permissions] The client-owned settable list still excludes bypass. Acknowledgement never establishes enforcement; only a fresh `session_settings` report changes the label. Daemon write no-op behavior is outside scope per upstream 2510.
- [Concurrency] One bounded timer per subscription; all context exits cancel it. Local change tracking avoids dependence on write-bridge registration order. Tests must hold early replies and prove cleanup.
- [Logs and rendering] Only static diagnostic codes; existing escaped, bounded text and own-property label lookup remain. No daemon value reaches logs or attributes.
- [Tokens, storage, crypto] No production secret, storage or cryptographic changes. Live fixture keeps isolated HOME, existing credentials handling and cleanup; controlled Read file is synthetic and outside the workspace but inside the fixture home.
- [Electron and network] No IPC surface, window security, transport or TLS change. Preserve the guarded launcher; fake Electron execution requires approved host execution.
- [Threat model] Hostile delayed/reordered reports cannot assert another context. Compromised daemon truthfulness remains the existing trust boundary; this ticket cannot independently attest Claude enforcement. The executed live Read is the behavioral regression witness.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-20

## Revisions

- 2026-09-20: Retry reads are serialized within the 500ms/15s window: another read
  waits for the previous report, avoiding a slow response being superseded on every
  tick. Missing replies time out without extra requests. The deadline and teardown
  tests cover both outstanding and already-answered reads.
- 2026-09-20: Invalidation clears only `permissionMode` in the existing snapshot,
  preserving model, effort and usage behavior at reconnect/reset. Navigation retains
  its existing whole-snapshot clear. The subscriber receives the injected config store
  to keep this mutation tested with the real store implementation.
