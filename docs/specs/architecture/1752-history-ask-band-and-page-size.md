# #1752 — Ask for older history two viewports early, 200 entries at a time

## Files read

- `src/renderer/src/screens/conversation/threadScrollPosition.ts` → `HISTORY_ASK_BAND_PX`, `isNearTop`: the band and its one comparison; both change.
- `src/renderer/src/screens/conversation/threadScrollPosition.test.ts` → `describe('isNearTop')`: the band's boundary cases; re-derived from the viewport.
- `src/renderer/src/store/historyPageBridge.ts` → `requestOlderHistory`: the one place an older-history payload is built (Retry reaches the wire through it too); `limit: 0` becomes a named constant.
- `src/renderer/src/store/conversationTimelineStore.ts` → `MAX_LIVE_JOIN_KEYS` docblock: says the client sends `limit: 0`; corrected. 512 still exceeds a 200-entry page, so the value stays.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `demandHistory`: the only caller of `isNearTop`; unchanged, it already passes all three metrics.
- `src/renderer/src/store/historyDemand.test.ts`, `src/renderer/src/screens/conversation/historyRetry.test.ts` → payload assertions with `limit: 0`.
- `e2e/history-walk.spec.ts` → `walkBackUntilAskFor`, `scrollBack`, AC1 payload assertion: parks at fractions of the px band.
- `e2e/thread-scroll-pin.spec.ts` → 'a page walked back above the reader leaves them looking at the same row', `primeOverflowingThread`: the prepend-stability park.
- `e2e/history-retry.spec.ts` → Retry payload assertion with `limit: 0`.

No other in-flight `feature/*` branch touches these files.

## Design source

N/A — behaviour-only: no layout, visual or copy change. The scroll trigger distance and the request size change; nothing drawn changes.

## Change

`HISTORY_ASK_BAND_PX = 200` is replaced by `HISTORY_ASK_BAND_VIEWPORTS = 2`, and `isNearTop` becomes `scrollOffset <= HISTORY_ASK_BAND_VIEWPORTS * viewportHeight`. A pixel name can no longer describe a viewport-derived band, so the constant is renamed rather than kept; its only importers are the two e2e specs and the unit test, all updated here. The docblock keeps the "rim before the wall" reasoning (Chromium turns anchoring off at offset 0, so the ask must fire before the top) and drops the quarter-of-800px fence; `isNearTop`'s docblock now says it reads the offset and the viewport, never the content height. `requestOlderHistory` sends `limit: HISTORY_PAGE_LIMIT` (`200`, exported from `historyPageBridge.ts`) instead of `limit: 0`; the daemon clamps above its 4096 ceiling (pyrycode `docs/protocol-mobile.md` § Page size). Retry already routes through `requestOlderHistory`, so it inherits the limit. The trusted-input-only gate, the single-request-in-flight guard and `demandHistory` are untouched.

`demandHistory` clears `following` when `isNearTop` holds, so the wider band widens that too. On a thread no taller than its viewport the offset is 0 and the answer is unchanged. On a taller thread, the inputs that ask (upward wheel, `ArrowUp`, `PageUp`, `Home`) all move the thread up, and the scroll event that follows clears `following` anyway, so the visible behaviour is the same.

## Testing strategy

- Unit, `threadScrollPosition.test.ts`: boundary cases re-derived from `viewportHeight` (exactly `2 × viewport` is in, one pixel past is out), plus a case proving the band scales with the viewport and ignores content height.
- Unit, `historyDemand.test.ts` and `historyRetry.test.ts`: payloads assert `limit: 200`.
- e2e, `history-walk.spec.ts`: parks derive from the measured `clientHeight`; the AC1 payload asserts `limit: 200`. A new test serves an opening page tall enough to scroll past three viewports, then shows that an upward input parked one band plus a margin from the top sends nothing, and one parked at the band edge sends `request_history`.
- e2e, `history-retry.spec.ts`: the Retry payload asserts `limit: 200`.
- e2e, `thread-scroll-pin.spec.ts`: the prepend-stability case parks at one viewport (`clientHeight`), inside the new band and outside the old 200px one. That park needs the reader to be a full viewport clear of the bottom, so the case adds content beyond `primeOverflowingThread` if the measured thread is shorter than three viewports.
