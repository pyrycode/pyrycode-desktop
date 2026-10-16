# Host-scoped settings lifetime

## Files read

- `src/renderer/src/activateConversation.ts` → `activateConversation`: existing clear-before-set boundary compares only conversation ID.
- `src/renderer/src/activateConversation.test.ts` → `realDeps`: isolated real-store activation coverage.
- `src/renderer/src/PairedShell.tsx` → `activateDeps`, `openConversation`, created-conversation callback: both callers retain the selected `serverId`; configuration clear resets snapshot, writes and prompt state together.
- `src/renderer/src/store/activeConversationStore.ts` → `createActiveConversationStore`: retains structurally wider host-stamped payloads verbatim.
- `src/renderer/src/store/runSettingsWriteStore.ts` → `reduceRunSettingsWrite`, `selectEffectiveSettings`: conversation switch clears pending/confirmed/error; discarded correlations cannot settle.
- `src/renderer/src/store/runSettingsWriteBridge.ts` → `foldWriteEvent`: only matching pending writes can change preferences.
- `src/renderer/src/screens/conversation/confirmedRunConfig.ts` → `subscribeConfirmedRunConfig`: context changes already invalidate confirmation polling.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `useConversationAgent`, `changeConnectedSetting`: selected-host controls and write boundary.
- `src/renderer/src/store/agentSwitchStore.ts` → `openAgentSwitch`: existing confirmation opening used by the mounted fixture until picker integration lands.
- `e2e/agent-switch-confirmation.spec.ts` → `openingFixture`: production opening exposed only in a temporary renderer build; extend with local collision scenarios.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`: repository and verification contracts.
- `docs/knowledge/features/paired-shell-conversation-exits.md`, `docs/knowledge/features/run-settings-write-store.md`, `docs/knowledge/features/conversation-shell-run-configuration.md`: refresh on reopen, whole-lifetime clearing, sparse confirmation precedence.

## Design source

Figma footer: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3683 — compact primary body-small model label with an upward chevron. The ticket's sheet node `20-100` is deleted; metadata identifies the current Run configuration reference at https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=600-1694 (design context and screenshot read). It uses a dark modal, section headings, radio choices and primary text. This ticket changes which held value feeds the existing footer/sheet, with no styling changes.

## Context

Two hosts can publish the same conversation ID. An acknowledged model override from the departing host currently shadows fresh settings from the incoming host because activation treats that navigation as a reopen. No ADR is needed.

## Design

Compare both optional renderer-owned `serverId` and conversation `id` in `activateConversation`. Express optional host metadata inline on its input and getter contracts, leaving wire types untouched. Any identity change takes the existing clear-session/configuration path before storing the incoming conversation and refreshing. Both missing hosts retain legacy same-ID reopen behavior. No new exported symbol, state, failure branch or consumer migration.

In-flight overlap: #1662 changes a separate assertion in `agent-switch-confirmation.spec.ts` and introduces `merged-model-pickers.spec.ts`; add local cases without changing its assertion or copying its harness. Its picker integration is not required: the existing fixture opens production confirmation directly after a real own-agent pick through footer/sheet.

Sizing: one deliverable, two observable criteria, approximately 280 written lines including plan/security review and tests; one production file, zero new exported types/components/stores, two unchanged production callers and zero new reject branches. Re-count before committing: within all five limits.

## State + concurrency model

No new async work or subscriptions. Activation synchronously retires outgoing state before incoming context publication. The existing configuration clear resets the snapshot, settings-write pending/confirmed/error and system-prompt state. Existing confirmation context subscriptions own polling cleanup; existing write correlations make late settlement a no-op.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Same host and ID reopened with refreshed payload | `activateConversation.test.ts`: host-scoped reopen retains configuration and session. |
| Host changes with identical ID, including returning to the original host | `activateConversation.test.ts`: host switch retires all four confirmed/pending settings and errors; mounted `host settings lifetime` cases cover both agents and footer/sheet. |
| Host metadata appears/disappears | Parameterized activation tests clear on each ownership change. |
| Discarded writes confirmed/rejected after switching, then new writes settle | Real-store activation test verifies ignored old IDs, fresh confirmed/rejected writes and a second host rotation. |
| Cross-agent switch remains pending while selecting another host | Mounted cases retain exact per-host settings/switch counts and display incoming saved model in footer and sheet. |

## Error handling

No new I/O or error classification. Retire the outgoing error through `conversationSwitched`; unmatched late replies cannot create a new error. New writes retain existing confirmation/rejection semantics. Host identity is never inferred from model text.

## Testing strategy

- Test first: real-store activation regressions for host ownership and stale correlations, plus same-host preservation.
- Mounted Linux fake transport: own-agent write acknowledged before production cross-agent confirmation, leave switch pending, navigate to opposite-agent same-ID host with a distinct session, check its settings in footer and sheet and exact per-host request counts. Capture at 1280×800.
- Run changed tests, final main merge, dependency install, pre-verify check and build. Replay affected original settings/model scenarios with their original outgoing-request assertions. No new live-provider or second-OS check is required.

## Open Questions

None.

## Security review

**Verdict:** PASS

- [Trust boundaries] Host metadata comes from renderer navigation's selected stamped row, never model text; `activateConversation` compares ownership before retaining settings. Existing main-side acknowledgement correlation and typed IPC remain unchanged.
- [Tokens, secrets, credentials] No credentials are introduced or accessed; the fix operates on renderer configuration already admitted by existing IPC.
- [File and storage operations] No new production storage/path operation; confirmed choices remain memory state. Tests use synthetic hosts and temporary app data.
- [Electron attack surface] No IPC API, window preference, navigation or content sink changes. The test-only opening remains in `openingFixture`'s temporary build, not production output.
- [Cryptographic primitives] No changes to transport, Noise, randomness, keys or nonces; no cryptographic work moves into the renderer.
- [Network and I/O] Existing configuration requests and per-host correlation are reused, with unchanged payloads and bounds. No new connection, retry or timeout.
- [Errors, logs, telemetry] No model/session content enters logs or new errors; existing diagnostic codes remain content-free.
- [Concurrency] Clear pending correlations before replacing active identity. Tests must prove late confirmation/rejection cannot recreate overlays or affect a newly submitted write; repeated host rotations are included.
- [Threat model alignment] Delayed daemon responses cannot restore retired permission/YOLO overlays. Malformed daemon responses remain behind existing parsers; malicious relay, token-at-rest protection and renderer isolation are unchanged because no boundary or transport code changes.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-16
