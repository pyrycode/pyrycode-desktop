# Merged model pickers and confirmed agent switching

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: process boundaries and static versus interactive evidence.
- `docs/knowledge/features/composer-model-menu.md`: inherited ambiguity stops, labels, and raw-value dispatch.
- `docs/knowledge/features/conversation-shell-composer-status.md`: status overlay and error ownership.
- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `composerModelMenuModel`, `ComposerModelMenuView`, `ComposerModelMenu`: selection derivation, shared panel and footer wiring.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `ModelSection`, `publishedRowFor`, `effortRowFor`, `changeConnectedSetting`: sheet rendering and agent-scoped settings contracts.
- `src/renderer/src/store/agentSwitchStore.ts` → `openAgentSwitch`, `createAgentSwitchStore`: retained picked row, synchronous pending guard, owning-host outcomes.
- `src/renderer/src/screens/conversation/AgentSwitchDialog.tsx`: existing confirmation and supported-effort dispatch.
- `src/shared/ipc/commands.ts` → `isSwitchAgentPayload`: main-boundary agent and payload shape validation.
- `src/main/connectionRegistry.ts` → `switchAgent` forwarding: existing connection routing.
- `e2e/agent-switch-confirmation.spec.ts`, `e2e/composer-model-menu.spec.ts`, `e2e/run-config-settings.spec.ts`: fixture frames, actual picker locators and command evidence.
- Picker static tests and `modelSelection.test.tsx`: shared inherited/current matching assertions.

## Design source

Figma: [trigger](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3683), [options](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879), [confirmation](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=578-3198).

Read design context and screenshots for all three nodes. Keep the existing body-small primary text, up-chevron, compact vertical panel, row padding and corner tokens. Reuse the shipped sheet radio/descriptor layout and confirmation's title, separator, copy and Cancel/Switch buttons. Only the list gains rows; no styling or asset change is required.

## Context

Both published agents must be selectable from either existing model picker. Other-agent selection is an intent to open the shipped confirmation, not a settings write. No ADR is needed. No overlapping in-flight feature branches touch either production file.

Sizing: one independently checkable routing deliverable, five observable acceptance criteria, approximately 650 written lines including tests/plan, two new exported helpers, two picker consumers, no new reject state machine. Within all builder limits; no dependencies or wire changes.

## Design

- Both lists filter only raw `value === 'default'`, preserving published rows and order. Footer labels keep `composerModelRowLabel`; sheet text keeps display names and descriptors.
- `composerModelMenuModel(models, layers, agent, pendingSwitchRow?)` retains agent-scoped explicit/inherited matching over `modelRowsFor`. Internal panel IDs become visible-row positions so duplicate values, including cross-agent collisions, remain independent options. Raw values are recovered from the actual clicked row, never parsed to infer an agent.
- Add `selectConnectedModel(conversationId, row)` at the existing settings action boundary. Recheck connection/session addressability and the current conversation agent. Own-agent rows use `changeConnectedSetting` with their raw value; other-agent rows use `openAgentSwitch`. Its store rechecks the active pane and owner.
- Add `usePendingAgentSwitchRow(conversationId)` beside existing ownership hooks. Read only pending for that conversation whose stored `serverId` equals its current owning host. Pass the retained row separately to both pure views.
- Confirmed pending overlays only model label/marking. Opening/cancelling installs none. Match its target row by agent and raw value; label comes from the retained row. Underlying settings and effort/permission offerings still use the outgoing agent until the authoritative list changes it.
- Sheet selection passes the actual row through an optional `onModelSelect` callback; other settings continue using `onChange`. Existing static callers without that callback retain their raw model change callback.

## State + concurrency model

No new store, timer, stream or async job. Zustand subscriptions select the retained pending row with stable identity. `agentSwitchStore` remains the sole switch owner and synchronously records pending before sending. Its existing rejection, fresh owning-host list, disconnect, missing conversation and unpair handling remove the overlay; late foreign-host outcomes cannot establish success. A second other-agent pick while pending is suppressed by the existing store. Settings overlays remain in `runSettingsWriteStore`.

## Error handling

Reuse existing typed IPC command validation and correlated refusal handling. No new error branch or rendered error copy. Preserve disconnected/addressability guards at render and click time. Host mismatch never displays pending. Refusal/abandonment falls back to unchanged model settings. Labels stay escaped JSX text; no logging of model strings or daemon content.

## Testing strategy

- First update/add failing unit/static assertions for merged daemon-order listing, hidden defaults, duplicate raw values, own-agent explicit/inherited marking, Codex exact labels and pending overlay without changing effort offerings.
- Unit-test the shared routing boundary in both directions, including untagged Claude and unavailable/owning guards; static tests do not execute UI handlers.
- One ticket-local fake-transport Playwright spec drives footer and sheet entry points, own-agent writes, Cancel, Switch with supported effort, duplicate-pick suppression, refusal rollback, abandonment and authoritative success/new-agent offerings. Capture integrated menu/sheet/confirmation at 1280×800 and the minimum width.
- Run changed focused units, targeted fake spec, final pre-verify full unit/typecheck gate and build after final main merge. No live test file changes.
- Pending dispatcher credentialed gate and operator acceptance: establish a fact in a Claude channel, switch to GPT-6 Luna at low effort, ask a question requiring that pre-switch fact without restating it, record the correct answer and the footer's Luna display name. Fake evidence cannot prove hand-over; retain `needs-real-claude`.

## Open Questions

None. Reuse the shipped switch state path rather than adding another routing store.

## Security review

**Verdict:** PASS

- [Trust boundaries] Published rows are decoded shapes, not safe markup. Routing uses each clicked row's explicit agent (untagged means Claude) and raw value. Main retains `isRendererCommand`/`isSwitchAgentPayload` validation and daemon authorization; no new bridge surface.
- [Tokens] No tokens, secrets or credentials are created, read, stored or forwarded by picker code; transport and safeStorage remain in main.
- [File and storage operations] No filesystem or browser persistence is added. Pending is in-memory conversation/host-owned state; labels never become paths or storage keys.
- [Electron attack surface] Existing isolated windows and fixed bridge are reused. No navigation, remote content, Node access or IPC channel is introduced. All rows reach escaped text sinks.
- [Cryptographic primitives] No crypto or nonce handling changes; Noise and keys remain in main, with the existing protocol variant.
- [Network and I/O] Only the validated existing settings/switch commands are sent. Transport frame limits, deadlines and cancellation remain owned by existing main transport; no new network task.
- [Errors, logs, telemetry] Existing static diagnostics and generic refusal copy remain. Do not log daemon model values, labels, messages, credentials or payloads; no telemetry change.
- [Concurrency] MUST FIX addressed in design: a cross-host retained status could display another host's choice. Pending reads require conversation and owning `serverId`; the existing synchronous pending guard prevents double switch sends, and confirmation revalidates pane/connection/agent.
- [Threat model alignment] Compromised relay cannot gain plaintext via this UI; existing Noise covers transport. Token theft remains covered by existing safeStorage. Hostile daemon names are escaped and layout-bounded. Compromised renderer remains behind main command validation and daemon authorization. No security infrastructure change is required for this ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07
