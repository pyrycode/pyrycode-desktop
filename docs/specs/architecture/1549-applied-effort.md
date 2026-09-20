# Applied effort and remembered choices

## Files read

- `src/renderer/src/store/runConfigStore.ts` → `RunConfigSnapshot`, `clearSnapshot`: whole-value reading and conversation teardown.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `toRunConfigSnapshot`, `subscribeRunConfig`: mapping and active-conversation attribution.
- `src/renderer/src/screens/conversation/runConfigLive.ts` → `RunConfigLiveData`: app-lifetime subscription and existing turn refresh.
- `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx` → `ComposerEffortMenu`, `composerEffortMenuModel`: applied presentation seam.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsMenu`: existing trigger, popup, focus and escaped text.
- `src/renderer/src/store/runSettingsWriteBridge.ts` → `foldWriteEvent`, `confirmedEffortLevel`: correlated success and preference persistence.
- `src/renderer/src/store/runSettingsWriteStore.ts` → `selectEffectiveSettings`: explicit-choice composition, retained for recall and sibling controls.
- `src/renderer/src/screens/conversation/EffortDefaultData.tsx` → `effortDefaultToApply`, `EffortDefaultData`: published-level membership and once-per-opening guard.
- `src/renderer/src/store/lastEffortStore.ts` → `lastEffortStore`: existing app-wide persistence.
- `src/renderer/src/activateConversation.ts` → `activateConversation`: clears reading and write state on switches.
- `e2e/composer-effort-menu.spec.ts`, `e2e/composer-effort-default.spec.ts`: correlated fake replies and recall drive.
- `e2e/real-claude-effort-default.spec.ts`, `e2e/fixtures/realDaemon.ts` → `withIsolatedElectronApp`: live turn proof and profile lifecycle.
- `docs/knowledge/features/composer-effort-menu.md` → renderings/default apply; `last-effort-store.md` → What it does; `run-settings-write-store.md` → confirmation and teardown; `development-verification.md` → non-vacuous response and turn evidence.

Codegraph context was attempted but the project index was unavailable; repository reads and search supplied this map. No in-flight remote feature branch overlaps the planned files.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3688

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

Both design contexts and screenshots show a compact body-small label with an upward chevron and a vertically stacked rounded options panel. Reuse `ComposerOptionsMenu`, the existing matching chevron, and the existing primary/body-small theme styling. Published model levels replace the illustrative Figma labels; unavailable readings retain the same Effort trigger geometry.

## Context

Saved effort is a choice; `effectiveEffort` is Claude's applied reading. The renderer currently drops that reading and presents saved or acknowledged choices instead. The existing preference and recall policy remain valid when their inputs continue to represent explicit choices.

## Design

- Add optional `effectiveEffort?: string | null` to `RunConfigSnapshot`. Map omission, explicit null, empty string and nonempty strings without coercion. Whole-snapshot replacement and the current conversation attribution gate prevent a previous reading from surviving a switch or a later omitted field.
- The effort container takes its settled reading from `snapshot.effectiveEffort`, overriding it only while an effort write is pending. Confirmed choices never override a fresh applied reading. `selectEffectiveSettings` keeps its current contract for model selection, recall and the settings sheet.
- Widen the effort view/model input to nullable/omitted. Unavailable or empty readings show Effort, no selected row, and a static description explaining Claude default / unavailable reading. Explicit null explains that Claude reports no model effort parameter. Use client-owned tooltip text on the label; no daemon text in attributes. Without published levels the label is read-only, including the unselected case.
- Extend `foldWriteEvent` with an optional refresh callback. A correlated successful effort write dispatches, remembers the chosen level, then requests fresh settings for the currently open conversation. Unmatched, rejected and passive events cannot refresh or persist through this path. Emit content-free confirmation/rejection diagnostics through the existing diagnostic bridge.
- Keep `EffortDefaultData` on explicit-choice composition. An applied inherited reading does not make saved effort nonempty. Existing pending/confirmed checks, supported-level membership and attempt marker prevent retries after rejection. No new message payload or preference storage.

## State + concurrency model

No new store or asynchronous task. Existing Zustand subscriptions own render wakes and existing effect cleanup removes event listeners. Snapshot and pending state clear on conversation exit/switch. The confirmation helper reads pending state before dispatch removes the correlation; the refresh runs afterward. The nullary refresh resolves the active conversation at invocation and `subscribeRunConfig` rejects replies for other conversations, including conversations on other hosts.

## Error handling

Existing connected/addressable-session gating and rejection state remain. A rejected effort write removes the pending overlay and restores the held applied reading, including unselected states. Unsupported remembered strings fail the existing published-level equality check. Read omission and null are data, not errors; neither invents a fallback level.

## Testing strategy

- Unit RED first: snapshot omission/null/string replacement; unavailable read-only menu and descriptions; applied-versus-saved/confirmed composition with pending rollback; correlated confirmation refresh ordering and rejected/unmatched no-op.
- Extend the fake menu/default drives with fresh response disagreement, inherited recall, nullable readings and rejection/no-retry evidence. Keep real UI interactions in Playwright. Include conversation/host attribution coverage through the existing subscription gate and scoped state clears.
- Extend the live effort spec: inherited reading after a real bootstrap turn; supported selection and fresh-response display; real Electron restart over the same profile; recall in a new chat and channel before their first turns; preserve an existing explicit choice. Observe sanitized settings responses to distinguish fresh readings from optimistic state.
- Builder runs touched Vitest files, build, and touched fake specs. Capture the existing effort trigger/panel in a fake run and compare to Figma. Dispatcher executes `npm run e2e:real:gate`, records executed cases and daemon revision containing pyrycode#2517; no live pass is claimed here.

## Size check

One deliverable: truthful applied effort with the existing confirmed-choice recall policy. Estimated 700–750 written lines including tests and this plan, four production files, no new exported types/components/stores, four production call sites affected by optional input additions, five acceptance criteria, no new state machine and at most two classified write outcomes. All six ticket ceilings hold.

## Open questions

None. A confirmed pre-launch preference may be persisted while the footer remains unselected until Claude supplies an effective reading.

## Documentation handoff

Pending for the documentation stage: reconcile the saved/applied/default distinction in `docs/knowledge/features/composer-effort-menu.md` (the renderings and default-apply sections) and `docs/knowledge/features/last-effort-store.md` (What it does). Retire the claim that an empty saved choice makes applied effort unknowable.

## Security review

**Verdict:** PASS

- Trust boundaries: `toRunConfigSnapshot` consumes the typed effective reading provided by #1548; `subscribeRunConfig` attributes the entire snapshot and session together to the active conversation. Tests must exercise late foreign replies.
- Tokens/storage: the only persisted value remains the nonsecret confirmed effort at the existing fixed localStorage key. This work adds no credential, filesystem path or storage operation.
- Electron/crypto/network: no new IPC surface, window configuration, transport, cryptographic primitive or network policy. The existing main-process decoder and Noise connection retain those responsibilities.
- Hostile daemon text: the new reading reaches React text children and existing bounded effort styling only. Descriptions are static client text; no reading in HTML, attributes, logs, URLs or filenames. Test escaped hostile text.
- Logs/errors: record static effort lifecycle codes only through `sendDiagnostic`; no setting value, message, identifier or payload is logged. Existing errors retain their typed path.
- Concurrency: correlation is read before dispatch; a switch clears pending state and rejects late acknowledgements. Existing listener cleanup and per-opening recall marker remain; no new long-lived work.
- Threat alignment: this change consumes the established decrypted settings boundary; it neither exposes secrets to the renderer nor alters content-blind relay or at-rest credential protection.

**Reviewer:** builder self-review per `builder/security-review.md`.
**Date:** 2026-09-20


## Revisions

- 2026-09-20: `selectAppliedEffort` is a pure helper in the existing menu module so the pending/settled distinction can be tested without effects. Zustand static renders read `getInitialState`, so mutating the singleton does not provide a valid container fixture.
- Updated the existing footer, offline, scoped-read and session-transition test fixtures to supply applied readings explicitly. Their former saved-only labels would assert the retired display contract. No additional production file is needed.
- The live spec observes only sanitized settings/confirmation fields, reads the actual daemon's `version` output using the existing live-test pattern, restarts Electron over its isolated profile, and records the revision as an attachment. Execution remains pending at the dispatcher gate. The seed gets a unique name through the existing editor to keep reopening independent of duplicate unnamed chats.
- Final implementation stays within four production files and roughly 550 written lines including the plan and test updates; no new exported type/component/store, no required consumer cascade, and no new state machine.
- 2026-09-20 rework: the verifier found that the effort spec's direct launch violated `desktop-isolation.spec.ts`'s launch-site guard. Add `IsolatedElectronApp.relaunch()` to `withIsolatedElectronApp` and consume it in the live effort spec. It closes and awaits the current process, reuses the fixture-owned profile and environment, and registers each replacement before awaiting its window. The fixture cleans up the active app and profile on success or failure. Stale or concurrent relaunch calls reject. The launch guard stays unchanged.
- `e2e/fixture-teardown-leak.spec.ts` now proves distinct processes, prior-process exit, persisted effort bytes, stale-handle rejection and cleanup after both successful and failed restarted callbacks. The operator's ticket-specific overlap exception permits these two shared fixture files despite parked `feature/1364`; its draft remains untouched. Codegraph remains unavailable, so repository reads supplied the fixture map. This adds no production file or product state and keeps total written work below 750 lines.
- Security review of the repair: PASS. Relaunch accepts no profile path or environment input, preserves the existing test-only flags, and never logs profile contents or launch errors. Cleanup retains its causal-error preservation. Live effort acceptance and the documentation handoff remain pending downstream.
