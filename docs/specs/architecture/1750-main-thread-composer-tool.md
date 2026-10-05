# Main-thread composer tool status

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `openToolCall`, `openToolName`, `ConversationScreen`, `ThinkingIndicator`: the same selected call supplies the composer's tool name and elapsed time; null preserves the existing generic/idle behavior.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the `openToolName` scenarios: existing coverage for newest-open selection and resolved calls provides the regression-test seam.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem`: tool calls already carry optional `parentToolUseId`; no store or wire change is needed.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/conversation-shell-working-indicator.md`, `docs/knowledge/features/development-verification.md`: pure renderer derivations are unit-testable; static renders do not execute the store-bound populated screen, so test the selector directly.

## Design source

N/A — the ticket states: “No visual change; the composer status design is unchanged.”

## Change

Restrict `openToolCall` to unresolved, non-denied main-thread calls by requiring `parentToolUseId === undefined`. Keep the reverse scan and existing result/denial checks, so the most recently started eligible main-thread call still wins. If only subagent calls are open, return null and preserve the existing no-tool/idle status behavior. No new type, state, subscription, failure mode, or consumer update. Remote feature-branch inspection found no overlaps in the two files to be changed. One deliverable, two observable acceptance criteria; estimated total written work under 90 lines, zero new exports, zero consumer updates, and zero new error branches.

## Testing strategy

Add regression cases beside the existing `openToolName` tests and watch them fail before changing the selector:

- A newer subagent call cannot replace an older open main-thread tool; the newest main-thread call wins among several.
- A subagent-only timeline, or resolved/denied main-thread calls alongside an open subagent call, returns null.
- Explicitly undefined parent IDs remain eligible; a present parent ID is excluded.

Run the touched `ConversationScreen.test.tsx` and existing `toolDenied.test.tsx` unit suites, then `npm run build`. No interaction or presentation change requires a new Playwright spec or visual capture.
