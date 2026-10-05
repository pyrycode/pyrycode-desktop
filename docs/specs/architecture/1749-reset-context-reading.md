# Fresh context reading after reset

## Files read

- `src/renderer/src/PairedShell.tsx` — `PairedShell` owns shell-lifetime subscriptions; `activateDeps.requestConversationConfig` retains the activation ask.
- `src/renderer/src/screens/conversation/requestContextUsage.ts` — `requestContextUsage` sends once through the injected command boundary.
- `src/renderer/src/store/conversationActivityStore.ts` — `setResetting` preserves per-conversation activity and suppresses duplicate booleans; clears remove entries.
- `src/renderer/src/store/conversationActivityBridge.ts` — `translateConversationActivity` carries both reset edges independently of phase or turn activity.
- `src/renderer/src/store/threadTimeline.ts` — `reduceTimeline` renders reset phases and clears reset presentation at a session boundary; activity remains the explicit lifecycle source.
- `src/renderer/src/screens/conversation/requestContextUsage.test.ts` — sender tests provide the home for subscription tests.
- `e2e/composer-context-claude-reading.spec.ts` — existing synthetic frames and wire-to-footer/gauge proof.
- `docs/knowledge/features/conversation-shell.md`, `reported-context-store.md` (How it works), and `development-verification.md` (Evidence that cannot pass too early) — reuse existing rendering and passive replies; observe a positive processing barrier before absence assertions.
- `docs/specs/architecture/1504-request-context-usage.md` — nearest analogue: activation and correlated reply proof, approximately 180 written lines.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408

Read the design context and screenshot. The input area has a rounded message box above a compact footer, with a primary-colour context ring followed by body-small Actions, permission, model and effort controls. Reuse the existing components, assets and theme tokens; this changes when the reading refreshes, with no layout or styling edits.

## Change

Add `subscribeResetContextUsage(activities, sendCommand): () => void` beside the existing sender. Subscribe to the injected activity store and request context for each retained entry whose `resetting` changes from true to false. Initial inactive states, repeated false, repeated true/phase updates, unrelated activity changes and entry removal send nothing. Watching every conversation retains routing when a reset completes after switching chats. Mount once in `PairedShell` with effect cleanup, alongside its existing activation request path. No new stored state, asynchronous job, timer, retries or failure modes; the subscriber compares Zustand's current/previous snapshots and main already owns classified send diagnostics. Replies continue through the passive reported-context bridge to both existing displays. No ADR needed.

One deliverable, approximately 200 total written lines, 2 production files, 0 new exported types/components/stores, 1 new consumer, 2 acceptance criteria and 0 new reject branches. Remote feature branches were fetched and checked against all four planned source/test files: no overlap. Codegraph is uninitialized; source searches provided the symbol map. Issue labels contain no security-sensitive requirement.

## Testing strategy

- First run failing unit tests for reset completion: exactly one correctly addressed ask, phase/duplicate suppression, unrelated activity, multiple conversations, removal/reconnect clear and unsubscribe.
- Extend the existing fake-transport spec: activation supplies a stale reported reading; click Reset session, hold the fresh reply, drive wrapping-up/restarting/inactive frames, assert exactly one new request, then prove footer and gauge replacement without a message. Repeated inactive frames and reopening preserve their respective request counts.
- Capture the refreshed footer and gauge at 1280×800 under `/tmp/builder-1749/` and compare the footer with the supplied design, limiting review to this data refresh.
- After the final merge of main, run the pre-verify check, build, and this focused fake-transport spec. No live tests are changed; the full Playwright tier belongs to the dispatcher.
