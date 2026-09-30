# Last confirmed model for new chats

## Files read

- `CLAUDE.md` and `docs/knowledge/features/development-verification.md` — static renderer tests and dispatcher-owned live gate.
- `docs/knowledge/features/last-effort-store.md` — injected renderer-local storage precedent; model recall deliberately does not re-remember.
- `docs/knowledge/features/composer-model-menu.md` — preserve the existing confirmed-selection label layers.
- `src/renderer/src/store/runSettingsWriteBridge.ts` → `foldWriteEvent`, `submitSettingsChange` — recover the choice before confirmation removes its pending record; record before send.
- `src/renderer/src/store/runSettingsWriteStore.ts` → `SettingsChange`, `reduceRunSettingsWrite` — optimistic selection, correlation and rollback.
- `src/renderer/src/store/conversationCreatedBridge.ts` → `useConversationCreatedNav` — both chat creation paths meet here, alongside channel creation.
- `src/renderer/src/PairedShell.tsx` → `PairedShell` — created navigation activates the chat and requests its own settings/capabilities.
- `src/renderer/src/activateConversation.ts` → `activateConversation` — clears active-only settings before requesting the new chat's state.
- `src/renderer/src/store/modelListStore.ts` → `selectModelListFor` — conversation-keyed published rows.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `sessionSettingsConnected` — owning-host availability precedent.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer`, `sendText` — shared send gate precedes draft and attachment consumption.
- `e2e/composer-effort-default.spec.ts` and `e2e/real-claude-effort-default.spec.ts` — withheld correlated replies and same-profile relaunch fixtures.

Codegraph returned an uninitialized-index error; source reads supplied the map. No overlapping in-flight feature branches were found.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3683

The node is a compact horizontal model label and upward chevron using primary colour and body-small typography. Keep `ComposerModelMenu` and the composer geometry unchanged; only sending availability changes during recall.

## Context and design

One app-wide non-secret raw model preference lives at the fixed localStorage key `pyry.lastModel`. A new `rememberedModel.ts` module supplies injected storage and a recall coordinator with a narrow reactive pending target. Read storage once per newly created chat. Remember non-empty deliberate model changes only in `foldWriteEvent` on a matching confirmation, before its pending record disappears. Add optional `source: 'recall'` to the model change variant; confirmation of that variant never remembers. Its rejection removes the overlay without setting the ordinary user-pick error.

`useConversationCreatedNav` installs recall listeners before invoking navigation so early replies are retained. Channels still navigate without recall. Existing-chat activation has no recall entry point. The coordinator owns an immutable conversation, host and agent target, not the active singleton session id. It accepts only the target's first `runConfigReceived` reply, including one arriving while waiting for models. An empty session id settles immediately. The created chat's model list may already be cached, or arrive on the event stream. Eligibility requires exact raw value equality, the created agent (absent means Claude) and no `value` truncation.

After eligibility, a usable first settings reply produces exactly one model-only `submitSettingsChange` with its session id and a fresh correlation id. Command return does not settle recall: the attempt remains blocked until its own confirmation or rejection. Confirmation commits the ordinary chat selection. Failure/rejection removes the optimistic recall overlay and preserves inherited state. No read/write retries or new wire/IPC surfaces are introduced. Effort recall stays independent.

## State and concurrency

Stages are waiting for models, waiting for settings and awaiting acknowledgement. Model and settings read stages each have a five-second timer; an already received settings reply avoids the second wait. A single pending target gates only that chat. Install listeners and the hold before activation; ownership checks begin after navigation completes. Every event and pre-write check verifies active target identity and owning-host connectivity. Leaving, losing the host or unmounting cancels listeners/timers and removes this attempt's pending overlay. Reopening/reconnecting cannot start it again. A new creation cancels the previous attempt. Retain no completed-attempt registry: only creation events start attempts.

The composer subscribes narrowly to the pending target for disabled Send and checks the coordinator synchronously inside `sendText`. The shared gate covers Enter, actions and status-area sends before `submitMessage`, preserving drafts and attachments. No promise is launched; timers and subscriptions have explicit cleanup.

## Error handling

Missing, empty or `default` preference; ineligible/empty rows; each read timeout; empty session; ownership loss; dispatch failure and correlated rejection settle silently. Classified diagnostics use only static outcome codes through `sendDiagnostic`, never model values, identifiers or exception text. Confirmed persistence uses the existing localStorage posture. No new storage-failure defence is added without an observed failure.

## Testing strategy

- Inject storage, stores, events and fake timers to prove verbatim persistence/restart, deliberate confirmation only, replay/unmatched/rejected/passive/automatic non-remembering.
- Prove exact eligibility, absent-agent Claude semantics, wrong agent/unoffered/truncated/empty rows, both five-second deadlines and empty session, including settings-before-models.
- Prove one model-only write, acknowledgement hold, rollback and silent errors, navigation/disconnect cancellation, no retry and unrelated-chat availability.
- Focused fake-transport spec withholds recall acknowledgement; Send/Enter preserve draft until success or rejection. Existing chats/channels issue no recall writes.
- Real-Claude spec deliberately confirms a published model different from the inherited announcement, relaunches the same profile, creates a chat and verifies its first announcement against the picked row's resolution. Execution belongs to the dispatcher `npm run e2e:real:gate`; all-skipped is not acceptance.
- Builder runs touched unit files, build and the focused fake spec. Preserve the existing footer appearance in an integrated capture.

## Size check

One deliverable, approximately 750 written lines including plan, tests and both e2e specs; five production files, two new exported interfaces, one reactive coordinator store, one existing consumer updated, five acceptance criteria and at most ten classified skip/failure branches. Preference and recall stay together because neither has another consumer.

## Documentation handoff

Pending for documentation stage: add a remembered-model feature doc beside `docs/knowledge/features/last-effort-store.md`, covering confirmation-only persistence and app-wide/profile scope. Note the new-chat eligibility, waits, first-send hold and silent fallback in `docs/knowledge/features/composer-model-menu.md`.

## Open questions

None. The settings address comes from the target's first correlated read reply; the active-only session store is never used by recall.

## Security review

**Verdict:** PASS

- Trust boundaries: typed daemon content stays untrusted. Recall eligibility compares raw values and agent identity; the settings reply's main-correlated conversation identity governs addressing.
- Tokens and crypto: preference is a published non-secret model string, not a credential. No crypto, keys or authentication changes; transport remains main-owned.
- Storage: one fixed profile-local key, no daemon-derived paths or keys. Raw content is written only as the value. Existing atomic localStorage operation and storage port precedent apply.
- Electron attack surface: reuse typed settings commands and existing preload validation; no new exposed capability, navigation, raw HTML or asset change.
- Network and I/O: existing transport/Noise/TLS limits are unchanged. Both read waits are bounded; write settlement follows correlated replies or owning-connection teardown, never command return.
- Logs and telemetry: static lifecycle/outcome codes only; no ids, values, caught errors or new telemetry.
- Concurrency: target/session/correlation captured locally; cancellation clears timers/listeners and just this overlay. Ownership is checked again before writing, so delayed frames cannot target a different active chat.
- Threat alignment: relay delay produces silent read timeout; replay cannot remember twice once the pending record is consumed. Hostile model text is never parsed or used as markup/log/path. Existing token-at-rest and renderer-isolation contracts remain unchanged.

**Reviewer:** builder self-review per `builder/security-review.md`
**Date:** 2026-10-01
