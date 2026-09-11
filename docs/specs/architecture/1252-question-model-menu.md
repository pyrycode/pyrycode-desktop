# Model changes during a question batch

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `ComposerSlot`, `QuestionPanelSlot`, `ComposerErrorSlotControl`: preserve the mounted composer and keyed question panel; reuse the status priority seam.
- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` — `ComposerModelMenu`: existing single-field write and optimistic label layers.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` — `RUN_CONFIG_ERROR_COPY`: existing rejection wording.
- `src/renderer/src/screens/conversation/conversation.css` — `.composer__footer`, `.composer-status__error`: footer tokens and error geometry.
- `src/renderer/src/store/runSettingsWriteStore.ts` — `selectError`, `reduceRunSettingsWrite`: rejection and clearing lifecycle.
- `src/renderer/src/screens/conversation/composerSlot.test.tsx` — `ComposerSlot` static coverage.
- `e2e/composer-model-menu.spec.ts` — `capturingFake`: correlated held settings replies.
- `e2e/question-answer-continue.spec.ts` — `capturingAnswerFake`: answer-token-safe capture, picks and draft preservation.
- `e2e/real-claude-question-answer.spec.ts` — existing live question and continuation proof.
- `docs/knowledge/features/composer-model-menu.md` — label priority and published options.
- `docs/knowledge/features/development-verification.md` — hold optimistic replies and require positive continuation evidence.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-composer-status.md`, `modal-store-bridge.md`, and `live-e2e-runbook.md` — composition, priority, lifecycle and live gate context.

Codegraph returned an uninitialized-index error; repository reads supplied the code map.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6015

The questionnaire is a column with wrapping question tabs, a bordered answer panel, radio/checkbox choices and Other text, followed by right-aligned answer actions. Preserve its existing drawing. Place the existing primary-colored body-small model label and upward chevron from https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3683 in the existing footer row immediately beneath it.

## Context and design

The daemon now delivers model changes as control requests, so the question need not be cancelled to change models. Add a conditional model-only footer sibling after `QuestionPanelSlot` in `ComposerSlot`. Keep the original `Composer` mounted and hidden, preserving its draft and covered controls. Retain the panel key and all answer-state ownership.

Subscribe to `selectError` in `ComposerErrorSlotControl`. A model rejection supplies fixed, announced error copy instead of the usage notice through the existing `notice` seam. `ComposerErrorSlot` continues to prioritize repair and connection errors and suppress notices while disconnected. Reuse the existing error treatment with a wrapping modifier so the sentence fits at the minimum width. No exported signature changes, transport changes, dependencies or new state.

## State, concurrency and errors

The existing menu calls `changeSetting` once with only the model field. Existing pending/confirmed/announced layers remain authoritative. The question store, active question local state and picks are unaffected by settings responses. Existing settings dispatch, rejection, conversation-switch and reconnect lifecycles govern the error; no new timers or subscriptions beyond the narrow store hook. Existing settings-send structured logs cover dispatch and classified rejection; no new I/O occurs here.

## Testing strategy

- Add a static failing assertion for a separate footer while the original composer remains hidden.
- Extend fake question-answer coverage with published models, a held settings reply, model-only payload capture, mouse/keyboard selection at 800px, preserved active question/picks/Other, original-batch answers and intact draft.
- Cover correlated rejection, optimistic rollback, error visibility and clearing, and usage/connection priority using the existing status seam and fake transport.
- Extend the real question spec to select a different published non-empty model before answering and record a new model announcement alongside the existing positive continuation proof. Run the relevant spec through `npm run e2e:real:gate`; all-skipped is not acceptance evidence.
- Run touched Vitest tests, build, and focused fake Playwright coverage. Compare the running questionnaire/footer against the Figma reference.

## Size and overlap

One deliverable: model changes while answering questions, including rejection and live proof. Estimate at most 650 written lines, two production files (screen and stylesheet), zero new exported types/components, zero changed consumer signatures, four acceptance criteria, and no new error branches in a state machine. The nearest live analogue `b9587b1` added 398 lines; this reuses its harness. Remote feature branches were fetched and checked; no overlap found.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/composer-model-menu.md` with availability during question batches and `docs/knowledge/features/conversation-shell-composer-status.md` with model rejection priority and clearing. The ticket names no additional documentation-only criterion.

## Open questions

None in the product contract. Live daemon capability and executed/pass counts remain verification evidence to obtain during implementation.
