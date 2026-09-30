# #1698 — typing into Other selects it

## Files read

- `src/renderer/src/store/questionPicksStore.ts` → `QuestionPickEvent` (`otherTextChanged` arm), `reduceQuestionPicks` — the arm that leaves `otherTicked` alone today.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `QuestionPanelSlot` — builds `at` (`multiSelect`, `questionBatchId`, `questionIndex`) and dispatches `otherTextChanged` without `multiSelect`.
- `src/renderer/src/screens/conversation/QuestionPanel.tsx` → `optionPickEventFor`, `otherPickEventFor` — the existing single/multi mapping; unchanged.
- `src/renderer/src/store/questionPicksStore.test.ts` — reducer tests that dispatch `otherTextChanged` and pin "text is independent of the tick".
- `e2e/question-picks.spec.ts`, `e2e/question-answer-continue.spec.ts` — both type into Other and then click the Other row, which now flips it back off.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6386 (Other row). Behaviour only; the ticked and un-ticked Other row already render as designed, so there are no new visuals to compare.

## Change

`otherTextChanged` gains `multiSelect: boolean`, and its arm copies mobile's `OtherTextChanged` (`copy(otherText = text).withOtherTicked(true, multiSelect)`): every edit sets `otherTicked: true`; single-select also clears `optionIndices` (radio semantics, the same result as `otherPicked`), multi-select keeps them. Emptying the text still ticks. The text stays held independently of the tick, so un-ticking afterwards (an option pick in single-select, `otherToggled` in multi-select) keeps it. `QuestionPanelSlot`'s `onOtherTextChanged` spreads `at`, which already carries `multiSelect`. This is the one arm carrying a boolean rather than a behaviour name, per the owner's instruction to copy mobile; the union's docblock is amended to say so. The same-value guard in `withSelection` still returns the same state for an identical edit.

Overlap: no in-flight branch touches these files.

## Testing strategy

- Reducer unit tests in `questionPicksStore.test.ts`: typing ticks Other and clears the option pick (single); typing ticks Other and keeps ticked options (multi); emptying the text leaves Other ticked; un-ticking afterwards keeps the text in both shapes. Existing tests that relied on typing leaving the tick alone are updated to the new rule.
- `e2e/question-picks.spec.ts`: arc 1 asserts typing replaces the radio pick with Other; arc 2 asserts typing ticks Other beside ticked options, then un-ticking keeps the text. Arcs that typed then clicked the Other row drop the now-redundant click. `e2e/question-answer-continue.spec.ts` drops the same redundant click so its sent answer is unchanged.

## Documentation handoff

None named by the ticket. The question-panel package overview's description of the Other text being "independent of the tick" (typing does not tick) is pending for the documentation stage to update.
