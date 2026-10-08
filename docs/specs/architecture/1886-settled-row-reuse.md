# Settled timeline row reuse (#1886)

## Files read
- `CLAUDE.md` and `docs/knowledge/INDEX.md`: renderer conventions and owning topics.
- `docs/knowledge/features/conversation-shell-timeline-render.md`: streaming/settled split and cursor policy; current keys override historical index-key notes.
- `docs/knowledge/features/assistant-markdown-renderer.md`: security boundary and mounted V8 proof requirement.
- `docs/knowledge/features/development-verification.md`: static rendering cannot prove skipped execution.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx`: `ConversationScreen`, `Timeline`, `TimelineRow`, `ToolRow`, `MessageActions`; row inputs and controlled/standalone expansion.
- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx`: `AssistantMarkdown`; text, link callback and streaming allowElement inputs.
- `src/renderer/src/screens/conversation/foldQueuedRows.ts`: `foldQueuedRows`; fresh queue handles and unmatched items must remain observable.
- `src/renderer/src/screens/conversation/turnStats.ts`: `turnStatsByItemIndex`; primitive stats labels remain comparable.
- `src/renderer/src/store/threadTimeline.ts`: `appendDelta`; unchanged source items retain identity.
- `e2e/progressive-markdown.spec.ts`: precise V8 function counters and positive execution baseline.
- `e2e/tool-groups.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: group visibility/identity coverage and fake-transport delivery.

## Context
Settled messages and tool rows currently execute again on every appended chunk. This slice removes that work without changing presentation, scheduling deltas, projections or layout. No ADR or visual design change is needed. The remote `feature/suggestion-quieter-tab-sends` overlaps only unrelated Composer logic; build through it with local edits.

Size: one deliverable, four observable criteria, about 450–550 written lines, no new exported type/component/store, three local production call sites, no new error branches. The finished plan remains within all sizing limits.

## Design
Use ordinary shallow React memoization for `TimelineRow` and `AssistantMarkdown`. Stabilize reply/drop/send-now callbacks with useCallback and honest conversation/host dependencies; preserve availability by passing undefined when unavailable. Do not ignore function changes in comparators.

Keep exported `ToolRow` and its standalone defaultExpanded contract unchanged. A private memoized `TimelineToolRow` accepts the original item, stable row key, primitive count/background/running/expanded inputs and one stable `(key: number | string) => void` toggle. It constructs ToolRow's legacy group/expansion objects only when its own inputs change. This is cleaner than a custom comparator that must compare nested records and retain a freshly captured toggle closure.

Keep every existing React key and grouping wrapper in place. Group wrappers still update visibility and joins; hidden ToolRow descendants remain mounted. Fresh queued items/handles may rerender: they carry current action identity, and no equality shortcut may mask queue replacements. Settled markdown memoization also skips parsing when only metadata or action availability changes.

## State + concurrency model
No new store, stream, async task or lifecycle. Existing keyed Timeline expansion sets stay authoritative. Its stable toggle uses a functional state updater and the existing row key. Callback dependencies change on pane switches; Timeline continues remounting by conversation key. Existing subscriptions and teardown remain unchanged.

## Error handling
No new failure mode or boundary. Existing queue guards, diagnostics, copy results and markdown link validation stay intact.

## Testing strategy
- Add a fake-transport regression with several settled user/assistant messages, resolved grouped and unrelated tools, and an active reply. Start precise coverage before seed delivery to establish positive row, markdown and tool execution.
- Observe each chunk before delivering the next. Count TimelineRow calls separately from ToolRow and AssistantMarkdown; use unchanged active content during expansion to distinguish row rendering from markdown parsing.
- Expand child then collapse/reopen its parent; assert one affected tool executes, unrelated work stays at zero, and child result expansion survives hiding.
- Record red evidence on unmodified main production at `5f75ddc3`, then green evidence after implementation. Existing action, queue, markdown-reader, stats, history/regrouping and tool-progress specs cover behavioral continuity.
- Run the focused fake specs, pre-verify (typecheck/full units) and build after the final main merge. The dispatcher owns the full fake suite; no live Claude test is needed.

## Open Questions
None. All input equality uses React's shallow comparison; no deep comparisons or callback suppression.
