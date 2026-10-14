# Streaming reader scroll intent (#1885)

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin`, `demandHistory`, `reassertPinnedToBottom`: input currently releases following only in the history-demand region; growth reads the flag.
- `src/renderer/src/screens/conversation/threadScrollPosition.ts` → bottom tolerance and history band: keep existing arithmetic and demand boundaries.
- `e2e/thread-scroll-pin.spec.ts` → frame builders, metrics, prepend and send scenarios: extend the mounted fake-transport proof.
- `e2e/fixtures/launchPairedApp.ts`, `capturePairedApp.ts` → isolated app, daemon pushes and native capture.
- `docs/knowledge/features/conversation-shell-scroll-pin.md` → Thread scroll pin and User demand and prepend position: preserve pin-write echoes, resize/zoom protection, short-thread demand and compensation.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/development-verification.md` → ownership, static-render test limits and browser evidence requirements.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Read design context and screenshot for `102:4`: fixed sidebar beside a conversation pane with overlaid header and composer, using the existing dark surface and blue role tokens. This behavior correction retains the existing components, tokens, layout and assets.

## Change

Trusted upward wheel input and ArrowUp/PageUp/Home targeted at the thread release the existing DOM-local `following` ref synchronously when `scrollTop > 0`, before native scrolling starts. Route both handlers through the same local input helper, which then calls the unchanged `demandHistory`. At zero, ordinary input leaves following untouched; connected near-top/gap demand keeps its deliberate release and prepend-anchor behavior. Descendant keyboard controls retain their existing behavior. Growth/render callbacks still only read intent; `onScroll` resumes following at the bottom and successful send still calls `followBottom`. Preserve the pin echo and resize protections. Update nearby intent comments to reflect input ownership. No new type, state, failure mode, dependency or logging lifecycle is introduced.

Sizing: one behavior deliverable, five acceptance criteria, approximately 300 written lines including plan/tests, zero exported surfaces, one production caller, zero reject branches. No overlapping remote feature branch touches the planned files. The estimate and short-plan recount are within all limits. History momentum-anchor and background-agent regrouping causes remain outside this change.

## Testing strategy

- Add fake-transport Playwright regression beside existing scroll-pin cases; run against unmodified main production code before implementation and record the failing assertion/revision.
- Use real mouse wheel input over an overflowing bottom-following thread, outside the two-viewport history band and with no gap markers. Successive deltas grow one unfinished reply while input runs. Assert upward movement, wait for a stable offset over multiple frames, then require positive rendered height growth before asserting the held position.
- Cover thread-focused ArrowUp/PageUp/Home, descendant-control keys, zero upward range without history demand, downward bottom resumption, and successful send.
- Keep existing scroll-pin image, prepend and send scenarios green; run history-demand boundary coverage if needed. Existing static tests cannot execute this DOM/ref behavior.
- After final main merge, run pre-verify (typecheck/full unit suite) and build, plus the focused fake spec. Capture synthetic conversation state for appearance comparison. No live tests are changed.

## Revisions

2026-10-08: The wheel regression now schedules intrinsic last-row growth in a trusted wheel listener, alongside successive real daemon deltas. This makes growth precede the first native scroll step, exercising the existing ResizeObserver path without relying on IPC scheduling. It records the wheel-start offset, proves at least 450px movement from a 500px upward gesture, waits for 20 stable animation frames, then checks held position only after further rendered growth. The production contract is unchanged. Against the byte-identical main hook at `5f75ddc3` (renderer bundle `index-XUsNQIBt.js`), the final wheel case failed: expected offset below 6038, actual 6328, starting at 6488. ArrowUp also failed; the existing scroll-pin scenarios passed.

2026-10-08 (verifier finding 1): A released reader could be re-armed by upward native movement inside the 4px bottom tolerance. Add one DOM-local previous-offset ref, refreshed at upward input and every scroll (including echoes/resize events). `onScroll` retains following in the bottom band when already following, but resumes a released reader only on downward movement into that band. Growth/render callbacks remain read-only; send, no-range/history demand, prepend compensation, echo and resize guards keep their existing contracts. Trusted 1px and 4px wheel scenarios wait for stable native motion, require two positive streamed-height increases while holding the offset, then prove downward movement into the tolerance resumes following. Both new cases fail against the pre-repair hook; all original scenarios remain in the focused run. Total branch work remains below 300 written lines, with no new exported surface or failure mode.

## Documentation handoff

- Pending documentation stage: update `docs/knowledge/features/conversation-shell-scroll-pin.md`, “Thread scroll pin” and “User demand and prepend position”, with synchronous upward-input ownership, downward bottom-band resumption, no-range versus connected history-demand behavior, and retained echo/resize/prepend safeguards.
- Pending documentation stage: record the original main-failure and fixed browser evidence and the repaired 1px/4px small-wheel boundary in the same topic.

## Rework evidence

The pre-repair built hook (unchanged from `ba8f29a5`, with main merged at `5e4a1750`) failed both small-wheel cases at the held-offset assertion after positive streamed growth: 1px expected 6487, actual 7076; 4px expected 6484, actual 7076. The focused run executed 22 tests: 20 passed, 2 failed, 0 skipped. Log: `/tmp/builder-1885/rework-small-wheel-before.log`.

After repair and the final merge of main, `thread-scroll-pin.spec.ts` passed 22/22 (including both small-wheel cases and all original cases), `history-walk.spec.ts` 3/3, `history-gaps.spec.ts` 2/2, and `translucent-thread-controls.spec.ts` 3/3; no focused failures or skips. Pre-verify passed all five checks (9,587 unit tests passed, 3 skipped), build and docs guard passed. Logs: `/tmp/builder-1885/rework-scroll-pin.log`, `/tmp/builder-1885/rework-history-walk.log`, `/tmp/builder-1885/rework-history-gaps.log`, `/tmp/builder-1885/rework-resize.log`, `/tmp/builder-1885/rework-pre-verify.log`, `/tmp/builder-1885/rework-build.log`. Fresh synthetic capture: `/tmp/builder-1885/rework-held-stream.png`, 1100×773; existing appearance matches the reviewed Figma layout. No live specs changed.
