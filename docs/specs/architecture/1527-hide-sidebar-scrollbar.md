# Hide the sidebar scrollbar (#1527)

## Files read

- `src/renderer/src/screens/channels/channels.css` — `.channel-list__tree` owns scrolling and the existing inset geometry.
- `src/renderer/src/screens/channels/ChannelList.tsx` — `ChannelListView` keeps the top bar outside the tree and renders native row buttons.
- `src/renderer/src/screens/conversation/conversation.css` — `.conversation__thread` supplies the existing hidden-scrollbar pattern; update its sidebar reference.
- `e2e/thread-scrollbar.spec.ts` — `scrollbarWidthOf` reads actual computed paint policy; its old sidebar expectation needs updating.
- `e2e/sidebar-tree-geometry.spec.ts` — `tallListFrame` demonstrates overflowing the tree after the fixture's single-row launch.
- `e2e/fixtures/launchPairedApp.ts` — `launchPairedApp` provides the real Electron/fake-daemon interaction fixture.
- `docs/knowledge/features/channel-list.md` and `development-verification.md` — the top bar remains fixed, and static rendering cannot prove scroll or focus behavior.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=132-3902

The design context and screenshot show a 400px sidebar with compact nested host/workspace rows, a settings/archive top bar and inset rules, without a scrollbar. Existing theme colors, typography, 20px horizontal insets and row geometry remain; the ticket defines the overflowing state.

## Change

Apply `scrollbar-width: none` and a separate `::-webkit-scrollbar { display: none; }` fallback to `.channel-list__tree`, mirroring the message thread. Retain `overflow-y: auto`, its margin/padding pair and the top bar structure. Refresh directly affected scrollbar comments and the thread test's sidebar expectation. No new state, types, failure branches or lifecycle events are introduced, so no runtime logging changes are needed.

Sizing: one behavior, two acceptance criteria, one stylesheet with behavior changes and one with comment updates, about six added CSS lines and under 220 total written lines including plan and tests. No TypeScript production files, new exports or consumer signature updates. Refiner's under-ten-production-lines estimate holds for the behavior change. Remote feature-branch overlap check found no conflicts.

## Testing strategy

Add `e2e/sidebar-scrollbar.spec.ts` before CSS and observe RED on computed scrollbar policy. Seed overflowing channels and chats; assert hidden scrollbar policy at rest and after wheel input, wheel reachability in both directions, and keyboard Tab focus revealing offscreen rows. Check fixed top-bar geometry and capture the actual app for visual comparison. Run this spec, the adjusted thread scrollbar spec, the existing sidebar geometry spec and `npm run build`. Static unit tests cannot observe this CSS-only change. Computed `scrollbar-width: none` is independent of the host's scrollbar preference; physical trackpad momentum cannot be reproduced by Playwright.

## Documentation handoff

No documentation requirement or documentation-only acceptance criterion was specified by the ticket. Shared knowledge documentation remains owned by the documentation stage.
