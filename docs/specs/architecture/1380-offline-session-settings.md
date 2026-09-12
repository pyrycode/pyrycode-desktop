# Host availability for session settings

## Files read

- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `ComposerModelMenu`, `ComposerModelMenuView` — held labels and published choices.
- `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx` → `ComposerEffortMenu` — model-dependent effort choices.
- `src/renderer/src/screens/conversation/ComposerPermissionModeMenu.tsx` → `ComposerPermissionModeMenu` — permission choices and Auto capability gate.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `RunConfigSections`, `RunConfigView` — existing inert sheet presentations.
- `src/renderer/src/screens/conversation/EffortDefaultData.tsx` → `EffortDefaultData`, `effortDefaultToApply` — eligibility and mount-local attempt guard.
- `src/renderer/src/screens/conversation/unpairAction.ts` → `serverIdForOpenConversation` — rejects missing and ambiguous ownership.
- `src/renderer/src/screens/conversation/runSettingsControls.ts` → `changeSetting` — session-id gate before optimistic dispatch.
- `src/renderer/src/store/sessionStore.ts` → `SessionState.statuses` — per-host connection truth.
- `src/renderer/src/store/conversationListStore.ts` → `selectConversations` — stamped host ownership.
- `src/renderer/src/store/runSettingsWriteBridge.ts` → `submitSettingsChange`, `RunSettingsWriteData` — synchronous submit and reconnect cleanup.
- `e2e/sidebar-offline-mutations.spec.ts` → `observeCommands`, `connection` — renderer-boundary CDP command observation and host events.
- `e2e/composer-effort-default.spec.ts` — effect proof using fake session settings.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-run-configuration.md`, `composer-effort-menu.md`, `conversation-shell-composer-options.md`, `development-verification.md` — static rendering cannot prove effects or handlers; preserve held settings and existing menu vocabulary.

Codegraph context failed because the index is not initialized; repository search supplied this map.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

The desktop chat has a 400px sidebar alongside a flexible thread and a compact input footer. The footer uses body-small text, primary-colour setting labels and upward chevrons, with choices in an overlay above it. Reuse the existing footer spans and read-only sheet controls; remove interactive affordances while preserving the displayed values, theme tokens and existing host/disconnection indication.

## Context and scope

One deliverable: session-setting writes follow the conversation's owning host availability. Estimate about 500 written lines including tests and this plan, five production files, no new exported types/components/stores, no required consumer migration, four acceptance criteria and one new reject condition. The refiner's approximately 450-line forecast is comparable; the cited `d331a36` conversation-scope analogue contains 55 additions and 97 deletions. No remote feature branch overlaps the five production files after fetching origin.

## Design

Keep the five named containers as the edit surface. Put shared availability helpers beside `RunConfigSections`, which the other four containers already import. A hook subscribes to conversation ownership and the owning status, returning true only for an unambiguously owned conversation with `status.type === 'connected'`. Missing ownership or status fails closed. A synchronous counterpart reads the current stores immediately before a write.

Composer views accept an optional selection callback. Without it they render their held label in the existing inert footer presentation; an open shared menu unmounts, discarding its local selection/focus state. The sheet withholds `onChange` while offline and retains all read values. Existing session-id and model/capability rules remain in force. A shared submit wrapper checks current ownership/status and session id before delegating to `changeSetting`, so stale callbacks cannot create commands or optimistic changes.

## State and concurrency

No new store, async task, timer or subscription lifetime. Zustand hooks subscribe through the existing React lifetime. Reads and submission have no intervening await. Reconnection remounts available composer menus without replaying abandoned user input. `EffortDefaultData` subscribes to availability and returns before computing or recording an attempt when unavailable; once connected, its existing eligibility and attempt guard apply. An already attempted default remains attempted through reconnect within the same mounted conversation.

## Error handling

Unavailable is a local no-op, not a setting rejection. Leave held values and the existing connection indication intact. The shared submit wrapper logs static `session-settings` event codes for blocked/submitted writes through `sendDiagnostic`; no values or identifiers are logged. Existing write confirmation/rejection handling remains unchanged. No IPC or wire contract changes.

## Testing strategy

- Add focused fake-transport Playwright before production changes and observe RED on the offline controls.
- Observe calls to `window.pyry.sendCommand` with a CDP function breakpoint, before IPC/transport can discard them.
- Cover each composer menu pre-opened at disconnect, mouse/keyboard attempts, held values, inert sheet model/effort/YOLO, reconnection and a usable second host.
- Exercise missing ownership/status, connecting and other non-connected statuses; assert no optimistic overlay or setting command.
- Exercise the actual remembered-effort effect while unavailable, on reconnect, after rejection/reconnect, and when eligibility changes before reconnect.
- Run touched unit files and the focused Playwright spec against `npm run build`. Capture the integrated offline footer/sheet in scratch and compare with the Figma reference. Full suites belong to the verifier; no live Claude test is needed.

## Documentation handoff

Pending documentation stage: record host-gated settings and remembered-effort reconnect semantics in `docs/knowledge/features/conversation-shell-run-configuration.md` § Run configuration Model/Effort/YOLO sections and `docs/knowledge/features/composer-effort-menu.md` § Testing the default apply. The ticket has no separate documentation acceptance criterion.

## Open questions

None.

## Security review

**Verdict:** PASS

- Trust boundaries: ownership uses `serverIdForOpenConversation`, rejecting ambiguity; availability never falls back to another host or the global last status. This is client availability, not an IPC authorization mechanism.
- Tokens, storage and cryptography: no credentials, persistence, paths or cryptographic operations added; existing main-process ownership is unchanged.
- Electron attack surface: no bridge, window, navigation or remote-content changes. Existing typed `setSessionSettings` remains the only write command.
- Network and I/O: no transport changes or new reconnect work; blocked user choices are not queued.
- Logs: only client-owned event/codes, no setting values, daemon text, host IDs or secrets.
- Concurrency: handlers re-read current stores synchronously before optimistic dispatch; unavailable automatic effects do not consume the attempt guard. Menu unmount removes stale keyboard listeners through existing cleanup.
- Threat model: delayed/disconnected host events close the gate when reflected in `SessionState.statuses`; this does not claim to predict a physical disconnect before the client observes it. Permission/YOLO choices retain their existing contracts. Reset/compact/recovery and activation fetches remain assigned to #1382.

**Reviewer:** builder self-review using `builder/security-review.md`
**Date:** 2026-09-13
