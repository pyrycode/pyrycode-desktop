# Active agent row emphasis

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `CompactRow`, `ThreadItemsView`, `TimelineToolRow`, `ToolRow`: supplied kind/activity reaches both delivery routes, but active supplied outcomes retain pending dimming.
- `src/renderer/src/screens/conversation/conversation.css` → `.tool-row`, `.tool-row--resolved`: pending opacity is 0.5; full opacity is an existing presentation treatment.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `presentation`: compact headers and complete agents both adapt to tool-call presentation; agent identity must come from the supplied source.
- `e2e/compact-demand.spec.ts` → compact native fixture: omitted-detail headers travel independently from complete items and need split data/final replies.
- `e2e/fixtures/capturePairedApp.ts` → `capturePairedApp`: capture the mounted synthetic screen through Electron.
- `docs/knowledge/features/conversation-shell.md` → supplied timeline: preserve source-ID expansion, grouping and compact demand deferral.
- `docs/knowledge/features/development-verification.md` → source and contract checks: computed mounted styling proves opacity; static markup cannot.
- Root `CLAUDE.md`, knowledge index, shared working practice, scope policy and visual-review recipe: repository and verification boundaries.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=789-10437

Read the section screenshot and live-row child `789:10539`. The running Agent uses the existing bordered tool row with full-emphasis tertiary monospace name, body-medium subject and trailing running/count text. Retain the current surface, primary-container border, spacing and typography tokens; this repair changes only opacity.

## Change

Carry an `activeAgent` boolean derived from supplied `kind === 'agent'` and `active === true` through `CompactRow` and `TimelineToolRow` to `ToolRow`. Add a dedicated modifier sharing the existing opacity-1 declaration, leaving outcome selection, running/count text, grouping, placement and disclosure intact. Ordinary pending tools remain at opacity 0.5, even if their display name is Agent. No new state, exported type or failure mode is introduced. One independently useful behaviour, two acceptance criteria, about 180 written lines, two production files and three local prop consumers stay within the scope limits. The #1748 analogue added 102 implementation/test lines plus a 28-line plan and deleted 136 lines. In-flight #2165 touches only the adjacent empty-error-summary guard in `CompactRow`; build through that independent overlap with local additive edits.

## Testing strategy

- Add `e2e/active-agent-opacity.spec.ts` using native fake-daemon replies, parameterized over compact omitted-detail headers versus complete items and grouped versus ungrouped placement.
- Measure computed opacity on the visible agent label, its row and every ancestor through the document root: all must be 1. Measure an active ordinary pending-tool control at 0.5, including a tool named Agent to prove supplied kind owns the distinction.
- In grouped cases open the run, verify its existing count, then collapse/reopen and repeat measurements. Assert existing agent status/count copy and capture the mounted state for visual comparison.
- Run all four cases before implementation and require failures at the agent opacity assertion; rerun after the fix. Run the affected `ConversationScreen.test.tsx` through pre-verify and build after merging final main. Capture and compare Electron renders at 1280×800 on Linux.
