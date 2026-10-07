# Agent switch confirmation and progress

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/development-verification.md`: renderer ownership, static-test boundaries and capture requirements.
- `src/renderer/src/components/Modal.tsx` → `Modal`: shared presentation, existing local close asset and caller-owned focus/Escape.
- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `composerModelRowLabel`: agent-specific model label.
- `src/renderer/src/store/conversationListStore.ts` → `selectConversationsFor`, `selectConversationAgentFor`: main-stamped owning-host rows and absent-agent Claude convention.
- `src/renderer/src/store/conversationListBridge.ts` → `ConversationListData`: existing authoritative refresh on conversation updates.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `sessionSettingsConnected`: fail-closed unique client-held owner resolution.
- `src/renderer/src/store/activeConversationStore.ts`, `sessionStore.ts`, `serverInfoStore.ts`, `runSettingsWriteStore.ts`: open conversation, connection/removal lifecycle and effective current effort.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThinkingIndicator`, `statusRowCopy`, `resettingLabel`: additive switch copy override without changing ordinary reset copy.
- `src/renderer/src/App.tsx`: app-lifetime subscriptions and modal mount.
- `src/shared/ipc/commands.ts` → `isSwitchAgentPayload`; `src/main/index.ts` switch command arm; `src/main/daemonConnection.ts` → `switchAgent`: existing validated/routed command and correlated refusal.
- `e2e/fixtures/launchPairedApp.ts`, `e2e/session-error-notice.spec.ts`: scoped alternate renderer build, real subscriptions and fake encrypted frames.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=578-3198; status 578-3241, copy 578-3246, shared modal 489-1942. Read all four contexts and screenshots. Reuse `Modal` at width 640 with centered body text, existing close asset, title/body typography, primary buttons, dark on-primary-fixed surface and elevation tokens. Reuse the status row's existing PyryMark and body-small primary copy. Caller adds token-based overlay/scrim only.

## Context

Picking another agent requires confirmation and distinct progress until an authoritative list shows the new binding. No success acknowledgement exists. Refusal does not establish that wrap-up had no effects. Menu entry points and optimistic model display belong to #1662. #1818 is closed; fetched remote feature branches have no overlap with the planned files. One independently verifiable deliverable; estimate approximately 720 written lines, five production files, at most five new exported type/component/store surfaces, one existing indicator consumer and four acceptance behaviours. No dependency or ADR needed.

## Design

A dedicated `agentSwitchStore.ts` exposes `openAgentSwitch(conversationId, row)`, a singleton narrow read surface and an injected factory for unit tests. One dialog attempt holds conversation ID, client-resolved owning host, outgoing agent and picked row. A map keyed by conversation ID holds discriminated pending/refused states. Internal discriminated actions open, cancel, confirm, reconcile and consume typed daemon outcomes. Opening an already-pending conversation is inert; a new opening clears its old refusal. Confirm re-reads open conversation, owning row, host connection and outgoing binding, commits pending synchronously, closes the dialog, then sends exactly one existing command. Model is verbatim, including empty; effort is included only when the picked row supports the current effective effort. Missing row agent means Claude.

`AgentSwitchData` owns lifecycle and typed daemon-event subscriptions. Only fresh `conversationsReceived` rows for the attempt's host and ID can succeed; read actual row existence before applying absent-agent Claude. Missing rows abandon. Refusals require matching pending host/ID. Reset completion, transitions and other hosts cannot settle pending. Existing `ConversationListData` continues to request lists.

`AgentSwitchDialog` reads the dialog and composes `Modal`. Cancel, close and Escape cancel; focus starts on Cancel, Tab stays within the dialog, and close restores prior focus when still mounted. Body uses `composerModelRowLabel` as escaped text content, never an attribute or log.

`ConversationScreen` selects only the open conversation's state matching its owning host. Optional indicator input overrides ordinary state/copy: pending uses generic switching before/after reset phases, wrapping-up names the outgoing agent, restarting names the target. Refused uses fixed copy and optional Try again. Existing reset label/suffix output stays identical. Switch lives outside the single-field settings-write machine.

## State + concurrency model

App-lifetime local memory survives pane navigation and process updates. Lifecycle subscriptions abandon pending/dialog on host disconnect/removal or authoritative conversation removal; navigation closes only an unconfirmed dialog. Confirmation checks again at the dispatch boundary without an await. Pending precedes sending, so synchronous responses and repeated clicks cannot resend. All subscriptions return cleanup handles; no timers, streams or persistence added. A delayed/unmatched refusal is ignored; main already correlates the wire reply. No automatic retry.

## Error handling

Disconnected, removed, changed-agent and no-longer-open confirmations send nothing. A matching refusal becomes value-free refused state with retryability only. Abandonment claims neither success nor refusal. Lifecycle diagnostics carry static event/code only. No new I/O failure mode, bridge, main/preload or wire change.

## Testing strategy

- Test first using injected store dependencies: both directions/default agent, verbatim empty model and supported/unsupported effort, synchronous pending, duplicate confirm/open, stale confirmation guards, navigation/lifecycle abandonment and preservation.
- Unit outcome tests: unchanged list/reset/transition retain pending; actual target list succeeds (including Claude absent-agent rows); missing row abandons; both refusal kinds, no automatic resend, next opening clears refusal, host/conversation isolation.
- Static dialog/indicator assertions pin escaped model text, both directions and exact phase/refusal/reset output.
- One scoped Playwright spec builds a ticket-local alternate renderer in scratch with the exported opening function accessible only in that fixture. Uses mounted real App, real preload subscriptions, fake daemon frames and captured outgoing switch commands. Proves Switch/Cancel/Escape/X, progress/refusal/list completion and captures 1280x800 plus constrained 800px modal states. No production menu/test hook or shared harness.
- Final merge main, install, pre-verify full unit/typecheck gate, build and focused Playwright. No live tests changed; #1662 owns live acceptance.

## Open Questions

None. Simpler shape considered: a pane-local dialog cannot retain pending outcomes across navigation; one dedicated store and one app-lifetime owner keeps this contract local.

## Security review

**Verdict:** PASS

- [Trust boundaries] Existing `isSwitchAgentPayload` validates the IPC union; command uses only resolved client-held conversation/host and picked typed row. Outcome trusts main's host stamp, never payload routing. Missing rows cannot imply Claude success.
- [Tokens] No credentials generated, read, stored or logged. Existing safeStorage/main ownership unchanged.
- [Files/storage] No production disk/browser storage, paths or cache keys added; model remains escaped text and outbound typed payload only.
- [Electron surface] No new bridge API, navigation, remote content or security setting. Existing main router and command validation remain authoritative; confirmation is operator UX, not a replacement for IPC validation.
- [Crypto] No crypto change, key access or raw frame access in renderer; existing Noise transport remains main-owned.
- [Network/I/O] No socket/reconnect/deadline change. Host disconnect abandons local work without resend; relay delays cannot falsely complete it.
- [Errors/logs] Fixed refusal copy and static lifecycle diagnostics only; no model, effort, messages, token or backend detail logged.
- [Concurrency] Pending committed before send; confirmation revalidates without await; cleanup removes all listeners. Only matching pending refusals and fresh owning-host rows settle attempts.
- [Threat model] Hostile daemon text is escaped and cannot become attributes/logs; cross-host frames cannot settle an attempt. Compromised renderer remains constrained by existing main validation; token theft and relay crypto remain owned by existing transport/security infrastructure, unchanged here.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07
