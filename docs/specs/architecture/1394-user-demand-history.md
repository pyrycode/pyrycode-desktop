# User-demand history pages

## Files read

- `src/renderer/src/PairedShell.tsx`: `activateDeps` currently requests opening history.
- `src/renderer/src/store/historyPageBridge.ts`: `requestOlderHistory`, `requestOpeningHistory`, `subscribeHistoryPage`, `withoutLiveEntries` own requests and page admission.
- `src/renderer/src/store/conversationTimelineStore.ts`: `ConversationSlice`, `withHistory`, `beginLocalTimelineRead` own transient requests, host identity and restored coverage.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx`: `useThreadScrollPin`, `ThreadScrollPin`, `Timeline` own geometry and input.
- `src/renderer/src/screens/conversation/threadScrollPosition.ts`: `isNearTop` supplies the existing band.
- `src/renderer/src/screens/conversation/conversationActionAvailability.ts`: `connectedConversationHostNow` resolves host availability immediately before an action.
- `src/main/daemonConnection.ts`: `requestHistory`, `onDriverEvent`, `dial` own history correlation and abandonment.
- `src/renderer/src/store/historyPageBridge.test.ts`, `conversationTimelineStore.test.ts`: existing coverage and request-state proofs.
- `src/main/daemonConnection.test.ts`: request/reply fake-driver scenarios.
- `e2e/history-on-open.spec.ts`, `history-walk.spec.ts`, `thread-scroll-pin.spec.ts`, `chat-history-recording.spec.ts`, `tool-groups.spec.ts`, `real-daemon-history-on-open.spec.ts`: history-dependent interaction scenarios.
- `e2e/fixtures/launchPairedApp.ts`: `launchPairedApp` supplies real Electron and fake transport.
- `docs/knowledge/features/chat-history.md`, “Received-state admission and ownership”: local restoration is explicit; successful coverage survives independently of requests; command observation must precede host routing.
- `docs/knowledge/features/conversation-timeline-store.md`, `conversation-shell.md`, `development-verification.md`: keyed holder, static renderer test limits and interaction evidence.
- Root `CLAUDE.md` and shared working practice: process boundaries, test execution and role ownership.

Codegraph returned an uninitialized-index error; source reads supplied the symbol and consumer inventory.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Read design context and screenshot. The desktop frame has a fixed sidebar beside a vertically scrolling thread, dark blue message surfaces and a bottom composer with compact action controls. Reuse `Timeline`, its theme styles and near-top band; add input handling and keyboard focusability to the existing scroll region.

## Context and sizing

Opening currently downloads history and programmatic scroll can advance it. Failed requests lose the usable cursor, while redial abandons correlations without settling the renderer. One deliverable is user-controlled paging that retains its progress through interruption; connected local restoration remains #1395.

Estimate: approximately 740 written lines including plan, tests and migrations; five production files, no new exported declarations, four acceptance criteria, fewer than ten error branches. Changing the demand dependency reading updates its two fixture factories; the pin has one production consumer, each asker has one production caller. New optional slice coverage does not require construction changes outside the holder. Remote feature branches were fetched and the five planned production paths had no overlaps.

## Design

- Remove `requestOpeningHistory` and its activation call. All pages use `requestOlderHistory` on explicit upward demand.
- The demand dependency reads the held slice, including local-read status and separately retained successful coverage. Unknown coverage requests `cursor: ''`; received coverage uses its exact cursor unless `atStart` is true. Pending local reads and pending requests discard demand.
- Store successful coverage alongside `history`, updating only on successful pages or restoration. Requests and failures preserve rows, cursor, completion and prepend metadata. Mark requests with their host; another host's held slice cannot supply a cursor or receive a stale failure.
- `useThreadScrollPin` keeps scroll events solely for local bottom-following measurements. Trusted upward wheel input, or ArrowUp/PageUp/Home when the scroll region itself is the keyboard target, checks current near-top geometry and host availability. Input outside the band only scrolls; it is never queued. Upward demand releases bottom following so the first prepend preserves the reader's position even on a short thread.
- Keep `withoutLiveEntries`, row order, stable prepend keys and existing compensation unchanged.
- Main keeps one correlation per host/conversation and settles all outstanding history requests with the existing classified failure event on drop, terminal, error or explicit redial. Clear correlations before emitting failures. Unavailable/build/send failure also settles immediately. Replies use the existing generation and correlation gates.

## State and concurrency

The bounded conversation holder owns coverage for its lifetime. Restored coverage seeds that holder without downloading. Read, mark and send are synchronous with no intervening await. Main owns correlation lifetime; existing driver teardown and generation fencing reject late replies. No new timers, queues, subscriptions or background walks. Existing React input props are removed with the node. Offline input only changes the viewport.

## Error handling

Failures retain successful coverage and release pending status. They do not trigger retry, clear rows or reset the cursor. A later qualifying connected input retries. Main emits existing typed `historyRequestFailed` with a static classification for abandonment; diagnostics contain static lifecycle/result codes only, never conversation ids, cursors, payloads or caught objects.

## Testing strategy

- RED first: demand decisions for unknown/restored/complete coverage, pending/local reads and retry; store coverage preservation and host isolation; main abandoned correlations and stale replies.
- Fake-transport Playwright: zero commands before demand observed at main IPC, genuine versus programmatic input, short/empty thread, composer focus, pending input discard, no auto-next after empty/short pages, reconnect retry and prepend position.
- Migrate history-dependent existing specs to explicit wheel/key input, retaining their assertions. Real-daemon history spec migration is handed to the dispatcher for execution; do not run the live tier.
- Run touched unit files, build, and changed fake-transport specs. Capture the integrated thread at 1280×800 into `/tmp` and compare to the Figma reference.

## Open questions

None. `atStart` alone establishes completion; failed nonretryable server classifications still require new user input and retain the successful cursor.

## Documentation handoff

Pending for documentation stage: update `docs/knowledge/features/chat-history.md`, “Received-state admission and ownership”, with user-only first/subsequent page demand, retained coverage and reconnect retry semantics.

## Security review

**Verdict:** PASS

- Trust boundaries: keep `subscribeHistoryPage` on decoded typed events and `withoutLiveEntries` unchanged. Host-stamped requests and receipt checks prevent cross-host cursor/failure reuse.
- Tokens and cryptography: no key, credential, RNG or Noise changes; all transport remains main-side.
- Storage: existing safeStorage-protected snapshots and explicit restoration handles remain authoritative. No new persistence or renderer web storage; coverage is in-memory metadata restored from the validated snapshot.
- Electron: no new IPC channel, navigation or window capability. Existing bounded `requestHistory` payload and typed failure event suffice; no raw markup or privileged remote content.
- Network: no protocol or relay policy changes. Existing frame bounds, driver supervision and generation gates remain. A withholding relay cannot cause a background download loop; interruption settles correlations.
- Logs: static request/page/failure lifecycle codes only; no cursor, ids, content, caught exceptions or credentials.
- Concurrency: mark before send, discard pending demand, clear before settling abandoned correlations, reject stale host receipts. No queued retry survives a local read or reconnect.
- Threat model: content-blind relay interruption affects availability only; daemon content remains parsed in main and escaped in existing renderers. Storage encryption and renderer isolation remain the existing protections, with no weaker fallback introduced.

**Reviewer:** builder self-review per shared `builder/security-review.md`.
**Date:** 2026-09-13

## Revisions

2026-09-13: The first Electron run showed `Timeline` returned `EmptyThread` before mounting its scroll region. Keep that empty content inside the same focusable region so empty-thread input reaches the handler. The region has a static accessible label and retains the browser's keyboard-focus indicator; no theme changes are needed. Static empty-region assertions now require exactly one region.

The migration inventory also includes `e2e/offline-conversation-actions.spec.ts`: reconnect followed by reopening must still send zero history commands until a new upward key. `LaunchControl.onLaunched` installs the test's main IPC observer before pairing and activation. The held-prepend test sends its key at zero before parking the reading anchor, avoiding native key-scroll animation during measurement. No production contract changed from the design above.

Verification: 976 focused unit tests and build passed. Fake-transport history input/reconnect, page sequence, recording/restoration, offline actions, tool groups and scroll pinning are the touched interaction gate. Reviewed `/tmp/builder-1394-thread-1280.png` at 1280×800 against the Figma reference: existing sidebar/thread/composer arrangement and message tokens remain; keyboard focus visibly outlines the thread. The live-daemon spec was migrated but its execution is pending with the dispatcher. Total work remains below the 800-line boundary across five production files.

2026-09-13 rework: The verifier identified six failures in `banner.test.tsx` → `banner display surfaces`: its timeline-wide attribute prohibition also rejected the client-owned thread label. Assert the exact focusable thread opening separately and retain the attribute prohibition on everything inside it. This migrates the test seam without changing the production or security contract. The builder runs the focused banner tests and build; the dispatcher owns the full regression suite.

2026-09-13 scrollbar rework: The verifier confirmed that `e2e/thread-scrollbar.spec.ts` → `the overflowing thread draws no scrollbar while its neighbours keep theirs` still expected no tabindex. Migrate that assertion and the related comments to the planned focusable-thread contract (`tabindex="0"`). Preserve the scrollbar, overflow, anchoring and wheel/keyboard assertions. No production or design change; validation is build plus this focused fake-transport spec, with full regression gates owned by the dispatcher.
