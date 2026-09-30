# #1700 — a pending question shows the waiting dot

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `ConversationStatusDotControl` — the row dot's `inputRequired` fact, read from the modal store alone today.
- `src/renderer/src/store/appBadgeBridge.ts` → `conversationStatusNow`, `subscribeToAttentionStores` — the badge's copy of the same composition and its store wake-up list.
- `src/renderer/src/store/questionBatchStore.ts` → `questionBatchStore`, `useQuestionBatchStore`, `selectBatchFor` — the held batch per conversation; `selectBatchFor` returns the held batch or `undefined`.
- `src/renderer/src/store/questionBatches.ts` → `QuestionBatchEvent` — `shown` installs a batch, `dismissed` clears it (both an answer and a Cancel resolve through `dismissed`), `reconnected` clears all.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → the `vi.mock` binding redirects and `seedInputRequired` — the per-file isolated-store pattern the new case follows (seeding a singleton is invisible to `renderToStaticMarkup`).
- `src/renderer/src/store/appBadgeBridge.test.ts` → `conversationStatusNow` / `attentionCountNow and subscribeToAttentionStores` suites.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=132-3902 — row status dot I132:3901;106:3051. No visual change: the existing `input-required` dot is reused.

## Change

`inputRequired` becomes "the modal store holds an outstanding prompt OR the question-batch store holds a batch" for the conversation, in both places that resolve a row's status. In `ConversationStatusDotControl`, a fifth subscription `useQuestionBatchStore((s) => selectBatchFor(conversationId)(s) !== undefined)` — a boolean selector, value-stable under `Object.is` — is OR-ed with the modal read before `resolveConversationStatus`. In `conversationStatusNow`, the same OR over `questionBatchStore.getState()`. `subscribeToAttentionStores` adds `questionBatchStore.subscribe(listener)`, so answering or cancelling a batch recomputes the badge. `resolveConversationStatus`'s signature does not change, and a row with both a prompt and a batch still counts once because the count is per row. No other file moves.

## Testing strategy

- `ChannelList.test.tsx`: mock `useQuestionBatchStore` onto a per-file `createQuestionBatchStore()` instance (same pattern as the four existing bindings); reset it with `reconnected` in the dot suite's `afterEach`. New case: a batch `shown` for one row draws `--input-required` on that row only; after `dismissed` the same row draws its other state (idle, and working when a turn is running).
- `appBadgeBridge.test.ts`: `conversationStatusNow` reads `input-required` for a batch-only conversation and returns to idle after `dismissed`; `attentionCountNow` counts a batch-only row once, and once for a row holding both a prompt and a batch; the wake-up test covers six stores.

## Documentation handoff

None named by the ticket. The documentation stage may note in the sidebar/badge overview that a pending question batch counts as input-required — pending for the documentation stage.
