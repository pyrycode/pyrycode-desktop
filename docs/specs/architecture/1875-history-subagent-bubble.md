# Keep history replies together across suppressed subagent calls

## Files read

- `src/renderer/src/store/historyContributions.ts` → `reconcileHistory`: suppressed contributions close the grouping window; held rows must retain identity and live state.
- `src/renderer/src/store/threadTimeline.ts` → `openBubbleIndex`, `appendDelta`: nonempty-parent tool rows permit main-reply lookback; all other rows remain barriers.
- `src/renderer/src/store/historyPageBridge.ts` → `reduceHistoryPage`, `withoutLiveEntries`: reference grouping and timestamp suppression.
- `src/renderer/src/store/conversationTimelineStore.ts` → `prependHistoryFor`: production contribution admission, independent of held live-state reduction.
- `src/renderer/src/store/historyContributions.test.ts` → `seam`, `live`, `restore`: production dispatch/admission harness with validated fresh-store restoration and repeat-page identity assertions.
- `docs/knowledge/features/conversation-timeline-store.md`, `conversation-timeline-store-internals.md` and `development-verification-history.md`: distinguish retained display evidence from receipts; preserve held row objects and relative order.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `package.json`: repository conventions, ownership and existing test tooling.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171

Read design context and screenshot for Message area: a vertical thread of rounded assistant/user bubbles, body-medium text, theme surface/text roles and separate event rows. Reuse the existing thread components and tokens; this changes only the content grouped into the surviving assistant bubble.

## Change

Extract `isSubagentToolCall(item: ThreadItem | undefined): boolean` from the live lookback predicate and reuse it in `openBubbleIndex` and `reconcileHistory`. A held subagent tool row with a nonempty parent keeps contribution grouping open just as a retained subagent call does, including calls with results. Existing candidate matching, turn/parent checks, chronological barriers and held-position checks continue to decide whether texts can join. Older text joins the held assistant at its existing position, so the reproduction becomes tool then `hello world`; the assistant keeps its key and first timestamp, and the tool keeps its object and attached state. No schema, validation, capacity, transport, state or error-path change is needed.

No in-flight remote feature branches overlap the three source/test files. One deliverable; forecast under 250 written lines, one new exported helper, two production files, two local consumers, three observable acceptance criteria and no new reject branches. The sketch and finished plan both fit the sizing limits; the nearest analogue is #1872's 207 inserted production/test lines.

## Testing strategy

- Extend `seam` with pending/completed suppressed subagent calls and retained-call controls, with and without validated fresh restoration. Assert tool/assistant order, surviving keys, assistant timestamp, unchanged tool object/result and pending live progress; repeat the complete page and retain exact row objects.
- Cover main tool calls with absent/empty parents, attributed subagent text, different turns and an operator row between texts alongside a suppressed subagent call. Cover an unrepresented held barrier as well. Assert held keys/order and unchanged row objects before and after restoration.
- Use the existing production store dispatch/page/restoration harness, not a reducer-only proof. Run the new regression red before implementation, then focused history/live reducer units and the full pre-verify check plus build after the final main merge.
- No user-driven interaction or real-Claude test changes are required. Capture synthetic joined content through the existing thread component for visual evidence; screenshots establish presentation, while store tests establish grouping and identity.
